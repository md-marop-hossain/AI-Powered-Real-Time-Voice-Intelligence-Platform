import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.auth.google import GoogleVerificationError, verify_google_id_token
from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession
from app.core.email import send_otp_email, send_password_reset_email
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_otp,
    generate_reset_token,
    hash_password,
    verify_otp,
    verify_password,
    verify_reset_token,
)
from app.core.storage import delete_object
from app.models.email_verification_token import EmailVerificationToken
from app.models.password_reset_token import PasswordResetToken
from app.models.resume import Resume
from app.models.session import Session, SessionStatus
from app.models.user import AuthProvider, User
from app.schemas.auth import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    ForgotPasswordRequest,
    GoogleLoginRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    RegisterResponse,
    ResendOtpRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdateProfileRequest,
    UserResponse,
    VerifyEmailRequest,
)

OTP_EXPIRE_MINUTES = 10
OTP_MAX_ATTEMPTS = 5

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


def _make_token_pair(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(str(user.id), {"email": user.email}),
        refresh_token=create_refresh_token(str(user.id)),
    )


async def _issue_otp(db, user: User) -> str:
    """Invalidate previous OTPs for the user, create a new one, return raw code."""
    existing = await db.execute(
        select(EmailVerificationToken).where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.used == False,  # noqa: E712
        )
    )
    for tok in existing.scalars().all():
        tok.used = True

    raw, hashed = generate_otp()
    record = EmailVerificationToken(
        user_id=user.id,
        code_hash=hashed,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRE_MINUTES),
    )
    db.add(record)
    await db.commit()
    return raw


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest, db: DbSession) -> RegisterResponse:
    email = body.email.lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=email,
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        auth_provider=AuthProvider.manual,
        email_verified=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    code = await _issue_otp(db, user)
    try:
        await send_otp_email(user.email, code, user.full_name)
    except Exception:
        # Don't fail registration if SMTP is misconfigured; user can resend.
        pass

    return RegisterResponse(
        message="A 6-digit verification code has been sent to your email.",
        email=user.email,
    )


@router.post("/verify-email", response_model=TokenResponse)
@limiter.limit("10/minute")
async def verify_email(
    request: Request, body: VerifyEmailRequest, db: DbSession
) -> TokenResponse:
    email = body.email.lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid email or code")

    if user.email_verified:
        raise HTTPException(status_code=400, detail="Email already verified")

    now = datetime.now(timezone.utc)
    tok_q = await db.execute(
        select(EmailVerificationToken)
        .where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.used == False,  # noqa: E712
            EmailVerificationToken.expires_at > now,
        )
        .order_by(EmailVerificationToken.created_at.desc())
    )
    token = tok_q.scalars().first()
    if not token:
        raise HTTPException(status_code=400, detail="Code expired. Please request a new one.")

    if token.attempts >= OTP_MAX_ATTEMPTS:
        token.used = True
        await db.commit()
        raise HTTPException(status_code=400, detail="Too many attempts. Please request a new code.")

    token.attempts += 1
    if not verify_otp(body.code, token.code_hash):
        await db.commit()
        raise HTTPException(status_code=400, detail="Invalid code")

    token.used = True
    user.email_verified = True
    await db.commit()
    await db.refresh(user)
    return _make_token_pair(user)


@router.post("/resend-otp", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("3/minute")
async def resend_otp(request: Request, body: ResendOtpRequest, db: DbSession) -> None:
    email = body.email.lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    # Silently succeed if user doesn't exist or is already verified — avoid enumeration.
    if not user or user.email_verified:
        return None

    code = await _issue_otp(db, user)
    try:
        await send_otp_email(user.email, code, user.full_name)
    except Exception:
        pass


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: DbSession) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == body.email.lower()))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="email_not_verified")
    return _make_token_pair(user)


@router.post("/google", response_model=TokenResponse)
@limiter.limit("10/minute")
async def google_login(
    request: Request, body: GoogleLoginRequest, db: DbSession
) -> TokenResponse:
    try:
        claims = verify_google_id_token(body.id_token)
    except GoogleVerificationError as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {e}")

    email = claims["email"].lower()
    google_sub = claims["sub"]
    full_name = claims.get("name") or email.split("@")[0]

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user:
        # Link the existing manual account to Google.
        if user.auth_provider == AuthProvider.manual:
            user.auth_provider = AuthProvider.both
        if not user.google_sub:
            user.google_sub = google_sub
        user.email_verified = True
    else:
        user = User(
            email=email,
            password_hash=None,
            full_name=full_name,
            auth_provider=AuthProvider.google,
            google_sub=google_sub,
            email_verified=True,
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)
    return _make_token_pair(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: DbSession) -> TokenResponse:
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user_id = payload.get("sub")
    try:
        uid = UUID(user_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return _make_token_pair(user)


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("3/minute")
async def forgot_password(
    request: Request, body: ForgotPasswordRequest, db: DbSession
) -> None:
    result = await db.execute(select(User).where(User.email == body.email.lower()))
    user = result.scalar_one_or_none()
    # Always return 204 to avoid email enumeration.
    if not user or not user.password_hash:
        return None

    raw, hashed = generate_reset_token()
    token_row = PasswordResetToken(
        user_id=user.id,
        token_hash=hashed,
        expires_at=datetime.now(timezone.utc)
        + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES),
    )
    db.add(token_row)
    await db.commit()
    try:
        await send_password_reset_email(user.email, raw, user.full_name)
    except Exception:
        # Don't fail the request if SMTP is misconfigured locally; log out-of-band.
        pass


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
async def reset_password(
    request: Request, body: ResetPasswordRequest, db: DbSession
) -> None:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.used == False,  # noqa: E712
            PasswordResetToken.expires_at > now,
        )
    )
    candidates = result.scalars().all()

    for tok in candidates:
        if verify_reset_token(body.token, tok.token_hash):
            user_q = await db.execute(select(User).where(User.id == tok.user_id))
            user = user_q.scalar_one_or_none()
            if not user:
                raise HTTPException(status_code=400, detail="Invalid token")
            user.password_hash = hash_password(body.new_password)
            tok.used = True
            await db.commit()
            return None

    raise HTTPException(status_code=400, detail="Invalid or expired token")


@router.get("/me", response_model=UserResponse)
async def me(current_user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UpdateProfileRequest, current_user: CurrentUser, db: DbSession
) -> UserResponse:
    current_user.full_name = body.full_name.strip()
    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
async def change_password(
    request: Request,
    body: ChangePasswordRequest,
    current_user: CurrentUser,
    db: DbSession,
) -> None:
    if not current_user.password_hash:
        raise HTTPException(
            status_code=400,
            detail=(
                "This account doesn't have a password set yet. "
                "Use the 'Forgot password' flow on the sign-in page to set one."
            ),
        )
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=400, detail="New password must be different from the current one"
        )
    current_user.password_hash = hash_password(body.new_password)
    await db.commit()


@router.get("/me/stats")
async def my_stats(current_user: CurrentUser, db: DbSession) -> dict:
    """Aggregated practice metrics for the current user."""
    sessions_q = await db.execute(
        select(Session).where(Session.user_id == current_user.id)
    )
    sessions = sessions_q.scalars().all()

    total = len(sessions)
    completed = [s for s in sessions if s.status == SessionStatus.completed]
    completed_count = len(completed)
    total_minutes = sum(s.duration_minutes or 0 for s in completed)

    overall_scores = []
    for s in completed:
        score = (s.final_scores or {}).get("overall_score")
        if isinstance(score, (int, float)):
            overall_scores.append(float(score))
    avg_score = sum(overall_scores) / len(overall_scores) if overall_scores else None
    best_score = max(overall_scores) if overall_scores else None

    last_session_at = max(
        (s.created_at for s in sessions), default=None
    ) if sessions else None

    resumes_count_q = await db.execute(
        select(func.count(Resume.id)).where(Resume.user_id == current_user.id)
    )
    resumes_count = resumes_count_q.scalar() or 0

    # Roles practiced — distinct list, most recent first.
    roles_seen: list[str] = []
    seen: set[str] = set()
    for s in sorted(sessions, key=lambda s: s.created_at, reverse=True):
        key = (s.role or "").strip()
        if key and key.lower() not in seen:
            seen.add(key.lower())
            roles_seen.append(key)
        if len(roles_seen) >= 5:
            break

    return {
        "sessions_total": total,
        "sessions_completed": completed_count,
        "total_practice_minutes": total_minutes,
        "avg_overall_score": round(avg_score, 2) if avg_score is not None else None,
        "best_overall_score": round(best_score, 2) if best_score is not None else None,
        "resumes_count": resumes_count,
        "member_since": current_user.created_at.isoformat()
        if current_user.created_at
        else None,
        "last_session_at": last_session_at.isoformat() if last_session_at else None,
        "recent_roles": roles_seen,
    }


@router.get("/me/export")
async def export_my_data(current_user: CurrentUser, db: DbSession) -> Response:
    """Download every piece of user-owned data as a single JSON file."""
    resumes_q = await db.execute(
        select(Resume).where(Resume.user_id == current_user.id)
    )
    resumes = resumes_q.scalars().all()

    sessions_q = await db.execute(
        select(Session)
        .where(Session.user_id == current_user.id)
        .options(selectinload(Session.turns))
    )
    sessions = sessions_q.scalars().all()

    def _provider(p):
        return p.value if hasattr(p, "value") else p

    def _status(s):
        return s.value if hasattr(s, "value") else s

    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user": {
            "id": str(current_user.id),
            "email": current_user.email,
            "full_name": current_user.full_name,
            "auth_provider": _provider(current_user.auth_provider),
            "email_verified": current_user.email_verified,
            "created_at": current_user.created_at.isoformat(),
        },
        "resumes": [
            {
                "id": str(r.id),
                "filename": r.filename,
                "size_bytes": r.size_bytes,
                "content_type": r.content_type,
                "parsed": r.parsed,
                "raw_text": r.raw_text,
                "created_at": r.created_at.isoformat(),
            }
            for r in resumes
        ],
        "sessions": [
            {
                "id": str(s.id),
                "role": s.role,
                "seniority": s.seniority,
                "focus": s.focus,
                "industry": s.industry,
                "duration_minutes": s.duration_minutes,
                "status": _status(s.status),
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
                "final_scores": s.final_scores,
                "created_at": s.created_at.isoformat(),
                "turns": [
                    {
                        "index": t.index,
                        "question": t.question,
                        "question_kind": t.question_kind,
                        "answer": t.answer,
                        "scores": t.scores,
                        "rationale": t.rationale,
                        "asked_at": t.asked_at.isoformat() if t.asked_at else None,
                        "answered_at": t.answered_at.isoformat()
                        if t.answered_at
                        else None,
                    }
                    for t in (s.turns or [])
                ],
            }
            for s in sessions
        ],
    }

    body = json.dumps(payload, indent=2, ensure_ascii=False)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"rehearsal-export-{stamp}.json"
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("3/minute")
async def delete_my_account(
    request: Request,
    body: DeleteAccountRequest,
    current_user: CurrentUser,
    db: DbSession,
) -> None:
    """Permanently delete the current user and ALL of their data."""
    if current_user.password_hash:
        if not body.password:
            raise HTTPException(
                status_code=400, detail="Password required to delete this account."
            )
        if not verify_password(body.password, current_user.password_hash):
            raise HTTPException(status_code=401, detail="Password is incorrect.")
    else:
        if (body.confirm or "").strip().upper() != "DELETE MY ACCOUNT":
            raise HTTPException(
                status_code=400,
                detail='To delete this account, type "delete my account" exactly.',
            )

    # Best-effort cleanup of object storage. DB cascade handles the rest.
    resumes_q = await db.execute(
        select(Resume).where(Resume.user_id == current_user.id)
    )
    for r in resumes_q.scalars().all():
        delete_object(r.storage_key)

    sessions_q = await db.execute(
        select(Session)
        .where(Session.user_id == current_user.id)
        .options(selectinload(Session.report))
    )
    for s in sessions_q.scalars().all():
        if s.report and s.report.pdf_key:
            delete_object(s.report.pdf_key)

    await db.delete(current_user)
    await db.commit()
