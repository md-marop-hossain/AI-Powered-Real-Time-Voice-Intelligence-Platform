import * as React from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./Eyebrow";

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const EditorialInput = React.forwardRef<HTMLInputElement, Props>(
  ({ label, hint, error, id, className, ...props }, ref) => {
    const inputId = id ?? props.name;
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId}>
          <Eyebrow>{label}</Eyebrow>
        </label>
        <input
          ref={ref}
          id={inputId}
          className={cn("editorial-input", className)}
          {...props}
        />
        {hint && !error && (
          <span className="text-small text-ink-muted">{hint}</span>
        )}
        {error && <span className="text-small text-error">{error}</span>}
      </div>
    );
  },
);
EditorialInput.displayName = "EditorialInput";
