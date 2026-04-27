import { cn } from "@/lib/utils";

interface EyebrowProps {
  children: React.ReactNode;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}

export function Eyebrow({ children, className, as: Tag = "span" }: EyebrowProps) {
  return (
    <Tag className={cn("text-eyebrow text-ink-muted", className)}>{children}</Tag>
  );
}
