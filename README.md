# AI-Powered Voice-Based Mock Interview System

A full-stack web app where a candidate uploads their resume and an AI voice agent runs a real-time mock interview.

- **Frontend:** React 18 + Vite + TypeScript + Tailwind + shadcn-style UI
- **Backend:** FastAPI (Python 3.11+) with native WebSockets
- **Data:** Postgres + pgvector, Redis, MinIO (all via docker-compose)
- **AI:** Pluggable LLM provider (Groq / OpenAI), Deepgram streaming STT, ElevenLabs streaming TTS
- **Auth:** Email/password with **6-digit OTP email verification**, Google OAuth, JWT access + refresh
- **Email:** Gmail SMTP for OTP and password reset (real, branded HTML emails)

---

## Prerequisites

Install these once on your machine:

| Tool | Version | Notes |
|---|---|---|
| **Docker Desktop** | latest | Must include Docker Compose v2 |
| **Python** | 3.11 – 3.13 | Get from [python.org](https://www.python.org/downloads/) — **not** the Microsoft Store version, **not** MSYS2's Python |
| **Node.js** | 20+ | LTS recommended |
| **Git** | any | |

You'll also need accounts / API keys for:

- **Groq** *or* **OpenAI** — for the LLM
- **Deepgram** — streaming speech-to-text
- **ElevenLabs** — streaming text-to-speech
- **Google Cloud** — OAuth 2.0 Client ID for Google Sign-In
- **Gmail** with 2-Step Verification + an [App Password](https://myaccount.google.com/apppasswords) — for sending OTP / reset emails

---

## Quick start (TL;DR)

```bash
# clone
git clone <repo-url> && cd AI-Powered-Voice-Based-Mock-Interview-System

# 1. infra
docker compose up -d

# 2. backend
cd backend
python -m venv myenv
# Windows PowerShell: .\myenv\Scripts\Activate.ps1
# macOS/Linux:        source myenv/bin/activate
pip install -e .
pip install psycopg2-binary
cp .env.example .env       # then fill in API keys (see below)
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 3. frontend (new terminal)
cd ../frontend
npm install
cp .env.example .env       # then fill in VITE_GOOGLE_CLIENT_ID
npm run dev
```

Open http://localhost:5173 and sign up.

---

## Detailed setup

### 1. Clone and inspect

```bash
git clone <repo-url>
cd AI-Powered-Voice-Based-Mock-Interview-System
```

### 2. Start infrastructure (Docker)

The project ships a `docker-compose.yml` that boots **Postgres + pgvector**, **Redis**, **MinIO**, and (optionally) **MailHog** for local email testing.

```bash
docker compose up -d
```

Verify everything is healthy:

```bash
docker compose ps
```

You should see four containers: `mockinterview-postgres`, `mockinterview-redis`, `mockinterview-minio`, `mockinterview-mailhog`. Postgres runs on **port `5433`** (host) → `5432` (container) to avoid clashes with a native PostgreSQL install on Windows.

| Service | Host port | Credentials |
|---|---|---|
| Postgres | `localhost:5433` | `postgres` / `postgres`, db `mockinterview` |
| Redis | `localhost:6379` | none |
| MinIO console | http://localhost:9001 | `minioadmin` / `minioadmin` |
| MinIO S3 API | http://localhost:9000 | same |
| MailHog UI | http://localhost:8025 | none |

> **First-time slow start?** The pgvector image is ~250 MB. Subsequent runs are instant from the cache.

### 3. Backend

#### 3a. Create a venv with the *real* system Python

> **Windows users — important.** If you have **MSYS2** or **Git Bash** in your `PATH`, `python` may resolve to MSYS2's Python which builds packages in non-standard ways and breaks pip. Use the Python launcher to pick the right interpreter explicitly:
> ```powershell
> # PowerShell — confirm which Python you'll get
> py -3.13 -c "import sys; print(sys.executable)"
> # should print:  C:\Users\YOU\AppData\Local\Programs\Python\Python313\python.exe
>
> # then create the venv with it
> py -3.13 -m venv myenv
> ```
> If `python -m venv myenv` produces a `bin/` folder instead of `Scripts/`, the venv is MSYS2-based — delete it and use `py -3.13` instead.

```bash
cd backend
python -m venv myenv
```

Activate:

```powershell
# Windows PowerShell
.\myenv\Scripts\Activate.ps1
```

```bash
# macOS / Linux
source myenv/bin/activate
```

Verify:
```bash
python -c "import sys; print(sys.executable)"
# should point inside myenv/Scripts (Windows) or myenv/bin (Unix)
```

#### 3b. Install dependencies

```bash
pip install -e .
pip install psycopg2-binary    # required by Alembic for sync migrations
```

The first install pulls heavy ML packages (sentence-transformers, torch). Expect ~2–5 minutes.

#### 3c. Configure `.env`

```bash
cp .env.example .env
```

Fill in the values. The minimum to get the server running:

```env
# Database — note port 5433 (matches docker-compose.yml)
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/mockinterview
REDIS_URL=redis://localhost:6379/0

# JWT — generate a strong random string
JWT_SECRET=replace-with-a-long-random-string

# LLM — pick one provider
LLM_PROVIDER=groq                        # or "openai"
LLM_MODEL=llama-3.3-70b-versatile        # or "gpt-4o-mini" for openai
GROQ_API_KEY=gsk_...
OPENAI_API_KEY=sk-...                    # required only if LLM_PROVIDER=openai

# Speech
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM

# Google OAuth (same client ID as the frontend)
GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...

# MinIO (defaults from docker-compose.yml)
S3_ENDPOINT_URL=http://localhost:9000
S3_BUCKET=mockinterview
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_REGION=us-east-1

# Gmail SMTP — see "Gmail App Password" section below
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=you@gmail.com
SMTP_USER=you@gmail.com
SMTP_PASSWORD=xxxxxxxxxxxxxxxx           # 16-char Gmail App Password (no spaces)

# Frontend URL (used in email links)
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
```

#### 3d. Update `alembic.ini`

Confirm the migration URL matches `DATABASE_URL`:

```ini
sqlalchemy.url = postgresql+psycopg2://postgres:postgres@localhost:5433/mockinterview
```

#### 3e. Run migrations and start the server

```bash
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Sanity check: open http://localhost:8000/health → should return JSON. Swagger UI is at http://localhost:8000/docs.

### 4. Frontend

```bash
cd ../frontend
npm install
cp .env.example .env
```

Edit `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
VITE_GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
```

Run:

```bash
npm run dev
```

Open http://localhost:5173.

---

## Configuration — third-party setup

### Gmail App Password (for sending OTP / reset emails)

1. Enable [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification) on the sending Google account.
2. Visit https://myaccount.google.com/apppasswords.
3. Create a new App Password (any name — e.g. "Rehearsal Local").
4. Copy the 16-character password and paste it as `SMTP_PASSWORD` in `backend/.env` — **no spaces**.

> Never commit the App Password. `backend/.env` is gitignored.

### Google OAuth Client

1. https://console.cloud.google.com → **APIs & Services** → **Credentials**
2. **Create credentials** → **OAuth 2.0 Client ID** → Web application.
3. **Authorized JavaScript origins**: `http://localhost:5173`
4. **Authorized redirect URIs**: `http://localhost:5173`
5. Copy the **Client ID** into:
   - `backend/.env` → `GOOGLE_CLIENT_ID`
   - `frontend/.env` → `VITE_GOOGLE_CLIENT_ID`
6. Copy the **Client Secret** into `backend/.env` → `GOOGLE_CLIENT_SECRET`.

### LLM provider

Switch providers without code changes — just toggle `LLM_PROVIDER` in `backend/.env`:

```env
LLM_PROVIDER=groq
LLM_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=gsk_...
```

or

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

---

## Auth flow

### Sign-up (with OTP)

1. User submits name + email + password at `/signup`
2. Backend creates user with `email_verified=false`, generates a **6-digit OTP**, sends it via Gmail
3. Frontend redirects to `/verify-email?email=...`
4. User enters the code
   - **10-minute** expiry (live countdown shown on screen)
   - Max **5 attempts** before the token is invalidated
   - Resend button on a **60-second** cooldown
5. On valid OTP, backend issues access + refresh JWTs, frontend lands on `/upload`

### Login

- Verified user → tokens, navigate to `/dashboard`
- Unverified user → backend returns `403 email_not_verified`, frontend resends a fresh OTP and routes to `/verify-email`

### Google OAuth

- Bypasses OTP — Google has already verified the email (`email_verified=true` set automatically)
- If a manual account already exists with the same email, it's linked (`auth_provider=both`)

---

## Use it

1. Sign up at `/signup` — check your inbox for the 6-digit code
2. Verify at `/verify-email`
3. Click "New interview" on the dashboard
4. Upload a PDF/DOCX resume, choose a role and duration
5. Allow microphone access (Chrome/Edge recommended)
6. The AI asks the first question through your speakers — answer naturally; live transcription appears on the right
7. Hit "End session" or let the timer run out
8. Open the report — overall score, per-dimension chart, per-question breakdown with a downloadable PDF

---

## Architecture

### Real-time voice loop

```
Browser mic
  → MediaRecorder / ScriptProcessor → 16 kHz PCM
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

Latency target: ≤ 1.5 s p95 from end of user speech to start of AI speech.

### Repository layout

```
mock-interview-ai/
├── frontend/             # React + Vite + TS
│   └── src/
│       ├── pages/        # Login, Signup, VerifyEmail, Upload, InterviewRoom, Report, ...
│       ├── components/   # editorial design system + interview/report widgets
│       ├── hooks/        # useMicStream, useAudioPlayer
│       ├── lib/          # api (axios + refresh interceptor), motion, utils
│       └── store/        # Zustand auth store
├── backend/
│   ├── app/
│   │   ├── core/         # config, security (bcrypt+JWT), db, llm_provider, storage, email
│   │   ├── auth/         # routes (register, verify-email, resend-otp, login, google, refresh, reset)
│   │   ├── resumes/      # upload, parsing (pypdf/python-docx), embeddings
│   │   ├── interviews/   # orchestrator, agent, STT/TTS clients, WebSocket
│   │   ├── scoring/      # rubric aggregation
│   │   ├── reports/      # WeasyPrint PDF generation
│   │   ├── models/       # SQLAlchemy: User, EmailVerificationToken, PasswordResetToken, ...
│   │   ├── schemas/      # Pydantic
│   │   └── workers/      # Celery tasks
│   ├── alembic/          # DB migrations
│   └── pyproject.toml
└── docker-compose.yml
```

### Key endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/auth/register` | Create unverified user, send OTP email |
| POST | `/api/v1/auth/verify-email` | Validate OTP → issue tokens |
| POST | `/api/v1/auth/resend-otp` | Send a fresh 6-digit code |
| POST | `/api/v1/auth/login` | Email + password → tokens (rejects unverified with 403) |
| POST | `/api/v1/auth/google` | Verify Google ID token server-side → tokens |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/forgot-password` | Email a reset link |
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

## Troubleshooting

### `pip install -e .` builds packages from source and fails with SSL errors

Cause: MSYS2 / Git Bash Python is in `PATH` and being used for build subprocesses. It has broken SSL certs.

Fix: Use the Python launcher to create a venv against the real Windows Python, then strip MSYS2 from PATH for the install session:

```powershell
$env:PATH = ($env:PATH -split ';' | Where-Object { $_ -notlike '*msys64*' }) -join ';'
Remove-Item -Recurse -Force myenv
py -3.13 -m venv myenv
.\myenv\Scripts\Activate.ps1
pip install -e .
```

### `alembic upgrade head` fails with `password authentication failed for user "postgres"`

Cause: A native PostgreSQL service is running on `localhost:5432` and intercepting the connection before Docker's port forwarding.

Check:
```powershell
netstat -ano | findstr ":5432"
# look for two PIDs — postgres.exe is the native service, com.docker.backend.exe is Docker
```

Fix (option A — keep both): docker-compose maps Postgres to `5433` instead of `5432`. Make sure both `backend/.env` (`DATABASE_URL`) and `backend/alembic.ini` (`sqlalchemy.url`) use port `5433`.

Fix (option B — disable native): `Stop-Service -Name "postgresql-x64-16"` (adjust to your installed version).

### `extension "vector" is not available`

You're on a vanilla Postgres image. The compose file uses `ankane/pgvector:latest` which has it pre-installed. If you previously had a stale volume from a non-pgvector image:

```bash
docker compose down -v   # the -v deletes the volume
docker compose up -d
alembic upgrade head
```

### Google login: `Missing required parameter: client_id`

`VITE_GOOGLE_CLIENT_ID` isn't set in `frontend/.env` — or Vite was already running when the file was created. Stop `npm run dev` (Ctrl+C) and start it again so the new env vars are picked up.

Also confirm `http://localhost:5173` is added to the OAuth client's **Authorized JavaScript origins** in Google Cloud Console.

### OTP email never arrives

1. Confirm `SMTP_PASSWORD` is a **Gmail App Password** (16 chars, no spaces), not your account password.
2. Check the backend console — the resend / register handler swallows SMTP errors so the user can retry.
3. Watch uvicorn logs while triggering: `aiosmtplib.errors.SMTPAuthenticationError` means wrong creds; `SMTPConnectError` means port 587 is blocked on your network.

### `ImportError: cannot import name 'DeepgramClientOptions' from 'deepgram'`

`deepgram-sdk` v7 reorganised exports. `pyproject.toml` pins `deepgram-sdk>=3.2.0,<4.0.0` — if pip resolved a newer version, force a clean install:

```bash
pip install "deepgram-sdk>=3.2.0,<4.0.0" --force-reinstall
```

### Backend 500 on `/auth/register`: `password cannot be longer than 72 bytes`

You're on a stale build that still uses `passlib`. The current code uses `bcrypt` directly in `backend/app/core/security.py`. Pull latest, restart uvicorn.

---

## Security notes (local dev appropriate)

- JWT access (15 min) + refresh (7 days) via `python-jose`
- bcrypt password hashing — direct `bcrypt` library (cost factor 12)
- 6-digit OTP for email verification — bcrypt-hashed, 10-min expiry, max 5 attempts
- Pydantic validates every request body
- CORS locked to `http://localhost:5173` by default
- `slowapi` rate-limits auth endpoints (register: 5/min, verify: 10/min, resend: 3/min, login: 10/min)
- Google ID tokens verified server-side via `google-auth`
- Password reset tokens are single-use, hashed in DB, expire in 1 hour
- All secrets in `.env` (gitignored)

---

## Known limitations (local-only build)

- TTS audio is sent as a single MP3 stream per question and decoded client-side (uses `decodeAudioData`); for chunked playback you'd switch to MediaSource Extensions or PCM streaming.
- Mic capture uses the deprecated `ScriptProcessorNode` for compatibility — production should prefer `AudioWorklet`.
- `WeasyPrint` requires GTK on Windows; the report falls back to inline HTML if WeasyPrint can't render. PDFs render fine in WSL or Linux containers.
- Production hosting (TLS, reverse proxy, observability) is intentionally out of scope.
