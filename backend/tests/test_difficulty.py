"""Tests for the adaptive difficulty curve logic embedded in the orchestrator."""

from __future__ import annotations

import pytest


def _apply_difficulty(current: float, avg_score: float) -> float:
    """Mirror of the orchestrator difficulty-update formula."""
    if avg_score >= 7.0:
        new = min(10.0, current + 0.5)
    elif avg_score <= 4.0:
        new = max(1.0, current - 0.5)
    else:
        new = current
    return round(new, 1)


def test_difficulty_increases_on_high_score():
    result = _apply_difficulty(5.0, 8.0)
    assert result == 5.5


def test_difficulty_decreases_on_low_score():
    result = _apply_difficulty(5.0, 3.0)
    assert result == 4.5


def test_difficulty_clamps_max():
    result = _apply_difficulty(9.8, 9.0)
    assert result == 10.0


def test_difficulty_clamps_min():
    result = _apply_difficulty(1.2, 2.0)
    assert result == 1.0


def test_difficulty_stable_mid_score():
    result = _apply_difficulty(5.0, 5.5)
    assert result == 5.0


def test_difficulty_boundary_high():
    """Score exactly 7.0 should trigger an increase."""
    result = _apply_difficulty(6.0, 7.0)
    assert result == 6.5


def test_difficulty_boundary_low():
    """Score exactly 4.0 should trigger a decrease."""
    result = _apply_difficulty(6.0, 4.0)
    assert result == 5.5
