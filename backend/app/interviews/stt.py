"""Deepgram streaming STT client wrapper.

Maintains a single live connection per session. Forwards browser PCM audio
frames to Deepgram and emits four kinds of events back to the orchestrator:
  * speech_started   - VAD heard speech onset
  * interim          - growing transcript while the candidate is speaking
                       (includes both already-committed phrases and the live phrase)
  * final            - the candidate's full utterance, committed only when
                       Deepgram's UtteranceEnd fires after a long pause
                       (utterance_end_ms below). Brief mid-sentence pauses do
                       NOT trigger a final — fragments are buffered locally.
  * utterance_end    - VAD heard prolonged silence (~2.5s) — candidate is done
"""

from __future__ import annotations

import asyncio
import structlog
from typing import Awaitable, Callable

from deepgram import (
    DeepgramClient,
    DeepgramClientOptions,
    LiveOptions,
    LiveTranscriptionEvents,
)

from app.core.config import settings

log = structlog.get_logger()

AsyncStr = Callable[[str], Awaitable[None]]
AsyncVoid = Callable[[], Awaitable[None]]


class DeepgramSTT:
    def __init__(
        self,
        on_final: AsyncStr,
        on_interim: AsyncStr | None = None,
        on_speech_started: AsyncVoid | None = None,
        on_utterance_end: AsyncVoid | None = None,
    ):
        self._on_final = on_final
        self._on_interim = on_interim
        self._on_speech_started = on_speech_started
        self._on_utterance_end = on_utterance_end
        self._dg = DeepgramClient(
            settings.DEEPGRAM_API_KEY,
            DeepgramClientOptions(options={"keepalive": "true"}),
        )
        self._connection = None
        self._loop = asyncio.get_event_loop()
        # Accumulates final phrase fragments between UtteranceEnd events.
        # Deepgram emits a "final" on every short pause (~600ms), but a single
        # answer is only complete when UtteranceEnd fires after a longer silence.
        self._final_buffer: list[str] = []

    def _schedule(self, coro):
        """Schedule a coroutine on the main event loop from a Deepgram callback thread."""
        try:
            asyncio.run_coroutine_threadsafe(coro, self._loop)
        except Exception as e:
            log.exception("Failed to schedule STT callback: %s", e)

    async def start(self) -> None:
        self._connection = self._dg.listen.live.v("1")

        def _on_transcript(*args, **kwargs):
            try:
                result = kwargs.get("result")
                if result is None:
                    for a in args:
                        if hasattr(a, "channel"):
                            result = a
                            break
                if result is None:
                    return
                alt = result.channel.alternatives[0]
                transcript = (alt.transcript or "").strip()
                if not transcript:
                    return
                if result.is_final:
                    # Buffer the phrase; do NOT commit yet. UtteranceEnd is the
                    # real "answer is complete" signal — see _on_utterance_end.
                    self._final_buffer.append(transcript)
                    if self._on_interim:
                        composite = " ".join(self._final_buffer).strip()
                        self._schedule(self._on_interim(composite))
                elif self._on_interim:
                    # Show buffered finals + the live phrase so the candidate
                    # sees the whole evolving thought, not just the latest clause.
                    composite = (" ".join(self._final_buffer) + " " + transcript).strip()
                    self._schedule(self._on_interim(composite))
            except Exception as e:
                log.exception("Deepgram transcript handler error: %s", e)

        def _on_speech_started(*_args, **_kwargs):
            if self._on_speech_started:
                self._schedule(self._on_speech_started())

        def _on_utterance_end(*_args, **_kwargs):
            committed = " ".join(self._final_buffer).strip()
            self._final_buffer = []
            if committed:
                self._schedule(self._on_final(committed))
            if self._on_utterance_end:
                self._schedule(self._on_utterance_end())

        def _on_error(*args, **kwargs):
            err = kwargs.get("error") or (args[1] if len(args) > 1 else args[0] if args else None)
            log.error("Deepgram error: %s", err)

        self._connection.on(LiveTranscriptionEvents.Transcript, _on_transcript)
        self._connection.on(LiveTranscriptionEvents.SpeechStarted, _on_speech_started)
        self._connection.on(LiveTranscriptionEvents.UtteranceEnd, _on_utterance_end)
        self._connection.on(LiveTranscriptionEvents.Error, _on_error)

        options = LiveOptions(
            model="nova-2",
            language="en-US",
            smart_format=True,
            interim_results=True,
            encoding="linear16",
            sample_rate=16000,
            channels=1,
            punctuate=True,
            vad_events=True,
            endpointing=800,
            utterance_end_ms=2500,
        )
        if not self._connection.start(options):
            raise RuntimeError("Failed to start Deepgram connection")

    def send(self, audio_bytes: bytes) -> None:
        if self._connection:
            self._connection.send(audio_bytes)

    async def stop(self) -> None:
        if self._connection:
            self._connection.finish()
            self._connection = None
