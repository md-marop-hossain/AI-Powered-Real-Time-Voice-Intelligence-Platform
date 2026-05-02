"""LLM interview agent: generates initial questions and decides follow-ups
based on the conversation so far.

The plan and follow-up prompts are tailored by:
  - role: free-text title the candidate is rehearsing for
  - seniority: fresher | junior | mid | senior | staff | manager
  - focus: mixed | technical | behavioral | system_design
  - industry: optional free-text industry context
"""

from __future__ import annotations

import asyncio
import json
import logging
import re

from app.core.llm_provider import JSON_RESPONSE, get_llm_provider

# Hard ceiling on each LLM round-trip. Without this, a slow-to-respond
# upstream (Groq / OpenAI) leaves the consumer task hanging on the await,
# which leaves the candidate's UI stuck on "CONSIDERING YOUR ANSWER…"
# forever. 30s is generous for a 70B model with JSON output.
LLM_TIMEOUT_SECONDS = 30.0

# Maximum résumé content (in characters) injected into any single LLM prompt.
# Defends against runaway prompts AND limits the surface area for a malicious
# résumé to influence the model.
MAX_RESUME_PROMPT_CHARS = 8000
# Per-string cap so one bloated field can't dominate the prompt budget.
MAX_RESUME_FIELD_CHARS = 1500

# Strip ASCII / Unicode control characters except newline and tab. PDFs and
# DOCX exports occasionally ship with C0 / C1 control codes that confuse the
# tokenizer and can be used to smuggle hidden instructions past a casual
# eyeball-review.
_CONTROL_CHARS = re.compile(
    "[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F  ]"
)

log = logging.getLogger(__name__)


def _sanitize_resume_text(text: str | None, max_chars: int = MAX_RESUME_PROMPT_CHARS) -> str:
    """Strip control chars and cap length on a free-text résumé blob.

    Intentionally NOT a content filter — we don't try to detect prompt
    injection patterns ('Ignore previous instructions…') because false
    positives would silently degrade real résumés. The cap + control-char
    scrub gives the LLM a stable, bounded input; the system prompt is
    responsible for refusing to follow embedded instructions.
    """
    if not text:
        return ""
    cleaned = _CONTROL_CHARS.sub("", text)
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    return cleaned[:max_chars]


def _sanitize_resume_obj(obj, field_max: int = MAX_RESUME_FIELD_CHARS) -> dict:
    """Recursively clean a parsed-résumé dict so it's safe to JSON-dump
    into a system prompt.

    Strips control chars from string values, caps each string at
    field_max, and leaves non-string scalars untouched.
    """

    def clean(v):
        if isinstance(v, str):
            return _CONTROL_CHARS.sub("", v)[:field_max]
        if isinstance(v, list):
            return [clean(x) for x in v]
        if isinstance(v, dict):
            return {
                (clean(k) if isinstance(k, str) else k): clean(val)
                for k, val in v.items()
            }
        return v

    cleaned = clean(obj or {})
    return cleaned if isinstance(cleaned, dict) else {}


# ---------- Human-readable labels for prompt context ----------

SENIORITY_LABEL = {
    "fresher": "Fresher / new graduate (0 years experience). Expect basic fundamentals; avoid deep system-design questions; favour learning aptitude and simple coding/concept checks.",
    "junior": "Junior (1-2 years). Expect solid fundamentals and simple project ownership; light architecture questions only.",
    "mid": "Mid-level (3-5 years). Expect strong fundamentals, real project depth, applied trade-offs, and at least one architecture/system question.",
    "senior": "Senior (5-8 years). Expect deep technical mastery, leadership, scoping, complex trade-offs, mentoring examples, and harder system-design questions.",
    "staff": "Staff / Principal (8+ years). Expect cross-team impact, long-horizon decisions, strategy, ambiguous problems, organisational leverage, and rigorous architecture.",
    "manager": "Engineering Manager. Mix of technical fluency and people leadership; ask about team building, conflict resolution, planning, and high-level architecture.",
}

FOCUS_LABEL = {
    "mixed": "Balanced mix: introduction, resume deep-dive, technical depth, behavioural/leadership, and a closing reflection.",
    "technical": "Mostly technical: language/framework depth, algorithms when appropriate, debugging, and applied problem-solving from the resume.",
    "behavioral": "Mostly behavioural: STAR-style scenarios about ownership, conflict, failure, growth, collaboration, and decision-making — drawn from real resume projects.",
    "system_design": "Mostly system design: open-ended architecture problems sized to seniority; emphasise trade-offs, scaling, data flow, and reliability concerns.",
}


def _seniority_label(s: str | None) -> str:
    return SENIORITY_LABEL.get((s or "mid").lower(), SENIORITY_LABEL["mid"])


def _focus_label(f: str | None) -> str:
    return FOCUS_LABEL.get((f or "mixed").lower(), FOCUS_LABEL["mixed"])


def _industry_clause(industry: str | None) -> str:
    if not industry or not industry.strip():
        return "Industry: not specified."
    return f"Industry / domain: {industry.strip()}. Where natural, ground questions in this context."


# ---------- Plan generation ----------

INITIAL_QUESTIONS_SYSTEM = (
    "You are a senior technical interviewer planning a mock interview. "
    "You will be given the candidate's parsed resume, the target role, the seniority "
    "level, the interview focus, and an optional industry. "
    "Produce a structured plan with 6-10 well-scoped primary questions. "
    "Tailor BOTH the difficulty to the seniority level and the question mix to the focus area. "
    "Reference concrete details from the resume (companies, projects, skills) where possible. "
    "Do NOT invent experience the resume does not contain.\n\n"
    "HARD RULE — output candidate-ready questions ONLY. NEVER use bracketed "
    "placeholder tokens like [Company Name], [Programming Language], [Project "
    "Name], [Alternative Language], or [X]. If a specific detail isn't in the "
    "resume, ask the question generically (e.g. 'a recent project where you "
    "owned the design') instead of inserting a placeholder."
)

INITIAL_QUESTIONS_USER_TEMPLATE = """Target role: {role}
Seniority: {seniority_label}
Focus: {focus_label}
{industry_clause}
Duration: {duration_minutes} minutes

Parsed resume (JSON):
{resume_json}

Return JSON exactly in this shape:
{{
  "questions": [
    {{"index": 1, "section": "intro|experience|technical|behavioral|system_design|closing",
      "question": "..."}}
  ]
}}"""


async def generate_question_plan(
    role: str,
    duration_minutes: int,
    parsed_resume: dict | None,
    seniority: str | None = None,
    focus: str | None = None,
    industry: str | None = None,
) -> list[dict]:
    provider = get_llm_provider()
    raw = await provider.chat(
        messages=[
            {"role": "system", "content": INITIAL_QUESTIONS_SYSTEM},
            {
                "role": "user",
                "content": INITIAL_QUESTIONS_USER_TEMPLATE.format(
                    role=role,
                    seniority_label=_seniority_label(seniority),
                    focus_label=_focus_label(focus),
                    industry_clause=_industry_clause(industry),
                    duration_minutes=duration_minutes,
                    resume_json=json.dumps(
                        _sanitize_resume_obj(parsed_resume),
                        ensure_ascii=False,
                    )[:MAX_RESUME_PROMPT_CHARS],
                ),
            },
        ],
        response_format=JSON_RESPONSE,
        temperature=0.4,
    )
    try:
        data = json.loads(raw)
        return data.get("questions", [])
    except json.JSONDecodeError:
        log.warning("LLM returned non-JSON for question plan: %s", raw[:200])
        return []


# ---------- Follow-up decision ----------

FOLLOWUP_SYSTEM = (
    "You are a real-time mock-interview agent acting like a calm, patient human interviewer. "
    "Given the interview plan, conversation history, candidate's seniority + focus, the latest "
    "answer (which may be the cumulative answer-so-far for the current question), and how many "
    "soft nudges you have already given on this question, pick exactly one decision.\n\n"

    "DECISIONS:\n"
    "- nudge: a SHORT, soft continuation prompt (<= 6 words, no question mark needed). Speak it "
    "to encourage the candidate to keep going on the SAME question. Use ONLY when the latest "
    "answer is genuinely a fragment (see definition) AND nudges_so_far < 2.\n"
    "- ask_followup: a real, specific clarifying or probing question on the SAME topic. Adds new "
    "value beyond what the candidate has said. Must be a complete sentence question. CRITICAL: "
    "Each follow-up must take a DIFFERENT angle than previous follow-ups on this question — a "
    "different aspect, a smaller scope, a concrete example, a hint, or a simpler restatement. "
    "Never just rephrase the same probe. Read the conversation history before composing.\n"
    "- next_question: move to the next planned question. Pick this when the candidate's answer is "
    "structurally complete, when they explicitly signal they're done ('that's it', 'you can ask "
    "another', 'I have nothing more to add', 'next question', 'move on'), OR when 2 follow-ups "
    "on the current topic have already produced fragmentary or off-topic answers (the candidate "
    "clearly doesn't have more depth to give — pivot don't drill).\n"
    "- end_section: end the entire interview. Pick this when planned questions are covered, time is "
    "short, OR the candidate has explicitly asked to STOP THE INTERVIEW (not just the question).\n\n"

    "FRAGMENT DEFINITION — an answer counts as a fragment if EITHER pattern holds:\n"
    "A. Short fragment — Fewer than ~12 meaningful (non-filler) words AND trails off / is "
    "dominated by fillers / restarts AND contains no explicit move-on signal.\n"
    "B. Trailing-off ending — The answer is otherwise substantive but the FINAL clause trails "
    "off without finishing: a repeated word at the very end ('to their desirable, desirable'), "
    "an unfinished phrase ('and uh and uh'), or a clause that breaks off mid-syntax with no "
    "verb / noun completion. Treat these as the candidate still composing — nudge for the rest.\n"
    "If neither pattern holds, the answer is NOT a fragment — pick ask_followup or next_question.\n\n"

    "EXPLICIT SIGNALS OVERRIDE EVERYTHING:\n"
    "- 'that's it' / 'I'm done' / 'you can ask another question' / 'next question' / 'move on' "
    "→ next_question (do NOT nudge, even if the answer was short).\n"
    "- 'stop the interview' / 'end the session' / 'I want to stop' / 'I give up' "
    "→ end_section.\n\n"

    "NUDGE COPY RULES (when decision is nudge):\n"
    "- Keep next_text very short and natural: 'Take your time.' / 'Go on.' / 'Mm-hm — tell me more.' "
    "/ 'Please continue.' / 'And then?'.\n"
    "- Never re-ask the original question. Never introduce a new topic. Never combine two prompts.\n"
    "- Vary the wording across nudges within the same question.\n\n"

    "NUDGE CAP: nudges_so_far is capped at 2. If nudges_so_far == 2, you MUST pick ask_followup "
    "(a focused clarification on the same topic) or next_question — NEVER nudge a third time.\n\n"

    "FOLLOWUP CAP: followups_so_far is capped at 2. If followups_so_far >= 2, you MUST pick "
    "next_question or end_section — NEVER ask a third follow-up on the same primary question. "
    "Two follow-ups is the limit even if the answer still feels thin; pivoting respects the "
    "candidate's time.\n\n"

    "SCORING:\n"
    "- For nudge decisions, scores will be ignored by the system; emit any reasonable values.\n"
    "- For ask_followup / next_question / end_section, score honestly on four dimensions (0-10): "
    "clarity, depth, correctness, communication. Calibrate to seniority — a 'mid' score for a "
    "senior is harsher than for a junior.\n\n"

    "Return STRICT JSON, no commentary."
)

FOLLOWUP_USER_TEMPLATE = """Target role: {role}
Seniority: {seniority_label}
Focus: {focus_label}
{industry_clause}

Plan:
{plan_json}

Resume context:
{resume_summary}

Conversation so far (most recent last):
{history}

Candidate's cumulative answer to the current question:
\"\"\"{answer}\"\"\"

Nudges already given on this question: {nudges_so_far} (max allowed: 2)
Substantive follow-ups already asked on this primary question: {followups_so_far} (max allowed: 2)
Time remaining: {time_remaining_seconds}s

Return JSON in this exact shape:
{{
  "decision": "nudge" | "ask_followup" | "next_question" | "end_section",
  "next_text": "the line to speak (short nudge, real question, or closing remark)",
  "scores": {{"clarity": 0-10, "depth": 0-10, "correctness": 0-10, "communication": 0-10}},
  "rationale": "brief internal note"
}}"""


async def decide_next_turn(
    plan: list[dict],
    resume_summary: str,
    history: list[dict],
    answer: str,
    time_remaining_seconds: int,
    role: str = "",
    seniority: str | None = None,
    focus: str | None = None,
    industry: str | None = None,
    nudges_so_far: int = 0,
    followups_so_far: int = 0,
) -> dict:
    provider = get_llm_provider()
    history_text = "\n".join(
        f"[{h.get('role','?')}] {h.get('content','')}" for h in history[-12:]
    )
    fallback = {
        "decision": "next_question",
        "next_text": "Thanks for that. Let's move on to the next question.",
        "scores": {"clarity": 5, "depth": 5, "correctness": 5, "communication": 5},
        "rationale": "fallback (LLM unavailable or invalid)",
    }
    try:
        raw = await asyncio.wait_for(
            provider.chat(
                messages=[
                    {"role": "system", "content": FOLLOWUP_SYSTEM},
                    {
                        "role": "user",
                        "content": FOLLOWUP_USER_TEMPLATE.format(
                            role=role,
                            seniority_label=_seniority_label(seniority),
                            focus_label=_focus_label(focus),
                            industry_clause=_industry_clause(industry),
                            plan_json=json.dumps(plan, ensure_ascii=False)[:4000],
                            resume_summary=_sanitize_resume_text(resume_summary, max_chars=2000),
                            history=history_text[:6000],
                            answer=answer[:4000],
                            nudges_so_far=nudges_so_far,
                            followups_so_far=followups_so_far,
                            time_remaining_seconds=time_remaining_seconds,
                        ),
                    },
                ],
                response_format=JSON_RESPONSE,
                temperature=0.5,
            ),
            timeout=LLM_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        log.warning("LLM call timed out after %ss — using fallback", LLM_TIMEOUT_SECONDS)
        data = fallback
    except Exception as e:  # network / auth / provider error
        log.exception("LLM call failed (%s) — using fallback", e)
        data = fallback
    else:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            log.warning("LLM returned non-JSON: %r — using fallback", raw[:200])
            data = fallback
    decision = data.get("decision", "next_question")
    if decision not in ("nudge", "ask_followup", "next_question", "end_section"):
        decision = "next_question"
    scores = data.get("scores") or {}
    clamped = {
        k: max(0, min(10, int(scores.get(k, 5))))
        for k in ("clarity", "depth", "correctness", "communication")
    }
    return {
        "decision": decision,
        "next_text": data.get("next_text") or "",
        "scores": clamped,
        "rationale": data.get("rationale") or "",
    }
