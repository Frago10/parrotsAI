import { describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../fake';
import { resolveProviderForModel } from '../registry';
import { extractJson } from '../types';

describe('FakeLlmProvider', () => {
  const fake = new FakeLlmProvider({ chunkDelayMs: 0 });
  it('genera una respuesta con el formato obligatorio', async () => {
    const r = await fake.complete({
      model: 'fake-fast',
      system: 'Always answer in Spanish.',
      messages: [
        {
          role: 'user',
          content:
            '## Detected question (behavioral)\n¿Por qué quieres este puesto?\n\nDraft the answer.',
        },
      ],
      maxTokens: 500,
      purpose: 'answer',
    });
    expect(r.text).toContain('💬 **Pregunta:**');
    expect(r.text).toContain('⭐ **Respuesta:**');
    expect(r.usage.outputTokens).toBeGreaterThan(0);
  });
  it('clasifica con JSON válido', async () => {
    const r = await fake.complete({
      model: 'fake-fast',
      system: 'x',
      messages: [
        {
          role: 'user',
          content:
            'Recent THEM transcript:\nhola\n\nLast segment:\n¿Cómo escalarías la base de datos?\n\nJSON:',
        },
      ],
      maxTokens: 200,
      purpose: 'classify',
      json: true,
    });
    const json = extractJson<{ needsAnswer: boolean; type: string }>(r.text)!;
    expect(json.needsAnswer).toBe(true);
    expect(json.type).toBe('technical');
  });
  it('se puede abortar', async () => {
    const slow = new FakeLlmProvider({ chunkDelayMs: 50 });
    const ac = new AbortController();
    const it = slow.stream(
      {
        model: 'fake-fast',
        system: 's',
        messages: [{ role: 'user', content: 'q' }],
        maxTokens: 10,
        purpose: 'answer',
      },
      { signal: ac.signal },
    );
    const iterator = it[Symbol.asyncIterator]();
    await iterator.next();
    ac.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('resolveProviderForModel', () => {
  it('degrada al simulador si falta la clave', () => {
    const r = resolveProviderForModel('claude-haiku-4-5', {});
    expect(r.provider.id).toBe('fake');
    expect(r.notice).toContain('ANTHROPIC_API_KEY');
  });
  it('migra modelos retirados', () => {
    const r = resolveProviderForModel('claude-sonnet-4-5', { ANTHROPIC_API_KEY: 'x' });
    expect(r.modelId).toBe('claude-sonnet-5-5');
    expect(r.notice).toContain('retirado');
  });
});

describe('FakeLlmProvider: lector de pantalla', () => {
  const fake = new FakeLlmProvider({ chunkDelayMs: 0 });
  it('recibe texto + imagen y detecta preguntas visibles', async () => {
    const r = await fake.complete({
      model: 'fake-fast',
      system: 'Always answer in Spanish.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', mediaType: 'image/jpeg', data: 'AAAA' },
            {
              type: 'text',
              text: '## Page\nURL: https://ejemplo.com/quiz\nTitle: Quiz de SQL\n\n## Visible text (extracted from the DOM, in reading order)\nQuiz de SQL\n¿Cuál es la diferencia entre INNER JOIN y LEFT JOIN?\nSelecciona una opción\n\nA screenshot of the visible area is attached.\n\nNo explicit request: detect what the USER needs on this screen and help.',
            },
          ],
        },
      ],
      maxTokens: 500,
      purpose: 'screen',
    });
    expect(r.text).toContain('Quiz de SQL');
    expect(r.text).toContain('captura: sí');
    expect(r.text).toContain('INNER JOIN y LEFT JOIN');
  });
});
