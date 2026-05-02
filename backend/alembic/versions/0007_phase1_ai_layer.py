"""Phase 1 AI Intelligence Layer — new columns for agents, scoring, difficulty.

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-02

Adds columns supporting the multi-agent fleet introduced in Phase 1:

turns:
  difficulty_level  — float, difficulty calibration at time of scoring
  skill_tags        — JSONB list of skill graph IDs matched by EvaluatorAgent
  verified_scores   — JSONB dict of VerifierAgent independent 7-dim scores
  verifier_flags    — JSONB list of dimension names flagged (delta > 1.5)

sessions:
  difficulty_curve  — JSONB list[float] difficulty after each scored turn
  skill_coverage    — JSONB dict {skill_id: avg_score} at session end

All columns are nullable — existing rows are unaffected.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── turns additions ────────────────────────────────────────────────────────
    op.add_column("turns", sa.Column("difficulty_level", sa.Float(), nullable=True))
    op.add_column("turns", sa.Column("skill_tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("turns", sa.Column("verified_scores", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("turns", sa.Column("verifier_flags", postgresql.JSONB(astext_type=sa.Text()), nullable=True))

    # ── sessions additions ─────────────────────────────────────────────────────
    op.add_column("sessions", sa.Column("difficulty_curve", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("sessions", sa.Column("skill_coverage", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("sessions", "skill_coverage")
    op.drop_column("sessions", "difficulty_curve")

    op.drop_column("turns", "verifier_flags")
    op.drop_column("turns", "verified_scores")
    op.drop_column("turns", "skill_tags")
    op.drop_column("turns", "difficulty_level")
