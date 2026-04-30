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
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal
from app.core.security import decode_token
from app.interviews.orchestrator import SessionOrchestrator
from app.interviews.stt import DeepgramSTT
from app.interviews.tts import stream_tts
from app.models.resume import Resume
from app.models.session import Session, SessionStatus

log = logging.getLogger(__name__)

router = APIRouter()


def _build_resume_summary(resume: Resume | None) -> str:
    if not resume:
        return ""
    if resume.parsed:
        return json.dumps(resume.parsed, ensure_ascii=False)[:4000]
    return (resume.raw_text or "")[:4000]


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

        # Resume isolation per mode:
        #   - resume_based: full resume context for plan AND follow-ups.
        #   - predefined / ai_generated / jd_based: the question PLAN was
        #     generated without resume input (predefined comes from the
        #     creator; ai_generated and jd_based are explicitly resume-free).
        #     Suppressing resume_summary in follow-ups keeps the live agent
        #     tonally consistent with the plan it was given — no surprise
        #     references to companies or projects the candidate's resume
        #     happens to mention.
        if mode == "resume_based":
            resume_summary = _build_resume_summary(session.resume)
        else:
            resume_summary = ""

        orch = SessionOrchestrator(session, plan, resume_summary, db, mode=mode)

        send_lock = asyncio.Lock()

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
            header = {"type": "ai_nudge" if is_nudge else "ai_question", "text": text}
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

        # First question.
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

        consumer = asyncio.create_task(consume_transcripts())

        try:
            while not orch.ended:
                msg = await websocket.receive()
                if "bytes" in msg and msg["bytes"] is not None:
                    stt.send(msg["bytes"])
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
            try:
                await consumer
            except asyncio.CancelledError:
                pass
            except Exception as e:
                log.warning("consumer raised on cancel: %s", e)
            await stt.stop()
            await orch.force_end()
            try:
                await websocket.close()
            except Exception:
                pass
