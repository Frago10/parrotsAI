'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { formatClock } from '@callpilot/shared';
import { clearNotesAction, submitFeedbackAction } from '@/app/sessions/actions';
import { Markdown } from '@/components/Markdown';
import { formatCredits, formatDate, formatDuration } from '@/lib/format';

interface Notes {
  callDetails: string;
  summary: string;
  questions: string[];
  nextSteps: string[];
  actionItems: Array<{ owner: string; task: string; due: string | null }>;
  decisions: string[];
  risks: string[];
  model: string;
  generatedAt: string;
}
interface Segment {
  id: string;
  speaker: 'ME' | 'THEM' | 'UNKNOWN';
  text: string;
  startMs: number;
  endMs: number;
}
interface Message {
  id: string;
  kind: string;
  question: string | null;
  content: string;
  sessionMs: number;
  feedback: string | null;
  latencyMs: number;
  firstTokenMs: number | null;
  model: string;
}
interface SessionInfo {
  id: string;
  company: string;
  title: string;
  description: string;
  mode: string;
  language: string;
  model: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  creditsUsed: number;
  usedFreeTrial: boolean;
  saveTranscript: boolean;
  resumeTitle: string | null;
  documents: string[];
  instructions: string;
}

type Tab = 'notes' | 'transcript' | 'ask' | 'details';

export function PostCallView({
  session,
  notes,
  segments,
  messages,
  locale,
}: {
  session: SessionInfo;
  notes: Notes | null;
  segments: Segment[];
  messages: Message[];
  locale: string;
}) {
  const t = useTranslations('post');
  const ts = useTranslations('sessions');
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('notes');
  const [regenerating, setRegenerating] = useState(false);
  const [query, setQuery] = useState('');
  const [askInput, setAskInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>(
    [],
  );
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? segments.filter((s) => s.text.toLowerCase().includes(q)) : segments;
  }, [query, segments]);

  async function regenerate() {
    setRegenerating(true);
    try {
      await fetch(`/api/sessions/${session.id}/notes`, { method: 'POST' });
      router.refresh();
    } finally {
      setRegenerating(false);
    }
  }

  async function ask() {
    const q = askInput.trim();
    if (!q) return;
    setAsking(true);
    setAskInput('');
    const next = [...history, { role: 'user' as const, content: q }];
    setHistory(next);
    try {
      const res = await fetch(`/api/sessions/${session.id}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, history }),
      });
      const body = (await res.json()) as { answer?: string; error?: string };
      setHistory([...next, { role: 'assistant', content: body.answer ?? body.error ?? '…' }]);
    } finally {
      setAsking(false);
    }
  }

  function feedback(type: 'FEEDBACK' | 'BUG') {
    const msg = prompt(type === 'BUG' ? t('bug') : t('feedback'));
    if (msg) start(() => submitFeedbackAction(session.id, type, msg));
  }

  const tabs: Array<[Tab, string]> = [
    ['notes', t('notes')],
    ['transcript', t('transcript')],
    ['ask', t('ask')],
    ['details', t('details')],
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link href="/sessions" className="text-xs text-muted hover:underline">
            ← {ts('title')}
          </Link>
          <h1 className="text-2xl font-semibold">{session.company || '—'}</h1>
          <div className="text-sm text-muted">
            {session.title} · {formatDuration(session.durationSeconds)} ·{' '}
            {formatCredits(session.creditsUsed, session.usedFreeTrial, ts('free'))} cr.
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button className="btn" onClick={() => feedback('FEEDBACK')} disabled={pending}>
            {t('feedback')}
          </button>
          <button className="btn" onClick={() => feedback('BUG')} disabled={pending}>
            {t('bug')}
          </button>
          <a className="btn" href={`/api/sessions/${session.id}/export?format=jsonl`}>
            {t('exportJsonl')}
          </a>
        </div>
      </div>

      <div className="mb-4 flex gap-1 rounded-md border border-border bg-panel p-1 text-sm">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={`flex-1 rounded px-3 py-1 ${tab === key ? 'bg-accent-soft font-medium' : 'hover:bg-bg'}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'notes' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button className="btn" onClick={regenerate} disabled={regenerating}>
              {regenerating ? t('generating') : t('regenerate')}
            </button>
            {notes && (
              <button
                className="btn btn-danger"
                onClick={() => start(() => clearNotesAction(session.id))}
                disabled={pending}
              >
                {t('clearNotes')}
              </button>
            )}
          </div>
          {!notes && <div className="card p-6 text-sm text-muted">{t('noNotes')}</div>}
          {notes && (
            <div className="grid gap-4 md:grid-cols-2">
              <Section title={t('callDetails')}>{notes.callDetails}</Section>
              <Section title={t('summary')}>{notes.summary}</Section>
              <ListSection title={t('questions')} items={notes.questions} />
              <ListSection title={t('nextSteps')} items={notes.nextSteps} />
              <ListSection
                title={t('actionItems')}
                items={notes.actionItems.map(
                  (a) => `${a.owner ? `${a.owner}: ` : ''}${a.task}${a.due ? ` (${a.due})` : ''}`,
                )}
              />
              <ListSection title={t('decisions')} items={notes.decisions} />
              <ListSection title={t('risks')} items={notes.risks} />
              <div className="text-xs text-muted md:col-span-2">
                {notes.model} · {formatDate(notes.generatedAt, locale)}
              </div>
            </div>
          )}
          {messages.some((m) => m.kind !== 'CHAT_USER') && (
            <div>
              <h3 className="mb-2 font-medium">{t('answersGiven')}</h3>
              <div className="space-y-2">
                {messages
                  .filter((m) => m.kind !== 'CHAT_USER')
                  .map((m) => (
                    <div key={m.id} className="card p-3 text-sm">
                      <div className="mb-1 text-xs text-muted">
                        {m.kind} · {formatClock(m.sessionMs)} · {m.model} · {m.firstTokenMs ?? '—'}/
                        {m.latencyMs} ms {m.feedback ? (m.feedback === 'up' ? '👍' : '👎') : ''}
                      </div>
                      <Markdown text={m.content} />
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'transcript' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              className="input flex-1"
              placeholder={t('searchTranscript')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <a className="btn" href={`/api/sessions/${session.id}/export?format=txt`}>
              {t('exportTxt')}
            </a>
            <a className="btn" href={`/api/sessions/${session.id}/export?format=md`}>
              {t('exportMd')}
            </a>
          </div>
          {!session.saveTranscript && segments.length === 0 && (
            <div className="card p-6 text-sm text-muted">{t('noTranscript')}</div>
          )}
          <div className="card divide-y divide-border">
            {filtered.map((s) => (
              <div key={s.id} className="flex gap-3 px-3 py-2 text-sm">
                <span className="w-14 shrink-0 font-mono text-xs text-muted">
                  {formatClock(s.startMs)}
                </span>
                <span
                  className={`w-12 shrink-0 text-xs font-medium ${s.speaker === 'ME' ? 'text-accent' : 'text-muted'}`}
                >
                  {s.speaker === 'ME' ? 'Yo' : 'Ellos'}
                </span>
                <span>{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'ask' && (
        <div className="space-y-3">
          <div className="card min-h-40 space-y-3 p-4 text-sm">
            {history.length === 0 && <div className="text-muted">{t('askPlaceholder')}</div>}
            {history.map((h, i) => (
              <div key={i} className={h.role === 'user' ? 'text-right' : ''}>
                <div
                  className={`inline-block max-w-[85%] rounded-lg px-3 py-2 ${h.role === 'user' ? 'bg-accent-soft' : 'bg-bg'}`}
                >
                  {h.role === 'user' ? h.content : <Markdown text={h.content} />}
                </div>
              </div>
            ))}
            {asking && <div className="text-muted">…</div>}
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder={t('askPlaceholder')}
              value={askInput}
              onChange={(e) => setAskInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void ask();
              }}
            />
            <button className="btn btn-primary" onClick={() => void ask()} disabled={asking}>
              →
            </button>
          </div>
        </div>
      )}

      {tab === 'details' && (
        <div className="card grid gap-3 p-4 text-sm md:grid-cols-2">
          <Detail k="Mode" v={session.mode} />
          <Detail k="Language" v={session.language} />
          <Detail k="Model" v={session.model} />
          <Detail k="Created" v={formatDate(session.createdAt, locale)} />
          <Detail k="Started" v={session.startedAt ? formatDate(session.startedAt, locale) : '—'} />
          <Detail k="Ended" v={session.endedAt ? formatDate(session.endedAt, locale) : '—'} />
          <Detail k="Resume" v={session.resumeTitle ?? '—'} />
          <Detail k="Documents" v={session.documents.join(', ') || '—'} />
          <div className="md:col-span-2">
            <div className="label">Instructions</div>
            <pre className="whitespace-pre-wrap text-xs text-muted">
              {session.instructions || '—'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 text-sm">
      <div className="mb-1 font-medium">{title}</div>
      <div>{children || <span className="text-muted">—</span>}</div>
    </div>
  );
}
function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="card p-4 text-sm">
      <div className="mb-1 font-medium">{title}</div>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-5">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      ) : (
        <span className="text-muted">—</span>
      )}
    </div>
  );
}
function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="label">{k}</div>
      <div>{v}</div>
    </div>
  );
}
