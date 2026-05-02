"""WebSocket endpoint for the live interview voice loop.

Protocol:
  - Client connects with ?token=<JWT> and provides the session_id in the path.
  - Server sends a JSON message:  {"type": "ai_question", "text": "..."}
    OR for a soft continuation prompt: {"type": "ai_nudge", "text": "..."}
    (a nudge is conversational glue — the client plays its audio but does NOT
    create a new turn entry in the conversation log).
  - Server then streams audio bytes for the line's TTS.
  - Server sends                  {"type": "ai_audio_end"}
  - Client streams 16kHz mono PCM little-endian audio frames as binary messages.
  - When client wants to signal end-of-speech early, send {"type": "end_speech"}.
  - Client may send {"type": "end_session"} to terminate the interview.
  - Client may send {"type": "focus_violation", "reason": "tab_switch"|...}
    when the candidate tabs away, exits fullscreen, or otherwise loses focus.
    Server replies with {"type": "focus_violation_ack", "count", "limit",
    "reason"}, and once count >= limit, follows with {"type": "session_ended",
    "reason": "focus_violations"}.
  - Server emits {"type": "transcript", "text": "..."} on each committed
    utterance (Deepgram UtteranceEnd). The client APPENDS each transcript onto
    the current turn's answer — across nudges, the answer accumulates.
  - Then sends another ai_question / ai_nudge, etc., until the orchestrator ends.
  - On a recoverable processing error (LLM timeout, TTS 5xx, etc.) the server
    sends {"type": "ai_idle"} so the client clears the "thinking" state, plus
    {"type": "error", "message": "..."} so a toast can surface the issue.
    The consumer loop survives — the candidate can keep going.
"""

from __future__ import annotations

import asyncio
import io
import json
import structlog
import wave
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal
from app.core.security import decode_token
from app.interviews.orchestrator import SessionOrchestrator
from app.interviews.stt import DeepgramSTT
from app.interviews.tts import stream_tts
from app.models.report import Report
from app.models.resume import Resume
from app.models.session import Session, SessionStatus

log = structlog.get_logger()

router = APIRouter()


# Sample rate of the inbound PCM stream (matches the frontend worklet's
# downsample target). Changing this requires a matching change in
# `frontend/public/pcm-worklet.js` and `useMicStream.ts`.
_TURN_AUDIO_SAMPLE_RATE = 16000

# Hard cap so a runaway capture (e.g. mic stuck unmuted) can't OOM the WS
# worker. 6 minutes of 16kHz int16 mono = ~12 MB per turn.
_MAX_TURN_AUDIO_BYTES = 12 * 1024 * 1024


def _encode_wav_pcm16(pcm: bytes, sample_rate: int = _TURN_AUDIO_SAMPLE_RATE) -> bytes:
    """Wrap raw little-endian int16 mono PCM in a WAV container."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


async def _save_turn_audio(turn_id: UUID, user_id: UUID, session_id: UUID, pcm: bytes) -> None:
    """Best-effort: encode and upload one turn's PCM to MinIO + persist the key.

    Runs in a background task so the consumer loop doesn't block on the
    upload. Failures are logged but never propagated — audio replay is a
    nice-to-have, not load-bearing for the interview.
    """
    if not pcm:
        return
    try:
        from app.core.storage import upload_bytes
        from app.models.turn import Turn
        from sqlalchemy import update

        loop = asyncio.get_running_loop()
        wav_bytes = await loop.run_in_executor(None, _encode_wav_pcm16, pcm)
        audio_key = f"audio/{user_id}/{session_id}/{turn_id}.wav"
        await loop.run_in_executor(
            None, upload_bytes, audio_key, wav_bytes, "audio/wav"
        )
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(Turn).where(Turn.id == turn_id).values(audio_key=audio_key)
            )
            await db.commit()
    except Exception as e:
        log.warning("Failed to save turn audio for turn %s: %s", turn_id, e)


async def _notify_creator_of_completion(db, session: Session, overall_score: float | None) -> None:
    """Best-effort: email the invite creator that a candidate just finished.

    Skipped silently when the session isn't tied to an invite, when the
    candidate IS the creator (creator self-test), or when the SMTP send
    fails — none of those should derail the post-session pipeline.
    """
    if session.invite_id is None:
        return
    from app.core.config import settings as app_settings
    from app.core.email import send_completion_notification_email
    from app.models.interview_invite import InterviewInvite
    from app.models.user import User

    res = await db.execute(
        select(InterviewInvite)
        .where(InterviewInvite.id == session.invite_id)
        .options(selectinload(InterviewInvite.creator))
    )
    invite = res.scalar_one_or_none()
    if not invite or not invite.creator:
        return
    if invite.creator_id == session.user_id:
        # Creator's own self-test — don't email yourself.
        return

    cand_res = await db.execute(select(User).where(User.id == session.user_id))
    candidate = cand_res.scalar_one_or_none()
    if not candidate:
        return

    base = app_settings.FRONTEND_URL.rstrip("/")
    results_url = f"{base}/invites/{invite.id}/results"
    try:
        await send_completion_notification_email(
            to_email=invite.creator.email,
            creator_name=invite.creator.full_name,
            candidate_name=candidate.full_name,
            candidate_email=candidate.email,
            role=session.role,
            overall_score=overall_score,
            results_url=results_url,
        )
        log.info(
            "Sent completion notification for session %s to creator %s",
            session.id, invite.creator.email,
        )
    except Exception as e:
        log.warning(
            "Failed to send completion notification for session %s: %s",
            session.id, e,
        )


async def _generate_report_background(session_id: UUID) -> None:
    """Generate a Report row (+ PDF) and notify the invite creator after a session ends.

    Runs in its own DB session so the WebSocket connection's session is free
    to close. WeasyPrint is CPU-bound so we push render_pdf into a thread.

    Idempotent: once the Report row exists, this is a no-op. That avoids
    duplicate creator-notification emails when both the WS `finally` block
    and `POST /sessions/{id}/end` fire the same task.
    """
    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                select(Session)
                .where(Session.id == session_id)
                .options(selectinload(Session.turns), selectinload(Session.report))
            )
            session: Session | None = res.scalar_one_or_none()
            if not session or session.status != SessionStatus.completed:
                return
            if session.report:
                # Either the WS task already ran, or `GET /report` lazily
                # built it. Either way, the email was either sent already
                # (WS path) or skipped (lazy path) — don't re-attempt.
                return

            from app.agents.base import LLM_TIMEOUT_SECONDS
            from app.agents.feedback import synthesize_feedback
            from app.core.storage import upload_bytes
            from app.reports.generator import build_report_summary, render_pdf
            from app.scoring.aggregator import aggregate_session_scores
            from app.skill_graphs import load_skill_graph

            skill_graph = load_skill_graph(session.role)
            agg = aggregate_session_scores(list(session.turns or []))

            narrative = None
            try:
                narrative = await asyncio.wait_for(
                    synthesize_feedback(
                        session=session,
                        turns=list(session.turns or []),
                        skill_graph=skill_graph,
                        dimension_averages=agg["dimension_averages"],
                    ),
                    timeout=LLM_TIMEOUT_SECONDS,
                )
            except Exception as e:
                log.warning("FeedbackAgent failed for %s: %s", session_id, e)

            summary = build_report_summary(session, narrative=narrative)
            overall_score = summary.get("overall_score")
            pdf_key: str | None = None
            try:
                loop = asyncio.get_running_loop()
                pdf_bytes = await loop.run_in_executor(
                    None, render_pdf, session, summary
                )
                pdf_key = f"reports/{session.user_id}/{session.id}.pdf"
                await loop.run_in_executor(
                    None, upload_bytes, pdf_key, pdf_bytes, "application/pdf"
                )
            except Exception as e:
                log.warning(
                    "Background PDF generation failed for session %s: %s",
                    session_id, e,
                )
            report = Report(
                session_id=session.id,
                overall_score=overall_score,
                summary=summary,
                pdf_key=pdf_key,
            )
            db.add(report)
            await db.commit()
            log.info("Background report generated for session %s", session_id)

            await _notify_creator_of_completion(db, session, overall_score)
    except Exception as e:
        log.warning("Background report task failed for session %s: %s", session_id, e)


def _build_resume_summary(resume: Resume | None) -> str:
    if not resume:
        return ""
    # Sanitize before truncation: control chars stripped, per-field caps applied.
    # The agent module re-applies its own caps (defense in depth) but we want
    # the orchestrator's stored copy clean too.
    from app.interviews.agent import _sanitize_resume_obj, _sanitize_resume_text

    if resume.parsed:
        cleaned = _sanitize_resume_obj(resume.parsed)
        return json.dumps(cleaned, ensure_ascii=False)[:4000]
    return _sanitize_resume_text(resume.raw_text, max_chars=4000)


@router.websocket("/ws/interview/{session_id}")
async def interview_ws(
    websocket: WebSocket,
    session_id: UUID,
    token: str = Query(...),
):
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id_raw = payload.get("sub")
    try:
        user_id = UUID(user_id_raw)
    except (TypeError, ValueError):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()

    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Session)
            .where(Session.id == session_id, Session.user_id == user_id)
            .options(selectinload(Session.resume))
        )
        session: Session | None = res.scalar_one_or_none()
        if not session:
            await websocket.send_json({"type": "error", "message": "Session not found"})
            await websocket.close()
            return
        if session.status == SessionStatus.completed:
            await websocket.send_json({"type": "error", "message": "Session already completed"})
            await websocket.close()
            return

        plan_payload = session.questions_plan or {}
        plan = plan_payload.get("questions", [])
        # Mode is stored on the session by the route that creates it. Default
        # to "resume_based" for backwards compatibility with sessions created
        # before the mode field existed.
        mode = plan_payload.get("mode") or "resume_based"

        # Résumé context for the live follow-up agent. Decision rule:
        #   Use the résumé whenever a Session.resume_id is set, regardless
        #   of mode. This keeps the agent consistent with how the plan was
        #   generated:
        #     - resume_based: candidate's own résumé.
        #     - ai_generated / jd_based: creator-uploaded résumé that was
        #       fed to the plan-generation LLM at invite-creation time
        #       (linked via QuestionSet.resume_id).
        #     - predefined: no résumé attached, follow-ups stay generic
        #       and the strict-adherence rule (no ad-hoc follow-ups)
        #       applies anyway.
        # Predefined-mode invites never link a résumé to the QuestionSet,
        # so `session.resume` is None there and the agent stays grounded
        # only in the creator's verbatim list.
        if session.resume:
            resume_summary = _build_resume_summary(session.resume)
        else:
            resume_summary = ""

        orch = SessionOrchestrator(session, plan, resume_summary, db, mode=mode)

        send_lock = asyncio.Lock()

        # Per-turn PCM accumulator. The receive loop appends every inbound
        # binary frame here; the consumer flushes + clears it whenever the
        # orchestrator advances to a new turn. A nudge keeps the same turn
        # so the candidate's full multi-utterance answer ends up in one
        # WAV file alongside the persisted text answer.
        turn_audio = bytearray()
        capture_session_user_id = session.user_id

        async def speak(text: str, *, is_nudge: bool = False) -> None:
            """Send a JSON header followed by streamed TTS audio.

            For real questions/follow-ups we send `ai_question` so the client
            adds a numbered turn to the conversation log. For soft nudges we
            send `ai_nudge` instead — the client plays the audio but does NOT
            create a new turn, since the nudge is glue, not a question.

            The TTS stream is bounded by a hard timeout so a slow or hung
            provider can't pin the send-lock indefinitely. That matters most
            on the closing line: if speak() never returns, the consumer
            never sends `session_ended` and the client hangs on the
            interview page forever.
            """
            header: dict = {"type": "ai_nudge" if is_nudge else "ai_question", "text": text}
            if not is_nudge:
                # Progress markers — let the client render "Q{n} of {total}".
                # Nudges keep the same primary question, so they don't carry
                # a marker. Index is 1-based for display.
                header["q_index"] = orch.plan_idx + 1
                header["q_total"] = len(orch.plan)
            async with send_lock:
                await websocket.send_json(header)
                try:

                    async def _stream() -> None:
                        async for chunk in stream_tts(text):
                            await websocket.send_bytes(chunk)

                    await asyncio.wait_for(_stream(), timeout=30.0)
                except asyncio.TimeoutError:
                    log.warning("TTS stream exceeded 30s — flushing audio_end")
                except Exception as e:
                    log.warning("TTS stream failed: %s", e)
                # `send_json` is unbounded and will block forever on a
                # back-pressured socket. Without this wait_for the candidate
                # gets stuck on "Rehearsal is finishing the question…" —
                # the client only leaves that state on `ai_audio_end`.
                try:
                    await asyncio.wait_for(
                        websocket.send_json({"type": "ai_audio_end"}),
                        timeout=5.0,
                    )
                except Exception as e:
                    log.warning("ai_audio_end send failed: %s", e)

        # Final transcript handler -> orchestrator step.
        pending: asyncio.Queue[str] = asyncio.Queue()

        async def on_final(transcript: str) -> None:
            async with send_lock:
                await websocket.send_json({"type": "transcript", "text": transcript})
            await pending.put(transcript)

        async def on_interim(transcript: str) -> None:
            async with send_lock:
                await websocket.send_json({"type": "user_interim", "text": transcript})

        async def on_speech_started() -> None:
            async with send_lock:
                await websocket.send_json({"type": "user_speech_started"})

        async def on_utterance_end() -> None:
            async with send_lock:
                await websocket.send_json({"type": "user_speech_ended"})

        stt = DeepgramSTT(
            on_final=on_final,
            on_interim=on_interim,
            on_speech_started=on_speech_started,
            on_utterance_end=on_utterance_end,
        )
        try:
            await stt.start()
        except Exception as e:
            log.error("Failed to start Deepgram STT: %s", e)
            await websocket.send_json(
                {"type": "error", "message": f"STT init failed: {e}"}
            )
            await websocket.close()
            return

        # Reconnect-aware start: restore from Redis, recover from DB, or fresh start.
        saved_state = await SessionOrchestrator.load_state(session_id)
        if saved_state and not saved_state.get("ended"):
            await orch.restore_state(saved_state)
            await websocket.send_json({"type": "resumed"})
            if orch.current_turn and orch.current_turn.question:
                await speak(orch.current_turn.question)
        elif session.status == SessionStatus.in_progress:
            await orch.recover_from_db()
            await websocket.send_json({"type": "resumed"})
            if orch.current_turn and orch.current_turn.question:
                await speak(orch.current_turn.question)
        else:
            first_turn = await orch.start()
            await speak(first_turn.question)
        await websocket.send_json({
            "type": "time_remaining",
            "seconds": orch.time_remaining_seconds,
        })

        async def consume_transcripts():
            # The loop must NEVER die on a single failure — if we let an
            # exception escape, the consumer task ends and any future
            # transcripts pile up in the queue with no one to process them.
            # The candidate sees "CONSIDERING YOUR ANSWER…" forever. So we
            # wrap each step, log, and recover. Each step (LLM, TTS, send)
            # is independently guarded so one failure can't skip the
            # session_ended emit on the closing turn.
            while not orch.ended:
                transcript = await pending.get()
                async with send_lock:
                    await websocket.send_json({"type": "ai_thinking"})

                # Capture the turn the candidate just answered BEFORE calling
                # submit_answer — on next_question / ask_followup the orchestrator
                # rotates `current_turn` to a fresh one, and we need the OLD id
                # to attach the recorded audio to.
                turn_being_answered = orch.current_turn
                try:
                    result = await orch.submit_answer(transcript)
                except Exception as e:
                    log.exception("submit_answer failed: %s", e)
                    try:
                        async with send_lock:
                            await websocket.send_json({"type": "ai_idle"})
                            await websocket.send_json({
                                "type": "error",
                                "message": "We hit a snag processing that — please try again.",
                            })
                    except Exception:
                        pass
                    continue

                next_text = result.get("next_text") or ""
                ended = bool(result.get("ended"))
                is_nudge = bool(result.get("is_nudge"))

                # Turn boundary — flush whatever PCM the receive loop has
                # buffered into a WAV and attach it to the turn we just
                # answered. Nudges keep the same turn (per the orchestrator
                # contract), so we hold onto the buffer until the candidate
                # gives a real answer.
                if not is_nudge and turn_being_answered is not None and turn_audio:
                    pcm_snapshot = bytes(turn_audio)
                    turn_audio.clear()
                    asyncio.create_task(
                        _save_turn_audio(
                            turn_being_answered.id,
                            capture_session_user_id,
                            session_id,
                            pcm_snapshot,
                        )
                    )

                if next_text:
                    # Hard outer cap on the entire speak() call. The inner
                    # wait_for only bounds the TTS stream — the surrounding
                    # send_json frames (ai_question / ai_audio_end) are
                    # unbounded, so a back-pressured socket or a hung TTS
                    # provider could otherwise leave the candidate stuck on
                    # "Rehearsal is finishing the question…" forever and
                    # block the session_ended emit below. Use a tighter
                    # bound on the closing turn so the candidate doesn't
                    # wait long for the navigation to fire.
                    speak_timeout = 35.0 if ended else 60.0
                    try:
                        await asyncio.wait_for(
                            speak(next_text, is_nudge=bool(result.get("is_nudge"))),
                            timeout=speak_timeout,
                        )
                    except asyncio.TimeoutError:
                        log.warning(
                            "speak() exceeded %ss on %s turn — forcing close-out",
                            speak_timeout,
                            "closing" if ended else "next",
                        )
                    except Exception as e:
                        log.warning("speak() raised on turn close-out: %s", e)

                # Fire verifier as a background task after the scored turn is committed.
                if not is_nudge and turn_being_answered is not None:
                    scored_scores = result.get("scores")
                    if scored_scores and turn_being_answered.id is not None:
                        from app.agents.verifier import verify_scores
                        asyncio.create_task(
                            verify_scores(
                                question=turn_being_answered.question or "",
                                answer=turn_being_answered.answer or "",
                                original_scores=scored_scores,
                                role=session.role,
                                seniority=session.seniority,
                                turn_id=turn_being_answered.id,
                            )
                        )

                try:
                    async with send_lock:
                        await websocket.send_json({
                            "type": "time_remaining",
                            "seconds": orch.time_remaining_seconds,
                        })
                except Exception as e:
                    log.warning("time_remaining send failed: %s", e)

                if ended:
                    # Guaranteed-path emit: the client uses this to navigate
                    # to the completion screen, so it must go out even if the
                    # closing speak or time_remaining failed above. Bound it
                    # too — if the socket itself is stuck we'd rather drop
                    # the connection than leave the candidate hanging.
                    try:
                        async with send_lock:
                            await asyncio.wait_for(
                                websocket.send_json({"type": "session_ended"}),
                                timeout=5.0,
                            )
                    except Exception as e:
                        log.warning("session_ended send failed: %s", e)
                    return

        async def heartbeat():
            """Send a `{"type": "ping"}` every 30s to keep the WS alive.

            Load balancers (ALB, nginx) typically idle-timeout silent
            connections at 60s. During quiet periods of an interview (AI
            thinking, candidate pausing) no traffic flows in either
            direction, so without this the connection drops mid-interview
            with no error surfaced.
            """
            while not orch.ended:
                try:
                    await asyncio.sleep(30)
                except asyncio.CancelledError:
                    return
                if orch.ended:
                    return
                try:
                    async with send_lock:
                        await asyncio.wait_for(
                            websocket.send_json({"type": "ping"}),
                            timeout=5.0,
                        )
                except Exception:
                    # Connection broken — stop pinging; the receive loop will
                    # surface the disconnect on its next read.
                    return

        consumer = asyncio.create_task(consume_transcripts())
        keepalive = asyncio.create_task(heartbeat())

        try:
            while not orch.ended:
                msg = await websocket.receive()
                if "bytes" in msg and msg["bytes"] is not None:
                    stt.send(msg["bytes"])
                    # Accumulate the same PCM into the per-turn buffer so we
                    # can replay it from the report. Capped to keep a stuck
                    # mic from blowing up memory; once the cap is hit the
                    # tail is dropped silently.
                    if len(turn_audio) < _MAX_TURN_AUDIO_BYTES:
                        turn_audio.extend(msg["bytes"])
                elif "text" in msg and msg["text"] is not None:
                    try:
                        data = json.loads(msg["text"])
                    except json.JSONDecodeError:
                        continue
                    mtype = data.get("type")
                    if mtype == "end_session":
                        await orch.force_end()
                        await websocket.send_json({"type": "session_ended"})
                        break
                    elif mtype == "end_speech":
                        # Deepgram VAD usually handles this; left as a manual nudge.
                        pass
                    elif mtype == "pong":
                        # Optional keepalive ack from the client. The server's
                        # own ping is what defeats the LB idle timer; this is
                        # accepted purely so an ack-sending client isn't
                        # treated as malformed traffic.
                        pass
                    elif mtype == "focus_violation":
                        # Tab switch / fullscreen exit / window blur reported
                        # by the client. Record on the session, ack with the
                        # current count, and end the session if the limit is
                        # reached.
                        reason = (data.get("reason") or "unknown")[:64]
                        result = await orch.record_focus_violation(reason)
                        ack = {
                            "type": "focus_violation_ack",
                            "count": result.get("count", 0),
                            "limit": result.get("limit", 0),
                            "reason": reason,
                        }
                        async with send_lock:
                            await websocket.send_json(ack)
                        if result.get("ended"):
                            closing = result.get("next_text") or ""
                            if closing:
                                try:
                                    await speak(closing)
                                except Exception:
                                    pass
                            async with send_lock:
                                await websocket.send_json({
                                    "type": "session_ended",
                                    "reason": "focus_violations",
                                })
                            break
                else:
                    break
        except WebSocketDisconnect:
            log.info("Client disconnected from session %s", session_id)
        except Exception as e:
            log.exception("WS loop error: %s", e)
        finally:
            # Cancel the consumer AND wait for it to actually exit before we
            # close the AsyncSession. Without the await, cancel() only marks
            # the task — its current `await` (often a db.execute) keeps
            # holding a connection on `db`, and exiting `async with
            # AsyncSessionLocal() as db` then trips
            # IllegalStateChangeError ("close() can't be called here;
            # _connection_for_bind() is already in progress") because two
            # coroutines are touching the same session at once.
            consumer.cancel()
            keepalive.cancel()
            try:
                await consumer
            except asyncio.CancelledError:
                pass
            except Exception as e:
                log.warning("consumer raised on cancel: %s", e)
            try:
                await keepalive
            except asyncio.CancelledError:
                pass
            except Exception as e:
                log.warning("keepalive raised on cancel: %s", e)
            await stt.stop()
            # Flush any audio captured against the still-current turn (e.g.
            # candidate disconnected mid-answer or hit the timer mid-turn).
            if turn_audio and orch.current_turn is not None:
                pcm_snapshot = bytes(turn_audio)
                turn_audio.clear()
                asyncio.create_task(
                    _save_turn_audio(
                        orch.current_turn.id,
                        capture_session_user_id,
                        session_id,
                        pcm_snapshot,
                    )
                )
            await orch.force_end()
            # Fire-and-forget: generate the report in its own DB session so
            # this session's context is free to close immediately.
            asyncio.create_task(_generate_report_background(session_id))
            try:
                await websocket.close()
            except Exception:
                pass
