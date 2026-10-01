// STT Deepgram Nova-3 en streaming (SDK v5). Una conexión por canal.
import { DeepgramClient } from '@deepgram/sdk';
import type { SttProvider, SttStream, SttStreamHandlers, SttStreamOptions } from './types';

const KEEPALIVE_MS = 8_000;

export class DeepgramSttProvider implements SttProvider {
  readonly id = 'deepgram';
  private readonly client: DeepgramClient;

  constructor(apiKey: string) {
    this.client = new DeepgramClient({ apiKey });
  }

  async open(opts: SttStreamOptions, handlers: SttStreamHandlers): Promise<SttStream> {
    const language = opts.language === 'multi' ? 'multi' : opts.language;
    const connection = await this.client.listen.v1.connect({
      model: 'nova-3',
      language,
      encoding: 'linear16',
      sample_rate: String(opts.sampleRate),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: '300',
      utterance_end_ms: '1000',
      vad_events: 'true',
      keyterm: opts.keyterms.length ? opts.keyterms.slice(0, 50) : undefined,
    });

    let lastAudioAt = Date.now();
    let closed = false;
    const keepalive = setInterval(() => {
      if (closed) return;
      if (Date.now() - lastAudioAt > KEEPALIVE_MS - 1000) {
        try {
          connection.sendKeepAlive({ type: 'KeepAlive' });
        } catch {
          /* la conexión puede estar cerrándose */
        }
      }
    }, KEEPALIVE_MS);

    connection.on('open', () => handlers.onOpen?.());
    connection.on('message', (msg) => {
      if (msg.type === 'Results') {
        const alt = msg.channel?.alternatives?.[0];
        const text = alt?.transcript?.trim() ?? '';
        if (!text) return;
        const startMs = Math.round(msg.start * 1000);
        const endMs = Math.round((msg.start + msg.duration) * 1000);
        if (msg.is_final) {
          handlers.onFinal({
            text,
            startMs,
            endMs,
            confidence: typeof alt?.confidence === 'number' ? alt.confidence : null,
            language: alt?.languages?.[0] ?? null,
          });
          // speech_final = Deepgram detectó silencio tras la frase: equivale a fin de turno.
          if (msg.speech_final) handlers.onUtteranceEnd();
        } else {
          handlers.onPartial({ text, startMs, endMs });
        }
      } else if (msg.type === 'UtteranceEnd') {
        handlers.onUtteranceEnd();
      }
    });
    connection.on('error', (err) => handlers.onError(err instanceof Error ? err : new Error(String(err))));
    connection.on('close', () => {
      closed = true;
      clearInterval(keepalive);
      handlers.onClose?.();
    });

    connection.connect();
    await connection.waitForOpen();

    return {
      send(pcm) {
        if (closed) return;
        lastAudioAt = Date.now();
        connection.sendMedia(pcm);
      },
      async close() {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        try {
          connection.sendCloseStream({ type: 'CloseStream' });
        } catch {
          /* ignorar */
        }
        connection.close();
      },
    };
  }
}
