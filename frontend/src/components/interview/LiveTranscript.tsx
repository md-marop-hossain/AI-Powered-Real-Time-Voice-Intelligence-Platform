import { motion, AnimatePresence } from "framer-motion";
import { easeEditorial, durations } from "@/lib/motion";

export interface TranscriptLine {
  id: string;
  speaker: "interviewer" | "you";
  text: string;
  finalized: boolean;
}

interface Props {
  lines: TranscriptLine[];
  interim?: string | null;
}

/**
 * Live transcript: italic Fraunces while interim, upright body once finalized.
 * Marked aria-live=polite so screen readers announce new content.
 */
export function LiveTranscript({ lines, interim }: Props) {
  const recent = lines.slice(-2);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="mx-auto max-w-prose space-y-3 text-center"
    >
      <AnimatePresence initial={false}>
        {recent.map((l) => (
          <motion.p
            key={l.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: durations.base, ease: easeEditorial }}
            className={
              l.speaker === "you"
                ? "font-body text-[1.0625rem] leading-relaxed text-ink"
                : "font-body text-[1.0625rem] leading-relaxed text-ink-soft"
            }
          >
            {l.text}
          </motion.p>
        ))}
      </AnimatePresence>
      {interim && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: durations.quick, ease: easeEditorial }}
          className="font-display italic text-[18px] text-ink-muted leading-relaxed"
          style={{ fontVariationSettings: '"opsz" 36, "SOFT" 100' }}
        >
          {interim}
        </motion.p>
      )}
    </div>
  );
}
