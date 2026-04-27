import { cn } from "@/lib/utils";

interface Props {
  index: number | string;
  total?: number | string;
  label?: string;
  className?: string;
}

export function NumberedMarker({ index, total, label, className }: Props) {
  const padded = typeof index === "number" ? String(index).padStart(2, "0") : index;
  const totalPadded =
    typeof total === "number" ? String(total).padStart(2, "0") : total;
  return (
    <span className={cn("font-mono text-eyebrow text-ink-muted", className)}>
      {padded}
      {totalPadded ? ` / ${totalPadded}` : ""}
      {label ? ` — ${label}` : ""}
    </span>
  );
}
