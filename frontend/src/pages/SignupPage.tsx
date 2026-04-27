import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { GoogleLogin } from "@react-oauth/google";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { AuthSplit, VermillionUnderline } from "@/components/editorial/AuthSplit";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { EditorialInput } from "@/components/editorial/EditorialInput";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";

const schema = z.object({
  full_name: z.string().min(1, "We'd like to know your name."),
  email: z.string().email("That email doesn't look right."),
  password: z
    .string()
    .min(8, "At least 8 characters.")
    .regex(/[A-Z]/, "Add an uppercase letter.")
    .regex(/[a-z]/, "Add a lowercase letter.")
    .regex(/\d/, "Add a digit."),
});

type SignupForm = z.infer<typeof schema>;

export default function SignupPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupForm>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: SignupForm) => {
    setLoading(true);
    try {
      const r = await api.post("/auth/register", data);
      setTokens(r.data.access_token, r.data.refresh_token);
      const me = await api.get("/auth/me");
      setUser(me.data);
      navigate("/upload");
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
      navigate("/upload");
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "Google didn't let us through.");
    }
  };

  return (
    <AuthSplit
      eyebrow="EST. 2026 — A REHEARSAL ROOM FOR INTERVIEWS"
      heading={
        <>
          A quiet room to <VermillionUnderline>rehearse</VermillionUnderline>
          <br />
          before the conversation that counts.
        </>
      }
      sub="Upload your résumé, choose a role, and answer the questions a hiring manager would actually ask. The transcript and feedback are yours to keep."
      formTitle="Begin rehearsing"
      footnote={
        <>
          Already have an account?{" "}
          <Link to="/login" className="editorial-link text-ink">
            Enter the room
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        <EditorialInput
          label="Your name"
          autoComplete="name"
          error={errors.full_name?.message}
          {...register("full_name")}
        />
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
          autoComplete="new-password"
          hint="At least 8 characters, with upper, lower, and a digit."
          error={errors.password?.message}
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
            {loading ? "BEGINNING…" : "BEGIN REHEARSING"}
          </EditorialButton>
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
