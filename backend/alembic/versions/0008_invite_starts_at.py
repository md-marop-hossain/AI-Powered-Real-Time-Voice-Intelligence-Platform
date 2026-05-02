"""Add starts_at to interview_invites for scheduled assessment windows.

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-02

Adds nullable starts_at column to interview_invites so creators can schedule
an interview window that opens at a future time. NULL means immediately available.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "interview_invites",
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("interview_invites", "starts_at")
