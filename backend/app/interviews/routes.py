"""HTTP routes for interview session lifecycle (start / end / get / list)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.dependencies import CurrentUser, DbSession
from app.core.storage import presigned_url
from app.interviews.agent import generate_question_plan
from app.models.report import Report
from app.models.resume import Resume
from app.models.session import Session, SessionStatus
from app.scoring.aggregator import aggregate_session_scores
from app.schemas.session import (
    ReportResponse,
    SessionDetail,
    SessionResponse,
    StartSessionRequest,
    TurnResponse,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def start_session(
    body: StartSessionRequest, current_user: CurrentUser, db: DbSession
) -> SessionResponse:
    # Resolve resume and ownership.
    res = await db.execute(
        select(Resume).where(Resume.id == body.resume_id, Resume.user_id == current_user.id)
    )
    resume = res.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    plan = await generate_question_plan(
        role=body.role,
        duration_minutes=body.duration_minutes,
        parsed_resume=resume.parsed,
        seniority=body.seniority,
        focus=body.focus,
        industry=body.industry,
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
        questions_plan={"questions": plan},
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

    if session.status != SessionStatus.completed:
        session.status = SessionStatus.completed
        session.ended_at = datetime.now(timezone.utc)

    # Aggregate final scores.
    final = aggregate_session_scores(session.turns or [])
    session.final_scores = final
    await db.commit()
    await db.refresh(session)
    return SessionResponse.model_validate(session)


@router.get("", response_model=list[SessionResponse])
async def list_sessions(current_user: CurrentUser, db: DbSession) -> list[SessionResponse]:
    res = await db.execute(
        select(Session)
        .where(Session.user_id == current_user.id)
        .order_by(Session.created_at.desc())
    )
    return [SessionResponse.model_validate(s) for s in res.scalars().all()]


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: UUID, current_user: CurrentUser, db: DbSession
) -> SessionDetail:
    res = await db.execute(
        select(Session)
        .where(Session.id == session_id, Session.user_id == current_user.id)
        .options(selectinload(Session.turns))
    )
    session = res.scalar_one_or_none()
    if not session:
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
        .where(Session.id == session_id, Session.user_id == current_user.id)
        .options(selectinload(Session.turns), selectinload(Session.report))
    )
    session = sres.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.report:
        # Lazily create a basic report from in-DB scores.
        from app.reports.generator import build_report_summary, render_pdf
        from app.core.storage import upload_bytes

        summary = build_report_summary(session)
        pdf_bytes = render_pdf(session, summary)
        pdf_key = f"reports/{current_user.id}/{session.id}.pdf"
        upload_bytes(pdf_key, pdf_bytes, content_type="application/pdf")
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
    return ReportResponse(
        session_id=session.id,
        overall_score=report.overall_score,
        summary=report.summary,
        pdf_url=pdf_url,
    )
