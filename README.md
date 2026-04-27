# AI-Powered Voice-Based Mock Interview System

A full-stack web app where a candidate uploads their resume and an AI voice agent runs a real-time mock interview. Built per [TECH_STACK.md](TECH_STACK.md).

- **Frontend:** React 18 + Vite + TypeScript + Tailwind + shadcn-style UI
- **Backend:** FastAPI (Python 3.11+) with native WebSockets
- **Data:** Postgres + pgvector, Redis, MinIO, MailHog (all via docker-compose)
- **AI:** Pluggable LLM provider (Groq / OpenAI), Deepgram streaming STT, ElevenLabs streaming TTS
- **Auth:** Manual (email/password) + Google OAuth, both producing JWT pairs

---

## Prerequisites

- Docker + Docker Compose
- Python 3.11+
- Node.js 20+
- API keys for: Groq **or** OpenAI, Deepgram, ElevenLabs, Google OAuth (client ID + secret)

---

## 1. Start infrastructure

```bash
docker compose up -d postgres redis minio mailhog minio-init
```

Health checks:
- Postgres: `localhost:5432` (user/pass: `postgres`/`postgres`)
- Redis: `localhost:6379`
- MinIO console: http://localhost:9001 (`minioadmin`/`minioadmin`)
- MailHog UI: http://localhost:8025

The `minio-init` service auto-creates the `mockinterview` bucket.

---

## 2. Backend

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate

pip install -e .[dev]

cp .env.example .env
# Fill in GROQ_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY, GOOGLE_CLIENT_ID/SECRET, JWT_SECRET

# Apply migrations
alembic upgrade head

# Run API + workers in two terminals:
uvicorn app.main:app --reload --port 8000
celery -A app.workers.celery_app worker --loglevel=info
```

API docs: http://localhost:8000/docs

### Pluggable LLM provider

Switch providers without code changes:

```env
LLM_PROVIDER=groq
LLM_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=...
```

Or:

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=...
```

---

## 3. Frontend

```bash
cd frontend
npm install

cp .env.example .env
# Set VITE_GOOGLE_CLIENT_ID

npm run dev
```

App: http://localhost:5173

---

## 4. Use it

1. Sign up at /signup (email/password) or use Google
2. Click "New interview"
3. Upload a PDF/DOCX resume, choose the role and duration
4. Allow microphone access in your browser (Chrome / Edge recommended)
5. The AI asks the first question through your speakers — answer naturally; live transcription appears on the right
6. Hit "End session" when finished, or let the timer run out
7. Open the report — overall score, per-dimension chart, and a per-question breakdown with a downloadable PDF

---

## Architecture quick reference

### Real-time voice loop

```
Browser mic
  → MediaRecorder / ScriptProcessor → 16kHz PCM
  → WebSocket /ws/interview/{session_id}?token=JWT
  → FastAPI handler (app/interviews/websocket.py)
      → Deepgram streaming STT
      → on final transcript →
            SessionOrchestrator.submit_answer()
              → LLM agent (decide_next_turn — JSON mode)
              → persist Turn + scores
              → returns next question text
      → ElevenLabs streaming TTS
      → MP3 chunks pushed back over WS
  → useAudioPlayer plays back
```

Latency target: ≤ 1.5s p95 from end of user speech to start of AI speech.

### Repository layout

```
mock-interview-ai/
├── frontend/          # React + Vite + TS
├── backend/           # FastAPI
│   ├── app/
│   │   ├── core/      # config, security, db, llm_provider, storage, email
│   │   ├── auth/      # routes, Google ID token verification
│   │   ├── resumes/   # upload, parsing (PyMuPDF/docx), embeddings
│   │   ├── interviews/# orchestrator, agent, STT/TTS clients, WebSocket
│   │   ├── scoring/   # rubric aggregation
│   │   ├── reports/   # WeasyPrint PDF generation
│   │   ├── models/    # SQLAlchemy models
│   │   ├── schemas/   # Pydantic schemas
│   │   └── workers/   # Celery tasks
│   └── alembic/       # DB migrations
└── docker-compose.yml
```

### Key endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/auth/register` | Manual signup |
| POST | `/api/v1/auth/login` | Manual login |
| POST | `/api/v1/auth/google` | Google OAuth (verifies ID token server-side) |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/forgot-password` | Send reset email |
| POST | `/api/v1/auth/reset-password` | Reset using token |
| GET  | `/api/v1/auth/me` | Current user |
| POST | `/api/v1/resumes` | Upload + parse resume |
| POST | `/api/v1/sessions` | Start interview session |
| POST | `/api/v1/sessions/{id}/end` | End session, finalize scores |
| GET  | `/api/v1/sessions/{id}/report` | Final scored report (lazy PDF gen) |
| WS   | `/ws/interview/{id}?token=JWT` | Bidirectional audio + control |

---

## Tests

Backend:
```bash
cd backend
pytest
```

Frontend:
```bash
cd frontend
npm test
```

E2E (Playwright — needs both servers running):
```bash
cd frontend
npx playwright install
npm run test:e2e
```

---

## Security notes (local dev appropriate)

- JWT access (15 min) + refresh (7 days) via `python-jose`
- bcrypt password hashing via `passlib` (cost factor 12)
- Pydantic validates every request body
- CORS locked to `http://localhost:5173` by default
- `slowapi` rate-limits auth endpoints (brute-force protection)
- Google ID tokens verified server-side via `google-auth`
- Password reset tokens are single-use, hashed in DB, expire in 1 hour
- All secrets in `.env` (gitignored)

---

## Notes / known limitations (local-only build)

- TTS audio is sent as a single MP3 stream per question and decoded client-side (uses `decodeAudioData`); for chunked playback you'd switch to MediaSource Extensions or PCM streaming.
- The mic capture uses the deprecated `ScriptProcessorNode` for compatibility — for production prefer an `AudioWorklet`.
- `WeasyPrint` requires GTK on Windows; on a Windows host the report falls back to inline HTML if WeasyPrint can't render. PDFs render fine in WSL or Linux containers.
- Production hosting is intentionally out of scope per spec.
