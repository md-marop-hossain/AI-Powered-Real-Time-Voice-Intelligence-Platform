"""Report summary builder + PDF rendering via WeasyPrint."""

from __future__ import annotations

import structlog
import os
import sys
from datetime import datetime

from jinja2 import Template

from app.models.session import Session
from app.scoring.aggregator import aggregate_session_scores

log = structlog.get_logger()

# WeasyPrint loads native GLib/Pango/Cairo via ctypes, which on Windows resolves
# library names through PATH. Tesseract ships an outdated Pango that wins the
# lookup if it appears first on PATH, so we prepend the GTK3 runtime bin here.
# add_dll_directory alone is not enough — ctypes.util.find_library walks PATH.
if sys.platform == "win32":
    _gtk_bin = os.environ.get(
        "GTK3_RUNTIME_BIN", r"C:\Program Files\GTK3-Runtime Win64\bin"
    )
    if os.path.isdir(_gtk_bin):
        os.add_dll_directory(_gtk_bin)
        if _gtk_bin not in os.environ.get("PATH", "").split(os.pathsep):
            os.environ["PATH"] = _gtk_bin + os.pathsep + os.environ.get("PATH", "")
        _fc_path = os.path.join(os.path.dirname(_gtk_bin), "etc", "fonts")
        if os.path.isdir(_fc_path):
            os.environ.setdefault("FONTCONFIG_PATH", _fc_path)
    else:
        log.warning("GTK3 runtime bin not found at %s; PDF rendering may fail", _gtk_bin)


def build_report_summary(session: Session, narrative=None) -> dict:
    turns = list(session.turns or [])
    agg = aggregate_session_scores(turns)
    summary = {
        "session_id": str(session.id),
        "role": session.role,
        "duration_minutes": session.duration_minutes,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
        "turn_count": len(turns),
        "overall_score": agg["overall_score"],
        "dimension_averages": agg["dimension_averages"],
        "schema_version": agg.get("schema_version", "v1"),
        "focus_violations": int(getattr(session, "focus_violations", 0) or 0),
        "skill_coverage": getattr(session, "skill_coverage", None) or {},
        "difficulty_curve": getattr(session, "difficulty_curve", None) or [],
        "narrative": {
            "executive_summary": narrative.executive_summary if narrative else "",
            "strong_skills": narrative.strong_skills if narrative else [],
            "weak_skills": narrative.weak_skills if narrative else [],
            "recommendations": narrative.recommendations if narrative else [],
        },
        "turns": [
            {
                "index": t.index,
                "kind": t.question_kind,
                "question": t.question,
                "answer": t.answer or "",
                "scores": t.scores or {},
                "rationale": t.rationale or "",
                "skill_tags": getattr(t, "skill_tags", None) or [],
                "difficulty_level": getattr(t, "difficulty_level", None),
                "verified_scores": getattr(t, "verified_scores", None),
                # Object-storage key only — the API layer turns this into a
                # short-lived presigned URL on every report fetch so persisted
                # JSON never carries an expiring URL.
                "audio_key": t.audio_key,
            }
            for t in turns
        ],
    }
    return summary


PDF_TEMPLATE = Template("""
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif;
             color: #1f2937; margin: 32px; }
      h1 { margin-bottom: 4px; }
      h2 { border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-top: 28px; }
      .muted { color: #6b7280; }
      .score-grid { display: flex; gap: 24px; margin: 16px 0; }
      .score-card { background: #f3f4f6; border-radius: 8px; padding: 12px 16px;
                    min-width: 120px; }
      .score-card .label { font-size: 12px; text-transform: uppercase; color: #6b7280; }
      .score-card .value { font-size: 28px; font-weight: 600; color: #111827; }
      .turn { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px;
              margin-bottom: 14px; }
      .question { font-weight: 600; margin-bottom: 6px; }
      .answer { white-space: pre-wrap; color: #374151; }
      .turn-scores { margin-top: 8px; font-size: 12px; color: #4b5563; }
      .badge { display: inline-block; background: #eef2ff; color: #4f46e5;
               border-radius: 4px; padding: 1px 6px; font-size: 11px; margin-right: 4px; }
    </style>
  </head>
  <body>
    <h1>Mock Interview Report</h1>
    <div class="muted">{{ summary.role }} &middot; {{ summary.duration_minutes }} min &middot;
      {{ summary.started_at or '' }}</div>

    <h2>Overall</h2>
    <div class="score-grid">
      <div class="score-card">
        <div class="label">Overall</div>
        <div class="value">{{ '%.1f'|format(summary.overall_score) }}/10</div>
      </div>
      {% for dim, val in summary.dimension_averages.items() %}
      <div class="score-card">
        <div class="label">{{ dim }}</div>
        <div class="value">{{ '%.1f'|format(val) }}</div>
      </div>
      {% endfor %}
    </div>

    <h2>Per-Question Breakdown</h2>
    {% for t in summary.turns %}
      <div class="turn">
        <div class="question">
          <span class="badge">Q{{ t.index }} &middot; {{ t.kind }}</span>
          {{ t.question }}
        </div>
        <div class="answer">{{ t.answer or '(no answer)' }}</div>
        {% if t.scores %}
        <div class="turn-scores">
          {% for k, v in t.scores.items() %}<span class="badge">{{ k }}: {{ v }}</span>{% endfor %}
        </div>
        {% endif %}
      </div>
    {% endfor %}

    {% if summary.skill_coverage %}
    <h2>Skill Coverage</h2>
    <div class="score-grid">
      {% for skill_id, score in summary.skill_coverage.items() %}
      <div class="score-card">
        <div class="label">{{ skill_id.replace('skill:', '').replace('_', ' ').title() }}</div>
        <div class="value">{{ '%.1f'|format(score) }}</div>
      </div>
      {% endfor %}
    </div>
    {% endif %}

    {% if summary.narrative and summary.narrative.executive_summary %}
    <h2>AI Coaching Feedback</h2>
    <p>{{ summary.narrative.executive_summary }}</p>
    {% if summary.narrative.strong_skills %}
    <h3>Strengths</h3>
    <ul>{% for s in summary.narrative.strong_skills %}<li>{{ s }}</li>{% endfor %}</ul>
    {% endif %}
    {% if summary.narrative.weak_skills %}
    <h3>Areas to Improve</h3>
    <ul>{% for s in summary.narrative.weak_skills %}<li>{{ s }}</li>{% endfor %}</ul>
    {% endif %}
    {% if summary.narrative.recommendations %}
    <h3>Recommendations</h3>
    <ul>{% for r in summary.narrative.recommendations %}<li>{{ r }}</li>{% endfor %}</ul>
    {% endif %}
    {% endif %}

    <p class="muted" style="margin-top: 32px; font-size: 11px;">
      Generated {{ now }}
    </p>
  </body>
</html>
""")


def render_pdf(session: Session, summary: dict) -> bytes:
    html = PDF_TEMPLATE.render(summary=summary, now=datetime.utcnow().isoformat())
    from weasyprint import HTML

    return HTML(string=html).write_pdf()
