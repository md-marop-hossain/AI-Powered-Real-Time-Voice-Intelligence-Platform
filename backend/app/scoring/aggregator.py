"""Aggregate per-turn scores into a final session score.

Supports two scoring schemas:
  v1 — original 4 dimensions: clarity, depth, correctness, communication
  v2 — Phase 1 7 dimensions: technical_depth, problem_solving, communication,
        structure, confidence, consistency, keyword_coverage

Schema version is detected by the presence of V2_MARKER ("technical_depth")
in any Turn.scores dict. Old sessions always hit the v1 path and produce
identical output to the pre-Phase-1 aggregator.
"""

from __future__ import annotations

from typing import Iterable

from app.agents.base import DET_DIMENSIONS, LLM_DIMENSIONS, NEW_DIMENSIONS, OLD_DIMENSIONS, V2_MARKER
from app.models.turn import Turn


def aggregate_session_scores(turns: Iterable[Turn]) -> dict:
    turns = list(turns)
    if not turns:
        return {"overall_score": 0.0, "dimension_averages": {}, "turn_count": 0}

    scored = [t for t in turns if t.scores]
    is_v2 = any(V2_MARKER in (t.scores or {}) for t in scored)

    if is_v2:
        dims = NEW_DIMENSIONS
        sums = {d: 0.0 for d in dims}
        counts = {d: 0 for d in dims}
        for t in scored:
            if V2_MARKER not in (t.scores or {}):
                continue  # skip v1 turns in a mixed session
            for d in dims:
                v = (t.scores or {}).get(d)
                if v is None:
                    continue
                sums[d] += float(v)
                counts[d] += 1

        averages = {
            d: round(sums[d] / counts[d], 2) if counts[d] else 0.0 for d in dims
        }

        # Weighted overall: LLM dims carry 80%, deterministic dims carry 20%
        llm_avg = (
            sum(averages[d] for d in LLM_DIMENSIONS) / len(LLM_DIMENSIONS)
            if LLM_DIMENSIONS else 0.0
        )
        det_avg = (
            sum(averages[d] for d in DET_DIMENSIONS) / len(DET_DIMENSIONS)
            if DET_DIMENSIONS else 0.0
        )
        overall = round(llm_avg * 0.8 + det_avg * 0.2, 2)
        schema_version = "v2"

    else:
        # v1 backward-compat path — identical logic to the original aggregator
        dims = OLD_DIMENSIONS
        sums = {d: 0.0 for d in dims}
        counts = {d: 0 for d in dims}
        for t in scored:
            for d in dims:
                v = (t.scores or {}).get(d)
                if v is None:
                    continue
                sums[d] += float(v)
                counts[d] += 1

        averages = {
            d: round(sums[d] / counts[d], 2) if counts[d] else 0.0 for d in dims
        }
        overall = round(sum(averages.values()) / len(dims), 2) if averages else 0.0
        schema_version = "v1"

    return {
        "overall_score": overall,
        "dimension_averages": averages,
        "turn_count": len(turns),
        "schema_version": schema_version,
    }
