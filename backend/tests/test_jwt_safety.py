"""Tests for the JWT_SECRET startup safety check (Bug 6 fix).

Builds bare Settings instances directly so we don't depend on the live
`.env` — that way these tests are deterministic regardless of what the
developer has configured locally.
"""

from __future__ import annotations

import logging

import pytest

from app.core.config import Settings


def _settings(*, env: str, secret: str) -> Settings:
    return Settings(ENV=env, JWT_SECRET=secret)


# ---------- Insecure secrets ----------


@pytest.mark.parametrize("bad", ["change-me", "change-me-to-a-long-random-string", "secret", ""])
def test_assert_raises_in_production_for_known_placeholders(bad: str):
    s = _settings(env="production", secret=bad)
    with pytest.raises(RuntimeError):
        s.assert_jwt_secret_is_safe()


def test_assert_raises_in_production_for_short_secret():
    s = _settings(env="production", secret="abc12345")  # only 8 chars
    with pytest.raises(RuntimeError):
        s.assert_jwt_secret_is_safe()


def test_assert_raises_in_staging_for_placeholder():
    s = _settings(env="staging", secret="change-me")
    with pytest.raises(RuntimeError):
        s.assert_jwt_secret_is_safe()


# ---------- Safe secrets ----------


def test_assert_passes_in_production_for_strong_secret():
    s = _settings(env="production", secret="x" * 64)
    s.assert_jwt_secret_is_safe()  # must not raise


def test_assert_passes_in_development_even_with_placeholder(caplog):
    s = _settings(env="development", secret="change-me")
    with caplog.at_level(logging.WARNING):
        s.assert_jwt_secret_is_safe()
    # Loud warning so devs know they're using a known-public secret
    assert any("JWT_SECRET" in r.message for r in caplog.records)


def test_assert_passes_in_development_with_strong_secret_silently(caplog):
    s = _settings(env="development", secret="x" * 64)
    with caplog.at_level(logging.WARNING):
        s.assert_jwt_secret_is_safe()
    # Strong secret -> no warning even in dev
    assert not any("JWT_SECRET" in r.message for r in caplog.records)
