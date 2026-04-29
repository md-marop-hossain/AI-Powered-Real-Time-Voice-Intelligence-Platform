import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { Eyebrow } from "./Eyebrow";
import { EditorialButton } from "./EditorialButton";
import { easeEditorial, durations } from "@/lib/motion";

type Tone = "ink" | "accent";

interface ConfirmDialogProps {
  open: boolean;
  eyebrow?: string;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  loadingLabel?: string;
  cancelLabel?: string;
  confirmTone?: Tone;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Editorial confirmation modal — single-action confirm + cancel.
 * Matches the style of the existing delete-account modal.
 *
 * - Esc closes (unless `loading`)
 * - Click on backdrop closes (unless `loading`)
 * - Body scroll locked while open
 * - Cancel button autofocused
 */
export function ConfirmDialog({
  open,
  eyebrow,
  title,
  body,
  confirmLabel,
  loadingLabel,
  cancelLabel = "Cancel",
  confirmTone = "ink",
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = setTimeout(() => cancelRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(focusTimer);
    };
  }, [open, loading, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: durations.base, ease: easeEditorial }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
          onClick={loading ? undefined : onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: durations.base, ease: easeEditorial }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[480px] border border-rule bg-canvas p-8"
          >
            {eyebrow && (
              <Eyebrow
                className={confirmTone === "accent" ? "text-accent" : "text-ink-muted"}
              >
                {eyebrow}
              </Eyebrow>
            )}
            <h2
              id="confirm-dialog-title"
              className="mt-3 font-display text-[1.5rem] leading-tight text-ink"
            >
              {title}
            </h2>
            {body && <div className="mt-3 text-body text-ink-soft">{body}</div>}

            <div className="mt-8 flex justify-end gap-4">
              <EditorialButton
                ref={cancelRef}
                type="button"
                onClick={onClose}
                tone="muted"
                disabled={loading}
              >
                {cancelLabel}
              </EditorialButton>
              <EditorialButton
                type="button"
                onClick={onConfirm}
                tone={confirmTone}
                disabled={loading}
              >
                {loading ? (loadingLabel ?? "Working…") : confirmLabel}
              </EditorialButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
