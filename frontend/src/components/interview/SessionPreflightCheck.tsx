import { useEffect, useRef, useState } from "react";
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

/**
 * 3-step preflight before InterviewRoom: mic permission, server reachability,
 * and a 3-second voice clarity test the user can hear back.
 */
export function SessionPreflightCheck({ onReady }: Props) {
  const [mic, setMic] = useState<CheckState>("pending");
  const [server, setServer] = useState<CheckState>("pending");
  const [voice, setVoice] = useState<CheckState>("pending");
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);

  const mediaRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    runMic();
    runServer();
    return () => {
      mediaRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runMic = async () => {
    setMic("running");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;
      setMic("passed");
    } catch {
      setMic("failed");
    }
  };

  const runServer = async () => {
    setServer("running");
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
      const r = await fetch(`${apiUrl}/health`);
      if (!r.ok) throw new Error();
      setServer("passed");
    } catch {
      setServer("failed");
    }
  };

  const runVoiceTest = async () => {
    if (!mediaRef.current) return;
    setVoice("running");
    setRecordedUrl(null);

    try {
      const recorder = new MediaRecorder(mediaRef.current);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: chunks[0]?.type ?? "audio/webm" });
        setRecordedUrl(URL.createObjectURL(blob));
      };
      recorder.start();
      await new Promise((res) => setTimeout(res, 3000));
      recorder.stop();
    } catch {
      setVoice("failed");
    }
  };

  const playRecording = () => {
    if (!recordedUrl) return;
    setVoicePlaying(true);
    const audio = new Audio(recordedUrl);
    audio.onended = () => setVoicePlaying(false);
    audio.play();
  };

  const allPassed = mic === "passed" && server === "passed" && voice === "passed";

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durations.base, ease: easeEditorial }}
      className="mx-auto max-w-[680px]"
    >
      <NumberedMarker index={3} total={3} label="PREFLIGHT" className="mb-12 block" />
      <h1 className="text-display text-ink">
        Three quick checks before we begin.
      </h1>
      <p className="mt-6 text-body text-ink-soft">
        We'd rather catch trouble here than during your answer.
      </p>

      <div className="mt-16 space-y-6">
        <Step
          index={1}
          label="Microphone access"
          state={mic}
          retry={mic === "failed" ? runMic : undefined}
          hint={mic === "failed" ? "Allow microphone access in your browser, then retry." : undefined}
        />
        <HairlineDivider />
        <Step
          index={2}
          label="Connection to the room"
          state={server}
          retry={server === "failed" ? runServer : undefined}
          hint={server === "failed" ? "We can't reach the interview server." : undefined}
        />
        <HairlineDivider />
        <Step
          index={3}
          label="Voice clarity"
          state={voice}
          hint={
            voice === "pending"
              ? "Record three seconds, play it back, confirm it's you."
              : undefined
          }
        >
          {voice === "pending" && mic === "passed" && (
            <EditorialButton onClick={runVoiceTest} arrow>
              Record 3 seconds
            </EditorialButton>
          )}
          {voice === "running" && (
            <Eyebrow className="text-accent">Recording…</Eyebrow>
          )}
          {recordedUrl && voice === "running" && (
            <div className="flex flex-wrap items-center gap-6">
              <EditorialButton onClick={playRecording} disabled={voicePlaying}>
                {voicePlaying ? "Playing…" : "Play it back"}
              </EditorialButton>
              <span className="text-small text-ink-soft">
                Did that sound like you?
              </span>
              <div className="flex gap-6">
                <EditorialButton onClick={() => setVoice("passed")} tone="ink">
                  Yes
                </EditorialButton>
                <EditorialButton onClick={runVoiceTest} tone="muted">
                  Try again
                </EditorialButton>
              </div>
            </div>
          )}
        </Step>
      </div>

      <HairlineDivider className="mt-12" />

      <div className="mt-12 flex items-center justify-between">
        <Eyebrow>{allPassed ? "Ready" : "Awaiting checks"}</Eyebrow>
        <EditorialButton
          onClick={onReady}
          disabled={!allPassed}
          filled
          arrow
        >
          {allPassed ? "I'M READY" : "WAITING"}
        </EditorialButton>
      </div>
    </motion.section>
  );
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
    return (
      <span className="font-mono text-eyebrow text-ink-muted">CHECKING…</span>
    );
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
