// CLI del backtesting: `tsx src/cli.ts level1 | level2 [archivo.jsonl ...] | all`.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { renderLevel1Markdown, runLevel1, summarizeLevel1 } from './level1';
import type { Level1Result } from './level1';
import { renderLevel2Markdown, replaySession, summarizeLevel2 } from './level2';
import type { Level2Result } from './level2';
import { SESSIONS_DIR } from './paths';
import { writeReport } from './report';

function usage(): never {
  console.error('Uso: tsx src/cli.ts level1 | level2 [archivo.jsonl ...] | all');
  process.exit(2);
}

function listSessionFiles(): string[] {
  return readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => path.join(SESSIONS_DIR, f));
}

function runLevel1Cli(): Level1Result {
  const result = runLevel1();
  const report = writeReport('level1', renderLevel1Markdown(result));
  console.log(summarizeLevel1(result));
  if (result.failures.length) {
    console.log('Fallos:');
    for (const f of result.failures.slice(0, 20)) {
      console.log(`  - ${f.id} [${f.mismatches.join(',')}] "${f.text}" esperado=${f.expected.needsAnswer}/${f.expected.type} obtenido=${f.got.needsAnswer}/${f.got.type} (${f.reasons.join(',') || 'sin señales'})`);
    }
    if (result.failures.length > 20) console.log(`  ... y ${result.failures.length - 20} más (ver reporte)`);
  }
  console.log(`Reporte: ${report.path}`);
  return result;
}

async function runLevel2Cli(files: string[]): Promise<Level2Result[]> {
  const targets = files.length ? files.map((f) => path.resolve(f)) : listSessionFiles();
  if (!targets.length) {
    console.log(`Nivel 2: no hay archivos .jsonl en ${SESSIONS_DIR}`);
    return [];
  }
  const results: Level2Result[] = [];
  for (const file of targets) {
    const r = await replaySession(file);
    results.push(r);
    console.log(summarizeLevel2(r));
  }
  const report = writeReport('level2', renderLevel2Markdown(results));
  console.log(`Reporte: ${report.path}`);
  return results;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'level1':
      return runLevel1Cli().passed ? 0 : 1;
    case 'level2':
      await runLevel2Cli(rest);
      return 0;
    case 'all': {
      const l1 = runLevel1Cli();
      console.log('');
      await runLevel2Cli([]);
      return l1.passed ? 0 : 1;
    }
    default:
      usage();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
