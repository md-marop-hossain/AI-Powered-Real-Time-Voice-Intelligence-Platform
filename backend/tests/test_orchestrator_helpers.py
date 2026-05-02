"""Tests for orchestrator helper functions — stop-intent detection and the
short-answer guard. These live at the module level and have no I/O, so we
can exercise them without spinning up a session.
"""

from __future__ import annotations

import pytest

from app.interviews.orchestrator import (
    FOCUS_VIOLATION_LIMIT,
    FOLLOWUP_CAP,
    MIN_ANSWER_WORDS,
    NUDGE_CAP,
    _meaningful_word_count,
    _wants_to_stop_interview,
)


# ---------- Stop-intent detection ----------


@pytest.mark.parametrize(
    "phrase",
    [
        "Stop the interview please",
        "I want to stop the interview",
        "Can you please end the session",
        "I need to quit the interview",
        "Please end the interview now",
        "I give up",
        "End the session",
        "Can we stop now",
        "I want to leave",
    ],
)
def test_stop_intent_detected_for_explicit_phrases(phrase: str):
    assert _wants_to_stop_interview(phrase)


@pytest.mark.parametrize(
    "phrase",
    [
        "I'm done with this answer",
        "That's all I have for that question",
        "Stop me if I'm rambling",
        "I think the design is finished",
        "Move on to the next one",
        "",
        "Yeah, sure.",
    ],
)
def test_stop_intent_does_not_trigger_on_innocent_phrases(phrase: str):
    assert not _wants_to_stop_interview(phrase)


def test_stop_intent_handles_none_input():
    assert _wants_to_stop_interview(None) is False  # type: ignore[arg-type]


# ---------- Short-answer guard ----------


def test_meaningful_word_count_strips_fillers():
    # "uh um yeah ok" are all fillers — count should be 0
    assert _meaningful_word_count("uh um yeah ok") == 0


def test_meaningful_word_count_keeps_real_words():
    assert _meaningful_word_count("I built a streaming pipeline") == 5


def test_meaningful_word_count_mixed_input():
    # "uh I built a thing yeah" → 4 meaningful (i, built, a, thing)
    assert _meaningful_word_count("uh I built a thing yeah") == 4


def test_meaningful_word_count_empty():
    assert _meaningful_word_count("") == 0
    assert _meaningful_word_count("   ") == 0


def test_meaningful_word_count_handles_punctuation():
    assert _meaningful_word_count("first, second; third!") == 3


# ---------- Configured caps ----------


def test_caps_have_sane_values():
    """Sanity check — these are documented contracts the agent prompt depends on.

    If anyone bumps them silently, the prompt's wording about 'max 2 nudges'
    / 'max 2 follow-ups' would lie to the LLM.
    """
    assert NUDGE_CAP == 2
    assert FOLLOWUP_CAP == 2
    assert FOCUS_VIOLATION_LIMIT == 3
    assert MIN_ANSWER_WORDS == 5
