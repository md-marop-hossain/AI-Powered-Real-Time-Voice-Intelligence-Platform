import { cn } from "@/lib/utils";

interface Props {
  strong?: boolean;
  className?: string;
}

export function HairlineDivider({ strong, className }: Props) {
  return (
    <div
      role="separator"
      aria-hidden="true"
      className={cn(strong ? "hairline-strong" : "hairline", className)}
    />
  );
}
