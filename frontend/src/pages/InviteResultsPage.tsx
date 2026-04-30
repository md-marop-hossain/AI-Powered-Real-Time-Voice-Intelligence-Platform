import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { EditorialHeader } from "@/components/editorial/EditorialHeader";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { LoadingLine } from "@/components/editorial/LoadingLine";

interface ResultRow {
  invitee_id: string;
  email: string;
  status: string;
  session_id: string | null;
  overall_score: number | null;
  completed_at: string | null;
}

export default function InviteResultsPage() {
  const { inviteId = "" } = useParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ResultRow[] | null>(null);

  useEffect(() => {
    api
      .get<ResultRow[]>(`/invites/${inviteId}/results`)
      .then((r) => setRows(r.data))
      .catch((e) => {
        const detail = e?.response?.data?.detail;
        toast.error(typeof detail === "string" ? detail : "Couldn't load results.");
      });
  }, [inviteId]);

  return (
    <div className="min-h-screen bg-canvas">
      <EditorialHeader />
      <main className="editorial-container py-16 md:py-24">
        <header className="mb-12 flex items-end justify-between gap-6">
          <div>
            <Eyebrow>Invitation results</Eyebrow>
            <h1 className="mt-4 text-display text-ink">Candidates</h1>
          </div>
          <Link to="/invites" className="editorial-link text-ink">
            ← Back to invites
          </Link>
        </header>

        {rows === null ? (
          <div className="py-32">
            <LoadingLine />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-body text-ink-muted">
            No candidates on this invite.
          </p>
        ) : (
          <div>
            <HairlineDivider strong />
            <ul>
              {rows.map((row) => {
                const clickable = !!row.session_id;
                return (
                  <li key={row.invitee_id}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() =>
                        row.session_id &&
                        navigate(`/sessions/${row.session_id}/report`)
                      }
                      className={
                        clickable
                          ? "group grid w-full grid-cols-[1fr_auto_auto_auto] items-baseline gap-6 py-6 text-left transition-colors duration-base ease-editorial hover:bg-canvas-elevated"
                          : "grid w-full grid-cols-[1fr_auto_auto_auto] items-baseline gap-6 py-6 text-left"
                      }
                    >
                      <div>
                        <p className="text-body text-ink">{row.email}</p>
                        <p className="mt-1 font-mono text-eyebrow text-ink-muted">
                          {row.status.replace("_", " ").toUpperCase()}
                          {row.completed_at &&
                            ` · ${new Date(row.completed_at).toLocaleDateString()}`}
                        </p>
                      </div>
                      <span
                        className="font-display text-h2 text-ink tabular-nums"
                        style={{ fontVariationSettings: '"opsz" 36' }}
                      >
                        {row.overall_score !== null
                          ? row.overall_score.toFixed(1)
                          : "—"}
                      </span>
                      <span className="font-mono text-eyebrow text-ink-muted">
                        {clickable ? "VIEW REPORT" : "PENDING"}
                      </span>
                      <span
                        aria-hidden="true"
                        className={
                          clickable
                            ? "text-ink transition-transform duration-base ease-editorial group-hover:translate-x-2 group-hover:text-accent"
                            : "text-ink-muted"
                        }
                      >
                        →
                      </span>
                    </button>
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
