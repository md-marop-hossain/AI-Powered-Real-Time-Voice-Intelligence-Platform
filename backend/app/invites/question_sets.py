"""Builders for the three question-source modes. Each returns a list of
question dicts in the same shape as `agent.generate_question_plan` so the
existing interview flow can consume them unchanged."""

from __future__ import annotations

import json
import structlog
import re

from app.core.llm_provider import JSON_RESPONSE, get_llm_provider
from app.interviews.agent import (
    MAX_RESUME_PROMPT_CHARS,
    _focus_label,
    _industry_clause,
    _sanitize_resume_obj,
    _seniority_label,
)

log = structlog.get_logger()


# Bracketed placeholder tokens like "[Company Name]" or "[Programming Language]"
# that LLMs sometimes leak into output when they expect resume context that
# isn't provided. We strip these post-hoc as a belt-and-braces guard on top of
# the system-prompt instructions.
_PLACEHOLDER_RE = re.compile(r"\[\s*[A-Z][^\]]{0,60}\]")


def _strip_placeholders(text: str) -> str:
    """Remove bracketed template tokens like [Company Name] from a question.

    Replaces each token with a generic phrase so the question stays grammatical
    even if the model leaked a placeholder despite instructions.
    """
    if not text:
        return text
    cleaned = _PLACEHOLDER_RE.sub("one you've used", text)
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def _scrub_questions(questions: list[dict]) -> list[dict]:
    out: list[dict] = []
    for q in questions or []:
        text = (q.get("question") or "").strip()
        if not text:
            continue
        scrubbed = _strip_placeholders(text)
        if not scrubbed:
            continue
        out.append({**q, "question": scrubbed})
    return out


def build_predefined(questions: list[str]) -> list[dict]:
    """Wrap creator-supplied questions in the agent plan shape."""
    return [
        {"index": i + 1, "section": "custom", "question": q.strip()}
        for i, q in enumerate(questions)
        if q and q.strip()
    ]


# Dedicated system prompt for AI-generated invite plans. A parsed résumé IS
# supplied (the creator uploads it at invite-creation time), so the prompt
# leans into it for personalisation while still forbidding bracketed
# placeholders if specific details are missing.
_AI_INVITE_SYSTEM = (
    "You are a senior technical interviewer designing a personalised mock "
    "interview. You are given the role, seniority, focus area, industry, "
    "duration, optional creator instructions, AND the candidate's parsed "
    "résumé (provided as JSON). Use the résumé to ground questions in the "
    "candidate's real companies, projects, and stack — but do NOT invent "
    "experience the résumé does not contain. Produce 6-10 well-scoped "
    "primary questions sized to the seniority and matched to the focus "
    "area. Honour the creator's extra instructions strictly when present.\n\n"
    "HARD RULES — VIOLATING THESE IS A FAILURE:\n"
    "1. Output finished, candidate-ready questions ONLY. NEVER use bracketed "
    "placeholder tokens such as [Company Name], [Programming Language], "
    "[Project Name], [Alternative Language], [X], [Skill], etc. If a "
    "specific detail isn't in the résumé, ask the question generically "
    "(e.g. 'a recent project where you owned the design') instead of "
    "inserting a placeholder.\n"
    "2. Reference the résumé naturally where it helps — companies, "
    "projects, technologies the candidate has actually used. Don't "
    "fabricate or extrapolate beyond what the JSON contains.\n"
    "3. Tailor difficulty to the stated seniority and the question mix to "
    "the stated focus.\n"
    "4. Honour the creator's extra instructions verbatim where they conflict "
    "with your own preferences."
)


_AI_USER_TEMPLATE = """Target role: {role}
Seniority: {seniority_label}
Focus: {focus_label}
{industry_clause}
Duration: {duration_minutes} minutes

Additional creator instructions (may be empty):
{instructions}

Parsed résumé (JSON):
{resume_json}

Return JSON exactly in this shape:
{{
  "questions": [
    {{"index": 1, "section": "intro|experience|technical|behavioral|system_design|closing",
      "question": "..."}}
  ]
}}"""


async def build_ai_generated(
    *,
    role: str,
    seniority: str | None,
    focus: str | None,
    industry: str | None,
    duration_minutes: int,
    parsed_resume: dict,
    instructions: str | None = None,
) -> list[dict]:
    provider = get_llm_provider()
    raw = await provider.chat(
        messages=[
            {"role": "system", "content": _AI_INVITE_SYSTEM},
            {
                "role": "user",
                "content": _AI_USER_TEMPLATE.format(
                    role=role,
                    seniority_label=_seniority_label(seniority),
                    focus_label=_focus_label(focus),
                    industry_clause=_industry_clause(industry),
                    duration_minutes=duration_minutes,
                    instructions=(instructions or "").strip()[:2000] or "(none)",
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
        return _scrub_questions(json.loads(raw).get("questions", []))
    except json.JSONDecodeError:
        log.warning("ai_generated: non-JSON LLM output: %s", raw[:200])
        return []


_JD_SYSTEM = (
    "You are a senior technical interviewer designing an interview that "
    "matches a candidate's résumé to a specific job description. You receive "
    "BOTH the JD and the candidate's parsed résumé. Identify the top 6-10 "
    "skills, responsibilities, and leadership/scope expectations from the JD, "
    "then probe those areas through questions grounded in the candidate's "
    "actual experience where the résumé covers them — and through scenario "
    "questions where it doesn't. Surface gaps gently (don't grill on missing "
    "skills) but don't avoid them either. Tailor difficulty to the seniority "
    "implied or stated in the JD.\n\n"
    "HARD RULES:\n"
    "1. Output finished, candidate-ready questions ONLY. NEVER use bracketed "
    "placeholders like [Company Name] / [Project Name] / [X]. Ask "
    "generically when a specific detail isn't in the résumé.\n"
    "2. Reference the résumé naturally — companies, projects, tech stack — "
    "but never invent experience.\n"
    "3. Favour applied, scenario-based questions a strong candidate could "
    "discuss for several minutes. Avoid trivia."
)

_JD_USER_TEMPLATE = """Target role: {role}
Seniority: {seniority_label}
Focus: {focus_label}
{industry_clause}
Duration: {duration_minutes} minutes

Job description:
\"\"\"{jd}\"\"\"

Parsed résumé (JSON):
{resume_json}

Return JSON exactly in this shape:
{{
  "questions": [
    {{"index": 1, "section": "intro|experience|technical|behavioral|system_design|closing",
      "question": "..."}}
  ]
}}"""


async def build_jd_based(
    *,
    role: str,
    seniority: str | None,
    focus: str | None,
    industry: str | None,
    duration_minutes: int,
    job_description: str,
    parsed_resume: dict,
) -> list[dict]:
    provider = get_llm_provider()
    raw = await provider.chat(
        messages=[
            {"role": "system", "content": _JD_SYSTEM},
            {
                "role": "user",
                "content": _JD_USER_TEMPLATE.format(
                    role=role,
                    seniority_label=_seniority_label(seniority),
                    focus_label=_focus_label(focus),
                    industry_clause=_industry_clause(industry),
                    duration_minutes=duration_minutes,
                    jd=job_description.strip()[:8000],
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
        return _scrub_questions(json.loads(raw).get("questions", []))
    except json.JSONDecodeError:
        log.warning("jd_based: non-JSON LLM output: %s", raw[:200])
        return []
