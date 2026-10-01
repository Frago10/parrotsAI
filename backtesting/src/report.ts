// Escritura de reportes Markdown en backtesting/reports/.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPORTS_DIR } from './paths';

export type ReportLevel = 'level1' | 'level2' | 'all';

/** Fecha ISO compacta apta para nombres de archivo: 20261001T174300Z. */
export function compactIso(date: Date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export interface WrittenReport {
  path: string;
  latestPath: string;
}

export function writeReport(level: ReportLevel, markdown: string, opts: { dir?: string; now?: Date } = {}): WrittenReport {
  const dir = opts.dir ?? REPORTS_DIR;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${compactIso(opts.now)}-${level}.md`);
  const latest = path.join(dir, `latest-${level}.md`);
  const content = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
  writeFileSync(file, content, 'utf8');
  writeFileSync(latest, content, 'utf8');
  return { path: file, latestPath: latest };
}
