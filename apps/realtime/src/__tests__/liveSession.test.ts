import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { resolveProviderForModel } from '@callpilot/ai';
import { encodeAudioFrame, type ServerMessage } from '@callpilot/shared';
import { loadConfig } from '../config';
import type { LoadedSession } from '../session/context';
import { LiveSession } from '../session/liveSession';
import { MemorySessionLog } from '../session/sessionLog';
import { FakeSttProvider } from '../stt/fake';

function fakeSession(): LoadedSession {
  return {
    id: 'test-session',
    userId: 'u1',
    company: 'Acme',
    title: 'Demo',
    mode: 'REGULAR',
    language: 'es',
    model: 'fake-fast',
    autoAnswer: true,
    saveTranscript: true,
    saveForEval: false,
    state: 'READY',
    startedAt: null,
    durationSeconds: 0,
    keyterms: ['Acme'],
    remainingSeconds: null,
    context: {
      mode: 'REGULAR',
      language: 'es',
      company: 'Acme',
      title: 'Demo',
      description: null,
      instructions: 'Reunión comercial.',
      resumeText: null,
      documentSnippets: [],
    },
  };
}

async function waitFor(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout esperando condición');
    await new Promise((r) => setTimeout(r, 20));
  }
}

function setup() {
  const sent: ServerMessage[] = [];
  const log = new MemorySessionLog();
  process.env.LLM_PROVIDER = 'fake';
  process.env.FAKE_LLM_CHUNK_DELAY_MS = '0';
  process.env.FAKE_LLM_FIRST_TOKEN_MS = '0';
  const config = { ...loadConfig(), answerDebounceMs: 50, utteranceEndFallbackMs: 200 };
  const session = new LiveSession({
    prisma: null,
    stt: new FakeSttProvider({ utteranceEndDelayMs: 10 }),
    resolveLlm: (m) => resolveProviderForModel(m, { LLM_PROVIDER: 'fake' }),
    config,
    createLog: () => log,
    send: (m) => sent.push(m),
    logger: pino({ level: 'silent' }),
    loadSessionOverride: async () => fakeSession(),
  });
  return { session, sent, log };
}

describe('LiveSession (proveedores simulados)', () => {
  it('flujo completo: join -> transcripción -> pregunta -> respuesta -> end', async () => {
    const { session, sent, log } = setup();
    await session.handleText(JSON.stringify({ type: 'session.join', sessionId: 'test-session' }));
    expect(sent.find((m) => m.type === 'session.state')).toMatchObject({ state: 'LIVE', sttProvider: 'fake', llmProvider: 'fake' });

    session.handleBinary(encodeAudioFrame('them', new Int16Array(320)));
    await session.handleText(JSON.stringify({ type: 'debug.transcript', channel: 'them', text: 'Hola, ¿me escuchas?', isFinal: true }));
    await session.handleText(
      JSON.stringify({ type: 'debug.transcript', channel: 'them', text: '¿Cuánto tiempo tardarían en implementar el dashboard?', isFinal: true }),
    );
    await waitFor(() => sent.some((m) => m.type === 'answer.done'));

    const finals = sent.filter((m) => m.type === 'transcript.final');
    expect(finals).toHaveLength(2);
    const questions = sent.filter((m) => m.type === 'question.detected');
    expect(questions.some((q) => q.type === 'question.detected' && q.needsAnswer)).toBe(true);
    const done = sent.find((m) => m.type === 'answer.done');
    expect(done && done.type === 'answer.done' && done.content).toContain('⭐ **Respuesta:**');
    expect(sent.filter((m) => m.type === 'answer.delta').length).toBeGreaterThan(3);

    await session.handleText(JSON.stringify({ type: 'chat.send', text: 'hazlo más corto' }));
    await waitFor(() => sent.filter((m) => m.type === 'answer.done').length >= 2);
    expect(sent.some((m) => m.type === 'chat.user')).toBe(true);

    await session.handleText(JSON.stringify({ type: 'session.end' }));
    const last = [...sent].reverse().find((m) => m.type === 'session.state');
    expect(last).toMatchObject({ state: 'ENDED' });
    const evs = log.events.map((e) => e.ev);
    expect(evs[0]).toBe('session.start');
    expect(evs).toContain('transcript.final');
    expect(evs).toContain('question.heuristic');
    expect(evs).toContain('answer.done');
    expect(evs).toContain('session.end');
  });

  it('el botón Answer fuerza respuesta aunque no haya pregunta', async () => {
    const { session, sent } = setup();
    await session.handleText(JSON.stringify({ type: 'session.join', sessionId: 'test-session' }));
    await session.handleText(JSON.stringify({ type: 'debug.transcript', channel: 'them', text: 'Hoy revisamos el roadmap del trimestre.', isFinal: true }));
    await session.handleText(JSON.stringify({ type: 'answer.request' }));
    await waitFor(() => sent.some((m) => m.type === 'answer.done'));
    const start = sent.find((m) => m.type === 'answer.start');
    expect(start).toMatchObject({ kind: 'MANUAL_ANSWER' });
    await session.handleText(JSON.stringify({ type: 'session.end' }));
  });

  it('no responde automáticamente con Auto Answer apagado', async () => {
    const { session, sent } = setup();
    await session.handleText(JSON.stringify({ type: 'session.join', sessionId: 'test-session' }));
    await session.handleText(JSON.stringify({ type: 'autoAnswer.set', enabled: false }));
    await session.handleText(JSON.stringify({ type: 'debug.transcript', channel: 'them', text: '¿Cómo funciona la integración con su CRM?', isFinal: true }));
    await waitFor(() => sent.some((m) => m.type === 'question.detected'));
    await new Promise((r) => setTimeout(r, 100));
    expect(sent.some((m) => m.type === 'answer.start')).toBe(false);
    await session.handleText(JSON.stringify({ type: 'session.end' }));
  });

  it('rechaza mensajes antes de join y sesiones inexistentes', async () => {
    const { session, sent } = setup();
    await session.handleText(JSON.stringify({ type: 'answer.request' }));
    expect(sent[0]).toMatchObject({ type: 'error', code: 'not_joined' });
  });
});
