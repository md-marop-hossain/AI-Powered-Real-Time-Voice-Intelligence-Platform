import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";

import { Eyebrow } from "@/components/editorial/Eyebrow";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { durations, easeEditorial } from "@/lib/motion";

export default function InterviewCompletePage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  return (
    <div className="min-h-screen bg-canvas">
      <main className="editorial-container flex min-h-screen flex-col items-center justify-center py-16 text-center md:py-24">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: durations.base, ease: easeEditorial }}
          className="flex w-full max-w-2xl flex-col items-center"
        >
          <Eyebrow className="text-accent">INTERVIEW COMPLETE</Eyebrow>

          <h1 className="mt-8 font-display text-[40px] leading-tight text-ink md:text-[52px]">
            Thank you. The session is on the books.
          </h1>

          <p className="mt-6 max-w-prose text-body text-ink-soft">
            We've captured your responses and your report is being compiled.
            Take a breath — when you're ready, read the write-up or head back
            to your dashboard.
          </p>

          <div className="mt-12 flex w-full items-center justify-center gap-6">
            <span className="h-px w-12 bg-rule-strong" />
            <span className="font-mono text-eyebrow text-ink-muted">
              SESSION {sessionId?.slice(0, 8).toUpperCase() ?? "—"}
            </span>
            <span className="h-px w-12 bg-rule-strong" />
          </div>

          <HairlineDivider className="mt-12 w-full" />

          <div className="mt-12 flex flex-col items-center gap-8 md:flex-row md:justify-center md:gap-12">
            <EditorialButton
              onClick={() =>
                sessionId
                  ? navigate(`/sessions/${sessionId}/report`)
                  : navigate("/dashboard")
              }
              tone="ink"
              arrow
            >
              Read the report
            </EditorialButton>
            <EditorialButton onClick={() => navigate("/upload")} tone="accent">
              Start a new interview
            </EditorialButton>
            <EditorialButton onClick={() => navigate("/dashboard")} tone="muted">
              Back to dashboard
            </EditorialButton>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
