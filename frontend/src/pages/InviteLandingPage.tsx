import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { ConfirmDialog } from "@/components/editorial/ConfirmDialog";
import { EditorialHeader } from "@/components/editorial/EditorialHeader";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { LoadingLine } from "@/components/editorial/LoadingLine";

interface PublicInvite {
  role: string;
  seniority: string | null;
  focus: string | null;
  industry: string | null;
  duration_minutes: number;
  expires_at: string;
  attempts_remaining: number;
  creator_name: string | null;
  invited_emails: string[];
}

export default function InviteLandingPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const currentUser = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clear);

  const [invite, setInvite] = useState<PublicInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmingSwitch, setConfirmingSwitch] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<PublicInvite>(`/invites/${token}`)
      .then((r) => {
        if (cancelled) return;
        setInvite(r.data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.detail ?? "This invite link is invalid.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const userEmail = (currentUser?.email ?? "").trim().toLowerCase();
  const invitedEmails = invite?.invited_emails ?? [];
  const emailMatches =
    !!accessToken && !!userEmail && invitedEmails.includes(userEmail);
  const emailMismatch =
    !!accessToken && invitedEmails.length > 0 && !emailMatches;

  const goLogin = () => {
    const redirect = encodeURIComponent(`/invite/${token}`);
    navigate(`/login?redirect=${redirect}`);
  };

  const switchAccount = () => {
    // Clear local session and bounce through the login flow with the
    // invite as the redirect target. The user will land back here once
    // they've signed in with the right address.
    clearAuth();
    const redirect = encodeURIComponent(`/invite/${token}`);
    navigate(`/login?redirect=${redirect}`);
  };

  const start = async () => {
    if (!accessToken) {
      goLogin();
      return;
    }
    if (emailMismatch) {
      setConfirmingSwitch(true);
      return;
    }
    setStarting(true);
    try {
      const r = await api.post(`/invites/${token}/start`, {});
      navigate(`/interview/${r.data.session_id}`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Couldn't start the interview.");
      setStarting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <EditorialHeader />
      <main className="editorial-container py-16 md:py-24 max-w-2xl">
        {loading ? (
          <div className="py-32">
            <LoadingLine />
          </div>
        ) : error ? (
          <>
            <Eyebrow>Invitation</Eyebrow>
            <h1 className="mt-4 text-display text-ink">This link can't be used.</h1>
            <p className="mt-4 text-body text-ink-muted">{error}</p>
            <p className="mt-4 text-body text-ink-muted">
              Reach out to the person who invited you and ask for a fresh link.
            </p>
            <div className="mt-12">
              <Link to="/" className="editorial-link text-ink">
                ← Back to home
              </Link>
            </div>
          </>
        ) : invite ? (
          <>
            <Eyebrow>You're invited</Eyebrow>
            <h1 className="mt-4 text-display text-ink">
              A mock interview is waiting for you.
            </h1>
            <p className="mt-4 text-body text-ink-muted">
              {invite.creator_name ?? "Someone"} has invited you to a{" "}
              <span className="text-ink">{invite.role}</span> mock interview. The
              session runs about{" "}
              <span className="text-ink">{invite.duration_minutes} minutes</span> and
              is conducted by our AI voice interviewer.
            </p>

            <div className="mt-12">
              <HairlineDivider strong />
              <dl className="grid grid-cols-2 gap-x-6 gap-y-6 py-8">
                <Detail label="Role" value={invite.role} />
                <Detail label="Duration" value={`${invite.duration_minutes} min`} />
                {invite.seniority && (
                  <Detail label="Seniority" value={invite.seniority} />
                )}
                {invite.focus && <Detail label="Focus" value={invite.focus} />}
                {invite.industry && (
                  <Detail label="Industry" value={invite.industry} />
                )}
                <Detail
                  label="Expires"
                  value={new Date(invite.expires_at).toLocaleString()}
                />
                <Detail
                  label="Attempts left"
                  value={String(invite.attempts_remaining)}
                />
              </dl>
              <HairlineDivider strong />
            </div>

            <div className="mt-12 space-y-4 text-body text-ink-muted">
              <p>
                <span className="text-ink">Before you start:</span> find a quiet
                room, plug in headphones if you have them, and check that your
                microphone works.
              </p>
              <p>
                If you've uploaded a résumé before, we'll use the most recent one.
                Otherwise the interviewer will work from the role and JD alone.
              </p>
            </div>

            <div className="mt-12">
              {/* Logged out → ask to sign in. */}
              {!accessToken && (
                <div className="flex flex-wrap items-center gap-6">
                  <EditorialButton filled arrow onClick={goLogin}>
                    SIGN IN TO CONTINUE
                  </EditorialButton>
                  <p className="text-small text-ink-muted">
                    Sign in with the email address that received this invite.
                    {invitedEmails.length === 1 && (
                      <>
                        {" "}
                        <span className="text-ink">{invitedEmails[0]}</span>.
                      </>
                    )}
                  </p>
                </div>
              )}

              {/* Logged in with the right email → start. */}
              {accessToken && emailMatches && (
                <div className="flex flex-wrap items-center gap-6">
                  <EditorialButton
                    filled
                    arrow
                    onClick={start}
                    disabled={starting || invite.attempts_remaining <= 0}
                  >
                    {starting ? "OPENING ROOM…" : "START INTERVIEW"}
                  </EditorialButton>
                  <p className="text-small text-ink-muted">
                    Signed in as{" "}
                    <span className="text-ink">{currentUser?.email}</span>.
                  </p>
                </div>
              )}

              {/* Logged in with the wrong email → switch account. */}
              {accessToken && emailMismatch && (
                <div className="border border-rule bg-canvas-elevated p-6">
                  <Eyebrow className="text-accent">Wrong account</Eyebrow>
                  <p className="mt-3 text-body text-ink">
                    This invitation was sent to{" "}
                    <span className="font-mono text-small text-ink">
                      {invitedEmails.join(", ")}
                    </span>
                    , but you're signed in as{" "}
                    <span className="font-mono text-small text-ink">
                      {currentUser?.email}
                    </span>
                    .
                  </p>
                  <p className="mt-3 text-small text-ink-muted">
                    Sign out and sign back in with the address above to take
                    this interview.
                  </p>
                  <div className="mt-6">
                    <EditorialButton
                      filled
                      arrow
                      tone="accent"
                      onClick={() => setConfirmingSwitch(true)}
                    >
                      SWITCH ACCOUNT
                    </EditorialButton>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}
      </main>

      <ConfirmDialog
        open={confirmingSwitch}
        eyebrow="Switch account"
        title="Sign out and sign back in?"
        body={
          invitedEmails.length > 0 ? (
            <>
              You'll need to sign in with{" "}
              <span className="text-ink">{invitedEmails.join(", ")}</span> to
              take this interview. We'll bring you back to this page after
              sign-in.
            </>
          ) : (
            "We'll bring you back to this page after sign-in."
          )
        }
        confirmLabel="Sign out and continue"
        confirmTone="ink"
        onClose={() => setConfirmingSwitch(false)}
        onConfirm={switchAccount}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Eyebrow className="text-ink-muted">{label}</Eyebrow>
      <p className="mt-2 text-body text-ink">{value}</p>
    </div>
  );
}
