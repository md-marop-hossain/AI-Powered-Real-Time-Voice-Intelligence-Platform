import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { easeEditorial, durations } from "@/lib/motion";
import { EditorialHeader } from "@/components/editorial/EditorialHeader";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { LoadingLine } from "@/components/editorial/LoadingLine";
import { ScoreCover } from "@/components/report/ScoreCover";
import { ScoreBars } from "@/components/report/ScoreBars";
import { PerQuestionArticle } from "@/components/report/PerQuestionArticle";
import { TranscriptPlayer } from "@/components/report/TranscriptPlayer";
import { PracticeAgainButton } from "@/components/report/PracticeAgainButton";

interface TurnSummary {
  index: number;
  kind: string;
  question: string;
  answer: string;
  scores: Record<string, number>;
  rationale: string;
  audio_url?: string | null;
}

interface ReportData {
  session_id: string;
  overall_score: number;
  pdf_url?: string | null;
  summary: {
    role: string;
    duration_minutes: number;
    started_at: string | null;
    ended_at: string | null;
    turn_count: number;
    overall_score: number;
    dimension_averages: Record<string, number>;
    turns: TurnSummary[];
    overall_assessment?: string;
    strengths?: string[];
    improvements?: string[];
  };
}

export default function ReportPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    api
      .get<ReportData>(`/sessions/${sessionId}/report`)
      .then((r) => setReport(r.data))
      .catch(() => toast.error("Something interrupted us. We're looking into it."))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const dateLabel = useMemo(() => {
    const d = report?.summary.started_at ?? report?.summary.ended_at;
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [report]);

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas">
        <EditorialHeader />
        <main className="editorial-container py-32">
          <LoadingLine />
        </main>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-canvas">
        <EditorialHeader />
        <main className="editorial-container py-32 text-center">
          <p className="text-display text-ink-soft">
            This page is somewhere else.
          </p>
        </main>
      </div>
    );
  }

  const { summary, overall_score, pdf_url } = report;
  const strengths = summary.strengths ?? [
    "Strong, structured opening to most answers",
    "Plain-language explanations of technical work",
    "Confident tone throughout",
  ];
  const improvements = summary.improvements ?? [
    "Spend less time setting context, more on the action",
    "Quantify outcomes where possible",
    "Reach for one specific story instead of a generalisation",
  ];

  return (
    <div className="min-h-screen bg-canvas">
      <EditorialHeader />
      <main className="editorial-container pt-8 pb-32">
        <div className="mb-12 flex items-center justify-between">
          <Eyebrow>{summary.role.toUpperCase()}</Eyebrow>
          <Eyebrow>
            {summary.turn_count} TURNS · {summary.duration_minutes} MIN
          </Eyebrow>
        </div>

        {/* Cover */}
        <ScoreCover
          date={dateLabel}
          score={overall_score}
          pullQuote={summary.overall_assessment}
        />

        {/* Score breakdown */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: durations.base, ease: easeEditorial }}
          className="mt-32"
        >
          <Eyebrow>Score by dimension</Eyebrow>
          <h2 className="mt-4 mb-12 text-h1 text-ink">Where it landed.</h2>
          <ScoreBars scores={summary.dimension_averages} />
        </motion.section>

        {/* Strengths / improvements */}
        <section className="mt-32 grid gap-16 md:grid-cols-2">
          <div>
            <Eyebrow>Strengths</Eyebrow>
            <ul className="mt-6 space-y-4">
              {strengths.map((s, i) => (
                <li
                  key={i}
                  className="text-body text-ink"
                >
                  <span className="text-ink-muted mr-3">—</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Eyebrow>Areas to improve</Eyebrow>
            <ul className="mt-6 space-y-4">
              {improvements.map((s, i) => (
                <li
                  key={i}
                  className="text-body text-ink"
                >
                  <span className="text-ink-muted mr-3">—</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <HairlineDivider strong className="mt-32" />

        {/* Per-question */}
        <section className="mt-16">
          <Eyebrow>The interview, in full</Eyebrow>
          <h2 className="mt-4 text-h1 text-ink">Question by question.</h2>
          <div className="mt-12">
            {summary.turns.map((t) => (
              <div key={t.index}>
                <PerQuestionArticle
                  index={t.index}
                  question={t.question}
                  answer={t.answer}
                  feedback={t.rationale}
                  scores={t.scores}
                />
                {t.audio_url && (
                  <div className="mb-12 ml-0 md:ml-[180px] max-w-prose">
                    <TranscriptPlayer
                      audioUrl={t.audio_url}
                      transcript={t.answer}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <HairlineDivider strong className="mt-20" />

        {/* Practice again */}
        <section className="mt-20">
          <PracticeAgainButton
            onSameRoleHarder={() => navigate("/upload")}
            onDifferentRole={() => navigate("/upload")}
            onDrillStruggles={() => navigate("/upload")}
          />
        </section>

        {/* Action footer */}
        <footer className="mt-32 flex flex-wrap items-baseline justify-center gap-8 border-t border-rule pt-12 text-small">
          {pdf_url && (
            <a
              href={pdf_url}
              target="_blank"
              rel="noreferrer"
              className="editorial-link text-ink"
            >
              Download as PDF
            </a>
          )}
          <span className="text-ink-muted">·</span>
          <button
            onClick={() => navigate("/upload")}
            className="editorial-link text-ink"
          >
            Practice again
          </button>
          <span className="text-ink-muted">·</span>
          <a
            href={`mailto:?subject=My%20Rehearsal%20report&body=${encodeURIComponent(
              window.location.href,
            )}`}
            className="editorial-link text-ink"
          >
            Share with a coach
          </a>
        </footer>
      </main>
    </div>
  );
}
