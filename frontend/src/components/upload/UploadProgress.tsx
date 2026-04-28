import { motion, AnimatePresence } from "framer-motion";
import { easeEditorial, durations } from "@/lib/motion";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";

export type Stage =
  | "uploading"
  | "received"
  | "extracting"
  | "analyzing"
  | "indexing"
  | "saving"
  | "complete"
  | "error";

export interface StageState {
  stage: Stage;
  progress: number;
  message: string;
  warning?: string;
  error?: string;
  filename?: string;
  sizeBytes?: number;
  wordCount?: number;
  pageCount?: number;
  elapsedSeconds?: number;
}

interface Props {
  state: StageState;
  uploadProgress: number; // 0-100, network upload only
  filename: string;
}

const STAGE_ORDER: Stage[] = [
  "uploading",
  "received",
  "extracting",
  "analyzing",
  "indexing",
  "saving",
];

const STAGE_LABEL: Record<Stage, string> = {
  uploading: "Uploading the file",
  received: "Receiving",
  extracting: "Reading the document",
  analyzing: "AI structuring the content",
  indexing: "Indexing for similarity",
  saving: "Saving to your account",
  complete: "Complete",
  error: "Error",
};

const STAGE_HINT: Record<Stage, string> = {
  uploading: "Sending the bytes over.",
  received: "We've got the file.",
  extracting: "Pulling clean text out of every page.",
  analyzing: "Asking the LLM to understand sections, roles, skills.",
  indexing: "Building an embedding so similar questions can be found.",
  saving: "Persisting to the database and object storage.",
  complete: "Ready to begin.",
  error: "Something went wrong.",
};

function stageStatus(
  stage: Stage,
  current: Stage,
  progress: number,
): "done" | "active" | "pending" | "error" {
  if (current === "error") {
    const order = STAGE_ORDER.indexOf(stage);
    const cur = progress > 0 ? Math.max(0, Math.floor(progress / 20)) : 0;
    if (order < cur) return "done";
    if (order === cur) return "error";
    return "pending";
  }
  if (current === "complete") return "done";
  const stageIdx = STAGE_ORDER.indexOf(stage);
  const currentIdx = STAGE_ORDER.indexOf(current);
  if (stageIdx < currentIdx) return "done";
  if (stageIdx === currentIdx) return "active";
  return "pending";
}

export function UploadProgress({ state, uploadProgress, filename }: Props) {
  const overall =
    state.stage === "complete"
      ? 100
      : state.stage === "uploading"
        ? Math.round(uploadProgress * 0.1)
        : Math.max(10, state.progress);

  const errored = state.stage === "error";

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.base, ease: easeEditorial }}
    >
      {/* Header */}
      <div className="mb-10 flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow className="text-ink-muted">Reading</Eyebrow>
          <p className="mt-2 truncate font-mono text-body text-ink">{filename}</p>
        </div>
        <div className="text-right">
          <Eyebrow className="text-ink-muted">{errored ? "Error" : "Progress"}</Eyebrow>
          <p
            className={`mt-2 font-mono text-h2 tabular-nums ${
              errored ? "text-accent" : "text-ink"
            }`}
          >
            {errored ? "—" : `${overall}%`}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-[3px] w-full overflow-hidden bg-rule">
        <motion.div
          className={`absolute left-0 top-0 h-full ${
            errored ? "bg-accent" : "bg-ink"
          }`}
          initial={false}
          animate={{ width: `${errored ? 100 : overall}%` }}
          transition={{ duration: durations.base, ease: easeEditorial }}
        />
      </div>

      {/* Live status line */}
      <div className="mt-6 flex items-center gap-3">
        {!errored && state.stage !== "complete" && (
          <motion.span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-accent"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        {state.stage === "complete" && (
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink" />
        )}
        {errored && (
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
        )}
        <p
          className={`text-body ${
            errored ? "text-accent" : "text-ink"
          }`}
          aria-live="polite"
        >
          {errored
            ? state.error ?? state.message ?? "Something went wrong."
            : state.message || STAGE_HINT[state.stage]}
        </p>
      </div>

      {state.warning && !errored && (
        <p className="mt-2 text-small text-ink-muted">{state.warning}</p>
      )}

      <div className="my-12">
        <HairlineDivider />
      </div>

      {/* Step list */}
      <ol className="space-y-6">
        {STAGE_ORDER.map((s) => {
          const status = stageStatus(s, state.stage, state.progress);
          return (
            <li key={s} className="grid grid-cols-[28px_1fr_auto] items-start gap-4">
              <span className="pt-1">
                <StatusGlyph status={status} />
              </span>
              <div>
                <p
                  className={`font-mono text-eyebrow ${
                    status === "active"
                      ? "text-ink"
                      : status === "done"
                        ? "text-ink-muted"
                        : status === "error"
                          ? "text-accent"
                          : "text-ink-muted"
                  }`}
                >
                  {STAGE_LABEL[s].toUpperCase()}
                </p>
                <p className="mt-1 text-small text-ink-muted">
                  {status === "active"
                    ? state.message || STAGE_HINT[s]
                    : status === "done" && stageDoneNote(s, state)
                      ? stageDoneNote(s, state)
                      : STAGE_HINT[s]}
                </p>
              </div>
              <span className="pt-1 font-mono text-eyebrow text-ink-muted tabular-nums">
                {status === "done" ? "DONE" : status === "active" ? "…" : ""}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Errored: show recovery */}
      <AnimatePresence>
        {errored && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeEditorial }}
            className="mt-10 border-l-2 border-accent pl-6"
          >
            <Eyebrow className="text-accent">Couldn't finish</Eyebrow>
            <p className="mt-3 text-body text-ink">
              {state.error ?? state.message ?? "Unexpected error."}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function stageDoneNote(s: Stage, state: StageState): string | null {
  if (s === "uploading" && state.sizeBytes) return `${formatBytes(state.sizeBytes)} sent.`;
  if (s === "received" && state.sizeBytes) return `${formatBytes(state.sizeBytes)} received.`;
  if (s === "extracting" && state.wordCount) {
    const pages = state.pageCount ? ` from ${state.pageCount} page${state.pageCount === 1 ? "" : "s"}` : "";
    return `${state.wordCount.toLocaleString()} words${pages}.`;
  }
  return null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusGlyph({ status }: { status: "done" | "active" | "pending" | "error" }) {
  if (status === "done") {
    return (
      <span
        aria-hidden="true"
        className="block h-5 w-5 border border-ink"
        style={{
          background:
            "linear-gradient(45deg, transparent 45%, currentColor 45%, currentColor 55%, transparent 55%)",
          color: "var(--ink)",
        }}
      />
    );
  }
  if (status === "active") {
    return (
      <motion.span
        aria-hidden="true"
        className="block h-5 w-5 rounded-full border-2 border-accent"
        animate={{ rotate: 360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
        style={{ borderRightColor: "transparent" }}
      />
    );
  }
  if (status === "error") {
    return (
      <span aria-hidden="true" className="block h-5 w-5 border-2 border-accent" />
    );
  }
  return (
    <span aria-hidden="true" className="block h-5 w-5 border border-rule" />
  );
}
