import { useMemo } from "react";

import { Eyebrow } from "@/components/editorial/Eyebrow";

interface Point {
  date: string;
  score: number;
}

interface Props {
  /** Pass every completed session — the component filters internally for
   *  rows with a numeric `overall_score` and sorts oldest → newest. */
  points: Point[];
}

const VIEW_W = 720;
const VIEW_H = 120;
const PAD_X = 8;
const PAD_Y = 12;

/**
 * Inline-SVG sparkline of `overall_score` over time. Y axis is fixed at
 * 0..10 so the slope stays comparable across users. No external charting
 * library — keeps the bundle lean and the visual matches the editorial
 * hairline language better than a generic chart.
 *
 * Renders nothing when there are fewer than two scored sessions, since a
 * single dot doesn't make a trend.
 */
export function ScoreTrend({ points }: Props) {
  const data = useMemo(
    () =>
      points
        .filter(
          (p): p is Point =>
            typeof p.score === "number" && Number.isFinite(p.score),
        )
        .slice()
        .sort((a, b) => +new Date(a.date) - +new Date(b.date)),
    [points],
  );

  if (data.length < 2) return null;

  const innerW = VIEW_W - PAD_X * 2;
  const innerH = VIEW_H - PAD_Y * 2;
  const xs = (i: number) =>
    PAD_X + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const ys = (score: number) =>
    PAD_Y + innerH - (Math.max(0, Math.min(10, score)) / 10) * innerH;

  const path = data
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xs(i).toFixed(1)} ${ys(p.score).toFixed(1)}`)
    .join(" ");

  const last = data[data.length - 1];
  const first = data[0];
  const delta = last.score - first.score;
  const deltaLabel =
    delta === 0
      ? "no change"
      : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} since ${formatShort(first.date)}`;

  return (
    <section className="mb-16">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <Eyebrow>Score trend</Eyebrow>
        <span className="font-mono text-eyebrow tracking-[0.18em] text-ink-muted">
          {data.length} {data.length === 1 ? "SESSION" : "SESSIONS"} ·{" "}
          {deltaLabel.toUpperCase()}
        </span>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="block h-32 w-full"
          aria-label={`Score trend: ${data.length} sessions, latest ${last.score.toFixed(1)} of 10`}
        >
          {/* Reference rules at 5 and 10 — anchors the eye to the scale. */}
          <line
            x1={PAD_X}
            x2={VIEW_W - PAD_X}
            y1={ys(10)}
            y2={ys(10)}
            stroke="var(--rule)"
            strokeWidth="1"
          />
          <line
            x1={PAD_X}
            x2={VIEW_W - PAD_X}
            y1={ys(5)}
            y2={ys(5)}
            stroke="var(--rule)"
            strokeWidth="1"
            strokeDasharray="2 4"
          />
          <path
            d={path}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="1.25"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {data.map((p, i) => (
            <circle
              key={`${p.date}-${i}`}
              cx={xs(i)}
              cy={ys(p.score)}
              r={i === data.length - 1 ? 3 : 1.5}
              fill={i === data.length - 1 ? "var(--accent)" : "var(--ink)"}
            >
              <title>{`${formatShort(p.date)} — ${p.score.toFixed(1)}/10`}</title>
            </circle>
          ))}
        </svg>
        <div className="mt-2 flex justify-between font-mono text-eyebrow tracking-[0.18em] text-ink-muted">
          <span>{formatShort(first.date).toUpperCase()}</span>
          <span>{formatShort(last.date).toUpperCase()}</span>
        </div>
      </div>
    </section>
  );
}

const SHORT_FORMATTER = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

function formatShort(iso: string): string {
  try {
    return SHORT_FORMATTER.format(new Date(iso));
  } catch {
    return iso;
  }
}
