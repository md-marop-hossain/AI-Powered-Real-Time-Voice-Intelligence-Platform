import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { AuthSplit, VermillionUnderline } from "@/components/editorial/AuthSplit";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { EditorialInput } from "@/components/editorial/EditorialInput";

const schema = z.object({
  code: z
    .string()
    .length(6, "The code is exactly 6 digits.")
    .regex(/^\d{6}$/, "Numbers only."),
});

type VerifyForm = z.infer<typeof schema>;

const RESEND_COOLDOWN_SEC = 60;
const OTP_EXPIRY_SEC = 10 * 60;

function formatMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const rawRedirect = params.get("redirect");
  const redirectTo =
    rawRedirect && rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/upload";
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(OTP_EXPIRY_SEC);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VerifyForm>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!email) {
      toast.error("No email provided. Please sign up again.");
      navigate("/signup", { replace: true });
    }
  }, [email, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (expiresIn <= 0) return;
    const t = setTimeout(() => setExpiresIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [expiresIn]);

  const onSubmit = async (data: VerifyForm) => {
    setLoading(true);
    try {
      const r = await api.post("/auth/verify-email", { email, code: data.code });
      setTokens(r.data.access_token, r.data.refresh_token);
      const me = await api.get("/auth/me");
      setUser(me.data);
      toast.success("Email verified.");
      navigate(redirectTo);
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "We couldn't verify that code.");
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    if (cooldown > 0) return;
    setResending(true);
    try {
      await api.post("/auth/resend-otp", { email });
      toast.success("A new code has been sent.");
      setCooldown(RESEND_COOLDOWN_SEC);
      setExpiresIn(OTP_EXPIRY_SEC);
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "Couldn't send a new code.");
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthSplit
      eyebrow="EST. 2026 — A REHEARSAL ROOM FOR INTERVIEWS"
      heading={
        <>
          One last <VermillionUnderline>step</VermillionUnderline>
          <br />
          to enter the room.
        </>
      }
      sub="We sent a 6-digit code to your inbox. Enter it below to confirm the address belongs to you."
      formTitle="Verify your email"
      footnote={
        <>
          Wrong email?{" "}
          <Link to="/signup" className="editorial-link text-ink">
            Start over
          </Link>
        </>
      }
    >
      <div className="flex items-center justify-between gap-4 text-small">
        <span className="text-ink-muted">
          Sent to <span className="text-ink">{email}</span>
        </span>
        {expiresIn > 0 ? (
          <span className="flex items-center gap-2 text-ink-muted tabular-nums">
            <span
              aria-hidden="true"
              className={
                expiresIn <= 60
                  ? "h-1.5 w-1.5 rounded-full bg-accent animate-pulse"
                  : "h-1.5 w-1.5 rounded-full bg-ink-muted"
              }
            />
            Expires in{" "}
            <span className={expiresIn <= 60 ? "text-accent" : "text-ink"}>
              {formatMMSS(expiresIn)}
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-accent">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
            Code expired
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        <EditorialInput
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          error={errors.code?.message}
          {...register("code")}
        />
        <div className="pt-2">
          <EditorialButton
            type="submit"
            filled
            disabled={loading || expiresIn <= 0}
            arrow={!loading && expiresIn > 0}
            className="w-full"
          >
            {loading
              ? "VERIFYING…"
              : expiresIn <= 0
                ? "CODE EXPIRED — RESEND"
                : "VERIFY & ENTER"}
          </EditorialButton>
        </div>
      </form>

      <div className="text-small text-ink-muted">
        Didn't get it?{" "}
        <button
          type="button"
          onClick={onResend}
          disabled={resending || cooldown > 0}
          className="editorial-link text-ink disabled:text-ink-muted disabled:no-underline disabled:cursor-not-allowed"
        >
          {cooldown > 0
            ? `Resend in ${cooldown}s`
            : resending
              ? "Sending…"
              : "Resend code"}
        </button>
      </div>
    </AuthSplit>
  );
}
