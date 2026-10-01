import { notFound, redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { PostCallView } from '@/components/post/PostCallView';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await prisma.callSession.findUnique({
    where: { id },
    include: {
      notes: true,
      segments: { orderBy: { startMs: 'asc' } },
      messages: { orderBy: { createdAt: 'asc' } },
      resume: { select: { title: true } },
      documents: { include: { document: { select: { title: true } } } },
    },
  });
  if (!session) notFound();
  if (session.state !== 'ENDED') redirect(`/sessions/${id}/live`);
  const locale = await getLocale();
  const notes = session.notes
    ? {
        callDetails: session.notes.callDetails,
        summary: session.notes.summary,
        questions: session.notes.questions as string[],
        nextSteps: session.notes.nextSteps as string[],
        actionItems: session.notes.actionItems as Array<{
          owner: string;
          task: string;
          due: string | null;
        }>,
        decisions: session.notes.decisions as string[],
        risks: session.notes.risks as string[],
        model: session.notes.model,
        generatedAt: session.notes.generatedAt.toISOString(),
      }
    : null;
  return (
    <PostCallView
      locale={locale}
      session={{
        id: session.id,
        company: session.company,
        title: session.title,
        description: session.description,
        mode: session.mode,
        language: session.language,
        model: session.model,
        createdAt: session.createdAt.toISOString(),
        startedAt: session.startedAt?.toISOString() ?? null,
        endedAt: session.endedAt?.toISOString() ?? null,
        durationSeconds: session.durationSeconds,
        creditsUsed: Number(session.creditsUsed),
        usedFreeTrial: session.usedFreeTrial,
        saveTranscript: session.saveTranscript,
        resumeTitle: session.resume?.title ?? null,
        documents: session.documents.map((d) => d.document.title),
        instructions: session.instructions,
      }}
      notes={notes}
      segments={session.segments.map((s) => ({
        id: s.id,
        speaker: s.speaker,
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
      }))}
      messages={session.messages.map((m) => ({
        id: m.id,
        kind: m.kind,
        question: m.detectedQuestion,
        content: m.content,
        sessionMs: m.sessionMs,
        feedback: m.feedback,
        latencyMs: m.latencyMs,
        firstTokenMs: m.firstTokenMs,
        model: m.model,
      }))}
    />
  );
}
