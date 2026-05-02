"""PlannerAgent — question plan generation with research-hint augmentation.

Wraps the existing generate_question_plan() from agent.py and injects
ResearchAgent output as a priority weighting clause when available.
Falls back to the bare generate_question_plan() on any error.
"""

from __future__ import annotations

import structlog

from app.agents.base import ResearchHints, SkillGraph
from app.interviews.agent import generate_question_plan

log = structlog.get_logger()


async def plan_session(
    role: str,
    duration_minutes: int,
    parsed_resume: dict | None,
    seniority: str | None,
    focus: str | None,
    industry: str | None,
    skill_graph: SkillGraph | None,
    research_hints: ResearchHints | None,
) -> list[dict]:
    """Generate an interview question plan, optionally weighted by research hints.

    Returns a list of question dicts in the standard plan shape:
      [{"index": 1, "section": "...", "question": "..."}, ...]

    Falls back to generate_question_plan() with no augmentation on any error.
    """
    try:
        return await _plan_session(
            role, duration_minutes, parsed_resume, seniority, focus, industry,
            skill_graph, research_hints,
        )
    except Exception as exc:
        log.warning("PlannerAgent failed: %s — falling back to base plan", exc)
        return await generate_question_plan(
            role=role,
            duration_minutes=duration_minutes,
            parsed_resume=parsed_resume,
            seniority=seniority,
            focus=focus,
            industry=industry,
        )


async def _plan_session(
    role: str,
    duration_minutes: int,
    parsed_resume: dict | None,
    seniority: str | None,
    focus: str | None,
    industry: str | None,
    skill_graph: SkillGraph | None,
    research_hints: ResearchHints | None,
) -> list[dict]:
    # Build the hint clause to append to the user prompt via extra_context
    hint_clause = ""
    if research_hints and research_hints.weak_areas:
        areas = ", ".join(research_hints.weak_areas[:4])
        hint_clause = (
            f"\n\nPriority probe areas identified from the candidate's past sessions: {areas}. "
            "Weight 2-3 questions toward these topics if they are relevant to the role."
        )
        if research_hints.cross_session_note:
            hint_clause += f" Context: {research_hints.cross_session_note}"

    return await generate_question_plan(
        role=role,
        duration_minutes=duration_minutes,
        parsed_resume=parsed_resume,
        seniority=seniority,
        focus=focus,
        industry=industry,
        extra_context=hint_clause,
    )
