// Escritor JSONL de eventos de sesión (base del backtesting). Append asíncrono con cola.
import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { SessionLogEvent } from '@callpilot/shared';

export interface SessionLogSink {
  write(ev: SessionLogEvent): void;
  flush(): Promise<void>;
}

export class FileSessionLog implements SessionLogSink {
  private queue: string[] = [];
  private flushing: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(dir: string, sessionId: string) {
    this.file = path.join(dir, `${sessionId}.jsonl`);
    this.flushing = mkdir(dir, { recursive: true }).then(() => undefined);
  }

  write(ev: SessionLogEvent): void {
    this.queue.push(JSON.stringify(ev));
    this.flushing = this.flushing.then(() => this.drain());
  }

  private async drain(): Promise<void> {
    if (!this.queue.length) return;
    const lines = this.queue.splice(0).join('\n') + '\n';
    await appendFile(this.file, lines, 'utf8');
  }

  flush(): Promise<void> {
    return this.flushing;
  }
}

export class MemorySessionLog implements SessionLogSink {
  readonly events: SessionLogEvent[] = [];
  write(ev: SessionLogEvent): void {
    this.events.push(ev);
  }
  async flush(): Promise<void> {}
}
