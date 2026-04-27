import { useEffect, useRef } from "react";

interface Props {
  /** AnalyserNode emits frequency / time-domain data. Must already be connected to mic source. */
  analyser: AnalyserNode | null;
  active: boolean;
  className?: string;
  /** Approx seconds of history scrolled across the canvas width. */
  windowSeconds?: number;
}

/**
 * Horizontal scrolling waveform — captures the last ~8 seconds of mic audio.
 * Renders peak amplitude per slice; new samples enter from the right and
 * scroll left over time. Color: ink when speaking, ink-muted during silence.
 */
export function Waveform({ analyser, active, className, windowSeconds = 8 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peaksRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;

    const sizeCanvas = () => {
      const { clientWidth, clientHeight } = canvas;
      canvas.width = clientWidth * dpr;
      canvas.height = clientHeight * dpr;
    };
    sizeCanvas();

    const fps = 30;
    const totalSlices = fps * windowSeconds;
    if (peaksRef.current.length === 0) {
      peaksRef.current = new Array(totalSlices).fill(0);
    }

    const css = getComputedStyle(document.documentElement);
    const inkColor = css.getPropertyValue("--ink").trim() || "#1A1814";
    const mutedColor = css.getPropertyValue("--ink-muted").trim() || "#8A8478";

    const buf = new Uint8Array(analyser?.fftSize ?? 2048);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);

      let peak = 0;
      if (analyser && active) {
        analyser.getByteTimeDomainData(buf);
        let max = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i] - 128) / 128;
          if (v > max) max = v;
        }
        peak = max;
      }

      peaksRef.current.push(peak);
      if (peaksRef.current.length > totalSlices) peaksRef.current.shift();

      const w = canvas.width;
      const h = canvas.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      const sliceWidth = w / totalSlices;
      ctx.lineWidth = Math.max(1, dpr);
      ctx.lineCap = "round";

      const speaking = peak > 0.04 && active;
      ctx.strokeStyle = speaking ? inkColor : mutedColor;

      ctx.beginPath();
      const mid = h / 2;
      for (let i = 0; i < peaksRef.current.length; i++) {
        const x = i * sliceWidth + sliceWidth / 2;
        const amp = peaksRef.current[i] * (h * 0.45);
        ctx.moveTo(x, mid - amp);
        ctx.lineTo(x, mid + amp);
      }
      ctx.stroke();
    };

    draw();
    const onResize = () => sizeCanvas();
    window.addEventListener("resize", onResize);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, [analyser, active, windowSeconds]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
      aria-hidden="true"
    />
  );
}
