"""Async Redis client — lazy singleton shared across the app.

Usage:
    from app.core.redis_client import get_redis

    redis = await get_redis()
    await redis.setex("key", 3600, "value")
"""

from __future__ import annotations

import logging

import redis.asyncio as aioredis

from app.core.config import settings

log = logging.getLogger(__name__)

_client: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    """Return the shared async Redis client, creating it on first call."""
    global _client
    if _client is None:
        _client = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=3,
        )
    return _client


async def close_redis() -> None:
    """Gracefully close the Redis connection (call on app shutdown)."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
