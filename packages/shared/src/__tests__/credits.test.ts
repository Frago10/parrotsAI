import { describe, expect, it } from 'vitest';
import { creditsForSeconds, formatClock, formatDuration } from '../credits';

describe('créditos', () => {
  it('prorratea por minuto con 1 decimal', () => {
    expect(creditsForSeconds(28 * 60 + 12)).toBe(0.5);
    expect(creditsForSeconds(59 * 60)).toBe(1);
    expect(creditsForSeconds(3600)).toBe(1);
    expect(creditsForSeconds(0)).toBe(0);
    expect(creditsForSeconds(5 * 60)).toBe(0.1);
  });
  it('formatea duraciones', () => {
    expect(formatDuration(28 * 60 + 12)).toBe('28 mins 12 secs');
    expect(formatDuration(3725)).toBe('1 hr 2 mins 5 secs');
    expect(formatDuration(null)).toBe('—');
    expect(formatClock(9 * 60 * 1000 + 14_000)).toBe('09:14');
  });
});
