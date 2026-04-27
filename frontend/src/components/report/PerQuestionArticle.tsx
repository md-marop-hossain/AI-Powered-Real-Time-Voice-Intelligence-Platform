import { Eyebrow } from "@/components/editorial/Eyebrow";
import { HairlineDivider } from "@/components/editorial/HairlineDivider";
import { NumberedMarker } from "@/components/editorial/NumberedMarker";

interface Props {
  index: number;
  question: string;
  answer: string;
  feedback?: string;
  scores?: Record<string, number>;
}

function average(scores?: Record<string, number>): number | null {
  if (!scores) return null;
  const values = Object.values(scores);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function PerQuestionArticle({
  index,
  question,
  answer,
  feedback,
  scores,
}: Props) {
  const avg = average(scores);
  return (
    <article className="grid grid-cols-1 gap-8 py-12 md:grid-cols-[140px_1fr]">
      <NumberedMarker index={`Q${index}`} />
      <div className="max-w-prose">
        <HairlineDivider strong className="mb-8" />
        <p className="text-h1 text-ink">"{question}"</p>

        <Eyebrow className="mt-12 mb-3 block">Your answer</Eyebrow>
        <p className="whitespace-pre-wrap text-body text-ink-soft">
          {answer || "(no answer captured)"}
        </p>

        {feedback && (
          <>
            <Eyebrow className="mt-12 mb-3 block">Feedback</Eyebrow>
            <p
              className="font-display italic text-pullquote text-ink-soft pl-6 border-l border-rule-strong"
              style={{ fontVariationSettings: '"opsz" 36, "SOFT" 100' }}
            >
              {feedback}
            </p>
          </>
        )}

        {avg !== null && (
          <div className="mt-12 flex items-baseline gap-4">
            <Eyebrow>Score</Eyebrow>
            <span
              className="font-display text-h1 text-ink tabular-nums"
              style={{ fontVariationSettings: '"opsz" 36' }}
            >
              {avg.toFixed(1)}
            </span>
          </div>
        )}
        <HairlineDivider className="mt-12" />
      </div>
    </article>
  );
}
