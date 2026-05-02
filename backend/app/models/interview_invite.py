import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class InviteStatus(str, enum.Enum):
    active = "active"
    revoked = "revoked"


class InviteeStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    expired = "expired"


class InterviewInvite(Base):
    __tablename__ = "interview_invites"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    creator_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Opaque high-entropy token used in the invitation URL.
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_attempts: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    attempts_used: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    status: Mapped[InviteStatus] = mapped_column(
        Enum(InviteStatus, name="invite_status"),
        default=InviteStatus.active,
        nullable=False,
    )

    # Interview configuration applied to the candidate's session.
    role: Mapped[str] = mapped_column(String(255), nullable=False)
    seniority: Mapped[str | None] = mapped_column(String(32), nullable=True)
    focus: Mapped[str | None] = mapped_column(String(32), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=20, nullable=False)

    question_set_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_sets.id", ondelete="RESTRICT"),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    creator = relationship("User", foreign_keys=[creator_id])
    question_set = relationship("QuestionSet")
    invitees = relationship(
        "Invitee", back_populates="invite", cascade="all, delete-orphan"
    )
    sessions = relationship("Session", back_populates="invite")


class Invitee(Base):
    __tablename__ = "invitees"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    invite_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("interview_invites.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # Resolved on first authenticated visit; null until the candidate signs up / logs in.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[InviteeStatus] = mapped_column(
        Enum(InviteeStatus, name="invitee_status"),
        default=InviteeStatus.pending,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    invite = relationship("InterviewInvite", back_populates="invitees")
    user = relationship("User", foreign_keys=[user_id])
