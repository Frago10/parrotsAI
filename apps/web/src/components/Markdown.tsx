'use client';

// Renderizador markdown mínimo (negritas, viñetas, bloques de código, saltos) sin dependencias.
import { useMemo } from 'react';

function inline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else parts.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks = useMemo(() => {
    const out: React.ReactNode[] = [];
    const lines = text.split('\n');
    let i = 0;
    let k = 0;
    while (i < lines.length) {
      const line = lines[i]!;
      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3).trim();
        const code: string[] = [];
        i++;
        while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
          code.push(lines[i]!);
          i++;
        }
        i++;
        const codeText = code.join('\n');
        out.push(
          <div key={k++} className="relative">
            <pre data-lang={lang}>
              <code>{codeText}</code>
            </pre>
            <button
              type="button"
              className="absolute right-2 top-2 rounded border border-border bg-panel px-1.5 text-[10px] text-muted hover:text-text"
              onClick={() => void navigator.clipboard?.writeText(codeText)}
            >
              copy
            </button>
          </div>,
        );
        continue;
      }
      if (/^\s*[•\-*]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[•\-*]\s+/.test(lines[i]!)) {
          items.push(lines[i]!.replace(/^\s*[•\-*]\s+/, ''));
          i++;
        }
        out.push(
          <ul key={k++}>
            {items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ul>,
        );
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) {
          items.push(lines[i]!.replace(/^\s*\d+[.)]\s+/, ''));
          i++;
        }
        out.push(
          <ol key={k++} className="list-decimal pl-5">
            {items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ol>,
        );
        continue;
      }
      if (line.trim() === '') {
        i++;
        continue;
      }
      out.push(<p key={k++}>{inline(line)}</p>);
      i++;
    }
    return out;
  }, [text]);
  return <div className={`markdown ${className}`}>{blocks}</div>;
}
