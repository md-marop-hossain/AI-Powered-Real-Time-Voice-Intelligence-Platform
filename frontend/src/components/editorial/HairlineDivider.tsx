import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { easeEditorial, durations } from "@/lib/motion";

interface Props {
  strong?: boolean;
  className?: string;
  /** When true, the line draws in (`scaleX 0 → 1`) the first time it
   *  scrolls into view. Reduced-motion users see a static line. */
  animate?: boolean;
}

export function HairlineDivider({ strong, className, animate }: Props) {
  const reduce = useReducedMotion();

  if (!animate || reduce) {
    return (
      <div
        role="separator"
        aria-hidden="true"
        className={cn(strong ? "hairline-strong" : "hairline", className)}
      />
    );
  }

  return (
    <motion.div
      role="separator"
      aria-hidden="true"
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: durations.slow, ease: easeEditorial }}
      style={{ originX: 0 }}
      className={cn(strong ? "hairline-strong" : "hairline", className)}
    />
  );
}
