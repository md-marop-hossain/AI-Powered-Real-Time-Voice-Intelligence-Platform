import { motion, useScroll, useSpring, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  /** Stack above the sticky header (z-50 by default) so it stays visible
   *  while scrolling. Override with className if a page wants it lower. */
  className?: string;
}

/**
 * Thin vermillion bar pinned to the top of the viewport that tracks
 * vertical scroll progress. Modern equivalent of a reading-progress
 * indicator — gives long pages (the landing page especially) a sense
 * of place without adding chrome.
 *
 * Honors `prefers-reduced-motion` by rendering nothing for users who
 * have requested it (the bar's whole purpose is motion).
 */
export function ScrollProgress({ className }: Props) {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  // Spring-smooth the progress so the bar glides instead of jittering
  // at small wheel deltas / trackpad inertia.
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 28,
    mass: 0.4,
  });

  if (reduce) return null;

  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX, transformOrigin: "0% 50%" }}
      className={cn(
        "fixed left-0 right-0 top-0 z-50 h-[2px] bg-accent",
        className,
      )}
    />
  );
}
