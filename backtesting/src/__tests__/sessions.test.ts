import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSessionLogLine } from '@callpilot/shared';
import { SESSIONS_DIR } from '../paths';

const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.jsonl'));

describe('sesiones JSONL de ejemplo', () => {
  it('existen las dos sesiones demo', () => {
    expect(files).toContain('demo-ventas.jsonl');
    expect(files).toContain('demo-entrevista.jsonl');
  });

  it.each(files)('%s parsea al 100 %% con SessionLogEventSchema', (file) => {
    const lines = readFileSync(path.join(SESSIONS_DIR, file), 'utf8').split('\n').filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(0);
    const events = lines.map((l) => parseSessionLogLine(l));
    const bad = events.map((e, i) => (e ? null : i + 1)).filter((x) => x !== null);
    expect(bad, `líneas inválidas: ${bad.join(', ')}`).toEqual([]);
    const finals = events.filter((e) => e?.ev === 'transcript.final');
    expect(finals.length).toBeGreaterThanOrEqual(15);
    expect(events.some((e) => e?.ev === 'utterance.end' && e.channel === 'them')).toBe(true);
    expect(events.some((e) => e?.ev === 'user.feedback')).toBe(true);
    expect(events.some((e) => e?.ev === 'user.action')).toBe(true);
    // Los tiempos son crecientes.
    for (let i = 1; i < events.length; i++) expect(events[i]!.t).toBeGreaterThanOrEqual(events[i - 1]!.t);
  });
});
