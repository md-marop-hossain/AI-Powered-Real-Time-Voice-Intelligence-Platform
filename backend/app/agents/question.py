"""QuestionAgent — difficulty-calibrated question text delivery.

Pure Python, no LLM call. Wraps the planned question text with a parenthetical
calibration hint when difficulty is at the extremes (<3 or >7).
"""

from __future__ import annotations


def calibrate_question_text(question_text: str, difficulty: float) -> str:
    """Return question_text, optionally appended with a difficulty calibration hint.

    - difficulty 1–2: append a gentle scaffolding hint so the candidate isn't
      left floundering on a topic they're already struggling with.
    - difficulty 8–10: append a signal that the bar is high — no hand-holding.
    - difficulty 3–7 (normal range): return unchanged.
    """
    if difficulty < 3.0:
        return (
            question_text.rstrip()
            + " (Feel free to start from what you know — there's no need for a complete answer.)"
        )
    if difficulty > 7.0:
        return (
            question_text.rstrip()
            + " (Please give a complete, production-level answer — no scaffolding expected.)"
        )
    return question_text
