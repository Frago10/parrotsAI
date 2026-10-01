import { describe, expect, it, vi } from 'vitest';
import { FakeLlmProvider } from '@callpilot/ai';
import { QuestionPipeline, type DetectedQuestion } from '../session/questionPipeline';

function makePipeline(opts: { llm: boolean; onDetected: (q: DetectedQuestion) => void }) {
  return new QuestionPipeline({
    llm: opts.llm ? new FakeLlmProvider({ chunkDelayMs: 0 }) : null,
    classifierModel: 'fake-fast',
    debounceMs: 600,
    utteranceEndFallbackMs: 1500,
    recentThem: () => '',
    onDetected: opts.onDetected,
  });
}

describe('QuestionPipeline', () => {
  it('espera fin de turno + debounce antes de detectar', async () => {
    vi.useFakeTimers();
    const detected: DetectedQuestion[] = [];
    const p = makePipeline({ llm: false, onDetected: (q) => detected.push(q) });
    p.onFinalSegment('¿Cómo manejas los plazos ajustados?');
    expect(detected).toHaveLength(0);
    p.onUtteranceEnd();
    await vi.advanceTimersByTimeAsync(599);
    expect(detected).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(detected).toHaveLength(1);
    expect(detected[0]!.needsAnswer).toBe(true);
    expect(detected[0]!.qtype).toBe('behavioral');
    vi.useRealTimers();
  });

  it('usa el fallback si nunca llega utterance.end', async () => {
    vi.useFakeTimers();
    const detected: DetectedQuestion[] = [];
    const p = makePipeline({ llm: false, onDetected: (q) => detected.push(q) });
    p.onFinalSegment('What is the difference between a view and a table?');
    await vi.advanceTimersByTimeAsync(1501);
    expect(detected).toHaveLength(1);
    vi.useRealTimers();
  });

  it('ignora afirmaciones sin señal de pregunta', async () => {
    vi.useFakeTimers();
    const detected: DetectedQuestion[] = [];
    const p = makePipeline({ llm: false, onDetected: (q) => detected.push(q) });
    p.onFinalSegment('Hoy vamos a revisar el roadmap del trimestre');
    p.onUtteranceEnd();
    await vi.advanceTimersByTimeAsync(3000);
    expect(detected).toHaveLength(0);
    vi.useRealTimers();
  });

  it('con clasificador LLM no responde smalltalk', async () => {
    vi.useFakeTimers();
    const detected: DetectedQuestion[] = [];
    const p = makePipeline({ llm: true, onDetected: (q) => detected.push(q) });
    p.onFinalSegment('¿Me escuchas bien?');
    p.onUtteranceEnd();
    await vi.advanceTimersByTimeAsync(700);
    expect(detected).toHaveLength(1);
    expect(detected[0]!.needsAnswer).toBe(false);
    expect(detected[0]!.source).toBe('llm');
    vi.useRealTimers();
  });

  it('une dos finales consecutivos en una sola pregunta', async () => {
    vi.useFakeTimers();
    const detected: DetectedQuestion[] = [];
    const p = makePipeline({ llm: false, onDetected: (q) => detected.push(q) });
    p.onFinalSegment('Cuéntame de una vez');
    await vi.advanceTimersByTimeAsync(300);
    p.onFinalSegment('en la que tuviste un conflicto con tu jefe');
    p.onUtteranceEnd();
    await vi.advanceTimersByTimeAsync(700);
    expect(detected).toHaveLength(1);
    expect(detected[0]!.question).toContain('conflicto');
    vi.useRealTimers();
  });
});
