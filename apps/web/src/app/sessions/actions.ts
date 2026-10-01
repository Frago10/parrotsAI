'use server';

// Server actions del CRUD de sesiones.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DEFAULT_MODEL_ID, LANGUAGES } from '@callpilot/shared';
import { currentUser, prisma } from '@/lib/db';

const SessionInput = z.object({
  company: z.string().trim().max(200).default(''),
  title: z.string().trim().max(200).default(''),
  description: z.string().trim().max(2000).default(''),
  mode: z.enum(['INTERVIEW', 'REGULAR', 'MOCK']).default('REGULAR'),
  language: z
    .string()
    .refine((l) => LANGUAGES.some((x) => x.code === l), 'idioma no soportado')
    .default('es'),
  model: z.string().min(1).default(DEFAULT_MODEL_ID),
  instructions: z.string().max(50_000).default(''),
  resumeId: z.string().nullable().default(null),
  documentIds: z.array(z.string()).default([]),
  autoAnswer: z.boolean().default(true),
  saveTranscript: z.boolean().default(true),
  saveForEval: z.boolean().default(false),
  source: z.enum(['TAB_SHARE', 'MOCK']).default('TAB_SHARE'),
});
export type SessionInputType = z.infer<typeof SessionInput>;

function parseForm(formData: FormData): SessionInputType {
  const get = (k: string) => (formData.get(k) as string | null) ?? undefined;
  return SessionInput.parse({
    company: get('company'),
    title: get('title'),
    description: get('description'),
    mode: get('mode'),
    language: get('language'),
    model: get('model'),
    instructions: get('instructions'),
    resumeId: get('resumeId') || null,
    documentIds: formData.getAll('documentIds').map(String),
    autoAnswer: formData.get('autoAnswer') === 'on',
    saveTranscript: formData.get('saveTranscript') === 'on',
    saveForEval: formData.get('saveForEval') === 'on',
    source: get('source'),
  });
}

export async function createSessionAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  const input = parseForm(formData);
  const mode = input.source === 'MOCK' ? 'MOCK' : input.mode;
  const session = await prisma.callSession.create({
    data: {
      userId: user.id,
      company: input.company,
      title: input.title,
      description: input.description,
      mode,
      language: input.language,
      model: input.model,
      instructions: input.instructions,
      resumeId: mode === 'INTERVIEW' ? input.resumeId : null,
      autoAnswer: input.autoAnswer,
      saveTranscript: input.saveTranscript,
      saveForEval: input.saveForEval,
      source: input.source,
      documents: { create: input.documentIds.map((documentId) => ({ documentId })) },
    },
  });
  revalidatePath('/sessions');
  redirect(`/sessions/${session.id}/live`);
}

export async function updateSessionAction(id: string, formData: FormData): Promise<void> {
  const input = parseForm(formData);
  const mode = input.source === 'MOCK' ? 'MOCK' : input.mode;
  await prisma.$transaction([
    prisma.sessionDocument.deleteMany({ where: { sessionId: id } }),
    prisma.callSession.update({
      where: { id },
      data: {
        company: input.company,
        title: input.title,
        description: input.description,
        mode,
        language: input.language,
        model: input.model,
        instructions: input.instructions,
        resumeId: mode === 'INTERVIEW' ? input.resumeId : null,
        autoAnswer: input.autoAnswer,
        saveTranscript: input.saveTranscript,
        saveForEval: input.saveForEval,
        source: input.source,
        documents: { create: input.documentIds.map((documentId) => ({ documentId })) },
      },
    }),
  ]);
  revalidatePath('/sessions');
  revalidatePath(`/sessions/${id}`);
  redirect('/sessions');
}

export async function deleteSessionAction(id: string): Promise<void> {
  await prisma.callSession.delete({ where: { id } });
  revalidatePath('/sessions');
}

export async function clearNotesAction(id: string): Promise<void> {
  await prisma.callNotes.deleteMany({ where: { sessionId: id } });
  revalidatePath(`/sessions/${id}`);
}

export async function submitFeedbackAction(
  sessionId: string | null,
  type: 'FEEDBACK' | 'BUG',
  message: string,
): Promise<void> {
  const user = await currentUser();
  if (!message.trim()) return;
  await prisma.feedback.create({
    data: { userId: user.id, sessionId, type, message: message.trim().slice(0, 4000) },
  });
}
