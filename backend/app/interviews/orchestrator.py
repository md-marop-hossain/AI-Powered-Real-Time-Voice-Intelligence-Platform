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
from app.invites.service import mark_invitee_completed_for_session
from app.models.session import Session, SessionStatus
from app.models.turn import Turn
from app.scoring.aggregator import aggregate_session_scores

# Redis key TTL: 3 hours — covers the longest allowed interview plus generous
# reconnect window.
_ORCH_STATE_TTL = 3 * 60 * 60

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

# Max real follow-ups (substantive probes) on a single primary question
# before we force the next planned question. Without this cap the LLM tends
# to rephrase the same probe two or three times when the candidate is
# struggling with a topic — which feels punitive and doesn't help.
FOLLOWUP_CAP = 2

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


# Common throat-clearing / filler words that don't add semantic content.
# Used by the deterministic "is this answer too short to be real" guard.
_FILLER_WORDS = frozenset({
    "uh", "um", "ah", "er", "hmm", "mm",
    "yeah", "yep", "yes", "no", "ok", "okay",
})

# Below this threshold of meaningful words we treat the cumulative answer as
# a fragment and nudge for more — without spending an LLM round-trip. The
# LLM is still authoritative for everything above the threshold.
MIN_ANSWER_WORDS = 5


def _meaningful_word_count(text: str) -> int:
    """Count words after stripping pure fillers. Used by the short-answer guard."""
    if not text:
        return 0
    words = re.findall(r"\b[a-zA-Z']+\b", text.lower())
    return sum(1 for w in words if w not in _FILLER_WORDS)


class SessionOrchestrator:
    def __init__(
        self,
        session: Session,
        plan: list[dict],
        resume_summary: str,
        db: AsyncSession,
        mode: str = "resume_based",
    ):
        self.session = session
        self.plan = plan
        self.resume_summary = resume_summary
        self.db = db
        # Mode controls which behaviours are allowed mid-interview:
        #   - "predefined": questions come verbatim from the creator. Ad-hoc
        #     follow-ups are forbidden. Nudges + move-on are the only LLM
        #     decisions honoured; ask_followup is rewritten to next_question.
        #   - "ai_generated" / "jd_based": questions were generated from the
        #     interview shape (and JD if applicable) without a resume. The
        #     follow-up LLM may still probe within the same topic.
        #   - "resume_based": full resume context end-to-end (default).
        # Anything else is treated as "resume_based" for back-compat.
        self.mode = mode if mode in {
            "predefined", "ai_generated", "jd_based", "resume_based"
        } else "resume_based"
        self.history: list[dict[str, Any]] = []
        self.plan_idx: int = 0
        self.current_turn: Turn | None = None
        self.lock = asyncio.Lock()
        self.ended = False
        # Number of soft nudges already given on the current turn. Resets to 0
        # whenever a new question turn is created. Capped at NUDGE_CAP.
        self._nudges_on_current_turn: int = 0
        # Number of substantive follow-ups asked since the last *primary*
        # planned question. Resets to 0 when we move to next_question. Capped
        # at FOLLOWUP_CAP so the candidate isn't asked rephrasings of the
        # same probe over and over.
        self._followups_on_current_question: int = 0

    # ------------------------------------------------------------------
    # Redis state persistence — enables mid-interview reconnection.
    # All methods are best-effort: a Redis failure is logged but never
    # crashes the interview.
    # ------------------------------------------------------------------

    async def _save_state(self) -> None:
        """Persist current orchestrator state to Redis."""
        state = {
            "plan_idx": self.plan_idx,
            "nudges": self._nudges_on_current_turn,
            "followups": self._followups_on_current_question,
            "history": self.history,
            "current_turn_id": str(self.current_turn.id) if self.current_turn else None,
            "ended": self.ended,
        }
        try:
            from app.core.redis_client import get_redis
            redis = await get_redis()
            await redis.setex(
                f"interview:{self.session.id}:state",
                _ORCH_STATE_TTL,
                json.dumps(state),
            )
        except Exception as e:
            log.warning("Could not save orchestrator state to Redis (session %s): %s",
                        self.session.id, e)

    async def _clear_state(self) -> None:
        """Remove Redis state when the session ends normally."""
        try:
            from app.core.redis_client import get_redis
            redis = await get_redis()
            await redis.delete(f"interview:{self.session.id}:state")
        except Exception as e:
            log.warning("Could not clear orchestrator state from Redis (session %s): %s",
                        self.session.id, e)

    @staticmethod
    async def load_state(session_id: UUID) -> dict | None:
        """Return saved orchestrator state for *session_id*, or None."""
        try:
            from app.core.redis_client import get_redis
            redis = await get_redis()
            data = await redis.get(f"interview:{session_id}:state")
            return json.loads(data) if data else None
        except Exception as e:
            log.warning("Could not load orchestrator state from Redis (session %s): %s",
                        session_id, e)
            return None

    async def restore_state(self, state: dict) -> None:
        """Restore in-memory fields from a Redis snapshot after a reconnect.

        Does NOT call start() — started_at is already in the DB and must not
        be overwritten, or time_remaining_seconds would reset the timer.
        """
        self.plan_idx = state.get("plan_idx", 0)
        self._nudges_on_current_turn = state.get("nudges", 0)
        self._followups_on_current_question = state.get("followups", 0)
        self.history = state.get("history", [])
        self.ended = state.get("ended", False)

        current_turn_id = state.get("current_turn_id")
        if current_turn_id:
            res = await self.db.execute(
                select(Turn).where(Turn.id == UUID(current_turn_id))
            )
            self.current_turn = res.scalar_one_or_none()

        # Ensure DB status reflects reality.
        if self.session.status == SessionStatus.pending:
            self.session.status = SessionStatus.in_progress
            if not self.session.started_at:
                self.session.started_at = datetime.now(timezone.utc)
            await self.db.commit()

    async def recover_from_db(self) -> None:
        """Fallback recovery when Redis state is unavailable but the session
        is already in_progress (e.g. Redis restarted mid-interview).

        Reconstructs the minimum necessary state from the persisted Turn rows
        so the candidate can continue from where they left off.
        """
        # Load all turns ordered by index to rebuild history and plan position.
        res = await self.db.execute(
            select(Turn)
            .where(Turn.session_id == self.session.id)
            .order_by(Turn.index)
        )
        turns = list(res.scalars().all())

        if not turns:
            # Nothing persisted yet — treat as a fresh start but don't reset
            # started_at; that's already in DB from the previous connection.
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
            return

        # Reconstruct history from persisted turns.
        for t in turns:
            self.history.append({"role": "interviewer", "content": t.question})
            if t.answer:
                self.history.append({"role": "candidate", "content": t.answer})

        # plan_idx = number of completed primary turns - 1 (0-indexed into plan).
        primary_count = sum(1 for t in turns if t.question_kind == "primary")
        self.plan_idx = max(0, primary_count - 1)
        self.current_turn = turns[-1]

    # ------------------------------------------------------------------

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
        await self._save_state()
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

            # Deterministic short-answer guard. Two-word "answers" like
            # "desirable actions." or "Okay." are nearly always continuation
            # fragments from the previous thought, not real answers — the
            # LLM is unreliable about classifying these so we handle them
            # in code: if the cumulative answer has fewer than MIN_ANSWER_WORDS
            # meaningful words and we haven't hit the nudge cap, speak a soft
            # nudge and keep listening. Skips an LLM round-trip.
            if (
                _meaningful_word_count(combined) < MIN_ANSWER_WORDS
                and self._nudges_on_current_turn < NUDGE_CAP
            ):
                idx = min(self._nudges_on_current_turn, len(NUDGE_FALLBACKS) - 1)
                nudge_text = NUDGE_FALLBACKS[idx]
                self._nudges_on_current_turn += 1
                self.history.append({"role": "interviewer", "content": nudge_text})
                await self.db.commit()
                await self._save_state()
                return {
                    "decision": "nudge",
                    "next_text": nudge_text,
                    "scores": None,
                    "ended": False,
                    "is_nudge": True,
                }

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
                followups_so_far=self._followups_on_current_question,
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

            # Hard cap on follow-ups. If we've already asked FOLLOWUP_CAP
            # follow-ups on the current primary question and the LLM wants
            # another one, force the next planned question. Drop the LLM's
            # follow-up text so the orchestrator falls back to the plan.
            if move == "ask_followup" and self._followups_on_current_question >= FOLLOWUP_CAP:
                move = "next_question"
                next_text = ""

            # PREDEFINED MODE: the creator's question list is the ENTIRE
            # interview. Any ad-hoc follow-up the LLM tries to inject is
            # rewritten to the next planned question (or end_section if we
            # were already at the last one). This is what enforces "the AI
            # must strictly follow and ask based on these questions."
            # Nudges still pass through — they're conversational glue, not
            # new questions, so they don't break strict adherence.
            if self.mode == "predefined" and move == "ask_followup":
                if self.plan_idx >= len(self.plan) - 1:
                    move = "end_section"
                    next_text = next_text if not next_text.strip().endswith("?") else ""
                    if not next_text:
                        next_text = "Thanks — that wraps up the questions for today."
                else:
                    move = "next_question"
                    next_text = ""

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
                await self._save_state()
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
            # planned one. Either way we create a fresh Turn. Counters reset
            # only when we move to a new primary question — follow-ups on the
            # same primary share the follow-up counter so the cap applies
            # across them.
            if move == "next_question":
                self.plan_idx += 1
                kind = "primary"
                if self.plan_idx < len(self.plan):
                    next_text = next_text or self.plan[self.plan_idx]["question"]
                self._followups_on_current_question = 0
            else:
                kind = "followup"
                self._followups_on_current_question += 1

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
            await self._save_state()

            return {
                "decision": move,
                "next_text": next_text,
                "scores": decision.get("scores"),
                "ended": False,
                "is_nudge": False,
            }

    async def _aggregate_final_scores(self) -> None:
        """Populate session.final_scores from the persisted turns.

        The dashboard's avg-score stat reads session.final_scores; without this
        the WS-driven end paths (timer, stop-intent, focus violations,
        end_section) would leave the field NULL and skew the average to "—".
        Turns aren't eagerly loaded on self.session, so query them directly.
        """
        res = await self.db.execute(
            select(Turn).where(Turn.session_id == self.session.id)
        )
        turns = res.scalars().all()
        try:
            self.session.final_scores = aggregate_session_scores(turns)
        except Exception as e:
            log.warning("final_scores aggregation failed for session %s: %s",
                        self.session.id, e)

    async def _end_session(self, closing_text: str) -> dict:
        self.ended = True
        self.session.status = SessionStatus.completed
        self.session.ended_at = datetime.now(timezone.utc)
        await self._aggregate_final_scores()
        await mark_invitee_completed_for_session(self.db, self.session)
        await self.db.commit()
        await self._clear_state()
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
            await self._aggregate_final_scores()
            await mark_invitee_completed_for_session(self.db, self.session)
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
            await self._save_state()
            return {
                "count": current,
                "limit": FOCUS_VIOLATION_LIMIT,
                "ended": False,
                "next_text": "",
            }
