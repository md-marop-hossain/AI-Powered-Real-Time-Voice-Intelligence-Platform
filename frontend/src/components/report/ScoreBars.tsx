import { motion } from "framer-motion";
import { easeEditorial, durations } from "@/lib/motion";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";

interface Props {
  scores: Record<string, number>;
}

const ORDER = ["clarity", "depth", "correctness", "communication"];

export function ScoreBars({ scores }: Props) {
  const entries = ORDER.filter((k) => k in scores).map((k) => ({
    label: k,
    value: scores[k],
  }));

  return (
    <div className="space-y-6">
      {entries.map((e, i) => (
        <div key={e.label}>
          <div className="grid grid-cols-[80px_1fr_64px] items-baseline gap-6">
            <Eyebrow>{e.label}</Eyebrow>
            <div className="relative h-px bg-rule">
              <motion.div
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: e.value / 10 }}
                viewport={{ once: true }}
                transition={{
                  duration: durations.slow,
                  ease: easeEditorial,
                  delay: 0.1 * i,
                }}
                style={{ transformOrigin: "left" }}
                className="absolute inset-0 bg-ink"
              />
            </div>
            <span
              className="text-right font-display text-h1 text-ink tabular-nums"
              style={{ fontVariationSettings: '"opsz" 36' }}
            >
              {e.value.toFixed(1)}
            </span>
          </div>
          <HairlineDivider className="mt-4" />
        </div>
      ))}
    </div>
  );
}
