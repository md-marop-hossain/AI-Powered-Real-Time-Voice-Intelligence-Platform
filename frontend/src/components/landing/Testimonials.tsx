import { motion, useReducedMotion } from "framer-motion";

import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { easeEditorial, durations } from "@/lib/motion";

const TESTIMONIALS = [
  {
    quote:
      "I used to freeze in technical interviews. After three sessions here, I walked into my Google loop calm and prepared. The follow-up questions were exactly what I needed.",
    name: "Priya S.",
    role: "Software Engineer → Google",
    accent: "CAREER MOVE",
  },
  {
    quote:
      "The scored report showed me I was strong on depth but weak on communication. No interviewer had ever broken that down for me before. I practiced twice more and improved by two full points.",
    name: "Marcus T.",
    role: "Senior Backend Engineer",
    accent: "SELF-AWARENESS",
  },
  {
    quote:
      "We use this to pre-screen engineering candidates before the panel round. The AI-generated question plans save our hiring managers hours every week.",
    name: "Lena K.",
    role: "Head of Engineering, Series B Startup",
    accent: "TEAM USE",
  },
];

export function Testimonials() {
  const reduce = useReducedMotion();

  return (
    <section className="editorial-container py-24 md:py-32">
      <div className="mb-16">
        <Eyebrow>WHAT THEY SAY</Eyebrow>
        <h2 className="mt-3 text-display text-ink">
          Candidates who rehearsed. Outcomes that changed.
        </h2>
      </div>

      <HairlineDivider strong />

      <ul className="grid gap-0 md:grid-cols-3">
        {TESTIMONIALS.map((t, i) => (
          <motion.li
            key={t.name}
            initial={reduce ? undefined : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{
              duration: durations.slow,
              ease: easeEditorial,
              delay: i * 0.08,
            }}
            className="border-b border-rule md:border-b-0 md:border-r md:last:border-r-0 px-0 py-10 md:px-8 md:first:pl-0 md:last:pr-0"
          >
            <Eyebrow className="text-accent">{t.accent}</Eyebrow>

            <blockquote className="mt-6 text-body leading-relaxed text-ink-soft">
              &ldquo;{t.quote}&rdquo;
            </blockquote>

            <footer className="mt-8">
              <p className="font-mono text-eyebrow text-ink">{t.name}</p>
              <p className="mt-1 font-mono text-eyebrow text-ink-muted">
                {t.role}
              </p>
            </footer>
          </motion.li>
        ))}
      </ul>

      <HairlineDivider strong />
    </section>
  );
}
