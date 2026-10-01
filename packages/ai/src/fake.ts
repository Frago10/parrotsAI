// Proveedor simulado: determinista, sin red. Sirve para desarrollo sin claves y para backtesting.
import { answerLabels, detectQuestionHeuristic } from '@callpilot/shared';
import type { LlmCallOptions, LlmCompletion, LlmProvider, LlmRequest, LlmStreamEvent } from './types';
import { collectStream, estimateTokens } from './types';

export interface FakeProviderOptions {
  /** Retraso entre fragmentos para simular streaming (0 en tests). */
  chunkDelayMs?: number;
  /** Latencia hasta el primer token. */
  firstTokenDelayMs?: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      },
      { once: true },
    );
  });
}

function lastUserContent(req: LlmRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role === 'user') return m.content;
  }
  return '';
}

function detectLanguage(system: string): string {
  return /answer in Spanish|Pregunta/i.test(system) ? 'es' : 'en';
}

function fakeAnswer(req: LlmRequest): string {
  const user = lastUserContent(req);
  const lang = detectLanguage(req.system);
  const labels = answerLabels(lang);
  const qMatch = user.match(/## Detected question[^\n]*\n([^\n]+)/);
  const question = qMatch?.[1]?.trim() ?? (lang === 'es' ? 'lo último que se dijo' : 'the last thing said');
  const kind = detectQuestionHeuristic(question).type;
  if (kind === 'coding') {
    return lang === 'es'
      ? `💬 **${labels.question}:** ${question}\n⭐ **${labels.answer}:** Recorro la entrada una sola vez y uso un diccionario para los complementos.\n\`\`\`python\ndef solve(items):\n    seen = {}\n    for i, x in enumerate(items):\n        if x in seen:\n            return seen[x], i\n        seen[x] = i\n    return None\n\`\`\`\n• Caso borde: lista vacía o un solo elemento.\n• Caso borde: valores repetidos.\nTime/Space: O(n) / O(n)`
      : `💬 **${labels.question}:** ${question}\n⭐ **${labels.answer}:** Single pass with a hash map for complements.\n\`\`\`python\ndef solve(items):\n    seen = {}\n    for i, x in enumerate(items):\n        if x in seen:\n            return seen[x], i\n        seen[x] = i\n    return None\n\`\`\`\n• Edge case: empty or single-element input.\n• Edge case: duplicates.\nTime/Space: O(n) / O(n)`;
  }
  if (kind === 'objection') {
    return lang === 'es'
      ? `💬 **${labels.question}:** ${question}\n⭐ **${labels.answer}:** Entiendo la preocupación; comparemos el costo con lo que hoy les cuesta el problema.\n• Reconozco la objeción sin discutirla.\n• Cuantifico el impacto actual (horas, errores, oportunidades).\n• Propongo un piloto acotado con criterios de éxito claros.\n¿Qué resultado tendría que ver en 30 días para que valga la pena?`
      : `💬 **${labels.question}:** ${question}\n⭐ **${labels.answer}:** Fair concern; let's compare the cost against what the problem costs you today.\n• Acknowledge the objection without arguing.\n• Quantify the current impact (hours, errors, missed deals).\n• Offer a scoped pilot with clear success criteria.\nWhat would you need to see in 30 days to make this worth it?`;
  }
  return lang === 'es'
    ? `💬 **${labels.question}:** ${question}\n⭐ **${labels.answer}:** Respondo con la idea central primero y un ejemplo concreto.\n• Contexto: qué situación era y qué estaba en juego.\n• Acción: qué hice yo específicamente.\n• Resultado: qué cambió, con una métrica si la tengo.\nSi quieres, profundizo en la parte que más te interese.`
    : `💬 **${labels.question}:** ${question}\n⭐ **${labels.answer}:** Lead with the key idea, then one concrete example.\n• Context: the situation and what was at stake.\n• Action: what I specifically did.\n• Result: what changed, with a metric where possible.\nHappy to go deeper on whichever part is most relevant.`;
}

function fakeClassification(req: LlmRequest): string {
  const user = lastUserContent(req);
  const seg = user.match(/Last segment:\n([\s\S]*?)\n\nJSON:/)?.[1] ?? user;
  const h = detectQuestionHeuristic(seg);
  return JSON.stringify({ isQuestion: h.isQuestion, question: h.question, type: h.type, needsAnswer: h.needsAnswer });
}

function fakeNotes(req: LlmRequest): string {
  const user = lastUserContent(req);
  const transcript = user.split('Transcript (THEM = other party, ME = the USER):')[1] ?? user;
  const themLines = transcript
    .split('\n')
    .filter((l) => l.startsWith('THEM:'))
    .map((l) => l.replace(/^THEM:\s*/, '').trim());
  const questions = themLines.filter((l) => detectQuestionHeuristic(l).needsAnswer).slice(0, 10);
  const company = user.match(/company=([^;]+);/)?.[1] ?? 'unknown';
  const title = user.match(/title=([^;]+);/)?.[1] ?? 'unknown';
  return JSON.stringify({
    callDetails: `Esta llamada fue con ${company}, sobre ${title}.`,
    summary: `Resumen simulado de ${themLines.length} intervenciones de la otra parte. Se discutieron los temas de la sesión y se identificaron ${questions.length} preguntas relevantes.`,
    questions,
    nextSteps: questions.length ? ['Enviar seguimiento con las respuestas acordadas'] : [],
    actionItems: [{ owner: 'ME', task: 'Enviar correo de seguimiento', due: null }],
    decisions: [],
    risks: themLines.filter((l) => detectQuestionHeuristic(l).type === 'objection').slice(0, 5),
  });
}

function fakeChat(req: LlmRequest): string {
  const user = lastUserContent(req);
  const lang = detectLanguage(req.system);
  return lang === 'es'
    ? `(simulado) Recibido: "${user.slice(0, 120)}". En producción aquí respondería el modelo con el contexto de la sesión.`
    : `(simulated) Got it: "${user.slice(0, 120)}". In production the model would answer here with the session context.`;
}

export class FakeLlmProvider implements LlmProvider {
  readonly id = 'fake' as const;
  constructor(private readonly opts: FakeProviderOptions = {}) {}

  private render(req: LlmRequest): string {
    switch (req.purpose) {
      case 'classify':
        return fakeClassification(req);
      case 'notes':
        return fakeNotes(req);
      case 'notes_chunk':
        return '• Bloque resumido (simulado).';
      case 'chat':
      case 'ask':
        return fakeChat(req);
      default:
        return fakeAnswer(req);
    }
  }

  async *stream(req: LlmRequest, opts: LlmCallOptions = {}): AsyncIterable<LlmStreamEvent> {
    const text = this.render(req);
    await sleep(this.opts.firstTokenDelayMs ?? 0, opts.signal);
    const chunks = req.json ? [text] : text.split(/(?<=\s)/);
    for (const chunk of chunks) {
      if (opts.signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      yield { type: 'delta', text: chunk };
      await sleep(this.opts.chunkDelayMs ?? 0, opts.signal);
    }
    const inputTokens = estimateTokens(req.system) + req.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    yield {
      type: 'done',
      usage: { inputTokens, outputTokens: estimateTokens(text), cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: 'end_turn',
      model: req.model,
    };
  }

  complete(req: LlmRequest, opts: LlmCallOptions = {}): Promise<LlmCompletion> {
    return collectStream(this.stream(req, opts), req.model);
  }
}
