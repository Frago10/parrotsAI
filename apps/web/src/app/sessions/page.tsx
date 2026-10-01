import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { Prisma } from '@callpilot/db';
import { currentUser, prisma } from '@/lib/db';
import { SessionsTable, type SessionRow } from '@/components/sessions/SessionsTable';
import { SearchBox } from '@/components/sessions/SearchBox';

export const dynamic = 'force-dynamic';

type Tab = 'all' | 'active' | 'ended';

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  const t = await getTranslations('sessions');
  const locale = await getLocale();
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'active' || sp.tab === 'ended' ? sp.tab : 'all';
  const q = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const pageSize = 20;
  const user = await currentUser();

  const where: Prisma.CallSessionWhereInput = {
    userId: user.id,
    ...(tab === 'active'
      ? { state: { in: ['READY', 'LIVE'] } }
      : tab === 'ended'
        ? { state: 'ENDED' }
        : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' as const } },
            { description: { contains: q, mode: 'insensitive' as const } },
            { company: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [total, sessions, counts] = await Promise.all([
    prisma.callSession.count({ where }),
    prisma.callSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.callSession.groupBy({
      by: ['state'],
      where: { userId: user.id },
      _count: { _all: true },
    }),
  ]);
  const countOf = (states: string[]) =>
    counts.filter((c) => states.includes(c.state)).reduce((n, c) => n + c._count._all, 0);
  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'all', label: t('all'), count: countOf(['READY', 'LIVE', 'ENDED']) },
    { key: 'active', label: t('active'), count: countOf(['READY', 'LIVE']) },
    { key: 'ended', label: t('ended'), count: countOf(['ENDED']) },
  ];
  const rows: SessionRow[] = sessions.map((s) => ({
    id: s.id,
    company: s.company,
    title: s.title,
    mode: s.mode,
    durationSeconds: s.durationSeconds,
    creditsUsed: Number(s.creditsUsed),
    usedFreeTrial: s.usedFreeTrial,
    createdAt: s.createdAt.toISOString(),
    saveTranscript: s.saveTranscript,
    state: s.state,
  }));
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted">{t('subtitle')}</p>
        </div>
        <Link href="/sessions/new" className="btn btn-primary">
          + {t('create')}
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-md border border-border bg-panel p-1">
          {tabs.map((tb) => (
            <Link
              key={tb.key}
              href={`/sessions?tab=${tb.key}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              className={`rounded px-3 py-1 text-sm ${tab === tb.key ? 'bg-accent-soft font-medium' : 'hover:bg-bg'}`}
            >
              {tb.label} <span className="text-muted">({tb.count})</span>
            </Link>
          ))}
        </div>
        <span className="text-sm text-muted">{t('count', { count: total })}</span>
        <div className="ml-auto w-full md:w-72">
          <SearchBox initial={q} placeholder={t('search')} />
        </div>
      </div>
      <SessionsTable rows={rows} locale={locale} />
      {pages > 1 && (
        <div className="mt-4 flex justify-center gap-2 text-sm">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/sessions?tab=${tab}&page=${p}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              className={`btn ${p === page ? 'border-accent' : ''}`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
