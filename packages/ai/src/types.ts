// Interfaz común de proveedores LLM. Todo el servidor habla con esta interfaz,
// nunca con un SDK concreto, para poder cambiar de proveedor y para backtesting.
import type { LlmProviderId } from '@callpilot/shared';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type LlmPurpose = 'answer' | 'chat' | 'classify' | 'notes' | 'notes_chunk' | 'ask';

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  temperature?: number;
  /** Pista para el simulador y para métricas; no cambia el prompt. */
  purpose: LlmPurpose;
  /** Se espera JSON puro como salida. */
  json?: boolean;
  /** Nivel de esfuerzo para modelos que lo soportan (Claude 5.x). */
  effort?: 'low' | 'medium' | 'high';
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type LlmStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; usage: LlmUsage; stopReason: string | null; model: string };

export interface LlmCompletion {
  text: string;
  usage: LlmUsage;
  stopReason: string | null;
  model: string;
}

export interface LlmCallOptions {
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  stream(req: LlmRequest, opts?: LlmCallOptions): AsyncIterable<LlmStreamEvent>;
  complete(req: LlmRequest, opts?: LlmCallOptions): Promise<LlmCompletion>;
}

export const EMPTY_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Implementa complete() a partir de stream() para proveedores que solo definen stream. */
export async function collectStream(
  iterable: AsyncIterable<LlmStreamEvent>,
  fallbackModel: string,
): Promise<LlmCompletion> {
  let text = '';
  let usage: LlmUsage = { ...EMPTY_USAGE };
  let stopReason: string | null = null;
  let model = fallbackModel;
  for await (const ev of iterable) {
    if (ev.type === 'delta') text += ev.text;
    else {
      usage = ev.usage;
      stopReason = ev.stopReason;
      model = ev.model;
    }
  }
  return { text, usage, stopReason, model };
}

/** Extrae el primer objeto JSON de una respuesta (tolera fences ```json). */
export function extractJson<T = unknown>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** Estimación rápida de tokens (≈ 4 caracteres por token) para logs y presupuesto. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
