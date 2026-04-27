import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { easeEditorial, durations } from "@/lib/motion";
import { EditorialHeader } from "@/components/editorial/EditorialHeader";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { LoadingLine } from "@/components/editorial/LoadingLine";
import { EmptyState } from "@/components/editorial/EmptyState";

interface SessionRow {
  id: string;
  role: string;
  duration_minutes: number;
  status: string;
  created_at: string;
  final_scores: { overall_score?: number } | null;
}

interface MonthGroup {
  monthKey: string;
  monthLabel: string;
  rows: SessionRow[];
}

const MONTH_FORMATTER = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
});

function groupByMonth(rows: SessionRow[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const r of rows) {
    const d = new Date(r.created_at);
    const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
    if (!groups.has(monthKey)) {
      groups.set(monthKey, {
        monthKey,
        monthLabel: MONTH_FORMATTER.format(d).toUpperCase(),
        rows: [],
      });
    }
    groups.get(monthKey)!.rows.push(r);
  }
  return Array.from(groups.values());
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<SessionRow[]>("/sessions")
      .then((r) => setSessions(r.data))
      .catch(() => toast.error("Something interrupted us. We're looking into it."))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => groupByMonth(sessions), [sessions]);

  return (
    <div className="min-h-screen bg-canvas">
      <EditorialHeader />
      <main className="editorial-container py-16 md:py-24">
        <header className="mb-16 flex items-end justify-between">
          <div>
            <Eyebrow>The library of your rehearsals</Eyebrow>
            <h1 className="mt-4 text-display text-ink">Sessions</h1>
          </div>
          <Link to="/upload" className="editorial-link text-ink">
            Begin a new session <span aria-hidden="true">→</span>
          </Link>
        </header>

        {loading ? (
          <div className="py-32">
            <LoadingLine />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            title="You haven't rehearsed yet."
            actionLabel="Begin your first session"
            to="/upload"
          />
        ) : (
          <div className="space-y-20">
            {groups.map((g, i) => (
              <motion.section
                key={g.monthKey}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: durations.base,
                  ease: easeEditorial,
                  delay: 0.05 * i,
                }}
              >
                <div className="mb-6 flex items-end justify-between">
                  <Eyebrow>Sessions</Eyebrow>
                  <Eyebrow>{g.monthLabel}</Eyebrow>
                </div>
                <HairlineDivider strong />
                <ol>
                  {g.rows.map((row) => (
                    <SessionRowItem key={row.id} row={row} />
                  ))}
                </ol>
              </motion.section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function SessionRowItem({ row }: { row: SessionRow }) {
  const number = row.id.slice(0, 3).toUpperCase();
  const score = row.final_scores?.overall_score ?? null;

  return (
    <li>
      <Link
        to={`/sessions/${row.id}/report`}
        className="group grid grid-cols-[80px_1fr_auto_24px] items-baseline gap-6 py-6 transition-colors duration-base ease-editorial hover:bg-canvas-elevated"
      >
        <span className="font-mono text-small text-ink-muted tabular-nums">
          {number}
        </span>
        <span className="text-body text-ink">
          {row.role}
          <span className="ml-3 font-mono text-eyebrow text-ink-muted">
            · {row.duration_minutes} MIN
          </span>
        </span>
        <span
          className="font-display text-h2 text-ink transition-colors duration-base ease-editorial group-hover:text-accent"
          style={{ fontVariationSettings: '"opsz" 36' }}
        >
          {score !== null ? score.toFixed(1) : "—"}
        </span>
        <span
          aria-hidden="true"
          className="text-ink transition-transform duration-base ease-editorial group-hover:translate-x-2 group-hover:text-accent"
        >
          →
        </span>
      </Link>
      <HairlineDivider />
    </li>
  );
}
