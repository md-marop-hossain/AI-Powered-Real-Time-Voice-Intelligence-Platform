import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { EditorialHeader } from "@/components/editorial/EditorialHeader";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { LoadingLine } from "@/components/editorial/LoadingLine";
import { EmptyState } from "@/components/editorial/EmptyState";

interface InviteSummary {
  id: string;
  token: string;
  role: string;
  seniority: string | null;
  focus: string | null;
  industry: string | null;
  duration_minutes: number;
  expires_at: string;
  max_attempts: number;
  attempts_used: number;
  status: string;
  created_at: string;
  invitees: { id: string; email: string; user_id: string | null; status: string }[];
  invite_url: string;
}

function lifecycleLabel(inv: InviteSummary): string {
  if (new Date(inv.expires_at).getTime() < Date.now()) return "EXPIRED";
  if (inv.attempts_used >= inv.max_attempts) return "USED";
  return "ACTIVE";
}

export default function InvitesDashboardPage() {
  const navigate = useNavigate();
  const [invites, setInvites] = useState<InviteSummary[] | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<InviteSummary[]>("/invites")
      .then((r) => setInvites(r.data))
      .catch(() => toast.error("Couldn't load your invites."));
  }, []);

  const participate = async (inviteId: string) => {
    setStarting(inviteId);
    try {
      const r = await api.post<{ session_id: string }>(
        `/invites/${inviteId}/participate`,
        {},
      );
      navigate(`/interview/${r.data.session_id}`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Couldn't start the interview.");
      setStarting(null);
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <EditorialHeader />
      <main className="editorial-container py-16 md:py-24">
        <header className="mb-16 flex items-end justify-between gap-6">
          <div>
            <Eyebrow>Your interview invitations</Eyebrow>
            <h1 className="mt-4 text-display text-ink">Invites</h1>
          </div>
          <Link to="/invite" className="editorial-link text-ink">
            Create a new invite <span aria-hidden="true">→</span>
          </Link>
        </header>

        {invites === null ? (
          <div className="py-32">
            <LoadingLine />
          </div>
        ) : invites.length === 0 ? (
          <EmptyState
            title="You haven't invited anyone yet."
            actionLabel="Send your first invite"
            to="/invite"
          />
        ) : (
          <div>
            <HairlineDivider strong />
            <ul>
              {invites.map((inv) => {
                const lifecycle = lifecycleLabel(inv);
                const completed = inv.invitees.filter(
                  (i) => i.status === "completed",
                ).length;
                return (
                  <li key={inv.id}>
                    <div className="group grid w-full grid-cols-[1fr_auto_auto_auto_auto] items-baseline gap-6 py-6 transition-colors duration-base ease-editorial hover:bg-canvas-elevated">
                      {/* Left: role + meta — click goes to results */}
                      <button
                        type="button"
                        onClick={() => navigate(`/invites/${inv.id}/results`)}
                        className="text-left"
                      >
                        <p className="text-body text-ink">{inv.role}</p>
                        <p className="mt-1 font-mono text-eyebrow text-ink-muted">
                          {inv.invitees.length}{" "}
                          {inv.invitees.length === 1 ? "candidate" : "candidates"}
                          {" · "}
                          {inv.duration_minutes} MIN
                          {inv.seniority ? ` · ${inv.seniority.toUpperCase()}` : ""}
                        </p>
                      </button>
                      <span className="font-mono text-eyebrow text-ink-muted tabular-nums">
                        {completed}/{inv.invitees.length} DONE
                      </span>
                      <span
                        className={
                          lifecycle === "ACTIVE"
                            ? "font-mono text-eyebrow text-ink"
                            : "font-mono text-eyebrow text-ink-muted"
                        }
                      >
                        {lifecycle}
                      </span>
                      {/* Participate: start the interview as the creator */}
                      <button
                        type="button"
                        onClick={() => participate(inv.id)}
                        disabled={starting === inv.id}
                        className="font-mono text-eyebrow text-accent transition-colors duration-base ease-editorial hover:text-ink disabled:opacity-40"
                      >
                        {starting === inv.id ? "STARTING…" : "PARTICIPATE →"}
                      </button>
                      {/* Results arrow */}
                      <button
                        type="button"
                        onClick={() => navigate(`/invites/${inv.id}/results`)}
                        aria-label={`View results for ${inv.role}`}
                        className="text-ink transition-transform duration-base ease-editorial group-hover:translate-x-2 group-hover:text-accent"
                      >
                        →
                      </button>
                    </div>
                    <HairlineDivider />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
