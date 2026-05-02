"""Tests for EvaluatorAgent deterministic helpers."""

from __future__ import annotations

import pytest

from app.agents.evaluator import _compute_confidence, _compute_keyword_coverage
from app.agents.base import SkillGraph, SkillNode


def _make_graph(*skills) -> SkillGraph:
    """Build a minimal SkillGraph for testing."""
    nodes = [
        SkillNode(id=f"skill:{s}", name=s.title(), weight=1.0 / len(skills), keywords=[s])
        for s in skills
    ]
    return SkillGraph(role="test", skills=nodes)


# ── _compute_confidence ────────────────────────────────────────────────────────

def test_confidence_all_fillers():
    answer = "uh um hmm uh um uh"
    score = _compute_confidence(answer)
    assert score < 3.0


def test_confidence_clean_medium():
    answer = " ".join(["word"] * 50)
    score = _compute_confidence(answer)
    assert score > 7.0


def test_confidence_empty():
    score = _compute_confidence("")
    assert score == 3.0


def test_confidence_clamped_bounds():
    score = _compute_confidence("uh")
    assert 0.0 <= score <= 10.0

    score = _compute_confidence(" ".join(["great"] * 100))
    assert 0.0 <= score <= 10.0


# ── _compute_keyword_coverage ──────────────────────────────────────────────────

def test_keyword_coverage_no_graph():
    score, matched = _compute_keyword_coverage("anything here", None)
    assert score == 5.0
    assert matched == []


def test_keyword_coverage_exact_match():
    graph = _make_graph("caching", "api_design")
    answer = "I used redis cache ttl to speed things up"
    # "caching" keyword not in answer (we used "cache", not "caching")
    # Let's use a graph where "cache" is a keyword
    node = SkillNode(id="skill:caching", name="Caching", weight=0.5,
                     keywords=["redis", "cache", "ttl"])
    graph = SkillGraph(role="test", skills=[node])
    score, matched = _compute_keyword_coverage(answer, graph)
    assert "skill:caching" in matched
    assert score > 0.0


def test_keyword_coverage_all_matched():
    graph = _make_graph("python", "django")
    answer = "I built apis with python and django frameworks"
    score, matched = _compute_keyword_coverage(answer, graph)
    assert score == 10.0
    assert len(matched) == 2


def test_keyword_coverage_none_matched():
    graph = _make_graph("kubernetes", "terraform")
    answer = "I worked on frontend react components"
    score, matched = _compute_keyword_coverage(answer, graph)
    assert score == 0.0
    assert matched == []


def test_keyword_coverage_partial():
    graph = _make_graph("python", "django", "postgres")
    answer = "I used python to build scripts"
    score, matched = _compute_keyword_coverage(answer, graph)
    assert 0.0 < score < 10.0
    assert "skill:python" in matched
    assert len(matched) == 1
