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
  - `interviews/` — agent, orchestrator, websocket, stt, tts
  - `invites/` — invitation system: token validation, question-set builders (predefined / AI / JD), routes
  - `auth/`, `resumes/`, `reports/`, `scoring/`, `core/`, `models/`, `schemas/`
- [backend/alembic/](backend/alembic/) — DB migrations (`0001`–`0005`; `0005_invitations` adds `question_sets`, `interview_invites`, `invitees` + `sessions.invite_id`)
- [backend/tests/](backend/tests/) — pytest suite (`asyncio_mode = "auto"`)
- [frontend/src/](frontend/src/) — React app
  - `pages/` — includes `CreateInvitePage`, `InviteLandingPage`, `InvitesDashboardPage`, `InviteResultsPage` for the invitation flow

## Notable features

- **Live interview** with patient turn-taking, soft nudges (cap 2), real follow-ups (cap 2), stop-intent detection, focus-integrity checks (3-strike limit), auto-end on timer.
- **Invitation system** — creators send tokenized email invites tied to a `QuestionSet` (predefined / AI-generated / JD-based). Candidates authenticate, the system enforces `current_user.email == invitee.email` on `/start`, attempts decrement on completion, and `Session.invite_id` links results back to the creator's dashboard.
- **Stuck-page recovery** — `InterviewRoom` runs a watchdog that polls `/sessions/:id` when (a) the WS closes without `session_ended` or (b) the local timer reaches 0 and no server close-out arrives within ~5s. After a max-attempts cap it navigates anyway so the candidate is never stranded.

## Interview-mode contract

Four modes coexist, each fully isolated at runtime. The mode is persisted on `session.questions_plan["mode"]` and read by [websocket.py](backend/app/interviews/websocket.py) and [orchestrator.py](backend/app/interviews/orchestrator.py).

| Mode | Plan source (system prompt) | Resume context in follow-ups | Ad-hoc follow-ups |
|------|------------------------------|------------------------------|-------------------|
| `resume_based` (default) | [agent.py](backend/app/interviews/agent.py) `INITIAL_QUESTIONS_SYSTEM` (resume + role/seniority/focus) | **Yes** — full | Yes |
| `predefined` (invite) | Creator's verbatim list — [`build_predefined`](backend/app/invites/question_sets.py) | **No** — suppressed | **No** — orchestrator rewrites `ask_followup` → `next_question` (or `end_section` at the last slot) |
| `ai_generated` (invite) | [`build_ai_generated`](backend/app/invites/question_sets.py) with `_AI_INVITE_SYSTEM` (NO resume; bracketed placeholders forbidden) + creator instructions | **No** — suppressed | Yes |
| `jd_based` (invite) | [`build_jd_based`](backend/app/invites/question_sets.py) with `_JD_SYSTEM` reading the JD | **No** — suppressed | Yes |

**Isolation invariants** (don't break these):

- `session.questions_plan` is always `{"questions": [...], "mode": "<one of the four>"}`. Both `interviews/routes.py:start_session` (sets `resume_based`) and `invites/routes.py:start_invite` (sets the invite's question_set type) write this shape.
- `websocket.py` only builds `resume_summary` when `mode == "resume_based"`. Invite modes pass `""` so the follow-up LLM can't reference resume details that weren't in the plan.
- `SessionOrchestrator(mode=...)` validates against the four-value set; anything unknown falls back to `resume_based` for back-compat.
- All AI/JD plan output passes through `_scrub_questions` in [question_sets.py](backend/app/invites/question_sets.py), which strips bracketed tokens like `[Company Name]` / `[Programming Language]` if they leak past the system-prompt rules.
- Nudges (`Take your time.`, `Go on.`) are allowed in every mode — they're conversational glue, not new questions.
- A predefined plan with N questions ends gracefully at slot N, even if time remains, via the existing `plan_idx >= len(plan)-1 + next_question → end_section` rule.

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
