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

  // Open WebSocket once preflight is satisfied.
  useEffect(() => {
    if (!preflightDone || !sessionId || !token) return;

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
            case "ai_audio_end":
              await player.flush();
              setAiSpeaking(false);
              setAskedDuration(
                currentQ ? (performance.now() - currentQ.askedAt) / 1000 : null,
              );
              setTurns((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1 && !t.answer
                    ? { ...t, status: "listening" }
                    : t,
                ),
              );
              break;
            case "user_speech_started":
              setUserSpeaking(true);
              setTurns((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1 && !t.answer
                    ? { ...t, status: "speaking" }
                    : t,
                ),
              );
              break;
            case "user_interim":
              setTurns((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1 && !t.answer
                    ? { ...t, interim: msg.text, status: "speaking" }
                    : t,
                ),
              );
              break;
            case "user_speech_ended":
              setUserSpeaking(false);
              setTurns((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1 && !t.answer
                    ? { ...t, status: "thinking" }
                    : t,
                ),
              );
              break;
            case "transcript":
              setUserSpeaking(false);
              setTurns((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1 && !t.answer
                    ? {
                        ...t,
                        answer: msg.text,
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
              ws.close();
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
  }, [preflightDone, sessionId, token]);

  const endSession = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "end_session" }));
    setMicEnabled(false);
  }, []);

  const skipQuestion = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "end_speech" }));
  }, []);

  // Preflight first.
  if (!preflightDone) {
    return (
      <div className="min-h-screen bg-canvas">
        <main className="editorial-container py-16 md:py-24">
          <SessionPreflightCheck onReady={() => setPreflightDone(true)} />
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
          <CountdownTimer seconds={timeRemaining} size="lg" announce />
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
                  <span
                    className={`h-2 w-2 rounded-full ${
                      !connected
                        ? "bg-ink-muted"
                        : userSpeaking
                          ? "bg-accent animate-pulse"
                          : aiThinking
                            ? "bg-ink animate-pulse"
                            : micEnabled
                              ? "bg-accent"
                              : "bg-ink-muted"
                    }`}
                    aria-hidden="true"
                  />
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
              <EditorialButton onClick={endSession} disabled={!connected} tone="accent">
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

      <ResumeFootnote contextLines={resumeContext} />
      <KeyboardShortcuts onEsc={endSession} onArrowRight={skipQuestion} />
    </div>
  );
}
