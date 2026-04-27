import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  attribution?: string;
  className?: string;
}

export function PullQuote({ children, attribution, className }: Props) {
  return (
    <figure
      className={cn("mx-auto max-w-[600px] text-center", className)}
    >
      <blockquote className="text-pullquote text-ink-soft">
        {children}
      </blockquote>
      {attribution && (
        <figcaption className="mt-4 text-eyebrow text-ink-muted">
          — {attribution}
        </figcaption>
      )}
    </figure>
  );
}
