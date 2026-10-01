import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { renderLevel2Markdown, replaySession, VirtualClock } from '../level2';
import { SESSIONS_DIR } from '../paths';
import { writeReport } from '../report';

describe('reloj virtual', () => {
  it('dispara los temporizadores en orden al avanzar', async () => {
    const clock = new VirtualClock();
    const fired: string[] = [];
    clock.setTimer(() => fired.push('b'), 500);
    const a = clock.setTimer(() => fired.push('a'), 100);
    clock.setTimer(() => fired.push('c'), 900);
    clock.clearTimer(a);
    await clock.advanceTo(600);
    expect(fired).toEqual(['b']);
    expect(clock.now).toBe(600);
    await clock.flushAll();
    expect(fired).toEqual(['b', 'c']);
  });
});

describe('nivel 2', () => {
  it('reproduce demo-ventas (con labels.json) y detecta preguntas', async () => {
    const r = await replaySession(path.join(SESSIONS_DIR, 'demo-ventas.jsonl'));
    expect(r.invalidLines).toEqual([]);
    expect(r.parsed).toBe(r.lines);
    expect(r.groundTruth.source).toBe('labels');
    expect(r.detections.length).toBeGreaterThan(0);
    expect(r.detectedNeedsAnswer).toBeGreaterThan(0);
    expect(r.metrics.tp).toBeGreaterThan(0);
    expect(r.metrics.recall).toBeGreaterThanOrEqual(0.8);
    expect(r.forced.length).toBe(1);
    expect(r.feedback.up + r.feedback.down).toBeGreaterThan(0);
    expect(r.detections.some((d) => d.qtype === 'objection')).toBe(true);
  });

  it('reproduce demo-entrevista (sin labels, referencia heurística)', async () => {
    const r = await replaySession(path.join(SESSIONS_DIR, 'demo-entrevista.jsonl'));
    expect(r.groundTruth.source).toBe('heuristic');
    expect(r.detectedNeedsAnswer).toBeGreaterThan(0);
    expect(r.detections.some((d) => d.qtype === 'behavioral')).toBe(true);
    expect(r.detections.some((d) => d.qtype === 'coding')).toBe(true);
    expect(r.metrics.recall).toBeGreaterThanOrEqual(0.8);
  });

  it('funciona sin clasificador LLM', async () => {
    const r = await replaySession(path.join(SESSIONS_DIR, 'demo-entrevista.jsonl'), { useLlm: false });
    expect(r.detections.every((d) => d.source === 'heuristic')).toBe(true);
    expect(r.detectedNeedsAnswer).toBeGreaterThan(0);
  });
});

describe('reporte', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'callpilot-reports-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('escribe el archivo con fecha y el latest', async () => {
    const r = await replaySession(path.join(SESSIONS_DIR, 'demo-ventas.jsonl'));
    const md = renderLevel2Markdown([r], new Date('2026-10-01T12:00:00Z'));
    const w = writeReport('level2', md, { dir, now: new Date('2026-10-01T12:34:56.789Z') });
    expect(path.basename(w.path)).toBe('20261001T123456Z-level2.md');
    expect(path.basename(w.latestPath)).toBe('latest-level2.md');
    expect(readFileSync(w.latestPath, 'utf8')).toContain('# Backtesting nivel 2');
    expect(readFileSync(w.path, 'utf8')).toContain('demo-ventas.jsonl');
  });
});
