// Ventana de transcripción reciente en memoria (ambos canales) para construir prompts.
import type { Speaker } from '@callpilot/shared';

export interface WindowSegment {
  id: string;
  speaker: Speaker;
  text: string;
  startMs: number;
  endMs: number;
}

export class TranscriptWindow {
  private segments: WindowSegment[] = [];
  constructor(
    private readonly maxAgeMs: number,
    private readonly maxSegments = 400,
  ) {}

  push(seg: WindowSegment): void {
    this.segments.push(seg);
    if (this.segments.length > this.maxSegments)
      this.segments.splice(0, this.segments.length - this.maxSegments);
  }

  /** Segmentos cuyo fin está dentro de la ventana respecto a `nowMs`. */
  recent(nowMs: number, maxAgeMs = this.maxAgeMs): WindowSegment[] {
    const from = nowMs - maxAgeMs;
    return this.segments.filter((s) => s.endMs >= from);
  }

  all(): WindowSegment[] {
    return [...this.segments];
  }

  /** "THEM: ...\nME: ..." uniendo segmentos consecutivos del mismo hablante. */
  static format(segments: WindowSegment[]): string {
    const lines: string[] = [];
    for (const s of segments) {
      const last = lines[lines.length - 1];
      const prefix = `${s.speaker}: `;
      if (last && last.startsWith(prefix)) lines[lines.length - 1] = `${last} ${s.text}`;
      else lines.push(`${prefix}${s.text}`);
    }
    return lines.join('\n');
  }

  formatRecent(nowMs: number, maxAgeMs?: number): string {
    return TranscriptWindow.format(this.recent(nowMs, maxAgeMs));
  }

  /** Últimos N ms del canal THEM, para el clasificador. */
  recentThem(nowMs: number, maxAgeMs = 30_000): WindowSegment[] {
    return this.recent(nowMs, maxAgeMs).filter((s) => s.speaker === 'THEM');
  }
}
