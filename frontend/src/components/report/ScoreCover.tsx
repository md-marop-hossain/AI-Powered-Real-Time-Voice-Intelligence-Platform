import { motion } from "framer-motion";
import { easeEditorial, durations } from "@/lib/motion";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { PullQuote } from "@/components/editorial/PullQuote";

interface Props {
  date: string;
  score: number;
  pullQuote?: string;
}

function band(score: number): string {
  if (score >= 8.5) return "exceptional performance";
  if (score >= 7) return "strong performance";
  if (score >= 5.5) return "honest performance";
  if (score >= 4) return "uneven performance";
  return "a difficult run";
}

function heading(score: number): string {
  if (score >= 7) return "That was a good rehearsal.";
  if (score >= 5.5) return "An honest rehearsal.";
  return "That was a difficult one.";
}

function subForBand(score: number): string {
  if (score >= 8.5)
    return "You were prepared, you were precise, you were composed. Hold on to whatever you did to get here.";
  if (score >= 7)
    return "You handled the pressure and answered with shape and purpose. Tighten the edges and you'll be ready.";
  if (score >= 5.5)
    return "You found your way through. Some answers landed; others wanted another draft. Both are useful.";
  return "Difficult is good practice. The next pass will be easier — bring the parts that surprised you back into the room.";
}

export function ScoreCover({ date, score, pullQuote }: Props) {
  return (
    <section className="flex min-h-[80vh] flex-col items-center justify-center text-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: durations.base, ease: easeEditorial }}
      >
        <Eyebrow>SESSION REPORT — {date.toUpperCase()}</Eyebrow>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: durations.slow, ease: easeEditorial, delay: 0.1 }}
        className="mt-12 text-aggregate text-ink tabular-nums"
      >
        {score.toFixed(1)}
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: durations.base, ease: easeEditorial, delay: 0.3 }}
        className="mt-6 text-body text-ink-soft"
      >
        out of 10 — {band(score)}
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: durations.base, ease: easeEditorial, delay: 0.4 }}
        className="mt-16 text-display text-ink"
      >
        {heading(score)}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: durations.base, ease: easeEditorial, delay: 0.5 }}
        className="mt-6 max-w-prose text-body text-ink-soft"
      >
        {subForBand(score)}
      </motion.p>

      {pullQuote && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: durations.slow, ease: easeEditorial, delay: 0.65 }}
          className="mt-20"
        >
          <PullQuote attribution="Rehearsal">{pullQuote}</PullQuote>
        </motion.div>
      )}
    </section>
  );
}
