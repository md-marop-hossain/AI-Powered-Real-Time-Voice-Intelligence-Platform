"""Email sending via fastapi-mail."""

from __future__ import annotations

from fastapi_mail import ConnectionConfig, FastMail, MessageSchema, MessageType

from app.core.config import settings

conf = ConnectionConfig(
    MAIL_USERNAME=settings.SMTP_USER,
    MAIL_PASSWORD=settings.SMTP_PASSWORD,
    MAIL_FROM=settings.SMTP_FROM,
    MAIL_PORT=settings.SMTP_PORT,
    MAIL_SERVER=settings.SMTP_HOST,
    MAIL_STARTTLS=True,
    MAIL_SSL_TLS=False,
    USE_CREDENTIALS=True,
    VALIDATE_CERTS=True,
)

BRAND_NAME = "Rehearsal"
BRAND_TAGLINE = "A rehearsal room for interviews"
BRAND_ESTABLISHED = "EST. 2026"
INK = "#111111"
INK_SOFT = "#3a3a3a"
INK_MUTED = "#7a7a7a"
RULE = "#e5e5e5"
CANVAS = "#fafaf7"
ACCENT = "#c8553d"  # vermillion


def _layout(preheader: str, content_html: str) -> str:
    """Wrap an email body in a consistent branded layout (email-safe HTML)."""
    site_url = settings.FRONTEND_URL
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <title>{BRAND_NAME}</title>
  </head>
  <body style="margin:0;padding:0;background:{CANVAS};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:{INK};">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;font-size:1px;line-height:1px;mso-hide:all;">{preheader}</span>
    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:{CANVAS};padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid {RULE};border-radius:4px;">
            <tr>
              <td style="padding:32px 40px 24px 40px;border-bottom:1px solid {RULE};">
                <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:500;color:{INK};letter-spacing:-0.01em;">
                      <a href="{site_url}" style="color:{INK};text-decoration:none;">{BRAND_NAME}</a>
                    </td>
                    <td align="right" style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:{INK_MUTED};">
                      {BRAND_ESTABLISHED}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:40px 40px 32px 40px;">
                {content_html}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 32px 40px;border-top:1px solid {RULE};">
                <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:{INK_MUTED};">
                      {BRAND_TAGLINE}
                    </td>
                    <td align="right" style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:{INK_MUTED};">
                      <a href="{site_url}" style="color:{INK_MUTED};text-decoration:none;">{site_url.replace('https://','').replace('http://','')}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:18px 0 0 0;font-size:12px;line-height:1.6;color:{INK_MUTED};">
                  You're receiving this because someone — hopefully you — used this email at {BRAND_NAME}.
                  If it wasn't you, no action is needed; this message can be safely ignored.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:11px;color:{INK_MUTED};letter-spacing:0.04em;">
            &copy; {BRAND_NAME}. All rights reserved.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>"""


async def send_otp_email(to_email: str, code: str, full_name: str) -> None:
    preheader = f"Your {BRAND_NAME} verification code is {code}. It expires in 10 minutes."
    content = f"""
        <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:{INK_MUTED};">
          Verify your email
        </p>
        <h1 style="margin:0 0 24px 0;font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:400;line-height:1.2;color:{INK};letter-spacing:-0.01em;">
          One last step, {full_name}.
        </h1>
        <p style="margin:0 0 32px 0;font-size:15px;line-height:1.7;color:{INK_SOFT};">
          Use the code below to confirm this email belongs to you. It's valid for the next
          <strong style="color:{INK};">10 minutes</strong>.
        </p>
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
          <tr>
            <td align="center" style="background:{CANVAS};border:1px solid {RULE};border-radius:4px;padding:28px 16px;">
              <div style="font-family:'SF Mono','Menlo','Consolas',monospace;font-size:36px;font-weight:600;letter-spacing:14px;color:{INK};padding-left:14px;">
                {code}
              </div>
              <div style="margin-top:10px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:{INK_MUTED};">
                Verification code
              </div>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;color:{INK_SOFT};">
          Didn't ask for this? You can safely ignore the email — your account stays as it is.
        </p>
        <p style="margin:24px 0 0 0;padding-top:24px;border-top:1px solid {RULE};font-size:13px;line-height:1.7;color:{INK_MUTED};">
          For your security, never share this code with anyone. {BRAND_NAME} staff will never ask for it.
        </p>
    """
    message = MessageSchema(
        subject=f"Your {BRAND_NAME} verification code: {code}",
        recipients=[to_email],
        body=_layout(preheader, content),
        subtype=MessageType.html,
    )
    await FastMail(conf).send_message(message)


async def send_invite_email(
    to_email: str,
    invite_url: str,
    role: str,
    duration_minutes: int,
    expires_at_human: str,
    inviter_name: str | None = None,
) -> None:
    """Send an interview invitation link to a candidate."""
    inviter = inviter_name or "Someone"
    preheader = (
        f"{inviter} invited you to a {role} mock interview on {BRAND_NAME}. "
        f"Link expires {expires_at_human}."
    )
    content = f"""
        <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:{INK_MUTED};">
          You're invited
        </p>
        <h1 style="margin:0 0 24px 0;font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:400;line-height:1.2;color:{INK};letter-spacing:-0.01em;">
          A mock interview is waiting for you.
        </h1>
        <p style="margin:0 0 24px 0;font-size:15px;line-height:1.7;color:{INK_SOFT};">
          {inviter} has invited you to a <strong style="color:{INK};">{role}</strong> mock
          interview on {BRAND_NAME}. The session runs about
          <strong style="color:{INK};">{duration_minutes} minutes</strong> and is conducted by
          our AI voice interviewer — you'll just need a quiet room and a working mic.
        </p>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
          <tr>
            <td align="center" style="background:{INK};border-radius:2px;">
              <a href="{invite_url}" style="display:inline-block;padding:14px 28px;font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#ffffff;text-decoration:none;">
                Start interview &rarr;
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:{INK_MUTED};">
          Or paste this link into your browser:
        </p>
        <p style="margin:0 0 24px 0;font-size:12px;line-height:1.5;color:{INK_SOFT};word-break:break-all;font-family:'SF Mono','Menlo','Consolas',monospace;background:{CANVAS};padding:12px 14px;border:1px solid {RULE};border-radius:3px;">
          {invite_url}
        </p>
        <p style="margin:0 0 4px 0;font-size:13px;line-height:1.7;color:{INK_SOFT};">
          <strong style="color:{INK};">Heads up:</strong> the link expires on
          <strong style="color:{INK};">{expires_at_human}</strong> and can be used a limited
          number of times. If you're not signed in already, you'll be asked to log in or sign
          up before the interview begins.
        </p>
        <p style="margin:24px 0 0 0;padding-top:24px;border-top:1px solid {RULE};font-size:13px;line-height:1.7;color:{INK_MUTED};">
          Not expecting this? You can safely ignore the email.
        </p>
    """
    message = MessageSchema(
        subject=f"{inviter} invited you to a mock interview on {BRAND_NAME}",
        recipients=[to_email],
        body=_layout(preheader, content),
        subtype=MessageType.html,
    )
    await FastMail(conf).send_message(message)


async def send_completion_notification_email(
    to_email: str,
    creator_name: str,
    candidate_name: str,
    candidate_email: str,
    role: str,
    overall_score: float | None,
    results_url: str,
) -> None:
    """Notify the creator that one of their invited candidates finished an interview.

    `overall_score` may be None if the session ended before any answer was scored
    (e.g., focus violations); the email handles both shapes.
    """
    score_text = (
        f"{overall_score:.1f}/10" if isinstance(overall_score, (int, float)) else "—"
    )
    preheader = (
        f"{candidate_name} just finished a {role} mock interview on {BRAND_NAME}. "
        f"Overall score: {score_text}."
    )
    content = f"""
        <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:{INK_MUTED};">
          Interview completed
        </p>
        <h1 style="margin:0 0 24px 0;font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:400;line-height:1.2;color:{INK};letter-spacing:-0.01em;">
          A candidate just finished, {creator_name}.
        </h1>
        <p style="margin:0 0 24px 0;font-size:15px;line-height:1.7;color:{INK_SOFT};">
          <strong style="color:{INK};">{candidate_name}</strong>
          (<span style="color:{INK_MUTED};">{candidate_email}</span>)
          completed the <strong style="color:{INK};">{role}</strong> mock interview you sent.
        </p>
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
          <tr>
            <td align="center" style="background:{CANVAS};border:1px solid {RULE};border-radius:4px;padding:24px 16px;">
              <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:{INK_MUTED};margin-bottom:6px;">
                Overall score
              </div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:36px;font-weight:500;color:{INK};">
                {score_text}
              </div>
            </td>
          </tr>
        </table>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
          <tr>
            <td align="center" style="background:{INK};border-radius:2px;">
              <a href="{results_url}" style="display:inline-block;padding:14px 28px;font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#ffffff;text-decoration:none;">
                View results &rarr;
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:{INK_MUTED};">
          Or open the dashboard directly:
        </p>
        <p style="margin:0;font-size:12px;line-height:1.5;color:{INK_SOFT};word-break:break-all;font-family:'SF Mono','Menlo','Consolas',monospace;background:{CANVAS};padding:12px 14px;border:1px solid {RULE};border-radius:3px;">
          {results_url}
        </p>
    """
    message = MessageSchema(
        subject=f"{candidate_name} completed your {role} mock interview",
        recipients=[to_email],
        body=_layout(preheader, content),
        subtype=MessageType.html,
    )
    await FastMail(conf).send_message(message)


async def send_password_reset_email(to_email: str, reset_token: str, full_name: str) -> None:
    reset_link = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
    preheader = f"Reset your {BRAND_NAME} password. This link expires in 1 hour."
    content = f"""
        <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:{INK_MUTED};">
          Password reset
        </p>
        <h1 style="margin:0 0 24px 0;font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:400;line-height:1.2;color:{INK};letter-spacing:-0.01em;">
          Let's get you back in, {full_name}.
        </h1>
        <p style="margin:0 0 32px 0;font-size:15px;line-height:1.7;color:{INK_SOFT};">
          Click the button below to set a new password. The link is valid for the next
          <strong style="color:{INK};">1 hour</strong>.
        </p>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
          <tr>
            <td align="center" style="background:{INK};border-radius:2px;">
              <a href="{reset_link}" style="display:inline-block;padding:14px 28px;font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#ffffff;text-decoration:none;">
                Reset password &rarr;
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:{INK_MUTED};">
          Or paste this link into your browser:
        </p>
        <p style="margin:0 0 32px 0;font-size:12px;line-height:1.5;color:{INK_SOFT};word-break:break-all;font-family:'SF Mono','Menlo','Consolas',monospace;background:{CANVAS};padding:12px 14px;border:1px solid {RULE};border-radius:3px;">
          {reset_link}
        </p>
        <p style="margin:0;padding-top:24px;border-top:1px solid {RULE};font-size:13px;line-height:1.7;color:{INK_MUTED};">
          Didn't request a reset? You can ignore this email — your password won't change unless you click the link above.
        </p>
    """
    message = MessageSchema(
        subject=f"Reset your {BRAND_NAME} password",
        recipients=[to_email],
        body=_layout(preheader, content),
        subtype=MessageType.html,
    )
    await FastMail(conf).send_message(message)
