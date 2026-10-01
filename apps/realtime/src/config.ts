// Configuración del servidor realtime a partir de variables de entorno (.env en la raíz).
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { sessionLogDir } from '@callpilot/shared/node';

loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), '.env'), quiet: true });

export type SttProviderId = 'deepgram' | 'assemblyai' | 'fake';

export interface RealtimeConfig {
  port: number;
  host: string;
  sttProvider: SttProviderId;
  deepgramApiKey: string | undefined;
  sessionLogDir: string;
  /** Debounce tras fin de turno antes de clasificar/responder. */
  answerDebounceMs: number;
  /** Si no llega utterance.end, se responde igualmente pasado este tiempo. */
  utteranceEndFallbackMs: number;
  /** Ventana de transcripción reciente que se envía al LLM. */
  transcriptWindowMs: number;
  /** Sin heartbeat durante este tiempo se pausa el cobro. */
  heartbeatTimeoutMs: number;
  /** Usa el clasificador LLM además de la heurística. */
  llmClassifier: boolean;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RealtimeConfig {
  const stt = (env.STT_PROVIDER ?? 'fake') as SttProviderId;
  const sttProvider: SttProviderId =
    stt === 'deepgram' && !env.DEEPGRAM_API_KEY ? 'fake' : stt === 'assemblyai' ? 'fake' : stt;
  return {
    port: Number(env.REALTIME_PORT ?? 4001),
    host: env.REALTIME_HOST ?? '0.0.0.0',
    sttProvider,
    deepgramApiKey: env.DEEPGRAM_API_KEY,
    sessionLogDir: sessionLogDir(env),
    answerDebounceMs: Number(env.ANSWER_DEBOUNCE_MS ?? 600),
    utteranceEndFallbackMs: Number(env.UTTERANCE_END_FALLBACK_MS ?? 1500),
    transcriptWindowMs: Number(env.TRANSCRIPT_WINDOW_MS ?? 3 * 60_000),
    heartbeatTimeoutMs: Number(env.HEARTBEAT_TIMEOUT_MS ?? 60_000),
    llmClassifier: (env.LLM_CLASSIFIER ?? 'true') !== 'false',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
