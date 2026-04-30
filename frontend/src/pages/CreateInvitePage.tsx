import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { EditorialHeader } from "@/components/editorial/EditorialHeader";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { EditorialInput } from "@/components/editorial/EditorialInput";
import { ChipSelect } from "@/components/editorial/ChipSelect";

type Seniority = "fresher" | "junior" | "mid" | "senior" | "staff" | "manager";
type Focus = "mixed" | "technical" | "behavioral" | "system_design";
type Mode = "predefined" | "ai_generated" | "jd_based";

const SENIORITY_OPTIONS: { value: Seniority; label: string; hint: string }[] = [
  { value: "fresher", label: "FRESHER", hint: "0 years — fundamentals." },
  { value: "junior", label: "JUNIOR", hint: "1–2 years." },
  { value: "mid", label: "MID-LEVEL", hint: "3–5 years." },
  { value: "senior", label: "SENIOR", hint: "5–8 years." },
  { value: "staff", label: "STAFF / PRINCIPAL", hint: "8+ years." },
  { value: "manager", label: "MANAGER", hint: "Technical + people leadership." },
];

const FOCUS_OPTIONS: { value: Focus; label: string; hint: string }[] = [
  { value: "mixed", label: "MIXED", hint: "Balanced." },
  { value: "technical", label: "TECHNICAL", hint: "Depth, debugging, applied problems." },
  { value: "behavioral", label: "BEHAVIOURAL", hint: "STAR scenarios." },
  { value: "system_design", label: "SYSTEM DESIGN", hint: "Architecture sized to seniority." },
];

const MODE_OPTIONS: { value: Mode; label: string; hint: string }[] = [
  { value: "predefined", label: "PREDEFINED", hint: "Type your own questions." },
  { value: "ai_generated", label: "AI-GENERATED", hint: "We generate questions from role + seniority." },
  { value: "jd_based", label: "JOB DESCRIPTION", hint: "We generate questions from the JD you paste." },
];

interface CreatedInvite {
  id: string;
  token: string;
  invite_url: string;
  expires_at: string;
  invitees: { id: string; email: string; status: string }[];
}

export default function CreateInvitePage() {
  const navigate = useNavigate();

  const [emailsText, setEmailsText] = useState("");
  const [role, setRole] = useState("Software Engineer");
  const [seniority, setSeniority] = useState<Seniority>("mid");
  const [focus, setFocus] = useState<Focus>("mixed");
  const [industry, setIndustry] = useState("");
  const [duration, setDuration] = useState(20);
  const [mode, setMode] = useState<Mode>("ai_generated");

  const [questions, setQuestions] = useState<string[]>([""]);
  const [aiInstructions, setAiInstructions] = useState("");
  const [jobDescription, setJobDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedInvite[] | null>(null);

  const parseEmails = (raw: string): string[] => {
    const seen = new Set<string>();
    return raw
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => {
        if (!e) return false;
        if (seen.has(e)) return false;
        seen.add(e);
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
      });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emails = parseEmails(emailsText);
    if (emails.length === 0) {
      toast.error("Add at least one valid email address.");
      return;
    }
    if (!role.trim()) {
      toast.error("Please enter a target role.");
      return;
    }
    if (mode === "predefined") {
      const cleaned = questions.map((q) => q.trim()).filter(Boolean);
      if (cleaned.length === 0) {
        toast.error("Add at least one question.");
        return;
      }
    }
    if (mode === "jd_based" && !jobDescription.trim()) {
      toast.error("Paste a job description.");
      return;
    }

    const payload: Record<string, unknown> = {
      emails,
      role: role.trim(),
      seniority,
      focus,
      industry: industry.trim() || null,
      duration_minutes: duration,
      mode,
    };
    if (mode === "predefined") {
      payload.questions = questions.map((q) => q.trim()).filter(Boolean);
    } else if (mode === "ai_generated") {
      payload.ai_instructions = aiInstructions.trim() || null;
    } else if (mode === "jd_based") {
      payload.job_description = jobDescription.trim();
    }

    setSubmitting(true);
    try {
      const r = await api.post("/invites", payload);
      const list: CreatedInvite[] = r.data.invites ?? [];
      setCreated(list);
      toast.success(
        list.length === 1 ? "Invitation sent." : `${list.length} invitations sent.`,
      );
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail) && detail.length
            ? `Invalid ${(detail[0]?.loc ?? []).join(".")}: ${detail[0]?.msg ?? ""}`
            : "Couldn't create the invitations.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div className="min-h-screen bg-canvas">
        <EditorialHeader />
        <main className="editorial-container py-16 md:py-24 max-w-3xl">
          <Eyebrow>Invitations sent</Eyebrow>
          <h1 className="mt-4 text-display text-ink">
            {created.length === 1 ? "One link, on its way." : `${created.length} links sent.`}
          </h1>
          <p className="mt-4 text-body text-ink-muted">
            Each candidate received an email with their personal interview link. You can
            also share a link directly below.
          </p>

          <div className="mt-12">
            <HairlineDivider strong />
            <ul>
              {created.map((inv) => (
                <li key={inv.id} className="py-5">
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="text-body text-ink">
                        {inv.invitees.map((i) => i.email).join(", ")}
                      </p>
                      <p className="mt-1 font-mono text-eyebrow text-ink-muted break-all">
                        {inv.invite_url}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(inv.invite_url);
                        toast.success("Link copied.");
                      }}
                      className="editorial-link font-mono text-eyebrow text-ink"
                    >
                      COPY
                    </button>
                  </div>
                  <HairlineDivider />
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-12 flex gap-6">
            <EditorialButton
              filled
              arrow
              onClick={() => navigate("/invites")}
            >
              VIEW ALL INVITES
            </EditorialButton>
            <EditorialButton onClick={() => setCreated(null)}>
              Create another
            </EditorialButton>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <EditorialHeader />
      <main className="editorial-container py-16 md:py-24 max-w-3xl">
        <Eyebrow>Invite candidates</Eyebrow>
        <h1 className="mt-4 text-display text-ink">Create an interview.</h1>
        <p className="mt-4 text-body text-ink-muted">
          Pick the questions, set the format, and send a personal link to each
          candidate. They'll be able to take the interview from any browser.
        </p>

        <form onSubmit={onSubmit} className="mt-16 space-y-12">
          <section>
            <Eyebrow>1. Who are you inviting?</Eyebrow>
            <div className="mt-4">
              <textarea
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value)}
                placeholder="alice@example.com, bob@example.com"
                rows={3}
                className="editorial-input w-full"
                aria-label="Candidate emails"
              />
              <p className="mt-2 text-small text-ink-muted">
                Separate multiple addresses with commas, spaces, or new lines. Each
                candidate gets their own link.
              </p>
            </div>
          </section>

          <HairlineDivider />

          <section className="space-y-8">
            <Eyebrow>2. Interview shape</Eyebrow>
            <p className="text-small text-ink-muted">
              Even when you provide your own questions, these settings still
              tune the live agent's follow-ups and how strictly answers are
              scored. Leave the defaults if you're unsure.
            </p>
            <EditorialInput
              label="Target role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Software Engineer"
            />
            <ChipSelect
              label="Seniority"
              options={SENIORITY_OPTIONS}
              value={seniority}
              onChange={setSeniority}
            />
            <ChipSelect
              label="Focus"
              options={FOCUS_OPTIONS}
              value={focus}
              onChange={setFocus}
            />
            <EditorialInput
              label="Industry (optional)"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Fintech, Healthcare, …"
            />
            <EditorialInput
              label="Duration (minutes)"
              type="number"
              min={5}
              max={60}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value || "20", 10))}
            />
          </section>

          <HairlineDivider />

          <section className="space-y-6">
            <Eyebrow>3. Question source</Eyebrow>
            <ChipSelect
              label="Mode"
              options={MODE_OPTIONS}
              value={mode}
              onChange={setMode}
            />

            {mode === "predefined" && (
              <div className="space-y-3">
                <Eyebrow>Questions</Eyebrow>
                {questions.map((q, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="mt-3 font-mono text-eyebrow text-ink-muted tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <textarea
                      value={q}
                      onChange={(e) => {
                        const next = [...questions];
                        next[i] = e.target.value;
                        setQuestions(next);
                      }}
                      rows={2}
                      placeholder="Type a question…"
                      className="editorial-input flex-1"
                      aria-label={`Question ${i + 1}`}
                    />
                    {questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setQuestions(questions.filter((_, idx) => idx !== i))
                        }
                        className="editorial-link mt-3 font-mono text-eyebrow text-ink-muted hover:text-accent"
                      >
                        REMOVE
                      </button>
                    )}
                  </div>
                ))}
                <div>
                  <EditorialButton
                    type="button"
                    onClick={() => setQuestions([...questions, ""])}
                    arrow
                  >
                    Add question
                  </EditorialButton>
                </div>
              </div>
            )}

            {mode === "ai_generated" && (
              <div>
                <Eyebrow>Extra instructions (optional)</Eyebrow>
                <textarea
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  placeholder="e.g. Lean toward distributed-systems trade-offs and avoid LeetCode-style puzzles."
                  rows={4}
                  className="editorial-input mt-3 w-full"
                />
              </div>
            )}

            {mode === "jd_based" && (
              <div>
                <Eyebrow>Job description</Eyebrow>
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the full job description here…"
                  rows={10}
                  className="editorial-input mt-3 w-full font-mono text-small"
                />
              </div>
            )}
          </section>

          <HairlineDivider />

          <div className="flex items-center gap-6">
            <EditorialButton type="submit" filled arrow disabled={submitting}>
              {submitting ? "SENDING…" : "SEND INVITATIONS"}
            </EditorialButton>
            <Link to="/invites" className="editorial-link text-ink-muted hover:text-ink">
              Back to invites
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
