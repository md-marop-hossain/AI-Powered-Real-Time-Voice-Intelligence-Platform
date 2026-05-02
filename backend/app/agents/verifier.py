"""VerifierAgent — async second-pass score validation (fire-and-forget).

Runs after the candidate hears the next question, so it never adds latency
to the live interview. Opens its own DB session (pattern from _save_turn_audio)
and writes Turn.verified_scores + Turn.verifier_flags.
"""

from __future__ import annotations

import asyncio
import json
import structlog
from uuid import UUID

from sqlalchemy import update

from app.agents.base import LLM_TIMEOUT_SECONDS, NEW_DIMENSIONS, VerifierResult
from app.core.llm_provider import JSON_RESPONSE, get_llm_provider

log = structlog.get_logger()

VERIFIER_SYSTEM = """You are an independent interview evaluator performing a quality-check on scores assigned by a peer evaluator.

You will receive the original question, the candidate's answer, and the peer's scores. Re-score the five LLM-evaluated dimensions independently (technical_depth, problem_solving, communication, structure, consistency). Do NOT receive or re-score confidence or keyword_coverage (those are deterministic).

Be calibrated and fair. If you agree with a score, reproduce it. If you believe a score is too high or too low by more than 1.5 points, assign your own value.

Output format (JSON only):
{
  "technical_depth": <int 0-10>,
  "problem_solving": <int 0-10>,
  "communication": <int 0-10>,
  "structure": <int 0-10>,
  "consistency": <int 0-10>
}

No extra keys, no text outside the JSON object.
"""

VERIFIER_USER_TEMPLATE = """Role: {role}
Seniority: {seniority}

Question: {question}

Candidate answer: {answer}

Peer evaluator scores:
- technical_depth: {td}
- problem_solving: {ps}
- communication: {comm}
- structure: {struct}
- consistency: {consist}

Re-evaluate independently."""


async def verify_scores(
    question: str,
    answer: str,
    original_scores: dict[str, float],
    role: str,
    seniority: str | None,
    turn_id: UUID,
) -> None:
    """Second-pass LLM score check. Writes to DB; never raises."""
    from app.core.database import AsyncSessionLocal
    from app.models.turn import Turn

    _LLM_DIMS = ("technical_depth", "problem_solving", "communication", "structure", "consistency")

    user_msg = VERIFIER_USER_TEMPLATE.format(
        role=role or "the role",
        seniority=seniority or "mid",
        question=question[:1000],
        answer=(answer or "")[:3000],
        td=original_scores.get("technical_depth", 5),
        ps=original_scores.get("problem_solving", 5),
        comm=original_scores.get("communication", 5),
        struct=original_scores.get("structure", 5),
        consist=original_scores.get("consistency", 5),
    )

    try:
        llm = get_llm_provider()
        raw = await asyncio.wait_for(
            llm.chat(
                messages=[
                    {"role": "system", "content": VERIFIER_SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
                response_format=JSON_RESPONSE,
                temperature=0.2,
            ),
            timeout=LLM_TIMEOUT_SECONDS,
        )
        data = json.loads(raw)
    except Exception as exc:
        log.warning("VerifierAgent LLM call failed for turn %s: %s", turn_id, exc)
        return

    verified: dict[str, float] = {}
    flags: list[str] = []
    for dim in _LLM_DIMS:
        raw_val = data.get(dim)
        try:
            v = float(raw_val) if raw_val is not None else original_scores.get(dim, 5.0)
        except (TypeError, ValueError):
            v = original_scores.get(dim, 5.0)
        v = round(max(0.0, min(10.0, v)), 1)
        verified[dim] = v
        orig = original_scores.get(dim, 5.0)
        if abs(orig - v) > 1.5:
            flags.append(dim)

    # Carry deterministic dimensions forward unchanged
    for dim in ("confidence", "keyword_coverage"):
        if dim in original_scores:
            verified[dim] = original_scores[dim]

    try:
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(Turn)
                .where(Turn.id == turn_id)
                .values(verified_scores=verified, verifier_flags=flags or None)
            )
            await db.commit()
    except Exception as exc:
        log.warning("VerifierAgent DB write failed for turn %s: %s", turn_id, exc)
