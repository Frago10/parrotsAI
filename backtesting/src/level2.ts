// Nivel 2: replay determinista de una sesión JSONL a través de QuestionPipeline con reloj virtual
// y FakeLlmProvider como clasificador. Compara lo detectado con la verdad de referencia del archivo.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FakeLlmProvider } from '@callpilot/ai';
import { parseSessionLogLine } from '@callpilot/shared';
import type { QuestionType, SessionLogEvent } from '@callpilot/shared';
import { QuestionPipeline } from '../../apps/realtime/src/session/questionPipeline';
import type { DetectedQuestion } from '../../apps/realtime/src/session/questionPipeline';
import { addOutcome, cell, emptyBinary, finalize, ratio } from './metrics';
import type { BinaryMetrics } from './metrics';

export interface Level2Options {
  debounceMs?: number;
  utteranceEndFallbackMs?: number;
  /** Si es false, el pipeline resuelve solo con la heurística (sin clasificador). */
  useLlm?: boolean;
  /** Ruta del archivo de etiquetas; por defecto `<nombre>.labels.json` junto al JSONL. */
  labelsFile?: string;
}

export interface ReplaySegment {
  id: string;
  t: number;
  text: string;
  startMs: number;
  endMs: number;
}

export interface ReplayDetection {
  /** Instante virtual en que el pipeline emitió la detección. */
  t: number;
  question: string;
  qtype: QuestionType;
  needsAnswer: boolean;
  source: DetectedQuestion['source'];
  score: number;
  /** Ids de los segmentos THEM cubiertos por la detección (el pipeline puede fusionar varios). */
  segmentIds: string[];
  /** Verdad de referencia agregada de los segmentos cubiertos. */
  groundTruth: boolean | null;
}

export interface ForcedAnswer {
  t: number;
  /** Último segmento THEM anterior a la acción, si lo hay. */
  lastSegment: ReplaySegment | null;
  /** Hubo una detección con needsAnswer entre ese segmento y la acción. */
  hadDetection: boolean;
  /** Lo que devolvió `flush()` del pipeline en ese momento. */
  pendingText: string | null;
}

export interface FeedbackEntry {
  t: number;
  messageId: string;
  value: 'up' | 'down';
  note: string | null;
  /** Pregunta asociada según `answer.start`, si se encontró. */
  question: string | null;
  kind: string | null;
}

export interface Level2Result {
  file: string;
  sessionId: string | null;
  lines: number;
  parsed: number;
  invalidLines: number[];
  themSegments: number;
  groundTruth: {
    source: 'labels' | 'heuristic' | 'labels+heuristic';
    positives: number;
    labeled: number;
  };
  detections: ReplayDetection[];
  detectedNeedsAnswer: number;
  metrics: BinaryMetrics;
  /** Segmentos con verdad de referencia positiva que ninguna detección cubrió. */
  missed: ReplaySegment[];
  /** Detecciones con needsAnswer cuyos segmentos no son preguntas según la referencia. */
  falsePositives: ReplayDetection[];
  forced: ForcedAnswer[];
  feedback: { up: number; down: number; entries: FeedbackEntry[] };
  options: Required<Pick<Level2Options, 'debounceMs' | 'utteranceEndFallbackMs' | 'useLlm'>>;
}

/** Reloj virtual: los temporizadores se disparan al avanzar el tiempo según los `t` del archivo. */
export class VirtualClock {
  now = 0;
  private seq = 0;
  private timers = new Map<number, { due: number; fn: () => void }>();

  setTimer = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.set(id, { due: this.now + ms, fn });
    return id;
  };

  clearTimer = (t: unknown): void => {
    this.timers.delete(t as number);
  };

  /** Avanza hasta `t` disparando en orden los temporizadores vencidos y drenando las promesas pendientes. */
  async advanceTo(t: number): Promise<void> {
    for (;;) {
      let nextId: number | null = null;
      let next: { due: number; fn: () => void } | null = null;
      for (const [id, timer] of this.timers) {
        if (timer.due <= t && (next === null || timer.due < next.due)) {
          nextId = id;
          next = timer;
        }
      }
      if (nextId === null || next === null) break;
      this.timers.delete(nextId);
      this.now = Math.max(this.now, next.due);
      next.fn();
      await drainMicrotasks();
    }
    this.now = Math.max(this.now, t);
    await drainMicrotasks();
  }

  async flushAll(): Promise<void> {
    let max = this.now;
    for (const timer of this.timers.values()) max = Math.max(max, timer.due);
    await this.advanceTo(max);
  }

  get pendingTimers(): number {
    return this.timers.size;
  }
}

async function drainMicrotasks(): Promise<void> {
  // El FakeLlmProvider resuelve en microtareas y un setTimeout(0): dos vueltas del event loop bastan.
  for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

export interface ParsedSession {
  events: SessionLogEvent[];
  lines: number;
  invalidLines: number[];
}

export function parseSessionFile(file: string): ParsedSession {
  const raw = readFileSync(file, 'utf8').split('\n');
  const events: SessionLogEvent[] = [];
  const invalidLines: number[] = [];
  let lines = 0;
  raw.forEach((line, i) => {
    if (!line.trim()) return;
    lines++;
    const ev = parseSessionLogLine(line);
    if (ev) events.push(ev);
    else invalidLines.push(i + 1);
  });
  // Orden estable por `t` (el servidor escribe en orden, pero no dependemos de ello).
  events.sort((a, b) => a.t - b.t);
  return { events, lines, invalidLines };
}

const LabelsFileSchema = (raw: unknown): Record<string, boolean> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('labels.json debe ser un objeto { segmentId: boolean }');
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'boolean') throw new Error(`labels.json: el valor de ${k} debe ser boolean`);
    out[k] = v;
  }
  return out;
};

export function defaultLabelsFile(file: string): string {
  const ext = path.extname(file);
  return path.join(path.dirname(file), `${path.basename(file, ext)}.labels.json`);
}

/** Texto reciente de THEM (últimos ~30 s) en el formato que espera el clasificador. */
function formatRecent(segments: ReplaySegment[], now: number): string {
  return segments
    .filter((s) => now - s.endMs <= 30_000)
    .map((s) => `THEM: ${s.text}`)
    .join('\n');
}

export async function replaySession(file: string, opts: Level2Options = {}): Promise<Level2Result> {
  const debounceMs = opts.debounceMs ?? 600;
  const utteranceEndFallbackMs = opts.utteranceEndFallbackMs ?? 1500;
  const useLlm = opts.useLlm ?? true;
  const { events, lines, invalidLines } = parseSessionFile(file);

  // ---------- Verdad de referencia ----------
  const heuristicByText = new Map<string, boolean>();
  for (const ev of events)
    if (ev.ev === 'question.heuristic') heuristicByText.set(ev.text, ev.needsAnswer);
  const labelsFile = opts.labelsFile ?? defaultLabelsFile(file);
  const labels = existsSync(labelsFile)
    ? LabelsFileSchema(JSON.parse(readFileSync(labelsFile, 'utf8')))
    : null;

  const themSegments: ReplaySegment[] = events
    .filter(
      (ev): ev is Extract<SessionLogEvent, { ev: 'transcript.final' }> =>
        ev.ev === 'transcript.final' && ev.channel === 'them',
    )
    .map((ev) => ({ id: ev.id, t: ev.t, text: ev.text, startMs: ev.startMs, endMs: ev.endMs }));

  const truth = new Map<string, boolean>();
  let labeledFromFile = 0;
  let labeledFromHeuristic = 0;
  for (const s of themSegments) {
    if (labels && s.id in labels) {
      truth.set(s.id, labels[s.id]!);
      labeledFromFile++;
    } else if (heuristicByText.has(s.text)) {
      truth.set(s.id, heuristicByText.get(s.text)!);
      labeledFromHeuristic++;
    } else {
      truth.set(s.id, false);
    }
  }
  const gtSource: Level2Result['groundTruth']['source'] =
    labeledFromFile && labeledFromHeuristic
      ? 'labels+heuristic'
      : labeledFromFile
        ? 'labels'
        : 'heuristic';

  // ---------- Replay ----------
  const clock = new VirtualClock();
  const fed: ReplaySegment[] = [];
  const detections: ReplayDetection[] = [];
  const pipeline = new QuestionPipeline({
    llm: useLlm ? new FakeLlmProvider({ chunkDelayMs: 0 }) : null,
    classifierModel: 'fake-classifier',
    debounceMs,
    utteranceEndFallbackMs,
    recentThem: () => formatRecent(fed, clock.now),
    now: () => clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDetected: (q, lastSegmentText) => {
      // El texto resuelto puede ser la fusión de varios finales: se atribuye a los últimos segmentos contenidos.
      const ids: string[] = [];
      for (let i = fed.length - 1; i >= 0; i--) {
        const s = fed[i]!;
        if (!lastSegmentText.includes(s.text)) break;
        ids.unshift(s.id);
      }
      if (!ids.length && fed.length) ids.push(fed[fed.length - 1]!.id);
      const gt = ids.length ? ids.some((id) => truth.get(id) === true) : null;
      detections.push({
        t: clock.now,
        question: q.question,
        qtype: q.qtype,
        needsAnswer: q.needsAnswer,
        source: q.source,
        score: q.score,
        segmentIds: ids,
        groundTruth: gt,
      });
    },
  });

  const forced: ForcedAnswer[] = [];
  const answerStarts = new Map<string, { question: string | null; kind: string }>();
  const feedbackEntries: FeedbackEntry[] = [];
  let sessionId: string | null = null;

  for (const ev of events) {
    sessionId ??= ev.sessionId;
    await clock.advanceTo(ev.t);
    switch (ev.ev) {
      case 'transcript.final':
        if (ev.channel === 'them') {
          fed.push({ id: ev.id, t: ev.t, text: ev.text, startMs: ev.startMs, endMs: ev.endMs });
          pipeline.onFinalSegment(ev.text);
        }
        break;
      case 'utterance.end':
        if (ev.channel === 'them') pipeline.onUtteranceEnd();
        break;
      case 'user.action':
        if (ev.action === 'answer') {
          const last = fed.length ? fed[fed.length - 1]! : null;
          const hadDetection = last
            ? detections.some((d) => d.needsAnswer && d.t >= last.t && d.t <= ev.t)
            : false;
          const pending = pipeline.flush();
          forced.push({
            t: ev.t,
            lastSegment: last,
            hadDetection,
            pendingText: pending?.text ?? null,
          });
        } else if (ev.action === 'clear' || ev.action === 'end') {
          pipeline.reset();
        }
        break;
      case 'answer.start':
        answerStarts.set(ev.messageId, { question: ev.question, kind: ev.kind });
        break;
      case 'user.feedback': {
        const a = answerStarts.get(ev.messageId);
        feedbackEntries.push({
          t: ev.t,
          messageId: ev.messageId,
          value: ev.value,
          note: ev.note,
          question: a?.question ?? null,
          kind: a?.kind ?? null,
        });
        break;
      }
      default:
        break;
    }
  }
  await clock.flushAll();

  // ---------- Métricas ----------
  const covered = new Set<string>();
  for (const d of detections) if (d.needsAnswer) for (const id of d.segmentIds) covered.add(id);
  const metrics = emptyBinary();
  const missed: ReplaySegment[] = [];
  for (const s of themSegments) {
    const expected = truth.get(s.id) === true;
    const predicted = covered.has(s.id);
    addOutcome(metrics, expected, predicted);
    if (expected && !predicted) missed.push(s);
  }
  // Los FP se cuentan por detección (no por segmento) para que la tabla cuadre con la lista.
  const falsePositives = detections.filter((d) => d.needsAnswer && d.groundTruth === false);
  metrics.fp = falsePositives.length;

  return {
    file,
    sessionId,
    lines,
    parsed: events.length,
    invalidLines,
    themSegments: themSegments.length,
    groundTruth: {
      source: gtSource,
      positives: [...truth.values()].filter(Boolean).length,
      labeled: labeledFromFile,
    },
    detections,
    detectedNeedsAnswer: detections.filter((d) => d.needsAnswer).length,
    metrics: finalize(metrics),
    missed,
    falsePositives,
    forced,
    feedback: {
      up: feedbackEntries.filter((f) => f.value === 'up').length,
      down: feedbackEntries.filter((f) => f.value === 'down').length,
      entries: feedbackEntries,
    },
    options: { debounceMs, utteranceEndFallbackMs, useLlm },
  };
}

function fmtT(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function summarizeLevel2(r: Level2Result): string {
  const m = r.metrics;
  const forcedMissed = r.forced.filter((f) => !f.hadDetection).length;
  return (
    `${path.basename(r.file)}: ${r.parsed}/${r.lines} eventos válidos, ${r.themSegments} segmentos THEM, ` +
    `${r.groundTruth.positives} preguntas reales (${r.groundTruth.source}), ${r.detectedNeedsAnswer} detectadas con needsAnswer | ` +
    `P=${ratio(m.precision)} R=${ratio(m.recall)} F1=${ratio(m.f1)} | FP=${r.falsePositives.length} perdidas=${r.missed.length} | ` +
    `forzadas=${r.forced.length} (sin detección previa=${forcedMissed}) | feedback +${r.feedback.up}/-${r.feedback.down}`
  );
}

export function renderLevel2Markdown(
  results: Level2Result[],
  generatedAt: Date = new Date(),
): string {
  const lines: string[] = [];
  lines.push('# Backtesting nivel 2: replay de sesiones', '');
  lines.push(`- Generado: ${generatedAt.toISOString()}`);
  lines.push(`- Sesiones: ${results.length}`, '');

  lines.push(
    '## Resumen',
    '',
    '| Sesión | Eventos válidos | Seg. THEM | Reales | Detectadas | TP | FP | FN | Precisión | Recall | F1 | Forzadas (sin detección) | Feedback +/- |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const r of results) {
    const m = r.metrics;
    const forcedMissed = r.forced.filter((f) => !f.hadDetection).length;
    lines.push(
      `| ${cell(path.basename(r.file))} | ${r.parsed}/${r.lines} | ${r.themSegments} | ${r.groundTruth.positives} (${r.groundTruth.source}) | ${r.detectedNeedsAnswer} | ${m.tp} | ${m.fp} | ${m.fn} | ${ratio(m.precision)} | ${ratio(m.recall)} | ${ratio(m.f1)} | ${r.forced.length} (${forcedMissed}) | ${r.feedback.up}/${r.feedback.down} |`,
    );
  }
  lines.push('');

  for (const r of results) {
    lines.push(`## ${path.basename(r.file)}`, '');
    lines.push(
      `- Sesión: \`${r.sessionId ?? '?'}\`; opciones: debounce ${r.options.debounceMs} ms, fallback ${r.options.utteranceEndFallbackMs} ms, clasificador ${r.options.useLlm ? 'FakeLlmProvider' : 'ninguno'}`,
    );
    if (r.invalidLines.length)
      lines.push(`- Líneas inválidas (ignoradas): ${r.invalidLines.join(', ')}`);
    lines.push(
      `- Verdad de referencia: ${r.groundTruth.source}${r.groundTruth.labeled ? ` (${r.groundTruth.labeled} segmentos etiquetados a mano)` : ''}`,
      '',
    );

    lines.push('### Preguntas detectadas', '');
    if (!r.detections.length) lines.push('Ninguna.', '');
    else {
      lines.push(
        '| t | Tipo | needsAnswer | Fuente | Score | Pregunta | Segmentos | Referencia |',
        '|---|---|---|---|---|---|---|---|',
      );
      for (const d of r.detections) {
        const gt = d.groundTruth === null ? '—' : d.groundTruth ? 'pregunta' : 'no pregunta';
        lines.push(
          `| ${fmtT(d.t)} | ${d.qtype} | ${d.needsAnswer ? 'sí' : 'no'} | ${d.source} | ${d.score} | ${cell(d.question)} | ${d.segmentIds.join(', ')} | ${gt} |`,
        );
      }
      lines.push('');
    }

    lines.push(`### Preguntas perdidas (${r.missed.length})`, '');
    if (!r.missed.length) lines.push('Ninguna.', '');
    else {
      lines.push('| t | Segmento | Texto |', '|---|---|---|');
      for (const s of r.missed) lines.push(`| ${fmtT(s.t)} | ${s.id} | ${cell(s.text)} |`);
      lines.push('');
    }

    lines.push(`### Falsos positivos (${r.falsePositives.length})`, '');
    if (!r.falsePositives.length) lines.push('Ninguno.', '');
    else {
      lines.push('| t | Tipo | Pregunta | Segmentos |', '|---|---|---|---|');
      for (const d of r.falsePositives)
        lines.push(
          `| ${fmtT(d.t)} | ${d.qtype} | ${cell(d.question)} | ${d.segmentIds.join(', ')} |`,
        );
      lines.push('');
    }

    lines.push(`### Respuestas forzadas por el usuario (${r.forced.length})`, '');
    if (!r.forced.length) lines.push('Ninguna.', '');
    else {
      lines.push(
        '| t | Detección previa | Último segmento THEM | Pendiente en el pipeline |',
        '|---|---|---|---|',
      );
      for (const f of r.forced) {
        lines.push(
          `| ${fmtT(f.t)} | ${f.hadDetection ? 'sí' : '**no**'} | ${f.lastSegment ? `${f.lastSegment.id}: ${cell(f.lastSegment.text)}` : '—'} | ${f.pendingText ? cell(f.pendingText) : '—'} |`,
        );
      }
      lines.push('');
    }

    lines.push(`### Feedback (+${r.feedback.up} / -${r.feedback.down})`, '');
    if (!r.feedback.entries.length) lines.push('Sin feedback.', '');
    else {
      lines.push('| t | Valor | Tipo de respuesta | Pregunta | Nota |', '|---|---|---|---|---|');
      for (const f of r.feedback.entries) {
        lines.push(
          `| ${fmtT(f.t)} | ${f.value === 'up' ? '👍' : '👎'} | ${f.kind ?? '—'} | ${f.question ? cell(f.question) : '—'} | ${f.note ? cell(f.note) : '—'} |`,
        );
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
