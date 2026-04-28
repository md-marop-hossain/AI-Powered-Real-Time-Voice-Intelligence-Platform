import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { EditorialHeader } from "@/components/editorial/EditorialHeader";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { NumberedMarker } from "@/components/editorial/NumberedMarker";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { EditorialButton } from "@/components/editorial/EditorialButton";
import { EditorialInput } from "@/components/editorial/EditorialInput";
import { LoadingLine } from "@/components/editorial/LoadingLine";
import { ParsingReveal } from "@/components/upload/ParsingReveal";
import { easeEditorial, durations } from "@/lib/motion";

type Stage = "drop" | "parsing" | "configure" | "starting";

interface ParsedResume {
  id: string;
  parsed: {
    full_name?: string | null;
    title?: string | null;
    skills?: string[];
    experience?: { company?: string; role?: string }[];
    projects?: { name?: string }[];
  } | null;
}

const MAX_BYTES = 5 * 1024 * 1024;

export default function UploadPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("drop");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [resume, setResume] = useState<ParsedResume | null>(null);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [role, setRole] = useState("Software Engineer · Senior");
  const [duration, setDuration] = useState(20);

  const handleFile = async (chosen: File) => {
    if (chosen.size > MAX_BYTES) {
      toast.error("That file is over 5 MB. Please upload a smaller copy.");
      return;
    }
    setFile(chosen);
    setStage("parsing");
    setVisibleSteps(0);

    const fd = new FormData();
    fd.append("file", chosen);
    try {
      const r = await api.post<ParsedResume>("/resumes", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResume(r.data);
      // Reveal each parsed field one by one.
      for (let i = 1; i <= 5; i++) {
        await new Promise((res) => setTimeout(res, 350));
        setVisibleSteps(i);
      }
      // Stay on parsing stage; user clicks Next to advance.
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "We couldn't read that file.");
      setStage("drop");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const startSession = async () => {
    if (!resume) return;
    setStage("starting");
    try {
      const session = await api.post("/sessions", {
        resume_id: resume.id,
        role,
        duration_minutes: duration,
      });
      navigate(`/interview/${session.data.id}`);
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? "We couldn't open the room.");
      setStage("configure");
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <EditorialHeader />
      <main className="editorial-container py-16 md:py-24">
        <AnimatePresence mode="wait">
          {stage === "drop" && (
            <DropStage
              key="drop"
              dragOver={dragOver}
              onDragEnter={() => setDragOver(true)}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onPick={handleFile}
            />
          )}

          {stage === "parsing" && (
            <ParsingStage
              key="parsing"
              filename={file?.name ?? ""}
              parsed={resume?.parsed ?? null}
              visibleSteps={visibleSteps}
              onNext={() => setStage("configure")}
            />
          )}

          {stage === "configure" && (
            <ConfigureStage
              key="configure"
              parsedName={resume?.parsed?.full_name ?? null}
              role={role}
              setRole={setRole}
              duration={duration}
              setDuration={setDuration}
              onStart={startSession}
            />
          )}

          {stage === "starting" && (
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
            PDF or DOCX, up to 5 MB.
          </p>
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".pdf,.docx,.txt"
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

interface ParsingStageProps {
  filename: string;
  parsed: ParsedResume["parsed"];
  visibleSteps: number;
  onNext: () => void;
}

function ParsingStage({ filename, parsed, visibleSteps, onNext }: ParsingStageProps) {
  const ready = visibleSteps >= 5;
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.base, ease: easeEditorial }}
    >
      <div className="mb-12 flex items-center justify-between">
        <NumberedMarker index={1} total={3} label="UPLOAD" />
        <Eyebrow>{filename}</Eyebrow>
      </div>

      <div className="grid gap-16 md:grid-cols-[260px_1fr]">
        <div>
          <Eyebrow>{ready ? "Found you." : "Reading carefully…"}</Eyebrow>
          <p className="mt-4 text-h2 text-ink">
            {ready
              ? "Ready when you are."
              : "We're studying every line of your résumé."}
          </p>
          {!ready && (
            <div className="mt-8 max-w-[200px]">
              <LoadingLine width="100%" />
            </div>
          )}
        </div>
        <ParsingReveal parsed={parsed} visibleSteps={visibleSteps} />
      </div>

      <AnimatePresence>
        {ready && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeEditorial, delay: 0.15 }}
            className="mt-16"
          >
            <HairlineDivider />
            <div className="mt-8 flex items-center justify-between">
              <Eyebrow>Looks right? Continue to step 02.</Eyebrow>
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
  duration: number;
  setDuration: (v: number) => void;
  onStart: () => void;
}

function ConfigureStage({
  parsedName,
  role,
  setRole,
  duration,
  setDuration,
  onStart,
}: ConfigureStageProps) {
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

      <div className="grid gap-16 md:grid-cols-[1fr_1fr]">
        <div>
          {parsedName && (
            <Eyebrow className="mb-6 block">
              Hello, {parsedName.split(" ")[0]}.
            </Eyebrow>
          )}
          <h1 className="text-display text-ink">One question before we begin.</h1>
          <p className="mt-6 max-w-prose text-body text-ink-soft">
            Choose the role you're rehearsing for. We'll tailor every question
            to your résumé and the seniority you're aiming for.
          </p>
        </div>

        <div className="flex flex-col gap-10">
          <EditorialInput
            label="Target role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            name="role"
            placeholder="e.g. Senior Software Engineer"
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
          <div className="flex justify-between">
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
