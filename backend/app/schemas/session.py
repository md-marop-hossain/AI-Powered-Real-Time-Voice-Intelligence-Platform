from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

Seniority = Literal["fresher", "junior", "mid", "senior", "staff", "manager"]
Focus = Literal["mixed", "technical", "behavioral", "system_design"]


class StartSessionRequest(BaseModel):
    resume_id: UUID
    role: str = Field(min_length=1, max_length=255)
    seniority: Seniority = "mid"
    focus: Focus = "mixed"
    industry: str | None = Field(default=None, max_length=128)
    duration_minutes: int = Field(default=20, ge=5, le=60)


class TurnResponse(BaseModel):
    id: UUID
    index: int
    question: str
    question_kind: str
    answer: str | None
    scores: dict | None
    asked_at: datetime
    answered_at: datetime | None

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    id: UUID
    role: str
    seniority: str | None = None
    focus: str | None = None
    industry: str | None = None
    duration_minutes: int
    status: str
    started_at: datetime | None
    ended_at: datetime | None
    final_scores: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionDetail(SessionResponse):
    turns: list[TurnResponse] = []


class ReportResponse(BaseModel):
    session_id: UUID
    overall_score: float
    summary: dict
    pdf_url: str | None = None
