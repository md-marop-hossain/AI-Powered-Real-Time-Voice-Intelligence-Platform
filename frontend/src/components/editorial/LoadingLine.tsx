import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  width?: string;
  label?: string;
}

export function LoadingLine({ className, width = "200px", label = "Loading" }: Props) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn("flex justify-center", className)}
    >
      <div className="loading-line" style={{ width }} />
    </div>
  );
}
