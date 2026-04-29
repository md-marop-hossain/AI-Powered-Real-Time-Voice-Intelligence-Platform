"""Per-session orchestrator that owns the voice loop state machine.

Responsibilities:
  - Hold the question plan and the current question pointer
  - Receive a final transcript -> persist as Turn answer -> ask LLM agent for next move
  - Persist new question turns
  - Compute time remaining and end the session when time is up
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.interviews.agent import decide_next_turn
from app.models.session import Session, SessionStatus
from app.models.turn import Turn

log = logging.getLogger(__name__)


# Patterns that should bypass the LLM and end the session immediately. The
# candidate explicitly asked to stop the whole interview (not just the current
# question) — keep the matchers narrow to avoid false positives like
# "I'm done with this answer".
_STOP_INTERVIEW_PATTERNS = [
    re.compile(r"\b(stop|end|finish|quit|terminate)\b[^.?!]*\b(interview|session)\b", re.I),
    re.compile(r"\b(interview|session)\b[^.?!]*\b(stop|end|finish|quit|terminate)\b", re.I),
    re.compile(r"\bcan\s+(you|we)\s+(please\s+)?(stop|end|finish|quit)\b", re.I),
    re.compile(r"\bi\s+(want|need|would\s+like|wish)\s+to\s+(stop|end|leave|quit)\b", re.I),
    re.compile(r"\bi\s+give\s+up\b", re.I),
]

NUDGE_CAP = 2

NUDGE_FALLBACKS = (
    "Take your time.",
    "Go on.",
    "Mm-hm — tell me more.",
)

# Max focus-integrity violations (tab switches, fullscreen exits, window blur)
# tolerated before the session is auto-ended. The frontend warns at every
# violation; the Nth violation triggers a graceful end.
FOCUS_VIOLATION_LIMIT = 3


def _wants_to_stop_interview(text: str) -> bool:
    if not text:
        return False
    for pat in _STOP_INTERVIEW_PATTERNS:
        if pat.search(text):
            return True
    return False


class SessionOrchestrator:
    def __init__(
        self,
        session: Session,
        plan: list[dict],
        resume_summary: str,
        db: AsyncSession,
    ):
        self.session = session
        self.plan = plan
        self.resume_summary = resume_summary
        self.db = db
        self.history: list[dict[str, Any]] = []
        self.plan_idx: int = 0
        self.current_turn: Turn | None = None
        self.lock = asyncio.Lock()
        self.ended = False
        # Number of soft nudges already given on the current turn. Resets to 0
        # whenever a new question turn is created. Capped at NUDGE_CAP.
        self._nudges_on_current_turn: int = 0

    @property
    def time_remaining_seconds(self) -> int:
        if not self.session.started_at:
            return self.session.duration_minutes * 60
        elapsed = (
            datetime.now(timezone.utc) - self.session.started_at
        ).total_seconds()
        return max(0, int(self.session.duration_minutes * 60 - elapsed))

    async def start(self) -> Turn:
        """Mark session in_progress, persist the first question turn, return it."""
        if not self.plan:
            raise RuntimeError("Cannot start session without a question plan")
        self.session.status = SessionStatus.in_progress
        self.session.started_at = datetime.now(timezone.utc)
        first_q = self.plan[0]["question"]
        turn = Turn(
            session_id=self.session.id,
            index=1,
            question=first_q,
            question_kind="primary",
        )
        self.db.add(turn)
        await self.db.commit()
        await self.db.refresh(turn)
        self.current_turn = turn
        self.history.append({"role": "interviewer", "content": first_q})
        return turn

    async def submit_answer(self, transcript: str) -> dict:
        """Persist the candidate's utterance to the current turn and decide next move.

        Across nudges, multiple utterances accumulate into the same turn's answer
        — a nudge is conversational glue, not a new question. Only ask_followup,
        next_question, and end_section advance the turn pointer.

        Returns a dict: {decision, next_text, scores, ended, is_nudge}
        """
        async with self.lock:
            if self.ended:
                return {
                    "decision": "end_section",
                    "next_text": "",
                    "scores": None,
                    "ended": True,
                    "is_nudge": False,
                }

            if self.current_turn is None:
                raise RuntimeError("No current turn")

            # Append (or set) the utterance on the current turn so the answer
            # accumulates across nudges. The LLM is then evaluated on the full
            # answer-so-far rather than the latest fragment in isolation.
            existing = self.current_turn.answer or ""
            combined = (existing + " " + transcript).strip() if existing else transcript.strip()
            self.current_turn.answer = combined
            self.current_turn.answered_at = datetime.now(timezone.utc)
            self.history.append({"role": "candidate", "content": transcript})

            # Deterministic stop-intent check before any LLM call. If the
            # candidate has explicitly asked to stop the interview, end
            # gracefully without scoring a "stop request" as a real answer.
            if _wants_to_stop_interview(transcript):
                self.current_turn.scores = None
                self.current_turn.rationale = "Candidate requested to stop the interview."
                await self.db.commit()
                return await self._end_session(
                    "Of course — let's wrap up here. Thanks for your time today."
                )

            # Time check - hard end if time exhausted.
            time_left = self.time_remaining_seconds
            if time_left <= 5:
                await self.db.commit()
                return await self._end_session("Thanks — that's all the time we have.")

            # Ask the agent. Always pass the cumulative answer so the model sees
            # the whole context, not just the latest fragment.
            decision = await decide_next_turn(
                plan=self.plan,
                resume_summary=self.resume_summary,
                history=self.history,
                answer=combined,
                time_remaining_seconds=time_left,
                role=self.session.role,
                seniority=self.session.seniority,
                focus=self.session.focus,
                industry=self.session.industry,
                nudges_so_far=self._nudges_on_current_turn,
            )

            move = decision["decision"]
            next_text = decision.get("next_text") or ""

            # Hard cap on nudges. If the LLM tries to nudge a third time, force
            # a real follow-up so we never chain "go on / take your time" forever.
            if move == "nudge" and self._nudges_on_current_turn >= NUDGE_CAP:
                move = "ask_followup"
                if not next_text or len(next_text.split()) < 4:
                    next_text = (
                        "Could you take that one step further — what specifically did you do?"
                    )

            if move == "nudge":
                # Soft continuation: do NOT create a new Turn, do NOT persist
                # scores (the answer is incomplete — scoring it would dilute
                # the report). Just speak the prompt and keep listening.
                if not next_text:
                    idx = min(self._nudges_on_current_turn, len(NUDGE_FALLBACKS) - 1)
                    next_text = NUDGE_FALLBACKS[idx]
                self._nudges_on_current_turn += 1
                self.history.append({"role": "interviewer", "content": next_text})
                await self.db.commit()
                return {
                    "decision": "nudge",
                    "next_text": next_text,
                    "scores": None,
                    "ended": False,
                    "is_nudge": True,
                }

            # Real evaluation: persist scores + rationale on the current turn.
            self.current_turn.scores = decision.get("scores")
            self.current_turn.rationale = decision.get("rationale")
            await self.db.commit()

            if move == "end_section" or (
                self.plan_idx >= len(self.plan) - 1 and move == "next_question"
            ):
                return await self._end_session(next_text or "Thanks for your time.")

            # Either a real follow-up on the same question, or move to the next
            # planned one. Either way we create a fresh Turn and reset the nudge
            # counter so the next answer starts patient again.
            if move == "next_question":
                self.plan_idx += 1
                kind = "primary"
                if self.plan_idx < len(self.plan):
                    next_text = next_text or self.plan[self.plan_idx]["question"]
            else:
                kind = "followup"

            new_idx = (self.current_turn.index or 0) + 1
            new_turn = Turn(
                session_id=self.session.id,
                index=new_idx,
                question=next_text,
                question_kind=kind,
            )
            self.db.add(new_turn)
            await self.db.commit()
            await self.db.refresh(new_turn)
            self.current_turn = new_turn
            self._nudges_on_current_turn = 0
            self.history.append({"role": "interviewer", "content": next_text})

            return {
                "decision": move,
                "next_text": next_text,
                "scores": decision.get("scores"),
                "ended": False,
                "is_nudge": False,
            }

    async def _end_session(self, closing_text: str) -> dict:
        self.ended = True
        self.session.status = SessionStatus.completed
        self.session.ended_at = datetime.now(timezone.utc)
        await self.db.commit()
        return {
            "decision": "end_section",
            "next_text": closing_text,
            "scores": None,
            "ended": True,
            "is_nudge": False,
        }

    async def force_end(self) -> None:
        if self.ended:
            return
        self.ended = True
        if self.session.status != SessionStatus.completed:
            self.session.status = SessionStatus.completed
            self.session.ended_at = datetime.now(timezone.utc)
            await self.db.commit()

    async def record_focus_violation(self, reason: str) -> dict:
        """Record a tab-switch / fullscreen-exit / blur event from the client.

        Increments the persistent counter on the session. If the limit is hit,
        ends the session gracefully and returns ended=True. Otherwise returns
        the new count and how many strikes remain so the client can surface it.
        """
        async with self.lock:
            if self.ended:
                return {
                    "count": self.session.focus_violations or 0,
                    "limit": FOCUS_VIOLATION_LIMIT,
                    "ended": True,
                    "next_text": "",
                }
            current = (self.session.focus_violations or 0) + 1
            self.session.focus_violations = current
            await self.db.commit()
            log.info(
                "Focus violation #%s on session %s: %s",
                current,
                self.session.id,
                reason,
            )
            if current >= FOCUS_VIOLATION_LIMIT:
                end = await self._end_session(
                    "Session ended — too many focus interruptions. "
                    "Please stay in the interview tab next time."
                )
                end["count"] = current
                end["limit"] = FOCUS_VIOLATION_LIMIT
                return end
            return {
                "count": current,
                "limit": FOCUS_VIOLATION_LIMIT,
                "ended": False,
                "next_text": "",
            }
