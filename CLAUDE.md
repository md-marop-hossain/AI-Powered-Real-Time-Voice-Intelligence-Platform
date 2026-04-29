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
  - `interviews/` — agent, orchestrator, websocket, stt
  - `auth/`, `users/`, `resumes/`, `db/`
- [backend/alembic/](backend/alembic/) — DB migrations
- [backend/tests/](backend/tests/) — pytest suite (`asyncio_mode = "auto"`)
- [frontend/src/](frontend/src/) — React app

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
