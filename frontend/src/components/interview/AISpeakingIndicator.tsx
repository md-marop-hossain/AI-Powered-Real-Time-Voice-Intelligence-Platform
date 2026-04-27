interface Props {
  /** 0..1 amplitude — drives the vertical line's scale. */
  amplitude: number;
}

/**
 * A single centered vertical ink line that pulses with TTS amplitude.
 * Less is more: no orbs, no waveforms, no glow.
 */
export function AISpeakingIndicator({ amplitude }: Props) {
  const scale = 0.4 + Math.min(1, amplitude) * 0.8;
  return (
    <div
      role="img"
      aria-label="AI is speaking"
      className="flex h-32 items-center justify-center"
    >
      <div
        className="bg-ink"
        style={{
          width: "1px",
          height: "100%",
          transform: `scaleY(${scale})`,
          transition: "transform 80ms linear",
        }}
      />
    </div>
  );
}
