import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Eyebrow } from "@/components/editorial/Eyebrow";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";

export default function InterviewCompletePage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    // Reset scroll. The previous page (InterviewRoom) auto-scrolls to
    // document.scrollHeight when transcripts land, so by the time we
    // arrive here the window is parked at the bottom of the conversation
    // log. AnimatePresence also keeps the old page mounted as a sibling
    // for ~280ms during exit, which means the entering page renders
    // *below* the still-tall document. Without this, the candidate sees
    // a blank screen and has to scroll down to find the completion text.
    // We do it twice — once immediately, and once on the next frame after
    // the exit animation has had a chance to remove the old page from
    // layout — to cover both timings.
    window.scrollTo(0, 0);
    const id = window.requestAnimationFrame(() => window.scrollTo(0, 0));
    const t = window.setTimeout(() => window.scrollTo(0, 0), 320);
    return () => {
      window.cancelAnimationFrame(id);
      window.clearTimeout(t);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas py-16 text-center md:py-24">
      <main className="editorial-container w-full">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center">
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
        </div>
      </main>
    </div>
  );
}
