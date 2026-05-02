"""HTTP routes for interview session lifecycle (start / end / get / list)."""

from __future__ import annotations

import asyncio
import json
import structlog
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

log = structlog.get_logger()

from app.auth.routes import limiter
from app.core.dependencies import CurrentUser, DbSession
from app.core.storage import delete_object, presigned_url
from app.agents.base import LLM_TIMEOUT_SECONDS
from app.agents.planner import plan_session
from app.agents.researcher import research_candidate
from app.invites.service import mark_invitee_completed_for_session
from app.skill_graphs import load_skill_graph
from app.models.interview_invite import InterviewInvite
from app.models.report import Report
from app.models.resume import Resume
from app.models.session import Session, SessionStatus
from app.models.user import User
from app.scoring.aggregator import aggregate_session_scores
from app.schemas.session import (
    ReportResponse,
    SessionDetail,
    SessionResponse,
    StartSessionRequest,
    TurnResponse,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


async def _user_can_view_session(
    db, session: Session, user: User
) -> bool:
    """Read access: candidate (session owner) OR creator of the linked invite.

    Write paths (end / delete) stay candidate-only and don't go through
    this helper. Returning a bool lets each route shape its own response.
    """
    if session.user_id == user.id:
        return True
    if session.invite_id is None:
        return False
    res = await db.execute(
        select(InterviewInvite.creator_id).where(
            InterviewInvite.id == session.invite_id
        )
    )
    creator_id = res.scalar_one_or_none()
    return creator_id is not None and creator_id == user.id


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
async def start_session(
    request: Request,
    body: StartSessionRequest,
    current_user: CurrentUser,
    db: DbSession,
) -> SessionResponse:
    # Resolve resume and ownership.
    res = await db.execute(
        select(Resume).where(Resume.id == body.resume_id, Resume.user_id == current_user.id)
    )
    resume = res.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    active = await db.execute(
        select(Session.id)
        .where(
            Session.user_id == current_user.id,
            Session.status.in_([SessionStatus.pending, SessionStatus.in_progress]),
        )
        .limit(1)
    )
    if active.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail="You already have an active interview session.",
        )

    skill_graph = load_skill_graph(body.role)

    research_hints = None
    try:
        research_hints = await asyncio.wait_for(
            research_candidate(
                user_id=current_user.id,
                parsed_resume=resume.parsed,
                role=body.role,
                seniority=body.seniority,
                db=db,
            ),
            timeout=LLM_TIMEOUT_SECONDS,
        )
    except Exception as e:
        log.warning("ResearchAgent failed: %s — proceeding without hints", e)

    plan = await plan_session(
        role=body.role,
        duration_minutes=body.duration_minutes,
        parsed_resume=resume.parsed,
        seniority=body.seniority,
        focus=body.focus,
        industry=body.industry,
        skill_graph=skill_graph,
        research_hints=research_hints,
    )
    if not plan:
        raise HTTPException(status_code=502, detail="Failed to generate interview plan")

    session = Session(
        user_id=current_user.id,
        resume_id=resume.id,
        role=body.role,
        seniority=body.seniority,
        focus=body.focus,
        industry=body.industry,
        duration_minutes=body.duration_minutes,
        status=SessionStatus.pending,
        questions_plan={
            "questions": plan,
            "mode": "resume_based",
            "research_hints": {
                "weak_areas": research_hints.weak_areas if research_hints else [],
                "cross_session_note": research_hints.cross_session_note if research_hints else "",
            },
        },
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return SessionResponse.model_validate(session)


@router.post("/{session_id}/end", response_model=SessionResponse)
async def end_session(
    session_id: UUID, current_user: CurrentUser, db: DbSession
) -> SessionResponse:
    res = await db.execute(
        select(Session)
        .where(Session.id == session_id, Session.user_id == current_user.id)
        .options(selectinload(Session.turns))
    )
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    just_completed = session.status != SessionStatus.completed
    if just_completed:
        session.status = SessionStatus.completed
        session.ended_at = datetime.now(timezone.utc)

    # Aggregate final scores.
    final = aggregate_session_scores(session.turns or [])
    session.final_scores = final
    await mark_invitee_completed_for_session(db, session)
    await db.commit()
    await db.refresh(session)

    # Fire-and-forget: generate report + notify the invite creator. Only on
    # the actual transition to completed so retries / idempotent calls don't
    # spam the creator with duplicate emails.
    if just_completed:
        from app.interviews.websocket import _generate_report_background

        asyncio.create_task(_generate_report_background(session_id))

    return SessionResponse.model_validate(session)


@router.get("", response_model=list[SessionResponse])
async def list_sessions(current_user: CurrentUser, db: DbSession) -> list[SessionResponse]:
    res = await db.execute(
        select(Session)
        .where(Session.user_id == current_user.id)
        .order_by(Session.created_at.desc())
    )
    return [SessionResponse.model_validate(s) for s in res.scalars().all()]


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: UUID, current_user: CurrentUser, db: DbSession
) -> None:
    res = await db.execute(
        select(Session)
        .where(Session.id == session_id, Session.user_id == current_user.id)
        .options(selectinload(Session.report))
    )
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.report and session.report.pdf_key:
        delete_object(session.report.pdf_key)
    await db.delete(session)
    await db.commit()


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: UUID, current_user: CurrentUser, db: DbSession
) -> SessionDetail:
    res = await db.execute(
        select(Session)
        .where(Session.id == session_id)
        .options(selectinload(Session.turns))
    )
    session = res.scalar_one_or_none()
    if not session or not await _user_can_view_session(db, session, current_user):
        raise HTTPException(status_code=404, detail="Session not found")

    return SessionDetail(
        id=session.id,
        role=session.role,
        duration_minutes=session.duration_minutes,
        status=session.status.value if hasattr(session.status, "value") else session.status,
        started_at=session.started_at,
        ended_at=session.ended_at,
        final_scores=session.final_scores,
        created_at=session.created_at,
        turns=[TurnResponse.model_validate(t) for t in (session.turns or [])],
    )


@router.get("/{session_id}/report", response_model=ReportResponse)
async def get_report(
    session_id: UUID, current_user: CurrentUser, db: DbSession
) -> ReportResponse:
    sres = await db.execute(
        select(Session)
        .where(Session.id == session_id)
        .options(selectinload(Session.turns), selectinload(Session.report))
    )
    session = sres.scalar_one_or_none()
    if not session or not await _user_can_view_session(db, session, current_user):
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.report:
        # Lazily create a basic report from in-DB scores.
        from app.reports.generator import build_report_summary, render_pdf
        from app.core.storage import upload_bytes

        summary = build_report_summary(session)
        # PDF rendering can fail on Windows when WeasyPrint loads the wrong
        # native Pango/Cairo DLLs (e.g. an old one shipped with Tesseract).
        # The on-screen report doesn't need the PDF — only the download link
        # does — so treat PDF generation as best-effort: persist the report
        # without a pdf_key if it fails, and let the user retry later.
        pdf_key: str | None = None
        try:
            loop = asyncio.get_running_loop()
            pdf_bytes = await loop.run_in_executor(
                None, render_pdf, session, summary
            )
            # Always key by the session's owner (candidate), not the
            # requesting user — the creator viewing a candidate's report
            # would otherwise scatter PDFs across multiple paths.
            pdf_key = f"reports/{session.user_id}/{session.id}.pdf"
            await loop.run_in_executor(
                None, upload_bytes, pdf_key, pdf_bytes, "application/pdf"
            )
        except Exception as e:
            log.warning(
                "PDF rendering failed for session %s; saving report without PDF: %s",
                session.id,
                e,
            )
            pdf_key = None
        report = Report(
            session_id=session.id,
            overall_score=summary["overall_score"],
            summary=summary,
            pdf_key=pdf_key,
        )
        db.add(report)
        await db.commit()
        await db.refresh(report)
    else:
        report = session.report

    pdf_url = presigned_url(report.pdf_key) if report.pdf_key else None

    # Inject fresh per-turn audio URLs. The persisted summary stores only the
    # `audio_key`; presigned URLs expire (1h default) so we re-sign on every
    # report fetch and strip the raw key before returning.
    summary = dict(report.summary or {})
    enriched_turns = []
    for t in summary.get("turns") or []:
        t = dict(t)
        key = t.pop("audio_key", None)
        t["audio_url"] = presigned_url(key) if key else None
        enriched_turns.append(t)
    summary["turns"] = enriched_turns

    return ReportResponse(
        session_id=session.id,
        overall_score=report.overall_score,
        summary=summary,
        pdf_url=pdf_url,
    )
