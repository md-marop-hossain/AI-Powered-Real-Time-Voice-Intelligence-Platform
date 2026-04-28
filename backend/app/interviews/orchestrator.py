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
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.interviews.agent import decide_next_turn
from app.models.session import Session, SessionStatus
from app.models.turn import Turn

log = logging.getLogger(__name__)


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
        """Persist the candidate's answer to the current turn and decide next move.

        Returns a dict: {decision, next_text, scores, ended: bool}
        """
        async with self.lock:
            if self.ended:
                return {"decision": "end_section", "next_text": "", "scores": {}, "ended": True}

            if self.current_turn is None:
                raise RuntimeError("No current turn")

            # Persist answer.
            self.current_turn.answer = transcript
            self.current_turn.answered_at = datetime.now(timezone.utc)
            self.history.append({"role": "candidate", "content": transcript})

            # Time check - hard end if time exhausted.
            time_left = self.time_remaining_seconds
            if time_left <= 5:
                await self.db.commit()
                return await self._end_session("Thanks — that's all the time we have.")

            # Ask the agent.
            decision = await decide_next_turn(
                plan=self.plan,
                resume_summary=self.resume_summary,
                history=self.history,
                answer=transcript,
                time_remaining_seconds=time_left,
                role=self.session.role,
                seniority=self.session.seniority,
                focus=self.session.focus,
                industry=self.session.industry,
            )
            # Score current turn.
            self.current_turn.scores = decision.get("scores")
            self.current_turn.rationale = decision.get("rationale")
            await self.db.commit()

            move = decision["decision"]
            next_text = decision.get("next_text") or ""

            if move == "end_section" or self.plan_idx >= len(self.plan) - 1 and move == "next_question":
                # Wrap up.
                await self.db.commit()
                return await self._end_session(next_text or "Thanks for your time.")

            # Either follow-up on same question, or move to the next planned one.
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
            self.history.append({"role": "interviewer", "content": next_text})

            return {
                "decision": move,
                "next_text": next_text,
                "scores": decision.get("scores"),
                "ended": False,
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
        }

    async def force_end(self) -> None:
        if self.ended:
            return
        self.ended = True
        if self.session.status != SessionStatus.completed:
            self.session.status = SessionStatus.completed
            self.session.ended_at = datetime.now(timezone.utc)
            await self.db.commit()
