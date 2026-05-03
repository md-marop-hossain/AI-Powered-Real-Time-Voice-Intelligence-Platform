import { useRef } from "react";
import { useMotionValue, useSpring, useTransform, useReducedMotion } from "framer-motion";

interface Options {
  /** Maximum rotation in degrees. Defaults to 4. Keep this gentle — large
   *  tilts read as toy-like. */
  max?: number;
  /** Spring stiffness (framer-motion). */
  stiffness?: number;
  /** Spring damping (framer-motion). */
  damping?: number;
}

/**
 * Subtle 3D tilt-on-hover hook. Returns a ref to attach to the surface
 * and motion values for `rotateX`, `rotateY`. Uses pointer position
 * relative to the element. Honors `prefers-reduced-motion` — disabled
 * users get static motion values that never change.
 *
 * Usage:
 *   const { ref, rotateX, rotateY, onMouseMove, onMouseLeave } = useTilt();
 *   <motion.div ref={ref} style={{ rotateX, rotateY, transformPerspective: 800 }}
 *     onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
 */
export function useTilt({ max = 4, stiffness = 220, damping = 18 }: Options = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const rx = useMotionValue(0);
  const ry = useMotionValue(0);

  // Spring smoothing so the surface eases into the new angle instead of
  // snapping to the cursor.
  const rotateX = useSpring(rx, { stiffness, damping });
  const rotateY = useSpring(ry, { stiffness, damping });

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width; // 0..1
    const py = (e.clientY - rect.top) / rect.height; // 0..1
    // Map cursor position to ±max degrees. Y-axis cursor → rotateX (lift).
    rx.set((0.5 - py) * max * 2);
    ry.set((px - 0.5) * max * 2);
  };

  const onMouseLeave = () => {
    rx.set(0);
    ry.set(0);
  };

  // Read-only transform helpers callers may want to feed into pseudo
  // shadows etc.
  const shadow = useTransform([rotateX, rotateY], ([x, y]) => {
    // x and y are degrees in [-max, max]. Convert to a soft cardinal shadow.
    const dx = (y as number) * 0.6;
    const dy = -(x as number) * 0.6;
    return `${dx}px ${dy + 6}px 28px -12px rgba(0,0,0,0.18)`;
  });

  return { ref, rotateX, rotateY, shadow, onMouseMove, onMouseLeave } as const;
}
