import { describe, expect, it } from 'vitest';
import { renderLevel1Markdown, runLevel1 } from '../level1';

describe('nivel 1', () => {
  const result = runLevel1();

  it('devuelve métricas coherentes', () => {
    for (const m of [
      result.isQuestion.global,
      result.needsAnswer.global,
      result.needsAnswer.byLang.es,
      result.needsAnswer.byLang.en,
    ]) {
      expect(m.precision).toBeGreaterThanOrEqual(0);
      expect(m.precision).toBeLessThanOrEqual(1);
      expect(m.recall).toBeGreaterThanOrEqual(0);
      expect(m.recall).toBeLessThanOrEqual(1);
      expect(m.f1).toBeLessThanOrEqual(1);
      expect(m.tp + m.fp + m.fn + m.tn).toBeGreaterThan(0);
    }
    expect(
      result.needsAnswer.global.tp +
        result.needsAnswer.global.fp +
        result.needsAnswer.global.fn +
        result.needsAnswer.global.tn,
    ).toBe(result.total);
    expect(result.byLang.es + result.byLang.en).toBe(result.total);
    const matrixSum = result.typeConfusion.matrix.flat().reduce((a, b) => a + b, 0);
    expect(matrixSum).toBe(result.typeConfusion.total);
    expect(result.smalltalk.rate).toBeLessThanOrEqual(1);
  });

  it('cumple los umbrales objetivo con la heurística actual', () => {
    expect(result.checks.filter((c) => !c.ok).map((c) => `${c.name}=${c.value}`)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('renderiza Markdown con las secciones clave', () => {
    const md = renderLevel1Markdown(result);
    expect(md).toContain('# Backtesting nivel 1');
    expect(md).toContain('## Umbrales');
    expect(md).toContain('needsAnswer');
    expect(md).toContain('## Tipo de pregunta');
    expect(md).toContain('## Fallos');
  });
});
