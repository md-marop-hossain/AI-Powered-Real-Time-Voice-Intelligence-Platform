"""Builders for the three question-source modes. Each returns a list of
question dicts in the same shape as `agent.generate_question_plan` so the
existing interview flow can consume them unchanged."""

from __future__ import annotations

import json
import logging
import re

from app.core.llm_provider import JSON_RESPONSE, get_llm_provider
from app.interviews.agent import (
    _focus_label,
    _industry_clause,
    _seniority_label,
)

log = logging.getLogger(__name__)


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


# Dedicated system prompt for AI-generated invite plans. The agent.py prompt
# assumes a parsed resume is provided; in invite mode it is NOT, so reusing it
# made the LLM emit placeholders like "[Company Name]" or "[Programming
# Language]" to fill the gap. This prompt is explicit that no resume exists
# and forbids bracketed placeholders.
_AI_INVITE_SYSTEM = (
    "You are a senior technical interviewer designing a mock interview from "
    "ONLY the role, seniority, focus area, industry, duration, and any extra "
    "instructions from the creator. NO RESUME IS PROVIDED — do not reference "
    "specific companies, projects, programming languages, or skills the "
    "candidate hasn't supplied. Produce 6-10 well-scoped primary questions "
    "sized to the seniority and matched to the focus area. Honour the "
    "creator's extra instructions strictly when present.\n\n"
    "HARD RULES — VIOLATING THESE IS A FAILURE:\n"
    "1. Output finished, candidate-ready questions ONLY. NEVER use bracketed "
    "placeholder tokens such as [Company Name], [Programming Language], "
    "[Project Name], [Alternative Language], [X], [Skill], etc. If you would "
    "be tempted to insert a placeholder, ask the question generically "
    "instead. Example: 'Walk me through a recent project where you owned "
    "the design end-to-end' — NOT 'Tell me about [Project Name]'.\n"
    "2. NEVER claim to have read the candidate's resume. Phrases like "
    "\"I see you've worked at\", \"You've listed\", \"I noticed in your "
    "resume\" are forbidden — there is no resume.\n"
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
    "You are a senior technical interviewer designing an interview from a job "
    "description. Read the JD carefully, identify the top 6-10 skills, "
    "responsibilities, and leadership/scope expectations, then produce well-scoped "
    "primary questions that probe those areas. Tailor difficulty to the seniority "
    "implied or stated in the JD. Avoid trivia; favour applied, scenario-based "
    "questions a strong candidate could discuss for several minutes."
)

_JD_USER_TEMPLATE = """Target role: {role}
Seniority: {seniority_label}
Focus: {focus_label}
{industry_clause}
Duration: {duration_minutes} minutes

Job description:
\"\"\"{jd}\"\"\"

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
