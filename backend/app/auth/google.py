"""Verify Google ID tokens server-side. Never trust client-claimed identity."""

from __future__ import annotations

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from app.core.config import settings


class GoogleVerificationError(Exception):
    pass


def verify_google_id_token(token: str) -> dict:
    """Returns verified claims dict (sub, email, name, etc.) or raises."""
    if not settings.GOOGLE_CLIENT_ID:
        raise GoogleVerificationError("GOOGLE_CLIENT_ID not configured")
    try:
        claims = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )
    except ValueError as e:
        raise GoogleVerificationError(str(e)) from e

    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise GoogleVerificationError("Invalid issuer")
    if not claims.get("email_verified"):
        raise GoogleVerificationError("Google account email not verified")
    return claims
