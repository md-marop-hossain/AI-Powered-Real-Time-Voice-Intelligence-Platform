import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { easeEditorial, durations } from "@/lib/motion";

interface Props {
  /** Optional — register shortcuts the parent honors. */
  onSpace?: () => void;
  onEsc?: () => void;
  onArrowRight?: () => void;
}

const SHORTCUTS = [
  { keys: ["Space"], label: "Pause / resume answer" },
  { keys: ["Esc"], label: "End session" },
  { keys: ["→"], label: "Skip current question" },
  { keys: ["?"], label: "Show this dialog" },
];

export function KeyboardShortcuts({ onSpace, onEsc, onArrowRight }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isTyping) return;

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (open && e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (open) return;

      if (e.code === "Space") {
        e.preventDefault();
        onSpace?.();
      } else if (e.key === "Escape") {
        onEsc?.();
      } else if (e.key === "ArrowRight") {
        onArrowRight?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onSpace, onEsc, onArrowRight]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 font-mono text-eyebrow text-ink-muted hover:text-ink"
        aria-label="Show keyboard shortcuts"
      >
        ?  KEYS
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.quick, ease: easeEditorial }}
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 backdrop-blur-[8px]"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: durations.base, ease: easeEditorial }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[520px] bg-canvas-elevated px-12 py-12"
            >
              <Eyebrow>Keyboard</Eyebrow>
              <h2 className="mt-4 text-h1 text-ink">Shortcuts</h2>
              <div className="mt-10 space-y-5">
                {SHORTCUTS.map((s, i) => (
                  <div key={i}>
                    <div className="grid grid-cols-[120px_1fr] items-baseline gap-6 py-2">
                      <span className="font-mono text-small text-ink">
                        {s.keys.join(" + ")}
                      </span>
                      <span className="text-body text-ink-soft">{s.label}</span>
                    </div>
                    {i < SHORTCUTS.length - 1 && <HairlineDivider />}
                  </div>
                ))}
              </div>
              <p className="mt-10 text-small text-ink-muted">
                Press{" "}
                <span className="font-mono">?</span> any time to toggle this.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
