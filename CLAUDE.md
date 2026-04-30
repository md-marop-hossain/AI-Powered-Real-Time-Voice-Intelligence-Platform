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

- **Live interview** with patient turn-taking, soft nudges, follow-up cap, stop-intent detection, focus-integrity checks (3-strike limit), auto-end on timer.
- **Invitation system** — creators send tokenized email invites tied to a `QuestionSet` (predefined / AI-generated / JD-based). Candidates authenticate, the system enforces `current_user.email == invitee.email` on `/start`, attempts decrement on completion, and `Session.invite_id` links results back to the creator's dashboard.

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
