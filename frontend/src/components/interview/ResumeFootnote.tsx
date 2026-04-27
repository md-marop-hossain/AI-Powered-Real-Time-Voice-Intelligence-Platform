import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { easeEditorial, durations } from "@/lib/motion";

interface Props {
  /** Lines of context the AI may have drawn from for this question. */
  contextLines: string[];
}

/**
 * Bottom-right collapsible reveal: "why this question?" — shows the parts of
 * the résumé the AI is drawing on. Closed by default.
 */
export function ResumeFootnote({ contextLines }: Props) {
  const [open, setOpen] = useState(false);

  if (contextLines.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-30 max-w-[360px]">
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeEditorial }}
            className="mb-3 bg-canvas-elevated px-6 py-5 border-l border-rule-strong"
          >
            <Eyebrow className="mb-3 block">From your résumé</Eyebrow>
            <ul className="space-y-2 text-small text-ink-soft">
              {contextLines.map((c, i) => (
                <li key={i}>— {c}</li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={() => setOpen((v) => !v)}
        className="editorial-link is-quiet font-mono text-eyebrow text-ink-muted hover:text-ink"
      >
        — {open ? "hide" : "why this question?"}
      </button>
    </div>
  );
}
