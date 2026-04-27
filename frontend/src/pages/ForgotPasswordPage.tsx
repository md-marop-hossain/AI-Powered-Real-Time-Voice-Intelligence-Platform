import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { AuthSplit, VermillionUnderline } from "@/components/editorial/AuthSplit";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { EditorialInput } from "@/components/editorial/EditorialInput";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSubmitted(true);
    } catch {
      toast.error("Something interrupted us. We're looking into it.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplit
      eyebrow="A WAY BACK IN"
      heading={
        <>
          Lost the <VermillionUnderline>password</VermillionUnderline>.
          <br />
          We'll send a way back.
        </>
      }
      sub="Enter the email you signed up with. If we recognise it, you'll receive a link to set a new password — valid for one hour."
      formTitle="Reset password"
      footnote={
        <>
          Remembered it?{" "}
          <Link to="/login" className="editorial-link text-ink">
            Enter the room
          </Link>
        </>
      }
    >
      {submitted ? (
        <div className="space-y-4">
          <p className="text-body text-ink">
            If an account exists for <strong>{email}</strong>, a link is on its
            way.
          </p>
          <p className="text-small text-ink-muted">
            Locally, MailHog catches outgoing mail at{" "}
            <code className="font-mono">localhost:8025</code>.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-8">
          <EditorialInput
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            name="email"
          />
          <EditorialButton
            type="submit"
            filled
            disabled={loading}
            arrow={!loading}
            className="w-full"
          >
            {loading ? "SENDING…" : "SEND THE LINK"}
          </EditorialButton>
        </form>
      )}
    </AuthSplit>
  );
}
