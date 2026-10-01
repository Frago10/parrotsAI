import { describe, expect, it } from 'vitest';
import { loadDataset, QUESTION_TYPES } from '../dataset';

describe('dataset questions.v1.json', () => {
  const items = loadDataset();

  it('tiene al menos 120 ítems, 60 por idioma', () => {
    expect(items.length).toBeGreaterThanOrEqual(120);
    expect(items.filter((i) => i.lang === 'es').length).toBeGreaterThanOrEqual(60);
    expect(items.filter((i) => i.lang === 'en').length).toBeGreaterThanOrEqual(60);
  });

  it('tiene ids únicos', () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('cubre todos los tipos en ambos idiomas', () => {
    for (const lang of ['es', 'en'] as const) {
      const types = new Set(items.filter((i) => i.lang === lang).map((i) => i.type));
      for (const t of QUESTION_TYPES) expect(types.has(t), `${lang} sin tipo ${t}`).toBe(true);
    }
  });

  it('incluye smalltalk que no necesita respuesta y afirmaciones que no son preguntas', () => {
    expect(items.some((i) => i.type === 'smalltalk' && i.isQuestion && !i.needsAnswer)).toBe(true);
    expect(items.some((i) => i.type === 'other' && !i.isQuestion)).toBe(true);
  });
});
