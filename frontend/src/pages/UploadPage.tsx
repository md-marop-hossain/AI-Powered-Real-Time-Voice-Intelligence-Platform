import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { streamNdjsonUpload } from "@/lib/streaming";
import { useAuthStore } from "@/store/auth";
import { EditorialHeader } from "@/components/editorial/EditorialHeader";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { NumberedMarker } from "@/components/editorial/NumberedMarker";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { EditorialInput } from "@/components/editorial/EditorialInput";
import { LoadingLine } from "@/components/editorial/LoadingLine";
import { ResumeReview } from "@/components/upload/ResumeReview";
import { ChipSelect } from "@/components/editorial/ChipSelect";
import {
  StageState,
  UploadProgress,
} from "@/components/upload/UploadProgress";
import { easeEditorial, durations } from "@/lib/motion";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTS = [".pdf", ".docx", ".txt"];
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

type Phase = "drop" | "processing" | "review" | "configure" | "starting";

type Seniority = "fresher" | "junior" | "mid" | "senior" | "staff" | "manager";
type Focus = "mixed" | "technical" | "behavioral" | "system_design";

const SENIORITY_OPTIONS: { value: Seniority; label: string; hint: string }[] = [
  { value: "fresher", label: "FRESHER", hint: "0 years — fundamentals and learning aptitude." },
  { value: "junior", label: "JUNIOR", hint: "1–2 years — solid basics, simple ownership." },
  { value: "mid", label: "MID-LEVEL", hint: "3–5 years — applied trade-offs and project depth." },
  { value: "senior", label: "SENIOR", hint: "5–8 years — leadership, scoping, complex systems." },
  { value: "staff", label: "STAFF / PRINCIPAL", hint: "8+ years — strategy, ambiguity, organisational leverage." },
  { value: "manager", label: "MANAGER", hint: "Mix of technical fluency and people leadership." },
];

const FOCUS_OPTIONS: { value: Focus; label: string; hint: string }[] = [
  { value: "mixed", label: "MIXED", hint: "Balanced: intro, resume, technical, behavioural, closing." },
  { value: "technical", label: "TECHNICAL", hint: "Language depth, algorithms, debugging, applied problem-solving." },
  { value: "behavioral", label: "BEHAVIOURAL", hint: "STAR scenarios — ownership, conflict, growth, collaboration." },
  { value: "system_design", label: "SYSTEM DESIGN", hint: "Open-ended architecture sized to seniority." },
];

interface ParsedFields {
  full_name?: string | null;
  title?: string | null;
  skills?: string[];
  experience?: { company?: string; role?: string }[];
  projects?: { name?: string }[];
  education?: { institution?: string }[];
}

interface ResumePayload {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  parsed: ParsedFields | null;
  created_at: string;
}

interface StreamEvent {
  stage: StageState["stage"];
  progress: number;
  message: string;
  warning?: string;
  size_bytes?: number;
  filename?: string;
  word_count?: number;
  page_count?: number;
  quality?: string;
  parsed?: ParsedFields;
  elapsed_seconds?: number;
  resume?: ResumePayload;
}

export default function UploadPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.accessToken);

  const [phase, setPhase] = useState<Phase>("drop");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [resume, setResume] = useState<ResumePayload | null>(null);
  const [parsed, setParsed] = useState<ParsedFields | null>(null);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [role, setRole] = useState("Software Engineer");
  const [seniority, setSeniority] = useState<Seniority>("mid");
  const [focus, setFocus] = useState<Focus>("mixed");
  const [industry, setIndustry] = useState("");
  const [duration, setDuration] = useState(20);

  const [stage, setStage] = useState<StageState>({
    stage: "uploading",
    progress: 0,
    message: "",
  });
  const [uploadPct] = useState(0); // server doesn't currently report incremental upload; reserved

  const validate = (chosen: File): string | null => {
    if (chosen.size > MAX_BYTES) return "That file is over 10 MB. Please upload a smaller copy.";
    if (chosen.size === 0) return "That file appears to be empty.";
    const lowerName = chosen.name.toLowerCase();
    const okExt = ALLOWED_EXTS.some((e) => lowerName.endsWith(e));
    const okType = ALLOWED_TYPES.has(chosen.type);
    if (!okExt && !okType) return "Please upload a PDF, DOCX, or TXT file.";
    return null;
  };

  const handleFile = async (chosen: File) => {
    const err = validate(chosen);
    if (err) {
      toast.error(err);
      return;
    }
    setFile(chosen);
    setResume(null);
    setParsed(null);
    setVisibleSteps(0);
    setStage({
      stage: "uploading",
      progress: 0,
      message: `Sending ${chosen.name}…`,
      filename: chosen.name,
      sizeBytes: chosen.size,
    });
    setPhase("processing");

    const fd = new FormData();
    fd.append("file", chosen);

    try {
      const stream = streamNdjsonUpload<StreamEvent>(
        `${API_URL}/api/v1/resumes/process`,
        fd,
        { token },
      );
      for await (const ev of stream) {
        if (ev.stage === "error") {
          setStage((s) => ({
            ...s,
            stage: "error",
            error: ev.message || "Something went wrong.",
            message: ev.message,
          }));
          return;
        }

        setStage((s) => ({
          ...s,
          stage: ev.stage,
          progress: ev.progress,
          message: ev.message ?? s.message,
          warning: ev.warning ?? s.warning,
          sizeBytes: ev.size_bytes ?? s.sizeBytes,
          wordCount: ev.word_count ?? s.wordCount,
          pageCount: ev.page_count ?? s.pageCount,
          elapsedSeconds: ev.elapsed_seconds ?? s.elapsedSeconds,
        }));

        if (ev.parsed) setParsed(ev.parsed);
        if (ev.resume) setResume(ev.resume);
      }
    } catch (e: any) {
      setStage((s) => ({
        ...s,
        stage: "error",
        error: e?.message ?? "Upload failed. Check your connection and try again.",
      }));
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const goToReview = useCallback(async () => {
    setPhase("review");
    setVisibleSteps(0);
    for (let i = 1; i <= 6; i++) {
      await new Promise((res) => setTimeout(res, 280));
      setVisibleSteps(i);
    }
  }, []);

  const retry = () => {
    setFile(null);
    setResume(null);
    setParsed(null);
    setStage({ stage: "uploading", progress: 0, message: "" });
    setPhase("drop");
  };

  const startSession = async () => {
    if (!resume) return;
    if (!role.trim()) {
      toast.error("Please enter a target position.");
      return;
    }
    setPhase("starting");
    try {
      const session = await api.post("/sessions", {
        resume_id: resume.id,
        role: role.trim(),
        seniority,
        focus,
        industry: industry.trim() || null,
        duration_minutes: duration,
      });
      navigate(`/interview/${session.data.id}`);
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "We couldn't open the room.");
      setPhase("configure");
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <EditorialHeader />
      <main className="editorial-container py-16 md:py-24">
        <AnimatePresence mode="wait">
          {phase === "drop" && (
            <DropStage
              key="drop"
              dragOver={dragOver}
              onDragEnter={() => setDragOver(true)}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onPick={handleFile}
            />
          )}

          {phase === "processing" && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: durations.base, ease: easeEditorial }}
            >
              <div className="mb-12 flex items-center justify-between">
                <NumberedMarker index={1} total={3} label="UPLOAD" />
                <Eyebrow>Step 01 of 03</Eyebrow>
              </div>
              <UploadProgress
                state={stage}
                uploadProgress={uploadPct}
                filename={file?.name ?? "résumé"}
              />

              <AnimatePresence>
                {stage.stage === "complete" && resume && (
                  <motion.div
                    key="complete-cta"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: durations.base, ease: easeEditorial, delay: 0.15 }}
                    className="mt-12"
                  >
                    <HairlineDivider />
                    <div className="mt-8 flex items-center justify-between">
                      <Eyebrow>
                        Done in {stage.elapsedSeconds?.toFixed(1) ?? "—"}s · Review what we found?
                      </Eyebrow>
                      <EditorialButton onClick={goToReview} filled arrow>
                        REVIEW
                      </EditorialButton>
                    </div>
                  </motion.div>
                )}

                {stage.stage === "error" && (
                  <motion.div
                    key="error-cta"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: durations.base, ease: easeEditorial }}
                    className="mt-12"
                  >
                    <HairlineDivider />
                    <div className="mt-8 flex items-center justify-between">
                      <Eyebrow className="text-ink-muted">
                        Try again with a different file?
                      </Eyebrow>
                      <EditorialButton onClick={retry} filled arrow>
                        TRY ANOTHER FILE
                      </EditorialButton>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {phase === "review" && (
            <ReviewStage
              key="review"
              filename={file?.name ?? ""}
              parsed={parsed}
              visibleSteps={visibleSteps}
              onNext={() => setPhase("configure")}
            />
          )}

          {phase === "configure" && (
            <ConfigureStage
              key="configure"
              parsedName={parsed?.full_name ?? null}
              role={role}
              setRole={setRole}
              seniority={seniority}
              setSeniority={setSeniority}
              focus={focus}
              setFocus={setFocus}
              industry={industry}
              setIndustry={setIndustry}
              duration={duration}
              setDuration={setDuration}
              onStart={startSession}
            />
          )}

          {phase === "starting" && (
            <motion.div
              key="starting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: durations.base, ease: easeEditorial }}
              className="flex flex-col items-center gap-8 py-32"
            >
              <p className="text-display text-ink-soft">Opening the room…</p>
              <LoadingLine />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

interface DropStageProps {
  dragOver: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onPick: (f: File) => void;
}

function DropStage({ dragOver, onDragEnter, onDragLeave, onDrop, onPick }: DropStageProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.base, ease: easeEditorial }}
    >
      <div className="mb-12 flex items-center justify-between">
        <NumberedMarker index={1} total={3} label="UPLOAD" />
        <Eyebrow>Step 01 of 03</Eyebrow>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          onDragEnter();
        }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="relative"
        style={{ minHeight: "60vh" }}
      >
        <motion.div
          animate={{
            backgroundColor: dragOver ? "rgba(26,24,20,0.04)" : "rgba(26,24,20,0)",
          }}
          transition={{ duration: durations.quick, ease: easeEditorial }}
          className="absolute inset-0 -mx-6 md:-mx-20"
        />
        <div
          className={`relative flex min-h-[60vh] flex-col items-center justify-center gap-6 transition-all ${
            dragOver ? "border-2 border-dashed border-rule-strong" : ""
          }`}
        >
          <h1 className="text-hero text-ink">Drop your résumé.</h1>
          <p className="text-body text-ink-muted">
            PDF, DOCX, or TXT · up to 10 MB · processed locally and privately.
          </p>
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPick(f);
              }}
            />
            <span className="editorial-link text-ink">
              or choose a file <span aria-hidden="true">→</span>
            </span>
          </label>
        </div>
      </div>
    </motion.section>
  );
}

interface ReviewStageProps {
  filename: string;
  parsed: ParsedFields | null;
  visibleSteps: number;
  onNext: () => void;
}

function ReviewStage({ filename, parsed, visibleSteps, onNext }: ReviewStageProps) {
  const ready = visibleSteps >= 6;
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.base, ease: easeEditorial }}
    >
      <div className="mb-12 flex items-center justify-between">
        <NumberedMarker index={1} total={3} label="REVIEW" />
        <Eyebrow>{filename}</Eyebrow>
      </div>

      {/* Header strip */}
      <div className="mb-12 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <Eyebrow className="text-ink-muted">
            {ready ? "Found you." : "Reading carefully…"}
          </Eyebrow>
          <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink md:text-[2.5rem]">
            {ready ? "Looks right?" : "Surfacing what we found."}
          </h1>
          <p className="mt-3 max-w-prose text-body text-ink-soft">
            Quickly scan what the AI extracted. Open any role to see highlights, or
            expand the skill list. Anything off? Try a different file.
          </p>
        </div>
        {!ready && (
          <div className="max-w-[220px]">
            <LoadingLine width="100%" />
          </div>
        )}
      </div>

      <ResumeReview parsed={parsed} visibleSteps={visibleSteps} />

      <AnimatePresence>
        {ready && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeEditorial, delay: 0.15 }}
            className="mt-20"
          >
            <HairlineDivider />
            <div className="mt-8 flex items-center justify-between">
              <Eyebrow>Pick the role next.</Eyebrow>
              <EditorialButton onClick={onNext} filled arrow>
                NEXT
              </EditorialButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

interface ConfigureStageProps {
  parsedName: string | null;
  role: string;
  setRole: (v: string) => void;
  seniority: Seniority;
  setSeniority: (v: Seniority) => void;
  focus: Focus;
  setFocus: (v: Focus) => void;
  industry: string;
  setIndustry: (v: string) => void;
  duration: number;
  setDuration: (v: number) => void;
  onStart: () => void;
}

function ConfigureStage({
  parsedName,
  role,
  setRole,
  seniority,
  setSeniority,
  focus,
  setFocus,
  industry,
  setIndustry,
  duration,
  setDuration,
  onStart,
}: ConfigureStageProps) {
  const seniorityLabel = SENIORITY_OPTIONS.find((o) => o.value === seniority)?.label ?? "";
  const focusLabel = FOCUS_OPTIONS.find((o) => o.value === focus)?.label ?? "";

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.base, ease: easeEditorial }}
    >
      <div className="mb-12 flex items-center justify-between">
        <NumberedMarker index={2} total={3} label="ROLE" />
        <Eyebrow>Step 02 of 03</Eyebrow>
      </div>

      <div className="grid gap-16 md:grid-cols-[1fr_1.4fr]">
        <div>
          {parsedName && (
            <Eyebrow className="mb-6 block">
              Hello, {parsedName.split(" ")[0]}.
            </Eyebrow>
          )}
          <h1 className="text-display text-ink">A few questions before we begin.</h1>
          <p className="mt-6 max-w-prose text-body text-ink-soft">
            Tell us what you're rehearsing for. The interviewer will calibrate
            difficulty to your seniority and weight question types toward your focus.
          </p>

          <div className="mt-10 space-y-3 border-l border-rule pl-5 text-small text-ink-muted">
            <p>
              <span className="font-mono text-eyebrow text-ink-muted">SUMMARY · </span>
              <span className="text-ink">
                {role.trim() || "Role"}
              </span>
              {seniorityLabel && (
                <>
                  {" · "}
                  <span className="text-ink">{seniorityLabel}</span>
                </>
              )}
              {focusLabel && (
                <>
                  {" · "}
                  <span className="text-ink">{focusLabel}</span>
                </>
              )}
              {industry.trim() && (
                <>
                  {" · "}
                  <span className="text-ink">{industry.trim()}</span>
                </>
              )}
              {" · "}
              <span className="text-ink">{duration} min</span>
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-10">
          <EditorialInput
            label="Target position"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            name="role"
            placeholder="e.g. Software Engineer, Product Manager, Data Scientist"
            hint="The job title you're rehearsing for."
          />

          <ChipSelect
            label="Seniority level"
            options={SENIORITY_OPTIONS}
            value={seniority}
            onChange={setSeniority}
          />

          <ChipSelect
            label="Interview focus"
            options={FOCUS_OPTIONS}
            value={focus}
            onChange={setFocus}
          />

          <EditorialInput
            label="Industry / domain (optional)"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            name="industry"
            placeholder="e.g. Fintech, AI/ML, Healthcare, E-commerce"
            hint="Helps the interviewer ground questions in real-world context."
          />

          <EditorialInput
            label="Duration (minutes)"
            type="number"
            min={5}
            max={60}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            name="duration"
          />

          <HairlineDivider />
          <div className="flex items-center justify-between">
            <NumberedMarker index={3} total={3} label="BEGIN" />
            <EditorialButton onClick={onStart} filled arrow>
              I'M READY
            </EditorialButton>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
