"""Pluggable LLM provider abstraction supporting Groq and OpenAI.

Both providers expose OpenAI-compatible chat APIs. The abstraction is intentionally
thin — keep the request/response shape identical and force JSON mode for
structured outputs.
"""

from __future__ import annotations

from typing import Any, Protocol

from app.core.config import settings


class LLMProvider(Protocol):
    async def chat(
        self,
        messages: list[dict[str, str]],
        response_format: dict | None = None,
        temperature: float = 0.7,
    ) -> str: ...


class GroqProvider:
    def __init__(self, api_key: str, model: str):
        from groq import AsyncGroq

        self.client = AsyncGroq(api_key=api_key)
        self.model = model

    async def chat(
        self,
        messages: list[dict[str, str]],
        response_format: dict | None = None,
        temperature: float = 0.7,
    ) -> str:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if response_format is not None:
            kwargs["response_format"] = response_format
        resp = await self.client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content or ""


class OpenAIProvider:
    def __init__(self, api_key: str, model: str):
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model

    async def chat(
        self,
        messages: list[dict[str, str]],
        response_format: dict | None = None,
        temperature: float = 0.7,
    ) -> str:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if response_format is not None:
            kwargs["response_format"] = response_format
        resp = await self.client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content or ""


_provider_singleton: LLMProvider | None = None


def get_llm_provider() -> LLMProvider:
    global _provider_singleton
    if _provider_singleton is not None:
        return _provider_singleton

    name = settings.LLM_PROVIDER.lower()
    if name == "groq":
        if not settings.GROQ_API_KEY:
            raise ValueError("GROQ_API_KEY is required when LLM_PROVIDER=groq")
        _provider_singleton = GroqProvider(settings.GROQ_API_KEY, settings.LLM_MODEL)
    elif name == "openai":
        if not settings.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY is required when LLM_PROVIDER=openai")
        _provider_singleton = OpenAIProvider(settings.OPENAI_API_KEY, settings.LLM_MODEL)
    else:
        raise ValueError(f"Unknown LLM_PROVIDER: {name}")
    return _provider_singleton


JSON_RESPONSE = {"type": "json_object"}
