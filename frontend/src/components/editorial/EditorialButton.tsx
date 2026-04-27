import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "ink" | "accent" | "muted";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  arrow?: boolean;
  filled?: boolean;
}

/**
 * Editorial button: text + underline by default. No filled chrome.
 * Use `filled` only for the single primary CTA on auth pages.
 */
export const EditorialButton = React.forwardRef<HTMLButtonElement, Props>(
  ({ tone = "ink", arrow, filled, className, children, ...props }, ref) => {
    if (filled) {
      const bg = tone === "accent" ? "bg-accent" : "bg-ink";
      const bgHover = tone === "accent" ? "hover:bg-accent-hover" : "hover:bg-ink-soft";
      return (
        <button
          ref={ref}
          className={cn(
            "inline-flex items-center justify-center gap-2",
            "h-12 px-6 rounded-[2px]",
            "text-eyebrow tracking-[0.18em]",
            bg,
            bgHover,
            "text-canvas-elevated",
            "transition-all duration-base ease-editorial",
            "disabled:opacity-50 disabled:pointer-events-none",
            className,
          )}
          {...props}
        >
          {children}
          {arrow && <span aria-hidden="true">→</span>}
        </button>
      );
    }

    const colorClass =
      tone === "accent"
        ? "text-accent"
        : tone === "muted"
        ? "text-ink-muted"
        : "text-ink";

    return (
      <button
        ref={ref}
        className={cn(
          "group inline-flex items-baseline gap-2",
          "bg-transparent p-0 border-0",
          "font-body text-[0.9375rem]",
          colorClass,
          "transition-colors duration-base ease-editorial",
          "disabled:opacity-50 disabled:pointer-events-none",
          className,
        )}
        {...props}
      >
        <span className="relative">
          {children}
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-0 right-0 -bottom-[2px] h-px origin-left scale-x-0",
              "bg-current transition-transform duration-base ease-editorial",
              "group-hover:scale-x-100 group-focus-visible:scale-x-100",
            )}
          />
        </span>
        {arrow && (
          <span
            aria-hidden="true"
            className="transition-transform duration-base ease-editorial group-hover:translate-x-1"
          >
            →
          </span>
        )}
      </button>
    );
  },
);
EditorialButton.displayName = "EditorialButton";
