"""Tests for the v1/v2 schema-aware aggregator."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.scoring.aggregator import aggregate_session_scores
from app.agents.base import LLM_DIMENSIONS, DET_DIMENSIONS


def _turn(scores: dict | None) -> object:
    """Minimal Turn-like object for testing."""
    return SimpleNamespace(scores=scores)


V1_SCORES = {"clarity": 6.0, "depth": 7.0, "correctness": 8.0, "communication": 5.0}
V2_SCORES = {
    "technical_depth": 8.0,
    "problem_solving": 7.0,
    "communication": 9.0,
    "structure": 6.0,
    "consistency": 7.0,
    "confidence": 6.0,
    "keyword_coverage": 4.0,
}


def test_v1_unchanged():
    turns = [_turn(V1_SCORES)]
    result = aggregate_session_scores(turns)
    assert result["schema_version"] == "v1"
    assert result["overall_score"] == pytest.approx(26.0 / 4, abs=0.01)
    assert set(result["dimension_averages"]) == {"clarity", "depth", "correctness", "communication"}


def test_v2_basic():
    turns = [_turn(V2_SCORES)]
    result = aggregate_session_scores(turns)
    assert result["schema_version"] == "v2"
    assert set(result["dimension_averages"]) == set(
        list(LLM_DIMENSIONS) + list(DET_DIMENSIONS)
    )


def test_v2_weighted_math():
    turns = [_turn(V2_SCORES)]
    result = aggregate_session_scores(turns)
    # LLM dims: technical_depth(8) + problem_solving(7) + communication(9) + structure(6) + consistency(7) = 37/5 = 7.4
    llm_avg = (8.0 + 7.0 + 9.0 + 6.0 + 7.0) / 5
    # DET dims: confidence(6) + keyword_coverage(4) = 10/2 = 5.0
    det_avg = (6.0 + 4.0) / 2
    expected = round(llm_avg * 0.8 + det_avg * 0.2, 2)
    assert result["overall_score"] == pytest.approx(expected, abs=0.01)


def test_empty_turns():
    result = aggregate_session_scores([])
    assert result["overall_score"] == 0.0
    assert result["dimension_averages"] == {}
    assert result["turn_count"] == 0


def test_mixed_schema():
    """v1 turns in a v2 session are skipped; overall uses only v2 turns."""
    turns = [_turn(V1_SCORES), _turn(V2_SCORES)]
    result = aggregate_session_scores(turns)
    assert result["schema_version"] == "v2"
    # dimension averages should only reflect the V2 turn
    assert result["dimension_averages"]["technical_depth"] == pytest.approx(8.0)
