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

export default function AccountPage() {
  const navigate = useNavigate();
  const { clear } = useAuthStore();
  const setUser = useAuthStore((s) => s.setUser);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    api
      .get<MeResponse>("/auth/me")
      .then((r) => setMe(r.data))
      .catch(() => toast.error("Couldn't load your account."))
      .finally(() => setLoading(false));
  }, []);

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
