// Generación de notas post-llamada. Transcripciones largas: map-reduce por bloques de 10 min.
import { buildNotesUserPrompt, NOTES_CHUNK_SYSTEM_PROMPT, NOTES_SYSTEM_PROMPT } from '@callpilot/shared';
import { extractJson, type LlmProvider, type LlmUsage } from '@callpilot/ai';
import { z } from 'zod';
import { TranscriptWindow, type WindowSegment } from './transcriptWindow';

export const CallNotesSchema = z.object({
  callDetails: z.string().default(''),
  summary: z.string().default(''),
  questions: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
  actionItems: z
    .array(z.object({ owner: z.string().default(''), task: z.string(), due: z.string().nullable().default(null) }))
    .default([]),
  decisions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});
export type CallNotesJson = z.infer<typeof CallNotesSchema>;

export interface GenerateNotesInput {
  segments: WindowSegment[];
  company: string | null;
  title: string | null;
  mode: 'INTERVIEW' | 'REGULAR' | 'MOCK';
  durationSeconds: number;
}

const CHUNK_MS = 10 * 60_000;
const MAX_DIRECT_CHARS = 60_000;

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export async function generateNotes(
  llm: LlmProvider,
  model: string,
  input: GenerateNotesInput,
): Promise<{ notes: CallNotesJson; usage: LlmUsage; model: string }> {
  let usage: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let transcript = TranscriptWindow.format(input.segments);
  if (transcript.length > MAX_DIRECT_CHARS) {
    // Map: resumen por bloque de 10 minutos. Reduce: notas finales a partir de los resúmenes.
    const blocks: WindowSegment[][] = [];
    for (const seg of input.segments) {
      const idx = Math.floor(seg.startMs / CHUNK_MS);
      (blocks[idx] ??= []).push(seg);
    }
    const summaries: string[] = [];
    for (const [i, block] of blocks.entries()) {
      if (!block?.length) continue;
      const res = await llm.complete({
        model,
        system: NOTES_CHUNK_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Block ${i + 1} (minutes ${i * 10}-${i * 10 + 10}):\n${TranscriptWindow.format(block)}` }],
        maxTokens: 600,
        purpose: 'notes_chunk',
      });
      usage = addUsage(usage, res.usage);
      summaries.push(`[Block ${i + 1}]\n${res.text.trim()}`);
    }
    transcript = summaries.join('\n\n');
  }
  const res = await llm.complete({
    model,
    system: NOTES_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildNotesUserPrompt({
          company: input.company,
          title: input.title,
          mode: input.mode,
          durationMinutes: Math.round(input.durationSeconds / 60),
          transcript: transcript || '(empty transcript)',
        }),
      },
    ],
    maxTokens: 2000,
    purpose: 'notes',
    json: true,
  });
  usage = addUsage(usage, res.usage);
  const parsed = CallNotesSchema.safeParse(extractJson(res.text) ?? {});
  const notes = parsed.success ? parsed.data : CallNotesSchema.parse({ summary: res.text.slice(0, 2000) });
  return { notes, usage, model: res.model };
}
