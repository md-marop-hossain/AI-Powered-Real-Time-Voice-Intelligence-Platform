import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { easeEditorial, durations } from "@/lib/motion";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";

interface Experience {
  company?: string;
  role?: string;
  start?: string | null;
  end?: string | null;
  highlights?: string[];
}

interface Education {
  institution?: string;
  degree?: string | null;
  year?: string | null;
}

interface Project {
  name?: string;
  description?: string | null;
  tech?: string[];
}

interface Contact {
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  links?: string[];
}

export interface ParsedResume {
  full_name?: string | null;
  title?: string | null;
  summary?: string | null;
  skills?: string[];
  experience?: Experience[];
  education?: Education[];
  projects?: Project[];
  contact?: Contact | null;
}

interface Props {
  parsed: ParsedResume | null;
  visibleSteps: number; // 0..6 — controls staggered reveal
}

/**
 * Magazine-style resume review.
 * Sections reveal in sequence based on `visibleSteps`.
 *  1: identity (name, title, contact)
 *  2: summary
 *  3: experience
 *  4: skills
 *  5: education
 *  6: projects
 */
export function ResumeReview({ parsed, visibleSteps }: Props) {
  if (!parsed) {
    return (
      <p className="text-body italic text-ink-muted">
        Nothing to review yet.
      </p>
    );
  }

  const hasSummary = !!parsed.summary?.trim();
  const hasExperience = (parsed.experience?.length ?? 0) > 0;
  const hasSkills = (parsed.skills?.length ?? 0) > 0;
  const hasEducation = (parsed.education?.length ?? 0) > 0;
  const hasProjects = (parsed.projects?.length ?? 0) > 0;

  return (
    <div className="space-y-12">
      {visibleSteps >= 1 && (
        <Reveal>
          <IdentitySection
            name={parsed.full_name}
            title={parsed.title}
            contact={parsed.contact}
          />
        </Reveal>
      )}

      {visibleSteps >= 2 && hasSummary && (
        <Reveal>
          <Section eyebrow="Summary">
            <p className="font-display text-[1.125rem] leading-relaxed text-ink-soft">
              {parsed.summary}
            </p>
          </Section>
        </Reveal>
      )}

      {visibleSteps >= 3 && hasExperience && (
        <Reveal>
          <Section
            eyebrow="Experience"
            count={parsed.experience!.length}
          >
            <ExperienceList items={parsed.experience!} />
          </Section>
        </Reveal>
      )}

      {visibleSteps >= 4 && hasSkills && (
        <Reveal>
          <Section eyebrow="Skills" count={parsed.skills!.length}>
            <SkillCloud skills={parsed.skills!} />
          </Section>
        </Reveal>
      )}

      {visibleSteps >= 5 && hasEducation && (
        <Reveal>
          <Section
            eyebrow="Education"
            count={parsed.education!.length}
          >
            <EducationList items={parsed.education!} />
          </Section>
        </Reveal>
      )}

      {visibleSteps >= 6 && hasProjects && (
        <Reveal>
          <Section eyebrow="Projects" count={parsed.projects!.length}>
            <ProjectList items={parsed.projects!} />
          </Section>
        </Reveal>
      )}
    </div>
  );
}

// ---------- Sub-components ----------

function Reveal({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durations.slow, ease: easeEditorial }}
    >
      {children}
    </motion.div>
  );
}

function Section({
  eyebrow,
  count,
  children,
}: {
  eyebrow: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <Eyebrow>{eyebrow}</Eyebrow>
        {typeof count === "number" && (
          <Eyebrow className="text-ink-muted tabular-nums">
            {String(count).padStart(2, "0")}
          </Eyebrow>
        )}
      </div>
      <HairlineDivider />
      <div className="mt-6">{children}</div>
    </section>
  );
}

function IdentitySection({
  name,
  title,
  contact,
}: {
  name?: string | null;
  title?: string | null;
  contact?: Contact | null;
}) {
  return (
    <section>
      <Eyebrow className="text-ink-muted">Identity</Eyebrow>
      <h2 className="mt-3 font-display text-[2.25rem] font-medium leading-tight text-ink">
        {name || "Name not detected"}
      </h2>
      {title && (
        <p className="mt-2 text-body text-ink-soft italic">{title}</p>
      )}
      {contact && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-small text-ink-muted">
          {contact.email && <ContactBit label="EMAIL" value={contact.email} />}
          {contact.phone && <ContactBit label="PHONE" value={contact.phone} />}
          {contact.location && (
            <ContactBit label="LOCATION" value={contact.location} />
          )}
          {(contact.links ?? []).map((href) => (
            <ContactLink key={href} href={href} />
          ))}
        </div>
      )}
    </section>
  );
}

function ContactBit({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="font-mono text-eyebrow text-ink-muted">{label}</span>
      <span className="text-ink">{value}</span>
    </span>
  );
}

function ContactLink({ href }: { href: string }) {
  const display = href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  return (
    <a
      href={href.startsWith("http") ? href : `https://${href}`}
      target="_blank"
      rel="noopener noreferrer"
      className="editorial-link text-ink"
    >
      {display}
    </a>
  );
}

function ExperienceList({ items }: { items: Experience[] }) {
  return (
    <ol className="space-y-8">
      {items.map((exp, i) => (
        <ExperienceItem key={`${exp.company ?? ""}-${i}`} exp={exp} />
      ))}
    </ol>
  );
}

function ExperienceItem({ exp }: { exp: Experience }) {
  const [open, setOpen] = useState(true);
  const range = formatRange(exp.start, exp.end);
  const highlights = exp.highlights ?? [];
  const hasHighlights = highlights.length > 0;
  return (
    <li className="border-l border-rule pl-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <p className="font-display text-[1.125rem] font-medium text-ink">
            {exp.role || "Role"}
            {exp.company && (
              <>
                <span className="mx-2 text-ink-muted">·</span>
                <span className="text-ink-soft">{exp.company}</span>
              </>
            )}
          </p>
        </div>
        {range && (
          <span className="font-mono text-eyebrow text-ink-muted tabular-nums">
            {range}
          </span>
        )}
      </div>
      {hasHighlights && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-3 font-mono text-eyebrow text-ink-muted hover:text-ink"
          >
            {open ? "▾ HIDE" : "▸ SHOW"} {highlights.length} HIGHLIGHT
            {highlights.length === 1 ? "" : "S"}
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.ul
                key="hl"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: durations.base, ease: easeEditorial }}
                className="mt-3 space-y-2 overflow-hidden"
              >
                {highlights.map((h, i) => (
                  <li
                    key={i}
                    className="flex gap-3 text-body leading-relaxed text-ink-soft"
                  >
                    <span aria-hidden="true" className="mt-[0.55em] inline-block h-px w-3 flex-shrink-0 bg-ink-muted" />
                    <span>{h}</span>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </>
      )}
    </li>
  );
}

const SKILL_LIMIT_DEFAULT = 24;

function SkillCloud({ skills }: { skills: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(
    () => [...new Set(skills.filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [skills],
  );
  const visible = showAll ? sorted : sorted.slice(0, SKILL_LIMIT_DEFAULT);
  const hidden = sorted.length - visible.length;
  return (
    <div>
      <ul className="flex flex-wrap gap-2">
        {visible.map((s) => (
          <li
            key={s}
            className="border border-rule px-3 py-1.5 font-mono text-eyebrow text-ink transition-colors hover:border-ink hover:bg-ink hover:text-canvas"
          >
            {s.toUpperCase()}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-4 font-mono text-eyebrow text-ink-muted hover:text-ink"
        >
          ▸ SHOW {hidden} MORE
        </button>
      )}
      {showAll && sorted.length > SKILL_LIMIT_DEFAULT && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-4 font-mono text-eyebrow text-ink-muted hover:text-ink"
        >
          ▾ COLLAPSE
        </button>
      )}
    </div>
  );
}

function EducationList({ items }: { items: Education[] }) {
  return (
    <ul className="space-y-5">
      {items.map((ed, i) => (
        <li key={i} className="grid grid-cols-1 gap-1 md:grid-cols-[1fr_auto] md:items-baseline md:gap-6">
          <div className="min-w-0">
            <p className="font-display text-[1.0625rem] text-ink">
              {ed.degree || "Degree"}
              {ed.institution && (
                <>
                  <span className="mx-2 text-ink-muted">·</span>
                  <span className="text-ink-soft">{ed.institution}</span>
                </>
              )}
            </p>
          </div>
          {ed.year && (
            <span className="font-mono text-eyebrow text-ink-muted tabular-nums">
              {ed.year}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProjectList({ items }: { items: Project[] }) {
  return (
    <ul className="space-y-6">
      {items.map((p, i) => (
        <ProjectCard key={`${p.name ?? ""}-${i}`} p={p} />
      ))}
    </ul>
  );
}

function ProjectCard({ p }: { p: Project }) {
  return (
    <li className="border-l border-rule pl-6">
      <p className="font-display text-[1.0625rem] font-medium text-ink">
        {p.name || "Untitled project"}
      </p>
      {p.description && (
        <p className="mt-2 text-body leading-relaxed text-ink-soft">
          {p.description}
        </p>
      )}
      {p.tech && p.tech.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {p.tech.map((t) => (
            <li
              key={t}
              className="border border-rule px-2 py-1 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-muted"
            >
              {t}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------- helpers ----------

function formatRange(start?: string | null, end?: string | null): string {
  const a = (start ?? "").trim();
  const b = (end ?? "").trim();
  if (!a && !b) return "";
  if (a && !b) return `${a} —`;
  if (!a && b) return b;
  return `${a} — ${b}`;
}
