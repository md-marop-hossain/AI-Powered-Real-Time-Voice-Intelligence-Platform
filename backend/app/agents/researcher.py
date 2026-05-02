"""ResearchAgent — pre-session candidate analysis using cross-session memory.

Queries the candidate's past completed sessions (those with skill_coverage
populated by Phase 1) to identify historically weak skills, then asks the
LLM to produce targeted probe areas for the upcoming session.
"""

from __future__ import annotations

import asyncio
import json
import structlog
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import LLM_TIMEOUT_SECONDS, ResearchHints
from app.core.llm_provider import JSON_RESPONSE, get_llm_provider
from app.models.session import Session, SessionStatus

log = structlog.get_logger()

RESEARCHER_SYSTEM = """You are a preparation strategist for technical interviews. Given a candidate's resume summary and their historically weak skill areas (from past interview sessions), produce concise probe recommendations for the upcoming interview.

Output format (JSON only):
{
  "weak_areas": ["<short description of each weak area>", ...],
  "probe_topics": ["<specific topic to probe>", ...],
  "cross_session_note": "<1-2 sentence note for the interviewer about cross-session patterns>"
}

- weak_areas: 2-4 plain-English descriptions of areas the candidate should improve
- probe_topics: 2-4 specific, narrow topics to ask about in the upcoming session
- cross_session_note: a short, professional note summarising the cross-session pattern (empty string if no prior data)
- Keep all fields concise. Do not hallucinate skills not mentioned in the inputs.
"""

RESEARCHER_USER_TEMPLATE = """Candidate role target: {role}
Seniority: {seniority}

Resume summary:
{resume_summary}

Historically weak skills (skill IDs with average score < 5.0 across {n_sessions} prior session(s)):
{weak_skill_list}

Identify probe areas for the upcoming interview."""


async def research_candidate(
    user_id: UUID,
    parsed_resume: dict | None,
    role: str,
    seniority: str | None,
    db: AsyncSession,
    n_sessions: int = 3,
) -> ResearchHints:
    """Analyse past sessions and return probe hints. Returns empty hints on any failure."""
    try:
        return await _research_candidate(user_id, parsed_resume, role, seniority, db, n_sessions)
    except Exception as exc:
        log.warning("ResearchAgent failed for user %s: %s — returning empty hints", user_id, exc)
        return ResearchHints()


async def _research_candidate(
    user_id: UUID,
    parsed_resume: dict | None,
    role: str,
    seniority: str | None,
    db: AsyncSession,
    n_sessions: int,
) -> ResearchHints:
    # ── Pull recent completed sessions that have skill_coverage ───────────────
    result = await db.execute(
        select(Session)
        .where(
            Session.user_id == user_id,
            Session.status == SessionStatus.completed,
            Session.skill_coverage.isnot(None),
        )
        .order_by(Session.ended_at.desc())
        .limit(n_sessions)
    )
    past_sessions = result.scalars().all()

    if not past_sessions:
        return ResearchHints()

    # ── Aggregate skill scores across sessions ─────────────────────────────────
    skill_totals: dict[str, list[float]] = {}
    for sess in past_sessions:
        for skill_id, score in (sess.skill_coverage or {}).items():
            skill_totals.setdefault(skill_id, []).append(float(score))

    weak_skills = [
        skill_id
        for skill_id, scores in skill_totals.items()
        if (sum(scores) / len(scores)) < 5.0
    ]

    if not weak_skills:
        return ResearchHints()

    # ── Build resume summary for LLM ──────────────────────────────────────────
    resume_summary = ""
    if parsed_resume:
        parts = []
        for key in ("title", "summary", "skills", "experience"):
            val = parsed_resume.get(key)
            if val:
                parts.append(f"{key}: {json.dumps(val)[:500]}")
        resume_summary = "\n".join(parts)[:2000]

    user_msg = RESEARCHER_USER_TEMPLATE.format(
        role=role or "the role",
        seniority=seniority or "mid",
        resume_summary=resume_summary or "(no resume provided)",
        n_sessions=len(past_sessions),
        weak_skill_list=", ".join(weak_skills),
    )

    llm = get_llm_provider()
    raw = await asyncio.wait_for(
        llm.chat(
            messages=[
                {"role": "system", "content": RESEARCHER_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            response_format=JSON_RESPONSE,
            temperature=0.4,
        ),
        timeout=LLM_TIMEOUT_SECONDS,
    )
    data = json.loads(raw)

    return ResearchHints(
        weak_areas=[str(a) for a in (data.get("weak_areas") or [])[:4]],
        probe_topics=[str(t) for t in (data.get("probe_topics") or [])[:4]],
        cross_session_note=str(data.get("cross_session_note") or ""),
    )
