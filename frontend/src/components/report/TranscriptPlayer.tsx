import { useEffect, useRef, useState } from "react";
import { Eyebrow } from "@/components/editorial/Eyebrow";

interface Props {
  audioUrl?: string | null;
  transcript: string;
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Replays the candidate's recorded answer with a scrubbing transcript line.
 * If no audio URL is available (audio recording disabled), falls back to a
 * static transcript with a quiet note.
 */
export function TranscriptPlayer({ audioUrl, transcript }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime);
    const onMeta = () => setDuration(a.duration);
    const onEnded = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  if (!audioUrl) {
    return (
      <div className="border-l border-rule-strong pl-6">
        <Eyebrow className="mb-3 block">Transcript</Eyebrow>
        <p className="whitespace-pre-wrap text-body text-ink-soft">{transcript}</p>
        <p className="mt-3 text-small text-ink-muted">
          Audio playback isn't available for this answer.
        </p>
      </div>
    );
  }

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play();
      setPlaying(true);
    }
  };

  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Number(e.target.value);
  };

  return (
    <div>
      <audio ref={audioRef} src={audioUrl} preload="metadata" />
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4">
        <button
          onClick={togglePlay}
          className="editorial-link font-mono text-eyebrow text-ink"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "PAUSE" : "PLAY"}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          onChange={onScrub}
          className="h-px appearance-none bg-rule-strong [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:bg-ink"
          aria-label="Scrub"
        />
        <span className="font-mono text-small tabular-nums text-ink-muted">
          {fmt(time)} / {fmt(duration)}
        </span>
      </div>
      <p className="mt-6 whitespace-pre-wrap text-body text-ink-soft">
        {transcript}
      </p>
    </div>
  );
}
