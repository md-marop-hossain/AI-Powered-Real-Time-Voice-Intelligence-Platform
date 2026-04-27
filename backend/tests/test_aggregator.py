from types import SimpleNamespace

from app.scoring.aggregator import aggregate_session_scores


def test_aggregate_basic():
    turns = [
        SimpleNamespace(scores={"clarity": 8, "depth": 7, "correctness": 9, "communication": 8}),
        SimpleNamespace(scores={"clarity": 6, "depth": 5, "correctness": 7, "communication": 7}),
    ]
    out = aggregate_session_scores(turns)
    assert out["dimension_averages"]["clarity"] == 7.0
    assert out["dimension_averages"]["depth"] == 6.0
    assert 0 <= out["overall_score"] <= 10


def test_aggregate_empty():
    out = aggregate_session_scores([])
    assert out["overall_score"] == 0.0
