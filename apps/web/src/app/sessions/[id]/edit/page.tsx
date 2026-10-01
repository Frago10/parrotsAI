import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { updateSessionAction } from '@/app/sessions/actions';
import { SessionForm } from '@/components/sessions/SessionForm';
import { currentUser, prisma } from '@/lib/db';
import { availableLlmProviders } from '@/lib/providers';

export const dynamic = 'force-dynamic';

export default async function EditSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('sessionForm');
  const locale = await getLocale();
  const user = await currentUser();
  const [session, resumes, documents] = await Promise.all([
    prisma.callSession.findUnique({ where: { id }, include: { documents: true } }),
    prisma.resume.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true },
    }),
    prisma.document.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true },
    }),
  ]);
  if (!session) notFound();
  const action = updateSessionAction.bind(null, session.id);
  return (
    <SessionForm
      title={t('editTitle')}
      locale={locale}
      action={action}
      resumes={resumes}
      documents={documents}
      availableProviders={availableLlmProviders()}
      initial={{
        company: session.company,
        title: session.title,
        description: session.description,
        mode: session.mode,
        language: session.language,
        model: session.model,
        instructions: session.instructions,
        resumeId: session.resumeId,
        documentIds: session.documents.map((d) => d.documentId),
        autoAnswer: session.autoAnswer,
        saveTranscript: session.saveTranscript,
        saveForEval: session.saveForEval,
        source: session.source === 'MOCK' ? 'MOCK' : 'TAB_SHARE',
      }}
    />
  );
}
