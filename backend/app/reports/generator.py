"""Report summary builder + PDF rendering via WeasyPrint."""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime

from jinja2 import Template

from app.models.session import Session
from app.scoring.aggregator import aggregate_session_scores

log = logging.getLogger(__name__)

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


def build_report_summary(session: Session) -> dict:
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
        "focus_violations": int(getattr(session, "focus_violations", 0) or 0),
        "turns": [
            {
                "index": t.index,
                "kind": t.question_kind,
                "question": t.question,
                "answer": t.answer or "",
                "scores": t.scores or {},
                "rationale": t.rationale or "",
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
