import { motion } from "framer-motion";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { NumberedMarker } from "@/components/editorial/NumberedMarker";
import { easeEditorial, durations } from "@/lib/motion";

interface Props {
  /** Called when the candidate explicitly clicks "Begin interview". The
   *  caller is expected to use this user-gesture to request fullscreen. */
  onAccept: () => void;
}

interface Rule {
  title: string;
  body: string;
}

const RULES: Rule[] = [
  {
    title: "Stay on this tab.",
    body:
      "Switching tabs, opening another window, or minimising counts as a focus interruption. Three interruptions end the session.",
  },
  {
    title: "Stay in fullscreen.",
    body:
      "Pressing Esc or F11 exits fullscreen and is also counted as an interruption. Click \"Return to interview\" if it happens by accident.",
  },
  {
    title: "Speak naturally.",
    body:
      "Pauses, restarts, and fillers are fine — the interviewer waits about 2.5 seconds of silence before treating an answer as complete.",
  },
  {
    title: "Take your time to think.",
    body:
      "If you need a moment, just pause. If you'd like a beat to gather your thoughts, the interviewer will gently invite you to continue rather than move on.",
  },
  {
    title: "End on your terms.",
    body:
      "Click \"End session\" at any time, or simply say \"stop the interview\" out loud. Your progress is always saved.",
  },
];

/**
 * Brief rules-of-the-room gate. Sits between the preflight check and the
 * live WebSocket session — gives the candidate a moment to acknowledge the
 * focus-integrity policy before mic capture and TTS playback begin.
 */
export function InterviewRules({ onAccept }: Props) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durations.base, ease: easeEditorial }}
      className="mx-auto max-w-[680px]"
    >
      <NumberedMarker
        index="00"
        label="BEFORE YOU BEGIN"
        className="mb-12 block"
      />
      <h1 className="text-display text-ink">A few rules of the room.</h1>
      <p className="mt-6 text-body text-ink-soft">
        Mock interviews work best when the room behaves like a real one. A
        quick read — then we begin.
      </p>

      <ol className="mt-16 space-y-8">
        {RULES.map((rule, i) => (
          <motion.li
            key={rule.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: durations.base,
              ease: easeEditorial,
              delay: 0.05 + i * 0.06,
            }}
            className="grid grid-cols-[40px_1fr] items-baseline gap-6"
          >
            <span className="font-mono text-eyebrow text-ink-muted">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <p className="font-display text-[1.0625rem] leading-snug text-ink">
                {rule.title}
              </p>
              <p className="mt-2 text-small text-ink-soft">{rule.body}</p>
            </div>
          </motion.li>
        ))}
      </ol>

      <HairlineDivider className="mt-14" />

      <div className="mt-10 flex items-center justify-between">
        <Eyebrow className="text-ink-muted">
          Clicking begin enters fullscreen and starts mic capture.
        </Eyebrow>
        <EditorialButton onClick={onAccept} filled arrow>
          BEGIN INTERVIEW
        </EditorialButton>
      </div>
    </motion.section>
  );
}
