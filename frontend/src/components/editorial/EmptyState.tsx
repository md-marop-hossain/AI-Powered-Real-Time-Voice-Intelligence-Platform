import { Link } from "react-router-dom";

interface Props {
  title: string;
  actionLabel?: string;
  to?: string;
}

export function EmptyState({ title, actionLabel, to }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <h2 className="text-display text-ink-soft">{title}</h2>
      {actionLabel && to && (
        <Link
          to={to}
          className="editorial-link mt-8 inline-flex items-baseline gap-2 text-ink"
        >
          {actionLabel} <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}
