import { useEffect, useRef, useState } from "react";

interface MicStreamResult {
  analyser: AnalyserNode | null;
  level: number;
}

/**
 * Captures microphone audio, downsamples to 16kHz mono PCM (Int16LE), pushes
 * binary frames to a callback, and exposes an AnalyserNode for visualization.
 *
 * Uses AudioWorkletNode (off-main-thread) when available; falls back to the
 * deprecated ScriptProcessorNode only if the browser refuses to load the
 * worklet (e.g. older Safari, file:// origins).
 */
export function useMicStream(
  onFrame: (frame: ArrayBuffer) => void,
  enabled: boolean,
): MicStreamResult {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
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

        // Try the modern AudioWorklet path first.
        let useWorklet = false;
        try {
          if (ctx.audioWorklet) {
            await ctx.audioWorklet.addModule("/pcm-worklet.js");
            useWorklet = true;
          }
        } catch (e) {
          console.warn(
            "AudioWorklet unavailable, falling back to ScriptProcessorNode:",
            e,
          );
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          ctx.close().catch(() => {});
          return;
        }

        if (useWorklet) {
          const node = new AudioWorkletNode(ctx, "pcm-downsampler", {
            processorOptions: { targetRate: 16000 },
          });
          workletRef.current = node;
          node.port.onmessage = (ev) => {
            const data = ev.data as { pcm: ArrayBuffer; level: number };
            if (!data || !data.pcm) return;
            setLevel(data.level);
            onFrame(data.pcm);
          };
          source.connect(node);
          // Worklet does not need to drive output, but Chrome stops the
          // graph if no node connects to destination. Use a muted gain.
          const sink = ctx.createGain();
          sink.gain.value = 0;
          node.connect(sink).connect(ctx.destination);
        } else {
          // Legacy fallback. Same downsample math as the worklet.
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
        }
      } catch (e) {
        console.error("Mic capture error:", e);
      }
    })();

    return () => {
      cancelled = true;
      try {
        workletRef.current?.port.close();
        workletRef.current?.disconnect();
        procRef.current?.disconnect();
        sourceRef.current?.disconnect();
        ctxRef.current?.close();
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      workletRef.current = null;
      procRef.current = null;
      setAnalyser(null);
    };
  }, [enabled, onFrame]);

  return { analyser, level };
}
