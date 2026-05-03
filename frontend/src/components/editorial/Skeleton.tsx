import { cn } from "@/lib/utils";
import { HairlineDivider } from "./HairlineDivider";

interface BlockProps {
  className?: string;
  /** Width as a tailwind class (e.g. "w-32") or arbitrary CSS via style. */
  width?: string;
  /** Height as a tailwind class. Defaults to "h-3". */
  height?: string;
  /** Disables the shimmer (e.g. when reduced-motion isn't queryable in
   *  context). The static block is still useful as layout placeholder. */
  static?: boolean;
}

/**
 * Editorial skeleton block. Single thin bar with a moving highlight,
 * matching the hairline aesthetic. Used while async data resolves.
 */
export function SkeletonBlock({
  className,
  width = "w-32",
  height = "h-3",
  static: isStatic,
}: BlockProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block rounded-[2px] bg-rule",
        !isStatic && "skeleton-shimmer",
        width,
        height,
        className,
      )}
    />
  );
}

/**
 * Skeleton row that mirrors the layout of `SessionRowItem` in the
 * dashboard (number column, role + meta, score, action). Renders N
 * stacked rows with subtle staggered shimmer.
 */
export function SkeletonSessionList({ rows = 4 }: { rows?: number }) {
  return (
    <ol aria-busy="true" aria-label="Loading sessions">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i}>
          <div
            className="grid grid-cols-[80px_1fr_auto_auto_auto] items-baseline gap-6 py-6"
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <SkeletonBlock width="w-12" height="h-3" />
            <div className="flex flex-col gap-2">
              <SkeletonBlock width="w-44" height="h-4" />
              <SkeletonBlock width="w-32" height="h-2.5" />
            </div>
            <SkeletonBlock width="w-12" height="h-7" />
            <SkeletonBlock width="w-16" height="h-3" />
            <SkeletonBlock width="w-4" height="h-3" />
          </div>
          <HairlineDivider />
        </li>
      ))}
    </ol>
  );
}
