"""Deepgram streaming STT client wrapper.

Maintains a single live connection per session. Forwards browser PCM audio
frames to Deepgram and emits four kinds of events back to the orchestrator:
  * speech_started   - VAD heard speech onset
  * interim          - partial transcript while user is speaking
  * final            - final transcript (committed once user pauses)
  * utterance_end    - VAD heard prolonged silence (~1s) — user finished speaking
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from deepgram import (
    DeepgramClient,
    DeepgramClientOptions,
    LiveOptions,
    LiveTranscriptionEvents,
)

from app.core.config import settings

log = logging.getLogger(__name__)

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

    def _schedule(self, coro):
        """Schedule a coroutine on the main event loop from a Deepgram callback thread."""
        try:
            asyncio.run_coroutine_threadsafe(coro, self._loop)
        except Exception as e:
            log.exception("Failed to schedule STT callback: %s", e)

    async def start(self) -> None:
        self._connection = self._dg.listen.live.v("1")

        def _on_transcript(_self, result, **_kwargs):
            try:
                alt = result.channel.alternatives[0]
                transcript = (alt.transcript or "").strip()
                if not transcript:
                    return
                if result.is_final:
                    self._schedule(self._on_final(transcript))
                elif self._on_interim:
                    self._schedule(self._on_interim(transcript))
            except Exception as e:
                log.exception("Deepgram transcript handler error: %s", e)

        def _on_speech_started(_self, _event, **_kwargs):
            if self._on_speech_started:
                self._schedule(self._on_speech_started())

        def _on_utterance_end(_self, _event, **_kwargs):
            if self._on_utterance_end:
                self._schedule(self._on_utterance_end())

        def _on_error(_self, error, **_kwargs):
            log.error("Deepgram error: %s", error)

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
            endpointing=600,
            utterance_end_ms=1000,
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
