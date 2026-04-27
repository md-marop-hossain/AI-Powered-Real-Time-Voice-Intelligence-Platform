"""ElevenLabs streaming TTS — produces MP3 chunks for the browser."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from app.core.config import settings


async def stream_tts(text: str) -> AsyncIterator[bytes]:
    """Async generator yielding MP3 chunks for the given text."""
    if not settings.ELEVENLABS_API_KEY:
        # Silent fallback: yield nothing (frontend handles missing audio gracefully).
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
