import { useRef, useState } from "react";

/**
 * Buffers MP3 chunks streamed from the server, decodes them when
 * `flush()` is called, and plays them through a single AudioContext.
 * Exposes a live amplitude (0..1) so the UI can pulse with TTS audio.
 */
export function useAudioPlayer() {
  const ctxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const [amplitude, setAmplitude] = useState(0);

  const ensureCtx = () => {
    if (!ctxRef.current) {
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      analyserRef.current = an;
      an.connect(ctx.destination);
    }
    return ctxRef.current!;
  };

  const sampleAmplitude = () => {
    if (!playingRef.current || !analyserRef.current) {
      setAmplitude(0);
      rafRef.current = null;
      return;
    }
    const buf = new Uint8Array(analyserRef.current.fftSize);
    analyserRef.current.getByteTimeDomainData(buf);
    let max = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i] - 128) / 128;
      if (v > max) max = v;
    }
    setAmplitude(max);
    rafRef.current = requestAnimationFrame(sampleAmplitude);
  };

  const append = (chunk: ArrayBuffer) => {
    chunksRef.current.push(chunk);
  };

  const flush = async () => {
    const ctx = ensureCtx();
    if (chunksRef.current.length === 0) return;
    const total = chunksRef.current.reduce((acc, c) => acc + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunksRef.current) {
      merged.set(new Uint8Array(c), offset);
      offset += c.byteLength;
    }
    chunksRef.current = [];

    try {
      const buf = await ctx.decodeAudioData(merged.buffer.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(analyserRef.current!);
      playingRef.current = true;
      src.onended = () => {
        playingRef.current = false;
        setAmplitude(0);
      };
      src.start();
      if (!rafRef.current) sampleAmplitude();
    } catch (e) {
      console.warn("Audio decode failed:", e);
    }
  };

  return {
    append,
    flush,
    amplitude,
    isPlaying: () => playingRef.current,
  };
}
