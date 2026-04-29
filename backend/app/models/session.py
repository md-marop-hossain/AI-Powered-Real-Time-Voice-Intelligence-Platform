import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SessionStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    abandoned = "abandoned"
    error = "error"


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resume_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True
    )
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("interview_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    role: Mapped[str] = mapped_column(String(255), nullable=False)
    seniority: Mapped[str | None] = mapped_column(String(32), nullable=True)
    focus: Mapped[str | None] = mapped_column(String(32), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus, name="session_status"),
        default=SessionStatus.pending,
        nullable=False,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    questions_plan: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    final_scores: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Count of focus-integrity violations (tab switches, fullscreen exits,
    # window blur events) the candidate triggered during the live session.
    # The session is auto-ended once this reaches the configured limit.
    focus_violations: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user = relationship("User", back_populates="sessions")
    resume = relationship("Resume", back_populates="sessions")
    turns = relationship(
        "Turn",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="Turn.index",
    )
    report = relationship("Report", back_populates="session", uselist=False, cascade="all, delete-orphan")
