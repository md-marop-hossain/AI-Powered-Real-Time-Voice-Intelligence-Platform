import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { NumberedMarker } from "@/components/editorial/NumberedMarker";
import { easeEditorial, durations } from "@/lib/motion";

interface Props {
  /** Called once all three checks pass and the user confirms. */
  onReady: () => void;
}

type CheckState = "pending" | "running" | "passed" | "failed";
type VoiceState = "idle" | "recording" | "review" | "passed" | "failed";

const RECORD_SECONDS = 3;
// Below this normalized RMS we consider the recording effectively silent.
const SILENCE_RMS_THRESHOLD = 0.01;

/**
 * 3-step preflight before InterviewRoom:
 *  1. Microphone permission
 *  2. Server reachability
 *  3. A 3-second voice clarity test with live level meter, countdown,
 *     silent-recording detection, and clean playback controls.
 */
export function SessionPreflightCheck({ onReady }: Props) {
  const [mic, setMic] = useState<CheckState>("pending");
  const [server, setServer] = useState<CheckState>("pending");
  const [voice, setVoice] = useState<VoiceState>("idle");

  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordSecondsLeft, setRecordSecondsLeft] = useState(RECORD_SECONDS);
  const [liveLevel, setLiveLevel] = useState(0); // 0..1, while recording
  const [peakLevel, setPeakLevel] = useState(0); // 0..1, captured during recording
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0); // 0..1
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);

  const mediaRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const peakRef = useRef(0);
  const recordingIdRef = useRef(0); // guards against stale onstop callbacks

  // ---------- Lifecycle ----------

  useEffect(() => {
    runMic();
    runServer();
    return cleanupAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanupAll = () => {
    cancelRecording();
    revokeRecordedUrl();
    stopPlayback();
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
  };

  const revokeRecordedUrl = () => {
    if (recordedUrl) {
      try {
        URL.revokeObjectURL(recordedUrl);
      } catch {
        /* ignore */
      }
    }
  };

  // ---------- Step 1: mic ----------

  const runMic = async () => {
    setMic("running");
    try {
      // Request a clean stream tuned for speech.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaRef.current = stream;
      setMic("passed");
    } catch (e) {
      console.error("Mic permission failed:", e);
      setMic("failed");
    }
  };

  // ---------- Step 2: server ----------

  const runServer = async () => {
    setServer("running");
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
      const r = await fetch(`${apiUrl}/health`);
      if (!r.ok) throw new Error(`status ${r.status}`);
      setServer("passed");
    } catch (e) {
      console.error("Health check failed:", e);
      setServer("failed");
    }
  };

  // ---------- Step 3: voice ----------

  const cancelRecording = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
  };

  const stopPlayback = () => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = "";
      audioElRef.current = null;
    }
    setIsPlaying(false);
    setPlayProgress(0);
  };

  const pickMimeType = (): string => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const t of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return "";
  };

  const ensureAnalyser = () => {
    if (!mediaRef.current) return null;
    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    if (!analyserRef.current) {
      const source = ctx.createMediaStreamSource(mediaRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;
    }
    return analyserRef.current;
  };

  const runVoiceTest = useCallback(async () => {
    if (!mediaRef.current) {
      setVoice("failed");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setVoiceWarning("Your browser doesn't support audio recording. Try Chrome or Edge.");
      setVoice("failed");
      return;
    }

    revokeRecordedUrl();
    setRecordedUrl(null);
    setVoiceWarning(null);
    setRecordSecondsLeft(RECORD_SECONDS);
    setLiveLevel(0);
    setPeakLevel(0);
    peakRef.current = 0;
    setVoice("recording");

    const myId = ++recordingIdRef.current;
    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(mediaRef.current, { mimeType })
        : new MediaRecorder(mediaRef.current);
    } catch (e) {
      console.error("MediaRecorder construction failed:", e);
      setVoiceWarning("We couldn't open the recorder. Try a different browser or reload.");
      setVoice("failed");
      return;
    }
    recorderRef.current = recorder;

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = (ev) => {
      console.error("Recorder error:", ev);
      if (recordingIdRef.current === myId) {
        setVoiceWarning("The recorder failed mid-take. Please try again.");
        setVoice("failed");
      }
    };
    recorder.onstop = () => {
      // Stale stop callback (user clicked Try Again before this fired)? Drop it.
      if (recordingIdRef.current !== myId) return;
      const blob = new Blob(chunks, { type: chunks[0]?.type || mimeType || "audio/webm" });
      if (blob.size === 0) {
        setVoiceWarning("Nothing was captured. Please try again.");
        setVoice("failed");
        return;
      }
      const url = URL.createObjectURL(blob);
      setRecordedUrl(url);

      const peak = peakRef.current;
      setPeakLevel(peak);
      if (peak < SILENCE_RMS_THRESHOLD) {
        setVoiceWarning(
          "We barely heard anything. Move closer, unmute, or pick a different mic — then try again.",
        );
      }
      setVoice("review");
    };

    // Set up live level meter via AnalyserNode.
    const analyser = ensureAnalyser();
    if (analyser) {
      const buffer = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (recordingIdRef.current !== myId) return;
        analyser.getByteTimeDomainData(buffer);
        let sumSq = 0;
        for (let i = 0; i < buffer.length; i++) {
          const sample = (buffer[i] - 128) / 128; // -1..1
          sumSq += sample * sample;
        }
        const rms = Math.sqrt(sumSq / buffer.length); // 0..1
        if (rms > peakRef.current) peakRef.current = rms;
        setLiveLevel(rms);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    // Start the recorder; use a short timeslice so a final chunk is always available.
    try {
      recorder.start(250);
    } catch (e) {
      console.error("recorder.start failed:", e);
      setVoiceWarning("Couldn't start the recorder. Please try again.");
      setVoice("failed");
      return;
    }

    // Countdown UI (whole seconds).
    countdownTimerRef.current = window.setInterval(() => {
      setRecordSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);

    // Stop after the configured duration.
    stopTimerRef.current = window.setTimeout(() => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (countdownTimerRef.current !== null) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setLiveLevel(0);
    }, RECORD_SECONDS * 1000 + 50);
  }, [recordedUrl]);

  const playRecording = () => {
    if (!recordedUrl) return;
    stopPlayback();
    const audio = new Audio(recordedUrl);
    audioElRef.current = audio;
    audio.ontimeupdate = () => {
      if (audio.duration > 0) setPlayProgress(audio.currentTime / audio.duration);
    };
    audio.onended = () => {
      setIsPlaying(false);
      setPlayProgress(0);
    };
    audio.onerror = () => {
      setIsPlaying(false);
      setVoiceWarning("Couldn't play that back. Please try again.");
    };
    audio.play().then(
      () => setIsPlaying(true),
      (err) => {
        console.error("Playback failed:", err);
        setIsPlaying(false);
        setVoiceWarning("Browser blocked playback. Click again or try another browser.");
      },
    );
  };

  const tryAgain = () => {
    stopPlayback();
    revokeRecordedUrl();
    setRecordedUrl(null);
    setVoiceWarning(null);
    runVoiceTest();
  };

  const allPassed = mic === "passed" && server === "passed" && voice === "passed";

  // Enter fullscreen on the same user gesture that starts the interview.
  // Browsers only allow requestFullscreen() inside a user-initiated event,
  // so we chain it onto the click before forwarding to onReady.
  const handleStart = useCallback(() => {
    const el = document.documentElement;
    const req = el.requestFullscreen?.bind(el);
    if (req) {
      req().catch((err) => {
        // Most browsers reject if the user denies the prompt or the page is
        // embedded somewhere fullscreen isn't allowed. We still proceed —
        // the interview can run windowed; the room will just show a soft
        // warning when fullscreen isn't active.
        console.warn("Fullscreen request rejected:", err);
      });
    }
    onReady();
  }, [onReady]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durations.base, ease: easeEditorial }}
      className="mx-auto max-w-[680px]"
    >
      <NumberedMarker index={3} total={3} label="PREFLIGHT" className="mb-12 block" />
      <h1 className="text-display text-ink">Three quick checks before we begin.</h1>
      <p className="mt-6 text-body text-ink-soft">
        We'd rather catch trouble here than during your answer.
      </p>

      <div className="mt-16 space-y-6">
        <Step
          index={1}
          label="Microphone access"
          state={mic}
          retry={mic === "failed" ? runMic : undefined}
          hint={
            mic === "failed"
              ? "Allow microphone access in your browser, then retry."
              : mic === "passed"
                ? "Mic is on."
                : undefined
          }
        />
        <HairlineDivider />
        <Step
          index={2}
          label="Connection to the room"
          state={server}
          retry={server === "failed" ? runServer : undefined}
          hint={
            server === "failed"
              ? "We can't reach the interview server. Is the backend running?"
              : undefined
          }
        />
        <HairlineDivider />
        <Step
          index={3}
          label="Voice clarity"
          state={voiceCheckStateForStep(voice)}
          hint={
            voice === "idle"
              ? "Record three seconds, play it back, confirm it's you."
              : undefined
          }
        >
          {/* Idle */}
          {voice === "idle" && (
            <>
              {mic === "passed" ? (
                <EditorialButton onClick={runVoiceTest} arrow>
                  Record 3 seconds
                </EditorialButton>
              ) : (
                <p className="text-small text-ink-muted">
                  Waiting for microphone access.
                </p>
              )}
            </>
          )}

          {/* Recording */}
          {voice === "recording" && (
            <div className="space-y-4">
              <div className="flex items-baseline gap-3">
                <motion.span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-accent"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                />
                <Eyebrow className="text-accent">Recording…</Eyebrow>
                <span className="ml-auto font-mono text-eyebrow text-ink-muted tabular-nums">
                  {recordSecondsLeft}s
                </span>
              </div>
              <LevelMeter level={liveLevel} />
              <p className="text-small text-ink-muted">
                Speak naturally — read the line aloud: "Today is a good day to rehearse."
              </p>
            </div>
          )}

          {/* Review */}
          {voice === "review" && recordedUrl && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <EditorialButton onClick={playRecording} disabled={isPlaying}>
                  {isPlaying ? "Playing…" : "Play it back"}
                </EditorialButton>
                <span className="text-small text-ink-soft">
                  Did that sound like you?
                </span>
              </div>
              <PlaybackBar progress={isPlaying ? playProgress : 0} />
              {voiceWarning && (
                <p className="text-small text-accent">{voiceWarning}</p>
              )}
              {!voiceWarning && peakLevel > 0 && (
                <p className="text-small text-ink-muted">
                  Peak input ~{Math.round(peakLevel * 100)}%. Sounds healthy.
                </p>
              )}
              <div className="flex flex-wrap gap-4">
                <EditorialButton
                  onClick={() => setVoice("passed")}
                  tone="ink"
                  disabled={!recordedUrl}
                >
                  Yes, that's me
                </EditorialButton>
                <EditorialButton onClick={tryAgain} tone="muted">
                  Try again
                </EditorialButton>
              </div>
            </div>
          )}

          {/* Failed */}
          {voice === "failed" && (
            <div className="space-y-4">
              <p className="text-small text-accent">
                {voiceWarning ?? "We couldn't capture audio. Please try again."}
              </p>
              <EditorialButton onClick={tryAgain} arrow>
                Try again
              </EditorialButton>
            </div>
          )}

          {/* Passed */}
          {voice === "passed" && recordedUrl && (
            <div className="flex flex-wrap items-center gap-4">
              <EditorialButton onClick={playRecording} disabled={isPlaying} tone="muted">
                {isPlaying ? "Playing…" : "Replay"}
              </EditorialButton>
              <EditorialButton onClick={tryAgain} tone="muted">
                Re-record
              </EditorialButton>
            </div>
          )}
        </Step>
      </div>

      <HairlineDivider className="mt-12" />

      <div className="mt-12 flex items-center justify-between">
        <Eyebrow>{allPassed ? "Ready" : "Awaiting checks"}</Eyebrow>
        <EditorialButton onClick={handleStart} disabled={!allPassed} filled arrow>
          {allPassed ? "I'M READY" : "WAITING"}
        </EditorialButton>
      </div>
    </motion.section>
  );
}

// ---------- Helpers ----------

function voiceCheckStateForStep(v: VoiceState): CheckState {
  switch (v) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "recording":
    case "review":
      return "running";
    case "idle":
    default:
      return "pending";
  }
}

interface StepProps {
  index: number;
  label: string;
  state: CheckState;
  hint?: string;
  retry?: () => void;
  children?: React.ReactNode;
}

function Step({ index, label, state, hint, retry, children }: StepProps) {
  return (
    <div className="grid grid-cols-[40px_1fr_auto] items-baseline gap-6">
      <span className="font-mono text-eyebrow text-ink-muted">
        {String(index).padStart(2, "0")}
      </span>
      <div>
        <p className="text-body text-ink">{label}</p>
        {hint && <p className="mt-2 text-small text-ink-muted">{hint}</p>}
        {children && <div className="mt-4">{children}</div>}
      </div>
      <StepStatus state={state} retry={retry} />
    </div>
  );
}

function StepStatus({ state, retry }: { state: CheckState; retry?: () => void }) {
  if (state === "passed") {
    return (
      <AnimatePresence>
        <motion.span
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: durations.quick, ease: easeEditorial }}
          aria-label="Passed"
          className="font-mono text-eyebrow text-success"
        >
          ✓ READY
        </motion.span>
      </AnimatePresence>
    );
  }
  if (state === "running") {
    return <span className="font-mono text-eyebrow text-ink-muted">CHECKING…</span>;
  }
  if (state === "failed") {
    return retry ? (
      <button
        onClick={retry}
        className="editorial-link font-mono text-eyebrow text-accent"
      >
        RETRY
      </button>
    ) : (
      <span className="font-mono text-eyebrow text-error">FAILED</span>
    );
  }
  return <span className="font-mono text-eyebrow text-ink-muted">PENDING</span>;
}

// ---------- Visual sub-components ----------

/** Live mic level — a horizontal segmented meter scaled by RMS. */
function LevelMeter({ level }: { level: number }) {
  // Normalize — speech rms is roughly 0.02..0.2; scale to 0..1.
  const scaled = Math.min(1, level * 6);
  const segments = 28;
  const lit = Math.round(scaled * segments);
  return (
    <div className="flex items-center gap-[3px]" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(scaled.toFixed(2))}>
      {Array.from({ length: segments }, (_, i) => {
        const isOn = i < lit;
        // Last few segments are accent-coloured to show "loud".
        const isHot = i >= segments - 5;
        return (
          <span
            key={i}
            className={
              isOn
                ? isHot
                  ? "h-4 w-1.5 bg-accent"
                  : "h-4 w-1.5 bg-ink"
                : "h-4 w-1.5 bg-rule"
            }
          />
        );
      })}
    </div>
  );
}

/** Slim progress bar for playback. */
function PlaybackBar({ progress }: { progress: number }) {
  return (
    <div className="relative h-[2px] w-full overflow-hidden bg-rule">
      <motion.div
        className="absolute left-0 top-0 h-full bg-ink"
        initial={false}
        animate={{ width: `${Math.round(progress * 100)}%` }}
        transition={{ duration: durations.quick, ease: "linear" }}
      />
    </div>
  );
}
