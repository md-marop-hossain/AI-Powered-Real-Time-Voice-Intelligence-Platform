from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, model_validator

from app.schemas.session import Focus, Seniority

QuestionSourceMode = Literal["predefined", "ai_generated", "jd_based"]


class QuestionItem(BaseModel):
    index: int
    section: str | None = None
    question: str = Field(min_length=1)


class CreateInviteRequest(BaseModel):
    emails: list[EmailStr] = Field(min_length=1, max_length=50)

    role: str = Field(min_length=1, max_length=255)
    seniority: Seniority = "mid"
    focus: Focus = "mixed"
    industry: str | None = Field(default=None, max_length=128)
    duration_minutes: int = Field(default=20, ge=5, le=60)

    mode: QuestionSourceMode

    # Mode A: predefined questions (required when mode == "predefined")
    questions: list[str] | None = Field(default=None, max_length=20)
    # Mode B: AI-generated — uses role / seniority / focus / industry above; optional extra
    ai_instructions: str | None = Field(default=None, max_length=2000)
    # Mode C: job description text (required when mode == "jd_based")
    job_description: str | None = Field(default=None, max_length=10000)

    # Optional per-invite overrides; default to global ENV settings if omitted.
    expires_in_hours: int | None = Field(default=None, ge=1, le=24 * 30)
    max_attempts: int | None = Field(default=None, ge=1, le=10)

    @model_validator(mode="after")
    def _validate_mode_inputs(self) -> "CreateInviteRequest":
        if self.mode == "predefined":
            qs = [q.strip() for q in (self.questions or []) if q and q.strip()]
            if len(qs) < 1:
                raise ValueError("predefined mode requires at least one question")
            self.questions = qs
        elif self.mode == "jd_based":
            if not (self.job_description and self.job_description.strip()):
                raise ValueError("jd_based mode requires job_description")
        return self


class InviteeSummary(BaseModel):
    id: UUID
    email: str
    user_id: UUID | None
    status: str

    model_config = {"from_attributes": True}


class InviteSummary(BaseModel):
    """Returned from POST /invites and GET /invites (creator dashboard)."""

    id: UUID
    token: str
    role: str
    seniority: str | None
    focus: str | None
    industry: str | None
    duration_minutes: int
    expires_at: datetime
    max_attempts: int
    attempts_used: int
    status: str
    created_at: datetime
    invitees: list[InviteeSummary] = []
    invite_url: str

    model_config = {"from_attributes": True}


class CreateInviteResponse(BaseModel):
    invites: list[InviteSummary]


class PublicInviteView(BaseModel):
    """Returned from GET /invites/{token} — minimal info for the candidate landing page.

    `invited_emails` lets the frontend tell the candidate exactly which address
    needs to be signed in. Possessing the token is already proof the recipient
    received the email, so echoing it back is no additional disclosure.
    """

    role: str
    seniority: str | None
    focus: str | None
    industry: str | None
    duration_minutes: int
    expires_at: datetime
    attempts_remaining: int
    creator_name: str | None = None
    invited_emails: list[str] = []


class StartInviteResponse(BaseModel):
    session_id: UUID
    attempts_remaining: int


class InviteResultRow(BaseModel):
    invitee_id: UUID
    email: str
    status: str
    session_id: UUID | None
    overall_score: float | None
    completed_at: datetime | None
