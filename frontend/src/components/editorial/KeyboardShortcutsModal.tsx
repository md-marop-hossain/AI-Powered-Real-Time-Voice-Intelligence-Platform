import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils";
import { Eyebrow } from "./Eyebrow";
import { HairlineDivider } from "./HairlineDivider";
import { easeEditorial, durations } from "@/lib/motion";

const SHORTCUTS = [
  { keys: ["?"], description: "Open this shortcut guide" },
  { keys: ["G", "D"], description: "Go to dashboard" },
  { keys: ["G", "P"], description: "Go to practice (upload)" },
  { keys: ["G", "I"], description: "Go to invites" },
  { keys: ["G", "A"], description: "Go to account" },
  { keys: ["Esc"], description: "Close modal / dialog" },
];

export function KeyboardShortcutsModal() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      if (isInput) return;

      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    },
    [open],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduce ? undefined : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 backdrop-blur-[4px]"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
        >
          <motion.div
            initial={reduce ? undefined : { opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{
              duration: reduce ? 0 : durations.base,
              ease: easeEditorial,
            }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "w-full max-w-md mx-4",
              "border border-rule-strong bg-canvas-elevated",
              "p-8",
            )}
          >
            <div className="flex items-center justify-between mb-6">
              <Eyebrow>KEYBOARD SHORTCUTS</Eyebrow>
              <button
                onClick={() => setOpen(false)}
                className="font-mono text-eyebrow text-ink-muted hover:text-ink transition-colors"
                aria-label="Close"
              >
                ESC
              </button>
            </div>

            <HairlineDivider strong />

            <ul className="mt-4">
              {SHORTCUTS.map((s, i) => (
                <li key={i}>
                  <div className="flex items-center justify-between py-3">
                    <span className="text-small text-ink-soft">
                      {s.description}
                    </span>
                    <span className="flex items-center gap-1">
                      {s.keys.map((k, j) => (
                        <span key={j} className="flex items-center gap-1">
                          <kbd
                            className={cn(
                              "inline-flex h-6 min-w-[24px] items-center justify-center px-1.5",
                              "border border-rule-strong bg-canvas",
                              "font-mono text-[0.6875rem] text-ink-muted",
                              "rounded-[2px]",
                            )}
                          >
                            {k}
                          </kbd>
                          {j < s.keys.length - 1 && (
                            <span className="text-[0.625rem] text-ink-muted">
                              then
                            </span>
                          )}
                        </span>
                      ))}
                    </span>
                  </div>
                  {i < SHORTCUTS.length - 1 && <HairlineDivider />}
                </li>
              ))}
            </ul>

            <HairlineDivider strong className="mt-2" />

            <p className="mt-4 font-mono text-[0.625rem] text-ink-muted text-center">
              PRESS <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center px-1 border border-rule-strong bg-canvas font-mono text-[0.625rem] text-ink-muted rounded-[2px] mx-0.5">?</kbd> ANYWHERE TO TOGGLE
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
