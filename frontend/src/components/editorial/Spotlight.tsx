import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  /** Radius of the spotlight in pixels. Defaults to 280. */
  radius?: number;
  /** CSS color string for the spotlight glow. Use translucent values for
   *  a soft look (defaults to a faint vermillion accent). */
  color?: string;
  /** Extra classes for the wrapping element. */
  className?: string;
}

/**
 * Soft cursor-tracking spotlight. Wraps a surface and renders a faint
 * radial gradient that follows the pointer. Used on hero / sample cards
 * and dashboard rows for a modern, alive feel.
 *
 * Honors `prefers-reduced-motion` — the spotlight stays hidden when the
 * user has requested reduced motion.
 */
export function Spotlight({
  children,
  radius = 280,
  color = "rgba(232, 71, 44, 0.10)",
  className,
}: Props) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => setPos(null)}
      className={cn("relative isolate overflow-hidden", className)}
    >
      {/* Spotlight layer — pointer-events-none so it never steals clicks. */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: pos
            ? `radial-gradient(${radius}px circle at ${pos.x}px ${pos.y}px, ${color}, transparent 70%)`
            : "transparent",
          opacity: pos ? 1 : 0,
          transition: "opacity 320ms cubic-bezier(0.22,1,0.36,1)",
        }}
      />

      <div className="relative z-10">{children}</div>
    </div>
  );
}
