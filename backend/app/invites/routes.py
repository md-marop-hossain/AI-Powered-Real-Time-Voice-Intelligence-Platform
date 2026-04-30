"""HTTP routes for the invitation system.

Endpoints:
  POST   /invites              — creator: create invites (one per email) + send emails
  GET    /invites              — creator: dashboard list
  GET    /invites/{token}      — public: validate token + minimal info for landing page
  POST   /invites/{token}/start — candidate (auth): start a session for this invite
  GET    /invites/{id}/results — creator: per-invitee result rows
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Body, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession
from app.core.email import send_invite_email
from app.invites import question_sets as qs_builders
from app.invites.service import (
    InviteValidationError,
    attempts_remaining,
    build_invite_url,
    expiry_from_hours,
    generate_invite_token,
    validate_invite,
)
from app.models.interview_invite import (
    InterviewInvite,
    Invitee,
    InviteeStatus,
    InviteStatus,
)
from app.models.question_set import QuestionSet, QuestionSetType
from app.models.report import Report
from app.models.resume import Resume
from app.models.session import Session, SessionStatus
from app.schemas.invite import (
    CreateInviteRequest,
    CreateInviteResponse,
    InviteResultRow,
    InviteSummary,
    PublicInviteView,
    StartInviteResponse,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/invites", tags=["invites"])


def _summary(invite: InterviewInvite) -> InviteSummary:
    return InviteSummary(
        id=invite.id,
        token=invite.token,
        role=invite.role,
        seniority=invite.seniority,
        focus=invite.focus,
        industry=invite.industry,
        duration_minutes=invite.duration_minutes,
        expires_at=invite.expires_at,
        max_attempts=invite.max_attempts,
        attempts_used=invite.attempts_used,
        status=invite.status.value if hasattr(invite.status, "value") else invite.status,
        created_at=invite.created_at,
        invitees=[
            {
                "id": iv.id,
                "email": iv.email,
                "user_id": iv.user_id,
                "status": iv.status.value if hasattr(iv.status, "value") else iv.status,
            }
            for iv in (invite.invitees or [])
        ],
        invite_url=build_invite_url(invite.token),
    )


async def _build_question_plan(req: CreateInviteRequest) -> tuple[list[dict], dict]:
    """Generate the question list according to the chosen mode.

    Returns (questions, meta) where meta is JSON-serializable provenance to
    persist on the QuestionSet row.
    """
    if req.mode == "predefined":
        plan = qs_builders.build_predefined(req.questions or [])
        meta = {"role": req.role, "seniority": req.seniority, "focus": req.focus}
        return plan, meta

    if req.mode == "ai_generated":
        plan = await qs_builders.build_ai_generated(
            role=req.role,
            seniority=req.seniority,
            focus=req.focus,
            industry=req.industry,
            duration_minutes=req.duration_minutes,
            instructions=req.ai_instructions,
        )
        meta = {
            "role": req.role,
            "seniority": req.seniority,
            "focus": req.focus,
            "industry": req.industry,
            "instructions": req.ai_instructions,
        }
        return plan, meta

    # jd_based
    plan = await qs_builders.build_jd_based(
        role=req.role,
        seniority=req.seniority,
        focus=req.focus,
        industry=req.industry,
        duration_minutes=req.duration_minutes,
        job_description=req.job_description or "",
    )
    meta = {
        "role": req.role,
        "seniority": req.seniority,
        "focus": req.focus,
        "industry": req.industry,
        "job_description_preview": (req.job_description or "")[:400],
    }
    return plan, meta


@router.post(
    "", response_model=CreateInviteResponse, status_code=status.HTTP_201_CREATED
)
async def create_invites(
    body: CreateInviteRequest, current_user: CurrentUser, db: DbSession
) -> CreateInviteResponse:
    """Create one InterviewInvite (with one Invitee row) per email.

    Emails are sent best-effort — a delivery failure for one address does not
    roll back already-persisted invites; the failure is logged so the creator
    can resend later.
    """
    plan, meta = await _build_question_plan(body)
    if not plan:
        raise HTTPException(
            status_code=502, detail="Failed to generate question set"
        )

    qset = QuestionSet(
        type=QuestionSetType(body.mode),
        content={"questions": plan},
        meta=meta,
    )
    db.add(qset)
    await db.flush()  # need qset.id

    created: list[InterviewInvite] = []
    seen: set[str] = set()
    for raw_email in body.emails:
        email = str(raw_email).strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        invite = InterviewInvite(
            creator_id=current_user.id,
            token=generate_invite_token(),
            expires_at=expiry_from_hours(body.expires_in_hours),
            max_attempts=body.max_attempts or settings.INVITE_MAX_ATTEMPTS,
            role=body.role,
            seniority=body.seniority,
            focus=body.focus,
            industry=body.industry,
            duration_minutes=body.duration_minutes,
            question_set_id=qset.id,
        )
        db.add(invite)
        await db.flush()
        invitee = Invitee(invite_id=invite.id, email=email)
        db.add(invitee)
        created.append(invite)

    await db.commit()

    # Refresh with invitees loaded for the response.
    ids = [i.id for i in created]
    res = await db.execute(
        select(InterviewInvite)
        .where(InterviewInvite.id.in_(ids))
        .options(selectinload(InterviewInvite.invitees))
    )
    invites = list(res.scalars().all())

    # Send emails best-effort.
    for invite in invites:
        for inv in invite.invitees:
            try:
                await send_invite_email(
                    to_email=inv.email,
                    invite_url=build_invite_url(invite.token),
                    role=invite.role,
                    duration_minutes=invite.duration_minutes,
                    expires_at_human=invite.expires_at.strftime("%Y-%m-%d %H:%M UTC"),
                    inviter_name=current_user.full_name,
                )
            except Exception as e:
                log.warning(
                    "Failed to send invite email to %s for invite %s: %s",
                    inv.email,
                    invite.id,
                    e,
                )

    return CreateInviteResponse(invites=[_summary(i) for i in invites])


@router.get("", response_model=list[InviteSummary])
async def list_invites(
    current_user: CurrentUser, db: DbSession
) -> list[InviteSummary]:
    res = await db.execute(
        select(InterviewInvite)
        .where(InterviewInvite.creator_id == current_user.id)
        .options(selectinload(InterviewInvite.invitees))
        .order_by(InterviewInvite.created_at.desc())
    )
    return [_summary(i) for i in res.scalars().all()]


@router.get("/{token}", response_model=PublicInviteView)
async def get_invite_by_token(token: str, db: DbSession) -> PublicInviteView:
    """Public endpoint — used by the candidate's landing page."""
    res = await db.execute(
        select(InterviewInvite)
        .where(InterviewInvite.token == token)
        .options(
            selectinload(InterviewInvite.creator),
            selectinload(InterviewInvite.invitees),
        )
    )
    invite = res.scalar_one_or_none()
    try:
        invite = validate_invite(invite)
    except InviteValidationError as e:
        raise HTTPException(status_code=410 if e.code != "not_found" else 404, detail=e.message)

    return PublicInviteView(
        role=invite.role,
        seniority=invite.seniority,
        focus=invite.focus,
        industry=invite.industry,
        duration_minutes=invite.duration_minutes,
        expires_at=invite.expires_at,
        attempts_remaining=attempts_remaining(invite),
        creator_name=invite.creator.full_name if invite.creator else None,
        invited_emails=[i.email for i in (invite.invitees or [])],
    )


class StartInviteRequest(BaseModel):
    resume_id: UUID | None = Field(
        default=None,
        description=(
            "Optional resume to associate with the session. If omitted, the "
            "candidate's most recently uploaded resume (if any) is used."
        ),
    )


@router.post("/{token}/start", response_model=StartInviteResponse)
async def start_invite(
    token: str,
    current_user: CurrentUser,
    db: DbSession,
    body: StartInviteRequest = Body(default_factory=StartInviteRequest),
) -> StartInviteResponse:
    """Authenticated: convert an invite into a Session for the candidate.

    Each call creates a new Session and increments attempts_used. The Session's
    questions_plan is populated from the invite's stored QuestionSet, so the
    existing WebSocket interview flow consumes it unchanged.
    """
    res = await db.execute(
        select(InterviewInvite)
        .where(InterviewInvite.token == token)
        .options(
            selectinload(InterviewInvite.question_set),
            selectinload(InterviewInvite.invitees),
        )
    )
    invite = res.scalar_one_or_none()
    try:
        invite = validate_invite(invite)
    except InviteValidationError as e:
        code = 410 if e.code != "not_found" else 404
        raise HTTPException(status_code=code, detail=e.message)

    # The signed-in account MUST match an invited address on this invite.
    # Email comparison is case-insensitive (Invitee.email is stored lowercased).
    user_email = (current_user.email or "").strip().lower()
    invitee = next(
        (iv for iv in (invite.invitees or []) if iv.email == user_email), None
    )
    if invitee is None:
        invited = sorted({iv.email for iv in (invite.invitees or [])})
        log.info(
            "Invite %s start denied: signed-in user %s (%s) is not on the invitee list (%s)",
            invite.id,
            current_user.id,
            user_email,
            invited,
        )
        raise HTTPException(
            status_code=403,
            detail=(
                "This invitation was sent to a different email address. "
                "Please sign out and sign in with the address that received "
                "the invite."
            ),
        )
    if invitee.user_id is None:
        invitee.user_id = current_user.id
    invitee.status = InviteeStatus.in_progress

    # Resolve a resume to attach (optional).
    resume_id: UUID | None = None
    if body.resume_id is not None:
        rres = await db.execute(
            select(Resume).where(
                Resume.id == body.resume_id, Resume.user_id == current_user.id
            )
        )
        resume = rres.scalar_one_or_none()
        if not resume:
            raise HTTPException(status_code=404, detail="Resume not found")
        resume_id = resume.id
    else:
        rres = await db.execute(
            select(Resume)
            .where(Resume.user_id == current_user.id)
            .order_by(Resume.created_at.desc())
            .limit(1)
        )
        latest = rres.scalar_one_or_none()
        if latest:
            resume_id = latest.id

    plan = (invite.question_set.content or {}).get("questions", [])
    if not plan:
        raise HTTPException(status_code=500, detail="Invite has no question plan")

    # Persist the mode alongside the questions so the live orchestrator can
    # apply mode-specific rules at runtime (e.g. predefined disallows ad-hoc
    # follow-ups; ai_generated / jd_based skip resume context to stay
    # tonally consistent with how their plans were generated).
    qs_type = invite.question_set.type
    mode_str = qs_type.value if hasattr(qs_type, "value") else str(qs_type)

    session = Session(
        user_id=current_user.id,
        resume_id=resume_id,
        invite_id=invite.id,
        role=invite.role,
        seniority=invite.seniority,
        focus=invite.focus,
        industry=invite.industry,
        duration_minutes=invite.duration_minutes,
        status=SessionStatus.pending,
        questions_plan={"questions": plan, "mode": mode_str},
    )
    db.add(session)

    invite.attempts_used += 1
    await db.commit()
    await db.refresh(session)
    await db.refresh(invite)

    return StartInviteResponse(
        session_id=session.id, attempts_remaining=attempts_remaining(invite)
    )


@router.get("/{invite_id}/results", response_model=list[InviteResultRow])
async def list_invite_results(
    invite_id: UUID, current_user: CurrentUser, db: DbSession
) -> list[InviteResultRow]:
    """Creator-only: report rows for this invite, one per invitee."""
    res = await db.execute(
        select(InterviewInvite)
        .where(
            InterviewInvite.id == invite_id,
            InterviewInvite.creator_id == current_user.id,
        )
        .options(selectinload(InterviewInvite.invitees))
    )
    invite = res.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")

    # Pull all sessions linked to this invite, with their reports.
    sres = await db.execute(
        select(Session)
        .where(Session.invite_id == invite.id)
        .options(selectinload(Session.report))
        .order_by(Session.created_at.desc())
    )
    sessions = list(sres.scalars().all())

    # Index latest session per user_id for invitees (one attempt = one session).
    by_user: dict[UUID, Session] = {}
    for s in sessions:
        if s.user_id not in by_user:
            by_user[s.user_id] = s

    rows: list[InviteResultRow] = []
    for inv in invite.invitees:
        sess = by_user.get(inv.user_id) if inv.user_id else None
        report: Report | None = sess.report if sess else None
        rows.append(
            InviteResultRow(
                invitee_id=inv.id,
                email=inv.email,
                status=inv.status.value if hasattr(inv.status, "value") else inv.status,
                session_id=sess.id if sess else None,
                overall_score=report.overall_score if report else None,
                completed_at=sess.ended_at if sess else None,
            )
        )
    return rows
