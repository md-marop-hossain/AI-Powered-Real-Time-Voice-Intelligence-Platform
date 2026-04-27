from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select

from app.auth.google import GoogleVerificationError, verify_google_id_token
from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession
from app.core.email import send_password_reset_email
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_reset_token,
    hash_password,
    verify_password,
    verify_reset_token,
)
from app.models.password_reset_token import PasswordResetToken
from app.models.user import AuthProvider, User
from app.schemas.auth import (
    ForgotPasswordRequest,
    GoogleLoginRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


def _make_token_pair(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(str(user.id), {"email": user.email}),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest, db: DbSession) -> TokenResponse:
    existing = await db.execute(select(User).where(User.email == body.email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        auth_provider=AuthProvider.manual,
        email_verified=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _make_token_pair(user)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: DbSession) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == body.email.lower()))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
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
