import { useEffect, useRef, useState } from "react";

interface MicStreamResult {
  analyser: AnalyserNode | null;
  level: number;
}

/**
 * Captures microphone audio, downsamples to 16kHz mono PCM (Int16LE),
 * pushes binary frames to a callback, and exposes an AnalyserNode for
 * visualization. Uses ScriptProcessor for broad compatibility.
 */
export function useMicStream(
  onFrame: (frame: ArrayBuffer) => void,
  enabled: boolean,
): MicStreamResult {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext({ sampleRate: 48000 });
        ctxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        an.smoothingTimeConstant = 0.6;
        source.connect(an);
        setAnalyser(an);

        const proc = ctx.createScriptProcessor(4096, 1, 1);
        procRef.current = proc;

        const targetRate = 16000;
        const ratio = ctx.sampleRate / targetRate;

        proc.onaudioprocess = (ev) => {
          const input = ev.inputBuffer.getChannelData(0);
          const outLen = Math.floor(input.length / ratio);
          const out = new Int16Array(outLen);
          let sum = 0;
          for (let i = 0; i < outLen; i++) {
            const sample = input[Math.floor(i * ratio)];
            const clamped = Math.max(-1, Math.min(1, sample));
            out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
            sum += Math.abs(sample);
          }
          setLevel(sum / outLen);
          onFrame(out.buffer);
        };

        source.connect(proc);
        proc.connect(ctx.destination);
      } catch (e) {
        console.error("Mic capture error:", e);
      }
    })();

    return () => {
      cancelled = true;
      try {
        procRef.current?.disconnect();
        sourceRef.current?.disconnect();
        ctxRef.current?.close();
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      setAnalyser(null);
    };
  }, [enabled, onFrame]);

  return { analyser, level };
}
