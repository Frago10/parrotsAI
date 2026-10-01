'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { LANGUAGES, MODEL_CATALOG, speedLabel } from '@callpilot/shared';

export interface SessionFormValues {
  company: string;
  title: string;
  description: string;
  mode: 'INTERVIEW' | 'REGULAR' | 'MOCK';
  language: string;
  model: string;
  instructions: string;
  resumeId: string | null;
  documentIds: string[];
  autoAnswer: boolean;
  saveTranscript: boolean;
  saveForEval: boolean;
  source: 'TAB_SHARE' | 'MOCK';
}

export interface SessionFormProps {
  initial: SessionFormValues;
  resumes: Array<{ id: string; title: string }>;
  documents: Array<{ id: string; title: string }>;
  availableProviders: string[];
  locale: string;
  action: (formData: FormData) => Promise<void>;
  title: string;
}

export function SessionForm({
  initial,
  resumes,
  documents,
  availableProviders,
  locale,
  action,
  title,
}: SessionFormProps) {
  const t = useTranslations('sessionForm');
  const [mode, setMode] = useState(initial.mode === 'MOCK' ? 'REGULAR' : initial.mode);
  const [source, setSource] = useState<'TAB_SHARE' | 'MOCK'>(initial.source);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [pending, start] = useTransition();
  const loc = locale === 'en' ? 'en' : 'es';

  const grouped = MODEL_CATALOG.reduce<Record<string, typeof MODEL_CATALOG>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  return (
    <form className="mx-auto max-w-3xl space-y-5" action={(fd) => start(() => action(fd))}>
      <h1 className="text-2xl font-semibold">{title}</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">{t('company')}</label>
          <input name="company" className="input" defaultValue={initial.company} />
        </div>
        <div>
          <label className="label">{t('title')}</label>
          <input name="title" className="input" defaultValue={initial.title} />
        </div>
      </div>
      <div>
        <label className="label">{t('description')}</label>
        <input name="description" className="input" defaultValue={initial.description} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="label">{t('mode')}</label>
          <select
            name="mode"
            className="input"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'INTERVIEW' | 'REGULAR')}
          >
            <option value="REGULAR">Regular</option>
            <option value="INTERVIEW">Interview</option>
          </select>
          <div className="mt-1 text-xs text-muted">{t('modeHint')}</div>
        </div>
        <div>
          <label className="label">{t('language')}</label>
          <select name="language" className="input" defaultValue={initial.language}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName} ({l.name})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('model')}</label>
          <select name="model" className="input" defaultValue={initial.model}>
            {Object.entries(grouped).map(([provider, models]) => (
              <optgroup key={provider} label={provider}>
                {models.map((m) => {
                  const available =
                    m.requiresEnv == null || availableProviders.includes(m.provider);
                  return (
                    <option key={m.id} value={m.id}>
                      {m.label} · {speedLabel(m.speed, loc)}
                      {available ? '' : ' (sin clave: usa simulador)'}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label">{t('instructions')}</label>
        <textarea
          name="instructions"
          className="input min-h-40 font-mono text-xs"
          maxLength={50_000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={t('instructionsHint')}
        />
        <div className="mt-1 text-right text-xs text-muted">
          {t('chars', { count: instructions.length })}
        </div>
      </div>

      {mode === 'INTERVIEW' && (
        <div>
          <label className="label">{t('resume')}</label>
          <select name="resumeId" className="input" defaultValue={initial.resumeId ?? ''}>
            <option value="">{t('noResume')}</option>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="label">{t('documents')}</label>
        <div className="card max-h-40 space-y-1 overflow-y-auto p-3 text-sm">
          {documents.length === 0 && <span className="text-muted">—</span>}
          {documents.map((d) => (
            <label key={d.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="documentIds"
                value={d.id}
                defaultChecked={initial.documentIds.includes(d.id)}
              />
              {d.title}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="autoAnswer" defaultChecked={initial.autoAnswer} />{' '}
          {t('autoAnswer')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="saveTranscript" defaultChecked={initial.saveTranscript} />{' '}
          {t('saveTranscript')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="saveForEval" defaultChecked={initial.saveForEval} />{' '}
          {t('saveForEval')}
        </label>
      </div>

      <div>
        <label className="label">{t('connection')}</label>
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="source"
              value="TAB_SHARE"
              checked={source === 'TAB_SHARE'}
              onChange={() => setSource('TAB_SHARE')}
            />
            {t('real')}
          </label>
          <label className="flex items-center gap-2 text-muted">
            <input
              type="radio"
              name="source"
              value="MOCK"
              checked={source === 'MOCK'}
              onChange={() => setSource('MOCK')}
              disabled
            />
            {t('mock')}
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <a href="/sessions" className="btn">
          {t('cancel')}
        </a>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {t('save')}
        </button>
      </div>
    </form>
  );
}
