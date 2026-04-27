import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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

export default function LoginPage() {
  const navigate = useNavigate();
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
      navigate("/dashboard");
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "Something interrupted us. We're looking into it.");
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
      navigate("/dashboard");
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
          <Link to="/signup" className="editorial-link text-ink">
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

      <div className="flex justify-center">
        <GoogleLogin
          onSuccess={(c) => onGoogle(c.credential)}
          onError={() => toast.error("Google didn't let us through.")}
          theme="outline"
          text="continue_with"
          shape="rectangular"
        />
      </div>
    </AuthSplit>
  );
}
