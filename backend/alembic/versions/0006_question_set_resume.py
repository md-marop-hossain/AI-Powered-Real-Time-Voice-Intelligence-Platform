"""question_sets.resume_id — link the résumé that drove plan generation

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-01

For invite modes `ai_generated` and `jd_based`, the creator now uploads the
candidate's résumé at invite-creation time so the LLM can produce
personalised questions. The chosen Resume row is persisted on the
QuestionSet so the live session (and any future re-generation) can re-use
the same context. Predefined-mode rows leave this NULL.

ON DELETE SET NULL — if the underlying résumé is deleted, the question set
keeps its already-generated questions; only the live follow-up agent loses
résumé grounding (graceful degradation).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "question_sets",
        sa.Column(
            "resume_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resumes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_question_sets_resume_id",
        "question_sets",
        ["resume_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_question_sets_resume_id", table_name="question_sets")
    op.drop_column("question_sets", "resume_id")
