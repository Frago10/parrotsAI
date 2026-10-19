// Protocolo WebSocket entre el navegador y apps/realtime.
// Frames de texto: JSON validado con estos esquemas. Frames binarios: audio PCM16.
import { z } from 'zod';

export const SpeakerSchema = z.enum(['ME', 'THEM', 'UNKNOWN']);
export type Speaker = z.infer<typeof SpeakerSchema>;

export const AudioChannelSchema = z.enum(['me', 'them']);
export type AudioChannel = z.infer<typeof AudioChannelSchema>;

/** Byte de cabecera de cada frame binario de audio. */
export const AUDIO_CHANNEL_BYTE: Record<AudioChannel, number> = { me: 0, them: 1 };
export const AUDIO_SAMPLE_RATE = 16_000;

export const QuestionTypeSchema = z.enum([
  'behavioral',
  'technical',
  'coding',
  'objection',
  'clarification',
  'smalltalk',
  'other',
]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const AiMessageKindSchema = z.enum([
  'AUTO_ANSWER',
  'MANUAL_ANSWER',
  'SCREENSHOT',
  'CHAT_USER',
  'CHAT_AI',
]);
export type AiMessageKind = z.infer<typeof AiMessageKindSchema>;

export const LiveStateSchema = z.enum(['CONNECTING', 'LIVE', 'PAUSED', 'ENDED']);
export type LiveState = z.infer<typeof LiveStateSchema>;

// ---------- Lector de pantalla ----------
/** Lo que el lector extrae de la página que el usuario está viendo. Todo con límites de tamaño. */
export const PageContextSchema = z.object({
  url: z.string().max(2000),
  title: z.string().max(500).default(''),
  lang: z.string().max(20).optional(),
  /** Texto seleccionado por el usuario, si hay. */
  selection: z.string().max(6000).optional(),
  headings: z.array(z.string().max(300)).max(40).optional(),
  /** Texto visible en el viewport, en orden de lectura. */
  viewportText: z.string().max(12_000).default(''),
  /** Texto de toda la página (solo si el usuario lo pide). */
  fullText: z.string().max(40_000).optional(),
  /** Campos de formulario visibles: etiqueta, tipo y valor actual. */
  inputs: z
    .array(
      z.object({
        label: z.string().max(300),
        type: z.string().max(40),
        value: z.string().max(500).optional(),
        options: z.array(z.string().max(200)).max(30).optional(),
      }),
    )
    .max(60)
    .optional(),
  tables: z.array(z.string().max(3000)).max(4).optional(),
  code: z.array(z.string().max(3000)).max(6).optional(),
  images: z.array(z.string().max(300)).max(20).optional(),
  scrollPct: z.number().min(0).max(100).optional(),
  viewport: z.object({ w: z.number(), h: z.number() }).optional(),
});
export type PageContext = z.infer<typeof PageContextSchema>;

export const ScreenAnalyzeSchema = z.object({
  type: z.literal('screen.analyze'),
  /** Id generado por el cliente para correlacionar (opcional). */
  requestId: z.string().max(80).optional(),
  /** Pregunta o instrucción del usuario sobre lo que ve. Vacío = detectar la tarea en pantalla. */
  prompt: z.string().max(4000).optional(),
  /** Captura en base64 (sin prefijo data:). */
  imageBase64: z.string().max(7_000_000).optional(),
  imageMediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
  page: PageContextSchema.optional(),
  /** Origen de la lectura: botón, atajo, auto-lectura, selección o la web app. */
  trigger: z.enum(['manual', 'shortcut', 'auto', 'selection', 'web']).default('manual'),
});
export type ScreenAnalyze = z.infer<typeof ScreenAnalyzeSchema>;

// ---------- Cliente -> Servidor ----------
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.join'), sessionId: z.string().min(1) }),
  z.object({ type: z.literal('session.pause') }),
  z.object({ type: z.literal('session.resume') }),
  z.object({ type: z.literal('session.end') }),
  z.object({ type: z.literal('answer.request') }),
  z.object({ type: z.literal('answer.cancel') }),
  z.object({ type: z.literal('chat.send'), text: z.string().min(1).max(4000) }),
  z.object({ type: z.literal('panel.clear') }),
  z.object({ type: z.literal('language.set'), language: z.string().min(2).max(10) }),
  z.object({ type: z.literal('autoAnswer.set'), enabled: z.boolean() }),
  z.object({
    type: z.literal('feedback'),
    messageId: z.string(),
    value: z.enum(['up', 'down']),
    note: z.string().max(500).optional(),
  }),
  z.object({ type: z.literal('heartbeat'), clientTs: z.number() }),
  ScreenAnalyzeSchema,
  // Solo para backtesting y pruebas: inyecta texto como si viniera del STT.
  z.object({
    type: z.literal('debug.transcript'),
    channel: AudioChannelSchema,
    text: z.string(),
    isFinal: z.boolean().default(true),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------- Servidor -> Cliente ----------
export const TranscriptSegmentWireSchema = z.object({
  id: z.string(),
  speaker: SpeakerSchema,
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  confidence: z.number().min(0).max(1).optional(),
  language: z.string().optional(),
});
export type TranscriptSegmentWire = z.infer<typeof TranscriptSegmentWireSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.state'),
    state: LiveStateSchema,
    sessionId: z.string(),
    startedAt: z.string().nullable(),
    elapsedMs: z.number(),
    autoAnswer: z.boolean(),
    language: z.string(),
    model: z.string(),
    sttProvider: z.string(),
    llmProvider: z.string(),
    remainingSeconds: z.number().nullable(),
  }),
  z.object({
    type: z.literal('transcript.partial'),
    speaker: SpeakerSchema,
    text: z.string(),
    startMs: z.number(),
    endMs: z.number(),
  }),
  z.object({ type: z.literal('transcript.final'), segment: TranscriptSegmentWireSchema }),
  z.object({
    type: z.literal('question.detected'),
    question: z.string(),
    qtype: QuestionTypeSchema,
    needsAnswer: z.boolean(),
    source: z.enum(['heuristic', 'llm', 'manual']),
    score: z.number(),
  }),
  z.object({
    type: z.literal('answer.start'),
    messageId: z.string(),
    kind: AiMessageKindSchema,
    detectedQuestion: z.string().nullable(),
    createdAt: z.string(),
    model: z.string(),
  }),
  z.object({ type: z.literal('answer.delta'), messageId: z.string(), delta: z.string() }),
  z.object({
    type: z.literal('answer.done'),
    messageId: z.string(),
    content: z.string(),
    latencyMs: z.number(),
    firstTokenMs: z.number().nullable(),
    tokensIn: z.number(),
    tokensOut: z.number(),
    cacheReadTokens: z.number().optional(),
    model: z.string(),
    aborted: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('answer.error'),
    messageId: z.string().nullable(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('chat.user'),
    messageId: z.string(),
    text: z.string(),
    createdAt: z.string(),
  }),
  z.object({ type: z.literal('panel.cleared') }),
  z.object({
    type: z.literal('metrics'),
    sttPartialLatencyMs: z.number().nullable(),
    sttFinalLatencyMs: z.number().nullable(),
    lastFirstTokenMs: z.number().nullable(),
    audioFramesMe: z.number(),
    audioFramesThem: z.number(),
    serverTs: z.number(),
  }),
  z.object({ type: z.literal('heartbeat.ack'), clientTs: z.number(), serverTs: z.number() }),
  z.object({
    type: z.literal('limit.warning'),
    remainingSeconds: z.number(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string(), fatal: z.boolean() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** Serializa un mensaje del servidor validándolo antes de enviarlo. */
export function encodeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(ServerMessageSchema.parse(msg));
}

/** Parsea un frame de texto del cliente; devuelve null si no es válido. */
export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = ClientMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Parsea un frame de texto del servidor en el navegador. */
export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const parsed = ServerMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Construye un frame binario: [canal][PCM16LE...]. */
export function encodeAudioFrame(channel: AudioChannel, pcm16: Int16Array): Uint8Array {
  const out = new Uint8Array(1 + pcm16.byteLength);
  out[0] = AUDIO_CHANNEL_BYTE[channel];
  out.set(new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength), 1);
  return out;
}

/** Separa el canal y el PCM de un frame binario. */
export function decodeAudioFrame(
  frame: Uint8Array,
): { channel: AudioChannel; pcm: Uint8Array } | null {
  if (frame.byteLength < 3) return null;
  const byte = frame[0];
  const channel = byte === 0 ? 'me' : byte === 1 ? 'them' : null;
  if (!channel) return null;
  return { channel, pcm: frame.subarray(1) };
}
