"""Tests for the résumé prompt-injection sanitizer (Bug 8 fix).

Pure-unit tests — no DB, no network. Verifies that:
  - C0 / C1 control bytes are stripped
  - Unicode line/paragraph separators are stripped
  - Printable ASCII is preserved verbatim
  - Per-string and overall character caps are honoured
  - Nested dicts / lists are walked recursively
"""

from __future__ import annotations

from app.interviews.agent import (
    MAX_RESUME_FIELD_CHARS,
    MAX_RESUME_PROMPT_CHARS,
    _sanitize_resume_obj,
    _sanitize_resume_text,
)


def test_sanitize_strips_c0_control_bytes():
    s = "hello" + chr(0) + "world" + chr(7) + "!"
    assert _sanitize_resume_text(s) == "helloworld!"


def test_sanitize_keeps_printable_ascii_and_spaces():
    s = "ascii ! @ # $ % ^ & * ( )"
    assert _sanitize_resume_text(s) == s


def test_sanitize_strips_c1_block():
    s = "x" + chr(0x80) + "y" + chr(0x9F) + "z"
    assert _sanitize_resume_text(s) == "xyz"


def test_sanitize_strips_unicode_separators():
    s = "before" + chr(0x2028) + "after" + chr(0x2029) + "end"
    assert _sanitize_resume_text(s) == "beforeafterend"


def test_sanitize_normalises_crlf_to_lf():
    s = "line1\r\nline2\rline3"
    assert _sanitize_resume_text(s) == "line1\nline2\nline3"


def test_sanitize_preserves_newline_and_tab():
    s = "tab\there\nnext"
    assert _sanitize_resume_text(s) == "tab\there\nnext"


def test_sanitize_caps_overall_length():
    big = "a" * (MAX_RESUME_PROMPT_CHARS + 500)
    assert len(_sanitize_resume_text(big)) == MAX_RESUME_PROMPT_CHARS


def test_sanitize_handles_none_and_empty():
    assert _sanitize_resume_text(None) == ""
    assert _sanitize_resume_text("") == ""


def test_sanitize_obj_recursive_clean():
    obj = {"name": "Alice" + chr(0x07), "skills": ["py" + chr(0x00), "sql"]}
    cleaned = _sanitize_resume_obj(obj)
    assert cleaned == {"name": "Alice", "skills": ["py", "sql"]}


def test_sanitize_obj_field_cap():
    obj = {"summary": "x" * (MAX_RESUME_FIELD_CHARS + 200)}
    cleaned = _sanitize_resume_obj(obj)
    assert len(cleaned["summary"]) == MAX_RESUME_FIELD_CHARS


def test_sanitize_obj_preserves_non_strings():
    obj = {"years": 7, "active": True, "skills": ["x"], "rating": 4.5}
    cleaned = _sanitize_resume_obj(obj)
    assert cleaned == {"years": 7, "active": True, "skills": ["x"], "rating": 4.5}


def test_sanitize_obj_handles_none():
    assert _sanitize_resume_obj(None) == {}
    assert _sanitize_resume_obj({}) == {}
