// Cliente WebSocket del servidor realtime con reconexión automática (backoff) y heartbeat.
import {
  encodeAudioFrame,
  parseServerMessage,
  type AudioChannel,
  type ClientMessage,
  type ServerMessage,
} from '@callpilot/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface LiveClientHandlers {
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: ConnectionStatus, attempt: number) => void;
}

const HEARTBEAT_MS = 15_000;
const MAX_BACKOFF_MS = 15_000;

export class LiveClient {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private attempt = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly sessionId: string,
    private readonly handlers: LiveClientHandlers,
  ) {}

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting', this.attempt);
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.handlers.onStatus('open', 0);
      this.send({ type: 'session.join', sessionId: this.sessionId });
      this.heartbeat = setInterval(
        () => this.send({ type: 'heartbeat', clientTs: Date.now() }),
        HEARTBEAT_MS,
      );
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      const msg = parseServerMessage(ev.data);
      if (msg) this.handlers.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.ws = null;
      if (this.closedByUser) {
        this.handlers.onStatus('closed', 0);
        return;
      }
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
      this.attempt++;
      this.handlers.onStatus('reconnecting', this.attempt);
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => {
      /* onclose se encarga de reconectar */
    };
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): void {
    if (!this.isOpen) return;
    this.ws!.send(JSON.stringify(msg));
  }

  sendAudio(channel: AudioChannel, pcm: Int16Array): void {
    if (!this.isOpen) return;
    const frame = encodeAudioFrame(channel, pcm);
    this.ws!.send(frame);
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.ws?.close();
    this.ws = null;
  }
}
