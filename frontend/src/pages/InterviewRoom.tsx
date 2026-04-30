import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useMicStream } from "@/hooks/useMicStream";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { easeEditorial, durations } from "@/lib/motion";

import { Eyebrow } from "@/components/editorial/Eyebrow";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { CountdownTimer } from "@/components/interview/CountdownTimer";
import { Waveform } from "@/components/interview/Waveform";
import { AIAvatar } from "@/components/interview/AIAvatar";
import { QuestionCard } from "@/components/interview/QuestionCard";
import {
  Transcript,
  type ConversationTurn,
} from "@/components/interview/Transcript";
import { SessionPreflightCheck } from "@/components/interview/SessionPreflightCheck";
import { InterviewRules } from "@/components/interview/InterviewRules";
import { KeyboardShortcuts } from "@/components/interview/KeyboardShortcuts";
import { ResumeFootnote } from "@/components/interview/ResumeFootnote";
import { useInterviewState } from "@/hooks/useInterviewState";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000";

interface CurrentQuestion {
  index: number;
  text: string;
  askedAt: number;
}

export default function InterviewRoom() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.accessToken);

  const [preflightDone, setPreflightDone] = useState(false);
  // Second gate after preflight: the candidate has to acknowledge the room
  // rules (no tab-switch, stay in fullscreen, etc.) before mic capture and
  // the live WebSocket open. The "Begin interview" click also doubles as the
  // user gesture that requests fullscreen.
  const [rulesAcknowledged, setRulesAcknowledged] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  // Holds the post-end navigation timer so we can cancel it if the room
  // unmounts (e.g. user clicks "Read the report" before auto-redirect fires).
  const completeRedirectRef = useRef<number | null>(null);
  // Watchdog interval for polling session status when the WS dies before
  // emitting `session_ended` or the local timer reaches 0 without a
  // server close-out. Cleared whenever we actually navigate.
  const watchdogRef = useRef<number | null>(null);
  // Latch so the timer-zero watchdog only arms once per room mount.
  const expiryWatchdogArmedRef = useRef<boolean>(false);
  // True once we've initiated navigation away — prevents the watchdog
  // from firing twice if both paths trip (timer-zero AND ws-close).
  const navigatedRef = useRef<boolean>(false);
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  // Single, parent-owned live tick so the hero timer and the floating
  // mini-timer ALWAYS show the same digits. Each `CountdownTimer` used to
  // run its own setInterval and they could drift between server pushes —
  // the candidate would see, e.g., 00:09 floating and 00:00 hero on the
  // same page. We tick centrally here and freeze the children's local clocks.
  const [liveSeconds, setLiveSeconds] = useState<number | null>(null);
  const liveBaselineRef = useRef<{ seconds: number; t0: number } | null>(null);
  const [currentQ, setCurrentQ] = useState<CurrentQuestion | null>(null);
  const [askedDuration, setAskedDuration] = useState<number | null>(null);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [ended, setEnded] = useState(false);
  const [showOneMinBanner, setShowOneMinBanner] = useState(false);
  const [resumeContext] = useState<string[]>([]);
  // True once the user has scrolled past the hero timer in Zone 1.
  const [showFloatingTimer, setShowFloatingTimer] = useState(false);
  // Two-step End-Session confirmation; protects against accidental clicks.
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  // Focus-integrity bookkeeping. Each tab switch / fullscreen exit / blur
  // event during an active session counts as a violation. The session is
  // ended on the FOCUS_LIMIT-th strike (server-authoritative).
  const FOCUS_LIMIT = 3;
  const [focusViolations, setFocusViolations] = useState(0);
  const [focusModalOpen, setFocusModalOpen] = useState(false);
  const [focusReason, setFocusReason] = useState<string>("");
  const [focusEndedByViolations, setFocusEndedByViolations] = useState(false);
  // Local guard so a single blur+visibility burst counts as one violation.
  const violationLockRef = useRef<number>(0);
  // Don't count violations during the ~2s after preflight completes — the
  // browser's fullscreen prompt and the post-permission focus shuffle can
  // briefly hide/blur the page before the user has done anything wrong.
  const violationGraceUntilRef = useRef<number>(0);

  const player = useAudioPlayer();

  // Central UI state — derives `phase` and `avatarState` from the raw
  // booleans driven by WebSocket events. Visual components (AIAvatar,
  // status pills, etc.) read from this rather than from individual flags.
  const ui = useInterviewState({
    connected,
    micEnabled,
    aiSpeaking,
    userSpeaking,
    aiThinking,
    ended,
  });

  const sendFrame = useCallback(
    (frame: ArrayBuffer) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (aiSpeaking) return;
      ws.send(frame);
    },
    [aiSpeaking],
  );

  const { analyser } = useMicStream(sendFrame, micEnabled);

  // Auto-scroll: follow the conversation as new turns, interim transcripts,
  // and committed answers land. We wait one animation frame so the new DOM
  // node is laid out, then smooth-scroll the window to the bottom of the page.
  // IMPORTANT: stop following once `ended` is set. Otherwise a late transcript
  // landing during the 1.2s pre-navigation pause re-pins the document to the
  // bottom, and AnimatePresence then renders the next page (InterviewComplete)
  // below the still-mounted exiting page — the candidate sees a blank screen
  // and has to scroll down to find the completion text.
  const lastTurn = turns[turns.length - 1];
  const lastAnswer = lastTurn?.answer ?? "";
  const lastInterim = lastTurn?.interim ?? "";
  useEffect(() => {
    if (turns.length === 0) return;
    if (ended) return;
    const id = window.requestAnimationFrame(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [turns.length, lastAnswer, lastInterim, ended]);

  // Show a small floating timer once the hero timer in Zone 1 has scrolled
  // out of view, so the candidate always knows how much time is left.
  useEffect(() => {
    const onScroll = () => {
      // Zone 1's bottom is somewhere around 280-360px depending on viewport;
      // 240 is a safe threshold past which the big timer is no longer visible.
      setShowFloatingTimer(window.scrollY > 240);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Focus-integrity: detect tab switches, fullscreen exits, and window blur
  // during an active session. Each event counts as one violation, pauses the
  // mic, and pops a blocking modal. Coalesce bursts (visibility + blur fire
  // together when Alt-Tabbing) within 1500ms so they're treated as one event.
  const recordViolation = useCallback(
    (reason: string) => {
      if (!preflightDone || !rulesAcknowledged) return;
      if (ended) return;
      if (focusEndedByViolations) return;
      const now = performance.now();
      if (now < violationGraceUntilRef.current) return;
      if (now - violationLockRef.current < 1500) return;
      violationLockRef.current = now;
      setMicEnabled(false);
      setEndConfirmOpen(false);
      setFocusReason(reason);
      setFocusModalOpen(true);
      setFocusViolations((n) => n + 1);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "focus_violation", reason }));
      }
    },
    [preflightDone, rulesAcknowledged, ended, focusEndedByViolations],
  );

  useEffect(() => {
    if (!preflightDone || !rulesAcknowledged) return;
    if (ended) return;
    // Grace period: ignore everything for ~2s after the rules are accepted
    // so the fullscreen permission prompt and the focus shuffle that follows
    // don't immediately count as a violation.
    violationGraceUntilRef.current = performance.now() + 2000;
    const onVisibility = () => {
      if (document.hidden) recordViolation("tab_hidden");
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) recordViolation("fullscreen_exit");
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [preflightDone, rulesAcknowledged, ended, recordViolation]);

  const resumeFromViolation = useCallback(() => {
    // Click handler for the "Return to interview" button. We're inside a
    // user gesture so requestFullscreen will be honored.
    const el = document.documentElement;
    el.requestFullscreen?.().catch(() => {});
    setFocusModalOpen(false);
    setMicEnabled(true);
  }, []);

  // Reset the central live-tick baseline whenever the server pushes a fresh
  // time_remaining. Both displays read from `liveSeconds` so they stay
  // perfectly in lockstep instead of each ticking on their own clock.
  useEffect(() => {
    if (timeRemaining === null) {
      liveBaselineRef.current = null;
      setLiveSeconds(null);
      return;
    }
    liveBaselineRef.current = {
      seconds: timeRemaining,
      t0: performance.now(),
    };
    setLiveSeconds(timeRemaining);
  }, [timeRemaining]);

  // Tick the central clock once per second between server pushes. Frozen on
  // session end so the digits hold at termination.
  useEffect(() => {
    if (liveSeconds === null) return;
    if (ended) return;
    const id = window.setInterval(() => {
      const base = liveBaselineRef.current;
      if (!base) return;
      const dt = (performance.now() - base.t0) / 1000;
      setLiveSeconds(Math.max(0, base.seconds - Math.floor(dt)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [liveSeconds, ended]);

  // Banners — five-minute toast and one-minute banner. Driven by the
  // central live tick so the banner appears the instant the displayed
  // digits cross 60s, not just on the next sparse server push.
  const lastBannerRef = useRef<number | null>(null);
  useEffect(() => {
    if (liveSeconds === null) return;
    if (liveSeconds <= 60 && liveSeconds > 0) {
      setShowOneMinBanner(true);
    } else {
      setShowOneMinBanner(false);
    }
    const fiveMinKey = Math.floor(liveSeconds / 60);
    if (
      liveSeconds > 290 &&
      liveSeconds < 305 &&
      lastBannerRef.current !== fiveMinKey
    ) {
      lastBannerRef.current = fiveMinKey;
      toast("Five minutes remaining.", {
        position: "bottom-left",
        duration: 4000,
      });
    }
  }, [liveSeconds]);

  // Single, idempotent path off the interview page. Both the WS-close
  // recovery and the timer-zero watchdog funnel through this so we never
  // navigate twice or leave a poll running after the room unmounts.
  const goToCompletion = useCallback(() => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    if (watchdogRef.current !== null) {
      window.clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (completeRedirectRef.current !== null) {
      window.clearTimeout(completeRedirectRef.current);
      completeRedirectRef.current = null;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    navigate(`/sessions/${sessionId}/complete`);
  }, [navigate, sessionId]);

  // Start a polling watchdog that checks whether the server has marked the
  // session completed. Used as a recovery path when the normal close-out
  // (a `session_ended` JSON frame) didn't arrive — e.g. TTS hang on the
  // closing line, network blip, or server crash. After `maxAttempts` polls
  // we navigate anyway so the candidate is never stranded on a frozen page.
  const startCompletionWatchdog = useCallback(
    (opts: { intervalMs?: number; maxAttempts?: number; finalNavigate?: boolean } = {}) => {
      if (navigatedRef.current) return;
      if (watchdogRef.current !== null) return;
      const intervalMs = opts.intervalMs ?? 2000;
      const maxAttempts = opts.maxAttempts ?? 15;
      const finalNavigate = opts.finalNavigate ?? true;
      let attempts = 0;
      watchdogRef.current = window.setInterval(async () => {
        attempts += 1;
        try {
          const r = await api.get(`/sessions/${sessionId}`);
          if (r.data?.status === "completed") {
            goToCompletion();
            return;
          }
        } catch {
          /* keep polling */
        }
        if (attempts >= maxAttempts) {
          if (watchdogRef.current !== null) {
            window.clearInterval(watchdogRef.current);
            watchdogRef.current = null;
          }
          if (finalNavigate) goToCompletion();
        }
      }, intervalMs);
    },
    [goToCompletion, sessionId],
  );

  // Timer-zero watchdog: when the live clock hits 0 we expect a
  // `session_ended` frame from the server within ~5 seconds. If it never
  // arrives (the most common stuck-on-page failure), kick off the polling
  // recovery so the candidate is moved to the completion screen anyway.
  useEffect(() => {
    if (liveSeconds === null) return;
    if (liveSeconds > 0) return;
    if (ended) return;
    if (expiryWatchdogArmedRef.current) return;
    expiryWatchdogArmedRef.current = true;
    const t = window.setTimeout(() => {
      if (navigatedRef.current || ended) return;
      startCompletionWatchdog({ intervalMs: 2000, maxAttempts: 8 });
    }, 5000);
    return () => window.clearTimeout(t);
  }, [liveSeconds, ended, startCompletionWatchdog]);

  // Open WebSocket once preflight is satisfied AND the candidate has
  // acknowledged the room rules (and triggered fullscreen).
  useEffect(() => {
    if (!preflightDone || !rulesAcknowledged || !sessionId || !token) return;

    const ws = new WebSocket(`${WS_URL}/ws/interview/${sessionId}?token=${token}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setMicEnabled(true);
    };

    ws.onmessage = async (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          switch (msg.type) {
            case "ai_question": {
              setAiSpeaking(true);
              setAiThinking(false);
              setUserSpeaking(false);
              const startedAt = performance.now();
              setTurns((prev) => {
                const idx = prev.length + 1;
                setCurrentQ({ index: idx, text: msg.text, askedAt: startedAt });
                return [
                  ...prev,
                  {
                    index: idx,
                    question: msg.text,
                    status: "asking",
                  },
                ];
              });
              setAskedDuration(null);
              break;
            }
            case "ai_nudge": {
              // Soft continuation prompt: play audio, but do NOT add a new turn
              // — a nudge is glue, not a question. The candidate's next
              // utterance will append onto the current turn's answer.
              setAiSpeaking(true);
              setAiThinking(false);
              setUserSpeaking(false);
              break;
            }
            case "ai_audio_end":
              await player.flush();
              setAiSpeaking(false);
              setAskedDuration(
                currentQ ? (performance.now() - currentQ.askedAt) / 1000 : null,
              );
              setTurns((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1
                    ? { ...t, status: "listening" }
                    : t,
                ),
              );
              break;
            case "user_speech_started":
              setUserSpeaking(true);
              setTurns((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1
                    ? { ...t, status: "speaking" }
                    : t,
                ),
              );
              break;
            case "user_interim":
              setTurns((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1
                    ? { ...t, interim: msg.text, status: "speaking" }
                    : t,
                ),
              );
              break;
            case "user_speech_ended":
              setUserSpeaking(false);
              setTurns((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1
                    ? { ...t, status: "thinking" }
                    : t,
                ),
              );
              break;
            case "transcript":
              setUserSpeaking(false);
              setTurns((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1
                    ? {
                        ...t,
                        // Across nudges, multiple committed utterances land
                        // on the same turn — append rather than overwrite so
                        // the candidate's growing answer reads as one.
                        answer: t.answer
                          ? `${t.answer} ${msg.text}`.trim()
                          : msg.text,
                        interim: undefined,
                        status: "answered",
                      }
                    : t,
                ),
              );
              break;
            case "ai_thinking":
              setAiThinking(true);
              break;
            case "ai_idle":
              // Sent by the server when a turn-processing step failed
              // (LLM timeout, TTS 5xx). Clears the "thinking" indicator so
              // the candidate isn't stuck staring at three pulsing dots.
              setAiThinking(false);
              break;
            case "time_remaining":
              setTimeRemaining(msg.seconds);
              break;
            case "session_ended":
              setEnded(true);
              setMicEnabled(false);
              setAiSpeaking(false);
              setUserSpeaking(false);
              if (msg.reason === "focus_violations") {
                setFocusEndedByViolations(true);
                setFocusModalOpen(true);
              } else {
                // Normal end (timer expired or user-confirmed end). Briefly
                // hold on the ended state so any tail audio finishes, then
                // route the candidate to the dedicated completion screen.
                if (completeRedirectRef.current !== null) {
                  window.clearTimeout(completeRedirectRef.current);
                }
                completeRedirectRef.current = window.setTimeout(() => {
                  goToCompletion();
                }, 1200);
              }
              if (document.fullscreenElement) {
                document.exitFullscreen?.().catch(() => {});
              }
              ws.close();
              break;
            case "focus_violation_ack":
              if (typeof msg.count === "number") setFocusViolations(msg.count);
              break;
            case "error":
              toast.error(msg.message ?? "Something interrupted us. We're looking into it.");
              break;
          }
        } catch {
          /* ignore non-JSON */
        }
      } else {
        player.append(ev.data as ArrayBuffer);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setMicEnabled(false);

      // Belt-and-braces: if the WS closed without a prior `session_ended`
      // (TTS hang, network blip, server crash), the candidate would
      // otherwise stay stuck on the interview page even though the server
      // has already marked the session completed. Poll /sessions/:id on
      // a short interval and navigate to the completion screen as soon as
      // the server reports completed; after the cap, navigate anyway so
      // the candidate is never stranded.
      if (navigatedRef.current) return;
      startCompletionWatchdog({ intervalMs: 2000, maxAttempts: 15 });
    };

    ws.onerror = () =>
      toast.error("We've lost the line. Reconnecting…");

    return () => {
      ws.close();
      if (completeRedirectRef.current !== null) {
        window.clearTimeout(completeRedirectRef.current);
        completeRedirectRef.current = null;
      }
      if (watchdogRef.current !== null) {
        window.clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preflightDone, rulesAcknowledged, sessionId, token]);

  const requestEndSession = useCallback(() => {
    if (ended) return;
    setEndConfirmOpen(true);
  }, [ended]);

  const confirmEndSession = useCallback(() => {
    setMicEnabled(false);
    setEndConfirmOpen(false);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "end_session" }));
      // If the server doesn't answer with `session_ended` shortly, fall
      // back to polling so the candidate isn't stuck staring at this room.
      startCompletionWatchdog({ intervalMs: 2000, maxAttempts: 8 });
    } else {
      // WS already dead — navigate straight to completion. The server has
      // most likely flipped the session to completed already; the
      // completion page handles the still-pending case gracefully.
      goToCompletion();
    }
  }, [goToCompletion, startCompletionWatchdog]);

  const cancelEndSession = useCallback(() => {
    setEndConfirmOpen(false);
  }, []);

  const skipQuestion = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "end_speech" }));
  }, []);

  // The "Begin interview" click on the rules screen is the gesture that
  // (a) requests fullscreen and (b) flips the gate that opens the WebSocket.
  // Browsers only honor requestFullscreen() inside a user-initiated event,
  // so it has to live on this click — not in a useEffect.
  const handleBeginInterview = useCallback(() => {
    const el = document.documentElement;
    el.requestFullscreen?.().catch((err) => {
      console.warn("Fullscreen request rejected:", err);
    });
    setRulesAcknowledged(true);
  }, []);

  // Step 1 — preflight (mic / server / voice clarity).
  if (!preflightDone) {
    return (
      <div className="min-h-screen bg-canvas">
        <main className="editorial-container py-16 md:py-24">
          <SessionPreflightCheck onReady={() => setPreflightDone(true)} />
        </main>
      </div>
    );
  }

  // Step 2 — rules of the room. The candidate must explicitly accept before
  // the WebSocket connects and mic capture begins.
  if (!rulesAcknowledged) {
    return (
      <div className="min-h-screen bg-canvas">
        <main className="editorial-container py-16 md:py-24">
          <InterviewRules onAccept={handleBeginInterview} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas relative">
      {/* One-minute banner */}
      <AnimatePresence>
        {showOneMinBanner && !ended && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            transition={{ duration: durations.base, ease: easeEditorial }}
            className="fixed inset-x-0 top-0 z-30 bg-accent text-canvas-elevated"
          >
            <div className="editorial-container py-3">
              <span className="text-eyebrow">ONE MINUTE.</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Vermillion line that draws across when under 30 seconds */}
      {liveSeconds !== null && liveSeconds <= 30 && liveSeconds > 0 && (
        <div className="fixed left-0 right-0 top-0 z-20 h-[2px] bg-accent" />
      )}

      <main className="editorial-container relative pt-12 pb-24">
        {/* Zone 1 — header eyebrow + timer */}
        <section className="border-b border-rule pb-12 text-center">
          <div className="mb-10 flex items-center justify-center gap-6">
            <Eyebrow className="text-ink-muted">SESSION</Eyebrow>
            <span className="font-mono text-eyebrow text-ink-muted">
              {sessionId?.slice(0, 8).toUpperCase()}
            </span>
            <Eyebrow className="text-ink-muted">·</Eyebrow>
            <Eyebrow className="text-ink-muted">SOFTWARE ENGINEER MOCK</Eyebrow>
          </div>
          {/* `frozen` is on so CountdownTimer doesn't run its own
              setInterval — the parent owns the live tick (liveSeconds). */}
          <CountdownTimer seconds={liveSeconds} size="lg" announce frozen />
          <div className="mt-6 flex items-center justify-center gap-4 font-mono text-eyebrow text-ink-muted">
            <span className="h-px w-12 bg-rule-strong" />
            REMAINING
            <span className="h-px w-12 bg-rule-strong" />
          </div>
        </section>

        {/* Zone 2 — question */}
        <section className="border-b border-rule py-16">
          <QuestionCard
            index={currentQ?.index ?? null}
            text={currentQ?.text ?? ""}
            askedDuration={askedDuration}
            isAsking={ui.isAISpeaking}
          />
        </section>

        {/* Zone 3 — AI orb (always visible) + waveform when the candidate
            speaks. State is driven by `ui` (the central InterviewState),
            which is derived from real WebSocket events. */}
        <section className="py-10">
          <div className="flex flex-col items-center gap-6">
            <AIAvatar
              state={ui.avatarState}
              amplitude={ui.isAISpeaking ? player.amplitude : 0}
              size={200}
            />

            <AnimatePresence mode="wait">
              {!ui.isAISpeaking && (
                <motion.div
                  key="waveform"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 96 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: durations.base, ease: easeEditorial }}
                  className="w-full max-w-prose overflow-hidden"
                >
                  <Waveform
                    analyser={analyser}
                    active={ui.isMicEnabled && !ui.isAISpeaking}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              layout
              className="flex items-center justify-center gap-3 font-mono text-eyebrow"
            >
              {ui.isThinking ? (
                <ThinkingDots />
              ) : (
                <motion.span
                  layout
                  animate={{
                    scale: ui.isUserSpeaking ? [1, 1.4, 1] : 1,
                    opacity: 1,
                  }}
                  transition={{
                    duration: 1,
                    repeat: ui.isUserSpeaking ? Infinity : 0,
                    ease: "easeInOut",
                  }}
                  className={`h-2 w-2 rounded-full ${
                    !ui.isConnected
                      ? "bg-ink-muted"
                      : ui.isAISpeaking
                        ? "bg-accent"
                        : ui.isUserSpeaking
                          ? "bg-accent"
                          : ui.isMicEnabled
                            ? "bg-accent"
                            : "bg-ink-muted"
                  }`}
                  aria-hidden="true"
                />
              )}
              <AnimatePresence mode="wait">
                <motion.span
                  key={ui.phase}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: durations.quick, ease: easeEditorial }}
                  className={
                    ui.isAISpeaking
                      ? "text-ink"
                      : ui.isUserSpeaking
                        ? "text-accent"
                        : ui.isThinking
                          ? "text-ink"
                          : "text-ink-muted"
                  }
                >
                  {phaseLabel(ui.phase, ui.isMicEnabled)}
                </motion.span>
              </AnimatePresence>
            </motion.div>
          </div>
        </section>

        {/* Zone 4 — conversation log (always visible) */}
        <section className="border-t border-rule py-12">
          <div className="mb-8 flex items-center justify-between">
            <Eyebrow>The conversation</Eyebrow>
            <Eyebrow className="text-ink-muted">
              {turns.length} {turns.length === 1 ? "TURN" : "TURNS"}
            </Eyebrow>
          </div>
          <Transcript turns={turns} />
        </section>

        {/* Footer actions */}
        <section className="border-t border-rule pt-10">
          <div className="flex items-center justify-center gap-12">
            <EditorialButton onClick={skipQuestion} disabled={!connected || ended} tone="muted">
              Skip question
            </EditorialButton>
            {!ended ? (
              <EditorialButton onClick={requestEndSession} disabled={!connected} tone="accent">
                End session
              </EditorialButton>
            ) : (
              <EditorialButton
                onClick={() => navigate(`/sessions/${sessionId}/report`)}
                tone="ink"
                arrow
              >
                Read the report
              </EditorialButton>
            )}
          </div>
        </section>
      </main>

      {/* Floating mini-timer — appears once the hero timer is scrolled past
          so the candidate can always see how much time is left. While the
          ONE MINUTE banner is up it slides BELOW the banner (not under it)
          so both stay readable instead of stacking on the same row. */}
      <AnimatePresence>
        {showFloatingTimer && (
          <motion.div
            key="floating-timer"
            initial={{ y: -16, opacity: 0 }}
            animate={{
              y: 0,
              opacity: 1,
              top: showOneMinBanner && !ended ? 64 : 24,
            }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: durations.base, ease: easeEditorial }}
            className="fixed right-6 z-40 flex items-center gap-3 rounded-full border border-rule bg-canvas-elevated/95 px-4 py-2 shadow-sm backdrop-blur"
            role="status"
          >
            <span className="font-mono text-eyebrow text-ink-muted">
              {ended ? "ENDED" : "REMAINING"}
            </span>
            <CountdownTimer
              seconds={liveSeconds}
              size="sm"
              frozen
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* End-Session confirmation modal — guards against accidental clicks. */}
      <AnimatePresence>
        {endConfirmOpen && (
          <motion.div
            key="end-confirm"
            className="fixed inset-0 z-50 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeEditorial }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-confirm-title"
          >
            <button
              type="button"
              aria-label="Cancel"
              className="absolute inset-0 bg-ink/40"
              onClick={cancelEndSession}
            />
            <motion.div
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 12, opacity: 0 }}
              transition={{ duration: durations.base, ease: easeEditorial }}
              className="relative max-w-md rounded-md border border-rule bg-canvas-elevated px-10 py-9 text-center shadow-xl"
            >
              <Eyebrow className="mb-4 text-ink-muted">CONFIRM</Eyebrow>
              <h2
                id="end-confirm-title"
                className="font-display text-[28px] leading-snug text-ink"
              >
                End the session now?
              </h2>
              <p className="mt-4 text-body text-ink-soft">
                Your progress is saved and you'll be taken to the report. This
                can't be undone.
              </p>
              <div className="mt-8 flex items-center justify-center gap-8">
                <EditorialButton onClick={cancelEndSession} tone="muted">
                  Keep going
                </EditorialButton>
                <EditorialButton onClick={confirmEndSession} tone="accent">
                  End session
                </EditorialButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Focus-integrity modal — fires when the candidate switches tabs,
          exits fullscreen, or otherwise loses focus during the session. */}
      <AnimatePresence>
        {focusModalOpen && (
          <motion.div
            key="focus-violation"
            className="fixed inset-0 z-[60] flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeEditorial }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="focus-modal-title"
          >
            <div className="absolute inset-0 bg-ink/60" aria-hidden="true" />
            <motion.div
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 12, opacity: 0 }}
              transition={{ duration: durations.base, ease: easeEditorial }}
              className="relative max-w-md rounded-md border border-rule bg-canvas-elevated px-10 py-9 text-center shadow-xl"
            >
              <Eyebrow className="mb-4 text-accent">
                {focusEndedByViolations ? "SESSION ENDED" : "STAY IN THE INTERVIEW"}
              </Eyebrow>
              <h2
                id="focus-modal-title"
                className="font-display text-[26px] leading-snug text-ink"
              >
                {focusEndedByViolations
                  ? "Too many interruptions."
                  : "Switching tabs interrupts the session."}
              </h2>
              <p className="mt-4 text-body text-ink-soft">
                {focusEndedByViolations ? (
                  <>
                    The session ended because focus was lost too many times.
                    Your progress is saved and you can read your report.
                  </>
                ) : (
                  <>
                    Mock interviews work best when you stay on this page.
                    Click below to return to fullscreen and pick up where you
                    left off.
                  </>
                )}
              </p>
              <p className="mt-4 font-mono text-eyebrow text-ink-muted">
                {focusEndedByViolations
                  ? `${focusViolations} OF ${FOCUS_LIMIT} STRIKES`
                  : `WARNING ${focusViolations} OF ${FOCUS_LIMIT} · ${focusReason.replace(/_/g, " ").toUpperCase()}`}
              </p>
              <div className="mt-8 flex items-center justify-center gap-8">
                {focusEndedByViolations ? (
                  <EditorialButton
                    onClick={() => navigate(`/sessions/${sessionId}/report`)}
                    tone="ink"
                    arrow
                  >
                    Read the report
                  </EditorialButton>
                ) : (
                  <EditorialButton onClick={resumeFromViolation} tone="accent">
                    Return to interview
                  </EditorialButton>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ResumeFootnote contextLines={resumeContext} />
      <KeyboardShortcuts
        onEsc={endConfirmOpen ? cancelEndSession : requestEndSession}
        onArrowRight={skipQuestion}
      />
    </div>
  );
}

/**
 * Translates the central `phase` into the eyebrow label rendered under the
 * AIAvatar. Kept next to the room (not inside the hook) because the wording
 * is presentational, not state.
 */
function phaseLabel(
  phase:
    | "connecting"
    | "ai-asking"
    | "thinking"
    | "user-speaking"
    | "listening"
    | "ended",
  micEnabled: boolean,
): string {
  switch (phase) {
    case "connecting":
      return "CONNECTING…";
    case "ai-asking":
      return "REHEARSAL IS SPEAKING";
    case "thinking":
      return "CONSIDERING YOUR ANSWER…";
    case "user-speaking":
      return "YOU ARE SPEAKING";
    case "listening":
      return micEnabled ? "LISTENING — SPEAK NATURALLY" : "MIC OFF";
    case "ended":
      return "SESSION ENDED";
  }
}

/**
 * Three pulsing dots used while the AI is "considering your answer". Each dot
 * fades and slightly rises on a staggered cycle so the row reads as live
 * processing rather than a frozen "loading…" string.
 */
function ThinkingDots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-ink"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.15,
          }}
        />
      ))}
    </span>
  );
}
