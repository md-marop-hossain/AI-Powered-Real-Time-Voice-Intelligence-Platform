"""Background tasks: PDF report generation, async heavy scoring jobs.

These are best-effort; the main HTTP path lazily generates reports if missing.
"""

from __future__ import annotations

import asyncio
import structlog
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal
from app.core.storage import upload_bytes
from app.models.report import Report
from app.models.session import Session
from app.reports.generator import build_report_summary, render_pdf
from app.workers.celery_app import celery_app

log = structlog.get_logger()


async def _generate_report_async(session_id: UUID) -> str | None:
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Session)
            .where(Session.id == session_id)
            .options(selectinload(Session.turns), selectinload(Session.report))
        )
        session = res.scalar_one_or_none()
        if not session:
            return None

        summary = build_report_summary(session)
        pdf_bytes = render_pdf(session, summary)
        pdf_key = f"reports/{session.user_id}/{session.id}.pdf"
        upload_bytes(pdf_key, pdf_bytes, content_type="application/pdf")

        if session.report:
            session.report.summary = summary
            session.report.overall_score = summary["overall_score"]
            session.report.pdf_key = pdf_key
        else:
            db.add(
                Report(
                    session_id=session.id,
                    overall_score=summary["overall_score"],
                    summary=summary,
                    pdf_key=pdf_key,
                )
            )
        await db.commit()
        return pdf_key


@celery_app.task(name="generate_report")
def generate_report(session_id: str) -> str | None:
    return asyncio.run(_generate_report_async(UUID(session_id)))
