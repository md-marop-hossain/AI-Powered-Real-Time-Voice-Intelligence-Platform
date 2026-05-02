# AI-Powered Voice-Based Mock Interview System

Full-stack web app where a candidate uploads a resume and an AI voice agent runs a real-time mock interview.

## Stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind + shadcn-style UI ([frontend/](frontend/))
- **Backend:** FastAPI (Python 3.11+) with native WebSockets ([backend/](backend/))
- **Data:** Postgres + pgvector, Redis, MinIO (via [docker-compose.yml](docker-compose.yml))
- **AI:** Pluggable LLM (Groq / OpenAI), Deepgram streaming STT, ElevenLabs streaming TTS
- **Auth:** Email/password with 6-digit OTP, Google OAuth, JWT access + refresh

## Layout

- [backend/app/](backend/app/) — FastAPI app
  - `agents/` — Phase 1 agent fleet: `base.py` (shared types), `planner.py`, `researcher.py`, `question.py`, `evaluator.py`, `verifier.py`, `feedback.py`
  - `skill_graphs/` — per-role JSON skill graphs + `__init__.py` loader (`load_skill_graph(role)`)
  - `interviews/` — agent, orchestrator, websocket, stt, tts
  - `invites/` — invitation system: token validation, question-set builders (predefined / AI / JD), routes
  - `auth/`, `resumes/`, `reports/`, `scoring/`, `core/`, `models/`, `schemas/`
- [backend/alembic/](backend/alembic/) — DB migrations (`0001`–`0008`; `0005_invitations` adds `question_sets`, `interview_invites`, `invitees` + `sessions.invite_id`; `0006_question_set_resume` adds `question_sets.resume_id`; `0007_phase1_ai_layer` adds `turns.{difficulty_level,skill_tags,verified_scores,verifier_flags}` + `sessions.{difficulty_curve,skill_coverage}`; `0008_invite_starts_at` adds `interview_invites.starts_at`)
- [backend/tests/](backend/tests/) — pytest suite (`asyncio_mode = "auto"`)
- [frontend/src/](frontend/src/) — React app
  - `pages/` — includes `CreateInvitePage`, `InviteLandingPage`, `InvitesDashboardPage`, `InviteResultsPage` for the invitation flow

## Notable features

- **Live interview** with patient turn-taking, soft nudges (cap 2), real follow-ups (cap 2), stop-intent detection, focus-integrity checks (3-strike limit), auto-end on timer.
- **Invitation system** — creators send tokenized email invites tied to a `QuestionSet` (predefined / AI-generated / JD-based). Candidates authenticate, the system enforces `current_user.email == invitee.email` on `/start`, attempts decrement on completion, and `Session.invite_id` links results back to the creator's dashboard.
- **Stuck-page recovery** — `InterviewRoom` runs a watchdog that polls `/sessions/:id` when (a) the WS closes without `session_ended` or (b) the local timer reaches 0 and no server close-out arrives within ~5s. After a max-attempts cap it navigates anyway so the candidate is never stranded.
- **Mid-interview reconnect** — `SessionOrchestrator` snapshots state to Redis (`interview:{session_id}:state`, 3h TTL) on every turn / nudge / focus violation. On WS reconnect, the handler chooses between Redis restore → DB recovery (from persisted `Turn` rows) → fresh start. A `{"type": "resumed"}` event signals the client.
- **Per-turn audio replay** — the WS handler duplicates every inbound PCM frame into a per-turn buffer (capped at ~12 MB), and on each turn boundary fires a background task that encodes WAV and uploads to MinIO at `audio/{user_id}/{session_id}/{turn_id}.wav`. `Turn.audio_key` is persisted; `GET /report` re-signs it into a fresh `audio_url` per turn for the `TranscriptPlayer` UI.
- **Background report generation** — when a session completes (WS `finally` or HTTP `/end`), an async task runs `render_pdf` in a `ThreadPoolExecutor` (WeasyPrint is sync CPU-bound), uploads to MinIO, persists the `Report` row, then sends a creator-notification email. Idempotent against the `Report` row to prevent duplicate emails when both completion paths fire.
- **Question progress indicator** — every `ai_question` WS frame carries `q_index` (1-based current primary index) and `q_total` (plan length). `QuestionCard` renders them as `{n} OF {total}` next to the `Q{n}` turn marker. Follow-ups inherit the same indices, so the badge reads stably across a probe sequence.
- **Score trend** — `DashboardPage` renders `ScoreTrend` (inline-SVG sparkline, no charting lib) showing `overall_score` over time across all completed sessions. Auto-hides when fewer than 2 scored sessions exist.
- **Transcript export** — `ReportPage` builds a plain-text transcript from `summary.turns` (question + answer + per-turn rationale) and triggers a Blob download via `URL.createObjectURL`. Filename keys off `role` + first 8 chars of `session_id`.
- **Scheduled invite windows** — `InterviewInvite.starts_at` (nullable) lets creators schedule when a link opens. `validate_invite()` returns a `not_open` error with a human-readable UTC timestamp if the candidate arrives before the window; both `start_invite` and `participate_as_creator` call this path. `CreateInvitePage` exposes a `datetime-local` picker; omitting it means immediately available.
- **Bulk CSV import** — `CreateInvitePage` has an "Import from CSV" file input that parses the first column as email addresses (header row auto-detected), deduplicates, and merges into the recipients textarea. No new backend endpoint.
- **Structured logging + Sentry** — `structlog` configured with stdlib bridge in `app/core/logging.py`; JSON output in staging/production, coloured `ConsoleRenderer` in development. `configure_logging()` called first in the FastAPI lifespan (before `assert_jwt_secret_is_safe`). Sentry initialized opt-in via `SENTRY_DSN` env var; frontend opt-in via `VITE_SENTRY_DSN`. All modules use `structlog.get_logger()` instead of `logging.getLogger` — except `config.py`'s `assert_jwt_secret_is_safe()` which runs before structlog is configured and must stay on stdlib so `caplog` capture works in tests.
- **Phase 1 — Multi-agent AI intelligence layer:**
  - **6-agent fleet** — PlannerAgent (wraps question generation + research hints), ResearchAgent (cross-session weak-area detection via `session.skill_coverage`), QuestionAgent (pure-Python difficulty calibration), EvaluatorAgent (parallel 7-dim scoring: 5 LLM + 2 deterministic), VerifierAgent (fire-and-forget second-pass LLM judge, writes `verified_scores`/`verifier_flags`), FeedbackAgent (post-session coaching narrative in PDF report).
  - **7-dimensional scoring** — `technical_depth`, `problem_solving`, `communication`, `structure`, `consistency` (LLM); `confidence` (filler-word ratio + length), `keyword_coverage` (skill graph intersection) (deterministic). Weighted aggregation: LLM × 0.8 + deterministic × 0.2. Old 4-dim sessions auto-detected (v1 path) and scored with equal-weight average — fully backward compatible.
  - **Adaptive difficulty** — starts at 5.0; +0.5 if avg score ≥ 7.0, −0.5 if ≤ 4.0, clamped to [1.0, 10.0]. Curve persisted in `Session.difficulty_curve`. Question text annotated at extremes (< 3 → gentle scaffold hint; > 7 → no-scaffold note).
  - **Per-role skill graphs** — JSON files in `skill_graphs/` (backend_engineer, frontend_engineer, data_scientist, product_manager, engineering_manager, default). `Turn.skill_tags` records matched skill IDs per turn; `Session.skill_coverage` aggregates at session end. Report PDF shows a skill coverage panel.
  - **Cross-session memory** — ResearchAgent queries past sessions with `skill_coverage IS NOT NULL`, surfaces skills averaging < 5.0 as `weak_areas`; PlannerAgent injects them as priority probe hints into the question plan.

## Interview-mode contract

Four modes coexist, each fully isolated at runtime. The mode is persisted on `session.questions_plan["mode"]` and read by [websocket.py](backend/app/interviews/websocket.py) and [orchestrator.py](backend/app/interviews/orchestrator.py).

| Mode | Plan source (system prompt) | Résumé required at create time | Résumé context in follow-ups | Ad-hoc follow-ups |
|------|------------------------------|---|---|-------------------|
| `resume_based` (default) | [agent.py](backend/app/interviews/agent.py) `INITIAL_QUESTIONS_SYSTEM` (résumé + role/seniority/focus) | n/a — candidate's own résumé | **Yes** — full | Yes |
| `predefined` (invite) | Creator's verbatim list — [`build_predefined`](backend/app/invites/question_sets.py) | ❌ rejected by schema | **No** — no résumé linked | **No** — orchestrator rewrites `ask_followup` → `next_question` (or `end_section` at the last slot) |
| `ai_generated` (invite) | [`build_ai_generated`](backend/app/invites/question_sets.py) with `_AI_INVITE_SYSTEM` — résumé-grounded plan + creator instructions | ✅ **required** (creator uploads candidate's résumé) | **Yes** — same résumé that drove the plan | Yes |
| `jd_based` (invite) | [`build_jd_based`](backend/app/invites/question_sets.py) with `_JD_SYSTEM` — résumé-grounded plan + JD | ✅ **required** (creator uploads candidate's résumé) | **Yes** — same résumé that drove the plan | Yes |

**Invite résumé linkage** — for `ai_generated` and `jd_based`, the creator uploads the candidate's résumé during invite creation. The flow:

1. Frontend POSTs the file to `/resumes` (returns `resume_id`).
2. `POST /invites` body carries `resume_id`; the [`CreateInviteRequest`](backend/app/schemas/invite.py) validator rejects requests that omit it for those modes (and rejects requests that include it for `predefined`).
3. `create_invites` in [invites/routes.py](backend/app/invites/routes.py) verifies the résumé belongs to the creator (defence against IDOR), feeds the parsed JSON to the question-generation LLM, and persists `resume_id` on the new `QuestionSet` row.
4. When a candidate starts the interview, `start_invite` and `participate_as_creator` set `Session.resume_id` to `invite.question_set.resume_id` (priority over the candidate's own latest résumé), keeping the live follow-up agent grounded in the same content the plan was generated from.
5. Schema migration: [`0006_question_set_resume`](backend/alembic/versions/0006_question_set_resume.py) adds the nullable FK with `ON DELETE SET NULL` — résumé deletion gracefully degrades the live agent without dropping the question set.

**Isolation invariants** (don't break these):

- `session.questions_plan` is always `{"questions": [...], "mode": "<one of the four>"}`. For `resume_based` sessions it also carries `"research_hints": {"weak_areas": [...], "cross_session_note": "..."}` (may be empty if ResearchAgent fails — always present, never absent). Both `interviews/routes.py:start_session` (sets `resume_based`) and `invites/routes.py:start_invite` (sets the invite's question_set type) write this shape.
- `websocket.py` builds `resume_summary` whenever `session.resume` is present — **regardless of mode** (the mode-based gate was replaced with a presence-based gate). Predefined-mode invites never link a résumé so the agent stays generic; all other modes carry the same résumé end-to-end.
- `SessionOrchestrator(mode=...)` validates against the four-value set; anything unknown falls back to `resume_based` for back-compat.
- All AI/JD plan output passes through `_scrub_questions` in [question_sets.py](backend/app/invites/question_sets.py), which strips bracketed tokens like `[Company Name]` / `[Programming Language]` if they leak past the system-prompt rules.
- The `_AI_INVITE_SYSTEM` and `_JD_SYSTEM` prompts now ASSUME a parsed résumé is provided. Builders enforce this through their function signatures (`parsed_resume: dict` is a required kwarg). If a future caller wants a résumé-free variant, add a separate prompt — don't pass `{}` and hope.
- Nudges (`Take your time.`, `Go on.`) are allowed in every mode — they're conversational glue, not new questions.
- A predefined plan with N questions ends gracefully at slot N, even if time remains, via the existing `plan_idx >= len(plan)-1 + next_question → end_section` rule.

## Production invariants

Concrete patterns that other code should follow when extending these subsystems — breaking these reintroduces fixed bugs.

- **Invite window enforcement.** `validate_invite()` in `invites/service.py` checks `starts_at` before the expiry check. Any new flow that calls `validate_invite()` gets this check for free. Do NOT bypass `validate_invite()` or add a separate `start_invite` path — both `start_invite` and `participate_as_creator` already route through it.
- **Concurrent-session guard.** Every endpoint that creates a `Session` (`interviews/routes.start_session`, `invites/routes.start_invite`, `invites/routes.participate_as_creator`) MUST first query for any `pending` / `in_progress` session for that user and return 409 if one exists. Otherwise the candidate can run two sessions simultaneously and corrupt the score history.
- **Rate limiting.** Every cost-bearing route that talks to the LLM, an LLM-backed builder, or large-file storage carries an `@limiter.limit(...)` decorator (the `slowapi` Limiter is exported from `app.auth.routes`). Required `request: Request` first arg. New routes that call `get_llm_provider()` or generate question plans must add a limit too.
- **Resume sanitization.** Anything that interpolates résumé content into an LLM prompt MUST go through `_sanitize_resume_text` (raw text) or `_sanitize_resume_obj` (parsed dict) in [agent.py](backend/app/interviews/agent.py). They strip C0/C1 control codes and Unicode line/paragraph separators and apply hard length caps (`MAX_RESUME_PROMPT_CHARS = 8000`, `MAX_RESUME_FIELD_CHARS = 1500`).
- **JWT_SECRET safety.** `Settings.assert_jwt_secret_is_safe()` runs in the FastAPI lifespan. It raises in `staging` / `production` for known-insecure placeholders or secrets shorter than 16 chars. Local dev (`ENV=development`) only warns. Don't disable this; set a real secret instead.
- **WebSocket reconnect.** `interviews/websocket.py` chooses between three start paths in this order: Redis state → `recover_from_db()` → fresh `orch.start()`. The orchestrator persists state via `_save_state()` on every turn / nudge / focus violation and clears it via `_clear_state()` in `_end_session`. New orchestrator state fields must be threaded through both.
- **Post-completion background task.** Report generation + creator notification email both fire from a single fire-and-forget task in `_generate_report_background`. It is **idempotent against the `Report` row** — once a report exists, the task no-ops. This is what prevents duplicate creator emails when both the WS `finally` block and `POST /sessions/{id}/end` schedule it. Anything else that needs to run "once per completed session" should attach to this task, not invent a new one.
- **WebSocket heartbeat.** A 30s `heartbeat()` task pings the client to defeat LB idle timeouts. It uses the same `send_lock` as TTS / transcript sends. Cancelled + awaited in the WS `finally` block alongside the consumer task — any new long-lived task in the WS handler should follow the same lifecycle.
- **PCM mic capture.** Frontend uses `AudioWorkletNode` (loaded from [frontend/public/pcm-worklet.js](frontend/public/pcm-worklet.js)); the legacy `ScriptProcessorNode` path is a fallback only. Wire format on the WS is unchanged: 16kHz mono Int16LE chunks. The worklet path runs off the main thread.
- **Per-turn audio replay.** The WS handler duplicates every PCM frame into a per-turn `bytearray` (capped at `_MAX_TURN_AUDIO_BYTES`, ~12 MB / 6 min). On every real turn boundary (not nudges) it snapshot-and-clears the buffer and fires `_save_turn_audio` as a background task. WAV encoding + upload + DB write all happen there — never inline. `build_report_summary` stores `audio_key` (not URL); `get_report` re-signs it on every fetch.

## UI invariants (interview room)

- The hero timer and the floating mini-timer in [InterviewRoom.tsx](frontend/src/pages/InterviewRoom.tsx) read from a single parent-owned `liveSeconds` state, with `frozen` set on both `CountdownTimer` instances. They are guaranteed to display the same digits — never add a separate local-tick interval inside `CountdownTimer` instances used here.
- The ONE-MINUTE banner and the floating timer cannot overlap: the floating timer slides to `top: 64px` while the banner is up.

## Common commands

```bash
# infra
docker compose up -d

# backend (from backend/)
uvicorn app.main:app --reload --port 8000
alembic upgrade head
pytest

# frontend (from frontend/)
npm run dev          # vite dev server on :5173
npm run build        # tsc -b && vite build
npm run lint
npm test             # vitest
npm run test:e2e     # playwright
```

## Conventions

- Python: ruff (`line-length = 100`, `target-version = "py311"`)
- TypeScript: strict mode, ESLint
- Migrations live in [backend/alembic/versions/](backend/alembic/versions/) — create with `alembic revision --autogenerate -m "..."`
- Secrets in `.env` files (never commit) — see [README.md](README.md) for required keys

## Running services (local dev)

| Service | Port |
|---|---|
| Frontend (Vite) | 5173 |
| Backend (FastAPI) | 8000 |
| Postgres | 5432 |
| Redis | 6379 |
| MinIO | 9000 / 9001 |

See [README.md](README.md) for full setup and [PROJECT_GUIDE.md](PROJECT_GUIDE.md) for architectural detail.
