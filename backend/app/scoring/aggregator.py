"""Aggregate per-turn scores into a final session score."""

from __future__ import annotations

from typing import Iterable

from app.models.turn import Turn

DIMENSIONS = ("clarity", "depth", "correctness", "communication")


def aggregate_session_scores(turns: Iterable[Turn]) -> dict:
    sums = {d: 0.0 for d in DIMENSIONS}
    counts = {d: 0 for d in DIMENSIONS}
    for t in turns:
        if not t.scores:
            continue
        for d in DIMENSIONS:
            v = t.scores.get(d)
            if v is None:
                continue
            sums[d] += float(v)
            counts[d] += 1
    averages = {
        d: round(sums[d] / counts[d], 2) if counts[d] else 0.0 for d in DIMENSIONS
    }
    overall = round(sum(averages.values()) / len(DIMENSIONS), 2) if averages else 0.0
    return {
        "overall_score": overall,
        "dimension_averages": averages,
        "turn_count": sum(1 for _ in turns) if not isinstance(turns, list) else len(turns),
    }
