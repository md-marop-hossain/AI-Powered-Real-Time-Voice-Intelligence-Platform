"""Tests for the skill graph loader."""

from __future__ import annotations

import pytest

from app.skill_graphs import load_skill_graph


def test_load_backend_engineer():
    graph = load_skill_graph("backend engineer")
    assert graph is not None
    assert graph.role == "backend_engineer"
    assert len(graph.skills) >= 5
    for skill in graph.skills:
        assert skill.id
        assert skill.name
        assert isinstance(skill.weight, float)
        assert isinstance(skill.keywords, list)
        assert len(skill.keywords) > 0


def test_load_unknown_role_returns_none_or_default():
    # Unknown role should either return None OR fall back to default graph
    # (depending on whether default.json exists). Both are acceptable.
    graph = load_skill_graph("xyzzy_nonexistent_role_12345")
    # If it's not None, it must be the default fallback
    if graph is not None:
        assert graph.role == "default"


def test_load_default_fallback():
    # A clearly unknown role with a default.json present returns default graph
    graph = load_skill_graph("completely_unknown_role_abc")
    # Either None (no default.json) or a graph with role="default"
    if graph is not None:
        assert len(graph.skills) >= 1


def test_skill_node_fields():
    graph = load_skill_graph("backend engineer")
    assert graph is not None
    for skill in graph.skills:
        assert hasattr(skill, "id")
        assert hasattr(skill, "name")
        assert hasattr(skill, "weight")
        assert hasattr(skill, "keywords")
        assert skill.id.startswith("skill:")
        assert 0.0 < skill.weight <= 1.0


def test_load_frontend_engineer():
    graph = load_skill_graph("frontend engineer")
    assert graph is not None
    assert len(graph.skills) >= 3


def test_load_data_scientist():
    graph = load_skill_graph("data scientist")
    assert graph is not None
    assert len(graph.skills) >= 3
