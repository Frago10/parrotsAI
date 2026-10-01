// STT simulado: no transcribe audio; acepta texto inyectado (panel de debug y backtesting).
// Cuenta los bytes de audio recibidos para poder verificar que el pipeline de captura funciona.
import type { SttProvider, SttStream, SttStreamHandlers, SttStreamOptions } from './types';

export class FakeSttProvider implements SttProvider {
  readonly id = 'fake';
  constructor(private readonly opts: { utteranceEndDelayMs?: number } = {}) {}

  async open(opts: SttStreamOptions, handlers: SttStreamHandlers): Promise<SttStream> {
    const openedAt = Date.now();
    let closed = false;
    const delay = this.opts.utteranceEndDelayMs ?? 50;
    queueMicrotask(() => handlers.onOpen?.());
    const stream: SttStream & { bytes: number } = {
      bytes: 0,
      send(pcm) {
        stream.bytes += pcm.byteLength;
      },
      async close() {
        closed = true;
        handlers.onClose?.();
      },
      inject(text, isFinal) {
        if (closed) return;
        const now = Date.now() - openedAt;
        // Duración aproximada: ~2.5 palabras por segundo.
        const words = text.trim().split(/\s+/).length;
        const startMs = Math.max(0, now - Math.round((words / 2.5) * 1000));
        if (!isFinal) {
          handlers.onPartial({ text, startMs, endMs: now });
          return;
        }
        handlers.onFinal({ text, startMs, endMs: now, confidence: 0.95, language: opts.language });
        setTimeout(() => {
          if (!closed) handlers.onUtteranceEnd();
        }, delay);
      },
    };
    return stream;
  }

  /** Para pruebas: bytes de audio que se han enviado a un stream. */
  static audioBytes(stream: SttStream): number {
    return (stream as unknown as { bytes?: number }).bytes ?? 0;
  }
}
