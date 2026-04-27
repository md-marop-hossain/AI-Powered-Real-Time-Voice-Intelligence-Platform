import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { AuthSplit, VermillionUnderline } from "@/components/editorial/AuthSplit";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { EditorialInput } from "@/components/editorial/EditorialInput";

const schema = z.object({
  new_password: z
    .string()
    .min(8, "At least 8 characters.")
    .regex(/[A-Z]/, "Add an uppercase letter.")
    .regex(/[a-z]/, "Add a lowercase letter.")
    .regex(/\d/, "Add a digit."),
});

type ResetForm = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetForm>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: ResetForm) => {
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, ...data });
      toast.success("Password set. The room is ready when you are.");
      navigate("/login");
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "That link's expired or used.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplit
      eyebrow="A FRESH START"
      heading={
        <>
          Choose a <VermillionUnderline>new</VermillionUnderline> password.
        </>
      }
      sub="Make it something you'll remember. Eight characters or more, with at least one upper, one lower, and a digit."
      formTitle="Set new password"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        <EditorialInput
          label="New password"
          type="password"
          autoComplete="new-password"
          error={errors.new_password?.message}
          {...register("new_password")}
        />
        <EditorialButton
          type="submit"
          filled
          disabled={loading || !token}
          arrow={!loading}
          className="w-full"
        >
          {loading ? "RESETTING…" : "RESET PASSWORD"}
        </EditorialButton>
        {!token && (
          <p className="text-small text-error">
            This link is missing a token. Request a fresh one.
          </p>
        )}
      </form>
    </AuthSplit>
  );
}
