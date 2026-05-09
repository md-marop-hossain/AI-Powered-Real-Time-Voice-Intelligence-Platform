# AI-Powered Voice-Based Mock Interview System

A full-stack web application where a candidate uploads their résumé and an AI voice agent runs a real-time mock interview — asking contextual questions, following up on answers, scoring performance, and generating a detailed PDF report.

- **Frontend:** React 18 + Vite + TypeScript + Tailwind + custom editorial design system (dark / light mode)
- **Backend:** FastAPI (Python 3.11+) with native WebSockets
- **Data:** Postgres + pgvector, Redis, MinIO — all via docker-compose
- **AI:** Pluggable LLM (Groq / OpenAI), Deepgram streaming STT, ElevenLabs / OpenAI streaming TTS
- **Auth:** Email/password with 6-digit OTP verification, Google OAuth, JWT access + refresh tokens
- **Email:** SMTP (Gmail) for OTP, password reset, and interview invitation emails
- **Invitations:** Creators invite candidates by email with tokenized links, attempt + expiry control, three question-source modes, per-candidate result visibility

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Detailed Setup](#detailed-setup)
4. [Environment Variables — Full Reference](#environment-variables--full-reference)
5. [How It Works](#how-it-works)
6. [Architecture](#architecture)
   - [Real-time voice loop](#real-time-voice-loop)
   - [Multi-agent coordination](#multi-agent-coordination)
   - [Session state machine](#session-state-machine)
   - [Database schema overview](#database-schema-overview)
   - [Repository layout](#repository-layout)
7. [WebSocket Protocol Reference](#websocket-protocol-reference)
8. [Scoring System](#scoring-system)
9. [Interview Modes](#interview-modes)
10. [API Reference](#api-reference)
11. [Auth Flow](#auth-flow)
12. [Invitation System](#invitation-system)
13. [Tests](#tests)
14. [Troubleshooting](#troubleshooting)
15. [Known Bugs & Issues](#known-bugs--issues)
16. [Improvement Roadmap](#improvement-roadmap)
17. [Strategic Roadmap — Path to Market-Ready SaaS](#strategic-roadmap--path-to-market-ready-saas)
18. [Security Notes](#security-notes)
19. [Production Readiness Checklist](#production-readiness-checklist)

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker Desktop | latest | Must include Docker Compose v2 |
| Python | 3.11 – 3.13 | From [python.org](https://www.python.org/downloads/) — not Microsoft Store, not MSYS2 |
| Node.js | 20+ | LTS recommended |
| Git | any | |

External API keys required:

| Service | Used for |
|---|---|
| Groq **or** OpenAI | LLM — question generation, turn decisions, scoring |
| Deepgram | Streaming speech-to-text |
| ElevenLabs **or** OpenAI TTS | Streaming text-to-speech |
| Google Cloud OAuth 2.0 | Google Sign-In |
| Gmail + App Password | OTP, password reset, invite emails |

---

## Quick Start

> **New here?** You'll need four things before any code runs: Docker Desktop, Python 3.11+, Node.js 20+, and API keys from four services. The checklist below walks you through each step.

---

### Step 1 — Get your API keys (do this first)

The app won't start without these. Create free or trial accounts:

| Service | What it does | Where to get the key |
|---|---|---|
| **Groq** (recommended) | Powers the AI interviewer | [console.groq.com](https://console.groq.com) → API Keys |
| **Deepgram** | Converts your voice to text | [console.deepgram.com](https://console.deepgram.com) → Create API Key |
| **ElevenLabs** | Reads questions aloud | [elevenlabs.io](https://elevenlabs.io) → Profile → API Key |
| **Google Cloud** | Google Sign-In button | [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web application). Add `http://localhost:5173` to Authorised JavaScript origins. Copy both the Client ID and Client Secret. |

> **Can I skip any?**
> - ElevenLabs: swap `TTS_PROVIDER=openai` and add your OpenAI key instead (uses `tts-1`).
> - Groq: swap `LLM_PROVIDER=openai` if you prefer OpenAI for the LLM too.
> - Google OAuth: you can register with email/password and skip the Google button, but you still need `GOOGLE_CLIENT_ID` set to a placeholder string so the frontend builds.

---

### Step 2 — Clone and start infrastructure

```bash
git clone <repo-url>
cd AI-Powered-Voice-Based-Mock-Interview-System

# Start Postgres, Redis, MinIO (S3-compatible storage), and MailHog (local email)
docker compose up -d

# Verify all containers are running
docker compose ps
```

You should see six containers in the `running` state. Postgres listens on **port 5433** (not 5432) to avoid conflicts with any local Postgres install.

> **Docker not installed?** Download [Docker Desktop](https://www.docker.com/products/docker-desktop/) for your OS. On Windows, enable the WSL 2 backend during installation.

---

### Step 3 — Backend setup

Open a terminal in the `backend/` folder.

#### 3a. Create a Python virtual environment

```bash
cd backend

# Windows (PowerShell)
py -3.11 -m venv myenv
.\myenv\Scripts\Activate.ps1

# macOS / Linux
python3.11 -m venv myenv
source myenv/bin/activate
```

> **Windows tip:** Use `py -3.11` explicitly — not bare `python`, which may point to the Microsoft Store stub or MSYS2.

#### 3b. Install dependencies

```bash
pip install -e ".[dev]"
pip install psycopg2-binary    # sync driver needed by Alembic
```

#### 3c. Create the `.env` file

```bash
cp .env.example .env
```

Open `.env` in a text editor and fill in the values below. Everything else can stay as the default:

```env
# Database (docker-compose exposes Postgres on 5433)
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/mockinterview

# Redis (docker-compose default)
REDIS_URL=redis://localhost:6379/0

# Security — generate a random string, e.g.: openssl rand -hex 32
JWT_SECRET=replace-this-with-a-long-random-string

# LLM
LLM_PROVIDER=groq
LLM_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=gsk_...

# Speech
DEEPGRAM_API_KEY=...
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...

# Email — MailHog catches all emails locally, no real SMTP needed in dev
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=noreply@mockinterview.local

# Frontend URL (leave as-is for local dev)
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
```

> **Want to see sent emails?** Open [http://localhost:8025](http://localhost:8025) — MailHog catches every outgoing email so you can see OTP codes and invite links without a real mail server.

#### 3d. Run database migrations

```bash
alembic upgrade head
```

This creates all tables. You should see migrations `0001` through `0008` applied.

#### 3e. Start the backend server

```bash
uvicorn app.main:app --reload --port 8000
```

Verify it works: [http://localhost:8000/health](http://localhost:8000/health) should return `{"status":"ok", ...}`.
Interactive API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

---

### Step 4 — Frontend setup

Open a **second terminal** in the `frontend/` folder.

```bash
cd frontend
npm install
cp .env.example .env
```

Open `frontend/.env` and set:

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
VITE_GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
```

Then start the dev server:

```bash
npm run dev
```

---

### Step 5 — Open the app

Go to [http://localhost:5173](http://localhost:5173) and create an account.

**First-time flow:**
1. Register with email/password (or Google Sign-In)
2. Check MailHog at [http://localhost:8025](http://localhost:8025) for your 6-digit OTP
3. Upload your résumé (PDF, DOCX, or TXT)
4. Click **New Interview**, choose a role and duration, and start talking

---

### Quick-reference: all local URLs

| URL | What it is |
|---|---|
| [http://localhost:5173](http://localhost:5173) | Frontend (React app) |
| [http://localhost:8000](http://localhost:8000) | Backend (FastAPI) |
| [http://localhost:8000/docs](http://localhost:8000/docs) | Swagger / OpenAPI |
| [http://localhost:8025](http://localhost:8025) | MailHog — catch-all inbox |
| [http://localhost:9001](http://localhost:9001) | MinIO console (`minioadmin` / `minioadmin`) |

---

### Stopping everything

```bash
# Stop the frontend and backend with Ctrl+C in each terminal, then:
docker compose down          # stop containers, keep data
docker compose down -v       # stop containers AND wipe all data (clean slate)
```

---

## Detailed Setup

### 1. Infrastructure (Docker)

```bash
docker compose up -d
docker compose ps    # verify all containers are healthy
```

| Service | Host port | Credentials |
|---|---|---|
| Postgres | `localhost:5433` | `postgres` / `postgres`, db `mockinterview` |
| Redis | `localhost:6379` | none |
| MinIO S3 API | http://localhost:9000 | `minioadmin` / `minioadmin` |
| MinIO console | http://localhost:9001 | same |
| MailHog SMTP | `localhost:1025` | none |
| MailHog UI | http://localhost:8025 | none (local email catch-all) |

> Postgres runs on **port 5433** (not 5432) to avoid conflicts with a native Postgres install.

### 2. Backend

#### Create venv

> **Windows users:** If MSYS2/Git Bash is in your PATH, use `py -3.13 -m venv myenv` explicitly — not bare `python`.

```bash
cd backend
python -m venv myenv
.\myenv\Scripts\Activate.ps1   # Windows
# source myenv/bin/activate    # macOS/Linux
pip install -e .
pip install psycopg2-binary
```

#### Configure `.env`

```bash
cp .env.example .env
```

Minimum required values (see [full reference](#environment-variables--full-reference)):

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/mockinterview
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=replace-with-a-long-random-string-never-use-default
LLM_PROVIDER=groq
LLM_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=gsk_...
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=you@gmail.com
SMTP_USER=you@gmail.com
SMTP_PASSWORD=xxxxxxxxxxxxxxxx
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
```

#### Migrations and server

```bash
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Health check: http://localhost:8000/health — Swagger UI: http://localhost:8000/docs

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
```

`frontend/.env`:
```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
VITE_GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
```

```bash
npm run dev
```

### 4. Gmail App Password

1. Enable 2-Step Verification on the sending Google account
2. Go to https://myaccount.google.com/apppasswords
3. Create an App Password (any label)
4. Paste the 16-character key as `SMTP_PASSWORD` — no spaces

### 5. Google OAuth Client

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web application)
2. Authorized JavaScript origins: `http://localhost:5173`
3. Authorized redirect URIs: `http://localhost:5173`
4. Copy Client ID → `backend/.env` `GOOGLE_CLIENT_ID` and `frontend/.env` `VITE_GOOGLE_CLIENT_ID`
5. Copy Client Secret → `backend/.env` `GOOGLE_CLIENT_SECRET`

---

## Environment Variables — Full Reference

All variables live in `backend/.env` (backend) and `frontend/.env` (frontend). Neither file is committed.

### Backend

| Variable | Default | Required | Description |
|---|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5433/mockinterview` | Yes | Async Postgres URL |
| `REDIS_URL` | `redis://localhost:6379/0` | Yes | Redis for sessions / rate limiting |
| `JWT_SECRET` | `change-me` | **Yes — must override** | Signs all JWTs. A default of `change-me` will cause a startup warning; in production this must be a strong random string |
| `JWT_ALGORITHM` | `HS256` | No | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | No | |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | No | |
| `PASSWORD_RESET_EXPIRE_MINUTES` | `60` | No | |
| `LLM_PROVIDER` | `groq` | Yes | `groq` or `openai` |
| `LLM_MODEL` | `llama-3.3-70b-versatile` | Yes | Model name for chosen provider |
| `GROQ_API_KEY` | _(empty)_ | If provider=groq | |
| `OPENAI_API_KEY` | _(empty)_ | If provider=openai | |
| `DEEPGRAM_API_KEY` | _(empty)_ | Yes | Streaming STT |
| `TTS_PROVIDER` | `elevenlabs` | No | `elevenlabs` or `openai` |
| `ELEVENLABS_API_KEY` | _(empty)_ | If TTS=elevenlabs | |
| `ELEVENLABS_VOICE_ID` | `21m00Tcm4TlvDq8ikWAM` | No | Rachel voice by default |
| `OPENAI_TTS_MODEL` | `tts-1` | No | |
| `OPENAI_TTS_VOICE` | `alloy` | No | |
| `GOOGLE_CLIENT_ID` | _(empty)_ | If using Google OAuth | |
| `GOOGLE_CLIENT_SECRET` | _(empty)_ | If using Google OAuth | |
| `S3_ENDPOINT_URL` | `http://localhost:9000` | Yes | MinIO or real S3 |
| `S3_BUCKET` | `mockinterview` | Yes | |
| `S3_ACCESS_KEY` | `minioadmin` | Yes | |
| `S3_SECRET_KEY` | `minioadmin` | Yes | |
| `S3_REGION` | `us-east-1` | No | |
| `SMTP_HOST` | `localhost` | Yes | `smtp.gmail.com` for Gmail |
| `SMTP_PORT` | `1025` | Yes | `587` for Gmail TLS |
| `SMTP_FROM` | `noreply@mockinterview.local` | Yes | Sender address |
| `SMTP_USER` | _(empty)_ | Yes | Gmail address |
| `SMTP_PASSWORD` | _(empty)_ | Yes | Gmail App Password (16 chars) |
| `FRONTEND_URL` | `http://localhost:5173` | Yes | Used in email links |
| `CORS_ORIGINS` | `http://localhost:5173` | Yes | Comma-separated allowed origins |
| `INVITE_EXPIRY_HOURS` | `24` | No | Default invite validity |
| `INVITE_MAX_ATTEMPTS` | `1` | No | Default max candidate attempts per invite |
| `SENTRY_DSN` | _(empty)_ | No | Sentry DSN — error tracking disabled when empty |
| `LOG_LEVEL` | `INFO` | No | Root log level (`DEBUG` / `INFO` / `WARNING` / `ERROR`) |

### Frontend

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend HTTP base URL (`http://localhost:8000`) |
| `VITE_WS_URL` | Backend WebSocket base URL (`ws://localhost:8000`) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `VITE_SENTRY_DSN` | Sentry DSN — frontend error tracking disabled when empty |

---

## How It Works

### Self-service candidate flow

```
1. Register (email+OTP or Google OAuth) → email verified → dashboard
2. Upload résumé (PDF / DOCX / TXT, ≤ 10 MB)
     → pypdf / python-docx parses text
     → pgvector stores 768-dim embedding
     → MinIO stores the original file
3. "New Interview" → select role, seniority, focus, industry, duration
4. POST /sessions
     → ResearchAgent: queries past sessions with skill_coverage
          → surfaces skill IDs with avg score < 5.0 as weak_areas
     → PlannerAgent: generates 6–10 questions via LLM
          → injects weak_areas as priority probe hints
          → Session row created (questions_plan includes research_hints)
5. WebSocket /ws/interview/{session_id}?token=JWT
     → Deepgram STT starts (streaming, utterance-end triggered)
     → First question TTS plays
6. Per turn:
     a. Candidate speaks → Deepgram emits final transcript
     b. EvaluatorAgent + decide_next_turn run in parallel (asyncio.gather)
     c. VerifierAgent fires as fire-and-forget background task
     d. Decision: nudge | ask_followup | next_question | end_section
     e. Difficulty updated (±0.5, clamped [1, 10])
     f. Next question text calibrated for current difficulty
     g. TTS plays next line
7. Session ends (plan exhausted / timer / candidate says "stop" / focus violations)
8. _generate_report_background (fire-and-forget):
     → FeedbackAgent writes coaching narrative
     → render_pdf in ThreadPoolExecutor → MinIO upload
     → Report row persisted → creator email notification (if invited)
9. GET /sessions/{id}/report
     → summary + PDF URL returned
     → per-turn audio_key re-signed into fresh presigned audio_url
```

### Invitation flow

**Creator:**
```
1. CreateInvitePage → emails, role, duration, mode, etc.
   For ai_generated / jd_based:
     → drag-drop candidate résumé → POST /resumes → resume_id
2. POST /invites
     → question plan generated (LLM or verbatim list)
     → one InterviewInvite + one invitee row per email address
     → branded emails dispatched
3. InvitesDashboardPage:
     → ACTIVE / EXPIRED / USED badge per row + completion ratio
     → COPY button → clipboard-copies invite_url
     → PARTICIPATE → creator self-test (no attempt consumed)
     → row click → /invites/{id}/results → per-candidate scores + report links
```

**Candidate:**
```
1. Email link → /invite/{token} → invite details
   OR dashboard "Pending Invitations" section → JOIN →
2. Sign in (email must match invitee.email — server enforces 403 on mismatch)
3. POST /invites/{token}/start → session created from stored question plan
4. Interview proceeds → completion decrements attempts_used
5. Creator receives email: overall score + results URL
```

---

## Architecture

### Real-time voice loop

```
Browser mic  (AudioWorkletNode — 16 kHz PCM Int16LE, audio thread)
  │  fallback: ScriptProcessorNode (main thread)
  ▼
WebSocket /ws/interview/{session_id}?token=JWT
  ├─ binary frames ──► Deepgram streaming STT
  │                      ├─ on_interim  ──► {"type":"user_interim"}
  │                      ├─ on_final    ──► {"type":"transcript"} + pending queue
  │                      ├─ speech_start──► {"type":"user_speech_started"}
  │                      └─ utter_end   ──► {"type":"user_speech_ended"}
  │
  ├─ PCM duplicated into per-turn bytearray (cap ~12 MB)
  │    → on turn boundary: _save_turn_audio (background task)
  │      → WAV encode → MinIO upload → Turn.audio_key
  │
  └─ consume_transcripts() task
       ├─ {"type":"ai_thinking"}
       │
       ├─ SessionOrchestrator.submit_answer(transcript)
       │    ├─ asyncio.gather(return_exceptions=True)
       │    │    ├─ EvaluatorAgent (30s timeout)
       │    │    │    ├─ deterministic: confidence (filler ratio + length)
       │    │    │    │                 keyword_coverage (skill graph)
       │    │    │    └─ LLM: technical_depth, problem_solving,
       │    │    │              communication, structure, consistency
       │    │    │    └─► EvalResult(scores, rationale, skill_tags)
       │    │    │
       │    │    └─ decide_next_turn (30s timeout)
       │    │         └─► {decision, next_text, rationale}
       │    │
       │    ├─ Turn.scores = eval_result.scores (7-dim)
       │    ├─ Turn.skill_tags, difficulty_level saved
       │    ├─ difficulty ±0.5, clamped [1, 10]
       │    └─ next Q: calibrate_question_text(q, difficulty)
       │
       ├─ speak(next_text)
       │    ├─ {"type":"ai_question", q_index, q_total}
       │    │    OR {"type":"ai_nudge"}
       │    ├─ TTS stream → binary MP3 chunks
       │    └─ {"type":"ai_audio_end"}
       │
       ├─ VerifierAgent  ←── asyncio.create_task (fire-and-forget)
       │    → own AsyncSessionLocal
       │    → re-scores 5 LLM dims independently
       │    → Turn.verified_scores, Turn.verifier_flags
       │
       └─ {"type":"time_remaining", seconds}

Session end
  ├─ _update_session_skill_coverage()
  │    → Session.skill_coverage {skill_id: avg_score}
  │    → Session.difficulty_curve [float list]
  └─ _generate_report_background() ←── asyncio.create_task
       ├─ FeedbackAgent → FeedbackNarrative
       ├─ build_report_summary(session, narrative)
       ├─ render_pdf() in ThreadPoolExecutor → MinIO
       ├─ Report row persisted
       └─ _notify_creator_of_completion() (best-effort SMTP)
```

Latency target: ≤ 1.5 s p95 from end-of-utterance to first TTS byte.

### Multi-agent coordination

**Session start (POST /sessions):**

```
load_skill_graph(role)          ← lru_cache, JSON from skill_graphs/
     ↓
ResearchAgent (timeout 30s)
  SELECT sessions WHERE user_id AND skill_coverage IS NOT NULL
  ORDER BY created_at DESC LIMIT 3
  → aggregate weak skill IDs (avg score across sessions < 5.0)
  → LLM call → ResearchHints {weak_areas, probe_topics, cross_session_note}
  ↓ (fallback: ResearchHints() empty on any exception)
PlannerAgent
  → hint_clause = "Priority probe areas: {weak_areas}. Weight toward these."
  → generate_question_plan(extra_context=hint_clause)
  → returns list[{index, section, question}]
     ↓
Session.questions_plan = {
  "questions": [...],
  "mode": "resume_based",
  "research_hints": {"weak_areas": [...], "cross_session_note": "..."}
}
```

**Per turn (WebSocket, non-nudge):**

```
asyncio.gather:
  EvaluatorAgent → EvalResult
    confidence  = (1 − filler_ratio × 1.5) × 7 + min(words/40, 1) × 3
    kw_coverage = matched_skill_keywords / total_skills × 10
    LLM → technical_depth, problem_solving, communication, structure, consistency
    → skill_tags = [skill IDs whose keywords appear in answer]

  decide_next_turn → {decision, next_text, rationale}

merge:
  Turn.scores    = eval_result.scores          (7-dim replaces 4-dim)
  Turn.skill_tags = eval_result.skill_tags
  Turn.rationale  = eval_result.rationale
  Turn.difficulty_level = _current_difficulty

  avg = mean(all 7 dims)
  _current_difficulty += 0.5 if avg ≥ 7 else (-0.5 if avg ≤ 4 else 0)
  _current_difficulty  = clamp(_current_difficulty, 1.0, 10.0)
  _difficulty_curve.append(_current_difficulty)

if decision == next_question:
  next_q_text = calibrate_question_text(plan[idx]["question"], difficulty)
    difficulty < 3 → append "(Feel free to start from what you know…)"
    difficulty > 7 → append "(No scaffolding — production-level answer.)"
    else           → unchanged
```

**After speak() (fire-and-forget):**

```
VerifierAgent (asyncio.create_task):
  async with AsyncSessionLocal() as db:
    LLM re-scores technical_depth, problem_solving, communication,
             structure, consistency  (independently, different prompt)
    flags = [dim for dim where |original - verified| > 1.5]
    UPDATE turns SET verified_scores=…, verifier_flags=… WHERE id=turn_id
```

**Session end:**

```
_update_session_skill_coverage():
  for skill in skill_graph.skills:
    scores = [(t.technical_depth + t.problem_solving)/2
              for t in turns if skill.id in t.skill_tags]
    skill_coverage[skill.id] = mean(scores) if scores else 0.0
  session.skill_coverage = skill_coverage
  session.difficulty_curve = _difficulty_curve

FeedbackAgent:
  skill_coverage_summary (Python, no LLM)
  → LLM: executive_summary, strong_skills, weak_skills, recommendations
  → FeedbackNarrative (fallback: empty on exception)
```

### Session state machine

```
  ┌──────────┐   POST /sessions        ┌─────────────┐
  │          │ ──────────────────────► │   PENDING   │
  │  (start) │                         └──────┬──────┘
  └──────────┘                                │ WS connects
                                              │ orch.start() / restore / recover
                                              ▼
                                       ┌─────────────┐
                                       │ IN_PROGRESS │ ◄─── Redis state saved
                                       └──────┬──────┘      every turn (3h TTL)
                                              │
                         ┌────────────────────┼────────────────────┐
                         │                    │                    │
                    plan exhausted      timer reaches 0      focus_violations ≥ 3
                    force_end()         auto-end             end_section
                    "stop interview"
                         │                    │                    │
                         └────────────────────▼────────────────────┘
                                       ┌─────────────┐
                                       │  COMPLETED  │ (terminal)
                                       └─────────────┘
                                             │
                              _generate_report_background()
                                             │
                                       ┌─────────────┐
                                       │   Report    │ → PDF → MinIO
                                       └─────────────┘
```

**Reconnect logic (ordered):**

1. Load Redis key `interview:{session_id}:state` → if present and `ended=false` → `restore_state()` → send `{"type": "resumed"}`
2. Redis miss but `session.status == in_progress` → `recover_from_db()` (rebuild from persisted `Turn` rows) → send `{"type": "resumed"}`
3. Otherwise → fresh `orch.start()` (new interview)

**Redis state payload** (`interview:{session_id}:state`, TTL 3h):

```json
{
  "plan_idx": 2,
  "nudges_on_current_turn": 1,
  "followups_on_current_question": 0,
  "history": [...],
  "current_question": "...",
  "time_remaining_seconds": 1240,
  "started_at": "...",
  "current_difficulty": 6.0,
  "difficulty_curve": [5.0, 5.5, 6.0],
  "focus_violations": 0,
  "ended": false
}
```

### Database schema overview

| Table | Key columns | Purpose |
|---|---|---|
| `users` | `id`, `email`, `password_hash`, `google_sub`, `email_verified`, `otp_hash` | Auth — email+password or Google OAuth |
| `resumes` | `id`, `user_id`, `parsed` (JSONB), `embedding` (vector 768), `storage_key` | Parsed résumé + pgvector embedding + MinIO key |
| `sessions` | `id`, `user_id`, `resume_id`, `invite_id`, `status`, `questions_plan` (JSONB), `final_scores` (JSONB), `difficulty_curve` (JSONB), `skill_coverage` (JSONB), `focus_violations` | Per-interview state, plan, and aggregated results |
| `turns` | `id`, `session_id`, `index`, `question_kind`, `question`, `answer`, `scores` (JSONB 7-dim), `skill_tags` (JSONB), `difficulty_level`, `verified_scores` (JSONB), `verifier_flags` (JSONB), `audio_key` | Per-question record with all scoring metadata |
| `reports` | `id`, `session_id`, `overall_score`, `summary` (JSONB), `pdf_key` | Final report; `summary` includes narrative + skill coverage |
| `question_sets` | `id`, `mode`, `questions` (JSONB), `resume_id` | Invite question plan (predefined / AI / JD) |
| `interview_invites` | `id`, `creator_id`, `question_set_id`, `token`, `expires_at`, `max_attempts`, `revoked` | Per-invite tokenized link + lifecycle |
| `invitees` | `id`, `invite_id`, `email`, `attempts_used`, `completed_session_id` | Per-candidate tracking within an invite |

Migrations: `0001` (base schema) → `0005` (invitations) → `0006` (QuestionSet resume_id) → `0007` (Phase 1 AI layer — `turns.{difficulty_level, skill_tags, verified_scores, verifier_flags}` + `sessions.{difficulty_curve, skill_coverage}`).

### Repository layout

```
.
├── frontend/
│   └── src/
│       ├── pages/            # 16 pages: auth, dashboard, upload, interview room,
│       │                     # complete, report, account, invite CRUD + results
│       ├── components/
│       │   ├── editorial/    # design-system: buttons, inputs, dialogs, theme toggle
│       │   ├── interview/    # AIAvatar (Three.js), QuestionCard, Waveform,
│       │   │                 # CountdownTimer, Transcript, Preflight, Rules, …
│       │   ├── report/       # ScoreBars, PerQuestionArticle, PDF cover
│       │   └── upload/       # UploadProgress, ParsingReveal, ResumeReview
│       ├── hooks/            # useMicStream, useAudioPlayer, useInterviewState
│       ├── lib/              # api (axios + refresh interceptor), motion, utils
│       ├── store/            # Zustand: auth, theme (dark default + persist)
│       └── styles/           # tokens.css (CSS custom properties)
├── backend/
│   └── app/
│       ├── agents/           # Phase 1 agent fleet: base, planner, researcher,
│       │                     # question, evaluator, verifier, feedback
│       ├── skill_graphs/     # Per-role JSON skill graphs + load_skill_graph() loader
│       ├── core/             # config, security (bcrypt+JWT), db, llm_provider, email
│       ├── auth/             # register, verify-email, resend-otp, login,
│       │                     # google, refresh, forgot/reset password, account
│       ├── resumes/          # upload, parsing (pypdf/python-docx), pgvector embeddings
│       ├── interviews/       # agent, orchestrator, STT/TTS, WebSocket handler, routes
│       ├── invites/          # invitation system: question_sets builders, routes, service
│       ├── scoring/          # rubric aggregation — v1 (4-dim) + v2 (7-dim) schema-aware
│       ├── reports/          # WeasyPrint PDF generation + coaching narrative section
│       ├── models/           # SQLAlchemy ORM models
│       ├── schemas/          # Pydantic request/response models
│       └── workers/          # Celery task definitions (resume parsing offload)
├── alembic/versions/         # Migrations 0001–0007
└── docker-compose.yml
```

---

## WebSocket Protocol Reference

The WebSocket endpoint is `/ws/interview/{session_id}?token=<JWT access token>`. Binary frames carry audio; text frames carry JSON control messages.

### Server → Client messages

| `type` | Extra fields | Description |
|---|---|---|
| `ai_question` | `text`, `q_index` (1-based), `q_total` | New primary question. TTS binary stream follows immediately. |
| `ai_nudge` | `text` | Soft continuation prompt ("Go on.", "Take your time."). TTS binary stream follows. Does NOT create a new turn. |
| *(binary)* | raw MP3 bytes | Streamed TTS audio. Arrives between an `ai_question`/`ai_nudge` header and the `ai_audio_end` footer. |
| `ai_audio_end` | — | Marks the end of one TTS segment. Client may start rendering the "listening" state. |
| `transcript` | `text` | Committed utterance from Deepgram (UtteranceEnd). Client appends to the current turn's answer display. |
| `user_interim` | `text` | In-progress STT result. Client shows a live "typing" preview. |
| `user_speech_started` | — | Deepgram VAD detected speech onset. |
| `user_speech_ended` | — | Deepgram UtteranceEnd fired. |
| `ai_thinking` | — | LLM call in-flight. Client shows "Considering your answer…" |
| `ai_idle` | — | LLM call failed (recoverable). Client clears spinner; an `error` follows. |
| `time_remaining` | `seconds` | Updated after every turn. Client syncs countdown timer. |
| `session_ended` | `reason`? (`"focus_violations"`) | Interview complete. Client navigates to /complete. |
| `focus_violation_ack` | `count`, `limit`, `reason` | Server acknowledged a focus event. Client shows warning badge. |
| `error` | `message` | Non-fatal error (toast). Consumer loop continues. |
| `resumed` | — | Reconnection: Redis state restored successfully. |
| `ping` | — | Keepalive frame sent every 30 s to defeat LB idle timeouts. |

### Client → Server messages

| Content | Description |
|---|---|
| binary (PCM Int16LE 16 kHz mono) | Continuous mic audio — every `AudioWorkletNode` frame forwarded as-is. Server duplicates into per-turn buffer AND feeds Deepgram. |
| `{"type": "end_session"}` | Candidate explicitly ends the interview. Server calls `force_end()` and emits `session_ended`. |
| `{"type": "end_speech"}` | Manual VAD hint. Deepgram usually handles this; kept for edge cases. |
| `{"type": "focus_violation", "reason": "tab_switch"\|"fullscreen_exit"\|"window_blur"}` | Integrity event from frontend. Server records on session, returns `focus_violation_ack`. 3 violations end the session. |
| `{"type": "pong"}` | Optional keepalive ack. Accepted as no-op so symmetric clients don't appear malformed. |

### Turn lifecycle over the wire

```
server: {"type":"ai_question","text":"Tell me about...","q_index":1,"q_total":8}
server: <binary MP3 chunk 1>
server: <binary MP3 chunk 2>
...
server: {"type":"ai_audio_end"}
client: <binary PCM frames — continuous>
server: {"type":"user_speech_started"}
server: {"type":"user_interim","text":"I worked on..."}
server: {"type":"user_speech_ended"}
server: {"type":"transcript","text":"I worked on a distributed cache at my last company."}
server: {"type":"ai_thinking"}
server: {"type":"ai_question","text":"How did you handle cache invalidation?","q_index":1,"q_total":8}
server: <binary MP3...>
server: {"type":"ai_audio_end"}
server: {"type":"time_remaining","seconds":1204}
```

---

## Scoring System

### 7-dimension rubric (v2 schema — Phase 1)

Detected by presence of `"technical_depth"` in `Turn.scores`. New sessions always produce v2.

| Dimension | Source | How calculated |
|---|---|---|
| `technical_depth` | LLM | Depth and precision of technical knowledge demonstrated |
| `problem_solving` | LLM | Quality of analytical reasoning, approach, trade-offs |
| `communication` | LLM | Clarity, conciseness, audience-awareness |
| `structure` | LLM | STAR / BAR format adherence, logical progression |
| `consistency` | LLM | Coherence with prior answers in the same session |
| `confidence` | Deterministic | `(1.0 − filler_ratio × 1.5) × 7.0 + min(word_count / 40, 1.0) × 3.0` — penalises filler words ("uh", "um", "like", …), rewards length up to ~40 words |
| `keyword_coverage` | Deterministic | `matched_skill_keywords / total_skills × 10.0` — intersection of answer text with the role's skill graph keyword lists |

**Aggregation:**

```
llm_avg  = mean(technical_depth, problem_solving, communication, structure, consistency)
det_avg  = mean(confidence, keyword_coverage)
overall  = round(llm_avg × 0.8 + det_avg × 0.2, 2)
```

### 4-dimension rubric (v1 schema — backward compat)

Pre-Phase-1 sessions have `clarity`, `depth`, `correctness`, `communication`. Detected by absence of `"technical_depth"`.

```
overall = mean(clarity, depth, correctness, communication)  [equal weight]
```

`schema_version: "v1"/"v2"` is included in all report summaries. Old sessions always hit the v1 path unchanged.

### Adaptive difficulty

Each session starts at difficulty `5.0`. After every scored (non-nudge) turn:

```
avg_score = mean(all 7 dimensions)
if avg_score ≥ 7.0:  difficulty += 0.5
if avg_score ≤ 4.0:  difficulty -= 0.5
difficulty = clamp(difficulty, 1.0, 10.0)
```

The trajectory is persisted in `Session.difficulty_curve` (list of floats, one per scored turn) and surfaced in the report summary. An interview that ramps from 5.0 to 8.5 and holds there signals a strong candidate who should have been tested harder.

**Question text calibration (`QuestionAgent.calibrate_question_text`):**

| Difficulty | Text appended |
|---|---|
| < 3.0 | `" (Feel free to start from what you know — no need for a complete answer.)"` |
| 3.0 – 7.0 | Unchanged |
| > 7.0 | `" (No scaffolding — please give a complete, production-level answer.)"` |

### Score verification (VerifierAgent)

After every non-nudge turn, a fire-and-forget task independently re-scores the 5 LLM dimensions using a separate prompt. Results stored in:

- `Turn.verified_scores` — independent 7-dim dict (deterministic dims copied from original)
- `Turn.verifier_flags` — list of dimension names where `|original − verified| > 1.5`

Flagged turns are visible in the raw DB and form the foundation for future human-review routing (Phase 6).

### Skill graph keyword coverage

Keyword matching uses the role's JSON skill graph. Each skill node has `keywords: list[str]`; a skill is "matched" if any keyword appears (case-insensitive substring) in the answer text.

**Available skill graphs:**

| File | Role slug | Skills |
|---|---|---|
| `backend_engineer.json` | `backend_engineer` | distributed_systems, database_design, api_design, caching, async_concurrency, system_design, testing, security, observability, data_structures_algorithms |
| `frontend_engineer.json` | `frontend_engineer` | react_ecosystem, javascript_typescript, css_layout, performance_optimization, state_management, testing, accessibility, build_tooling, browser_apis |
| `data_scientist.json` | `data_scientist` | machine_learning, statistics, python_data_stack, data_engineering, deep_learning, model_evaluation, feature_engineering, data_visualization |
| `product_manager.json` | `product_manager` | product_strategy, user_research, data_driven_decisions, roadmap_planning, stakeholder_management, agile_scrum, go_to_market, metrics_kpis |
| `engineering_manager.json` | `engineering_manager` | technical_leadership, people_management, hiring_onboarding, project_delivery, system_architecture, cross_functional_collaboration, incident_management, org_design |
| `default.json` | *(fallback)* | communication, problem_solving, technical_knowledge, critical_thinking, system_thinking |

`load_skill_graph(role_string)` normalises the role to a slug, tries an exact file match, then falls back to `default.json`. Returns `None` only if even `default.json` is absent.

---

## Interview Modes

Four modes coexist. The mode is persisted on `session.questions_plan["mode"]` and drives the entire runtime.

| Mode | Question source | Résumé required at create time? | Résumé context in follow-ups | Ad-hoc follow-ups |
|---|---|---|---|---|
| `resume_based` | LLM from candidate's own résumé + role/seniority/focus | n/a (candidate's own) | Yes — full | Yes |
| `predefined` | Creator's verbatim list | ❌ rejected (no LLM call) | ❌ no résumé linked | No — orchestrator overrides `ask_followup` → `next_question` |
| `ai_generated` | LLM from role/seniority/focus/instructions **+ creator-uploaded candidate résumé** | ✅ **required** | Yes — same résumé that drove the plan | Yes |
| `jd_based` | LLM from job description **+ creator-uploaded candidate résumé** | ✅ **required** | Yes — same résumé that drove the plan | Yes |

### Invite-mode résumé requirement

For `ai_generated` and `jd_based`, the **creator** uploads the candidate's résumé during invite creation (drag & drop or file picker on `CreateInvitePage`). The flow:

1. Frontend uploads the file to `POST /resumes` (returns `resume_id`).
2. `POST /invites` is called with `resume_id` in the body. The schema rejects the request if `resume_id` is missing for these two modes.
3. The route loads the parsed résumé, verifies it belongs to the creator (defence against IDOR), and feeds it to the question-generation LLM.
4. The chosen `resume_id` is persisted on `QuestionSet.resume_id` so the live follow-up agent can re-use the same résumé context.
5. When the candidate starts the interview, `Session.resume_id` is set from the invite's linked résumé (priority over the candidate's own `resume_id`), keeping the live agent grounded in the same content the plan was generated from.

If the underlying résumé is later deleted, the question set keeps its already-generated questions but the live follow-up agent loses résumé grounding (graceful degradation via `ON DELETE SET NULL`).

### Isolation invariants

- `session.questions_plan` is always `{"questions": [...], "mode": "<mode>"}`.
- `websocket.py` builds `resume_summary` whenever `session.resume` is present, **regardless of mode**. Predefined-mode invites never link a résumé so the agent stays generic; all other modes carry the same résumé end-to-end.
- `SessionOrchestrator(mode=...)` validates against the four-value set; unknown values fall back to `resume_based`.
- All AI/JD plan output passes through `_scrub_questions()` which strips `[Company Name]`-style placeholder tokens.
- Nudges (`"Take your time."`, `"Go on."`) are allowed in every mode — they don't count as follow-ups.
- A predefined plan with N questions ends at slot N even if time remains.

---

## API Reference

### Auth

| Method | Path | Rate limit | Description |
|---|---|---|---|
| POST | `/auth/register` | 5/min | Create user, send OTP |
| POST | `/auth/verify-email` | 10/min | Validate OTP → issue tokens |
| POST | `/auth/resend-otp` | 3/min | Re-send 6-digit code |
| POST | `/auth/login` | 10/min | Email + password → tokens |
| POST | `/auth/google` | 10/min | Google ID token → tokens |
| POST | `/auth/refresh` | — | Rotate access token |
| POST | `/auth/forgot-password` | 3/min | Email a reset link |
| POST | `/auth/reset-password` | 5/min | Consume reset token |
| GET | `/auth/me` | — | Current user profile |
| GET | `/auth/me/stats` | — | Dashboard aggregates |

### Resumes

| Method | Path | Description |
|---|---|---|
| POST | `/resumes` | Upload PDF/DOCX/TXT (≤ 10 MB), parse, store embeddings |
| GET | `/resumes` | List user's resumes |
| DELETE | `/resumes/{id}` | Delete resume + S3 object |

### Sessions

| Method | Path | Description |
|---|---|---|
| POST | `/sessions` | Start a `resume_based` interview session |
| GET | `/sessions` | List all sessions |
| GET | `/sessions/{id}` | Session detail + status |
| POST | `/sessions/{id}/end` | Finalize + score session |
| DELETE | `/sessions/{id}` | Delete session + report PDF |
| GET | `/sessions/{id}/report` | Scored report (lazy PDF generation — see Known Bugs #3) |
| WS | `/ws/interview/{id}?token=JWT` | Bidirectional audio + control channel |

### Invitations

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/invites` | Creator | Create invites (one per email) + send emails. **`ai_generated` and `jd_based` modes require `resume_id`** (upload via `POST /resumes` first). |
| GET | `/invites` | Creator | Creator dashboard list |
| GET | `/invites/received` | Candidate | Invites where signed-in email is an invitee |
| GET | `/invites/{token}` | Public | Validate token, show invite info |
| POST | `/invites/{token}/start` | Candidate (email-match required) | Create session from invite |
| POST | `/invites/{id}/participate` | Creator only | Creator self-test — bypasses email check, does not consume an attempt |
| GET | `/invites/{id}/results` | Creator only | Per-candidate result rows |

---

## Auth Flow

### Sign-up

1. Submit name + email + password → backend creates user (`email_verified=false`), sends 6-digit OTP
2. OTP: 10-minute expiry, max 5 attempts, resend on 60-second cooldown
3. On valid OTP → issue JWT access (15 min) + refresh (7 days) tokens

### Login

- Verified user → tokens
- Unverified user → 403 `email_not_verified` → frontend resends OTP, routes to `/verify-email`

### Google OAuth

- Bypasses OTP (Google has already verified the email)
- Existing manual account with same email → linked (`auth_provider=both`)

### Token lifecycle

- Access token: 15-minute expiry, sent in `Authorization: Bearer` header
- Refresh token: 7-day expiry, stored in Zustand, used by axios interceptor on 401
- Password reset: single-use token, bcrypt-hashed in DB, 60-minute expiry

---

## Invitation System

### Creator flow

1. `/invite` → fill emails, role, duration, seniority, focus, industry, question mode
2. **For `ai_generated` and `jd_based` modes:** drag & drop the candidate's résumé (PDF / DOCX / TXT, ≤ 10 MB) into the upload zone — required before submit. The file is uploaded to `/resumes` immediately and the returned `resume_id` is attached to the invite payload. The résumé is fed to the question-generation LLM so the plan is personalised, and is re-used by the live follow-up agent during the interview.
3. Submit → one `InterviewInvite` per email, each with its own token, expiry, attempt counter; one `QuestionSet` row per invite request, linked to the uploaded résumé via `QuestionSet.resume_id`.
4. Branded emails dispatched to all invitees
5. `/invites` dashboard shows lifecycle (ACTIVE / EXPIRED / USED), completion ratio
6. `PARTICIPATE →` button lets the creator experience the interview themselves (does not consume an attempt)
7. Click any row → `/invites/{id}/results` → per-candidate scores + report links

### Candidate flow

1. Click link in email → `/invite/{token}` → see invite details
2. **Or** log in → dashboard shows "Pending Invitations" section with `JOIN →` button
3. Sign in with the invited email address (enforced server-side with 403 on mismatch)
4. Click "Start interview" → session created from stored question plan → WebSocket interview

### Attempt control

- `max_attempts` (default: 1) limits how many times a candidate can start this invite
- Creator's self-test via `/participate` does **not** decrement `attempts_used`
- Expiry enforced at both token-validation time and start time

---

## Tests

```bash
# Backend
cd backend && pytest

# Frontend unit (Vitest)
cd frontend && npm test

# Frontend E2E (Playwright — needs both servers running)
cd frontend && npx playwright install && npm run test:e2e
```

### Current coverage (as of this writing)

| Area | Status |
|---|---|
| Scoring aggregation — v1 + v2 schema detection | 7 tests ✓ |
| JWT / bcrypt security | 4 tests ✓ |
| JWT secret startup safety | 9 tests ✓ |
| Résumé prompt-injection sanitizer | 12 tests ✓ |
| Invite service (token / expiry / lifecycle) | 11 tests ✓ |
| Orchestrator helpers (stop-intent, short-answer guard, caps) | 23 tests ✓ |
| Question-set placeholder scrubber | 8 tests ✓ |
| EvaluatorAgent — confidence + keyword_coverage helpers | 8 tests ✓ |
| Adaptive difficulty curve math + clamping | 7 tests ✓ |
| Skill graph loader (JSON schema, role resolution, fallback) | 7 tests ✓ |
| Auth routes | ✗ Not tested |
| Session routes | ✗ Not tested |
| Invite routes | ✗ Not tested |
| WebSocket protocol | ✗ Not tested |
| Resume upload/parsing | ✗ Not tested |
| Report generation | ✗ Not tested |
| Frontend components | ✗ Not tested |
| E2E interview flow | ✗ Not tested |

**Total: 96 tests passing.** Pure-unit coverage is solid across all Phase 1 agent helpers; route / WS integration coverage is still pending — see [Improvement Roadmap](#improvement-roadmap) item 17.

---

## Troubleshooting

### `pip install -e .` fails with SSL errors

MSYS2 Python is in PATH. Fix:

```powershell
$env:PATH = ($env:PATH -split ';' | Where-Object { $_ -notlike '*msys64*' }) -join ';'
Remove-Item -Recurse -Force myenv
py -3.13 -m venv myenv
.\myenv\Scripts\Activate.ps1
pip install -e .
```

### `alembic upgrade head` — authentication failed for `postgres`

A native Postgres is intercepting on port 5432 before Docker. Check `backend/.env` and `alembic.ini` both use port `5433`.

### `extension "vector" is not available`

Stale volume from a non-pgvector image:

```bash
docker compose down -v
docker compose up -d
alembic upgrade head
```

### Google login: `Missing required parameter: client_id`

`VITE_GOOGLE_CLIENT_ID` not set, or Vite was already running when `.env` was created. Stop and restart `npm run dev`.

### OTP email never arrives

1. `SMTP_PASSWORD` must be a Gmail App Password (16 chars, no spaces) — not your account password
2. Watch uvicorn logs: `SMTPAuthenticationError` = wrong creds; `SMTPConnectError` = port 587 blocked
3. For local dev use MailHog (http://localhost:8025) — set `SMTP_HOST=localhost`, `SMTP_PORT=1025`

### `ImportError: cannot import name 'DeepgramClientOptions' from 'deepgram'`

```bash
pip install "deepgram-sdk>=3.2.0,<4.0.0" --force-reinstall
```

### WeasyPrint PDF fails on Windows

WeasyPrint requires GTK. On Windows without GTK, the report falls back to inline HTML. For full PDF support use WSL or a Linux container.

---

## Known Bugs & Issues

These are confirmed gaps discovered through code analysis. They are ordered by severity.

---

### CRITICAL

#### ~~Bug 1 — WebSocket reconnection restarts the interview from scratch~~ ✅ Fixed

**File:** `backend/app/interviews/websocket.py`, `backend/app/interviews/orchestrator.py`, `backend/app/core/redis_client.py`

**Was:** On every new WebSocket connection the server called `orch.start()` and replayed Question 1. The `SessionOrchestrator` state lived entirely in memory and was lost on disconnect.

**Fix applied:**
- Added `backend/app/core/redis_client.py` — lazy async Redis singleton
- `SessionOrchestrator` now saves state to Redis on every turn (`_save_state`) and clears it on session end (`_clear_state`)
- WebSocket handler checks Redis on connect: restore from saved state → recover from DB turns → fresh start (three-way branch)
- Reconnecting candidates hear their current question again with a `{"type": "resumed"}` event instead of restarting from Q1

---

#### ~~Bug 2 — No concurrent session guard~~ ✅ Fixed

**Files:** `backend/app/interviews/routes.py`, `backend/app/invites/routes.py`

**Was:** `POST /sessions` (and invite start routes) created a new session with no check for an existing active session. Opening the app in two tabs could create conflicting DB rows.

**Fix applied:** All three session-creation endpoints (`start_session`, `start_invite`, `participate_as_creator`) now query for an existing `pending` or `in_progress` session and return `HTTP 409` if one is found before creating a new one.

---

#### ~~Bug 3 — Report generation blocks the HTTP worker (synchronous PDF rendering)~~ ✅ Fixed

**Files:** `backend/app/interviews/websocket.py`, `backend/app/interviews/routes.py`

**Was:** `GET /sessions/{id}/report` ran `render_pdf()` (WeasyPrint, 2–5 s) inline in the async HTTP handler, blocking the entire uvicorn event loop for that worker.

**Fix applied:**
- `render_pdf` and `upload_bytes` are now called via `loop.run_in_executor(None, ...)` in the `get_report` handler so they run in a thread pool instead of on the event loop
- The WebSocket `finally` block fires `asyncio.create_task(_generate_report_background(session_id))` — a fire-and-forget coroutine that opens its own DB session, generates the report (also via `run_in_executor`), and stores it so `GET /report` returns instantly on the first visit

---

### HIGH

#### ~~Bug 4 — No rate limiting on session, invite, and resume endpoints~~ ✅ Fixed

**Files:** `backend/app/interviews/routes.py`, `backend/app/invites/routes.py`, `backend/app/resumes/routes.py`

**Was:** Auth endpoints had `slowapi` rate limits. Interview, invite creation, and resume upload routes had none — an attacker could hammer LLM-backed endpoints and accumulate API costs.

**Fix applied:** `@limiter.limit(...)` decorators added on every cost-bearing route, sharing the existing `slowapi` Limiter from `app.auth.routes`:
- `POST /sessions` — `10/hour`
- `POST /invites` — `20/hour`
- `POST /invites/{token}/start` — `5/hour`
- `POST /invites/{id}/participate` — `10/hour`
- `POST /resumes` and `POST /resumes/process` — `30/hour`

---

#### ~~Bug 5 — No React Error Boundary~~ ✅ Fixed

**Files:** `frontend/src/components/ErrorBoundary.tsx` (new), `frontend/src/main.tsx`

**Was:** An unhandled JavaScript exception unmounted the entire React tree, leaving the candidate on a blank white screen with no recovery path.

**Fix applied:** New `ErrorBoundary` component (class-based, uses `getDerivedStateFromError` + `componentDidCatch`) wraps the entire `<App />` tree in `main.tsx`. The fallback UI matches the editorial design system and offers two recovery paths: reload the page or navigate back to `/dashboard`. In dev builds the captured stack trace is shown for debugging.

---

#### ~~Bug 6 — `JWT_SECRET` defaults to `"change-me"`~~ ✅ Fixed

**Files:** `backend/app/core/config.py`, `backend/app/main.py`

**Was:** A staging or production deploy that forgot to set `JWT_SECRET` would silently sign every token with the publicly known default `"change-me"`.

**Fix applied:** Added an `ENV` setting (`development` | `staging` | `production`, default `development`) and a `Settings.assert_jwt_secret_is_safe()` method that runs in the FastAPI startup lifespan. It blocks any known-insecure default (`change-me`, `change-me-to-a-long-random-string`, `secret`, `your-secret-here`, anything under 16 chars) — but only when `ENV != development`, so local dev and `pytest` keep working with a loud warning instead.

---

#### ~~Bug 7 — No WebSocket heartbeat / keepalive~~ ✅ Fixed

**File:** `backend/app/interviews/websocket.py`

**Was:** The WebSocket had no ping/pong frames. Load balancer idle timeouts (~60s) silently dropped the connection during quiet periods of an interview.

**Fix applied:** A `heartbeat()` task runs alongside the existing `consume_transcripts()` consumer. Every 30 seconds it sends `{"type": "ping"}` on the socket (under the existing `send_lock`, with a 5s send timeout). The receive loop also accepts `{"type": "pong"}` from the client as a no-op so symmetric ack-style clients aren't treated as malformed traffic. Both task lifecycles are owned by the WS handler — `keepalive.cancel()` runs in the same `finally` block as `consumer.cancel()`.

---

### MEDIUM

#### ~~Bug 8 — Resume text injected into LLM prompts without sanitization~~ ✅ Fixed

**Files:** `backend/app/interviews/agent.py`, `backend/app/interviews/websocket.py`

**Was:** Extracted résumé text was interpolated directly into the LLM system prompt. A crafted résumé could embed instructions that the model might follow (`"Ignore previous instructions…"`).

**Fix applied:** Two helpers in `agent.py` enforce a clean prompt boundary:
- `_sanitize_resume_text(text)` — strips C0/C1 control codes (except `\n`/`\t`), Unicode line/paragraph separators, and caps at `MAX_RESUME_PROMPT_CHARS = 8000` chars.
- `_sanitize_resume_obj(obj)` — recursively cleans every string value of a parsed-resume dict and caps each individual field at `MAX_RESUME_FIELD_CHARS = 1500` so one bloated field can't dominate the prompt budget.

Both `generate_question_plan()` and `decide_next_turn()` now run their resume input through these helpers, and `_build_resume_summary()` in the WebSocket handler also sanitizes before truncation (defense in depth). The system prompt remains the policy boundary — the sanitizer is just there to give it a stable, bounded input.

---

#### ~~Bug 9 — No invite resend mechanism~~ ✅ Fixed

**File:** `backend/app/invites/routes.py`

**Was:** If the original invitation email went to spam or the link expired, the creator had to create an entirely new invite (with new questions and a new token) just to nudge the candidate.

**Fix applied:** New `POST /invites/{invite_id}/resend` endpoint (creator-only, rate-limited at `10/hour`):
- 404 if the invite doesn't belong to the requesting creator
- 410 if the invite has been revoked
- Otherwise rotates `token`, resets `expires_at` to `now + INVITE_EXPIRY_HOURS`, and re-fires `send_invite_email` to every invitee on the invite (best-effort, per-invitee failures are logged and reported in the response)
- Returns the new `invite_url`, `expires_at`, plus the `sent_to` / `failures` lists so the creator's UI can show which addresses succeeded.

The old token stops working immediately — resend is "fresh link" semantics, not "send the same link again."

---

#### ~~Bug 10 — No email notification to creator when candidate completes~~ ✅ Fixed

**Files:** `backend/app/core/email.py`, `backend/app/interviews/websocket.py`, `backend/app/interviews/routes.py`

**Was:** When a candidate finished an invited interview, the creator had to manually refresh the dashboard to find out.

**Fix applied:**
- New `send_completion_notification_email()` in `app/core/email.py` (matches the existing branded HTML layout, surfaces the candidate's name + email, the role, the overall score, and a deep link to `/invites/{id}/results`).
- `_notify_creator_of_completion()` in `websocket.py` runs as the last step of the existing post-completion background task: it loads the invite + creator, skips if the candidate IS the creator (self-test sessions don't email the creator), and SMTP-sends best-effort.
- The HTTP `POST /sessions/{id}/end` route now also schedules the same background task on the actual `pending → completed` transition, so manual ends still notify.
- Idempotent: the background task no-ops if a `Report` row already exists, preventing duplicate emails when both the WS `finally` block and the HTTP end fire.

---

#### ~~Bug 11 — `invite_url` not displayed on the invites dashboard~~ ✅ Fixed

**File:** `frontend/src/pages/InvitesDashboardPage.tsx`

**Was:** `invite_url` was present in the `InviteSummary` API response but never rendered. Creators couldn't grab the link to share manually if email delivery failed.

**Fix applied:** New `COPY` button per row that calls `navigator.clipboard.writeText(inv.invite_url)` and emits a `sonner` toast. Grid now `grid-cols-[1fr_auto_auto_auto_auto_auto]` to fit the extra action between the lifecycle badge and `PARTICIPATE →`.

---

#### Bug 12 — Candidate has no upload path for résumé during invite flow

**File:** `frontend/src/pages/InviteLandingPage.tsx`

**Problem:** If a candidate invited for the first time has never used the system, they have no résumé on file. The invite landing page does not offer any way to upload one before starting. The interview proceeds without a résumé, which degrades question quality for `ai_generated` and `jd_based` modes.

**Fix needed:** After sign-in and before the "Start interview" button, check whether the user has any résumé on file. If not, show a lightweight upload step (or a "skip" option with a warning).

---

#### ~~Bug 13 — ScriptProcessorNode is deprecated~~ ✅ Fixed

**Files:** `frontend/public/pcm-worklet.js` (new), `frontend/src/hooks/useMicStream.ts`

**Was:** Mic capture used `ScriptProcessorNode` (deprecated everywhere; runs on the main thread).

**Fix applied:** New `pcm-worklet.js` `AudioWorkletProcessor` runs on the audio thread, downsamples to 16kHz mono Int16LE, and posts fixed-size 256-sample frames over `MessagePort`. `useMicStream.ts` loads it via `audioContext.audioWorklet.addModule('/pcm-worklet.js')` and wires up an `AudioWorkletNode`. The legacy `ScriptProcessorNode` path is kept as a fallback for environments that refuse to load the worklet (older Safari, `file://` origins). Wire format downstream is unchanged — the WS still receives 16kHz PCM Int16LE chunks.

---

### LOW

#### ~~Bug 14 — Candidate audio not recorded for replay~~ ✅ Fixed

**Files:** `backend/app/interviews/websocket.py`, `backend/app/reports/generator.py`, `backend/app/interviews/routes.py`

**Was:** `TranscriptPlayer` already expected `audio_url`, and `Turn.audio_key` already existed on the model — but no code path actually persisted candidate audio anywhere. The replay UI fell through to the "audio playback isn't available" branch on every report.

**Fix applied:**
- The WS handler now duplicates every inbound PCM frame into a per-turn `bytearray` accumulator (capped at ~12 MB / 6 min so a stuck-mic doesn't OOM the worker).
- On every real turn boundary (`next_question` / `ask_followup` / session end — nudges keep the same buffer so multi-utterance answers stay together), the buffer is snapshotted, cleared, and fired into a background `_save_turn_audio` task.
- That task encodes the raw int16 PCM into a WAV via `wave.open(..., "wb")` (16kHz, mono, 16-bit), uploads to MinIO at `audio/{user_id}/{session_id}/{turn_id}.wav` via `loop.run_in_executor`, and persists `Turn.audio_key`.
- `build_report_summary` now stores `audio_key` per turn (not a presigned URL — those expire), and `GET /sessions/{id}/report` re-signs each key into a fresh 1-hour `audio_url` on every fetch before returning.
- Best-effort throughout — a MinIO outage logs and skips, never crashing the interview.

---

#### ~~Bug 15 — Test coverage is critically thin~~ ⚠️ Improved (still partial)

**File:** `backend/tests/`

**Was:** Only 6 tests existed, covering scoring math and JWT crypto.

**Fix applied:** Added 5 new pure-unit test files (63 new tests, 69 total in suite — `pytest` reports `69 passed in 1.29s`):
- `test_resume_sanitizer.py` (12 tests) — control-char stripping, Unicode separator handling, length caps, recursive object cleaning (Bug 8 helpers).
- `test_invite_service.py` (11 tests) — token generation, expiry math, lifecycle validation, attempts-remaining math.
- `test_orchestrator_helpers.py` (23 tests) — `_wants_to_stop_interview` regex coverage, `_meaningful_word_count` filler-stripping, sanity-checks on `NUDGE_CAP` / `FOLLOWUP_CAP` / `FOCUS_VIOLATION_LIMIT`.
- `test_question_set_scrub.py` (8 tests) — bracketed-placeholder scrubber for invite question sets.
- `test_jwt_safety.py` (9 tests) — `assert_jwt_secret_is_safe()` blocks staging/production with placeholders or short secrets, warns-only in development.

Still pending (require DB / WebSocket fixtures): full route integration tests for `auth` / `sessions` / `invites`, and an E2E WebSocket protocol test. Those were intentionally scoped out of this batch; the unit tests above cover all the pure helper logic that was previously untested.

---

## Improvement Roadmap

Ordered by impact-to-effort ratio.

### Short-term (1–2 weeks each)

| # | Feature | Description |
|---|---|---|
| 1 | ~~**Copy invite link on dashboard**~~ ✅ | ~~Add clipboard button per invite row.~~ Done — `COPY` button per row in `InvitesDashboardPage`. |
| 2 | ~~**Resend invite email**~~ ✅ | ~~`POST /invites/{id}/resend` — regenerate token, reset expiry, re-fire email.~~ Done — see `resend_invite` in `invites/routes.py`. |
| 3 | ~~**Creator notification on completion**~~ ✅ | ~~Email creator when a candidate finishes.~~ Done — fires from the post-completion background task; idempotent across WS+HTTP completion paths. |
| 4 | ~~**Question progress indicator**~~ ✅ | ~~Show "Q{n} of {total}" in predefined mode.~~ Done — backend stamps `q_index` / `q_total` on every `ai_question` WS frame; `QuestionCard` renders `{n} OF {total}` next to the `Q{n}` marker (stable across follow-ups since they keep the same primary index). |
| 5 | ~~**Error Boundary + Sentry**~~ ✅ | ~~Prevents blank white screen on JS errors.~~ Done — Error Boundary in `frontend/src/components/ErrorBoundary.tsx`; `@sentry/react` wired in `main.tsx` (opt-in via `VITE_SENTRY_DSN`); backend `sentry-sdk[fastapi]` initialized in lifespan (opt-in via `SENTRY_DSN`). |
| 6 | ~~**Async report generation**~~ ✅ | ~~Move WeasyPrint out of the HTTP handler into a background task.~~ Done — `run_in_executor` + WS fire-and-forget background task. |
| 7 | ~~**Concurrent session guard**~~ ✅ | ~~Single DB query before `POST /sessions`.~~ Done — 409 guard on all three session-creation endpoints. |
| 8 | ~~**Startup check for `JWT_SECRET`**~~ ✅ | ~~One-line assert in `config.py`.~~ Done — `Settings.assert_jwt_secret_is_safe()` runs in lifespan; blocks `ENV != development` boots with placeholder secrets. |

### Medium-term (2–4 weeks each)

| # | Feature | Description |
|---|---|---|
| 9 | ~~**WebSocket reconnection via Redis**~~ ✅ | ~~Persist orchestrator state; resume mid-interview on reconnect.~~ Done — Redis state saved on every turn, restored on reconnect. |
| 10 | ~~**AudioWorklet migration**~~ ✅ | ~~Replace deprecated `ScriptProcessorNode`.~~ Done — `frontend/public/pcm-worklet.js` runs on the audio thread; `ScriptProcessorNode` kept as a fallback. |
| 11 | ~~**Rate limiting on core routes**~~ ✅ | ~~Protect LLM-backed endpoints from abuse.~~ Done — `slowapi` decorators on every cost-bearing route. |
| 12 | ~~**Score trend chart on dashboard**~~ ✅ | ~~Line chart of `overall_score` across sessions.~~ Done — `ScoreTrend` component renders an inline-SVG sparkline (no charting library) on `DashboardPage`; auto-hides when there are fewer than 2 scored sessions. |
| 13 | ~~**Full transcript export**~~ ✅ | ~~"Download transcript" button on the report page.~~ Done — `downloadTranscript()` in `ReportPage` builds a plain-text Q/A transcript from `summary.turns` and triggers a Blob download. |
| 14 | **Resume upload on invite landing page** | Optional upload step if candidate has no résumé on file. |
| 15 | ~~**Résumé prompt injection defense**~~ ✅ | ~~Character-limit + strip pass before LLM injection.~~ Done — `_sanitize_resume_text` / `_sanitize_resume_obj` in `interviews/agent.py`. |
| 16 | ~~**WS heartbeat / keepalive**~~ ✅ | ~~Server-side ping every 30s to defeat load-balancer idle timeouts.~~ Done — `heartbeat()` task pings every 30s under the existing send lock. |
| 17 | ~~**Test suite**~~ ⚠️ Partial | ~~Auth, sessions, invites, orchestrator unit tests.~~ 63 new pure-unit tests across sanitizer / invite service / orchestrator helpers / scrubber / JWT safety (69 total, all green). Route + WS integration tests still pending. |

### Long-term (1–3 months each)

| # | Feature | Description |
|---|---|---|
| 18 | **Question set library** | Save and reuse `QuestionSet` rows across invites. `QuestionSet` model exists — add a name field and library UI. |
| 19 | ~~**Candidate audio replay**~~ ✅ | ~~Store mic audio chunks in MinIO per turn; surface playback on report page.~~ Done — WS handler buffers PCM per turn, encodes WAV, uploads to MinIO; report endpoint presigns `audio_url` per turn. |
| 20 | ~~**Scheduled / future-dated invites**~~ ✅ | ~~Add `starts_at` to `InterviewInvite`; enforce at `/start`. Useful for assessment windows.~~ Done — nullable `starts_at` column added (migration 0008); `validate_invite()` returns 410 with human-readable time if window not yet open; `CreateInvitePage` has a datetime-local picker for scheduling. |
| 21 | **Team / organization accounts** | `Organization` model + `org_id` FK on invites. Multiple interviewers under one org. |
| 22 | **Webhook on interview completion** | `POST /webhooks` registration; fire signed payload to creator's URL on session end. Enables ATS integration. |
| 23 | **Completion email with PDF report** | Attach the generated PDF to the completion email sent to the candidate. |
| 24 | **Multi-language support** | Deepgram supports 30+ languages; surface a language selector on the invite creation form. |
| 25 | **CDN for MinIO assets** | Put CloudFront (or equivalent) in front of MinIO; use short-lived presigned URLs on private résumés. |
| 26 | ~~**Bulk invite via CSV**~~ ✅ | ~~Let creators upload a CSV of emails instead of typing them one by one.~~ Done — "Import from CSV" button on `CreateInvitePage` parses the first column as email addresses and merges them into the recipients textarea; header row auto-detected and skipped. |
| 27 | ~~**Structured logging + error tracking**~~ ✅ | ~~Replace plain `logging` with `structlog` (JSON output) + Sentry on both frontend and backend.~~ Done — `structlog` with stdlib bridge; JSON output in staging/prod, coloured console in development; `sentry-sdk[fastapi]` on backend + `@sentry/react` on frontend; both opt-in via env vars (`SENTRY_DSN` / `VITE_SENTRY_DSN`). |

---

## Strategic Roadmap — Path to Market-Ready SaaS

> Everything above this section is **tactical** — bug fixes, hardening, and small features that make the existing product more solid. This section is **strategic** — what it would take to evolve this from a strong functional prototype into a competitive agentic-AI SaaS that can actually win enterprise hiring deals.
>
> The structure below maps to the standard 9-layer reference architecture for production agentic systems (User → Orchestration → Agents → Tools → Memory → Monitoring → Reliability → Governance → Foundation). Each phase is sequenced so that earlier work compounds — skipping ahead (e.g. integrations before multi-agent depth) is the most common way these products end up commoditized.

### Architecture gap audit

A frank look at where the codebase sits today vs. where a production agentic-AI SaaS needs to be:

| Layer | Current state | Production gap |
|---|---|---|
| **User / Client** | React app with candidate + creator flows | Multi-tenant org/team UI, white-label theming, embeddable widget for career pages |
| **Orchestration** | Single `SessionOrchestrator` (per-session FSM) | Multi-agent control plane: planner, router, scheduler, policy enforcer |
| **Agents** | ~~One `agent.py` (a single LLM call per turn)~~ ✅ 6-agent fleet in `app/agents/` | ~~Specialized agents — Research, Question, Evaluation, Feedback, Verifier~~ **Shipped** — parallel async dispatch, 7-dim scoring, adaptive difficulty, skill graphs, cross-session memory, VerifierAgent, FeedbackAgent |
| **Tools & Integrations** | Internal-only HTTP/WebSocket | Public REST + Webhook API, ATS connectors, calendar, Slack/Teams |
| **Memory** | Per-turn DB rows + 3-hour Redis state | Short / long / episodic memory layers; cross-session vector recall; org-level memory |
| **Monitoring** | Plain `logging` + uvicorn output | OpenTelemetry traces, LLM-call observability, anomaly detection, eval suites |
| **Reliability** | Best-effort `try`/`except` blocks | SLOs + error budgets, circuit breakers, provider fallback, DLQ, idempotency keys |
| **Governance** | JWT + bcrypt + CORS + rate limits | RBAC, audit logs, data residency, SOC 2 / GDPR / HIPAA, BYOK, bias monitoring |
| **Foundation** | docker-compose + Postgres / Redis / MinIO | Managed services, Kubernetes, multi-region, CDN, cost dashboards |

The diagonal pattern is intentional — it's normal for a strong prototype. The goal of this roadmap is to walk it row by row, in order, without skipping rows.

---

### ~~Phase 1 — AI Intelligence Layer (the depth gap)~~ ✅ Complete

**This was the differentiation layer.** All six sub-items are now shipped. *(Details below for reference.)*

#### ~~1.1 True multi-agent system~~ ✅

Monolithic `agent.decide_next_turn()` replaced with a fleet of 6 specialized agents in `app/agents/`:

| Agent | File | Responsibility |
|---|---|---|
| **Planner** | `planner.py` | Wraps `generate_question_plan` + injects `research_hints` as priority probe areas |
| **Research Agent** | `researcher.py` | Queries past `session.skill_coverage` rows, surfaces weak skill IDs (avg < 5.0), calls LLM for `weak_areas` + `probe_topics` |
| **Question Agent** | `question.py` | Pure-Python difficulty calibration — appends scaffold hint (< 3) or no-scaffold note (> 7) to question text |
| **Evaluation Agent** | `evaluator.py` | 7-dim scoring: 5 LLM dims + 2 deterministic (confidence, keyword_coverage); runs in parallel with `decide_next_turn` via `asyncio.gather` |
| **Verifier Agent** | `verifier.py` | Fire-and-forget second-pass LLM judge after `speak()` returns; writes `verified_scores` + `verifier_flags` in its own `AsyncSessionLocal()` |
| **Feedback Agent** | `feedback.py` | Post-session coaching narrative (executive summary, strong/weak skills, recommendations); injected into PDF report |

#### ~~1.2 Advanced multi-dimensional scoring engine~~ ✅

7-dimension rubric (v2 schema), detected by presence of `"technical_depth"` key:

```jsonc
{
  "technical_depth":   8,   // LLM — EvaluatorAgent
  "problem_solving":   6,   // LLM — EvaluatorAgent
  "communication":     7,   // LLM — EvaluatorAgent
  "structure":         7,   // LLM — EvaluatorAgent
  "consistency":       6,   // LLM — EvaluatorAgent
  "confidence":        5,   // deterministic — filler-word ratio + length bonus
  "keyword_coverage":  6.2  // deterministic — skill graph keyword intersection
}
```

Weighted aggregation: `overall = LLM_avg × 0.8 + det_avg × 0.2`. Old 4-dim sessions → v1 path → equal-weight average (fully backward compatible). `schema_version` field in report summary distinguishes the two.

#### ~~1.3 Adaptive difficulty~~ ✅

Running `_current_difficulty` (starts at 5.0): +0.5 if avg score ≥ 7.0, −0.5 if ≤ 4.0, clamped to [1.0, 10.0]. Question text annotated at extremes via `calibrate_question_text()`. Curve persisted in `Session.difficulty_curve` (JSONB); visible in report summary.

#### ~~1.4 Skill graph evaluation~~ ✅

`skill_graphs/` package with JSON files for `backend_engineer` (10 skills), `frontend_engineer` (9), `data_scientist` (8), `product_manager` (8), `engineering_manager` (8), and `default` (5 generic). `Turn.skill_tags` (JSONB) records matched skill IDs per turn; `Session.skill_coverage` (JSONB) aggregates at session end. PDF report includes a Skill Coverage panel.

#### ~~1.5 Memory layer expansion~~ ✅ (cross-session weak-area tracking)

| Memory type | Status |
|---|---|
| **Short-term** (in-session context) | ✅ Redis orchestrator state |
| **Cross-session skill memory** | ✅ ResearchAgent reads `session.skill_coverage` from past N sessions, injects `weak_areas` into the plan |
| **Episodic** (timeline across sessions) | ⚠️ Partial — `ScoreTrend` + `difficulty_curve` per session |
| **Vector knowledge base** | ❌ Still pending (Phase 4 in sequencing plan) |

#### ~~1.6 LLM-as-judge with calibration~~ ✅ (VerifierAgent shipped)

VerifierAgent fires after every non-nudge turn, independently re-scores all 5 LLM dimensions, flags where `|original − verified| > 1.5`. Flagged dimensions stored in `Turn.verifier_flags`. Continuous calibration metric and human-review queue remain Phase 6 work.

---

### Phase 2 — Multi-tenancy & business primitives (the SaaS gap)

The current data model assumes **one user = one workspace**. To sell to teams (the only actually viable B2B motion for this product), the entire schema needs a tenancy boundary.

- **Organizations + teams + roles** — new `organizations`, `org_members`, `teams` tables; every `Session`, `InterviewInvite`, `Resume`, `Report`, `QuestionSet` gains an `org_id` FK; every query filters by `org_id`. Roles: `owner` / `admin` / `interviewer` / `reviewer` / `member` with an explicit permission matrix. SQLAlchemy event hooks to enforce `org_id` at the ORM layer (defence-in-depth — application bugs shouldn't leak across tenants).
- **Billing & subscriptions** — Stripe metered billing on minutes-per-completed-session; subscription tiers (`free` / `pro` / `team` / `enterprise`); seat-based pricing for team tier; invoice + receipt UX; webhook handlers for `customer.subscription.*` events.
- **Usage metering & quotas** — `usage_events` table (event type + tenant + cost + timestamp); enforce hard caps (free tier: 30 min/mo, etc.); soft alerts at 80%; per-tenant usage dashboard.
- **White-label / per-tenant theming** — tenant-level CSS variable overrides + logo upload; custom email sender domain (DKIM-signed); custom subdomain (`hiring.companyname.com`) with TLS via Let's Encrypt + ACME.
- **Per-tenant configuration** — custom rubric weights, custom question library, custom focus presets, branded email templates, custom interview duration ranges, custom skill graphs.
- **Tenant-scoped audit logs** — immutable `audit_events` log per tenant: who saw which candidate, who modified which rubric, when. Required for SOC 2 + GDPR.
- **Tenant deletion** — full cascade including MinIO objects + Redis keys + Stripe subscription cancellation. GDPR-mandatory.

---

### Phase 3 — Integrations & ecosystem (Tools layer)

The current product is a closed loop. To plug into existing recruiter workflows, where the actual hiring lives:

- **Public REST + Webhook API** — versioned `/api/v1/public` namespace with API keys per tenant (rotatable, scoped); webhooks fire on `session.started`, `session.completed`, `invite.accepted`, `report.ready`, with HMAC-signed payloads + automatic retries with exponential backoff + DLQ.
- **ATS connectors** — Greenhouse, Lever, Workday, Ashby. Pull candidate stage / push interview score into their pipeline. Most ATSs have stable REST APIs; one connector per quarter is a realistic cadence.
- **Calendar / scheduling** — Google Calendar + Outlook OAuth; let invitees self-schedule a window; push the interview invite as a calendar event with the link embedded; auto-cancel on revocation.
- **Slack / Teams bots** — drops `New candidate completed: 7.4/10 (Sarah K., Senior Backend)` cards into the hiring channel with a deep link; thread replies for collaborative review; reaction-based scoring overrides.
- **Embeddable widget** — JS snippet for company career pages: "Take a 10-min interview before you apply" → spawns a session, returns a verifiable score badge; conversion uplift on noisy applicant pools.
- **CSV bulk invite** (already in roadmap as item 26) — upgrade this to the marquee onboarding flow for hiring teams.
- **Public report URLs** with consent — candidate can share a verified score with hiring teams (anti-fraud: signed JWT in URL, view-tracking, optional one-time-view).
- **CLI / SDK** — `pip install rehearsal-sdk` + `npm i @rehearsal/sdk` for easy programmatic invite + result fetching; expands TAM into engineering-led hiring teams.

---

### Phase 4 — Memory & Knowledge layer

Today's pgvector index is populated at résumé upload but never read back. Make it load-bearing.

- **Cross-session retrieval** — at session start, pull the user's last N answers in the same role/skill cluster; Question Agent uses them as targeting hints (`"last time on system design, the candidate skipped redundancy — probe that"`).
- **Role / skill / framework knowledge base** — embed the canon (STAR, BAR, common system-design playbooks, role-specific competency rubrics, leveling guides from Big Tech). Evaluator Agent retrieves the relevant fragment as grounding before scoring.
- **Episodic timeline** — per-user "career rehearsal" view: every session as a node, score trends, skill graph progress over time. ([ScoreTrend](frontend/src/components/dashboard/ScoreTrend.tsx) is roughly the first 5% of this.)
- **Org-level memory** — for hiring teams: index every candidate's answers, search by skill (`"show me all candidates who answered well on distributed locks"`); compare candidates side-by-side on the same skill node.
- **PII-stripped vector index** — for the long-term store; reversible map kept tenant-side for re-identification on retrieval. Required for GDPR and for safely using third-party embedding providers.

---

### Phase 5 — Reliability & failure management

Production AI workloads fail in ways the current best-effort `try/except` blocks don't catch.

- **SLOs & error budgets** — explicit numerical targets:
  - 99.5% session-completion rate
  - p95 turn-latency ≤ 4s end-of-user-speech to start-of-AI-speech
  - 0% silent score loss (every completed turn must produce a persisted score)

  Burn-rate alerts at 2× and 5× expected error rate.
- **Circuit breakers per LLM provider** — open after N consecutive failures; route to fallback provider (Groq → OpenAI → cached degraded response). Today [llm_provider.py](backend/app/core/llm_provider.py) exposes only a single provider — needs a primary/secondary array with auto-failover on 5xx or timeout, plus per-provider latency + cost tracking.
- **Background job hardening** — Celery is set up in [workers/celery_app.py](backend/app/workers/celery_app.py) but never triggered from outside the workers package. Replace ad-hoc `asyncio.create_task` for report generation with Celery tasks: per-task retry budget, dead-letter queue, observability via Flower/Celery-exporter, separate worker pool for CPU-bound (WeasyPrint) vs IO-bound (LLM/SMTP) work.
- **Idempotency keys on every write endpoint** — `Idempotency-Key` header to defend against retried POSTs, especially for billing-relevant mutations and the new `POST /invites/{id}/resend`.
- **Disaster recovery** — point-in-time Postgres restore tested quarterly; MinIO → S3 versioning + cross-region replication; runbook for "lose entire region" scenario.
- **Graceful degradation** — when the LLM provider is fully down: serve `predefined` mode plans only (no LLM call needed at session start), surface a "limited mode" banner, queue full-rubric scoring for retry against the fallback provider when it returns.
- **Concurrency stress-test** — load test 100 concurrent WS sessions; verify Redis throughput, Postgres pool size, MinIO upload bandwidth; tune `pool_size` / `max_overflow` accordingly.

---

### Phase 6 — Monitoring, observability & ML Ops

The diagram's Monitoring layer is currently `print(...)` and uvicorn console output. Production needs:

- **OpenTelemetry distributed tracing** — span the full request: HTTP → orchestrator → STT → LLM → TTS → WS send. Critical for understanding p95 latency *which subsystem is the culprit*. Export to Tempo / Honeycomb / Datadog APM.
- **LLM-call observability** — Langfuse / Helicone / Phoenix: every prompt + response + token count + cost + latency + model, queryable. Enables prompt iteration on real production data — currently impossible because we have no record of historical LLM calls.
- **Structured logging** ✅ — `structlog` with stdlib bridge wired in; JSON output to stdout in staging/prod, coloured console in development. Ship to Datadog / Loki / CloudWatch via log shipper.
- **Sentry on both ends** ✅ — `sentry-sdk[fastapi]` on backend + `@sentry/react` on frontend; both opt-in via `SENTRY_DSN` / `VITE_SENTRY_DSN` env vars. Group by tenant once org support lands.
- **Custom business metrics** — TTFT (time to first token), TBT (time between turns), interview-completion rate, score distribution per role, average tokens per session, cost per completed interview. Per-tenant, per-role.
- **Eval datasets** — golden set of (answer, expected score) pairs; CI runs `decide_next_turn` against them on every PR; alert on regression. Without this, prompt tweaks ship blind.
- **Drift detection** — score distribution per role tracked weekly; alert when the mean drifts > 0.5 (model degradation, prompt regression, or population shift).
- **Anomaly detection** — sudden drop in completion rate, sudden spike in TTS latency → page oncall.
- **A/B testing infrastructure** — flag-gated prompt variants (LaunchDarkly / Unleash / homegrown); statistical comparison of outcomes (completion rate, candidate satisfaction).
- **Real-User Monitoring** — Datadog RUM / FullStory on the candidate-facing pages; identifies UX failure modes (mic-permission-denied, network hiccup) that backend logs miss.

---

### Phase 7 — Governance, security & compliance

Hiring data is sensitive (PII, often legally protected categories). To sell to enterprise:

- **SOC 2 Type II** — 6-month attestation cycle. Required for most enterprise sales > $50k. Vanta / Drata / Secureframe automates ~70% of the controls.
- **GDPR + CCPA compliance** — data export endpoint (`GET /me/export` returning a tar.gz of every session, transcript, audio file, score), data deletion endpoint with confirmed cascade across Postgres + MinIO + Redis + Stripe + LLM provider memory; DPA template; sub-processor disclosures.
- **HIPAA-ready posture** (for healthcare hiring) — BAA with cloud + LLM providers (OpenAI / Azure offer this; Groq does not as of Jan 2026 — affects provider selection for HIPAA tier).
- **Data residency** — EU-only deployment option (frontend + backend + DB + MinIO + LLM provider region all pinned to EU). Required for some EU enterprise procurement processes.
- **Audit logs** — every read of candidate data, every score override, every config change. Append-only, exportable, retained per regulatory minimum (typically 7 years).
- **Customer-managed keys (BYOK)** — enterprise tier: tenant-supplied KMS key encrypts résumés + answer audio at rest. Differentiator vs. competitors.
- **PII scrubbing on LLM call** — strip names, emails, phone numbers from prompts that hit external providers (reversible map kept tenant-side). The new `_sanitize_resume_obj` is the foundation; needs to expand into a full named-entity scrub.
- **Bias / fairness monitoring** — score distribution by inferred demographic proxies (résumé name origin, accent cluster, education tier); alert on statistically significant gaps; publish a fairness report quarterly. **Required by EEOC for any AI in hiring** in the US, and by the EU AI Act for high-risk AI systems.
- **Dependency security** — `pip-audit` + `npm audit` + Renovate / Dependabot in CI; SBOM published per release; signed container images.
- **Penetration testing** — annual third-party pen test; vulnerability disclosure program (HackerOne / `security.txt`).
- **Secret rotation** — automated rotation for `JWT_SECRET`, S3 keys, SMTP creds, LLM API keys (the new [config.py](backend/app/core/config.py) safety check is a starting point; rotation automation is the next step).
- **mTLS or signed-payload between services** — once the monolith decomposes (Phase 1 multi-agent split is the trigger).

---

### Phase 8 — Foundation / infrastructure maturation

The `docker-compose` stack is great for local dev; production needs more:

- **Managed services** — Postgres → RDS / Neon / Supabase; Redis → ElastiCache / Upstash; MinIO → S3 + CloudFront; SMTP → SendGrid / Postmark / SES.
- **Container registry + Kubernetes** — multi-replica backend with HPA on CPU + queue depth; rolling deploys; PDB for graceful drain on the WebSocket worker pool (long-lived connections need careful handling).
- **Multi-region** — at minimum US + EU; tenant region pinning; latency-based DNS for the static frontend; per-region database with logical replication for shared metadata.
- **CDN** — CloudFront / Fastly in front of MinIO for résumé downloads + audio playback; static frontend on edge.
- **CI/CD hardening** — every PR runs unit + route + E2E + lint + type + security scan; deploy on green main; canary releases (5% → 25% → 100%); automated rollback on error-rate spike or SLO burn.
- **Cost dashboards per tenant** — LLM tokens, STT minutes, TTS minutes, storage, egress — broken down per org. Critical for usage-based pricing and unit economics.
- **Backup / DR drill** — daily PITR Postgres backups + weekly cross-region snapshot; restore drill quarterly; runbook published.

---

### Phase 9 — Product polish, UX, and growth

The fundamentals are solid. To convert from "working product" to revenue:

- **Multi-language support** — Deepgram supports 30+ languages; ElevenLabs supports many; surface a language picker on invite creation; persist per-session; translate the frontend (`react-i18next`).
- **Closed captions during AI speech** — accessibility must-have for enterprise procurement; also a UX win in noisy environments.
- **Mobile-first interview room** — currently desktop-assumed; mobile candidates are 40%+ of the funnel.
- **Practice mode** — no scoring, unlimited; converts free → paid, produces eval data, lowers the barrier for first-time use.
- **Onboarding tutorial** — 60-second walkthrough on first session; the current Rules dialog is good but the candidate still doesn't know what's coming.
- **Re-record an answer** — current flow is one-shot; nervous candidates abandon. Allow ONE re-record per turn with a clear UI affordance.
- **AudioWorklet polish** — the worklet now runs but the visualization (Waveform component) still drives off the AnalyserNode; consider a single source of truth.
- **Pricing tiers** —
  - **Free**: 30 min/month, no invites, watermarked report
  - **Pro** ($20/mo): unlimited practice, full report download
  - **Team** ($200/mo): 10 seats, 100 invites/month, ATS + Slack
  - **Enterprise** (custom): white-label, BYOK, SSO, audit logs, dedicated CSM
- **Referral program** — invite a friend → both get 30 free minutes.
- **LinkedIn share badge** — `Practiced for Senior PM at Rehearsal — 8.2/10` as a verified shareable card. **Free user-acquisition channel that maps directly onto the audience.**
- **Coach marketplace** (longer-term) — pair AI session with a human review; revenue split with coaches.
- **Content / SEO** — `/learn/*` pages indexable by Google; "How to answer X" articles; mock-interview templates per role; targets the high-intent "interview prep" search corpus.
- **Candidate experience NPS** — post-session survey; track per role + per company; expose as a quality metric to hiring teams.

---

### Sequencing recommendation

Don't do all of this in parallel. A pragmatic 12-month sequence for a small (3–6 engineer) team:

| Quarter | Theme | Concrete deliverables |
|---|---|---|
| **Q1** | ~~**AI depth** (Phase 1)~~ ✅ | ~~Multi-agent split (Research / Question / Evaluator / Verifier / Feedback); multi-dim scoring engine with embeddings + prosody; adaptive difficulty; first eval dataset.~~ **Done** — 6-agent fleet shipped; 7-dim scoring (5 LLM + 2 deterministic); adaptive difficulty curve; per-role skill graphs; cross-session weak-area memory; VerifierAgent + FeedbackAgent. |
| **Q2** | **SaaS primitives** (Phase 2 + slice of 6) | Orgs / teams / RBAC; Stripe metered billing; per-tenant theming; Sentry + structured logs + LLM observability. First 5 paying customers. |
| **Q3** | **Reliability + compliance** (Phases 5 + 7) | OTel tracing; circuit breakers + provider fallback; SOC 2 Type I audit kickoff; GDPR delete/export; bias monitoring report v1. |
| **Q4** | **Integrations + growth** (Phases 3 + 9) | First ATS connector (Greenhouse); Slack bot; LinkedIn share badge; pricing-page launch; referral program; multi-language. |

Each phase compounds on the last. **The single most common mistake** in this space is building integrations before AI depth — you end up plugging a commodity AI into existing tools, which means competitors with deeper AI win the same deals once they ship the same integrations. Build the moat first; sell the moat second.

---

## Security Notes

### Current state (correct for local dev)

- JWT access (15 min) + refresh (7 days) — no cookies, CSRF-safe by design
- bcrypt password hashing — direct `bcrypt` library, cost factor 12
- 6-digit OTP — bcrypt-hashed in DB, 10-min expiry, max 5 attempts
- Google ID tokens verified server-side via `google-auth`
- Password reset tokens — single-use, hashed, 60-min expiry
- Pydantic validates every request body
- CORS locked to `CORS_ORIGINS` env var (default: localhost only)
- `slowapi` rate-limits all auth endpoints
- All secrets in `.env` (gitignored)

### Must fix before production

| Issue | Risk | Fix |
|---|---|---|
| `JWT_SECRET` defaults to `"change-me"` | Anyone can forge JWTs | Startup assertion + strong secret in deploy |
| No rate limiting on session/invite/resume | API cost abuse | `slowapi` on all LLM-backed routes |
| Résumé text injected raw into prompts | Prompt injection | Sanitize + length-cap extracted text |
| MinIO bucket publicly readable | Résumé privacy | Private bucket + presigned URLs |
| No Content Security Policy headers | XSS escalation | Add CSP middleware to FastAPI |
| CORS `CORS_ORIGINS` must be exact in production | Credential leakage | Set to `https://yourdomain.com` — no wildcards |

---

## Production Readiness Checklist

Use this before any public deployment.

### Infrastructure

- [ ] Postgres on managed service (RDS, Supabase, Neon) with automated backups
- [ ] Redis on managed service (ElastiCache, Upstash) with persistence enabled
- [ ] MinIO replaced by real S3 (or kept but behind CloudFront with private bucket)
- [ ] TLS termination at load balancer; all HTTP redirects to HTTPS
- [ ] WebSocket upgrade supported by load balancer (ALB sticky sessions or equivalent)
- [ ] Docker images built and pushed to a registry; no local `myenv` in production
- [ ] Secrets managed via AWS Secrets Manager / GCP Secret Manager / Vault — not `.env` files

### Application

- [ ] `JWT_SECRET` is a cryptographically random 256-bit string
- [ ] `CORS_ORIGINS` locked to production domain — no `localhost`
- [x] Rate limiting enabled on all LLM-backed endpoints
- [x] Report generation moved to background task (not blocking HTTP)
- [x] WebSocket reconnection logic implemented (Redis-backed orchestrator state)
- [x] Concurrent session guard in `POST /sessions`
- [x] Error Boundary wired up on frontend
- [x] Sentry SDK wired up — backend (`sentry-sdk[fastapi]` in lifespan, opt-in via `SENTRY_DSN`) + frontend (`@sentry/react` in `main.tsx`, opt-in via `VITE_SENTRY_DSN`)
- [x] Structured JSON logging (`structlog`) with stdlib bridge — JSON in staging/prod, console renderer in development
- [ ] Health check endpoint (`/health`) returns dependency status (DB, Redis, external APIs)

### Database

- [ ] `alembic upgrade head` is part of the deploy pipeline (not manual)
- [ ] Connection pool tuned: `pool_size`, `max_overflow`, `pool_pre_ping=True`
- [ ] Indexes verified on all high-frequency query columns (`user_id`, `session_id`, `invite_id`, `email`)
- [ ] DB user has minimal permissions (no superuser)

### Observability

- [x] Error tracking — Sentry on both frontend (`@sentry/react`) and backend (`sentry-sdk[fastapi]`), opt-in via env var
- [ ] Uptime monitoring with alerting
- [ ] LLM API cost dashboard / budget alerts (Groq / OpenAI console)
- [ ] Log aggregation (CloudWatch, Datadog, Loki)
- [ ] Key business metrics tracked: interview start rate, completion rate, average score, report generation time

### Security

- [ ] Content Security Policy headers on all responses
- [ ] Private S3/MinIO bucket — résumés accessed only via short-lived presigned URLs
- [x] Résumé text sanitized before LLM injection (strip control chars, cap length)
- [x] `JWT_SECRET` startup assertion added to `config.py`
- [ ] Dependency audit: `pip audit` + `npm audit` passing
- [ ] Google OAuth redirect URIs locked to production domain only

### Testing

- [ ] Route integration tests passing in CI
- [ ] WebSocket protocol tests passing in CI
- [ ] E2E smoke test: sign up → upload résumé → start interview → answer Q1 → end → view report
- [ ] Load test: 10 concurrent WebSocket sessions to verify worker pool / Redis throughput

---

## License

MIT
