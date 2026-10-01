'use client';

import { useTransition } from 'react';

export interface LibraryItem {
  id: string;
  title: string;
  meta: string;
  isDefault?: boolean;
  preview: string;
}

export function LibraryPage({
  title,
  subtitle,
  items,
  createAction,
  deleteAction,
  setDefaultAction,
  labels,
}: {
  title: string;
  subtitle: string;
  items: LibraryItem[];
  createAction: (fd: FormData) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
  setDefaultAction?: (id: string) => Promise<void>;
  labels: {
    add: string;
    name: string;
    file: string;
    text: string;
    isDefault?: string;
    delete: string;
    setDefault?: string;
    empty: string;
  };
}) {
  const [pending, start] = useTransition();
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mb-6 text-sm text-muted">{subtitle}</p>
      <div className="grid gap-6 md:grid-cols-[2fr_3fr]">
        <form className="card space-y-3 p-4" action={(fd) => start(() => createAction(fd))}>
          <div className="font-medium">{labels.add}</div>
          <div>
            <label className="label">{labels.name}</label>
            <input name="title" className="input" />
          </div>
          <div>
            <label className="label">{labels.file}</label>
            <input
              name="file"
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              className="input"
            />
          </div>
          <div>
            <label className="label">{labels.text}</label>
            <textarea name="text" className="input min-h-32 text-xs" />
          </div>
          {labels.isDefault && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isDefault" /> {labels.isDefault}
            </label>
          )}
          <button className="btn btn-primary" disabled={pending}>
            {labels.add}
          </button>
        </form>
        <div className="space-y-3">
          {items.length === 0 && (
            <div className="card p-6 text-center text-sm text-muted">{labels.empty}</div>
          )}
          {items.map((it) => (
            <div key={it.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {it.title}{' '}
                    {it.isDefault && <span className="badge bg-accent-soft">default</span>}
                  </div>
                  <div className="text-xs text-muted">{it.meta}</div>
                </div>
                <div className="flex gap-2 text-xs">
                  {setDefaultAction && labels.setDefault && !it.isDefault && (
                    <button
                      className="hover:underline"
                      onClick={() => start(() => setDefaultAction(it.id))}
                    >
                      {labels.setDefault}
                    </button>
                  )}
                  <button
                    className="text-danger hover:underline"
                    onClick={() => start(() => deleteAction(it.id))}
                  >
                    {labels.delete}
                  </button>
                </div>
              </div>
              <pre className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap text-xs text-muted">
                {it.preview}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
