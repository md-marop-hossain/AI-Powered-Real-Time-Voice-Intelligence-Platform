"""Tests for invite-service helpers — token generation, expiry math,
attempt counting, and validation rules.

DB-free: builds bare InterviewInvite instances in memory and exercises the
pure validation logic.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.invites.service import (
    InviteValidationError,
    attempts_remaining,
    expiry_from_hours,
    generate_invite_token,
    validate_invite,
)
from app.models.interview_invite import InterviewInvite, InviteStatus


def _invite(
    *,
    expires_in_hours: float = 24,
    status: InviteStatus = InviteStatus.active,
    max_attempts: int = 1,
    attempts_used: int = 0,
) -> InterviewInvite:
    inv = InterviewInvite()
    inv.expires_at = datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)
    inv.status = status
    inv.max_attempts = max_attempts
    inv.attempts_used = attempts_used
    return inv


def test_generate_invite_token_is_url_safe_and_distinct():
    a = generate_invite_token()
    b = generate_invite_token()
    assert a != b
    assert len(a) >= 32
    # token_urlsafe alphabet — no characters that need URL-encoding
    for ch in a:
        assert ch.isalnum() or ch in "-_"


def test_expiry_from_hours_uses_provided_value():
    out = expiry_from_hours(48)
    delta = out - datetime.now(timezone.utc)
    assert timedelta(hours=47, minutes=55) < delta < timedelta(hours=48, minutes=5)


def test_expiry_from_hours_falls_back_to_default_for_invalid():
    # Negative / zero falls back to settings default
    out = expiry_from_hours(0)
    assert out > datetime.now(timezone.utc)


def test_validate_invite_passes_for_healthy_invite():
    inv = _invite()
    assert validate_invite(inv) is inv


def test_validate_invite_rejects_none_with_not_found_code():
    with pytest.raises(InviteValidationError) as exc:
        validate_invite(None)
    assert exc.value.code == "not_found"


def test_validate_invite_rejects_revoked():
    inv = _invite(status=InviteStatus.revoked)
    with pytest.raises(InviteValidationError) as exc:
        validate_invite(inv)
    assert exc.value.code == "revoked"


def test_validate_invite_rejects_expired():
    inv = _invite(expires_in_hours=-1)
    with pytest.raises(InviteValidationError) as exc:
        validate_invite(inv)
    assert exc.value.code == "expired"


def test_validate_invite_rejects_attempts_exhausted():
    inv = _invite(max_attempts=2, attempts_used=2)
    with pytest.raises(InviteValidationError) as exc:
        validate_invite(inv)
    assert exc.value.code == "no_attempts"


def test_attempts_remaining_basic():
    assert attempts_remaining(_invite(max_attempts=3, attempts_used=1)) == 2


def test_attempts_remaining_clamps_to_zero():
    # If somehow attempts_used > max_attempts, never go negative.
    assert attempts_remaining(_invite(max_attempts=1, attempts_used=5)) == 0


def test_validate_invite_handles_naive_expiry():
    """Expiry stored as a naive datetime should still be accepted and
    interpreted as UTC — covers the legacy DB shape gracefully."""
    inv = _invite()
    # Force a naive value identical in UTC clock-time to the aware one
    inv.expires_at = inv.expires_at.replace(tzinfo=None)
    assert validate_invite(inv) is inv
