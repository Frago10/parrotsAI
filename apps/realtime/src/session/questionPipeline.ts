// Pipeline de detección de preguntas: heurística inmediata + clasificador LLM con debounce
// tras fin de turno. Independiente del transporte para poder testearlo y reproducirlo.
import { buildClassifierUserPrompt, CLASSIFIER_SYSTEM_PROMPT, detectQuestionHeuristic } from '@callpilot/shared';
import type { HeuristicResult, QuestionType } from '@callpilot/shared';
import { extractJson, type LlmProvider } from '@callpilot/ai';

export interface DetectedQuestion {
  question: string;
  qtype: QuestionType;
  needsAnswer: boolean;
  source: 'heuristic' | 'llm';
  score: number;
  heuristic: HeuristicResult;
  classifierLatencyMs: number | null;
}

export interface QuestionPipelineOptions {
  llm: LlmProvider | null;
  classifierModel: string;
  debounceMs: number;
  utteranceEndFallbackMs: number;
  /** Devuelve el texto reciente de THEM (últimos ~30 s) para el clasificador. */
  recentThem: () => string;
  onDetected: (q: DetectedQuestion, lastSegmentText: string) => void;
  onHeuristic?: (text: string, h: HeuristicResult) => void;
  onClassified?: (q: DetectedQuestion, latencyMs: number) => void;
  onError?: (err: Error) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

interface ClassifierJson {
  isQuestion?: boolean;
  question?: string;
  type?: string;
  needsAnswer?: boolean;
}

const VALID_TYPES: QuestionType[] = ['behavioral', 'technical', 'coding', 'objection', 'clarification', 'smalltalk', 'other'];

export class QuestionPipeline {
  private pending: { text: string; heuristic: HeuristicResult } | null = null;
  private timer: unknown = null;
  private utteranceEnded = false;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  private generation = 0;

  constructor(private readonly opts: QuestionPipelineOptions) {
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout));
  }

  /** Segmento final del canal THEM. */
  onFinalSegment(text: string): void {
    const heuristic = detectQuestionHeuristic(text);
    this.opts.onHeuristic?.(text, heuristic);
    // Si el segmento anterior aún no se resolvió, se acumula (la pregunta puede llegar en dos finales).
    const merged = this.pending ? `${this.pending.text} ${text}` : text;
    const mergedHeuristic = this.pending ? detectQuestionHeuristic(merged) : heuristic;
    // Solo vale la pena esperar fin de turno si hay alguna señal de pregunta.
    if (mergedHeuristic.score < 0.2 && !this.pending) return;
    this.pending = { text: merged, heuristic: mergedHeuristic };
    this.utteranceEnded = false;
    this.schedule(this.opts.utteranceEndFallbackMs);
  }

  /** Fin de turno del canal THEM: dispara el debounce corto. */
  onUtteranceEnd(): void {
    if (!this.pending) return;
    this.utteranceEnded = true;
    this.schedule(this.opts.debounceMs);
  }

  /** Fuerza la resolución inmediata (botón Answer). Devuelve la última heurística pendiente, si hay. */
  flush(): { text: string; heuristic: HeuristicResult } | null {
    const p = this.pending;
    this.cancelTimer();
    this.pending = null;
    return p;
  }

  reset(): void {
    this.cancelTimer();
    this.pending = null;
    this.generation++;
  }

  private cancelTimer(): void {
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    const gen = ++this.generation;
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (gen !== this.generation) return;
      void this.resolve(gen);
    }, ms);
  }

  private async resolve(gen: number): Promise<void> {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    const h = p.heuristic;
    const useLlm = this.opts.llm != null && (h.isQuestion || h.score >= 0.2);
    if (!useLlm) {
      if (h.isQuestion) {
        this.opts.onDetected(
          { question: h.question, qtype: h.type, needsAnswer: h.needsAnswer, source: 'heuristic', score: h.score, heuristic: h, classifierLatencyMs: null },
          p.text,
        );
      }
      return;
    }
    const started = Date.now();
    try {
      const res = await this.opts.llm!.complete({
        model: this.opts.classifierModel,
        system: CLASSIFIER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildClassifierUserPrompt(this.opts.recentThem(), p.text) }],
        maxTokens: 200,
        temperature: 0,
        purpose: 'classify',
        json: true,
      });
      if (gen !== this.generation) return;
      const latencyMs = Date.now() - started;
      const json = extractJson<ClassifierJson>(res.text);
      let detected: DetectedQuestion;
      if (!json) {
        detected = { question: h.question, qtype: h.type, needsAnswer: h.needsAnswer, source: 'heuristic', score: h.score, heuristic: h, classifierLatencyMs: latencyMs };
      } else {
        const qtype = VALID_TYPES.includes(json.type as QuestionType) ? (json.type as QuestionType) : h.type;
        const isQuestion = Boolean(json.isQuestion) || h.isQuestion;
        // El clasificador manda sobre needsAnswer, salvo que la heurística sea muy segura (≥ 1.0) y el LLM diga que no.
        const needsAnswer = isQuestion && qtype !== 'smalltalk' && (Boolean(json.needsAnswer) || h.score >= 1.0);
        detected = {
          question: (json.question && json.question.trim()) || h.question || p.text,
          qtype,
          needsAnswer,
          source: 'llm',
          score: h.score,
          heuristic: h,
          classifierLatencyMs: latencyMs,
        };
      }
      this.opts.onClassified?.(detected, latencyMs);
      if (detected.needsAnswer || detected.heuristic.isQuestion) this.opts.onDetected(detected, p.text);
    } catch (err) {
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      if (h.isQuestion) {
        this.opts.onDetected(
          { question: h.question, qtype: h.type, needsAnswer: h.needsAnswer, source: 'heuristic', score: h.score, heuristic: h, classifierLatencyMs: null },
          p.text,
        );
      }
    }
  }
}
