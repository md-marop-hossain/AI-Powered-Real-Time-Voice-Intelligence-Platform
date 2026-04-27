from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ResumeResponse(BaseModel):
    id: UUID
    filename: str
    content_type: str
    size_bytes: int
    parsed: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ParsedResume(BaseModel):
    """Structured fields the LLM extracts from the resume text."""

    full_name: str | None = None
    title: str | None = None
    summary: str | None = None
    skills: list[str] = []
    experience: list[dict] = []
    education: list[dict] = []
    projects: list[dict] = []
    contact: dict | None = None
