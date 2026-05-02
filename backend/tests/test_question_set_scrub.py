"""Tests for the placeholder-scrubber that protects invite question sets
from leaked LLM template tokens like `[Company Name]`.
"""

from __future__ import annotations

from app.invites.question_sets import (
    _scrub_questions,
    _strip_placeholders,
    build_predefined,
)


def test_strip_placeholders_replaces_bracket_token():
    out = _strip_placeholders("Tell me about [Company Name] and your role.")
    assert "[" not in out
    assert "]" not in out
    assert "one you've used" in out


def test_strip_placeholders_collapses_double_spaces():
    out = _strip_placeholders("What is [X]  really like?")
    assert "  " not in out


def test_strip_placeholders_passthrough_for_clean_text():
    text = "Walk me through a recent project you owned end-to-end."
    assert _strip_placeholders(text) == text


def test_strip_placeholders_handles_empty():
    assert _strip_placeholders("") == ""
    assert _strip_placeholders(None) is None  # type: ignore[arg-type]


def test_scrub_questions_drops_empty_entries():
    qs = [
        {"index": 1, "question": "  "},
        {"index": 2, "question": "Tell me about [Project]."},
        {"index": 3, "question": ""},
    ]
    out = _scrub_questions(qs)
    assert len(out) == 1
    assert out[0]["index"] == 2
    assert "[" not in out[0]["question"]


def test_scrub_questions_preserves_extra_fields():
    qs = [{"index": 5, "section": "technical", "question": "Why vectors?"}]
    out = _scrub_questions(qs)
    assert out[0]["section"] == "technical"
    assert out[0]["index"] == 5


def test_build_predefined_indexes_from_one():
    out = build_predefined(["What is X?", "How do you Y?"])
    assert out[0]["index"] == 1
    assert out[1]["index"] == 2
    assert out[0]["section"] == "custom"


def test_build_predefined_skips_blank_inputs():
    out = build_predefined(["A?", "  ", "", "B?"])
    assert [q["question"] for q in out] == ["A?", "B?"]
