"""LLM interview agent: generates initial questions and decides follow-ups
based on the conversation so far.

The plan and follow-up prompts are tailored by:
  - role: free-text title the candidate is rehearsing for
  - seniority: fresher | junior | mid | senior | staff | manager
  - focus: mixed | technical | behavioral | system_design
  - industry: optional free-text industry context
"""

from __future__ import annotations

import json
import logging

from app.core.llm_provider import JSON_RESPONSE, get_llm_provider

log = logging.getLogger(__name__)


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
    "Always reference concrete details from the resume (companies, projects, skills) where possible. "
    "Do NOT invent experience the resume does not contain."
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
                    resume_json=json.dumps(parsed_resume or {}, ensure_ascii=False)[:8000],
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
    "You are a real-time interview agent. Given the interview plan, the conversation "
    "history, the candidate's seniority + focus, and their latest answer, decide whether to:\n"
    "- ask_followup: probe deeper on the same question\n"
    "- next_question: move to the next planned question\n"
    "- end_section: close the interview if all key questions are covered or time is short\n\n"
    "Calibrate scoring to the seniority level (a 'mid' score for a senior is harsher than for a junior).\n"
    "Score on four dimensions (0-10):\n"
    "- clarity: how clearly they communicated\n"
    "- depth: how thoroughly they explored the topic\n"
    "- correctness: factual / technical accuracy\n"
    "- communication: pacing, structure, professionalism\n\n"
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

Candidate's latest answer:
\"\"\"{answer}\"\"\"

Time remaining: {time_remaining_seconds}s

Return JSON in this exact shape:
{{
  "decision": "ask_followup" | "next_question" | "end_section",
  "next_text": "the question to speak (or a brief closing remark if end_section)",
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
) -> dict:
    provider = get_llm_provider()
    history_text = "\n".join(
        f"[{h.get('role','?')}] {h.get('content','')}" for h in history[-12:]
    )
    raw = await provider.chat(
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
                    resume_summary=resume_summary[:2000],
                    history=history_text[:6000],
                    answer=answer[:4000],
                    time_remaining_seconds=time_remaining_seconds,
                ),
            },
        ],
        response_format=JSON_RESPONSE,
        temperature=0.5,
    )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {
            "decision": "next_question",
            "next_text": "Thanks. Let's move to the next question.",
            "scores": {"clarity": 5, "depth": 5, "correctness": 5, "communication": 5},
            "rationale": "fallback (LLM JSON parse failed)",
        }
    decision = data.get("decision", "next_question")
    if decision not in ("ask_followup", "next_question", "end_section"):
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
