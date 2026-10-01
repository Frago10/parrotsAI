// Nivel 1: la heurística de preguntas contra el dataset etiquetado (sin LLM, determinista).
import { detectQuestionHeuristic } from '@callpilot/shared';
import type { HeuristicResult, QuestionType } from '@callpilot/shared';
import { loadDataset, QUESTION_TYPES } from './dataset';
import type { DatasetItem, DatasetLang } from './dataset';
import { addOutcome, cell, emptyBinary, finalize, pct, ratio } from './metrics';
import type { BinaryMetrics } from './metrics';
import { QUESTIONS_DATASET } from './paths';

export interface Level1Thresholds {
  needsAnswerRecall: number;
  needsAnswerPrecision: number;
  smalltalkAnsweredRate: number;
}

export const DEFAULT_THRESHOLDS: Level1Thresholds = {
  needsAnswerRecall: 0.9,
  needsAnswerPrecision: 0.8,
  smalltalkAnsweredRate: 0.05,
};

export interface Level1Failure {
  id: string;
  lang: DatasetLang;
  text: string;
  expected: { isQuestion: boolean; needsAnswer: boolean; type: QuestionType };
  got: { isQuestion: boolean; needsAnswer: boolean; type: QuestionType; score: number };
  reasons: string[];
  /** Qué campos no coinciden. */
  mismatches: Array<'isQuestion' | 'needsAnswer' | 'type'>;
}

export interface Level1Check {
  name: string;
  value: number;
  target: number;
  /** 'min': value ≥ target; 'max': value ≤ target. */
  kind: 'min' | 'max';
  ok: boolean;
}

export interface Level1Result {
  datasetPath: string;
  total: number;
  byLang: Record<DatasetLang, number>;
  isQuestion: { global: BinaryMetrics; byLang: Record<DatasetLang, BinaryMetrics> };
  needsAnswer: { global: BinaryMetrics; byLang: Record<DatasetLang, BinaryMetrics> };
  /** Matriz de confusión de tipo solo sobre los ítems etiquetados como pregunta (filas: esperado, columnas: obtenido). */
  typeConfusion: { labels: QuestionType[]; matrix: number[][]; total: number; correct: number; accuracy: number };
  smalltalk: { total: number; answered: number; rate: number };
  failures: Level1Failure[];
  thresholds: Level1Thresholds;
  checks: Level1Check[];
  passed: boolean;
}

const LANGS: DatasetLang[] = ['es', 'en'];

function langRecord<T>(make: () => T): Record<DatasetLang, T> {
  return { es: make(), en: make() };
}

export function runLevel1(
  items: DatasetItem[] = loadDataset(),
  thresholds: Level1Thresholds = DEFAULT_THRESHOLDS,
  datasetPath: string = QUESTIONS_DATASET,
): Level1Result {
  const isQ = { global: emptyBinary(), byLang: langRecord(emptyBinary) };
  const na = { global: emptyBinary(), byLang: langRecord(emptyBinary) };
  const byLang: Record<DatasetLang, number> = { es: 0, en: 0 };
  const idx = new Map(QUESTION_TYPES.map((t, i) => [t, i] as const));
  const matrix = QUESTION_TYPES.map(() => QUESTION_TYPES.map(() => 0));
  let typeTotal = 0;
  let typeCorrect = 0;
  let smalltalkTotal = 0;
  let smalltalkAnswered = 0;
  const failures: Level1Failure[] = [];

  for (const it of items) {
    const r: HeuristicResult = detectQuestionHeuristic(it.text);
    byLang[it.lang]++;
    addOutcome(isQ.global, it.isQuestion, r.isQuestion);
    addOutcome(isQ.byLang[it.lang], it.isQuestion, r.isQuestion);
    addOutcome(na.global, it.needsAnswer, r.needsAnswer);
    addOutcome(na.byLang[it.lang], it.needsAnswer, r.needsAnswer);
    if (it.isQuestion) {
      typeTotal++;
      matrix[idx.get(it.type)!]![idx.get(r.type)!]!++;
      if (r.type === it.type) typeCorrect++;
    }
    if (it.type === 'smalltalk') {
      smalltalkTotal++;
      if (r.needsAnswer) smalltalkAnswered++;
    }
    const mismatches: Level1Failure['mismatches'] = [];
    if (r.isQuestion !== it.isQuestion) mismatches.push('isQuestion');
    if (r.needsAnswer !== it.needsAnswer) mismatches.push('needsAnswer');
    // El tipo solo se evalúa en preguntas: en afirmaciones ("other") la heurística devuelve 'other' o 'smalltalk'.
    if (it.isQuestion && r.type !== it.type) mismatches.push('type');
    if (mismatches.length) {
      failures.push({
        id: it.id,
        lang: it.lang,
        text: it.text,
        expected: { isQuestion: it.isQuestion, needsAnswer: it.needsAnswer, type: it.type },
        got: { isQuestion: r.isQuestion, needsAnswer: r.needsAnswer, type: r.type, score: r.score },
        reasons: r.reasons,
        mismatches,
      });
    }
  }

  const needsAnswerGlobal = finalize(na.global);
  const smalltalkRate = smalltalkTotal ? smalltalkAnswered / smalltalkTotal : 0;
  const checks: Level1Check[] = [
    { name: 'recall needsAnswer', value: needsAnswerGlobal.recall, target: thresholds.needsAnswerRecall, kind: 'min', ok: needsAnswerGlobal.recall >= thresholds.needsAnswerRecall },
    { name: 'precisión needsAnswer', value: needsAnswerGlobal.precision, target: thresholds.needsAnswerPrecision, kind: 'min', ok: needsAnswerGlobal.precision >= thresholds.needsAnswerPrecision },
    { name: 'smalltalk respondido', value: smalltalkRate, target: thresholds.smalltalkAnsweredRate, kind: 'max', ok: smalltalkRate <= thresholds.smalltalkAnsweredRate },
  ];

  return {
    datasetPath,
    total: items.length,
    byLang,
    isQuestion: { global: finalize(isQ.global), byLang: { es: finalize(isQ.byLang.es), en: finalize(isQ.byLang.en) } },
    needsAnswer: { global: needsAnswerGlobal, byLang: { es: finalize(na.byLang.es), en: finalize(na.byLang.en) } },
    typeConfusion: { labels: [...QUESTION_TYPES], matrix, total: typeTotal, correct: typeCorrect, accuracy: typeTotal ? typeCorrect / typeTotal : 0 },
    smalltalk: { total: smalltalkTotal, answered: smalltalkAnswered, rate: smalltalkRate },
    failures,
    thresholds,
    checks,
    passed: checks.every((c) => c.ok),
  };
}

function metricsRow(name: string, m: BinaryMetrics): string {
  return `| ${name} | ${ratio(m.precision)} | ${ratio(m.recall)} | ${ratio(m.f1)} | ${m.tp} | ${m.fp} | ${m.fn} | ${m.tn} |`;
}

function metricsTable(title: string, global: BinaryMetrics, byLang: Record<DatasetLang, BinaryMetrics>): string[] {
  return [
    `### ${title}`,
    '',
    '| Ámbito | Precisión | Recall | F1 | TP | FP | FN | TN |',
    '|---|---|---|---|---|---|---|---|',
    metricsRow('global', global),
    ...LANGS.map((l) => metricsRow(l, byLang[l])),
    '',
  ];
}

/** Resumen de una línea para la consola. */
export function summarizeLevel1(r: Level1Result): string {
  const na = r.needsAnswer.global;
  return [
    `Nivel 1: ${r.total} frases (es=${r.byLang.es}, en=${r.byLang.en})`,
    `needsAnswer P=${ratio(na.precision)} R=${ratio(na.recall)} F1=${ratio(na.f1)} | es R=${ratio(r.needsAnswer.byLang.es.recall)} en R=${ratio(r.needsAnswer.byLang.en.recall)}`,
    `isQuestion P=${ratio(r.isQuestion.global.precision)} R=${ratio(r.isQuestion.global.recall)} | tipo acc=${ratio(r.typeConfusion.accuracy)} (${r.typeConfusion.correct}/${r.typeConfusion.total})`,
    `smalltalk respondido ${r.smalltalk.answered}/${r.smalltalk.total} (${pct(r.smalltalk.rate)}) | fallos ${r.failures.length} | ${r.passed ? 'UMBRALES OK' : 'UMBRALES NO CUMPLIDOS'}`,
  ].join('\n');
}

export function renderLevel1Markdown(r: Level1Result, generatedAt: Date = new Date()): string {
  const lines: string[] = [];
  lines.push('# Backtesting nivel 1: heurística de preguntas', '');
  lines.push(`- Generado: ${generatedAt.toISOString()}`);
  lines.push(`- Dataset: \`${r.datasetPath}\` (${r.total} frases: es=${r.byLang.es}, en=${r.byLang.en})`);
  lines.push(`- Resultado: **${r.passed ? 'PASA' : 'NO PASA'}**`, '');

  lines.push('## Umbrales', '', '| Métrica | Valor | Objetivo | OK |', '|---|---|---|---|');
  for (const c of r.checks) {
    lines.push(`| ${c.name} | ${ratio(c.value)} | ${c.kind === 'min' ? '≥' : '≤'} ${ratio(c.target)} | ${c.ok ? 'sí' : '**no**'} |`);
  }
  lines.push('');

  lines.push('## Métricas binarias', '');
  lines.push(...metricsTable('needsAnswer', r.needsAnswer.global, r.needsAnswer.byLang));
  lines.push(...metricsTable('isQuestion', r.isQuestion.global, r.isQuestion.byLang));

  lines.push('## Tipo de pregunta (solo ítems etiquetados como pregunta)', '');
  lines.push(`Accuracy de tipo: ${ratio(r.typeConfusion.accuracy)} (${r.typeConfusion.correct}/${r.typeConfusion.total}). Filas: esperado; columnas: obtenido.`, '');
  lines.push(`| esperado \\ obtenido | ${r.typeConfusion.labels.join(' | ')} |`);
  lines.push(`|---|${r.typeConfusion.labels.map(() => '---').join('|')}|`);
  r.typeConfusion.labels.forEach((label, i) => {
    lines.push(`| ${label} | ${r.typeConfusion.matrix[i]!.map((n) => (n ? String(n) : '·')).join(' | ')} |`);
  });
  lines.push('');

  lines.push('## Smalltalk respondido', '');
  lines.push(`${r.smalltalk.answered} de ${r.smalltalk.total} frases de smalltalk se marcaron con needsAnswer=true (${pct(r.smalltalk.rate)}).`, '');

  lines.push(`## Fallos (${r.failures.length})`, '');
  if (!r.failures.length) lines.push('Sin fallos.', '');
  else {
    lines.push('| id | texto | esperado | obtenido | score | reasons |', '|---|---|---|---|---|---|');
    for (const f of r.failures) {
      const exp = `q=${f.expected.isQuestion} na=${f.expected.needsAnswer} ${f.expected.type}`;
      const got = `q=${f.got.isQuestion} na=${f.got.needsAnswer} ${f.got.type}`;
      lines.push(`| ${f.id} | ${cell(f.text)} | ${exp} | ${got} (${f.mismatches.join(', ')}) | ${f.got.score} | ${f.reasons.join(', ') || '—'} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
