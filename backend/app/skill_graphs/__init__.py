"""Skill graph loader — maps a role name to a SkillGraph for scoring/tagging."""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache

from app.agents.base import SkillGraph, SkillNode

_GRAPH_DIR = os.path.dirname(__file__)


@lru_cache(maxsize=64)
def load_skill_graph(role: str) -> SkillGraph | None:
    """Return the SkillGraph for *role*, or the default graph if no exact match.

    Role matching: lowercase + spaces→underscores + strip non-alphanum.
    Falls back to 'default.json' if no role-specific file exists.
    Returns None only if even the default file is missing.
    """
    slug = re.sub(r"[^a-z0-9_]", "", role.lower().replace(" ", "_"))
    for name in (slug, "default"):
        path = os.path.join(_GRAPH_DIR, f"{name}.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            return SkillGraph(
                role=data["role"],
                skills=[SkillNode(**s) for s in data["skills"]],
            )
    return None
