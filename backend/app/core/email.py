"""Email sending via fastapi-mail (MailHog locally)."""

from __future__ import annotations

from fastapi_mail import ConnectionConfig, FastMail, MessageSchema, MessageType

from app.core.config import settings

conf = ConnectionConfig(
    MAIL_USERNAME=settings.SMTP_USER or "noreply",
    MAIL_PASSWORD=settings.SMTP_PASSWORD or "",
    MAIL_FROM=settings.SMTP_FROM,
    MAIL_PORT=settings.SMTP_PORT,
    MAIL_SERVER=settings.SMTP_HOST,
    MAIL_STARTTLS=False,
    MAIL_SSL_TLS=False,
    USE_CREDENTIALS=bool(settings.SMTP_USER),
    VALIDATE_CERTS=False,
)


async def send_password_reset_email(to_email: str, reset_token: str, full_name: str) -> None:
    reset_link = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
    body = f"""
    <html>
      <body style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset</h2>
        <p>Hi {full_name},</p>
        <p>Click the link below to reset your password. This link expires in 1 hour.</p>
        <p><a href="{reset_link}" style="background:#4f46e5;color:#fff;padding:10px 20px;
           text-decoration:none;border-radius:6px;">Reset password</a></p>
        <p>If the button doesn't work: <code>{reset_link}</code></p>
        <p>If you didn't request this, ignore this email.</p>
      </body>
    </html>
    """
    message = MessageSchema(
        subject="Reset your AI Mock Interview password",
        recipients=[to_email],
        body=body,
        subtype=MessageType.html,
    )
    fm = FastMail(conf)
    await fm.send_message(message)
