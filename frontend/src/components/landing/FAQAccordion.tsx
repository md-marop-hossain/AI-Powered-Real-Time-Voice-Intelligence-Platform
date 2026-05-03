import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { easeEditorial, durations } from "@/lib/motion";

const FAQS = [
  {
    q: "How does the AI know what to ask me?",
    a: "When you upload your résumé, we extract your skills, experience, and target role. The AI builds a question plan tailored to the position — covering technical depth, system design, and behavioral scenarios relevant to your background.",
  },
  {
    q: "Is this just a chatbot with a microphone?",
    a: "No. The system uses streaming speech-to-text and text-to-speech for a real-time voice conversation. It listens patiently, detects pauses as thinking (not endings), asks genuine follow-ups, and scores your answer on multiple dimensions — just like a real interviewer.",
  },
  {
    q: "What do I get scored on?",
    a: "Every answer is evaluated across seven dimensions: technical depth, problem solving, communication, structure, consistency, confidence, and keyword coverage. You receive per-question rationale and an overall score out of 10.",
  },
  {
    q: "Can my team use this to screen candidates?",
    a: "Yes. The invitation system lets you send tokenized interview links to candidates with custom question sets — predefined, AI-generated from their résumé, or based on a job description. You control attempts, expiry, and can review results on a dedicated dashboard.",
  },
  {
    q: "How long does a session take?",
    a: "You choose the duration when you start — typically 15 to 30 minutes. The AI adapts the number of questions to fit your window. After the session, your scored PDF report is generated automatically.",
  },
  {
    q: "Is my data private?",
    a: "Your résumé, audio, and transcripts are stored securely and tied to your account. We use JWT authentication, encrypted connections, and never share your data with third parties. You can delete your account and all associated data at any time.",
  },
];

export function FAQAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const reduce = useReducedMotion();

  const toggle = (i: number) => setOpenIndex(openIndex === i ? null : i);

  return (
    <section className="bg-canvas-sunken py-24 md:py-32">
      <div className="editorial-container">
        <div className="mb-16 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <Eyebrow>QUESTIONS</Eyebrow>
            <h2 className="mt-3 text-display text-ink">
              Before you step into the room.
            </h2>
          </div>
          <p className="max-w-[380px] text-body text-ink-soft">
            Everything you might want to know — answered plainly, nothing hidden
            behind marketing.
          </p>
        </div>

        <HairlineDivider strong />

        <ol>
          {FAQS.map((faq, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                className="group flex w-full items-baseline justify-between gap-6 py-6 text-left transition-colors duration-base ease-editorial hover:bg-canvas-elevated"
                aria-expanded={openIndex === i}
              >
                <span className="text-body text-ink">{faq.q}</span>
                <motion.span
                  animate={{ rotate: openIndex === i ? 45 : 0 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { duration: durations.base, ease: easeEditorial }
                  }
                  className="shrink-0 font-display text-[1.5rem] leading-none text-ink-muted"
                  aria-hidden="true"
                >
                  +
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {openIndex === i && (
                  <motion.div
                    key="content"
                    initial={reduce ? undefined : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{
                      duration: reduce ? 0 : durations.base,
                      ease: easeEditorial,
                    }}
                    className="overflow-hidden"
                  >
                    <p className="pb-6 pr-12 text-body leading-relaxed text-ink-soft">
                      {faq.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <HairlineDivider />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
