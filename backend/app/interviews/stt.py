"""Deepgram streaming STT client wrapper.

Maintains a single live connection per session. Forwards browser PCM/audio
frames to Deepgram and yields final transcripts via an asyncio queue.
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


class DeepgramSTT:
    def __init__(self, on_final: Callable[[str], Awaitable[None]]):
        self._on_final = on_final
        self._dg = DeepgramClient(
            settings.DEEPGRAM_API_KEY,
            DeepgramClientOptions(options={"keepalive": "true"}),
        )
        self._connection = None
        self._loop = asyncio.get_event_loop()

    async def start(self) -> None:
        self._connection = self._dg.listen.live.v("1")

        def _on_transcript(_self, result, **_kwargs):
            try:
                alt = result.channel.alternatives[0]
                transcript = alt.transcript or ""
                if result.is_final and transcript.strip():
                    asyncio.run_coroutine_threadsafe(
                        self._on_final(transcript), self._loop
                    )
            except Exception as e:
                log.exception("Deepgram transcript handler error: %s", e)

        def _on_error(_self, error, **_kwargs):
            log.error("Deepgram error: %s", error)

        self._connection.on(LiveTranscriptionEvents.Transcript, _on_transcript)
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
