# AI-Powered Voice-Based Mock Interview System — Technical Stack

> Build specification for Claude Code. This document defines the exact technologies, libraries, and integrations to use. **Local development only** — production hosting is out of scope for now.

---

## 1. Project Overview (for context)

A web application where a candidate uploads their resume and an AI voice agent conducts a real-time mock interview. The system:

- Parses the resume and generates tailored questions
- Conducts a live voice interview (STT + LLM + TTS)
- Asks adaptive follow-up questions based on answers
- Enforces a countdown timer
- Stores all turns (questions, answers, scores, timestamps) in a database
- Shows live progress and a final scored report in a dashboard

---

## 2. Frontend

| Concern | Technology |
|---|---|
| Framework | **React 18** with **Vite** |
| Language | **TypeScript** |
| Styling | **Tailwind CSS** + **shadcn/ui** components |
| State management | **Zustand** (lightweight, ideal for session state) |
| Routing | **React Router v6** |
| Data fetching | **TanStack Query (React Query)** |
| Forms & validation | **React Hook Form** + **Zod** |
| Real-time audio | **WebRTC** + **Web Audio API** (`MediaRecorder`, `AudioWorklet`) |
| WebSocket client | Native `WebSocket` API |
| Audio visualization | **wavesurfer.js** or custom canvas waveform |
| Charts (reports) | **Recharts** |
| Icons | **lucide-react** |
| Notifications | **sonner** (toasts) |
| HTTP client | **axios** (with interceptors for JWT refresh) |
| Google OAuth | **@react-oauth/google** |

### Key frontend modules to build
- `AuthPages` — login (email/password + Google), signup, forgot password
- `ResumeUpload` — drag-and-drop with progress
- `InterviewRoom` — live interview screen: mic capture, WebSocket stream, AI avatar/waveform, live transcript pane, countdown timer, end-session button
- `Dashboard` — past sessions list, scores, search/filter
- `ReportView` — per-question breakdown, charts, downloadable PDF link

---

## 3. Backend

| Concern | Technology |
|---|---|
| Framework | **FastAPI** (Python 3.11+) |
| ASGI server | **Uvicorn** (with `--reload` for local dev) |
| WebSocket support | FastAPI's native `WebSocket` (built on Starlette) |
| ORM | **SQLAlchemy 2.0** (async) + **Alembic** for migrations |
| Validation | **Pydantic v2** + **pydantic-settings** for env config |
| Auth | **python-jose** for JWT, **passlib[bcrypt]** for password hashing |
| Google OAuth | **Authlib** or **google-auth** library |
| Background jobs | **Celery** with **Redis** broker (PDF generation, async scoring) |
| File handling | **python-multipart** for uploads |
| CORS & rate limiting | FastAPI middleware + **slowapi** |
| Email (password reset) | **fastapi-mail** (use MailHog locally) |

### Why FastAPI
This system is API-first and real-time heavy. FastAPI gives native async, native WebSockets, and first-class Pydantic validation — all of which matter for the streaming voice loop. Django would force you into Channels and add friction.

### Backend service structure (single FastAPI app, modular)
```
app/
├── core/           # config, security, dependencies, llm_provider
├── auth/           # routes, JWT, manual + Google OAuth
├── resumes/        # upload, parsing, embeddings
├── interviews/     # session orchestrator, WebSocket handler
├── scoring/        # rubric, aggregation
├── reports/        # PDF generation
├── models/         # SQLAlchemy models
├── schemas/        # Pydantic schemas
└── workers/        # Celery tasks
```

---

## 4. Authentication System

Two methods, both producing the same JWT in the end:

### 4.1 Manual Authentication (email + password)
- **Signup:** email, password, full name → password hashed with bcrypt → user row created → verification email sent (optional in dev)
- **Login:** email + password → returns access token (15 min) + refresh token (7 days)
- **Forgot password:** email with one-time reset token (valid 1 hour)
- **Refresh:** `/api/v1/auth/refresh` exchanges refresh token for new access token
- Passwords hashed with **bcrypt** via `passlib`
- Min password requirements enforced via Pydantic validator (e.g., 8+ chars, mixed case, digit)

### 4.2 Google OAuth (only third-party provider)
- Frontend uses **@react-oauth/google** to get a Google ID token
- Backend verifies the token server-side via `google-auth` library (never trust client-claimed identity)
- If the email exists → log them in
- If not → auto-create the account (no password set; flag `auth_provider = "google"`)
- Returns the same JWT pair as manual login

### 4.3 User table schema (key fields)
```
users:
  id (uuid, primary key)
  email (unique, indexed)
  password_hash (nullable — null for Google-only users)
  full_name
  auth_provider (enum: "manual" | "google" | "both")
  google_sub (nullable — Google's stable user ID)
  email_verified (bool)
  created_at, updated_at
```

A user can have both — if a manual user later signs in with Google using the same email, link the accounts (set `auth_provider = "both"`).

---

## 5. AI / ML Stack — Pluggable LLM Provider

**Critical requirement:** the LLM provider is selected via environment variable. The application code must NOT hardcode a provider.

### 5.1 Supported providers
| Provider | Use case | SDK |
|---|---|---|
| **Groq** | Default — fast inference, cheap, great for real-time follow-ups | `groq` Python SDK |
| **OpenAI** | Alternative — higher quality reasoning, GPT-4o family | `openai` Python SDK |

### 5.2 Provider selection (env-driven)
```env
LLM_PROVIDER=groq                       # or "openai"
LLM_MODEL=llama-3.3-70b-versatile       # or "gpt-4o-mini", etc.
GROQ_API_KEY=...
OPENAI_API_KEY=...
```

### 5.3 Implementation pattern
Build a thin abstraction layer in `app/core/llm_provider.py`:

```python
# Pseudocode — the real implementation should use proper async clients

from typing import Protocol

class LLMProvider(Protocol):
    async def chat(self, messages: list, response_format: dict | None = None) -> dict: ...

class GroqProvider:
    def __init__(self, api_key: str, model: str):
        from groq import AsyncGroq
        self.client = AsyncGroq(api_key=api_key)
        self.model = model

    async def chat(self, messages, response_format=None):
        resp = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            response_format=response_format or {"type": "json_object"},
        )
        return resp.choices[0].message.content

class OpenAIProvider:
    def __init__(self, api_key: str, model: str):
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model

    async def chat(self, messages, response_format=None):
        resp = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            response_format=response_format or {"type": "json_object"},
        )
        return resp.choices[0].message.content

def get_llm_provider() -> LLMProvider:
    name = settings.LLM_PROVIDER.lower()
    if name == "groq":
        return GroqProvider(settings.GROQ_API_KEY, settings.LLM_MODEL)
    if name == "openai":
        return OpenAIProvider(settings.OPENAI_API_KEY, settings.LLM_MODEL)
    raise ValueError(f"Unknown LLM_PROVIDER: {name}")
```

Both Groq and OpenAI use OpenAI-compatible chat APIs, so the request/response shape is nearly identical — keep the abstraction thin. Use **JSON mode** on both to force the follow-up agent to return:

```json
{
  "decision": "ask_followup | next_question | end_section",
  "next_text": "the question to speak",
  "scores": { "clarity": 0-10, "depth": 0-10, "correctness": 0-10, "communication": 0-10 },
  "rationale": "internal note, not shown to user"
}
```

### 5.4 Other AI services (separate from the LLM)
| Concern | Technology |
|---|---|
| Speech-to-Text (streaming) | **Deepgram** (`deepgram-sdk`) — recommended for low-latency streaming. Alternative: **faster-whisper** running locally on CPU/GPU for zero external STT cost |
| Text-to-Speech | **ElevenLabs** (`elevenlabs` SDK). Alternative: **edge-tts** (free, uses Microsoft Edge voices) for fully local dev |
| Resume parsing | **PyMuPDF** (`fitz`) for PDFs, **python-docx** for DOCX, then the configured LLM for structured field extraction |
| Embeddings (resume → vector) | **sentence-transformers** (`all-MiniLM-L6-v2`) running locally — keeps the LLM provider abstraction clean and avoids a separate embeddings API |

---

## 6. Data Stores (all run locally via Docker)

| Store | Purpose |
|---|---|
| **PostgreSQL 15+** | Primary transactional DB. Use **pgvector** extension for resume embeddings |
| **Redis 7+** | Session cache, Celery broker, WebSocket pub/sub, rate limit counters |
| **MinIO** | S3-compatible local object storage for resume files, audio recordings, PDF reports |

### Core tables
`users`, `password_reset_tokens`, `resumes`, `interview_templates`, `sessions`, `turns`, `reports`

---

## 7. Real-Time Voice Loop

The single most important data path:

```
Browser mic
  → MediaRecorder (PCM 16kHz mono)
  → WebSocket to FastAPI
  → Deepgram streaming STT (forward audio frames)
  → on final transcript → LLM provider (Groq or OpenAI, env-selected)
                          with resume context + history + rubric
  → LLM returns JSON {decision, next_text, scores}
  → Persist turn to PostgreSQL
  → ElevenLabs TTS streaming
  → Stream audio chunks back over the same WebSocket
  → Browser plays via Web Audio API
```

**Latency target:** ≤ 1.5s p95 from end of user speech to start of AI speech. Groq's inference speed is a major reason it's the default — `llama-3.3-70b-versatile` typically returns in well under 500ms.

---

## 8. Security (local dev appropriate)

- **JWT** access (15 min) + refresh (7 days) via `python-jose`
- **bcrypt** password hashing via `passlib` (cost factor 12)
- **Pydantic** validates every request body
- **CORS** configured for `http://localhost:5173` only
- **Rate limiting** with `slowapi` on auth endpoints (prevent brute force)
- **Google ID token** verified server-side using `google-auth`
- **Password reset tokens** are single-use, hashed in DB, expire in 1 hour
- **Secrets** in `.env` (gitignored), loaded via `pydantic-settings`

---

## 9. Local Development Setup

Everything runs on your machine via `docker-compose`. No cloud accounts needed except API keys for Groq / OpenAI / Deepgram / ElevenLabs / Google OAuth.

### `docker-compose.yml` services
- `postgres` — Postgres 15 with pgvector extension (use `ankane/pgvector` image)
- `redis` — Redis 7
- `minio` — S3-compatible storage with web console at `localhost:9001`
- `mailhog` — local SMTP for testing password reset emails (web UI at `localhost:8025`)

The backend, frontend, and Celery worker can run either in containers or directly on the host — directly on the host is faster for iteration during local dev.

### Run commands
```bash
# Start infrastructure
docker compose up -d postgres redis minio mailhog

# Backend (in separate terminals)
cd backend
alembic upgrade head
uvicorn app.main:app --reload --port 8000
celery -A app.workers worker --loglevel=info

# Frontend
cd frontend
npm install
npm run dev
```

Access points:
- Frontend: http://localhost:5173
- Backend API + docs: http://localhost:8000/docs
- MinIO console: http://localhost:9001 (login `minioadmin` / `minioadmin`)
- MailHog UI: http://localhost:8025

---

## 10. Testing

| Layer | Tools |
|---|---|
| Frontend unit | **Vitest** + **React Testing Library** |
| Frontend E2E | **Playwright** |
| Backend unit/integration | **pytest** + **pytest-asyncio** + **httpx** |
| API contract | **Schemathesis** (auto-fuzz against OpenAPI schema) |

---

## 11. Required Environment Variables

```env
# ==================== Backend ====================

# Database (local docker)
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/mockinterview
REDIS_URL=redis://localhost:6379/0

# JWT
JWT_SECRET=change-me-to-a-long-random-string
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7

# ---------- LLM Provider (PLUGGABLE) ----------
# Set LLM_PROVIDER to either "groq" or "openai"
LLM_PROVIDER=groq
LLM_MODEL=llama-3.3-70b-versatile

GROQ_API_KEY=gsk_...
OPENAI_API_KEY=sk-...
# ---------------------------------------------

# Speech services
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=...

# Google OAuth (only third-party auth provider)
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...

# Local object storage (MinIO)
S3_ENDPOINT_URL=http://localhost:9000
S3_BUCKET=mockinterview
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_REGION=us-east-1

# Local SMTP (MailHog)
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=noreply@mockinterview.local

# ==================== Frontend (Vite) ====================
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
```

---

## 12. Repository Layout

```
mock-interview-ai/
├── frontend/              # React + Vite + TS
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── store/
│   └── package.json
├── backend/               # FastAPI
│   ├── app/
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   ├── security.py
│   │   │   └── llm_provider.py    # ← pluggable Groq/OpenAI
│   │   ├── auth/
│   │   ├── resumes/
│   │   ├── interviews/
│   │   ├── scoring/
│   │   ├── reports/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── workers/
│   │   └── main.py
│   ├── alembic/
│   ├── tests/
│   ├── pyproject.toml
│   └── .env.example
├── docker-compose.yml
└── README.md
```

---

## 13. API Contract (key endpoints)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/auth/register` | Manual signup (email + password) |
| POST | `/api/v1/auth/login` | Manual login |
| POST | `/api/v1/auth/google` | Google OAuth login (accepts ID token) |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/forgot-password` | Send reset email |
| POST | `/api/v1/auth/reset-password` | Reset using token |
| GET | `/api/v1/auth/me` | Current user info |
| POST | `/api/v1/resumes` | Upload + parse resume |
| GET | `/api/v1/resumes/{id}` | Get parsed resume |
| POST | `/api/v1/sessions` | Start interview session |
| POST | `/api/v1/sessions/{id}/end` | End session |
| GET | `/api/v1/sessions/{id}/report` | Final scored report |
| GET | `/api/v1/sessions` | List user's sessions |
| WS | `/ws/interview/{session_id}` | Bidirectional audio + control |

---

## 14. Build Order (suggested for Claude Code)

This is the only "process" hint — the order to build modules so each step is testable:

1. Backend scaffold: FastAPI app, Postgres + pgvector, Redis, MinIO, MailHog via `docker-compose`, Alembic migrations
2. **Auth system: manual (email/password) + Google OAuth + JWT + password reset (MailHog)**
3. Frontend scaffold: Vite + React + Tailwind + Router + auth pages (login / signup / Google button / forgot password)
4. **LLM provider abstraction (`llm_provider.py`) supporting Groq + OpenAI, switched via `.env`**
5. Resume upload + parsing (PyMuPDF + LLM extraction) + storage in MinIO
6. Initial question generation (LLM, given parsed resume)
7. WebSocket endpoint + browser mic capture + Deepgram streaming STT
8. LLM follow-up loop with structured JSON output (uses the provider abstraction)
9. ElevenLabs TTS streaming back to browser
10. Countdown timer + session lifecycle (start/end)
11. Scoring service + report generation (PDF via **WeasyPrint**)
12. Dashboard + session history + report viewer
13. Tests (pytest, Vitest, Playwright)
