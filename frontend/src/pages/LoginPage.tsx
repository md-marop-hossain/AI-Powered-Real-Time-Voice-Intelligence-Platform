import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { GoogleLogin } from "@react-oauth/google";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import {
  AuthSplit,
  VermillionUnderline,
} from "@/components/editorial/AuthSplit";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { EditorialInput } from "@/components/editorial/EditorialInput";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type LoginForm = z.infer<typeof schema>;

function safeRedirectTarget(raw: string | null): string {
  // Only allow same-origin paths (/foo/bar) to prevent open-redirect.
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = safeRedirectTarget(params.get("redirect"));
  const [loading, setLoading] = useState(false);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    try {
      const r = await api.post("/auth/login", data);
      setTokens(r.data.access_token, r.data.refresh_token);
      const me = await api.get("/auth/me");
      setUser(me.data);
      navigate(redirectTo);
    } catch (e: any) {
      const status = e.response?.status;
      const detail = e.response?.data?.detail;
      if (status === 403 && detail === "email_not_verified") {
        toast.message("Please verify your email to continue.");
        try {
          await api.post("/auth/resend-otp", { email: data.email });
        } catch {
          // ignore — verify page lets the user resend
        }
        navigate(`/verify-email?email=${encodeURIComponent(data.email)}`);
        return;
      }
      toast.error(detail ?? "Something interrupted us. We're looking into it.");
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async (credential?: string) => {
    if (!credential) return;
    try {
      const r = await api.post("/auth/google", { id_token: credential });
      setTokens(r.data.access_token, r.data.refresh_token);
      const me = await api.get("/auth/me");
      setUser(me.data);
      navigate(redirectTo);
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "Google didn't let us through.");
    }
  };

  return (
    <AuthSplit
      eyebrow="EST. 2026 — A REHEARSAL ROOM FOR INTERVIEWS"
      heading={
        <>
          Practice the conversation
          <br />
          that <VermillionUnderline>changes</VermillionUnderline> everything.
        </>
      }
      sub="An AI interviewer that reads your résumé, listens to your answers, and asks the follow-ups a hiring manager actually would."
      formTitle="Sign in"
      footnote={
        <>
          New here?{" "}
          <Link
            to={
              redirectTo === "/dashboard"
                ? "/signup"
                : `/signup?redirect=${encodeURIComponent(redirectTo)}`
            }
            className="editorial-link text-ink"
          >
            Begin rehearsing
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        <EditorialInput
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <EditorialInput
          label="Password"
          type="password"
          autoComplete="current-password"
          {...register("password")}
        />
        <div className="pt-2">
          <EditorialButton
            type="submit"
            filled
            disabled={loading}
            arrow={!loading}
            className="w-full"
          >
            {loading ? "ENTERING…" : "ENTER THE ROOM"}
          </EditorialButton>
        </div>
        <div className="flex items-center justify-between text-small">
          <Link to="/forgot-password" className="editorial-link text-ink-muted hover:text-ink">
            I've forgotten my password
          </Link>
        </div>
      </form>

      <div className="flex items-center gap-4 text-eyebrow text-ink-muted">
        <HairlineDivider className="flex-1" />
        OR
        <HairlineDivider className="flex-1" />
      </div>

      <div className="relative w-full">
        {/* Custom visual button */}
        <div className="flex w-full items-center justify-center gap-3 rounded-none border border-ink-muted/30 bg-transparent px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-ink/60 hover:bg-ink/5 cursor-pointer select-none">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </div>
        {/* Invisible Google button overlaid on top — handles all click/auth logic */}
        <div className="absolute inset-0 overflow-hidden opacity-0">
          <GoogleLogin
            onSuccess={(c) => onGoogle(c.credential)}
            onError={() => toast.error("Google didn't let us through.")}
            theme="outline"
            text="continue_with"
            shape="rectangular"
            width={9999}
          />
        </div>
      </div>
    </AuthSplit>
  );
}
