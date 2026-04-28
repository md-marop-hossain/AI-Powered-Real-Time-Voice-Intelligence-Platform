import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { EditorialHeader } from "@/components/editorial/EditorialHeader";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { EditorialInput } from "@/components/editorial/EditorialInput";
import { NumberedMarker } from "@/components/editorial/NumberedMarker";
import { easeEditorial, durations } from "@/lib/motion";

interface MeResponse {
  id: string;
  email: string;
  full_name: string;
  auth_provider: string;
  email_verified: boolean;
  created_at: string;
}

interface StatsResponse {
  sessions_total: number;
  sessions_completed: number;
  total_practice_minutes: number;
  avg_overall_score: number | null;
  best_overall_score: number | null;
  resumes_count: number;
  member_since: string | null;
  last_session_at: string | null;
  recent_roles: string[];
}

interface ResumeRow {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  parsed: {
    full_name?: string | null;
    title?: string | null;
    skills?: string[];
    experience?: { company?: string; role?: string }[];
  } | null;
  created_at: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  manual: "Email & password",
  google: "Google",
  both: "Email & Google",
};

const nameSchema = z.object({
  full_name: z
    .string()
    .min(1, "Please enter a name.")
    .max(255, "Name is too long."),
});

const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: z
      .string()
      .min(8, "At least 8 characters.")
      .regex(/[A-Z]/, "Add an uppercase letter.")
      .regex(/[a-z]/, "Add a lowercase letter.")
      .regex(/\d/, "Add a digit."),
    confirm_password: z.string().min(1, "Re-type the new password."),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Passwords don't match.",
    path: ["confirm_password"],
  })
  .refine((d) => d.current_password !== d.new_password, {
    message: "New password must be different from the current one.",
    path: ["new_password"],
  });

type NameForm = z.infer<typeof nameSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export default function AccountPage() {
  const navigate = useNavigate();
  const { clear } = useAuthStore();
  const setUser = useAuthStore((s) => s.setUser);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [resumes, setResumes] = useState<ResumeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingResumeId, setDeletingResumeId] = useState<string | null>(null);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

  const refreshResumes = () =>
    api
      .get<ResumeRow[]>("/resumes")
      .then((r) => setResumes(r.data))
      .catch(() => {
        /* ignore */
      });

  const refreshStats = () =>
    api
      .get<StatsResponse>("/auth/me/stats")
      .then((r) => setStats(r.data))
      .catch(() => {
        /* ignore */
      });

  useEffect(() => {
    Promise.allSettled([
      api.get<MeResponse>("/auth/me").then((r) => setMe(r.data)),
      refreshStats(),
      refreshResumes(),
    ])
      .catch(() => toast.error("Couldn't load your account."))
      .finally(() => setLoading(false));
  }, []);

  const onDeleteResume = async (id: string, filename: string) => {
    if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    setDeletingResumeId(id);
    try {
      await api.delete(`/resumes/${id}`);
      setResumes((prev) => prev.filter((r) => r.id !== id));
      refreshStats();
      toast.success("Résumé deleted.");
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "Couldn't delete that résumé.");
    } finally {
      setDeletingResumeId(null);
    }
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const token = useAuthStore.getState().accessToken;
      const r = await fetch(`${API_URL}/api/v1/auth/me/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rehearsal-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Your data is downloading.");
    } catch (e: any) {
      toast.error("Couldn't generate export.");
    } finally {
      setExporting(false);
    }
  };

  const handleSignOut = () => {
    clear();
    navigate("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas">
        <EditorialHeader />
        <main className="editorial-container py-24">
          <p className="text-body italic text-ink-muted">Loading your account…</p>
        </main>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="min-h-screen bg-canvas">
        <EditorialHeader />
        <main className="editorial-container py-24">
          <p className="text-body text-accent">
            We couldn't load your account. Please sign in again.
          </p>
          <div className="mt-6">
            <EditorialButton onClick={handleSignOut} arrow>
              Sign in
            </EditorialButton>
          </div>
        </main>
      </div>
    );
  }

  const isManual = me.auth_provider === "manual" || me.auth_provider === "both";
  const joined = new Date(me.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-canvas">
      <EditorialHeader />
      <main className="editorial-container py-16 md:py-24">
        <NumberedMarker index="01" label="ACCOUNT" className="mb-8 block" />

        <header className="mb-16 flex flex-col gap-3">
          <Eyebrow className="text-ink-muted">Profile</Eyebrow>
          <h1 className="font-display text-[2.5rem] font-medium leading-tight text-ink md:text-[3rem]">
            {me.full_name}
          </h1>
          <p className="text-body text-ink-soft">{me.email}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-eyebrow text-ink-muted">
            <span>JOINED {joined.toUpperCase()}</span>
            <span aria-hidden="true">·</span>
            <span>{(PROVIDER_LABEL[me.auth_provider] ?? me.auth_provider).toUpperCase()}</span>
            <span aria-hidden="true">·</span>
            <span className={me.email_verified ? "text-ink" : "text-accent"}>
              {me.email_verified ? "VERIFIED" : "EMAIL NOT VERIFIED"}
            </span>
          </div>
        </header>

        {/* STATS OVERVIEW */}
        {stats && stats.sessions_total > 0 && (
          <section className="mb-20">
            <div className="mb-6 flex items-baseline justify-between">
              <Eyebrow>Practice at a glance</Eyebrow>
              {stats.last_session_at && (
                <Eyebrow className="text-ink-muted">
                  LAST{" "}
                  {new Date(stats.last_session_at)
                    .toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                    .toUpperCase()}
                </Eyebrow>
              )}
            </div>
            <HairlineDivider />
            <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
              <StatCard
                label="Sessions completed"
                value={stats.sessions_completed.toString()}
                hint={`${stats.sessions_total} total`}
              />
              <StatCard
                label="Time practiced"
                value={formatPracticeTime(stats.total_practice_minutes)}
              />
              <StatCard
                label="Average score"
                value={
                  stats.avg_overall_score !== null
                    ? stats.avg_overall_score.toFixed(1)
                    : "—"
                }
                hint={
                  stats.best_overall_score !== null
                    ? `Best ${stats.best_overall_score.toFixed(1)}`
                    : undefined
                }
              />
              <StatCard
                label="Résumés"
                value={stats.resumes_count.toString()}
              />
            </div>
            {stats.recent_roles.length > 0 && (
              <div className="mt-8">
                <Eyebrow className="mb-3 block text-ink-muted">
                  Recent roles
                </Eyebrow>
                <ul className="flex flex-wrap gap-2">
                  {stats.recent_roles.map((role) => (
                    <li
                      key={role}
                      className="border border-rule px-3 py-1.5 font-mono text-eyebrow text-ink"
                    >
                      {role}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* PROFILE FIELDS */}
        <section>
          <div className="mb-6 flex items-baseline justify-between">
            <Eyebrow>Identity</Eyebrow>
          </div>
          <HairlineDivider />

          <Field
            label="Display name"
            value={me.full_name}
            action={
              !editingName ? (
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="editorial-link font-mono text-eyebrow text-ink"
                >
                  EDIT
                </button>
              ) : null
            }
          >
            <AnimatePresence>
              {editingName && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: durations.base, ease: easeEditorial }}
                  className="overflow-hidden"
                >
                  <NameForm
                    initial={me.full_name}
                    saving={savingName}
                    onCancel={() => setEditingName(false)}
                    onSubmit={async (data) => {
                      setSavingName(true);
                      try {
                        const r = await api.patch<MeResponse>("/auth/me", data);
                        setMe(r.data);
                        setUser({
                          id: r.data.id,
                          email: r.data.email,
                          full_name: r.data.full_name,
                          auth_provider: r.data.auth_provider,
                        });
                        setEditingName(false);
                        toast.success("Name updated.");
                      } catch (e: any) {
                        toast.error(
                          e.response?.data?.detail ?? "Couldn't update your name.",
                        );
                      } finally {
                        setSavingName(false);
                      }
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </Field>

          <Field label="Email address" value={me.email} muted hint="Email can't be changed yet." />

          <Field
            label="Sign-in method"
            value={PROVIDER_LABEL[me.auth_provider] ?? me.auth_provider}
            muted
          />
        </section>

        {/* SECURITY */}
        <section className="mt-20">
          <div className="mb-6 flex items-baseline justify-between">
            <Eyebrow>Security</Eyebrow>
          </div>
          <HairlineDivider />

          <Field
            label="Password"
            value="••••••••••••"
            action={
              isManual && !editingPassword ? (
                <button
                  type="button"
                  onClick={() => setEditingPassword(true)}
                  className="editorial-link font-mono text-eyebrow text-ink"
                >
                  CHANGE
                </button>
              ) : !isManual ? (
                <span className="font-mono text-eyebrow text-ink-muted">
                  GOOGLE-MANAGED
                </span>
              ) : null
            }
            hint={
              !isManual
                ? "Sign-in is handled by Google. Manage your password through your Google account."
                : undefined
            }
          >
            <AnimatePresence>
              {editingPassword && isManual && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: durations.base, ease: easeEditorial }}
                  className="overflow-hidden"
                >
                  <PasswordForm
                    saving={savingPassword}
                    onCancel={() => setEditingPassword(false)}
                    onSubmit={async (data) => {
                      setSavingPassword(true);
                      try {
                        await api.post("/auth/change-password", {
                          current_password: data.current_password,
                          new_password: data.new_password,
                        });
                        setEditingPassword(false);
                        toast.success("Password updated.");
                      } catch (e: any) {
                        toast.error(
                          e.response?.data?.detail ??
                            "Couldn't change your password.",
                        );
                      } finally {
                        setSavingPassword(false);
                      }
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </Field>
        </section>

        {/* RÉSUMÉS */}
        <section className="mt-20">
          <div className="mb-6 flex items-baseline justify-between">
            <Eyebrow>Your résumés</Eyebrow>
            <Eyebrow className="text-ink-muted tabular-nums">
              {String(resumes.length).padStart(2, "0")}
            </Eyebrow>
          </div>
          <HairlineDivider />
          {resumes.length === 0 ? (
            <div className="mt-6 flex items-center justify-between gap-6 py-2">
              <p className="text-body text-ink-muted">
                You haven't uploaded a résumé yet.
              </p>
              <EditorialButton
                onClick={() => navigate("/upload")}
                tone="ink"
                arrow
              >
                Upload one
              </EditorialButton>
            </div>
          ) : (
            <ul className="mt-6 divide-y divide-rule">
              {resumes.map((r) => (
                <li
                  key={r.id}
                  className="grid grid-cols-1 gap-3 py-6 md:grid-cols-[1fr_auto_auto] md:items-baseline md:gap-8"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-body text-ink">{r.filename}</p>
                    <p className="mt-2 text-small text-ink-muted">
                      {formatBytes(r.size_bytes)} ·{" "}
                      {new Date(r.created_at).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                      {r.parsed?.full_name && (
                        <>
                          {" · "}
                          <span className="text-ink">{r.parsed.full_name}</span>
                        </>
                      )}
                      {r.parsed?.experience && r.parsed.experience.length > 0 && (
                        <>
                          {" · "}
                          {r.parsed.experience.length} role
                          {r.parsed.experience.length === 1 ? "" : "s"}
                        </>
                      )}
                      {r.parsed?.skills && r.parsed.skills.length > 0 && (
                        <>
                          {" · "}
                          {r.parsed.skills.length} skill
                          {r.parsed.skills.length === 1 ? "" : "s"}
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteResume(r.id, r.filename)}
                    disabled={deletingResumeId === r.id}
                    className="editorial-link font-mono text-eyebrow text-accent disabled:text-ink-muted"
                  >
                    {deletingResumeId === r.id ? "DELETING…" : "DELETE"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* DATA & PRIVACY */}
        <section className="mt-20">
          <div className="mb-6 flex items-baseline justify-between">
            <Eyebrow>Data &amp; privacy</Eyebrow>
          </div>
          <HairlineDivider />
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto] md:items-baseline md:gap-8 py-2">
            <div>
              <p className="text-body text-ink">Export your data</p>
              <p className="mt-2 text-small text-ink-muted">
                Downloads a JSON file with your profile, every résumé you've
                uploaded, and every session — questions, answers, scores.
              </p>
            </div>
            <EditorialButton onClick={onExport} disabled={exporting} tone="ink">
              {exporting ? "Preparing…" : "Download .json"}
            </EditorialButton>
          </div>
          <HairlineDivider />
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto] md:items-baseline md:gap-8 py-2">
            <div>
              <p className="text-body text-accent">Delete this account</p>
              <p className="mt-2 text-small text-ink-muted">
                Permanently removes your profile, every résumé, every session,
                every report. There is no undo.
              </p>
            </div>
            <EditorialButton
              onClick={() => setShowDeleteAccount(true)}
              tone="accent"
            >
              Delete account
            </EditorialButton>
          </div>
        </section>

        {/* SESSION */}
        <section className="mt-20">
          <div className="mb-6 flex items-baseline justify-between">
            <Eyebrow>Session</Eyebrow>
          </div>
          <HairlineDivider />
          <div className="mt-6 flex items-center justify-between gap-6 py-2">
            <div>
              <p className="text-body text-ink">Sign out of this browser</p>
              <p className="mt-2 text-small text-ink-muted">
                Your transcripts and reports stay saved on your account.
              </p>
            </div>
            <EditorialButton onClick={handleSignOut} tone="muted">
              Sign out
            </EditorialButton>
          </div>
        </section>

        {/* DELETE ACCOUNT MODAL */}
        <AnimatePresence>
          {showDeleteAccount && (
            <DeleteAccountModal
              isManual={isManual}
              onClose={() => setShowDeleteAccount(false)}
              onConfirmed={() => {
                clear();
                navigate("/login");
              }}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ---------- Sub-components ----------

interface FieldProps {
  label: string;
  value: string;
  muted?: boolean;
  hint?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

function Field({ label, value, muted, hint, action, children }: FieldProps) {
  return (
    <>
      <div className="grid grid-cols-1 items-start gap-3 py-6 md:grid-cols-[160px_1fr_auto] md:items-baseline md:gap-8">
        <Eyebrow className="text-ink-muted">{label}</Eyebrow>
        <div className="min-w-0">
          <p className={muted ? "text-body text-ink-muted" : "text-body text-ink"}>
            {value}
          </p>
          {hint && <p className="mt-2 text-small text-ink-muted">{hint}</p>}
          {children}
        </div>
        <div className="md:text-right">{action}</div>
      </div>
      <HairlineDivider />
    </>
  );
}

function NameForm({
  initial,
  saving,
  onSubmit,
  onCancel,
}: {
  initial: string;
  saving: boolean;
  onSubmit: (d: NameForm) => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NameForm>({
    resolver: zodResolver(nameSchema),
    defaultValues: { full_name: initial },
  });

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="mt-6 flex flex-col gap-6"
    >
      <EditorialInput
        label="New display name"
        autoComplete="name"
        error={errors.full_name?.message}
        {...register("full_name")}
      />
      <div className="flex gap-4">
        <EditorialButton type="submit" filled disabled={saving} arrow={!saving}>
          {saving ? "SAVING…" : "SAVE"}
        </EditorialButton>
        <EditorialButton type="button" tone="muted" onClick={onCancel} disabled={saving}>
          Cancel
        </EditorialButton>
      </div>
    </form>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <Eyebrow className="text-ink-muted">{label}</Eyebrow>
      <p
        className="mt-3 font-display text-[2.25rem] leading-none text-ink tabular-nums"
        style={{ fontVariationSettings: '"opsz" 36' }}
      >
        {value}
      </p>
      {hint && <p className="mt-2 text-small text-ink-muted">{hint}</p>}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPracticeTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function DeleteAccountModal({
  isManual,
  onClose,
  onConfirmed,
}: {
  isManual: boolean;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requiredPhrase = "DELETE MY ACCOUNT";
  const canSubmit = isManual
    ? password.length > 0
    : confirm.trim().toUpperCase() === requiredPhrase;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api.delete("/auth/me", {
        data: isManual ? { password } : { confirm: confirm.trim() },
      });
      toast.success("Account deleted.");
      onConfirmed();
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "Couldn't delete the account.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.base, ease: easeEditorial }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: durations.base, ease: easeEditorial }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] border border-rule bg-canvas p-8"
      >
        <Eyebrow className="text-accent">Delete account</Eyebrow>
        <h2 className="mt-3 font-display text-[1.5rem] leading-tight text-ink">
          This is permanent.
        </h2>
        <p className="mt-3 text-body text-ink-soft">
          Every résumé, session, and report tied to this account will be removed
          from our servers. We can't recover it later.
        </p>

        <div className="mt-8">
          {isManual ? (
            <EditorialInput
              label="Confirm with your password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              name="confirm-password"
            />
          ) : (
            <EditorialInput
              label={`Type "${requiredPhrase.toLowerCase()}" to confirm`}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              name="confirm-phrase"
              hint="Case-insensitive."
            />
          )}
        </div>

        <div className="mt-8 flex justify-end gap-4">
          <EditorialButton
            type="button"
            onClick={onClose}
            tone="muted"
            disabled={submitting}
          >
            Cancel
          </EditorialButton>
          <EditorialButton
            type="button"
            onClick={submit}
            tone="accent"
            disabled={!canSubmit || submitting}
          >
            {submitting ? "Deleting…" : "Delete forever"}
          </EditorialButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

function PasswordForm({
  saving,
  onSubmit,
  onCancel,
}: {
  saving: boolean;
  onSubmit: (d: PasswordForm) => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="mt-6 flex flex-col gap-6"
    >
      <EditorialInput
        label="Current password"
        type="password"
        autoComplete="current-password"
        error={errors.current_password?.message}
        {...register("current_password")}
      />
      <EditorialInput
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters with upper, lower, and a digit."
        error={errors.new_password?.message}
        {...register("new_password")}
      />
      <EditorialInput
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        error={errors.confirm_password?.message}
        {...register("confirm_password")}
      />
      <div className="flex gap-4">
        <EditorialButton type="submit" filled disabled={saving} arrow={!saving}>
          {saving ? "UPDATING…" : "UPDATE PASSWORD"}
        </EditorialButton>
        <EditorialButton type="button" tone="muted" onClick={onCancel} disabled={saving}>
          Cancel
        </EditorialButton>
      </div>
    </form>
  );
}
