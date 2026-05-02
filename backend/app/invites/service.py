"""Invitation lifecycle helpers: token generation, validation, attempt control."""

from __future__ import annotations

import structlog
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.interview_invite import (
    InterviewInvite,
    Invitee,
    InviteeStatus,
    InviteStatus,
)
from app.models.session import Session

log = structlog.get_logger()


def generate_invite_token() -> str:
    """Return a URL-safe, high-entropy token (~43 chars from 32 random bytes)."""
    return secrets.token_urlsafe(32)


def default_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=settings.INVITE_EXPIRY_HOURS)


def expiry_from_hours(hours: int | None) -> datetime:
    h = hours if hours and hours > 0 else settings.INVITE_EXPIRY_HOURS
    return datetime.now(timezone.utc) + timedelta(hours=h)


class InviteValidationError(Exception):
    """Raised when an invite token is unusable. Carries a stable code for the API layer."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def validate_invite(invite: InterviewInvite | None) -> InterviewInvite:
    """Verify the invite is usable. Raises InviteValidationError on failure."""
    if invite is None:
        raise InviteValidationError("not_found", "Invite link is invalid.")
    if invite.status == InviteStatus.revoked:
        raise InviteValidationError("revoked", "This invite has been revoked.")
    now = datetime.now(timezone.utc)
    if invite.starts_at is not None:
        starts_at = invite.starts_at
        if starts_at.tzinfo is None:
            starts_at = starts_at.replace(tzinfo=timezone.utc)
        if now < starts_at:
            raise InviteValidationError(
                "not_open",
                f"This interview window opens at {starts_at.strftime('%Y-%m-%d %H:%M UTC')}.",
            )
    expires_at = invite.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise InviteValidationError("expired", "This invite has expired.")
    if invite.attempts_used >= invite.max_attempts:
        raise InviteValidationError(
            "no_attempts", "No attempts remaining for this invite."
        )
    return invite


def attempts_remaining(invite: InterviewInvite) -> int:
    return max(0, invite.max_attempts - invite.attempts_used)


def build_invite_url(token: str) -> str:
    base = settings.FRONTEND_URL.rstrip("/")
    return f"{base}/invite/{token}"


async def mark_invitee_completed_for_session(
    db: AsyncSession, session: Session
) -> None:
    """If `session` was started from an invite, flip the matching Invitee row
    to `completed`. No-op for sessions not linked to an invite.

    Caller is responsible for committing — this only stages the change so it
    rides on whichever transaction the caller already owns.
    """
    if session.invite_id is None:
        return
    res = await db.execute(
        select(Invitee).where(
            Invitee.invite_id == session.invite_id,
            Invitee.user_id == session.user_id,
        )
    )
    invitee = res.scalar_one_or_none()
    if invitee is None:
        log.debug(
            "No invitee row to mark completed for session %s (invite=%s, user=%s)",
            session.id,
            session.invite_id,
            session.user_id,
        )
        return
    if invitee.status != InviteeStatus.completed:
        invitee.status = InviteeStatus.completed
