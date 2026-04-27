"""LLM interview agent: generates initial questions and decides follow-ups
based on the conversation so far.
"""

from __future__ import annotations

import json
import logging

from app.core.llm_provider import JSON_RESPONSE, get_llm_provider

log = logging.getLogger(__name__)


INITIAL_QUESTIONS_SYSTEM = (
    "You are a senior technical interviewer planning a mock interview. "
    "Given the candidate's parsed resume and the target role, produce a structured "
    "interview plan with 6-10 well-scoped primary questions covering: "
    "introduction, resume-specific experience, role-relevant technical depth, "
    "behavioral, and a closing question. Tailor questions to the resume."
)

INITIAL_QUESTIONS_USER_TEMPLATE = """Target role: {role}
Duration: {duration_minutes} minutes

Parsed resume (JSON):
{resume_json}

Return JSON exactly in this shape:
{{
  "questions": [
    {{"index": 1, "section": "intro|experience|technical|behavioral|closing",
      "question": "..."}}
  ]
}}"""


async def generate_question_plan(
    role: str, duration_minutes: int, parsed_resume: dict | None
) -> list[dict]:
    provider = get_llm_provider()
    raw = await provider.chat(
        messages=[
            {"role": "system", "content": INITIAL_QUESTIONS_SYSTEM},
            {
                "role": "user",
                "content": INITIAL_QUESTIONS_USER_TEMPLATE.format(
                    role=role,
                    duration_minutes=duration_minutes,
                    resume_json=json.dumps(parsed_resume or {}, ensure_ascii=False)[:8000],
                ),
            },
        ],
        response_format=JSON_RESPONSE,
        temperature=0.4,
    )
    try:
        data = json.loads(raw)
        return data.get("questions", [])
    except json.JSONDecodeError:
        log.warning("LLM returned non-JSON for question plan: %s", raw[:200])
        return []


FOLLOWUP_SYSTEM = (
    "You are a real-time interview agent. Given the interview plan, the conversation "
    "history, and the candidate's latest answer, decide whether to:\n"
    "- ask_followup: probe deeper on the same question\n"
    "- next_question: move to the next planned question\n"
    "- end_section: close the interview if all key questions are covered or time is short\n\n"
    "Score the candidate's last answer on four dimensions (0-10):\n"
    "- clarity: how clearly they communicated\n"
    "- depth: how thoroughly they explored the topic\n"
    "- correctness: factual / technical accuracy\n"
    "- communication: pacing, structure, professionalism\n\n"
    "Return STRICT JSON, no commentary."
)

FOLLOWUP_USER_TEMPLATE = """Plan:
{plan_json}

Resume context:
{resume_summary}

Conversation so far (most recent last):
{history}

Candidate's latest answer:
\"\"\"{answer}\"\"\"

Time remaining: {time_remaining_seconds}s

Return JSON in this exact shape:
{{
  "decision": "ask_followup" | "next_question" | "end_section",
  "next_text": "the question to speak (or a brief closing remark if end_section)",
  "scores": {{"clarity": 0-10, "depth": 0-10, "correctness": 0-10, "communication": 0-10}},
  "rationale": "brief internal note"
}}"""


async def decide_next_turn(
    plan: list[dict],
    resume_summary: str,
    history: list[dict],
    answer: str,
    time_remaining_seconds: int,
) -> dict:
    provider = get_llm_provider()
    history_text = "\n".join(
        f"[{h.get('role','?')}] {h.get('content','')}" for h in history[-12:]
    )
    raw = await provider.chat(
        messages=[
            {"role": "system", "content": FOLLOWUP_SYSTEM},
            {
                "role": "user",
                "content": FOLLOWUP_USER_TEMPLATE.format(
                    plan_json=json.dumps(plan, ensure_ascii=False)[:4000],
                    resume_summary=resume_summary[:2000],
                    history=history_text[:6000],
                    answer=answer[:4000],
                    time_remaining_seconds=time_remaining_seconds,
                ),
            },
        ],
        response_format=JSON_RESPONSE,
        temperature=0.5,
    )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {
            "decision": "next_question",
            "next_text": "Thanks. Let's move to the next question.",
            "scores": {"clarity": 5, "depth": 5, "correctness": 5, "communication": 5},
            "rationale": "fallback (LLM JSON parse failed)",
        }
    # Validate shape and clamp scores.
    decision = data.get("decision", "next_question")
    if decision not in ("ask_followup", "next_question", "end_section"):
        decision = "next_question"
    scores = data.get("scores") or {}
    clamped = {
        k: max(0, min(10, int(scores.get(k, 5))))
        for k in ("clarity", "depth", "correctness", "communication")
    }
    return {
        "decision": decision,
        "next_text": data.get("next_text") or "",
        "scores": clamped,
        "rationale": data.get("rationale") or "",
    }
