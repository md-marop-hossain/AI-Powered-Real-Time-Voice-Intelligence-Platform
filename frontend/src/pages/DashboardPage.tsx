import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { easeEditorial, durations } from "@/lib/motion";
import { EditorialHeader } from "@/components/editorial/EditorialHeader";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { LoadingLine } from "@/components/editorial/LoadingLine";
import { EmptyState } from "@/components/editorial/EmptyState";
import { ConfirmDialog } from "@/components/editorial/ConfirmDialog";
import { ScoreTrend } from "@/components/dashboard/ScoreTrend";

interface ReceivedInvite {
  token: string;
  role: string;
  seniority: string | null;
  focus: string | null;
  industry: string | null;
  duration_minutes: number;
  expires_at: string;
  attempts_remaining: number;
  creator_name: string | null;
  invitee_status: string;
}

interface SessionRow {
  id: string;
  role: string;
  duration_minutes: number;
  status: string;
  created_at: string;
  final_scores: { overall_score?: number } | null;
}

interface StatsResponse {
  sessions_total: number;
  sessions_completed: number;
  total_practice_minutes: number;
  avg_overall_score: number | null;
  best_overall_score: number | null;
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

type FilterStatus = "all" | "completed" | "pending" | "in_progress";

export default function DashboardPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [receivedInvites, setReceivedInvites] = useState<ReceivedInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<SessionRow | null>(null);

  useEffect(() => {
    Promise.allSettled([
      api.get<SessionRow[]>("/sessions").then((r) => setSessions(r.data)),
      api.get<StatsResponse>("/auth/me/stats").then((r) => setStats(r.data)),
      api
        .get<ReceivedInvite[]>("/invites/received")
        .then((r) => setReceivedInvites(r.data))
        .catch(() => {}), // non-critical — silently skip if unavailable
    ])
      .catch(() => toast.error("Something interrupted us. We're looking into it."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (filter !== "all" && s.status !== filter) return false;
      if (q && !s.role.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sessions, filter, search]);

  const groups = useMemo(() => groupByMonth(filtered), [filtered]);

  const trendPoints = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            s.status === "completed" &&
            typeof s.final_scores?.overall_score === "number",
        )
        .map((s) => ({
          date: s.created_at,
          score: s.final_scores!.overall_score as number,
        })),
    [sessions],
  );

  const onDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await api.delete(`/sessions/${id}`);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast.success("Session deleted.");
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "Couldn't delete that session.");
    } finally {
      setDeletingId(null);
      setConfirmingDelete(null);
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <EditorialHeader />
      <main className="editorial-container py-16 md:py-24">
        <header className="mb-16 flex items-end justify-between gap-6">
          <div>
            <Eyebrow>The library of your rehearsals</Eyebrow>
            <h1 className="mt-4 text-display text-ink">Sessions</h1>
          </div>
          <Link to="/upload" className="editorial-link text-ink">
            Begin a new session <span aria-hidden="true">→</span>
          </Link>
        </header>

        {/* Pending invitations — shown only when the user has actionable invites */}
        {receivedInvites.filter(
          (inv) =>
            inv.invitee_status !== "completed" &&
            inv.attempts_remaining > 0 &&
            new Date(inv.expires_at) > new Date(),
        ).length > 0 && (
          <section className="mb-16">
            <div className="mb-8">
              <Eyebrow className="text-accent">Waiting for you</Eyebrow>
              <h2 className="mt-3 font-display text-[28px] leading-tight text-ink md:text-[36px]">
                Pending Invitations
              </h2>
            </div>
            <HairlineDivider strong />
            <ul>
              {receivedInvites
                .filter(
                  (inv) =>
                    inv.invitee_status !== "completed" &&
                    inv.attempts_remaining > 0 &&
                    new Date(inv.expires_at) > new Date(),
                )
                .map((inv) => (
                  <li key={inv.token}>
                    <div className="group grid w-full grid-cols-[1fr_auto_auto_auto] items-baseline gap-6 py-6 transition-colors duration-base ease-editorial hover:bg-canvas-elevated">
                      <div>
                        <p className="text-body text-ink">{inv.role}</p>
                        <p className="mt-1 font-mono text-eyebrow text-ink-muted">
                          {inv.creator_name
                            ? `From ${inv.creator_name}`
                            : "Mock interview"}
                          {" · "}
                          {inv.duration_minutes} MIN
                          {inv.seniority
                            ? ` · ${inv.seniority.toUpperCase()}`
                            : ""}
                        </p>
                      </div>
                      <span className="font-mono text-eyebrow text-ink-muted tabular-nums">
                        {inv.attempts_remaining} ATTEMPT
                        {inv.attempts_remaining !== 1 ? "S" : ""} LEFT
                      </span>
                      <span
                        className={
                          inv.invitee_status === "in_progress"
                            ? "font-mono text-eyebrow text-ink"
                            : "font-mono text-eyebrow text-ink-muted"
                        }
                      >
                        {inv.invitee_status === "in_progress"
                          ? "IN PROGRESS"
                          : "PENDING"}
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate(`/invite/${inv.token}`)}
                        className="font-mono text-eyebrow text-accent transition-colors duration-base ease-editorial hover:text-ink"
                      >
                        JOIN →
                      </button>
                    </div>
                    <HairlineDivider />
                  </li>
                ))}
            </ul>
          </section>
        )}

        {/* Score trend — only renders when there are 2+ scored sessions. */}
        <ScoreTrend points={trendPoints} />

        {/* Stats strip */}
        {stats && stats.sessions_total > 0 && (
          <section className="mb-16">
            <HairlineDivider />
            <div className="grid grid-cols-2 gap-x-6 gap-y-8 py-8 md:grid-cols-4">
              <DashStat label="Sessions" value={stats.sessions_total.toString()} />
              <DashStat
                label="Completed"
                value={stats.sessions_completed.toString()}
              />
              <DashStat
                label="Avg score"
                value={
                  stats.avg_overall_score !== null
                    ? stats.avg_overall_score.toFixed(1)
                    : "—"
                }
              />
              <DashStat
                label="Practiced"
                value={formatPracticeTime(stats.total_practice_minutes)}
              />
            </div>
            <HairlineDivider />
          </section>
        )}

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
          <>
            {/* Filter / search */}
            <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
              <ul className="flex flex-wrap gap-2">
                {(["all", "completed", "in_progress", "pending"] as FilterStatus[]).map(
                  (k) => {
                    const isActive = filter === k;
                    const count =
                      k === "all"
                        ? sessions.length
                        : sessions.filter((s) => s.status === k).length;
                    return (
                      <li key={k}>
                        <button
                          type="button"
                          onClick={() => setFilter(k)}
                          className={
                            isActive
                              ? "border border-ink bg-ink px-3 py-1.5 font-mono text-eyebrow text-canvas"
                              : "border border-rule bg-canvas px-3 py-1.5 font-mono text-eyebrow text-ink hover:border-ink"
                          }
                        >
                          {k.replace("_", " ").toUpperCase()} · {count}
                        </button>
                      </li>
                    );
                  },
                )}
              </ul>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by role…"
                className="editorial-input w-full max-w-[260px]"
                aria-label="Filter sessions by role"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="py-16 text-center text-body text-ink-muted">
                No sessions match that filter.
              </p>
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
                        <SessionRowItem
                          key={row.id}
                          row={row}
                          deleting={deletingId === row.id}
                          onOpen={() => navigate(`/sessions/${row.id}/report`)}
                          onDelete={() => setConfirmingDelete(row)}
                        />
                      ))}
                    </ol>
                  </motion.section>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <ConfirmDialog
        open={confirmingDelete !== null}
        eyebrow="Delete session"
        title="Delete this session and its report?"
        body={
          confirmingDelete ? (
            <>
              <span className="text-ink">{confirmingDelete.role}</span>
              {" · "}
              {confirmingDelete.duration_minutes} min
              {" · "}
              {new Date(confirmingDelete.created_at).toLocaleDateString("en", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              <span className="mt-3 block text-small text-ink-muted">
                Every question, answer and score will be removed. This cannot be
                undone.
              </span>
            </>
          ) : null
        }
        confirmLabel="Delete forever"
        loadingLabel="Deleting…"
        confirmTone="accent"
        loading={deletingId !== null}
        onClose={() => setConfirmingDelete(null)}
        onConfirm={() => confirmingDelete && onDelete(confirmingDelete.id)}
      />
    </div>
  );
}

function SessionRowItem({
  row,
  deleting,
  onOpen,
  onDelete,
}: {
  row: SessionRow;
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const number = row.id.slice(0, 3).toUpperCase();
  const score = row.final_scores?.overall_score ?? null;
  return (
    <li>
      <div className="group grid grid-cols-[80px_1fr_auto_auto_auto] items-baseline gap-6 py-6 transition-colors duration-base ease-editorial hover:bg-canvas-elevated">
        <button
          type="button"
          onClick={onOpen}
          className="text-left font-mono text-small text-ink-muted tabular-nums"
        >
          {number}
        </button>
        <button type="button" onClick={onOpen} className="text-left text-body text-ink">
          {row.role}
          <span className="ml-3 font-mono text-eyebrow text-ink-muted">
            · {row.duration_minutes} MIN · {row.status.replace("_", " ").toUpperCase()}
          </span>
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="font-display text-h2 text-ink transition-colors duration-base ease-editorial group-hover:text-accent"
          style={{ fontVariationSettings: '"opsz" 36' }}
        >
          {score !== null ? score.toFixed(1) : "—"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="editorial-link font-mono text-eyebrow text-ink-muted hover:text-accent disabled:text-ink-muted"
        >
          {deleting ? "DELETING…" : "DELETE"}
        </button>
        <button
          type="button"
          onClick={onOpen}
          aria-hidden="true"
          className="text-ink transition-transform duration-base ease-editorial group-hover:translate-x-2 group-hover:text-accent"
        >
          →
        </button>
      </div>
      <HairlineDivider />
    </li>
  );
}

function DashStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Eyebrow className="text-ink-muted">{label}</Eyebrow>
      <p
        className="mt-3 font-display text-[2rem] leading-none text-ink tabular-nums"
        style={{ fontVariationSettings: '"opsz" 36' }}
      >
        {value}
      </p>
    </div>
  );
}

function formatPracticeTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
