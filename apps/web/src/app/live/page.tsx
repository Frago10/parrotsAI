import Link from 'next/link';
import { getLocale } from 'next-intl/server';
import { currentUser, prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function LiveIndexPage() {
  const user = await currentUser();
  const locale = await getLocale();
  const es = locale !== 'en';
  const sessions = await prisma.callSession.findMany({
    where: { userId: user.id, state: { in: ['LIVE', 'READY'] } },
    orderBy: { createdAt: 'desc' },
  });
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Call Live</h1>
      <p className="mb-6 text-sm text-muted">
        {es ? 'Sesiones en vivo o listas para empezar.' : 'Sessions live or ready to start.'}
      </p>
      <div className="space-y-2">
        {sessions.map((s) => (
          <Link
            key={s.id}
            href={`/sessions/${s.id}/live`}
            className="card flex items-center justify-between p-4 hover:border-accent"
          >
            <div>
              <div className="font-medium">{s.company || '—'}</div>
              <div className="text-sm text-muted">{s.title}</div>
            </div>
            <span className="btn btn-primary">
              {s.state === 'LIVE' ? (es ? 'Unirse' : 'Join') : es ? 'Iniciar' : 'Start'}
            </span>
          </Link>
        ))}
        {sessions.length === 0 && (
          <div className="card p-6 text-center text-sm text-muted">
            {es ? 'No hay sesiones activas. ' : 'No active sessions. '}
            <Link className="underline" href="/sessions/new">
              {es ? 'Crea una.' : 'Create one.'}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
