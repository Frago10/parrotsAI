'use client';

// Estado de la sesión en vivo en el navegador: reduce los mensajes del servidor a un estado de UI.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  AudioChannel,
  ClientMessage,
  QuestionType,
  ServerMessage,
  Speaker,
} from '@callpilot/shared';
import { LiveClient, type ConnectionStatus } from '@/lib/live/client';

export interface UiSegment {
  id: string;
  speaker: Speaker;
  text: string;
  startMs: number;
  endMs: number;
}

export interface UiAnswer {
  id: string;
  kind: 'AUTO_ANSWER' | 'MANUAL_ANSWER' | 'SCREENSHOT' | 'CHAT_USER' | 'CHAT_AI';
  question: string | null;
  content: string;
  streaming: boolean;
  createdAt: string;
  sessionMs: number;
  latencyMs: number | null;
  firstTokenMs: number | null;
  model: string | null;
  feedback: 'up' | 'down' | null;
  pinned: boolean;
  error: string | null;
}

export interface LiveState {
  connection: ConnectionStatus;
  reconnectAttempt: number;
  state: 'CONNECTING' | 'LIVE' | 'PAUSED' | 'ENDED';
  elapsedMs: number;
  elapsedAt: number;
  autoAnswer: boolean;
  language: string;
  model: string;
  sttProvider: string;
  llmProvider: string;
  remainingSeconds: number | null;
  segments: UiSegment[];
  partials: Partial<Record<Speaker, string>>;
  answers: UiAnswer[];
  lastQuestion: {
    question: string;
    qtype: QuestionType;
    needsAnswer: boolean;
    source: string;
  } | null;
  notices: Array<{ id: number; code: string; message: string; fatal: boolean }>;
  metrics: {
    sttPartialLatencyMs: number | null;
    sttFinalLatencyMs: number | null;
    lastFirstTokenMs: number | null;
    audioFramesMe: number;
    audioFramesThem: number;
  } | null;
  limitWarning: number | null;
}

type Action =
  | { type: 'status'; status: ConnectionStatus; attempt: number }
  | { type: 'server'; msg: ServerMessage }
  | { type: 'feedback'; messageId: string; value: 'up' | 'down' }
  | { type: 'pin'; messageId: string }
  | { type: 'dismiss'; id: number }
  | { type: 'clear' };

const initial: LiveState = {
  connection: 'connecting',
  reconnectAttempt: 0,
  state: 'CONNECTING',
  elapsedMs: 0,
  elapsedAt: Date.now(),
  autoAnswer: true,
  language: 'es',
  model: '',
  sttProvider: '',
  llmProvider: '',
  remainingSeconds: null,
  segments: [],
  partials: {},
  answers: [],
  lastQuestion: null,
  notices: [],
  metrics: null,
  limitWarning: null,
};

let noticeSeq = 1;

function reducer(state: LiveState, action: Action): LiveState {
  switch (action.type) {
    case 'status':
      return { ...state, connection: action.status, reconnectAttempt: action.attempt };
    case 'clear':
      return { ...state, answers: state.answers.filter((a) => a.pinned) };
    case 'dismiss':
      return { ...state, notices: state.notices.filter((n) => n.id !== action.id) };
    case 'feedback':
      return {
        ...state,
        answers: state.answers.map((a) =>
          a.id === action.messageId ? { ...a, feedback: action.value } : a,
        ),
      };
    case 'pin':
      return {
        ...state,
        answers: state.answers.map((a) =>
          a.id === action.messageId ? { ...a, pinned: !a.pinned } : a,
        ),
      };
    case 'server': {
      const m = action.msg;
      switch (m.type) {
        case 'session.state':
          return {
            ...state,
            state: m.state,
            elapsedMs: m.elapsedMs,
            elapsedAt: Date.now(),
            autoAnswer: m.autoAnswer,
            language: m.language,
            model: m.model,
            sttProvider: m.sttProvider,
            llmProvider: m.llmProvider,
            remainingSeconds: m.remainingSeconds,
          };
        case 'transcript.partial':
          return { ...state, partials: { ...state.partials, [m.speaker]: m.text } };
        case 'transcript.final': {
          const partials = { ...state.partials };
          delete partials[m.segment.speaker];
          return { ...state, partials, segments: [...state.segments, m.segment] };
        }
        case 'question.detected':
          return {
            ...state,
            lastQuestion: {
              question: m.question,
              qtype: m.qtype,
              needsAnswer: m.needsAnswer,
              source: m.source,
            },
          };
        case 'answer.start':
          return {
            ...state,
            answers: [
              {
                id: m.messageId,
                kind: m.kind,
                question: m.detectedQuestion,
                content: '',
                streaming: true,
                createdAt: m.createdAt,
                sessionMs: state.elapsedMs + (Date.now() - state.elapsedAt),
                latencyMs: null,
                firstTokenMs: null,
                model: m.model,
                feedback: null,
                pinned: false,
                error: null,
              },
              ...state.answers,
            ],
          };
        case 'answer.delta':
          return {
            ...state,
            answers: state.answers.map((a) =>
              a.id === m.messageId ? { ...a, content: a.content + m.delta } : a,
            ),
          };
        case 'answer.done':
          return {
            ...state,
            answers: state.answers
              .map((a) =>
                a.id === m.messageId
                  ? {
                      ...a,
                      content: m.content || a.content,
                      streaming: false,
                      latencyMs: m.latencyMs,
                      firstTokenMs: m.firstTokenMs,
                      model: m.model,
                    }
                  : a,
              )
              .filter((a) => a.content.trim() || a.streaming),
          };
        case 'answer.error':
          return {
            ...state,
            answers: state.answers.map((a) =>
              a.id === m.messageId ? { ...a, streaming: false, error: m.message } : a,
            ),
          };
        case 'chat.user':
          return {
            ...state,
            answers: [
              {
                id: m.messageId,
                kind: 'CHAT_USER',
                question: null,
                content: m.text,
                streaming: false,
                createdAt: m.createdAt,
                sessionMs: state.elapsedMs + (Date.now() - state.elapsedAt),
                latencyMs: null,
                firstTokenMs: null,
                model: null,
                feedback: null,
                pinned: false,
                error: null,
              },
              ...state.answers,
            ],
          };
        case 'panel.cleared':
          return { ...state, answers: state.answers.filter((a) => a.pinned) };
        case 'metrics':
          return {
            ...state,
            metrics: {
              sttPartialLatencyMs: m.sttPartialLatencyMs,
              sttFinalLatencyMs: m.sttFinalLatencyMs,
              lastFirstTokenMs: m.lastFirstTokenMs,
              audioFramesMe: m.audioFramesMe,
              audioFramesThem: m.audioFramesThem,
            },
          };
        case 'limit.warning':
          return { ...state, limitWarning: m.remainingSeconds };
        case 'error':
          return {
            ...state,
            notices: [
              ...state.notices,
              { id: noticeSeq++, code: m.code, message: m.message, fatal: m.fatal },
            ],
          };
        case 'heartbeat.ack':
          return state;
      }
      return state;
    }
  }
}

export function useLiveSession(wsUrl: string, sessionId: string) {
  const [state, dispatch] = useReducer(reducer, initial);
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
