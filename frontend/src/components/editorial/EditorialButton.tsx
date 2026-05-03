import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

type Tone = "ink" | "accent" | "muted";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  arrow?: boolean;
  filled?: boolean;
}

const tapTransition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };

/**
 * Editorial button: text + underline by default. No filled chrome.
 * Use `filled` only for the single primary CTA on auth pages.
 *
 * Adds a subtle whileTap scale-down for tactile feedback. The filled
 * variant also nudges up a hair on hover so primary CTAs feel alive.
 */
export const EditorialButton = React.forwardRef<HTMLButtonElement, Props>(
  ({ tone = "ink", arrow, filled, className, children, disabled, ...props }, ref) => {
    const reduce = useReducedMotion();
    // Strip props framer-motion handles itself so HTMLMotionProps types match.
    const {
      onDrag,
      onDragStart,
      onDragEnd,
      onAnimationStart,
      onAnimationEnd,
      onAnimationIteration,
      ...buttonProps
    } = props;
    void onDrag;
    void onDragStart;
    void onDragEnd;
    void onAnimationStart;
    void onAnimationEnd;
    void onAnimationIteration;

    if (filled) {
      const bg = tone === "accent" ? "bg-accent" : "bg-ink";
      const bgHover = tone === "accent" ? "hover:bg-accent-hover" : "hover:bg-ink-soft";
      return (
        <motion.button
          ref={ref}
          disabled={disabled}
          whileHover={reduce || disabled ? undefined : { y: -1 }}
          whileTap={reduce || disabled ? undefined : { scale: 0.97 }}
          transition={tapTransition}
          className={cn(
            "group relative inline-flex items-center justify-center gap-2",
            "h-12 px-6 rounded-[2px]",
            "text-eyebrow tracking-[0.18em]",
            bg,
            bgHover,
            "text-canvas-elevated",
            "shadow-[0_1px_0_rgba(0,0,0,0.08)] hover:shadow-[0_8px_24px_-8px_rgba(232,71,44,0.45)]",
            "transition-all duration-base ease-editorial",
            "disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none",
            className,
          )}
          {...buttonProps}
        >
          {/* Soft accent halo on hover — sits under the button label so it
              never interferes with text contrast. Reduced-motion users
              still see the shadow, just without the radial bloom. */}
          {!reduce && (
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute -inset-px -z-10 rounded-[3px]",
                "opacity-0 transition-opacity duration-base ease-editorial",
                "group-hover:opacity-100",
              )}
              style={{
                background:
                  "radial-gradient(120% 60% at 50% 100%, rgba(232,71,44,0.35), transparent 70%)",
              }}
            />
          )}
          <span className="relative">{children}</span>
          {arrow && (
            <motion.span
              aria-hidden="true"
              initial={false}
              animate={{ x: 0 }}
              whileHover={reduce ? undefined : { x: 4 }}
              transition={tapTransition}
              className="relative"
            >
              →
            </motion.span>
          )}
        </motion.button>
      );
    }

    const colorClass =
      tone === "accent"
        ? "text-accent"
        : tone === "muted"
        ? "text-ink-muted"
        : "text-ink";

    return (
      <motion.button
        ref={ref}
        disabled={disabled}
        whileTap={reduce || disabled ? undefined : { scale: 0.96 }}
        transition={tapTransition}
        className={cn(
          "group inline-flex items-baseline gap-2",
          "bg-transparent p-0 border-0",
          "font-body text-[0.9375rem]",
          colorClass,
          "transition-colors duration-base ease-editorial",
          "disabled:opacity-50 disabled:pointer-events-none",
          className,
        )}
        {...buttonProps}
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
      </motion.button>
    );
  },
);
EditorialButton.displayName = "EditorialButton";
