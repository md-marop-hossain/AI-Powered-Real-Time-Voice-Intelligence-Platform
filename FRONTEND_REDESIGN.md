# Frontend Redesign Brief — AI Mock Interview System

> Hand this to Claude Code. The functional code already works. This brief is **only about design, polish, components, and copy**. Do not change backend behavior or API contracts.

---

## 1. The Problem with the Current Design

The current frontend works but feels generic — typical Tailwind + shadcn defaults, predictable layout, neutral palette, no personality. Mock interviewing is a **high-stakes, high-emotion product**: users are nervous, judged by an AI, racing a clock. The UI has to feel like a calm, premium coach — not a SaaS dashboard.

We are redesigning the entire frontend with a single, cohesive aesthetic point of view.

---

## 2. Aesthetic Direction — "Calm Studio"

Pick **one** clear direction and execute it with precision. We are choosing:

> **Editorial × Studio.** Think *the recording booth at NPR meets a serif-driven literary magazine.* Quiet confidence. Generous whitespace. Strong typographic hierarchy. Warm neutrals with one electric accent. Subtle, deliberate motion. The product should feel like a private rehearsal room, not a stage.

**What this is NOT:**
- ❌ Purple gradients on white
- ❌ Glassmorphism / frosted everything
- ❌ Neon cyberpunk "AI" tropes (matrix rain, glowing circuits, robot avatars)
- ❌ Generic shadcn cards stacked vertically
- ❌ Inter / Roboto / system-ui anywhere

**What this IS:**
- ✅ Strong serif display + clean grotesk body
- ✅ Warm off-white canvas with deep ink and one electric accent
- ✅ Asymmetric layouts, oversized numerals, editorial pull-quotes
- ✅ Motion that feels like turning a page, not bouncing a button
- ✅ Generous, intentional whitespace

---

## 3. Design Tokens (replace existing Tailwind theme)

Add these to `tailwind.config.js` and a global CSS file. Use CSS variables so a future dark mode is trivial.

### 3.1 Color
```css
:root {
  /* Canvas — warm off-white, never pure #fff */
  --canvas: #F5F1EA;
  --canvas-elevated: #FBF8F2;
  --canvas-sunken: #ECE6DB;

  /* Ink — deep warm black, never pure #000 */
  --ink: #1A1814;
  --ink-soft: #4A453C;
  --ink-muted: #8A8478;

  /* Accent — single electric color, used sparingly */
  --accent: #E8472C;        /* vermillion */
  --accent-hover: #C93A22;

  /* Signal colors */
  --success: #2F6F4F;
  --warning: #B8860B;
  --error: #A02B1F;

  /* Borders & dividers */
  --rule: #1A18141A;        /* 10% ink */
  --rule-strong: #1A181433;
}
```

### 3.2 Typography
Install via `@fontsource` packages — no Google Fonts CDN.

| Role | Font | Usage |
|---|---|---|
| Display | **Fraunces** (variable) | Headlines, big numerals, hero text |
| Body | **Söhne** (paid) OR **Geist** OR **Inter Tight** | Body, UI labels, buttons |
| Mono | **JetBrains Mono** | Timer, transcript timestamps, code-like data |

If a paid font is unavailable, fall back to **Geist Sans** for body — never default Inter.

```css
.font-display { font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'opsz' 144, 'SOFT' 20; }
.font-body { font-family: 'Geist', system-ui, sans-serif; }
.font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
```

**Type scale** (use these, not Tailwind defaults):
- `text-hero` — clamp(3.5rem, 8vw, 7rem), Fraunces, weight 400, tracking -0.04em, leading 0.95
- `text-display` — clamp(2.25rem, 4vw, 3.5rem), Fraunces, weight 400
- `text-h1` — 2rem, Fraunces, weight 500
- `text-h2` — 1.5rem, Fraunces, weight 500
- `text-body` — 1.0625rem (17px), Geist, weight 400, leading 1.6
- `text-small` — 0.875rem, Geist, weight 400
- `text-eyebrow` — 0.75rem, Geist, weight 500, tracking 0.18em, uppercase

### 3.3 Spacing & Layout
- 12-column grid with **80px outer gutter on desktop**, 24px on mobile
- Section vertical rhythm: 120px desktop / 64px mobile
- Border radius: **2px** for buttons/inputs, **0px** for cards (we use rules, not rounded boxes)
- Shadows: **almost none.** Use horizontal rules (`border-b border-[--rule]`) instead

### 3.4 Motion
Use **Motion (Framer Motion)** — already installed. Custom easing only:
```ts
export const easeEditorial = [0.22, 1, 0.36, 1]; // slow-out, page-turn feel
export const durations = { quick: 0.2, base: 0.4, slow: 0.7 };
```
- No bouncy springs
- No scale-on-hover bloat
- Stagger children by 60–80ms on page entry
- Underline-grow on links, never color flash

---

## 4. New / Reworked Components

### 4.1 `EditorialHeader`
Replace the existing top nav.

- Left: wordmark **"Rehearsal"** (project codename — change to your brand) in Fraunces, 22px, weight 500
- Center: nothing (resist the urge)
- Right: nav links in `text-eyebrow` style — `Practice`, `History`, `Account`
- A 1px `--rule` border at the bottom of the header, full width
- Sticky on scroll with a subtle `backdrop-filter: blur(8px)` and `--canvas/85` background

### 4.2 `Hero` (landing/auth split-screen)
For the login & signup pages, ditch the centered card. Use a **two-column split**:

- **Left column (60% width):** editorial copy
  - Eyebrow: `EST. 2026 — A REHEARSAL ROOM FOR INTERVIEWS`
  - Hero text: *"Practice the conversation that changes everything."*
  - Sub: *"An AI interviewer that reads your résumé, listens to your answers, and asks the follow-ups a hiring manager actually would."*
  - One thin vermillion underline accent under a single word in the hero
- **Right column (40%):** the auth form, no card chrome — just inputs sitting on the canvas, separated by hairline rules. Field labels in `text-eyebrow` above each input.

### 4.3 `ResumeUpload` — make this a moment
This is the user's first real interaction. Don't waste it on a dotted-border box.

- Full-bleed dropzone with **zero border** by default
- A dashed `--rule-strong` rectangle appears only on drag-over, with the entire canvas darkening 4%
- Centered serif headline: *"Drop your résumé."* — sub: *"PDF or DOCX, up to 5 MB."*
- Small annotation in mono on the side: `01 / 03 — UPLOAD` (we're going to number every step in the journey, editorial-style)
- After upload: **animated parsing card** showing extracted fields one by one, typewriter-revealing — Name → Role → Years → Skills → Projects. Each row separated by hairline rules. This makes parsing feel deliberate and impressive instead of a spinner.

### 4.4 `InterviewRoom` — the core screen, full redesign
This is the most important screen. It should feel like a recording booth.

**Layout:** three-zone vertical composition, no cards.

```
┌───────────────────────────────────────────────────┐
│ EYEBROW: SESSION 042 — SOFTWARE ENGINEER MOCK     │
│                                                   │
│        [oversized timer in mono, 96px]            │
│              22:41                                │
│         ─────  remaining  ─────                   │
│                                                   │
├───────────────────────────────────────────────────┤
│                                                   │
│   Q3.  "Tell me about a time you shipped         │ ← Fraunces 40px,
│        something with an unrealistic deadline."   │   weight 400,
│                                                   │   left-aligned,
│        ─ asked by Rehearsal · 0:08                │   max-width 720px
│                                                   │
├───────────────────────────────────────────────────┤
│                                                   │
│        [horizontal waveform, full width]          │
│        ▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃▁                  │
│                                                   │
│        ●  RECORDING                               │
│                                                   │
│        Live transcript appears here, italicized,  │
│        in a dimmed ink color, growing as you      │
│        speak…                                     │
│                                                   │
└───────────────────────────────────────────────────┘
              [End session]      [Skip question]
```

**Specs:**
- **Timer:** JetBrains Mono, 96px, weight 300, with the colon blinking at 1Hz (CSS animation). When under 2 minutes, the digits shift to vermillion **gradually** (color transition over 30 seconds, not instant). Under 30 seconds, a thin vermillion line draws across the screen above the timer.
- **Question display:** number it (`Q3.`) in mono small caps as a marker, then the question in 40px Fraunces. After the AI finishes speaking, fade in a small annotation: `— asked by Rehearsal · 0:08` showing how long it took to ask.
- **Waveform:** real-time canvas-based, NOT 5 dancing bars. Use Web Audio API's analyser node to render a **horizontal scrolling waveform** that captures the last 8 seconds. Color: `--ink` when speaking, `--ink-muted` during silence.
- **Live transcript:** appears **below** the waveform in italic Fraunces 18px, dim color (`--ink-muted`). Final transcript becomes upright body text in `--ink` once Deepgram finalizes.
- **Buttons:** text-only with underline on hover. No filled buttons in this view. End session uses `--accent` text color.

**AI speaking state:** when the AI is talking, the entire bottom zone (waveform area) is replaced by a single centered vertical `--ink` line that pulses subtly with the TTS audio amplitude. Less is more.

### 4.5 `ReportView` — turn this into an editorial spread
The post-interview report should feel like a magazine feature, not a dashboard.

- **Cover section:** full viewport height
  - Eyebrow: `SESSION REPORT — APRIL 27, 2026`
  - Massive aggregate score in Fraunces, 200px (e.g. **`8.2`**)
  - Below: `out of 10 — strong performance` in body text
  - One pull-quote from the AI's overall assessment, centered, italic Fraunces, max 600px wide
- **Score breakdown:** four metrics (clarity, depth, correctness, communication) shown as **horizontal bars** with the value as a large numeral on the left and a thin `--ink` bar filling to the right. No pie charts. No radar charts. Just numerals and lines.
- **Per-question section:** each question rendered as a small editorial article:
  ```
  Q1.
  ─────────────────────────────────────────
  "Walk me through your role at Acme Corp."

  Your answer:
  [transcript in body type, full prose, no truncation]

  Feedback:
  [AI's per-question feedback in italic Fraunces, indented]

  Score: 8.5
  ─────────────────────────────────────────
  ```
- **Strengths / Improvements:** two columns, each a list of 3–5 bullet points. Bullets are em-dashes (`—`), not dots.
- **Action footer:** *Download as PDF* · *Practice again* · *Share with a coach* — all text links, no buttons.

### 4.6 `Dashboard` (history) — the index
Render past sessions as an **editorial table of contents**, not a card grid:

```
SESSIONS                                    APR 2026

042   Software Engineer · Senior            8.2  →
041   Product Manager · Mid                 7.4  →
040   Software Engineer · Senior            6.8  →
                                            
                                       [Show 2025 →]
```

- Mono numerals on left, role/seniority in body, score on right in Fraunces
- Hairline rule between each row
- Hover state: row background shifts to `--canvas-elevated`, score becomes vermillion, arrow translates 8px right
- Group by month with a small eyebrow header

### 4.7 `CountdownTimer` (extracted reusable component)
Already covered in InterviewRoom but worth calling out as a standalone primitive:
- Variants: `lg` (96px, used in InterviewRoom) and `sm` (24px, used in header during session)
- Always JetBrains Mono, never serif
- Color transitions, not abrupt changes
- Pulsing colon

### 4.8 Loading & empty states
- Loading: a single centered horizontal line that **draws across** from left to right (200ms), then erases right to left, looping. No spinners.
- Empty state for "no past sessions": a full-page editorial slug — *"You haven't rehearsed yet."* with a single text link below: *Begin your first session →*

---

## 5. Microcopy — Replace All UI Text

The current copy is generic SaaS. Rewrite it. Voice should be: **calm, literary, second-person, slightly formal, never cute.**

### 5.1 Auth
- Login button: ~~Sign in~~ → **Enter the room**
- Signup button: ~~Create account~~ → **Begin rehearsing**
- Google button: ~~Sign in with Google~~ → **Continue with Google**
- Forgot password link: ~~Forgot password?~~ → **I've forgotten my password**
- Password reset email subject: *"A way back into Rehearsal"*

### 5.2 Resume upload
- Heading: **Drop your résumé.**
- Sub: *PDF or DOCX, up to 5 MB.*
- Parsing state: *Reading carefully…* (NOT "Processing..." or "Loading...")
- Done state: *Found you. Ready when you are.*

### 5.3 Pre-interview screen
- Heading: **One question before we begin.**
- Sub: *Choose the role you're rehearsing for.*
- Start button: **I'm ready.**

### 5.4 During interview
- AI thinking state (between turns): *Considering your answer…*
- Mic muted warning: *Your microphone is silent. We can't hear you.*
- Connection lost: *We've lost the line. Reconnecting…*
- Time warning at 5 min: *Five minutes remaining.* (toast, bottom-left, no icon)
- Time warning at 1 min: **One minute.** (top banner, vermillion)

### 5.5 Post-interview
- Heading: **That was a good rehearsal.** (or "That was a difficult one." if score < 6)
- Sub varies by score band — write three variants

### 5.6 Empty / error states
- 404: *"This page is somewhere else."*
- Generic error: *"Something interrupted us. We're looking into it."*
- Network error: *"You appear to be offline."*

---

## 6. Components to ADD (don't currently exist)

### 6.1 `<SessionPreflightCheck />` — runs before InterviewRoom
A 3-step inline check, each becoming a green checkmark when passed:
1. Microphone access granted
2. Connection to interview server established
3. Voice clarity test (record 3 seconds, play it back, ask: *Did that sound like you?*)

This dramatically reduces "my mic wasn't working" complaints and feels professional.

### 6.2 `<KeyboardShortcuts />` modal
Bound to `?`. Shows:
- `Space` — pause/resume answer
- `Esc` — end session
- `→` — skip current question
- `?` — show this dialog

Power users love this. Costs almost nothing to build. Renders as a centered editorial panel, not a shadcn dialog.

### 6.3 `<TranscriptPlayer />` on the report page
Lets the user replay any answer with audio + scrolling transcript highlight. Use the stored S3/MinIO audio URL. A horizontal scrub bar in mono with current time / total time.

### 6.4 `<PracticeAgainButton />`
On the report page, offers three follow-up paths:
- *Same role, harder questions*
- *Same résumé, different role*
- *Drill the questions you struggled with*

Each is a text link, not a button. Each kicks off a pre-configured new session.

### 6.5 `<ResumeFootnote />`
On the InterviewRoom screen, a small collapsible reveal in the bottom-right showing what the AI sees from your résumé for the current question. Builds trust and explains why a question was asked. Closed by default. Opens with a small `—  why this question?` link.

---

## 7. Accessibility — Don't Skip This

- All interactive elements reachable by keyboard with visible focus rings (a 2px `--ink` outline with 2px offset)
- WCAG AA contrast on all text (`--ink` on `--canvas` clears 13:1; `--ink-muted` on `--canvas` should be checked — adjust if needed)
- Live transcript marked `aria-live="polite"` so screen readers announce new content
- Timer announces every minute via `aria-live="polite"`
- Captions toggle for AI speech (uses the question text + a synced TTS marker)
- `prefers-reduced-motion` disables all entrance animations and the timer color transition (but keeps the timer functional)

---

## 8. File / Folder Changes

```
frontend/src/
├── styles/
│   ├── tokens.css          # ← new: all CSS variables
│   ├── typography.css      # ← new: font-face declarations + classes
│   └── globals.css         # ← rewrite: imports tokens, sets canvas bg
├── components/
│   ├── editorial/          # ← new namespace for redesigned primitives
│   │   ├── EditorialHeader.tsx
│   │   ├── Eyebrow.tsx
│   │   ├── PullQuote.tsx
│   │   ├── HairlineDivider.tsx
│   │   ├── NumberedMarker.tsx     // "Q3." or "01 / 03"
│   │   └── EditorialButton.tsx    // text + underline only
│   ├── interview/
│   │   ├── CountdownTimer.tsx     // rebuilt, two sizes
│   │   ├── Waveform.tsx           // canvas-based, scrolling
│   │   ├── LiveTranscript.tsx
│   │   ├── AISpeakingIndicator.tsx
│   │   ├── SessionPreflightCheck.tsx   // ← new
│   │   ├── KeyboardShortcuts.tsx       // ← new
│   │   └── ResumeFootnote.tsx          // ← new
│   ├── report/
│   │   ├── ScoreCover.tsx
│   │   ├── ScoreBars.tsx
│   │   ├── PerQuestionArticle.tsx
│   │   ├── TranscriptPlayer.tsx        // ← new
│   │   └── PracticeAgainButton.tsx     // ← new
│   └── … (keep existing shadcn primitives only where genuinely useful — Dialog, Popover, Toast)
└── pages/ … (update to use new components)
```

Where shadcn defaults conflict (e.g., rounded buttons, neutral palette), override at the component level. Don't fight the design tokens.

---

## 9. What to Test After the Redesign

1. **Visual regression:** screenshot every page on desktop (1440px) and mobile (390px) and review side by side
2. **Keyboard navigation:** tab through every screen — focus rings visible everywhere
3. **`prefers-reduced-motion`:** toggle in DevTools, confirm animations disable cleanly
4. **Real interview flow:** complete an end-to-end session — does the timer feel right? Is the waveform alive? Does the report feel like a magazine?
5. **Copy review:** every string the user sees should sound like one writer wrote it

---

## 10. Non-Negotiables (please don't drift)

1. **No purple gradients.** None.
2. **No glassmorphism / frosted blur on cards.** Backdrop blur is allowed on the sticky header only.
3. **No emoji in product UI.**
4. **No rounded-2xl cards.** Cards barely exist; rules separate content.
5. **No Inter / Roboto / system-ui as the body font.** Use Geist or similar.
6. **No bouncy spring animations.** Custom editorial easing only.
7. **No icon-stuffed buttons.** Text + occasional arrow (`→`). That's it.
8. **No "AI" robot iconography.** This product is a coach, not a chatbot.

---

## 11. Reference Mood (verbal, since I can't paste images)

If you're reaching for a mental reference while building, think:
- *The Browser Company's Arc* (typography, restraint)
- *Linear's docs site* (rules, hierarchy, calm)
- *The New York Times print edition* (numerals, eyebrows, drop caps)
- *Are.na* (warm canvas, generous whitespace, editorial rhythm)
- *Readymag editorial templates* (asymmetry, pull quotes, oversized type)

Avoid:
- Stripe / Vercel marketing pages (too tech-saas-shiny)
- Anything with a 3D blob or gradient orb
- Most "AI startup" landing pages from 2023–2025

---

## 12. Definition of Done

The redesign is done when:
- [ ] Every page has been rebuilt against the new tokens
- [ ] No raw shadcn defaults are visible (buttons, cards, dialogs all restyled or replaced)
- [ ] Fonts load without FOUT (use `font-display: swap` and preload)
- [ ] Every microcopy string has been reviewed against Section 5
- [ ] Keyboard, screen reader, and reduced-motion paths all work
- [ ] A first-time user can complete the full flow and feel like they used something **memorable**, not familiar

---

> Build this with conviction. The current design is fine. We want unforgettable.
