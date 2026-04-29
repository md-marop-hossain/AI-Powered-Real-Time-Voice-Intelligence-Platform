# Project Guide — AI Voice Mock Interview System

A deeper companion to `README.md`. This document explains how the
project is wired up, what every external service does, how to swap
each one, the full feature list, and a clean step-by-step install
walk-through for a fresh computer.

The `README.md` at the root is the quick-start. **Read this guide
when you want to understand or modify the system.**

---

## Table of contents

1. [What the project does](#1-what-the-project-does)
2. [Big-picture architecture](#2-big-picture-architecture)
3. [Layered architecture (backend)](#3-layered-architecture-backend)
4. [Frontend architecture](#4-frontend-architecture)
5. [The real-time voice loop in detail](#5-the-real-time-voice-loop-in-detail)
6. [External services and how to swap them](#6-external-services-and-how-to-swap-them)
7. [Voice ID — what it is and how to change it](#7-voice-id--what-it-is-and-how-to-change-it)
8. [Current feature list](#8-current-feature-list)
9. [Install on a new computer (Windows step-by-step)](#9-install-on-a-new-computer-windows-step-by-step)
10. [Install on macOS / Linux](#10-install-on-macos--linux)
11. [Daily run / stop workflow](#11-daily-run--stop-workflow)
12. [Configuration reference (.env files)](#12-configuration-reference-env-files)
13. [Common customizations](#13-common-customizations)
14. [Troubleshooting cheatsheet](#14-troubleshooting-cheatsheet)

---

## 1. What the project does

A candidate signs up, uploads a resume, picks a role and duration,
and goes into a fullscreen interview room. An AI interviewer asks
voice questions through their speakers, listens to their answers
through the mic, scores each turn, and produces a full report at
the end with overall and per-dimension scores plus per-question
feedback and a downloadable PDF.

End-to-end the user never has to type — the conversation is voice
both ways.

---

## 2. Big-picture architecture

```
+----------------------+        HTTP (REST + JWT)        +----------------------+
|                      | <-----------------------------> |                      |
|  Browser (React)     |                                 |  FastAPI backend     |
|                      |   WebSocket /ws/interview/...   |                      |
|  - mic capture       | <==============================>|  - auth, sessions    |
|  - audio playback    |   (PCM up, JSON+MP3 down)       |  - WebSocket loop    |
|  - editorial UI      |                                 |  - orchestrator      |
+----------------------+                                 |  - LLM agent         |
                                                         |  - STT / TTS         |
                                                         +----------+-----------+
                                                                    |
                                          +-------------------------+-------------------------+
                                          |                |                |                 |
                                  +-------v------+  +------v-----+  +-------v-----+   +-------v------+
                                  | Postgres     |  | Redis      |  | MinIO (S3)  |   | External APIs|
                                  | + pgvector   |  | rate-limit |  | resumes,    |   | LLM, STT,    |
                                  | sessions,    |  | sessions   |  | report PDFs |   | TTS, OAuth,  |
                                  | turns, users |  |            |  |             |   | Gmail SMTP   |
                                  +--------------+  +------------+  +-------------+   +--------------+
```

Everything except the third-party APIs runs locally via Docker
Compose. The only outbound network calls are the LLM, Deepgram,
ElevenLabs (or OpenAI TTS), Google OAuth, and Gmail SMTP.

---

## 3. Layered architecture (backend)

```
backend/app/
├── main.py                FastAPI app factory, CORS, router includes
├── core/
│   ├── config.py          Pydantic Settings (reads .env)
│   ├── database.py        Async SQLAlchemy engine + Base
│   ├── dependencies.py    FastAPI deps: CurrentUser, DbSession
│   ├── security.py        bcrypt + JWT encode/decode
│   ├── llm_provider.py    Pluggable LLM abstraction (Groq / OpenAI)
│   ├── storage.py         MinIO / S3 client
│   └── email.py           SMTP sender for OTP / reset emails
├── auth/                  HTTP routes: register, verify-email, login,
│                          google, refresh, forgot/reset-password
├── resumes/               Upload, parse PDF/DOCX, store in MinIO,
│                          compute embeddings (sentence-transformers)
├── interviews/
│   ├── routes.py          REST: create session, end, get report
│   ├── websocket.py       WS endpoint /ws/interview/{id}
│   ├── orchestrator.py    Per-session state machine, nudge cap,
│   │                      stop-intent detection, focus-violation logic
│   ├── agent.py           LLM prompts: question plan + decide_next_turn
│   ├── stt.py             Deepgram streaming STT wrapper
│   └── tts.py             Streaming TTS (ElevenLabs OR OpenAI)
├── scoring/aggregator.py  Per-dimension averaging across turns
├── reports/generator.py   Build summary dict + WeasyPrint PDF
├── models/                SQLAlchemy ORM models
├── schemas/               Pydantic request/response shapes
└── workers/               Celery tasks (resume parsing offload)
```

A request flows through the layers like this:

```
HTTP request
  → FastAPI route (auth/, interviews/routes.py, etc.)
  → dependency: DbSession + CurrentUser (JWT-decoded)
  → service logic in module (e.g. interviews/orchestrator.py,
                             reports/generator.py)
  → SQLAlchemy ORM (models/)
  → Postgres
```

---

## 4. Frontend architecture

```
frontend/src/
├── main.tsx              ReactDOM root, router
├── App.tsx               Route table; protected routes
├── pages/
│   ├── SignupPage          + VerifyEmailPage   (OTP flow)
│   ├── LoginPage           + Forgot / Reset password
│   ├── DashboardPage       (sessions list, "new interview")
│   ├── UploadPage          (resume upload + role/duration)
│   ├── InterviewRoom       (the live voice loop UI)
│   ├── ReportPage          (final scored report)
│   └── AccountPage         (profile + password change)
├── components/
│   ├── editorial/          Design-system primitives (buttons,
│   │                       Eyebrow, NumberedMarker, dividers)
│   ├── interview/          CountdownTimer, Waveform, ConversationLog,
│   │                       LiveTranscript, AISpeakingIndicator,
│   │                       SessionPreflightCheck, KeyboardShortcuts,
│   │                       ResumeFootnote, ChipSelect
│   └── report/             PerQuestionArticle, TranscriptPlayer
├── hooks/
│   ├── useMicStream.ts     Wraps getUserMedia → 16 kHz PCM frames
│   └── useAudioPlayer.ts   Decodes streamed MP3 → WebAudio playback
├── lib/
│   ├── api.ts              axios instance + refresh interceptor
│   ├── motion.ts           framer-motion easing + duration tokens
│   └── utils.ts            cn() helper
└── store/auth.ts           Zustand auth store (token, user)
```

The design system is intentionally editorial — Fraunces display
font, JetBrains Mono for timers/eyebrows, vermillion accent — see
the existing components for the tone.

---

## 5. The real-time voice loop in detail

```
[ Browser ]                                 [ Server ]
1. User clicks "I'M READY"
   - requestFullscreen() (gesture)
   - opens WS to /ws/interview/{id}?token=JWT

2. Server starts orchestrator
   - generates first question (was created on session start)
   - opens Deepgram live STT connection

3. Server speaks the first question:
   <-- {"type":"ai_question","text":"..."}
   <-- (binary MP3 chunks streamed by ElevenLabs / OpenAI)
   <-- {"type":"ai_audio_end"}
   <-- {"type":"time_remaining","seconds":N}

4. Client plays audio, updates UI to "LISTENING"

5. User speaks. Mic feeds 16 kHz PCM Int16LE frames:
   --> binary PCM frames (every ~250 ms)

6. Server forwards frames to Deepgram. As Deepgram emits:
   - SpeechStarted          --> {"type":"user_speech_started"}
   - Interim transcript     --> {"type":"user_interim","text":"..."}
   - Final transcript       (BUFFERED — held for UtteranceEnd)
   - UtteranceEnd (long pause): commit accumulated buffer
                            --> {"type":"transcript","text":"<full>"}
                            --> orchestrator.submit_answer(transcript)

7. Orchestrator:
   - appends to current Turn.answer (across nudges)
   - checks _wants_to_stop_interview() regex → if matched, end session
   - calls LLM agent.decide_next_turn(...)
     decision ∈ {nudge, ask_followup, next_question, end_section}
     - nudge → no new Turn row, no score persisted, just speak short
       prompt; capped at NUDGE_CAP per question
     - ask_followup / next_question → create new Turn, persist scores
     - end_section → finalize session
   - returns {next_text, is_nudge, ended}

8. Server speaks the response:
   <-- {"type":"ai_question"} or {"type":"ai_nudge"} (no log entry)
   <-- (binary MP3 chunks)
   <-- {"type":"ai_audio_end"}

   loop back to step 4 until ended/timer expires.

9. End conditions:
   - manual: client sends {"type":"end_session"}
   - automatic: time runs out OR end_section OR stop-intent regex OR
                3 focus-integrity violations
   - server emits {"type":"session_ended","reason":"..."} and closes WS.

10. Client navigates to /sessions/{id}/report — backend builds the
    summary on demand, including focus_violations count.
```

Latency target: end-of-user-speech to start-of-AI-speech ≤ 1.5s p95.

---

## 6. External services and how to swap them

Every external service has a single owner module — swap is one
config change in `backend/.env` (sometimes one extra line of code).

### LLM (`groq` ↔ `openai`)

- **Owner:** `backend/app/core/llm_provider.py`
- **Used by:** `backend/app/interviews/agent.py` for the question
  plan and `decide_next_turn`.
- **Switch:**
  ```env
  LLM_PROVIDER=groq                 # or openai
  LLM_MODEL=llama-3.3-70b-versatile # or e.g. gpt-4o-mini
  GROQ_API_KEY=gsk_...
  OPENAI_API_KEY=sk-...
  ```
- **Add a new provider:** create a class with the same `chat(...)`
  signature in `llm_provider.py`, wire it in `get_llm_provider()`.

### STT — Deepgram (only)

- **Owner:** `backend/app/interviews/stt.py`
- **Why Deepgram:** very low-latency live transcripts with
  VAD-driven SpeechStarted / UtteranceEnd events.
- **Key tuning knobs (in code):**
  ```python
  endpointing=800           # ms of silence to emit a "final" phrase
  utterance_end_ms=2500     # ms of silence before UtteranceEnd
                            # (this is the real "answer is done" signal)
  ```
- **Switch to another provider:** subclass / replace `DeepgramSTT`
  with the same callbacks (`on_final`, `on_interim`,
  `on_speech_started`, `on_utterance_end`). Keep the contract:
  `on_final` only fires once per *complete* utterance, not per
  phrase break. Suggestions: AssemblyAI Realtime, Google Cloud
  Speech-to-Text streaming, Azure Speech.

### TTS (`elevenlabs` ↔ `openai`)

- **Owner:** `backend/app/interviews/tts.py`
- **Switch:**
  ```env
  TTS_PROVIDER=elevenlabs           # or openai
  ELEVENLABS_API_KEY=...
  ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM    # see § 7
  # OR for OpenAI:
  OPENAI_API_KEY=sk-...
  OPENAI_TTS_MODEL=tts-1            # or tts-1-hd
  OPENAI_TTS_VOICE=alloy            # alloy, echo, fable, onyx, nova, shimmer
  ```
- The websocket layer just iterates over `stream_tts(text)` and
  forwards bytes — it doesn't know which provider was used.

### Email — Gmail SMTP

- **Owner:** `backend/app/core/email.py`
- **Used for:** OTP verification, password reset.
- **Switch:** any SMTP server works. For local dev, `docker-compose`
  ships **MailHog** (UI at http://localhost:8025) — point
  `SMTP_HOST=localhost`, `SMTP_PORT=1025`, no password, and watch
  emails appear in MailHog without sending real mail.

### Auth — Google OAuth

- **Owner:** `backend/app/auth/...` (Google ID token verified
  server-side via `google-auth`).
- **Switch:** any OAuth provider that issues an OIDC ID token
  works. Replace the verify call. Frontend uses
  `@react-oauth/google`; that would change too.

### Storage — MinIO (S3-compatible)

- **Owner:** `backend/app/core/storage.py`
- **Switch to AWS S3 / R2 / GCS:** set `S3_ENDPOINT_URL` to your
  provider (or leave blank for AWS), update access keys, bucket,
  region. Code uses `boto3` so anything S3-compatible works.

### Database — Postgres + pgvector

- **Owner:** SQLAlchemy via `backend/app/core/database.py`.
- **pgvector** is required because the resume-embedding column is
  a `vector(384)` (sentence-transformers MiniLM). Swap to a
  managed Postgres only if it has the pgvector extension
  available (Supabase, Neon, RDS with the extension enabled).

### Cache / rate-limit — Redis

- **Owner:** consumed by `slowapi` for endpoint rate-limits.
- **Switch:** any Redis-compatible KV (Upstash, ElastiCache, etc.).

---

## 7. Voice ID — what it is and how to change it

The TTS voice is what the AI interviewer sounds like. There are
two providers:

### ElevenLabs (default)

- Each voice has a **voice ID** — a stable opaque string.
- The default is `21m00Tcm4TlvDq8ikWAM` (Rachel, en-US, female).
- **Find more voices:**
  https://elevenlabs.io/app/voice-library — pick one, click
  "Use", then copy the voice ID from the URL or settings panel.
- **Change it:** edit `backend/.env`:
  ```env
  ELEVENLABS_VOICE_ID=<paste-id>
  ```
  Restart the backend. No code change needed.
- **Clone your own voice:** ElevenLabs lets you upload a 1–5 min
  sample and produces a custom voice ID. Drop that ID into
  `ELEVENLABS_VOICE_ID` and the AI interviewer will sound like
  whoever you sampled.
- **Model:** `eleven_turbo_v2_5` is hardcoded in
  `backend/app/interviews/tts.py` for low-latency streaming —
  swap to `eleven_multilingual_v2` if you need non-English.

### OpenAI TTS

- Voices are named, not IDs. Available: `alloy`, `echo`, `fable`,
  `onyx`, `nova`, `shimmer`.
- **Change it:** in `backend/.env`:
  ```env
  TTS_PROVIDER=openai
  OPENAI_TTS_VOICE=nova
  OPENAI_TTS_MODEL=tts-1            # or tts-1-hd
  ```

A/B-ing the two is the fastest way to tell which sounds right for
your interviewer persona — flip `TTS_PROVIDER` and try a session.

---

## 8. Current feature list

### Authentication

- Email + password sign-up with **6-digit OTP** verification
  (10-min expiry, 5-attempt cap, 60-sec resend cooldown)
- Google OAuth sign-in (auto-verified, can link to existing manual
  account)
- JWT access (15 min) + refresh (7 days)
- Forgot / reset password via single-use hashed token
- Profile page: update name, change password
- Rate-limited auth endpoints (slowapi: register 5/min, verify
  10/min, resend 3/min, login 10/min)

### Session creation

- Resume upload (PDF / DOCX), parsed to structured JSON, stored
  in MinIO with a 384-dim embedding for retrieval
- Configurable: target role, seniority (fresher / junior / mid /
  senior / staff / manager), focus (mixed / technical /
  behavioral / system_design), industry, duration (5–60 min)
- LLM generates a tailored 6–10 question plan up front

### Live interview room

- 3-step **preflight**: mic permission, server reachability, 3-sec
  voice clarity test with live RMS meter and playback
- **Fullscreen on start** — `requestFullscreen()` triggered by the
  "I'M READY" gesture
- AI question voice + live waveform + speaking indicator
- Live transcript: interim text grows as the candidate speaks;
  upgraded to a committed answer on UtteranceEnd
- **Patient turn-taking:** Deepgram `utterance_end_ms=2500` so a
  brief pause mid-thought does not count as the answer being
  complete
- **Soft nudges:** when the LLM detects a fragment, it speaks a
  short prompt ("Take your time", "Go on", "Mm-hm — tell me
  more") without creating a new turn — capped at 2 per question
- **Stop-intent detection:** regex catches phrases like "stop the
  interview", "end the session", "I give up", "I want to stop"
  and ends the session gracefully without LLM scoring
- **End Session confirmation modal** — guards against accidental
  clicks; Esc / button / arrow-right shortcuts integrated
- **Floating mini-timer** appears when the hero timer scrolls out
  of view, so remaining time is always visible
- **Auto-scroll** — page follows the conversation as new turns,
  interim transcripts, and committed answers land
- **Focus integrity** — fullscreen, visibility, blur, and
  beforeunload listeners; 3-strike policy with a blocking modal,
  server-authoritative violation count, and graceful auto-end
- **Timer freezes** when the session ends (digits hold at the
  termination value)
- 1-minute warning banner; 30-second vermillion line; 5-minute
  toast
- Keyboard shortcuts: Esc (end), Arrow-Right (skip), `?` (help)

### Scoring and report

- Each real turn (not nudges) is scored on four dimensions:
  clarity, depth, correctness, communication (0–10, calibrated
  to seniority)
- Per-turn rationale captured from the LLM
- Aggregator averages across all scored turns into overall +
  per-dimension scores
- Report page: hero overall score, dimension chart, strengths /
  areas-to-improve summary, per-question article (question,
  answer, feedback, scores), playback of audio if available
- WeasyPrint PDF export (HTML fallback if WeasyPrint not
  installed)
- `focus_violations` count surfaced on the report summary

### Operational

- Docker Compose for Postgres + pgvector, Redis, MinIO, MailHog
- Alembic migrations (`0001`–`0004`)
- Structured logging
- Pydantic settings with `.env` loading
- Frontend type-checked with `tsc --noEmit`
- Backend test suite under `backend/tests/`
- Playwright E2E scaffold under `frontend/`

---

## 9. Install on a new computer (Windows step-by-step)

These steps assume a fresh Windows 11 machine. Total time: ~30 min,
mostly waiting for Docker to pull images and pip to install
ML packages.

### Step 1 — Install prerequisites

1. **Docker Desktop**
   - https://www.docker.com/products/docker-desktop/ → download
     and install.
   - On install, enable the WSL 2 backend (default).
   - Reboot if prompted. Verify:
     ```powershell
     docker --version
     docker compose version
     ```
2. **Python 3.13** (or 3.11 / 3.12)
   - https://www.python.org/downloads/windows/ → "Windows
     installer (64-bit)".
   - During install, tick **"Add python.exe to PATH"**.
   - **Do NOT install the Microsoft Store version** — it has
     surface-level differences that break some pip wheels.
   - Verify:
     ```powershell
     py -3.13 -c "import sys; print(sys.executable)"
     # should print C:\Users\YOU\AppData\Local\Programs\Python\Python313\python.exe
     ```
3. **Node.js 20 LTS**
   - https://nodejs.org → LTS installer.
   - Verify:
     ```powershell
     node --version    # v20.x or v22.x
     npm --version
     ```
4. **Git**
   - https://git-scm.com/download/win → default options.
   - Verify: `git --version`

### Step 2 — Get the code

```powershell
git clone <YOUR-REPO-URL>
cd "AI-Powered Voice-Based Mock Interview System"
```

### Step 3 — Get API keys

Sign up and copy a key from each. Free tiers are enough to start.

| Service | URL | What you copy |
|---|---|---|
| Groq (LLM) | https://console.groq.com/keys | API key |
| Deepgram (STT) | https://console.deepgram.com → API Keys | API key |
| ElevenLabs (TTS) | https://elevenlabs.io → Profile → API Key | API key |
| Google OAuth | https://console.cloud.google.com → Credentials | Client ID + Secret |
| Gmail App Password | https://myaccount.google.com/apppasswords | 16-char password |

For Gmail App Password you must first enable
[2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification).

For Google OAuth:
- Create credentials → OAuth 2.0 Client ID → Web application.
- Authorized JavaScript origins: `http://localhost:5173`
- Authorized redirect URIs: `http://localhost:5173`

### Step 4 — Start the infrastructure

```powershell
docker compose up -d
```

Wait ~1 minute for the Postgres image to pull. Verify:

```powershell
docker compose ps
```

You should see five containers running healthy: postgres, redis,
minio, minio-init (which exits cleanly after creating the bucket),
mailhog.

If the Redis port `6379` is taken on your machine you'll see
`bind: An attempt was made to access a socket in a way forbidden`.
Stop the conflicting service or change the port mapping in
`docker-compose.yml`.

### Step 5 — Backend

```powershell
cd backend
py -3.13 -m venv myenv
.\myenv\Scripts\Activate.ps1
pip install -e .
pip install psycopg2-binary
```

`pip install -e .` is slow (2–5 min) — it pulls torch,
sentence-transformers, etc.

Create `backend/.env` from the template (or create from scratch):

```env
# --- Database (port 5433 — set in docker-compose.yml) ---
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/mockinterview
REDIS_URL=redis://localhost:6379/0

# --- JWT — generate a long random string (e.g. python -c "import secrets; print(secrets.token_urlsafe(48))") ---
JWT_SECRET=replace-with-a-long-random-string

# --- LLM ---
LLM_PROVIDER=groq
LLM_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=gsk_...
OPENAI_API_KEY=

# --- Speech ---
DEEPGRAM_API_KEY=...
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
OPENAI_TTS_MODEL=tts-1
OPENAI_TTS_VOICE=alloy

# --- Google OAuth ---
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...

# --- MinIO ---
S3_ENDPOINT_URL=http://localhost:9000
S3_BUCKET=mockinterview
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_REGION=us-east-1

# --- Gmail SMTP (or use MailHog: SMTP_HOST=localhost, SMTP_PORT=1025, no auth) ---
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=you@gmail.com
SMTP_USER=you@gmail.com
SMTP_PASSWORD=xxxxxxxxxxxxxxxx

# --- App ---
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
```

Make sure `backend/alembic.ini` has the matching sync URL (uses
`psycopg2`, not asyncpg):

```ini
sqlalchemy.url = postgresql+psycopg2://postgres:postgres@localhost:5433/mockinterview
```

Apply migrations and start the server:

```powershell
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Sanity check: open http://localhost:8000/health → JSON response.
Swagger docs at http://localhost:8000/docs.

### Step 6 — Frontend

In a **second terminal**:

```powershell
cd "AI-Powered Voice-Based Mock Interview System\frontend"
npm install
```

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
```

Run:

```powershell
npm run dev
```

Open http://localhost:5173 in **Chrome or Edge** (Safari/Firefox
work but the audio API is tuned for Chromium). Sign up, verify
the OTP from your inbox, and start an interview.

---

## 10. Install on macOS / Linux

The flow is identical — only commands differ:

```bash
# clone
git clone <YOUR-REPO-URL>
cd AI-Powered-Voice-Based-Mock-Interview-System

# infra
docker compose up -d

# backend
cd backend
python3.13 -m venv myenv
source myenv/bin/activate
pip install -e .
pip install psycopg2-binary
cp .env.example .env       # edit keys
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# frontend (new terminal)
cd ../frontend
npm install
cp .env.example .env
npm run dev
```

On macOS, if `weasyprint` complains about missing libs:
```bash
brew install pango libffi cairo
```

---

## 11. Daily run / stop workflow

### Start everything

```bash
docker compose up -d                                        # infra
cd backend && source myenv/bin/activate                     # macOS/Linux
#   .\myenv\Scripts\Activate.ps1                            # Windows PS
uvicorn app.main:app --reload --port 8000                   # terminal 1

cd frontend && npm run dev                                   # terminal 2
```

### Stop everything

```
Ctrl+C in each terminal           # backend + frontend
docker compose stop               # leaves data on disk
docker compose down               # also removes containers (data persists in named volumes)
docker compose down -v            # NUKE — also removes volumes (you lose all DB data)
```

### After pulling new code

```bash
# backend
cd backend && source myenv/bin/activate
pip install -e .                  # in case deps changed
alembic upgrade head              # in case migrations were added
# restart uvicorn

# frontend
cd frontend && npm install
# restart npm run dev
```

---

## 12. Configuration reference (.env files)

### `backend/.env`

| Key | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | – | Async Postgres URL with port `5433` |
| `REDIS_URL` | `redis://localhost:6379/0` | Rate-limit + cache |
| `JWT_SECRET` | – | HS256 signing key — **change this** |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | |
| `LLM_PROVIDER` | `groq` | `groq` or `openai` |
| `LLM_MODEL` | `llama-3.3-70b-versatile` | Provider-native model name |
| `GROQ_API_KEY` | – | |
| `OPENAI_API_KEY` | – | required if `LLM_PROVIDER=openai` or `TTS_PROVIDER=openai` |
| `DEEPGRAM_API_KEY` | – | |
| `TTS_PROVIDER` | `elevenlabs` | `elevenlabs` or `openai` |
| `ELEVENLABS_API_KEY` | – | |
| `ELEVENLABS_VOICE_ID` | Rachel | See § 7 |
| `OPENAI_TTS_MODEL` | `tts-1` | or `tts-1-hd` |
| `OPENAI_TTS_VOICE` | `alloy` | alloy / echo / fable / onyx / nova / shimmer |
| `GOOGLE_CLIENT_ID` | – | OAuth client ID (same value as frontend) |
| `GOOGLE_CLIENT_SECRET` | – | |
| `S3_ENDPOINT_URL` | `http://localhost:9000` | leave blank for AWS S3 |
| `S3_BUCKET` | `mockinterview` | |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `minioadmin` / `minioadmin` | |
| `SMTP_HOST` | `localhost` | use `smtp.gmail.com` for prod-ish |
| `SMTP_PORT` | `1025` | `587` for Gmail |
| `SMTP_USER` / `SMTP_PASSWORD` | – | Gmail App Password (16 chars, no spaces) |
| `SMTP_FROM` | – | sender email |
| `FRONTEND_URL` | `http://localhost:5173` | used in email links |
| `CORS_ORIGINS` | `http://localhost:5173` | comma-separated allow-list |

### `frontend/.env`

| Key | Purpose |
|---|---|
| `VITE_API_URL` | base URL for REST calls — `http://localhost:8000` |
| `VITE_WS_URL` | base URL for WebSocket — `ws://localhost:8000` |
| `VITE_GOOGLE_CLIENT_ID` | OAuth Client ID — must match backend |

Restart `npm run dev` after editing — Vite only reads env on
startup.

### Important non-env knobs

| File | Constant | Default | Effect if changed |
|---|---|---|---|
| `backend/app/interviews/orchestrator.py` | `NUDGE_CAP` | `2` | Max soft-nudges per question before LLM is forced into a real follow-up |
| `backend/app/interviews/orchestrator.py` | `FOCUS_VIOLATION_LIMIT` | `3` | Tab-switch / blur / fullscreen-exit count before auto-end |
| `backend/app/interviews/stt.py` | `endpointing` | `800` | ms of silence before Deepgram emits a phrase final |
| `backend/app/interviews/stt.py` | `utterance_end_ms` | `2500` | ms of silence before Deepgram fires UtteranceEnd (= answer is done) |

---

## 13. Common customizations

### "I want a different interviewer voice."

See § 7. Change `ELEVENLABS_VOICE_ID` (or switch to OpenAI TTS).

### "I want shorter mid-thought tolerance."

Edit `utterance_end_ms` in
`backend/app/interviews/stt.py`. Lower = more reactive but more
likely to cut the candidate off. Don't go below ~1500 ms.

### "I want stricter / softer focus rules."

Edit `FOCUS_VIOLATION_LIMIT` in
`backend/app/interviews/orchestrator.py`. Set to a high number
(e.g. 999) to effectively disable the auto-end while still
recording violations on the report.

### "I want a different LLM."

Switch `LLM_PROVIDER` and `LLM_MODEL`. To add a totally new
provider, mirror `GroqProvider` / `OpenAIProvider` in
`backend/app/core/llm_provider.py` and wire it into
`get_llm_provider()`.

### "I want to disable Google OAuth."

Remove `VITE_GOOGLE_CLIENT_ID` from `frontend/.env` and the
button hides. The backend route is also gated on the env var.

### "I want a different question style."

Edit the prompts at the top of
`backend/app/interviews/agent.py` —
`INITIAL_QUESTIONS_SYSTEM` (the plan generator) and
`FOLLOWUP_SYSTEM` (the in-loop decider). The patience rules,
fragment definition, and stop-signal handling are all in the
follow-up system prompt.

### "I want the candidate's audio recorded for playback in the report."

Currently the report shows the transcript. To capture audio you
would: (a) keep MediaRecorder running per turn on the client,
(b) upload the blob to MinIO via a new `/api/v1/turns/{id}/audio`
endpoint, (c) write the S3 key to the Turn row, (d) make
`TranscriptPlayer` render an `<audio>` for it. None of this is
wired up — the component exists but the upload path doesn't.

---

## 14. Troubleshooting cheatsheet

For all the gnarly setup issues see `README.md` § Troubleshooting.
The most common ones:

- **`pip install -e .` builds from source and fails** — MSYS2 /
  Git Bash Python is on PATH; use `py -3.13` to create the venv.
- **`alembic upgrade head` says password auth failed** — a native
  Postgres is on port 5432. The compose file uses 5433 — make
  sure both `DATABASE_URL` and `alembic.ini` agree on it.
- **`extension "vector" is not available`** — old volume from a
  vanilla Postgres image: `docker compose down -v` then up.
- **Google login: missing client_id** — Vite was running before
  you set the env var. Restart `npm run dev`.
- **OTP email never arrives** — `SMTP_PASSWORD` must be a Gmail
  App Password, not your account password.
- **`DeepgramSTT.start.<locals>._on_speech_started() missing 1
  required positional argument: '_event'`** — Deepgram SDK 3.x
  signature drift. The fix is already in
  `backend/app/interviews/stt.py` (uses `*args, **kwargs`). If
  this comes back, the fix is the same pattern.
- **`Error response from daemon: ports are not available
  ... 6379`** — something else has Redis. Stop it or remap the
  port in `docker-compose.yml`.

---

*Updated 2026-04-28. If something here drifts from the code,
trust the code — the patient turn-taking, focus-integrity, nudge
cap and stop-intent rules all live in
`backend/app/interviews/orchestrator.py` and `agent.py`.*
