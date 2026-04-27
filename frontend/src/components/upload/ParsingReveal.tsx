import { motion, AnimatePresence } from "framer-motion";
import { easeEditorial, durations } from "@/lib/motion";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";

interface ParsedFields {
  full_name?: string | null;
  title?: string | null;
  experience?: { company?: string; role?: string }[];
  skills?: string[];
  projects?: { name?: string }[];
}

interface Props {
  parsed: ParsedFields | null;
  visibleSteps: number;
}

const STEPS = [
  { key: "name", label: "NAME" },
  { key: "role", label: "ROLE" },
  { key: "years", label: "YEARS" },
  { key: "skills", label: "SKILLS" },
  { key: "projects", label: "PROJECTS" },
] as const;

function fieldFor(key: string, p: ParsedFields | null): string {
  if (!p) return "—";
  switch (key) {
    case "name":
      return p.full_name || "—";
    case "role":
      return p.title || (p.experience?.[0]?.role ?? "—");
    case "years":
      if (!p.experience) return "—";
      return `${p.experience.length} ${p.experience.length === 1 ? "position" : "positions"}`;
    case "skills":
      return (p.skills ?? []).slice(0, 8).join(", ") || "—";
    case "projects":
      return (p.projects ?? []).slice(0, 3).map((x) => x.name).filter(Boolean).join(", ") || "—";
    default:
      return "—";
  }
}

export function ParsingReveal({ parsed, visibleSteps }: Props) {
  return (
    <div className="w-full max-w-prose">
      {STEPS.map((step, i) => (
        <AnimatePresence key={step.key}>
          {i < visibleSteps && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: durations.base, ease: easeEditorial }}
            >
              <div className="grid grid-cols-[110px_1fr] items-baseline gap-6 py-5">
                <Eyebrow className="text-ink-muted">{step.label}</Eyebrow>
                <span className="text-body text-ink">
                  <Typewriter text={fieldFor(step.key, parsed)} />
                </span>
              </div>
              <HairlineDivider />
            </motion.div>
          )}
        </AnimatePresence>
      ))}
    </div>
  );
}

function Typewriter({ text }: { text: string }) {
  // Simple, deliberate reveal — char by char, but smooth and fast.
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: durations.slow, ease: easeEditorial }}
    >
      {text}
    </motion.span>
  );
}
