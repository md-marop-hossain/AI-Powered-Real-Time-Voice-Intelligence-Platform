import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";

import { useAuthStore } from "@/store/auth";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { NumberedMarker } from "@/components/editorial/NumberedMarker";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { ThemeToggle } from "@/components/editorial/ThemeToggle";
import { VermillionUnderline } from "@/components/editorial/AuthSplit";
import { easeEditorial, durations } from "@/lib/motion";
import { cn } from "@/lib/utils";

const LOOP_QUESTIONS: string[] = [
  "Walk me through a system you've shipped end-to-end. What broke first, and what did you change?",
  "Tell me about a disagreement with a senior engineer. How did the conversation go?",
  "Design a real-time chat for ten million concurrent users. Where do you start?",
];

const DIMENSIONS = ["Clarity", "Depth", "Correctness", "Communication"] as const;

export default function LandingPage() {
  const isAuthed = useAuthStore((s) => Boolean(s.accessToken));

  return (
    <div className="min-h-screen bg-canvas">
      <LandingHeader isAuthed={isAuthed} />
      <main>
        <Hero isAuthed={isAuthed} />
        <Marquee />
        <ThreeStep />
        <SampleInteraction />
        <SpecStrip />
        <PullQuoteSection />
        <FinalCta isAuthed={isAuthed} />
      </main>
      <LandingFooter />
    </div>
  );
}

/* ---------- Header ---------- */

function LandingHeader({ isAuthed }: { isAuthed: boolean }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full",
        "bg-canvas/85 backdrop-blur-[8px]",
        "border-b border-rule",
      )}
    >
      <div className="editorial-container flex h-16 items-center justify-between">
        <Link
          to="/"
          className="font-display text-[22px] font-medium tracking-tight text-ink"
          style={{ fontVariationSettings: '"opsz" 36' }}
        >
          Rehearsal
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-8">
          <a href="#how-it-works" className="hidden md:inline editorial-link is-quiet text-ink-muted hover:text-ink">
            <Eyebrow as="span">How it works</Eyebrow>
          </a>
          <a href="#sample" className="hidden md:inline editorial-link is-quiet text-ink-muted hover:text-ink">
            <Eyebrow as="span">A sample</Eyebrow>
          </a>
          {isAuthed ? (
            <Link to="/dashboard" className="editorial-link is-quiet text-ink hover:text-ink">
              <Eyebrow as="span">Open dashboard →</Eyebrow>
            </Link>
          ) : (
            <>
              <Link to="/login" className="editorial-link is-quiet text-ink-muted hover:text-ink">
                <Eyebrow as="span">Sign in</Eyebrow>
              </Link>
              <Link
                to="/signup"
                className="editorial-link text-ink hover:text-accent"
              >
                <Eyebrow as="span">Begin →</Eyebrow>
              </Link>
            </>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

/* ---------- Hero ---------- */

function Hero({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section className="editorial-container flex min-h-[calc(100vh-4rem)] flex-col justify-center py-16">
      <div className="grid gap-16 md:grid-cols-[1.1fr_1fr] md:items-center">
        <motion.div
          initial="initial"
          animate="animate"
          transition={{ staggerChildren: 0.08, delayChildren: 0.05 }}
        >
          <motion.div
            variants={{
              initial: { opacity: 0, y: 16 },
              animate: { opacity: 1, y: 0, transition: { duration: durations.base, ease: easeEditorial } },
            }}
          >
            <Eyebrow>EST. 2026 — A REHEARSAL ROOM FOR INTERVIEWS</Eyebrow>
          </motion.div>

          <motion.h1
            variants={{
              initial: { opacity: 0, y: 24 },
              animate: { opacity: 1, y: 0, transition: { duration: durations.slow, ease: easeEditorial } },
            }}
            className="mt-8 text-hero text-ink"
          >
            Speak up.<br />
            <VermillionUnderline>Get the offer.</VermillionUnderline>
          </motion.h1>

          <motion.p
            variants={{
              initial: { opacity: 0, y: 16 },
              animate: { opacity: 1, y: 0, transition: { duration: durations.base, ease: easeEditorial } },
            }}
            className="mt-10 max-w-prose text-body text-ink-soft"
          >
            An AI interviewer that reads your résumé, hears every pause, and asks
            the follow-ups a real hiring manager would. No typing. No
            multiple-choice. Just a voice across the table — and a scored report
            you can study.
          </motion.p>

          <motion.div
            variants={{
              initial: { opacity: 0, y: 12 },
              animate: { opacity: 1, y: 0, transition: { duration: durations.base, ease: easeEditorial } },
            }}
            className="mt-12 flex flex-wrap items-center gap-8"
          >
            <Link to={isAuthed ? "/upload" : "/signup"}>
              <EditorialButton filled arrow>
                {isAuthed ? "BEGIN A NEW SESSION" : "BEGIN REHEARSING"}
              </EditorialButton>
            </Link>
            <a href="#sample" className="editorial-link text-ink">
              <Eyebrow as="span">See a sample turn ↓</Eyebrow>
            </a>
          </motion.div>

          <motion.div
            variants={{
              initial: { opacity: 0 },
              animate: { opacity: 1, transition: { duration: durations.slow, ease: easeEditorial, delay: 0.2 } },
            }}
            className="mt-16 flex flex-wrap items-baseline gap-x-10 gap-y-3 font-mono text-eyebrow text-ink-muted"
          >
            <span>VOICE-FIRST</span>
            <span className="text-rule-strong">·</span>
            <span>RÉSUMÉ-AWARE</span>
            <span className="text-rule-strong">·</span>
            <span>SCORED ON 4 DIMENSIONS</span>
          </motion.div>
        </motion.div>

        <LiveRehearsalPanel />
      </div>
    </section>
  );
}

/* ---------- Live Rehearsal Panel (the wow) ---------- */

type LoopPhase = "asking" | "listening" | "analyzing" | "scoring" | "rest";

function LiveRehearsalPanel() {
  const reduce = useReducedMotion();
  const [questionIndex, setQuestionIndex] = useState(0);
  const [phase, setPhase] = useState<LoopPhase>("asking");
  const [typed, setTyped] = useState("");
  const [interim, setInterim] = useState("");
  const [scores, setScores] = useState<number[]>([0, 0, 0, 0]);
  const [seconds, setSeconds] = useState(20 * 60); // 20:00 mock timer
  const phaseRef = useRef<LoopPhase>("asking");
  phaseRef.current = phase;

  const question = LOOP_QUESTIONS[questionIndex % LOOP_QUESTIONS.length];

  // Mock countdown timer — purely cosmetic.
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setSeconds((s) => (s <= 0 ? 20 * 60 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [reduce]);

  // Loop: type the question, simulate listening, analyze, score, rest, repeat.
  useEffect(() => {
    if (reduce) {
      setTyped(question);
      setInterim(SAMPLE_ANSWER);
      setScores([8.4, 7.9, 8.7, 8.2]);
      setPhase("scoring");
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const sleep = (ms: number) =>
      new Promise<void>((res) => {
        const t = setTimeout(() => res(), ms);
        timers.push(t);
      });

    const run = async () => {
      while (!cancelled) {
        // ---- ASKING ----
        setPhase("asking");
        setTyped("");
        setInterim("");
        setScores([0, 0, 0, 0]);

        // Type the question one character at a time.
        for (let i = 1; i <= question.length; i++) {
          if (cancelled) return;
          setTyped(question.slice(0, i));
          await sleep(22);
        }
        await sleep(700);

        // ---- LISTENING ----
        setPhase("listening");
        const tokens = SAMPLE_ANSWER.split(" ");
        for (let i = 1; i <= tokens.length; i++) {
          if (cancelled) return;
          setInterim(tokens.slice(0, i).join(" "));
          await sleep(85);
        }
        await sleep(500);

        // ---- ANALYZING ----
        setPhase("analyzing");
        await sleep(1100);

        // ---- SCORING ----
        setPhase("scoring");
        const targets = SAMPLE_SCORES[questionIndex % SAMPLE_SCORES.length];
        for (let i = 0; i < DIMENSIONS.length; i++) {
          if (cancelled) return;
          const target = targets[i];
          for (let n = 0; n <= 30; n++) {
            if (cancelled) return;
            const v = Math.min(target, (target * n) / 30);
            setScores((prev) => {
              const next = prev.slice();
              next[i] = +v.toFixed(1);
              return next;
            });
            await sleep(14);
          }
          setScores((prev) => {
            const next = prev.slice();
            next[i] = target;
            return next;
          });
          await sleep(120);
        }

        // ---- REST then advance ----
        setPhase("rest");
        await sleep(1800);
        if (cancelled) return;
        setQuestionIndex((q) => q + 1);
      }
    };

    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [questionIndex, question, reduce]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durations.slow, ease: easeEditorial, delay: 0.2 }}
      className="relative"
    >
      {/* Outer card */}
      <div className="relative border border-rule-strong bg-canvas-elevated p-6 md:p-10">
        {/* Top status row */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                phase === "listening" ? "bg-accent" : "bg-ink-muted",
                phase === "listening" && "animate-pulse",
              )}
              aria-hidden="true"
            />
            <Eyebrow>{phaseLabel(phase)}</Eyebrow>
          </div>
          <span className="font-mono text-eyebrow tabular-nums text-ink">
            {formatTime(seconds)}
          </span>
        </div>

        {/* Speaking indicator + question */}
        <section>
          <div className="mb-4 flex items-end gap-2 h-6">
            <SpeakingBars active={phase === "asking"} />
            <Eyebrow className="ml-3 text-ink-muted">INTERVIEWER</Eyebrow>
          </div>
          <p className="min-h-[6rem] font-display text-[1.4rem] leading-snug text-ink md:text-[1.6rem]">
            {typed}
            {phase === "asking" && (
              <span aria-hidden="true" className="ml-1 inline-block w-[3px] h-[1em] -mb-1 bg-ink animate-pulse" />
            )}
          </p>
        </section>

        <HairlineDivider className="my-8" />

        {/* Waveform + interim transcript */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <Eyebrow className="text-ink-muted">YOU</Eyebrow>
            <Waveform active={phase === "listening"} />
          </div>
          <p className="min-h-[5.5rem] text-body text-ink-soft">
            {phase === "listening" || phase === "analyzing" || phase === "scoring" || phase === "rest" ? (
              <>
                {interim}
                {phase === "listening" && (
                  <span className="ml-1 inline-block w-[3px] h-[1em] -mb-1 align-middle bg-ink-muted animate-pulse" aria-hidden="true" />
                )}
              </>
            ) : (
              <span className="italic text-ink-muted">Waiting for the question…</span>
            )}
          </p>
        </section>

        <HairlineDivider className="my-8" />

        {/* Scores */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <Eyebrow>SCORE</Eyebrow>
            <span className="font-mono text-eyebrow text-ink-muted">
              {phase === "analyzing" ? "ANALYSING…" : phase === "scoring" || phase === "rest" ? "READY" : "—"}
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            {DIMENSIONS.map((d, i) => (
              <li key={d}>
                <Eyebrow className="text-ink-muted">{d}</Eyebrow>
                <p
                  className="mt-2 font-display text-[1.75rem] leading-none text-ink tabular-nums"
                  style={{ fontVariationSettings: '"opsz" 36' }}
                >
                  {scores[i] > 0 ? scores[i].toFixed(1) : "—"}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Decoration corner */}
        <span aria-hidden="true" className="pointer-events-none absolute -top-3 -left-3 font-mono text-eyebrow text-ink-muted">
          REC ●
        </span>
      </div>

      {/* Caption */}
      <p className="mt-4 font-mono text-eyebrow text-ink-muted">
        SIMULATION · A REAL SESSION HAS YOUR VOICE, YOUR RÉSUMÉ, YOUR ROLE.
      </p>
    </motion.div>
  );
}

const SAMPLE_ANSWER =
  "Sure — last quarter I rebuilt our ingestion pipeline. The first thing that broke was idempotency under retry, so I added a content-hash dedup key before the queue and we cut duplicate inserts to nearly zero…";

const SAMPLE_SCORES: number[][] = [
  [8.4, 7.9, 8.7, 8.2],
  [7.6, 8.1, 7.8, 8.6],
  [8.9, 8.4, 7.7, 8.0],
];

function phaseLabel(p: LoopPhase): string {
  switch (p) {
    case "asking":
      return "INTERVIEWER SPEAKING";
    case "listening":
      return "LISTENING";
    case "analyzing":
      return "ANALYSING ANSWER";
    case "scoring":
      return "SCORED";
    case "rest":
      return "READY FOR NEXT";
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function SpeakingBars({ active }: { active: boolean }) {
  // 5 vertical bars pulsing when active.
  return (
    <div className="flex items-end gap-1 h-6" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            "block w-[3px] rounded-[1px]",
            active ? "bg-accent ai-pulse" : "bg-ink-muted",
          )}
          style={{
            height: active ? `${60 + ((i * 13) % 40)}%` : "30%",
            animationDelay: active ? `${i * 0.12}s` : undefined,
            transformOrigin: "center",
            transition: "height 400ms cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      ))}
    </div>
  );
}

function Waveform({ active }: { active: boolean }) {
  // 32 bars; when active, pseudo-random heights animate.
  const bars = useMemo(() => Array.from({ length: 32 }, (_, i) => i), []);
  const [tick, setTick] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!active || reduce) return;
    const id = setInterval(() => setTick((t) => t + 1), 90);
    return () => clearInterval(id);
  }, [active, reduce]);
  return (
    <div className="flex items-end gap-[2px] h-6" aria-hidden="true">
      {bars.map((i) => {
        // Deterministic pseudo-random by tick + i for stability across renders.
        const seed = (i * 9301 + tick * 49297) % 233280;
        const r = seed / 233280;
        const h = active ? 25 + Math.abs(Math.sin(i + tick * 0.4) * 70 + r * 20) : 30;
        return (
          <span
            key={i}
            className={cn(
              "block w-[2px] rounded-[1px]",
              active ? "bg-ink" : "bg-ink-muted/50",
            )}
            style={{
              height: `${Math.min(100, h)}%`,
              transition: "height 90ms linear",
            }}
          />
        );
      })}
    </div>
  );
}

/* ---------- Marquee ---------- */

function Marquee() {
  const items = [
    "PATIENT TURN-TAKING",
    "RESUME-AWARE QUESTIONS",
    "SOFT NUDGES, NOT INTERRUPTIONS",
    "NO TYPING — VOICE BOTH WAYS",
    "FOUR-DIMENSION SCORING",
    "PDF REPORT IN ONE CLICK",
  ];

  const track = [...items, ...items];

  return (
    <section
      aria-hidden="true"
      className="border-y border-rule bg-canvas-elevated overflow-hidden"
    >
      <div className="marquee-track flex whitespace-nowrap py-4 font-mono text-eyebrow text-ink-muted">
        {track.map((s, i) => (
          <span key={i} className="flex items-center">
            <span className="px-8">{s}</span>
            <span className="text-rule-strong select-none">·</span>
          </span>
        ))}
      </div>
    </section>
  );
}

/* ---------- Three-step ritual ---------- */

const STEPS = [
  {
    n: 1,
    title: "Upload your résumé.",
    body:
      "We extract identity, roles, projects and skills, embed it for retrieval, and build a question plan tailored to the position you want.",
    eyebrow: "STEP ONE — RÉSUMÉ",
  },
  {
    n: 2,
    title: "Step into the room.",
    body:
      "A fullscreen rehearsal room. The interviewer speaks. You answer with your voice. It listens patiently — pauses count as thinking, not endings.",
    eyebrow: "STEP TWO — REHEARSE",
  },
  {
    n: 3,
    title: "Read your scored report.",
    body:
      "Per-question feedback, four dimensions of scoring, strengths, areas to improve, and a downloadable PDF. Every detail of the conversation is preserved.",
    eyebrow: "STEP THREE — REPORT",
  },
];

function ThreeStep() {
  return (
    <section id="how-it-works" className="editorial-container py-24 md:py-32">
      <div className="mb-16 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Eyebrow>THE RITUAL</Eyebrow>
          <h2 className="mt-3 text-display text-ink">Three steps. One conversation.</h2>
        </div>
        <p className="max-w-[420px] text-body text-ink-soft">
          From résumé to report in under thirty minutes. The same shape every
          time — so the only thing that changes is you.
        </p>
      </div>

      <HairlineDivider strong />
      <ol>
        {STEPS.map((s, idx) => (
          <motion.li
            key={s.n}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: durations.slow, ease: easeEditorial, delay: idx * 0.05 }}
            className="grid gap-8 py-12 md:grid-cols-[180px_1fr_auto] md:items-baseline md:gap-16"
          >
            <NumberedMarker index={s.n} total={3} label={s.eyebrow.split("—")[1]?.trim()} />
            <div>
              <h3 className="font-display text-[1.75rem] leading-tight text-ink md:text-[2.25rem]">
                {s.title}
              </h3>
              <p className="mt-4 max-w-prose text-body text-ink-soft">{s.body}</p>
            </div>
            <span
              aria-hidden="true"
              className="hidden md:inline font-mono text-eyebrow text-ink-muted tabular-nums"
            >
              {String(s.n).padStart(2, "0")} / 03
            </span>
            {idx < STEPS.length - 1 && (
              <span className="md:col-span-3">
                <HairlineDivider />
              </span>
            )}
          </motion.li>
        ))}
      </ol>
      <HairlineDivider strong />
    </section>
  );
}

/* ---------- Sample interaction ---------- */

function SampleInteraction() {
  return (
    <section id="sample" className="bg-canvas-sunken py-24 md:py-32">
      <div className="editorial-container">
        <div className="mb-16 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <Eyebrow>A SAMPLE TURN</Eyebrow>
            <h2 className="mt-3 text-display text-ink">
              How the room replies, exactly.
            </h2>
          </div>
          <p className="max-w-[420px] text-body text-ink-soft">
            One real-shape question, one real-shape answer, one real-shape score.
            Nothing here is hidden behind "AI magic" — every dimension comes with
            a written rationale.
          </p>
        </div>

        <motion.article
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: durations.slow, ease: easeEditorial }}
          className="grid gap-12 border-l border-rule-strong bg-canvas-elevated p-8 md:grid-cols-[180px_1fr] md:p-12"
        >
          <aside className="md:border-r md:border-rule md:pr-8">
            <Eyebrow>QUESTION 03 / 08</Eyebrow>
            <p className="mt-4 font-mono text-eyebrow text-ink-muted">
              FOCUS · TECHNICAL
            </p>
            <p className="font-mono text-eyebrow text-ink-muted">
              SENIORITY · SENIOR
            </p>
            <p className="mt-6 text-small text-ink-muted">
              Asked at <span className="font-mono text-ink">06:42</span> into a
              30-minute session.
            </p>
          </aside>

          <div>
            <p className="text-question text-ink">
              "Walk me through how you'd design a chat application for ten million
              concurrent users — and where the first real bottleneck appears."
            </p>

            <div className="mt-10 border-l border-rule pl-6">
              <Eyebrow className="text-ink-muted">ANSWER · COMMITTED</Eyebrow>
              <p className="mt-3 text-body leading-relaxed text-ink-soft">
                "I'd start with the connection model — long-lived WebSockets,
                horizontally sharded by user ID. The first bottleneck isn't
                throughput, it's fan-out: a popular user's message lands in
                hundreds of thousands of mailboxes, so the queue between the
                gateway and the per-user store is where pressure shows up first.
                I'd put a write-amplification budget on it…"
              </p>
            </div>

            <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4">
              {[
                { label: "Clarity", v: 8.4 },
                { label: "Depth", v: 8.7 },
                { label: "Correctness", v: 7.9 },
                { label: "Communication", v: 8.2 },
              ].map((d) => (
                <div key={d.label}>
                  <Eyebrow className="text-ink-muted">{d.label}</Eyebrow>
                  <p
                    className="mt-2 font-display text-[2rem] leading-none text-ink tabular-nums"
                    style={{ fontVariationSettings: '"opsz" 36' }}
                  >
                    {d.v.toFixed(1)}
                  </p>
                </div>
              ))}
            </div>

            <HairlineDivider className="mt-10" />

            <div className="mt-6">
              <Eyebrow className="text-ink-muted">RATIONALE</Eyebrow>
              <p className="mt-3 text-body italic leading-relaxed text-ink-soft">
                Strong opening framing and an unusually specific bottleneck call.
                Could go further on consistency vs. latency trade-offs at the
                fan-out tier. Communication is calm and structured throughout.
              </p>
            </div>
          </div>
        </motion.article>
      </div>
    </section>
  );
}

/* ---------- Spec strip ---------- */

const SPECS = [
  { value: "≤ 1.5s", label: "P95 latency, end-of-speech to next word" },
  { value: "4", label: "Dimensions of scoring per turn" },
  { value: "6–10", label: "Tailored questions in each plan" },
  { value: "0", label: "Buttons to press once you're inside" },
];

function SpecStrip() {
  return (
    <section className="editorial-container py-24 md:py-32">
      <div className="mb-12">
        <Eyebrow>THE NUMBERS</Eyebrow>
        <h2 className="mt-3 text-display text-ink">Built for a real conversation.</h2>
      </div>
      <HairlineDivider strong />
      <ul className="grid grid-cols-2 gap-x-8 gap-y-12 py-12 md:grid-cols-4">
        {SPECS.map((s, i) => (
          <motion.li
            key={s.label}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: durations.base, ease: easeEditorial, delay: i * 0.05 }}
          >
            <p
              className="font-display text-[3rem] leading-none text-ink tabular-nums md:text-[3.5rem]"
              style={{ fontVariationSettings: '"opsz" 96' }}
            >
              {s.value}
            </p>
            <p className="mt-4 max-w-[200px] text-small text-ink-soft">{s.label}</p>
          </motion.li>
        ))}
      </ul>
      <HairlineDivider strong />
    </section>
  );
}

/* ---------- Pull-quote ---------- */

function PullQuoteSection() {
  return (
    <section className="editorial-container py-24 md:py-32">
      <motion.blockquote
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: durations.slow, ease: easeEditorial }}
        className="mx-auto max-w-3xl border-l-2 border-accent pl-6 md:pl-10"
      >
        <p className="font-display text-[1.875rem] leading-snug text-ink md:text-[2.5rem]">
          The room is patient. It does not interrupt your thinking. It hears the
          word you almost said, and asks for it again — the way the people you
          want to work with would.
        </p>
        <footer className="mt-8 font-mono text-eyebrow text-ink-muted">
          — A NOTE FROM THE BUILD
        </footer>
      </motion.blockquote>
    </section>
  );
}

/* ---------- Final CTA ---------- */

function FinalCta({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section className="bg-ink text-canvas-elevated">
      <div className="editorial-container py-24 md:py-32">
        <div className="grid gap-12 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <Eyebrow className="text-canvas-elevated/60">READY</Eyebrow>
            <h2 className="mt-4 text-display text-canvas-elevated">
              Tomorrow's interview is in <VermillionUnderline>this</VermillionUnderline> room.
            </h2>
            <p className="mt-6 max-w-prose text-body text-canvas-elevated/75">
              The first session is the hardest. After that you have a baseline,
              a transcript, and a number to beat.
            </p>
          </div>

          <div className="flex flex-col items-start gap-4">
            <Link to={isAuthed ? "/upload" : "/signup"}>
              <EditorialButton
                filled
                tone="accent"
                arrow
                className="bg-accent text-canvas-elevated hover:bg-accent-hover"
              >
                {isAuthed ? "BEGIN A NEW SESSION" : "BEGIN REHEARSING"}
              </EditorialButton>
            </Link>
            {!isAuthed && (
              <Link to="/login" className="font-mono text-eyebrow text-canvas-elevated/70 hover:text-canvas-elevated">
                ALREADY REHEARSING? SIGN IN →
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */

function LandingFooter() {
  return (
    <footer className="bg-canvas border-t border-rule">
      <div className="editorial-container flex flex-col gap-6 py-10 text-eyebrow text-ink-muted md:flex-row md:items-center md:justify-between">
        <span className="font-display text-[18px] text-ink" style={{ fontVariationSettings: '"opsz" 24' }}>
          Rehearsal
        </span>
        <span className="font-mono">EST. 2026 — A REHEARSAL ROOM FOR INTERVIEWS</span>
        <span className="font-mono">VOICE-FIRST · RÉSUMÉ-AWARE · SCORED</span>
      </div>
    </footer>
  );
}
