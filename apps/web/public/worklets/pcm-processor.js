// AudioWorklet: acumula audio mono y lo envía en bloques PCM16 de ~40 ms (640 muestras a 16 kHz).
// El AudioContext se crea a 16 kHz, así que Chrome remuestrea antes de llegar aquí.
class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSize = (options.processorOptions && options.processorOptions.chunkSize) || 640;
    this.buffer = new Int16Array(this.chunkSize);
    this.offset = 0;
    this.levelAcc = 0;
    this.levelCount = 0;
    this.lastLevelPost = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channels = input.length;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      // Mezcla a mono promediando canales.
      let sample = 0;
      for (let c = 0; c < channels; c++) sample += input[c][i];
      sample /= channels;
      this.levelAcc += sample * sample;
      this.levelCount++;
      const s = Math.max(-1, Math.min(1, sample));
      this.buffer[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.offset >= this.chunkSize) {
        this.port.postMessage({ type: 'chunk', pcm: this.buffer.buffer.slice(0) }, []);
        this.offset = 0;
      }
    }
    // Nivel RMS cada ~100 ms para el VU-meter.
    if (currentTime - this.lastLevelPost > 0.1 && this.levelCount > 0) {
      const rms = Math.sqrt(this.levelAcc / this.levelCount);
      this.port.postMessage({ type: 'level', level: rms });
      this.levelAcc = 0;
      this.levelCount = 0;
      this.lastLevelPost = currentTime;
    }
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
