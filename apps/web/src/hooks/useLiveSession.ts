'use client';

// Hook de React sobre el estado compartido de live-core: reduce los mensajes del servidor a estado de UI.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { AudioChannel, ClientMessage } from '@callpilot/shared';
import { initialLiveState, LiveClient, liveReducer } from '@callpilot/live-core';

export type { LiveState, UiAnswer, UiSegment } from '@callpilot/live-core';

export function useLiveSession(wsUrl: string, sessionId: string) {
  const [state, dispatch] = useReducer(liveReducer, initialLiveState);
  const clientRef = useRef<LiveClient | null>(null);

  useEffect(() => {
    const client = new LiveClient(wsUrl, sessionId, {
      onMessage: (msg) => dispatch({ type: 'server', msg }),
      onStatus: (status, attempt) => dispatch({ type: 'status', status, attempt }),
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [wsUrl, sessionId]);

  const send = useCallback((msg: ClientMessage) => clientRef.current?.send(msg), []);
  const sendAudio = useCallback(
    (channel: AudioChannel, pcm: Int16Array) => clientRef.current?.sendAudio(channel, pcm),
    [],
  );
  const feedback = useCallback((messageId: string, value: 'up' | 'down') => {
    dispatch({ type: 'feedback', messageId, value });
    clientRef.current?.send({ type: 'feedback', messageId, value });
  }, []);
  const pin = useCallback((messageId: string) => dispatch({ type: 'pin', messageId }), []);
  const dismiss = useCallback((id: number) => dispatch({ type: 'dismiss', id }), []);

  return { state, send, sendAudio, feedback, pin, dismiss };
}
