import { motion, AnimatePresence } from "framer-motion";

import { NumberedMarker } from "@/components/editorial/NumberedMarker";
import { easeEditorial, durations } from "@/lib/motion";

interface Props {
  /** Question index (1-based). When this changes, the card cross-fades. */
  index: number | null;
  /** Question text. */
  text: string;
  /** Seconds the AI took to ask this question (TTS duration). Hidden while speaking. */
  askedDuration: number | null;
  /** True while the AI is speaking this question. */
  isAsking: boolean;
  /** Plan-level progress: 1-based primary index and total primary count. Both
   *  must be present to render "Q{n} of {total}". Follow-ups carry the same
   *  primary index, so the badge reads stably across a probe sequence. */
  planIndex?: number | null;
  planTotal?: number | null;
}

/**
 * Editorial card for the active interview question. Drives a per-index
 * cross-fade so each new question reads as its own moment, not a swap.
 *
 * Pure presentation — all timing comes from the parent (`isAsking`,
 * `askedDuration`).
 */
export function QuestionCard({
  index,
  text,
  askedDuration,
  isAsking,
  planIndex,
  planTotal,
}: Props) {
  const showProgress =
    typeof planIndex === "number" &&
    typeof planTotal === "number" &&
    planTotal > 0;
  return (
    <AnimatePresence mode="wait">
      {index !== null ? (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(2px)" }}
          transition={{ duration: durations.slow, ease: easeEditorial }}
          className="max-w-prose"
        >
          <div className="mb-6 flex items-baseline gap-3">
            <NumberedMarker index={`Q${index}`} />
            {showProgress && (
              <span className="font-mono text-eyebrow tracking-[0.18em] text-ink-muted">
                {planIndex} OF {planTotal}
              </span>
            )}
          </div>

          {/* Word-by-word reveal so the question reads as it's spoken. */}
          <p className="text-question text-ink">
            <span aria-hidden="true">&ldquo;</span>
            <WordStream text={text} />
            <span aria-hidden="true">&rdquo;</span>
          </p>

          <AnimatePresence>
            {askedDuration !== null && !isAsking && (
              <motion.p
                key="asked-meta"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: durations.base, ease: easeEditorial }}
                className="mt-6 font-mono text-eyebrow text-ink-muted"
              >
                — asked by Rehearsal · {askedDuration.toFixed(1)}s
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>
      ) : (
        <motion.p
          key="waiting"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: durations.base, ease: easeEditorial }}
          className="text-body text-ink-muted"
        >
          Waiting for the first question…
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/**
 * Splits the question into words and fades each one in with a gentle stagger.
 * Effect is similar to a Lottie/After-Effects letter-stream but driven by
 * framer-motion only — no external runtime, no JSON file to ship.
 */
function WordStream({ text }: { text: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((word, i) => (
        <motion.span
          key={`${i}-${word}`}
          initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{
            duration: 0.32,
            ease: easeEditorial,
            delay: 0.12 + i * 0.022,
          }}
          className="inline-block"
        >
          {word}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </>
  );
}
