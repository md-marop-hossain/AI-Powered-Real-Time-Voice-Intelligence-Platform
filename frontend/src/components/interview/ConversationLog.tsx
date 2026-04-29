import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { easeEditorial, durations } from "@/lib/motion";

export interface ConversationTurn {
  index: number;
  question: string;
  answer?: string;
  interim?: string;
  status: "asking" | "listening" | "speaking" | "thinking" | "answered";
}

interface Props {
  turns: ConversationTurn[];
}

const STATUS_LABEL: Record<ConversationTurn["status"], string> = {
  asking: "REHEARSAL IS ASKING",
  listening: "LISTENING",
  speaking: "YOU ARE SPEAKING",
  thinking: "CONSIDERING YOUR ANSWER",
  answered: "ANSWERED",
};

/**
 * Chronological conversation log: every Q + A turn rendered as a list item.
 * Auto-scrolls to the newest turn.
 */
export function ConversationLog({ turns }: Props) {
  const endRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, turns[turns.length - 1]?.answer, turns[turns.length - 1]?.interim]);

  if (turns.length === 0) {
    return (
      <p className="text-center text-small text-ink-muted">
        The transcript will appear here as the conversation unfolds.
      </p>
    );
  }

  return (
    <ol className="mx-auto max-w-prose space-y-10 px-4">
      <AnimatePresence initial={false}>
        {turns.map((t, i) => {
          const isLast = i === turns.length - 1;
          return (
            <motion.li
              key={t.index}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: durations.base, ease: easeEditorial }}
              className="group relative -mx-3 rounded-[2px] px-3 pt-3 pb-1 pl-12 transition-colors duration-base ease-editorial hover:bg-canvas-elevated/60"
              ref={isLast ? endRef : undefined}
            >
              {/* New-turn glow line — draws across the top once on enter. */}
              <motion.span
                aria-hidden="true"
                initial={{ scaleX: 0, opacity: 0.7 }}
                animate={{ scaleX: 1, opacity: 0 }}
                transition={{ duration: 0.9, ease: easeEditorial }}
                className="pointer-events-none absolute left-0 right-0 top-0 h-px origin-left bg-accent"
              />
              <span
                aria-hidden="true"
                className="absolute left-0 top-4 font-mono text-eyebrow text-ink-muted transition-[color,transform] duration-base ease-editorial group-hover:-translate-x-1 group-hover:text-ink"
              >
                {String(t.index).padStart(2, "0")}
              </span>

              {/* Question */}
              <div>
                <span className="mb-2 block font-mono text-eyebrow text-ink-muted">
                  INTERVIEWER
                </span>
                <p className="font-display text-[1.25rem] leading-snug text-ink">
                  &ldquo;{t.question}&rdquo;
                </p>
              </div>

              {/* Answer */}
              <div className="mt-5">
                <span className="mb-2 flex items-center gap-2 font-mono text-eyebrow text-ink-muted">
                  YOU
                  {isLast && t.status !== "answered" && (
                    <StatusPill status={t.status} />
                  )}
                </span>

                {t.answer ? (
                  <p className="text-body leading-relaxed text-ink">{t.answer}</p>
                ) : t.interim ? (
                  <p className="font-display italic leading-relaxed text-ink-soft">
                    <WordReveal text={t.interim} keyPrefix={t.index} />
                    <BlinkingCaret />
                  </p>
                ) : (
                  <p className="text-body italic text-ink-muted">
                    {placeholderFor(t.status)}
                  </p>
                )}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

function placeholderFor(status: ConversationTurn["status"]): string {
  switch (status) {
    case "asking":
      return "(Rehearsal is finishing the question…)";
    case "listening":
      return "(When you're ready — speak naturally.)";
    case "speaking":
      return "(Listening…)";
    case "thinking":
      return "(Processing your answer…)";
    default:
      return "(Waiting for your answer.)";
  }
}

function StatusPill({ status }: { status: ConversationTurn["status"] }) {
  const tone =
    status === "speaking"
      ? "text-accent"
      : status === "thinking"
        ? "text-ink"
        : "text-ink-muted";
  const dot =
    status === "speaking"
      ? "bg-accent animate-pulse"
      : status === "thinking"
        ? "bg-ink animate-pulse"
        : "bg-ink-muted";
  return (
    <span className={`flex items-center gap-1.5 ${tone}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function BlinkingCaret() {
  return (
    <motion.span
      aria-hidden="true"
      animate={{ opacity: [1, 0.2, 1] }}
      transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
      className="ml-1 inline-block h-[1em] w-[2px] -mb-[0.1em] bg-ink-muted"
    />
  );
}

/**
 * Word-by-word reveal for the live interim transcript. Each word is keyed by
 * its position so framer-motion only animates *new* words appended at the end
 * — words that already existed don't re-animate when the next interim update
 * arrives. Result: the candidate sees their speech stream in word by word
 * instead of the whole string flickering each tick.
 */
function WordReveal({ text, keyPrefix }: { text: string; keyPrefix: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((w, i) => (
        <motion.span
          key={`${keyPrefix}-${i}`}
          initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.22, ease: easeEditorial }}
          className="inline-block"
        >
          {w}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </>
  );
}
