import { notFound, redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { LiveScreen } from '@/components/live/LiveScreen';
import { prisma } from '@/lib/db';
import { realtimeWsUrl } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await prisma.callSession.findUnique({ where: { id } });
  if (!session) notFound();
  if (session.state === 'ENDED') redirect(`/sessions/${id}`);
  const locale = await getLocale();
  return (
    <LiveScreen
      wsUrl={realtimeWsUrl()}
      locale={locale}
      session={{
        id: session.id,
        company: session.company,
        title: session.title,
        mode: session.mode,
        language: session.language,
        autoAnswer: session.autoAnswer,
        state: session.state,
      }}
    />
  );
}
