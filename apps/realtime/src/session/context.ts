// Carga el contexto de una sesión desde la base de datos y lo convierte en SessionContext para los prompts.
import type { PrismaClient } from '@callpilot/db';
import type { SessionContext } from '@callpilot/shared';

export interface LoadedSession {
  id: string;
  userId: string;
  company: string;
  title: string;
  mode: 'INTERVIEW' | 'REGULAR' | 'MOCK';
  language: string;
  model: string;
  autoAnswer: boolean;
  saveTranscript: boolean;
  saveForEval: boolean;
  state: 'READY' | 'LIVE' | 'ENDED';
  startedAt: Date | null;
  durationSeconds: number;
  context: SessionContext;
  keyterms: string[];
  /** Segundos disponibles antes de agotar créditos/trial; null = ilimitado. */
  remainingSeconds: number | null;
}

export async function loadSession(prisma: PrismaClient, sessionId: string): Promise<LoadedSession | null> {
  const s = await prisma.callSession.findUnique({
    where: { id: sessionId },
    include: {
      resume: true,
      documents: { include: { document: true } },
      user: true,
    },
  });
  if (!s) return null;
  const resumeText = s.mode === 'INTERVIEW' ? (s.resume?.parsedText ?? null) : (s.resume?.parsedText ?? null);
  // Sin RAG todavía (fase 7): se inyecta el texto completo de documentos cortos (hasta ~6k caracteres).
  const documentSnippets: string[] = [];
  let budget = 6000;
  for (const sd of s.documents) {
    const text = sd.document.text?.trim();
    if (!text) continue;
    const slice = text.slice(0, Math.max(0, budget));
    if (!slice) break;
    documentSnippets.push(`${sd.document.title}: ${slice}`);
    budget -= slice.length;
  }
  const keyterms = [s.company, s.title]
    .flatMap((t) => t.split(/[\s,/|-]+/))
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 20);

  const unlimited = s.user.plan !== 'FREE';
  const creditsSeconds = Number(s.user.creditsBalance) * 3600;
  const trialLeft = Math.max(0, 600 - s.user.freeTrialUsedSeconds);
  const remainingSeconds = unlimited ? null : Math.max(0, Math.floor(creditsSeconds + trialLeft - s.durationSeconds));

  return {
    id: s.id,
    userId: s.userId,
    company: s.company,
    title: s.title,
    mode: s.mode,
    language: s.language,
    model: s.model,
    autoAnswer: s.autoAnswer,
    saveTranscript: s.saveTranscript,
    saveForEval: s.saveForEval,
    state: s.state,
    startedAt: s.startedAt,
    durationSeconds: s.durationSeconds,
    keyterms,
    remainingSeconds,
    context: {
      mode: s.mode,
      language: s.language,
      company: s.company || null,
      title: s.title || null,
      description: s.description || null,
      instructions: s.instructions || null,
      resumeText,
      documentSnippets,
    },
  };
}
