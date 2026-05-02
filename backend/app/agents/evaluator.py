"""EvaluatorAgent — 7-dimensional per-turn answer scoring.

Five dimensions (technical_depth, problem_solving, communication, structure,
consistency) are scored by the LLM. Two (confidence, keyword_coverage) are
computed deterministically before the LLM call and passed in as fixed values
so the model does not need to judge word-counting or keyword presence.
"""

from __future__ import annotations

import asyncio
import json
import structlog

from app.agents.base import (
    EvalResult,
    LLM_TIMEOUT_SECONDS,
    NEW_DIMENSIONS,
    SkillGraph,
)
from app.core.llm_provider import JSON_RESPONSE, get_llm_provider

log = structlog.get_logger()

# Filler words — share the same set as orchestrator.py
_FILLER_WORDS = frozenset({
    "uh", "um", "ah", "er", "hmm", "mm",
    "yeah", "yep", "yes", "no", "ok", "okay",
})

# ── Prompts ────────────────────────────────────────────────────────────────────

EVALUATOR_SYSTEM = """You are a calibrated interview evaluator. Your job is to score a candidate's answer on five dimensions and identify which role-specific skills were demonstrated.

## Scoring dimensions (0-10 each)
- technical_depth: How technically accurate and substantive is the answer? Does it go beyond surface-level? (calibrated to the seniority level)
- problem_solving: Does the candidate show a structured, logical approach? Do they consider trade-offs and edge cases?
- communication: How clearly and concisely is the answer expressed? Is it well-organised and easy to follow?
- structure: Does the answer follow a clear framework (STAR, problem→solution→result, or equivalent)? Does it have a beginning, middle, and end?
- consistency: Does this answer build coherently on what the candidate has said before? Does it avoid contradicting prior answers?

## Calibration rules
- Score relative to the stated seniority. A 7 for a "senior" should reflect true senior-level depth. A 7 for a "fresher" reflects solid fundamentals for someone new to the field.
- An answer that doesn't address the question at all scores 1-3 on technical_depth and problem_solving regardless of how well-spoken it is.
- Communication and structure are independent of correctness — a candidate can articulate a wrong answer clearly.
- Consistency of 10 = perfectly builds on prior context; 5 = no connection; 1 = actively contradicts prior answers.

## Skill tagging
From the skill graph IDs listed in the user message, identify which skills this answer demonstrates. Only include IDs where the answer clearly touches on that skill — do not force a match.

## Output format (JSON only)
{
  "technical_depth": <int 0-10>,
  "problem_solving": <int 0-10>,
  "communication": <int 0-10>,
  "structure": <int 0-10>,
  "consistency": <int 0-10>,
  "rationale": "<2-3 sentences explaining the scores and highlighting the main strength and weakness>",
  "skill_tags": ["<skill_id>", ...]
}

Do not output any text outside the JSON object. Do not include confidence or keyword_coverage in your output (those are pre-computed).
"""

EVALUATOR_USER_TEMPLATE = """Role: {role}
Seniority: {seniority}
Current difficulty level: {difficulty}/10 (calibrate expectations accordingly)

Question asked:
{question}

Candidate's answer:
{answer}

Conversation history (for consistency scoring):
{history_excerpt}

Available skill IDs for tagging: {skill_ids}

Pre-computed scores (do NOT score these yourself — use them as context):
- confidence: {confidence}/10 (based on speech filler ratio and answer length)
- keyword_coverage: {keyword_coverage}/10 (technical keyword intersection with role's skill graph)

Now evaluate the five LLM dimensions and identify skill_tags."""


# ── Deterministic helpers ──────────────────────────────────────────────────────

def _compute_confidence(answer: str) -> float:
    """Confidence = (1 - filler_ratio) * weight + length_bonus * weight, clamped 0-10."""
    words = answer.lower().split()
    if not words:
        return 3.0
    filler_count = sum(1 for w in words if w.strip(".,!?;:") in _FILLER_WORDS)
    filler_ratio = filler_count / len(words)
    length_bonus = min(1.0, len(words) / 40)  # 40-word answer = full bonus
    raw = (1.0 - filler_ratio * 1.5) * 7.0 + length_bonus * 3.0
    return round(max(0.0, min(10.0, raw)), 1)


def _compute_keyword_coverage(
    answer: str, skill_graph: SkillGraph | None
) -> tuple[float, list[str]]:
    """Keyword coverage = fraction of skill nodes matched * 10, plus list of matched IDs."""
    if not skill_graph or not skill_graph.skills:
        return 5.0, []
    answer_lower = answer.lower()
    matched = [
        s.id
        for s in skill_graph.skills
        if any(kw in answer_lower for kw in s.keywords)
    ]
    coverage = len(matched) / len(skill_graph.skills)
    return round(min(10.0, coverage * 10.0), 1), matched


def _history_excerpt(history: list[dict], max_chars: int = 3000) -> str:
    """Last 8 history entries as a compact string for consistency scoring."""
    lines = []
    for msg in history[-8:]:
        role = msg.get("role", "")
        content = (msg.get("content") or "")[:400]
        lines.append(f"{role.upper()}: {content}")
    text = "\n".join(lines)
    return text[:max_chars]


# ── Main agent function ────────────────────────────────────────────────────────

async def evaluate_answer(
    question: str,
    answer: str,
    history: list[dict],
    role: str,
    seniority: str | None,
    focus: str | None,
    skill_graph: SkillGraph | None,
    current_difficulty: float,
) -> EvalResult:
    """Score a candidate answer across 7 dimensions.

    Returns EvalResult with all 7 NEW_DIMENSIONS populated. On any failure
    returns a neutral fallback (5.0 per dimension) so the interview continues.
    """
    # ── Deterministic scores (no LLM) ─────────────────────────────────────────
    confidence = _compute_confidence(answer)
    kw_score, matched_skill_ids = _compute_keyword_coverage(answer, skill_graph)

    skill_ids = [s.id for s in skill_graph.skills] if skill_graph else []
    history_text = _history_excerpt(history)

    user_msg = EVALUATOR_USER_TEMPLATE.format(
        role=role or "the role",
        seniority=seniority or "mid",
        difficulty=round(current_difficulty, 1),
        question=question[:1000],
        answer=answer[:3000],
        history_excerpt=history_text,
        skill_ids=", ".join(skill_ids) if skill_ids else "(none provided)",
        confidence=confidence,
        keyword_coverage=kw_score,
    )

    try:
        llm = get_llm_provider()
        raw = await asyncio.wait_for(
            llm.chat(
                messages=[
                    {"role": "system", "content": EVALUATOR_SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
                response_format=JSON_RESPONSE,
                temperature=0.3,
            ),
            timeout=LLM_TIMEOUT_SECONDS,
        )
        data = json.loads(raw)
    except Exception as exc:
        log.warning("EvaluatorAgent LLM call failed: %s — returning fallback scores", exc)
        data = {}

    # ── Build final scores dict ────────────────────────────────────────────────
    llm_dims = ("technical_depth", "problem_solving", "communication", "structure", "consistency")
    scores: dict[str, float] = {}
    for dim in llm_dims:
        raw_val = data.get(dim)
        try:
            scores[dim] = float(raw_val) if raw_val is not None else 5.0
        except (TypeError, ValueError):
            scores[dim] = 5.0
        scores[dim] = round(max(0.0, min(10.0, scores[dim])), 1)

    scores["confidence"] = confidence
    scores["keyword_coverage"] = kw_score

    # ── Skill tags — merge LLM tags + keyword-matched IDs ─────────────────────
    llm_tags: list[str] = []
    raw_tags = data.get("skill_tags")
    if isinstance(raw_tags, list):
        valid_ids = set(skill_ids)
        llm_tags = [t for t in raw_tags if isinstance(t, str) and t in valid_ids]

    all_tags = list(dict.fromkeys(matched_skill_ids + llm_tags))  # deduplicate, preserve order

    rationale = str(data.get("rationale", "")) or "Evaluated by EvaluatorAgent."

    return EvalResult(scores=scores, rationale=rationale, skill_tags=all_tags)
