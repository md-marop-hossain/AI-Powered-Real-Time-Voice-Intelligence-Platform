"""invitation system: question sets, interview invites, invitees

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-30

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    question_set_type = sa.Enum(
        "predefined", "ai_generated", "jd_based", name="question_set_type"
    )
    invite_status = sa.Enum("active", "revoked", name="invite_status")
    invitee_status = sa.Enum(
        "pending", "in_progress", "completed", "expired", name="invitee_status"
    )
    question_set_type.create(op.get_bind(), checkfirst=True)
    invite_status.create(op.get_bind(), checkfirst=True)
    invitee_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "question_sets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "type",
            postgresql.ENUM(name="question_set_type", create_type=False),
            nullable=False,
        ),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column("meta", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "interview_invites",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "creator_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("attempts_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "status",
            postgresql.ENUM(name="invite_status", create_type=False),
            nullable=False,
            server_default="active",
        ),
        sa.Column("role", sa.String(255), nullable=False),
        sa.Column("seniority", sa.String(32), nullable=True),
        sa.Column("focus", sa.String(32), nullable=True),
        sa.Column("industry", sa.String(128), nullable=True),
        sa.Column(
            "duration_minutes", sa.Integer(), nullable=False, server_default="20"
        ),
        sa.Column(
            "question_set_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_sets.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("token", name="uq_interview_invites_token"),
    )
    op.create_index(
        "ix_interview_invites_creator_id", "interview_invites", ["creator_id"]
    )
    op.create_index(
        "ix_interview_invites_token", "interview_invites", ["token"]
    )

    op.create_table(
        "invitees",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "invite_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("interview_invites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(name="invitee_status", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_invitees_invite_id", "invitees", ["invite_id"])
    op.create_index("ix_invitees_email", "invitees", ["email"])

    op.add_column(
        "sessions",
        sa.Column(
            "invite_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("interview_invites.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_sessions_invite_id", "sessions", ["invite_id"])


def downgrade() -> None:
    op.drop_index("ix_sessions_invite_id", table_name="sessions")
    op.drop_column("sessions", "invite_id")

    op.drop_index("ix_invitees_email", table_name="invitees")
    op.drop_index("ix_invitees_invite_id", table_name="invitees")
    op.drop_table("invitees")

    op.drop_index("ix_interview_invites_token", table_name="interview_invites")
    op.drop_index("ix_interview_invites_creator_id", table_name="interview_invites")
    op.drop_table("interview_invites")

    op.drop_table("question_sets")

    sa.Enum(name="invitee_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="invite_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="question_set_type").drop(op.get_bind(), checkfirst=True)
