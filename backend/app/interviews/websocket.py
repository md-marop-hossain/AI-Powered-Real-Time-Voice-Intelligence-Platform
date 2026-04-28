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
  - Server emits {"type": "transcript", "text": "..."} on each committed
    utterance (Deepgram UtteranceEnd). The client APPENDS each transcript onto
    the current turn's answer — across nudges, the answer accumulates.
  - Then sends another ai_question / ai_nudge, etc., until the orchestrator ends.
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

        plan = (session.questions_plan or {}).get("questions", [])
        resume_summary = _build_resume_summary(session.resume)

        orch = SessionOrchestrator(session, plan, resume_summary, db)

        send_lock = asyncio.Lock()

        async def speak(text: str, *, is_nudge: bool = False) -> None:
            """Send a JSON header followed by streamed TTS audio.

            For real questions/follow-ups we send `ai_question` so the client
            adds a numbered turn to the conversation log. For soft nudges we
            send `ai_nudge` instead — the client plays the audio but does NOT
            create a new turn, since the nudge is glue, not a question.
            """
            header = {"type": "ai_nudge" if is_nudge else "ai_question", "text": text}
            async with send_lock:
                await websocket.send_json(header)
                try:
                    async for chunk in stream_tts(text):
                        await websocket.send_bytes(chunk)
                except Exception as e:
                    log.warning("TTS stream failed: %s", e)
                await websocket.send_json({"type": "ai_audio_end"})

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
            while not orch.ended:
                transcript = await pending.get()
                async with send_lock:
                    await websocket.send_json({"type": "ai_thinking"})
                result = await orch.submit_answer(transcript)
                next_text = result.get("next_text") or ""
                if next_text:
                    await speak(next_text, is_nudge=bool(result.get("is_nudge")))
                async with send_lock:
                    await websocket.send_json({
                        "type": "time_remaining",
                        "seconds": orch.time_remaining_seconds,
                    })
                if result.get("ended"):
                    async with send_lock:
                        await websocket.send_json({"type": "session_ended"})
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
                else:
                    break
        except WebSocketDisconnect:
            log.info("Client disconnected from session %s", session_id)
        except Exception as e:
            log.exception("WS loop error: %s", e)
        finally:
            consumer.cancel()
            await stt.stop()
            await orch.force_end()
            try:
                await websocket.close()
            except Exception:
                pass
