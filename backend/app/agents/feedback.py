"""FeedbackAgent — post-session narrative synthesis.

Runs only inside _generate_report_background (never on the live interview path).
Produces a coaching narrative from the full session's scored turns + skill graph.
"""

from __future__ import annotations

import asyncio
import json
import structlog

from app.agents.base import FeedbackNarrative, LLM_TIMEOUT_SECONDS, SkillGraph
from app.core.llm_provider import JSON_RESPONSE, get_llm_provider

log = structlog.get_logger()

FEEDBACK_SYSTEM = """You are an expert interview coach writing post-session feedback for a candidate. Your tone is encouraging, constructive, and specific. Avoid generic platitudes.

Given the session data, produce:
- executive_summary: 2-3 sentences summarising overall performance
- strong_skills: list of 2-4 skills the candidate showed strength in (plain English, e.g. "System design trade-off reasoning")
- weak_skills: list of 2-4 specific areas needing improvement
- recommendations: list of 3-5 concrete, actionable steps the candidate can take to improve before the next interview

Output format (JSON only):
{
  "executive_summary": "...",
  "strong_skills": ["...", ...],
  "weak_skills": ["...", ...],
  "recommendations": ["...", ...]
}
"""

FEEDBACK_USER_TEMPLATE = """Role: {role}
Seniority: {seniority}
Overall score: {overall_score}/10

Dimension averages:
{dimension_block}

Skill coverage (skill: average score):
{skill_coverage_block}

Per-turn rationales (capped to 8 turns):
{rationale_block}

Weak areas flagged at session start (from prior sessions):
{weak_areas}

Write coaching feedback for this candidate."""


async def synthesize_feedback(
    session,
    turns: list,
    skill_graph: SkillGraph | None,
    dimension_averages: dict[str, float],
) -> FeedbackNarrative:
    """Generate a coaching narrative. Returns empty FeedbackNarrative on any failure."""
    try:
        return await _synthesize(session, turns, skill_graph, dimension_averages)
    except Exception as exc:
        log.warning("FeedbackAgent failed for session %s: %s", session.id, exc)
        return FeedbackNarrative()


async def _synthesize(
    session,
    turns: list,
    skill_graph: SkillGraph | None,
    dimension_averages: dict[str, float],
) -> FeedbackNarrative:
    # ── Skill coverage summary (Python, no LLM) ────────────────────────────────
    skill_coverage: dict[str, float] = {}
    if skill_graph:
        for skill in skill_graph.skills:
            scores_for_skill = []
            for t in turns:
                if not t.skill_tags or not t.scores:
                    continue
                if skill.id in (t.skill_tags or []):
                    td = t.scores.get("technical_depth", 5.0)
                    ps = t.scores.get("problem_solving", 5.0)
                    scores_for_skill.append((td + ps) / 2.0)
            if scores_for_skill:
                skill_coverage[skill.name] = round(
                    sum(scores_for_skill) / len(scores_for_skill), 1
                )

    # ── Build prompt blocks ────────────────────────────────────────────────────
    dim_block = "\n".join(
        f"  {dim}: {val}" for dim, val in dimension_averages.items()
    ) or "  (no scores)"

    skill_cov_block = (
        "\n".join(f"  {name}: {score}" for name, score in skill_coverage.items())
        or "  (no skill data)"
    )

    rationale_lines = []
    for i, t in enumerate(turns[:8]):
        if t.rationale:
            rationale_lines.append(f"  Q{t.index}: {t.rationale[:300]}")
    rationale_block = "\n".join(rationale_lines) or "  (no rationales)"

    # Research hints stored in questions_plan
    plan_payload = session.questions_plan or {}
    research = plan_payload.get("research_hints", {})
    weak_areas_text = ", ".join(research.get("weak_areas", [])) or "none"

    overall = session.final_scores.get("overall_score", 0.0) if session.final_scores else 0.0

    user_msg = FEEDBACK_USER_TEMPLATE.format(
        role=session.role or "the role",
        seniority=session.seniority or "mid",
        overall_score=overall,
        dimension_block=dim_block,
        skill_coverage_block=skill_cov_block,
        rationale_block=rationale_block,
        weak_areas=weak_areas_text,
    )

    llm = get_llm_provider()
    raw = await asyncio.wait_for(
        llm.chat(
            messages=[
                {"role": "system", "content": FEEDBACK_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            response_format=JSON_RESPONSE,
            temperature=0.5,
        ),
        timeout=LLM_TIMEOUT_SECONDS,
    )
    data = json.loads(raw)

    return FeedbackNarrative(
        executive_summary=str(data.get("executive_summary") or ""),
        strong_skills=[str(s) for s in (data.get("strong_skills") or [])[:6]],
        weak_skills=[str(s) for s in (data.get("weak_skills") or [])[:6]],
        recommendations=[str(r) for r in (data.get("recommendations") or [])[:6]],
    )
