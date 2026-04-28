"""Streaming TTS — produces MP3 chunks for the browser.

Pluggable provider: set TTS_PROVIDER to "elevenlabs" or "openai" in .env.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from app.core.config import settings

log = logging.getLogger(__name__)


async def stream_tts(text: str) -> AsyncIterator[bytes]:
    """Async generator yielding MP3 chunks for the given text."""
    provider = settings.TTS_PROVIDER.lower()
    try:
        if provider == "openai":
            async for chunk in _stream_openai(text):
                yield chunk
        else:
            async for chunk in _stream_elevenlabs(text):
                yield chunk
    except Exception as e:
        # Bubble up nothing — the websocket layer logs the failure and proceeds without audio.
        log.warning("TTS stream failed (%s): %s", provider, e)
        return


async def _stream_elevenlabs(text: str) -> AsyncIterator[bytes]:
    if not settings.ELEVENLABS_API_KEY:
        return

    from elevenlabs.client import AsyncElevenLabs

    client = AsyncElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
    audio_stream = client.text_to_speech.convert(
        voice_id=settings.ELEVENLABS_VOICE_ID,
        text=text,
        model_id="eleven_turbo_v2_5",
        output_format="mp3_44100_128",
    )
    async for chunk in audio_stream:
        if chunk:
            yield chunk
            await asyncio.sleep(0)


async def _stream_openai(text: str) -> AsyncIterator[bytes]:
    if not settings.OPENAI_API_KEY:
        return

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    async with client.audio.speech.with_streaming_response.create(
        model=settings.OPENAI_TTS_MODEL,
        voice=settings.OPENAI_TTS_VOICE,
        input=text,
        response_format="mp3",
    ) as response:
        async for chunk in response.iter_bytes(chunk_size=4096):
            if chunk:
                yield chunk
                await asyncio.sleep(0)
