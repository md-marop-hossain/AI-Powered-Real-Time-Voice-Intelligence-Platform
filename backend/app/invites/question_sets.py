"""Builders for the three question-source modes. Each returns a list of
question dicts in the same shape as `agent.generate_question_plan` so the
existing interview flow can consume them unchanged."""

from __future__ import annotations

import json
import logging

from app.core.llm_provider import JSON_RESPONSE, get_llm_provider
from app.interviews.agent import (
    INITIAL_QUESTIONS_SYSTEM,
    _focus_label,
    _industry_clause,
    _seniority_label,
)

log = logging.getLogger(__name__)


def build_predefined(questions: list[str]) -> list[dict]:
    """Wrap creator-supplied questions in the agent plan shape."""
    return [
        {"index": i + 1, "section": "custom", "question": q.strip()}
        for i, q in enumerate(questions)
        if q and q.strip()
    ]


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
            {"role": "system", "content": INITIAL_QUESTIONS_SYSTEM},
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
        return json.loads(raw).get("questions", [])
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
        return json.loads(raw).get("questions", [])
    except json.JSONDecodeError:
        log.warning("jd_based: non-JSON LLM output: %s", raw[:200])
        return []
