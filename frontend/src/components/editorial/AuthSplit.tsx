import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { easeEditorial, durations } from "@/lib/motion";
import { Eyebrow } from "./Eyebrow";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  eyebrow: string;
  heading: React.ReactNode;
  sub: string;
  formTitle: string;
  children: React.ReactNode;
  footnote?: React.ReactNode;
}

/**
 * Split-screen layout for auth pages. Left: editorial copy. Right: form on canvas.
 */
export function AuthSplit({ eyebrow, heading, sub, formTitle, children, footnote }: Props) {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[60%_40%]">
        <motion.section
          initial="initial"
          animate="animate"
          transition={{ staggerChildren: 0.08, delayChildren: 0.05 }}
          className={cn(
            "relative flex flex-col justify-between",
            "px-6 py-16 md:px-20 md:py-24",
            "border-b border-rule lg:border-b-0 lg:border-r",
          )}
        >
          <motion.div
            variants={{
              initial: { opacity: 0, y: 16 },
              animate: { opacity: 1, y: 0, transition: { duration: durations.base, ease: easeEditorial } },
            }}
            className="flex items-center justify-between gap-4"
          >
            <Link
              to="/login"
              className="font-display text-[22px] font-medium text-ink"
              style={{ fontVariationSettings: '"opsz" 36' }}
            >
              Rehearsal
            </Link>
            <ThemeToggle />
          </motion.div>

          <div className="max-w-[680px]">
            <motion.div
              variants={{
                initial: { opacity: 0, y: 16 },
                animate: { opacity: 1, y: 0, transition: { duration: durations.base, ease: easeEditorial } },
              }}
              className="mb-10"
            >
              <Eyebrow>{eyebrow}</Eyebrow>
            </motion.div>
            <motion.h1
              variants={{
                initial: { opacity: 0, y: 24 },
                animate: { opacity: 1, y: 0, transition: { duration: durations.slow, ease: easeEditorial } },
              }}
              className="text-hero text-ink"
            >
              {heading}
            </motion.h1>
            <motion.p
              variants={{
                initial: { opacity: 0, y: 16 },
                animate: { opacity: 1, y: 0, transition: { duration: durations.base, ease: easeEditorial } },
              }}
              className="mt-10 max-w-[520px] text-body text-ink-soft"
            >
              {sub}
            </motion.p>
          </div>

          <motion.div
            variants={{
              initial: { opacity: 0 },
              animate: { opacity: 1, transition: { duration: durations.base, ease: easeEditorial } },
            }}
            className="hidden md:flex items-center justify-between text-eyebrow text-ink-muted"
          >
            <span>EST. 2026</span>
            <span>A REHEARSAL ROOM</span>
          </motion.div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: durations.slow, ease: easeEditorial, delay: 0.15 }}
          className={cn(
            "flex flex-col justify-center",
            "px-6 py-16 md:px-16 md:py-24 lg:px-20",
          )}
        >
          <div className="mx-auto w-full max-w-[420px]">
            <Eyebrow as="h2">{formTitle}</Eyebrow>
            <div className="mt-10 space-y-8">{children}</div>
            {footnote && (
              <div className="mt-12 text-small text-ink-muted">{footnote}</div>
            )}
          </div>
        </motion.section>
      </div>
    </div>
  );
}

interface UnderlineProps {
  children: React.ReactNode;
}

/** A single vermillion underline accent under one word in the hero.
 *  The line draws in from the left on mount so the highlight feels
 *  intentional rather than just static decoration. */
export function VermillionUnderline({ children }: UnderlineProps) {
  return (
    <span className="relative inline-block">
      {children}
      <motion.span
        aria-hidden="true"
        className="absolute left-0 right-0 -bottom-1 h-[2px] origin-left bg-accent"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: durations.slow, ease: easeEditorial, delay: 0.4 }}
      />
    </span>
  );
}
