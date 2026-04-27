import uuid
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DbSession
from app.core.storage import upload_bytes
from app.models.resume import Resume
from app.resumes.parser import embed_text, extract_text, llm_extract_fields
from app.schemas.resume import ResumeResponse

router = APIRouter(prefix="/resumes", tags=["resumes"])

ALLOWED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("", response_model=ResumeResponse, status_code=status.HTTP_201_CREATED)
async def upload_resume(
    current_user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
) -> ResumeResponse:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        text = extract_text(file.filename or "resume", data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to extract text: {e}")

    try:
        parsed = await llm_extract_fields(text)
    except Exception:
        parsed = None

    try:
        embedding = embed_text(text) if text else None
    except Exception:
        embedding = None

    resume_id = uuid.uuid4()
    storage_key = f"resumes/{current_user.id}/{resume_id}-{file.filename}"
    upload_bytes(storage_key, data, content_type=file.content_type)

    resume = Resume(
        id=resume_id,
        user_id=current_user.id,
        filename=file.filename or "resume",
        storage_key=storage_key,
        content_type=file.content_type,
        size_bytes=len(data),
        raw_text=text,
        parsed=parsed,
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
