import { useNavigate } from "react-router-dom";
import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";

interface Props {
  onSameRoleHarder?: () => void;
  onDifferentRole?: () => void;
  onDrillStruggles?: () => void;
}

const OPTIONS: Array<{ key: keyof Props; label: string; sub: string }> = [
  {
    key: "onSameRoleHarder",
    label: "Same role, harder questions",
    sub: "We'll lean on the spots you found uncomfortable.",
  },
  {
    key: "onDifferentRole",
    label: "Same résumé, different role",
    sub: "Try the same résumé under a different lens.",
  },
  {
    key: "onDrillStruggles",
    label: "Drill the questions you struggled with",
    sub: "A short, targeted set — five questions, fifteen minutes.",
  },
];

/**
 * Three text-only follow-up paths after a session. Each is a quiet link.
 */
export function PracticeAgainButton(props: Props) {
  const navigate = useNavigate();
  const fallback = () => navigate("/upload");

  return (
    <section>
      <Eyebrow className="mb-6 block">Practice again</Eyebrow>
      <ol>
        {OPTIONS.map((opt, i) => {
          const handler = (props[opt.key] as (() => void) | undefined) ?? fallback;
          return (
            <li key={opt.key}>
              <button
                onClick={handler}
                className="grid w-full grid-cols-[40px_1fr_24px] items-baseline gap-6 py-6 text-left transition-colors duration-base ease-editorial hover:bg-canvas-elevated"
              >
                <span className="font-mono text-eyebrow text-ink-muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-h2 text-ink">{opt.label}</p>
                  <p className="mt-2 text-small text-ink-muted">{opt.sub}</p>
                </div>
                <span aria-hidden="true" className="text-ink">→</span>
              </button>
              <HairlineDivider />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
