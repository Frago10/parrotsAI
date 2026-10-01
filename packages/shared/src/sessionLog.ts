// Eventos del registro JSONL de cada sesión. Es la base del backtesting:
// cada llamada en vivo produce un archivo que se puede reproducir de forma determinista.
import { z } from 'zod';
import { AudioChannelSchema, QuestionTypeSchema, SpeakerSchema } from './protocol';

const base = { t: z.number().describe('ms desde el inicio de la sesión'), sessionId: z.string() };

export const SessionLogEventSchema = z.discriminatedUnion('ev', [
  z.object({
    ...base,
    ev: z.literal('session.start'),
    mode: z.string(),
    language: z.string(),
    model: z.string(),
    sttProvider: z.string(),
    llmProvider: z.string(),
    autoAnswer: z.boolean(),
  }),
  z.object({ ...base, ev: z.literal('session.end'), durationMs: z.number(), reason: z.string() }),
  z.object({
    ...base,
    ev: z.literal('transcript.partial'),
    channel: AudioChannelSchema,
    text: z.string(),
    startMs: z.number(),
    endMs: z.number(),
  }),
  z.object({
    ...base,
    ev: z.literal('transcript.final'),
    id: z.string(),
    channel: AudioChannelSchema,
    speaker: SpeakerSchema,
    text: z.string(),
    startMs: z.number(),
    endMs: z.number(),
    confidence: z.number().nullable(),
    sttLatencyMs: z.number().nullable(),
  }),
  z.object({ ...base, ev: z.literal('utterance.end'), channel: AudioChannelSchema }),
  z.object({
    ...base,
    ev: z.literal('question.heuristic'),
    text: z.string(),
    isQuestion: z.boolean(),
    needsAnswer: z.boolean(),
    qtype: QuestionTypeSchema,
    score: z.number(),
    reasons: z.array(z.string()),
  }),
  z.object({
    ...base,
    ev: z.literal('question.classified'),
    isQuestion: z.boolean(),
    needsAnswer: z.boolean(),
    qtype: QuestionTypeSchema,
    question: z.string(),
    latencyMs: z.number(),
    model: z.string(),
  }),
  z.object({
    ...base,
    ev: z.literal('answer.start'),
    messageId: z.string(),
    kind: z.string(),
    question: z.string().nullable(),
    model: z.string(),
    promptTokensEstimate: z.number().nullable(),
  }),
  z.object({ ...base, ev: z.literal('answer.first_token'), messageId: z.string(), latencyMs: z.number() }),
  z.object({
    ...base,
    ev: z.literal('answer.done'),
    messageId: z.string(),
    latencyMs: z.number(),
    tokensIn: z.number(),
    tokensOut: z.number(),
    cacheReadTokens: z.number().nullable(),
    aborted: z.boolean(),
    content: z.string(),
  }),
  z.object({ ...base, ev: z.literal('answer.error'), messageId: z.string().nullable(), message: z.string() }),
  z.object({
    ...base,
    ev: z.literal('user.action'),
    action: z.enum(['answer', 'clear', 'chat', 'screenshot', 'pause', 'resume', 'end', 'language', 'autoAnswer']),
    detail: z.string().nullable(),
  }),
  z.object({
    ...base,
    ev: z.literal('user.feedback'),
    messageId: z.string(),
    value: z.enum(['up', 'down']),
    note: z.string().nullable(),
  }),
  z.object({ ...base, ev: z.literal('notes.generated'), latencyMs: z.number(), tokensIn: z.number(), tokensOut: z.number() }),
]);
export type SessionLogEvent = z.infer<typeof SessionLogEventSchema>;

export function parseSessionLogLine(line: string): SessionLogEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const r = SessionLogEventSchema.safeParse(JSON.parse(trimmed));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
