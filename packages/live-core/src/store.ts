// Store sin framework para clientes que no usan React (la extensión): une LiveClient y el reducer.
import type { AudioChannel, ClientMessage } from '@callpilot/shared';
import { LiveClient } from './client';
import { initialLiveState, liveReducer, type LiveAction, type LiveState } from './state';

export class LiveStore {
  state: LiveState = initialLiveState;
  private listeners = new Set<(s: LiveState) => void>();
  private client: LiveClient | null = null;

  subscribe(fn: (s: LiveState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispatch(action: LiveAction): void {
    this.state = liveReducer(this.state, action);
    for (const fn of this.listeners) fn(this.state);
  }

  connect(wsUrl: string, sessionId: string): void {
    this.disconnect();
    this.dispatch({ type: 'reset' });
    this.client = new LiveClient(wsUrl, sessionId, {
      onMessage: (msg) => this.dispatch({ type: 'server', msg }),
      onStatus: (status, attempt) => this.dispatch({ type: 'status', status, attempt }),
    });
    this.client.connect();
  }

  disconnect(): void {
    this.client?.close();
    this.client = null;
  }

  get connected(): boolean {
    return this.client?.isOpen ?? false;
  }

  send(msg: ClientMessage): void {
    this.client?.send(msg);
  }

  sendAudio(channel: AudioChannel, pcm: Int16Array): void {
    this.client?.sendAudio(channel, pcm);
  }

  feedback(messageId: string, value: 'up' | 'down'): void {
    this.dispatch({ type: 'feedback', messageId, value });
    this.send({ type: 'feedback', messageId, value });
  }

  pin(messageId: string): void {
    this.dispatch({ type: 'pin', messageId });
  }

  dismiss(id: number): void {
    this.dispatch({ type: 'dismiss', id });
  }
}
