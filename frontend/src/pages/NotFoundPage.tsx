import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";

import { Eyebrow } from "@/components/editorial/Eyebrow";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { easeEditorial, durations } from "@/lib/motion";

export default function NotFoundPage() {
  const reduce = useReducedMotion();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
      <motion.div
        initial={reduce ? undefined : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduce ? 0 : durations.slow,
          ease: easeEditorial,
        }}
        className="flex flex-col items-center"
      >
        <motion.p
          initial={reduce ? undefined : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: reduce ? 0 : durations.slow,
            ease: easeEditorial,
            delay: reduce ? 0 : 0.1,
          }}
          className="text-aggregate text-ink-muted/20"
          aria-hidden="true"
        >
          404
        </motion.p>

        <Eyebrow className="mt-4 text-accent">PAGE NOT FOUND</Eyebrow>

        <h1 className="mt-6 text-display text-ink">
          This page wandered off.
        </h1>

        <p className="mt-4 max-w-md text-body text-ink-soft">
          The page you&rsquo;re looking for doesn&rsquo;t exist, was moved, or
          never made it past the interview. Let&rsquo;s get you back on track.
        </p>

        <HairlineDivider className="mt-10 w-full max-w-xs" />

        <div className="mt-10 flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
          <Link to="/dashboard">
            <EditorialButton tone="ink" arrow>
              Back to sessions
            </EditorialButton>
          </Link>
          <Link to="/">
            <EditorialButton tone="muted">
              Go to homepage
            </EditorialButton>
          </Link>
        </div>

        <motion.div
          initial={reduce ? undefined : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: reduce ? 0 : durations.slow,
            ease: easeEditorial,
            delay: reduce ? 0 : 0.3,
          }}
          className="mt-16 font-mono text-[0.625rem] text-ink-muted/50"
        >
          ERROR CODE · NOT_FOUND · {new Date().toISOString().split("T")[0]}
        </motion.div>
      </motion.div>
    </div>
  );
}
