import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DbSession
from app.core.storage import delete_object, upload_bytes
from app.models.resume import Resume
from app.resumes.parser import (
    ResumeParseError,
    embed_text,
    extract_text,
    llm_extract_fields,
)
from app.schemas.resume import ResumeResponse

log = logging.getLogger(__name__)

router = APIRouter(prefix="/resumes", tags=["resumes"])

ALLOWED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB


def _format_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def _event(stage: str, progress: int, message: str = "", **extra) -> str:
    payload = {
        "stage": stage,
        "progress": progress,
        "message": message,
        **extra,
    }
    return json.dumps(payload, ensure_ascii=False) + "\n"


# ---------- Streaming process endpoint ----------


async def _process_stream(
    data: bytes,
    filename: str,
    content_type: str,
    user_id: UUID,
    db,
) -> AsyncIterator[str]:
    """Yield NDJSON progress events while processing the resume.

    Stages: received → extracting → analyzing → indexing → saving → complete
    On failure, yields an "error" event and stops.
    """
    started = time.monotonic()

    # Stage 1: received
    yield _event(
        "received",
        10,
        f"Received {_format_bytes(len(data))} · {filename}",
        size_bytes=len(data),
        filename=filename,
    )

    # Stage 2: extracting
    yield _event("extracting", 25, "Reading the document…")
    try:
        extracted = extract_text(filename, data)
    except ResumeParseError as e:
        yield _event("error", 0, str(e))
        return
    except Exception as e:  # unexpected
        log.exception("Unexpected extraction error: %s", e)
        yield _event("error", 0, "We hit an unexpected snag reading your file.")
        return

    # ---- Debug: dump the full extracted text to the uvicorn terminal ----
    print("\n" + "=" * 80)
    print(f"[RESUME EXTRACT] {filename}  ({_format_bytes(len(data))})")
    print(
        f"[RESUME EXTRACT] words={extracted.word_count:,}  "
        f"pages={extracted.page_count}  chars={len(extracted.text):,}  "
        f"quality={extracted.quality}"
    )
    print("-" * 80)
    print(extracted.text)
    print("=" * 80 + "\n", flush=True)

    page_str = (
        f" across {extracted.page_count} page{'s' if extracted.page_count != 1 else ''}"
        if extracted.page_count
        else ""
    )
    yield _event(
        "extracting",
        45,
        f"Found {extracted.word_count:,} words{page_str}.",
        word_count=extracted.word_count,
        page_count=extracted.page_count,
        quality=extracted.quality,
    )

    if extracted.quality == "low":
        yield _event(
            "extracting",
            45,
            "Heads up — the résumé seems short. We'll do our best with what's here.",
            warning="low_word_count",
        )

    # Stage 3: analyzing (LLM)
    yield _event("analyzing", 55, "Asking the AI to structure your résumé…")
    try:
        parsed = await llm_extract_fields(extracted.text)
    except Exception as e:
        log.warning("LLM parse failed: %s", e)
        parsed = {}

    # ---- Debug: dump the parsed AI fields to the uvicorn terminal ----
    print("\n" + "=" * 80)
    print(f"[RESUME PARSED] {filename}")
    print("-" * 80)
    print(json.dumps(parsed or {}, indent=2, ensure_ascii=False))
    print("=" * 80 + "\n", flush=True)

    if parsed:
        bits: list[str] = []
        if parsed.get("full_name"):
            bits.append("identity")
        if parsed.get("experience"):
            n = len(parsed["experience"])
            bits.append(f"{n} role{'s' if n != 1 else ''}")
        if parsed.get("skills"):
            bits.append(f"{len(parsed['skills'])} skills")
        if parsed.get("education"):
            n = len(parsed["education"])
            bits.append(f"{n} education entr{'ies' if n != 1 else 'y'}")
        if parsed.get("projects"):
            bits.append(f"{len(parsed['projects'])} projects")
        msg = f"Found: {', '.join(bits)}." if bits else "Parsed structure, but few fields detected."
        yield _event("analyzing", 75, msg, parsed=parsed)
    else:
        yield _event(
            "analyzing",
            75,
            "AI parsing came back empty — we'll keep the raw text for the interview.",
            parsed={},
            warning="ai_parse_empty",
        )

    # Stage 4: indexing (embeddings)
    yield _event("indexing", 85, "Indexing for similarity search…")
    embedding = embed_text(extracted.text)
    if embedding is None:
        yield _event(
            "indexing",
            90,
            "Embedding skipped — the interview will still work without it.",
            warning="embed_failed",
        )

    # Stage 5: saving
    yield _event("saving", 92, "Saving to your account…")
    resume_id = uuid.uuid4()
    storage_key = f"resumes/{user_id}/{resume_id}-{filename}"
    try:
        upload_bytes(storage_key, data, content_type=content_type)
    except Exception as e:
        log.warning("Object-storage upload failed (continuing): %s", e)

    resume = Resume(
        id=resume_id,
        user_id=user_id,
        filename=filename,
        storage_key=storage_key,
        content_type=content_type,
        size_bytes=len(data),
        raw_text=extracted.text,
        parsed=parsed if parsed else None,
        embedding=embedding,
    )
    db.add(resume)
    await db.commit()
    await db.refresh(resume)

    elapsed = time.monotonic() - started
    yield _event(
        "complete",
        100,
        f"Ready in {elapsed:.1f}s.",
        elapsed_seconds=round(elapsed, 1),
        resume={
            "id": str(resume.id),
            "filename": resume.filename,
            "content_type": resume.content_type,
            "size_bytes": resume.size_bytes,
            "parsed": resume.parsed,
            "created_at": resume.created_at.isoformat(),
        },
    )


@router.post("/process")
async def process_resume_streaming(
    current_user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
):
    """Streaming resume processor — emits NDJSON progress events.

    Each line of the response body is a JSON object with at least:
      {"stage": "...", "progress": 0-100, "message": "..."}
    The terminal event has stage="complete" with the full resume payload,
    or stage="error" if processing failed.
    """
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. Use PDF, DOCX, or TXT.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(data) > MAX_BYTES:
        raise HTTPException(
            status_code=400, detail=f"File too large (max {_format_bytes(MAX_BYTES)})."
        )

    return StreamingResponse(
        _process_stream(
            data=data,
            filename=file.filename or "resume",
            content_type=file.content_type,
            user_id=current_user.id,
            db=db,
        ),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


# ---------- Existing non-streaming endpoint (kept for backward compat) ----------


@router.post("", response_model=ResumeResponse, status_code=status.HTTP_201_CREATED)
async def upload_resume(
    current_user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
) -> ResumeResponse:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large (max {_format_bytes(MAX_BYTES)})")

    try:
        extracted = extract_text(file.filename or "resume", data)
    except ResumeParseError as e:
        raise HTTPException(status_code=400, detail=str(e))

    parsed = await llm_extract_fields(extracted.text)
    embedding = embed_text(extracted.text)

    resume_id = uuid.uuid4()
    storage_key = f"resumes/{current_user.id}/{resume_id}-{file.filename}"
    try:
        upload_bytes(storage_key, data, content_type=file.content_type)
    except Exception as e:
        log.warning("Object-storage upload failed: %s", e)

    resume = Resume(
        id=resume_id,
        user_id=current_user.id,
        filename=file.filename or "resume",
        storage_key=storage_key,
        content_type=file.content_type,
        size_bytes=len(data),
        raw_text=extracted.text,
        parsed=parsed if parsed else None,
        embedding=embedding,
    )
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return ResumeResponse.model_validate(resume)


@router.get("/{resume_id}", response_model=ResumeResponse)
async def get_resume(
    resume_id: UUID, current_user: CurrentUser, db: DbSession
) -> ResumeResponse:
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == current_user.id)
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    return ResumeResponse.model_validate(resume)


@router.get("", response_model=list[ResumeResponse])
async def list_resumes(current_user: CurrentUser, db: DbSession) -> list[ResumeResponse]:
    result = await db.execute(
        select(Resume).where(Resume.user_id == current_user.id).order_by(Resume.created_at.desc())
    )
    return [ResumeResponse.model_validate(r) for r in result.scalars().all()]


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resume(
    resume_id: UUID, current_user: CurrentUser, db: DbSession
) -> None:
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == current_user.id)
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    delete_object(resume.storage_key)
    await db.delete(resume)
    await db.commit()
