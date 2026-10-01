import { getLocale, getTranslations } from 'next-intl/server';
import { DEFAULT_MODEL_ID } from '@callpilot/shared';
import { createSessionAction } from '@/app/sessions/actions';
import { SessionForm } from '@/components/sessions/SessionForm';
import { currentUser, prisma } from '@/lib/db';
import { availableLlmProviders } from '@/lib/providers';

export const dynamic = 'force-dynamic';

export default async function NewSessionPage() {
  const t = await getTranslations('sessionForm');
  const locale = await getLocale();
  const user = await currentUser();
  const [resumes, documents] = await Promise.all([
    prisma.resume.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, isDefault: true },
    }),
    prisma.document.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true },
    }),
  ]);
  return (
    <SessionForm
      title={t('createTitle')}
      locale={locale}
      action={createSessionAction}
      resumes={resumes}
      documents={documents}
      availableProviders={availableLlmProviders()}
      initial={{
        company: '',
        title: '',
        description: '',
        mode: 'REGULAR',
        language: user.locale === 'en' ? 'en' : 'es',
        model: DEFAULT_MODEL_ID,
        instructions: '',
        resumeId: resumes.find((r) => r.isDefault)?.id ?? null,
        documentIds: [],
        autoAnswer: true,
        saveTranscript: true,
        saveForEval: false,
        source: 'TAB_SHARE',
      }}
    />
  );
}
