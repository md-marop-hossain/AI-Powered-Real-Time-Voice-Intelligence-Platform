import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class QuestionSetType(str, enum.Enum):
    predefined = "predefined"
    ai_generated = "ai_generated"
    jd_based = "jd_based"


class QuestionSet(Base):
    __tablename__ = "question_sets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    type: Mapped[QuestionSetType] = mapped_column(
        Enum(QuestionSetType, name="question_set_type"), nullable=False
    )
    # List of question dicts: [{"index": 1, "section": "...", "question": "..."}]
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # Free-form generation metadata (role, seniority, jd snippet, prompt, etc.)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
