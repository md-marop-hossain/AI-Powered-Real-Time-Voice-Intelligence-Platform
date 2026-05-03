import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";

interface Props {
  /** Final numeric value, parsed from the formatted source. Pass `null`
   *  to render an em-dash. */
  value: number | null;
  /** How many decimal places to display once at rest. Defaults to 0. */
  decimals?: number;
  /** Suffix appended to the rendered string (e.g. "m", "h"). */
  suffix?: string;
  /** Animation duration in ms. Defaults to 900. */
  duration?: number;
  /** Class for the rendered span. */
  className?: string;
  /** Style for the rendered span (e.g. font-variation-settings). */
  style?: React.CSSProperties;
  /** When true, animation only fires once even if the element re-enters
   *  the viewport. Defaults to true. */
  once?: boolean;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Tween a number from 0 → `value` when the element first enters the
 * viewport. Editorial-style readouts feel more alive when the number
 * lands instead of just being there. Reduced-motion users get the
 * final value rendered immediately.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = "",
  duration = 900,
  className,
  style,
  once = true,
}: Props) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once, margin: "-10%" });
  const [display, setDisplay] = useState<string>(() => formatValue(value, decimals, suffix, value === null));

  useEffect(() => {
    if (value === null) {
      setDisplay("—");
      return;
    }
    if (reduce || !inView) {
      // Snap to final value when reduced-motion is on, or when not in
      // view yet (we'll re-run as soon as it scrolls in).
      if (!inView && !reduce) return;
      setDisplay(formatValue(value, decimals, suffix, false));
      return;
    }

    let raf = 0;
    const start = performance.now();
    const from = 0;
    const to = value;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(t);
      const current = from + (to - from) * eased;
      setDisplay(formatValue(current, decimals, suffix, false));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, decimals, suffix, duration, inView, reduce]);

  return (
    <span ref={ref} className={className} style={style}>
      {display}
    </span>
  );
}

function formatValue(
  value: number | null,
  decimals: number,
  suffix: string,
  isDash: boolean,
): string {
  if (isDash || value === null) return "—";
  return `${value.toFixed(decimals)}${suffix}`;
}
