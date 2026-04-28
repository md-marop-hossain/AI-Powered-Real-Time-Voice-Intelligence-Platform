import { Eyebrow } from "./Eyebrow";

interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface Props<T extends string> {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  hint?: string;
}

/**
 * Editorial-style segmented selector.
 * Each option renders as a bordered chip; the active one fills with ink.
 */
export function ChipSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
}: Props<T>) {
  const active = options.find((o) => o.value === value);
  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>{label}</Eyebrow>
      <ul className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <li key={opt.value}>
              <button
                type="button"
                aria-pressed={isActive}
                onClick={() => onChange(opt.value)}
                className={
                  isActive
                    ? "border border-ink bg-ink px-3 py-1.5 font-mono text-eyebrow text-canvas transition-colors"
                    : "border border-rule bg-canvas px-3 py-1.5 font-mono text-eyebrow text-ink transition-colors hover:border-ink"
                }
              >
                {opt.label}
              </button>
            </li>
          );
        })}
      </ul>
      {(active?.hint || hint) && (
        <p className="text-small text-ink-muted">{active?.hint ?? hint}</p>
      )}
    </div>
  );
}
