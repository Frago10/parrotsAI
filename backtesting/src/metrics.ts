// Utilidades de métricas compartidas por los niveles 1 y 2.

export interface BinaryMetrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}

export function emptyBinary(): BinaryMetrics {
  return { tp: 0, fp: 0, fn: 0, tn: 0, precision: 0, recall: 0, f1: 0, accuracy: 0 };
}

export function addOutcome(m: BinaryMetrics, expected: boolean, predicted: boolean): void {
  if (expected && predicted) m.tp++;
  else if (!expected && predicted) m.fp++;
  else if (expected && !predicted) m.fn++;
  else m.tn++;
}

/** Calcula precisión/recall/F1/accuracy a partir de los conteos (0 cuando el denominador es 0). */
export function finalize(m: BinaryMetrics): BinaryMetrics {
  const precision = m.tp + m.fp ? m.tp / (m.tp + m.fp) : 0;
  const recall = m.tp + m.fn ? m.tp / (m.tp + m.fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const total = m.tp + m.fp + m.fn + m.tn;
  const accuracy = total ? (m.tp + m.tn) / total : 0;
  return { ...m, precision, recall, f1, accuracy };
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)} %`;
}

export function ratio(x: number, digits = 3): string {
  return x.toFixed(digits);
}

/** Escapa barras verticales y saltos de línea para celdas de tabla Markdown. */
export function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}
