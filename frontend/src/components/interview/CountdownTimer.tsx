import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  /** Seconds remaining (server-authoritative; we tick locally between updates). */
  seconds: number | null;
  size?: "lg" | "sm";
  className?: string;
  /** Announce minute changes via aria-live. */
  announce?: boolean;
}

/**
 * JetBrains Mono timer with a pulsing colon. Color shifts to vermillion
 * gradually under 2 minutes; under 30 seconds, a thin vermillion line draws
 * across above the timer (controlled by parent via the `accentLine` prop on the
 * caller side). This component focuses on the digits and color blend only.
 */
export function CountdownTimer({ seconds, size = "lg", className, announce }: Props) {
  const [tick, setTick] = useState(seconds);
  const lastUpdate = useRef<number>(performance.now());

  useEffect(() => {
    setTick(seconds);
    lastUpdate.current = performance.now();
  }, [seconds]);

  // Local tick to keep digits moving between server updates.
  useEffect(() => {
    if (tick === null) return;
    const id = setInterval(() => {
      const dt = (performance.now() - lastUpdate.current) / 1000;
      const next = Math.max(0, (seconds ?? 0) - Math.floor(dt));
      setTick(next);
    }, 1000);
    return () => clearInterval(id);
  }, [seconds, tick]);

  const announceMinute = useRef<number | null>(null);
  useEffect(() => {
    if (!announce || tick === null) return;
    const minutes = Math.floor(tick / 60);
    if (announceMinute.current !== minutes) {
      announceMinute.current = minutes;
    }
  }, [tick, announce]);

  if (tick === null) {
    return (
      <span
        className={cn(
          "font-mono text-ink-muted tabular-nums",
          size === "lg" ? "text-[96px] font-light" : "text-[24px]",
          className,
        )}
      >
        —:—
      </span>
    );
  }

  const m = Math.floor(tick / 60);
  const s = tick % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");

  // Smooth color blend: full ink above 120s, full accent at 0s.
  // Under 120s, blend linearly toward accent over a 30-second-ish window.
  const intensity = Math.max(0, Math.min(1, (120 - tick) / 90));
  const colorStyle: React.CSSProperties = {
    color: `color-mix(in oklab, var(--ink) ${(1 - intensity) * 100}%, var(--accent) ${intensity * 100}%)`,
    transition: "color 1s linear",
  };

  return (
    <div
      className={cn(
        "font-mono tabular-nums tracking-tight inline-flex items-baseline",
        size === "lg" ? "text-[96px] font-light leading-none" : "text-[24px] leading-none",
        className,
      )}
      style={colorStyle}
      role="timer"
      aria-live={announce ? "polite" : "off"}
      aria-atomic="true"
    >
      <span>{mm}</span>
      <span className="timer-colon mx-[0.05em]">:</span>
      <span>{ss}</span>
    </div>
  );
}
