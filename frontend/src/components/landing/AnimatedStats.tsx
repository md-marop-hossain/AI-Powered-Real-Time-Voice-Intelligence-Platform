import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { easeEditorial, durations } from "@/lib/motion";

const STATS = [
  { value: 7, suffix: "", label: "Dimensions of scoring per answer" },
  { value: 6, suffix: "+", label: "Specialized AI agents working in concert" },
  { value: 30, suffix: "s", label: "Seconds — server heartbeat keepalive" },
  { value: 3, suffix: "h", label: "Redis state TTL for mid-interview recovery" },
];

function useCountUp(target: number, active: boolean, duration = 1200) {
  const [count, setCount] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * target));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, target, duration]);

  return count;
}

function StatItem({
  value,
  suffix,
  label,
  delay,
}: {
  value: number;
  suffix: string;
  label: string;
  delay: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLLIElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const count = useCountUp(value, reduce ? true : inView);

  return (
    <motion.li
      ref={ref}
      initial={reduce ? undefined : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{
        duration: durations.base,
        ease: easeEditorial,
        delay,
      }}
    >
      <p
        className="font-display text-[3rem] leading-none text-ink tabular-nums md:text-[3.5rem]"
        style={{ fontVariationSettings: '"opsz" 96' }}
      >
        {reduce ? value : count}
        {suffix}
      </p>
      <p className="mt-4 max-w-[200px] text-small text-ink-soft">{label}</p>
    </motion.li>
  );
}

export function AnimatedStats() {
  return (
    <section className="editorial-container py-24 md:py-32">
      <div className="mb-12">
        <Eyebrow>UNDER THE HOOD</Eyebrow>
        <h2 className="mt-3 text-display text-ink">
          Engineered for a real conversation.
        </h2>
      </div>
      <HairlineDivider strong />
      <ul className="grid grid-cols-2 gap-x-8 gap-y-12 py-12 md:grid-cols-4">
        {STATS.map((s, i) => (
          <StatItem
            key={s.label}
            value={s.value}
            suffix={s.suffix}
            label={s.label}
            delay={i * 0.05}
          />
        ))}
      </ul>
      <HairlineDivider strong />
    </section>
  );
}
