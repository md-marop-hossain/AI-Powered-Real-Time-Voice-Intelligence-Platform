/**
 * PCM extraction worklet — runs on the audio thread, not the main thread.
 *
 * Receives Float32 mic frames at the AudioContext's native rate (typically
 * 48kHz on desktop), downsamples to 16kHz mono Int16LE, and posts the
 * resulting ArrayBuffer to the main thread along with the average absolute
 * sample level (for visualization).
 *
 * Replaces the deprecated ScriptProcessorNode pipeline. Same wire format
 * downstream — the WebSocket still receives 16kHz PCM Int16LE chunks.
 */

class PCMDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const targetRate = (options && options.processorOptions && options.processorOptions.targetRate) || 16000;
    this._targetRate = targetRate;
    this._ratio = sampleRate / targetRate;
    // Accumulator across `process()` calls so we can emit fixed-size frames
    // (~256 samples / 16ms) instead of one per render quantum (128 samples).
    this._accum = [];
    this._frameSize = 256;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;
    // Append all mono samples to the accumulator.
    for (let i = 0; i < channel.length; i++) {
      this._accum.push(channel[i]);
    }
    // Emit fixed-size 16kHz frames whenever we've buffered enough.
    while (this._accum.length / this._ratio >= this._frameSize) {
      const out = new Int16Array(this._frameSize);
      let sum = 0;
      for (let i = 0; i < this._frameSize; i++) {
        const sample = this._accum[Math.floor(i * this._ratio)];
        const clamped = Math.max(-1, Math.min(1, sample));
        out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        sum += Math.abs(sample);
      }
      // Drop the consumed samples from the head of the accumulator.
      this._accum.splice(0, Math.floor(this._frameSize * this._ratio));
      this.port.postMessage(
        { pcm: out.buffer, level: sum / this._frameSize },
        [out.buffer],
      );
    }
    return true;
  }
}

registerProcessor("pcm-downsampler", PCMDownsampler);
