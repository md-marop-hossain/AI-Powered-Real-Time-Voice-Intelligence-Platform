import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { useAuthStore } from "@/store/auth";
import { useMicStream } from "@/hooks/useMicStream";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { easeEditorial, durations } from "@/lib/motion";

import { Eyebrow } from "@/components/editorial/Eyebrow";
import { NumberedMarker } from "@/components/editorial/NumberedMarker";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { CountdownTimer } from "@/components/interview/CountdownTimer";
import { Waveform } from "@/components/interview/Waveform";
import { AISpeakingIndicator } from "@/components/interview/AISpeakingIndicator";
import {
  ConversationLog,
  ConversationTurn,
} from "@/components/interview/ConversationLog";
import { SessionPreflightCheck } from "@/components/interview/SessionPreflightCheck";
import { InterviewRules } from "@/components/interview/InterviewRules";
import { KeyboardShortcuts } from "@/components/interview/KeyboardShortcuts";
import { ResumeFootnote } from "@/components/interview/ResumeFootnote";

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
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
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
  const lastTurn = turns[turns.length - 1];
  const lastAnswer = lastTurn?.answer ?? "";
  const lastInterim = lastTurn?.interim ?? "";
  useEffect(() => {
    if (turns.length === 0) return;
    const id = window.requestAnimationFrame(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [turns.length, lastAnswer, lastInterim]);

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

  // Banners — five-minute toast and one-minute banner.
  const lastBannerRef = useRef<number | null>(null);
  useEffect(() => {
    if (timeRemaining === null) return;
    if (timeRemaining <= 60 && timeRemaining > 0) {
      setShowOneMinBanner(true);
    } else {
      setShowOneMinBanner(false);
    }
    const fiveMinKey = Math.floor(timeRemaining / 60);
    if (
      timeRemaining > 290 &&
      timeRemaining < 305 &&
      lastBannerRef.current !== fiveMinKey
    ) {
      lastBannerRef.current = fiveMinKey;
      toast("Five minutes remaining.", {
        position: "bottom-left",
        duration: 4000,
      });
    }
  }, [timeRemaining]);

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
    };

    ws.onerror = () =>
      toast.error("We've lost the line. Reconnecting…");

    return () => {
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preflightDone, rulesAcknowledged, sessionId, token]);

  const requestEndSession = useCallback(() => {
    if (ended) return;
    setEndConfirmOpen(true);
  }, [ended]);

  const confirmEndSession = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "end_session" }));
    setMicEnabled(false);
    setEndConfirmOpen(false);
  }, []);

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
      {timeRemaining !== null && timeRemaining <= 30 && timeRemaining > 0 && (
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
          <CountdownTimer seconds={timeRemaining} size="lg" announce frozen={ended} />
          <div className="mt-6 flex items-center justify-center gap-4 font-mono text-eyebrow text-ink-muted">
            <span className="h-px w-12 bg-rule-strong" />
            REMAINING
            <span className="h-px w-12 bg-rule-strong" />
          </div>
        </section>

        {/* Zone 2 — question */}
        <section className="border-b border-rule py-16">
          <AnimatePresence mode="wait">
            {currentQ ? (
              <motion.div
                key={currentQ.index}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: durations.slow, ease: easeEditorial }}
                className="max-w-prose"
              >
                <NumberedMarker
                  index={`Q${currentQ.index}`}
                  className="mb-6 block"
                />
                <p className="text-question text-ink">"{currentQ.text}"</p>
                {askedDuration !== null && !aiSpeaking && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: durations.base, ease: easeEditorial }}
                    className="mt-6 font-mono text-eyebrow text-ink-muted"
                  >
                    — asked by Rehearsal · {askedDuration.toFixed(1)}s
                  </motion.p>
                )}
              </motion.div>
            ) : (
              <p className="text-body text-ink-muted">
                Waiting for the first question…
              </p>
            )}
          </AnimatePresence>
        </section>

        {/* Zone 3 — speaking indicator (AI or user) */}
        <section className="py-10">
          <AnimatePresence mode="wait">
            {aiSpeaking ? (
              <motion.div
                key="ai"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: durations.base, ease: easeEditorial }}
              >
                <AISpeakingIndicator amplitude={player.amplitude} />
                <p className="mt-6 text-center font-mono text-eyebrow text-ink-muted">
                  REHEARSAL IS SPEAKING
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="user"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: durations.base, ease: easeEditorial }}
              >
                <div className="h-[120px]">
                  <Waveform analyser={analyser} active={micEnabled && !aiSpeaking} />
                </div>
                <div className="mt-4 flex items-center justify-center gap-3 font-mono text-eyebrow">
                  {aiThinking ? (
                    <ThinkingDots />
                  ) : (
                    <span
                      className={`h-2 w-2 rounded-full ${
                        !connected
                          ? "bg-ink-muted"
                          : userSpeaking
                            ? "bg-accent animate-pulse"
                            : micEnabled
                              ? "bg-accent"
                              : "bg-ink-muted"
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={
                      userSpeaking
                        ? "text-accent"
                        : aiThinking
                          ? "text-ink"
                          : "text-ink-muted"
                    }
                  >
                    {!connected
                      ? "CONNECTING…"
                      : aiThinking
                        ? "CONSIDERING YOUR ANSWER…"
                        : userSpeaking
                          ? "YOU ARE SPEAKING"
                          : micEnabled
                            ? "LISTENING — SPEAK NATURALLY"
                            : "MIC OFF"}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Zone 4 — conversation log (always visible) */}
        <section className="border-t border-rule py-12">
          <div className="mb-8 flex items-center justify-between">
            <Eyebrow>The conversation</Eyebrow>
            <Eyebrow className="text-ink-muted">
              {turns.length} {turns.length === 1 ? "TURN" : "TURNS"}
            </Eyebrow>
          </div>
          <ConversationLog turns={turns} />
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
          so the candidate can always see how much time is left. */}
      <AnimatePresence>
        {showFloatingTimer && (
          <motion.div
            key="floating-timer"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: durations.base, ease: easeEditorial }}
            className="fixed right-6 top-6 z-30 flex items-center gap-3 rounded-full border border-rule bg-canvas-elevated/95 px-4 py-2 shadow-sm backdrop-blur"
            role="status"
          >
            <span className="font-mono text-eyebrow text-ink-muted">
              {ended ? "ENDED" : "REMAINING"}
            </span>
            <CountdownTimer
              seconds={timeRemaining}
              size="sm"
              frozen={ended}
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
