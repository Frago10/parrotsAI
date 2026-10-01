'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { deleteSessionAction } from '@/app/sessions/actions';
import { formatCredits, formatDate, formatDuration } from '@/lib/format';

export interface SessionRow {
  id: string;
  company: string;
  title: string;
  mode: 'INTERVIEW' | 'REGULAR' | 'MOCK';
  durationSeconds: number;
  creditsUsed: number;
  usedFreeTrial: boolean;
  createdAt: string;
  saveTranscript: boolean;
  state: 'READY' | 'LIVE' | 'ENDED';
}

function StateBadge({ state }: { state: SessionRow['state'] }) {
  const t = useTranslations('sessions');
  if (state === 'LIVE')
    return (
      <span className="badge bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
        <span className="pulse-dot h-2 w-2 rounded-full bg-success" /> {t('state.LIVE')}
      </span>
    );
  if (state === 'READY')
    return (
      <span className="badge bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
        {t('state.READY')}
      </span>
    );
  return (
    <span className="badge bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {t('state.ENDED')}
    </span>
  );
}

function ActionLink({ row }: { row: SessionRow }) {
  const t = useTranslations('sessions');
  if (row.state === 'ENDED')
    return (
      <Link href={`/sessions/${row.id}`} className="btn">
        {t('action.view')}
      </Link>
    );
  return (
    <Link href={`/sessions/${row.id}/live`} className="btn btn-primary">
      {row.state === 'LIVE' ? t('action.join') : t('action.start')}
    </Link>
  );
}

export function SessionsTable({ rows, locale }: { rows: SessionRow[]; locale: string }) {
  const t = useTranslations('sessions');
  const [pending, start] = useTransition();

  function remove(id: string) {
    if (!confirm(t('confirmDelete'))) return;
    start(() => deleteSessionAction(id));
  }

  if (!rows.length)
    return <div className="card p-8 text-center text-sm text-muted">{t('empty')}</div>;

  return (
    <>
      {/* Escritorio: tabla */}
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr className="border-b border-border">
              <th className="px-4 py-3">{t('col.session')}</th>
              <th className="px-4 py-3">{t('col.mode')}</th>
              <th className="px-4 py-3">{t('col.duration')}</th>
              <th className="px-4 py-3">{t('col.credits')}</th>
              <th className="px-4 py-3">{t('col.created')}</th>
              <th className="px-4 py-3">{t('col.saveTranscript')}</th>
              <th className="px-4 py-3">{t('col.state')}</th>
              <th className="px-4 py-3">{t('col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg/60">
                <td className="px-4 py-3">
                  <div className="font-semibold">{r.company || '—'}</div>
                  <div className="text-muted">{r.title}</div>
                </td>
                <td className="px-4 py-3">{t(`mode.${r.mode}`)}</td>
                <td className="px-4 py-3">{formatDuration(r.durationSeconds)}</td>
                <td className="px-4 py-3">
                  {formatCredits(r.creditsUsed, r.usedFreeTrial, t('free'))}
                </td>
                <td className="px-4 py-3 text-muted">{formatDate(r.createdAt, locale)}</td>
                <td className="px-4 py-3">{r.saveTranscript ? t('yes') : t('no')}</td>
                <td className="px-4 py-3">
                  <StateBadge state={r.state} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ActionLink row={r} />
                    <Link
                      href={`/sessions/${r.id}/edit`}
                      className="text-xs text-muted hover:underline"
                    >
                      {t('edit')}
                    </Link>
                    <button
                      className="text-xs text-danger hover:underline"
                      disabled={pending}
                      onClick={() => remove(r.id)}
                    >
                      {t('delete')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Móvil: tarjetas */}
      <div className="space-y-3 md:hidden">
        {rows.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{r.company || '—'}</div>
                <div className="text-sm text-muted">{r.title}</div>
              </div>
              <StateBadge state={r.state} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted">
              <span>{t(`mode.${r.mode}`)}</span>
              <span>{formatDuration(r.durationSeconds)}</span>
              <span>{formatCredits(r.creditsUsed, r.usedFreeTrial, t('free'))}</span>
              <span>{formatDate(r.createdAt, locale)}</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <ActionLink row={r} />
              <Link href={`/sessions/${r.id}/edit`} className="text-xs text-muted">
                {t('edit')}
              </Link>
              <button className="text-xs text-danger" onClick={() => remove(r.id)}>
                {t('delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
