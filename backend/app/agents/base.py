"""Shared types, constants, and dataclasses used by all agents in the fleet."""

from __future__ import annotations

from dataclasses import dataclass, field

# Hard ceiling on every agent LLM round-trip — same value as legacy agent.py
LLM_TIMEOUT_SECONDS = 30.0

# ── Scoring dimension schemas ──────────────────────────────────────────────────

# v2 — 7 dimensions (5 LLM + 2 deterministic)
NEW_DIMENSIONS = (
    "technical_depth",
    "problem_solving",
    "communication",
    "structure",
    "confidence",       # deterministic: filler ratio + answer length
    "consistency",      # LLM: answers build on each other without contradiction
    "keyword_coverage", # deterministic: skill keyword intersection
)

# v1 — original 4 dimensions (legacy sessions, backward compat)
OLD_DIMENSIONS = ("clarity", "depth", "correctness", "communication")

# Key whose presence in a Turn.scores dict signals v2 schema
V2_MARKER = "technical_depth"

# LLM-scored v2 dimensions (used for weighted aggregation)
LLM_DIMENSIONS = ("technical_depth", "problem_solving", "communication", "structure", "consistency")
# Deterministic v2 dimensions
DET_DIMENSIONS = ("confidence", "keyword_coverage")


# ── Agent output types ─────────────────────────────────────────────────────────

@dataclass
class ResearchHints:
    """Output of ResearchAgent: candidate weak areas + cross-session context."""
    weak_areas: list[str] = field(default_factory=list)
    probe_topics: list[str] = field(default_factory=list)
    cross_session_note: str = ""


@dataclass
class EvalResult:
    """Output of EvaluatorAgent: 7-dim scores + skill tags + rationale."""
    scores: dict[str, float] = field(default_factory=dict)
    rationale: str = ""
    skill_tags: list[str] = field(default_factory=list)


@dataclass
class VerifierResult:
    """Output of VerifierAgent: independent scores + flagged disagreements."""
    verified_scores: dict[str, float] = field(default_factory=dict)
    flags: list[str] = field(default_factory=list)


@dataclass
class FeedbackNarrative:
    """Output of FeedbackAgent: post-session coaching narrative."""
    executive_summary: str = ""
    strong_skills: list[str] = field(default_factory=list)
    weak_skills: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)


# ── Skill graph types ──────────────────────────────────────────────────────────

@dataclass
class SkillNode:
    """A single skill in a role's skill graph."""
    id: str
    name: str
    weight: float
    keywords: list[str]


@dataclass
class SkillGraph:
    """Role-specific skill taxonomy used for keyword coverage + tagging."""
    role: str
    skills: list[SkillNode]
