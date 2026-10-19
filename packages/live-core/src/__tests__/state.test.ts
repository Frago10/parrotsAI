import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@callpilot/shared';
import { initialLiveState, liveReducer, type LiveState } from '../state';

const server = (state: LiveState, msg: ServerMessage) =>
  liveReducer(state, { type: 'server', msg });

describe('liveReducer', () => {
  it('construye una respuesta en streaming y la cierra', () => {
    let s = initialLiveState;
    s = server(s, {
      type: 'answer.start',
      messageId: 'a1',
      kind: 'SCREENSHOT',
      detectedQuestion: 'Quiz (ejemplo.com)',
      createdAt: new Date().toISOString(),
      model: 'fake-fast',
    });
    s = server(s, { type: 'answer.delta', messageId: 'a1', delta: '👁 **Veo:** ' });
    s = server(s, { type: 'answer.delta', messageId: 'a1', delta: 'un quiz' });
    expect(s.answers[0]).toMatchObject({
      id: 'a1',
      kind: 'SCREENSHOT',
      streaming: true,
      content: '👁 **Veo:** un quiz',
    });
    s = server(s, {
      type: 'answer.done',
      messageId: 'a1',
      content: '👁 **Veo:** un quiz',
      latencyMs: 900,
      firstTokenMs: 300,
      tokensIn: 10,
      tokensOut: 5,
      model: 'fake-fast',
      aborted: false,
    });
    expect(s.answers[0]).toMatchObject({ streaming: false, latencyMs: 900, firstTokenMs: 300 });
  });

  it('las respuestas más recientes quedan arriba y las fijadas sobreviven a Clear', () => {
    let s = initialLiveState;
    for (const id of ['a1', 'a2']) {
      s = server(s, {
        type: 'answer.start',
        messageId: id,
        kind: 'AUTO_ANSWER',
        detectedQuestion: null,
        createdAt: '',
        model: 'm',
      });
      s = server(s, { type: 'answer.delta', messageId: id, delta: id });
      s = server(s, {
        type: 'answer.done',
        messageId: id,
        content: id,
        latencyMs: 1,
        firstTokenMs: 1,
        tokensIn: 1,
        tokensOut: 1,
        model: 'm',
        aborted: false,
      });
    }
    expect(s.answers.map((a) => a.id)).toEqual(['a2', 'a1']);
    s = liveReducer(s, { type: 'pin', messageId: 'a1' });
    s = liveReducer(s, { type: 'clear' });
    expect(s.answers.map((a) => a.id)).toEqual(['a1']);
  });

  it('reset limpia la sesión pero conserva el estado de la conexión', () => {
    let s = liveReducer(initialLiveState, { type: 'status', status: 'open', attempt: 0 });
    s = server(s, {
      type: 'transcript.final',
      segment: { id: 't1', speaker: 'THEM', text: 'hola', startMs: 0, endMs: 1000 },
    });
    s = liveReducer(s, { type: 'reset' });
    expect(s.segments).toHaveLength(0);
    expect(s.connection).toBe('open');
  });

  it('acumula avisos del servidor y permite descartarlos', () => {
    let s = server(initialLiveState, {
      type: 'error',
      code: 'llm_notice',
      message: 'Usando simulador',
      fatal: false,
    });
    expect(s.notices).toHaveLength(1);
    s = liveReducer(s, { type: 'dismiss', id: s.notices[0]!.id });
    expect(s.notices).toHaveLength(0);
  });
});
