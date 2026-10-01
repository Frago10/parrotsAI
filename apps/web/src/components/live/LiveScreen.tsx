'use client';

// Pantalla de sesión en vivo: consentimiento, captura de audio, transcripción y respuestas.
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatClock, LANGUAGES } from '@callpilot/shared';
import type { AudioChannel } from '@callpilot/shared';
import { AnswerCard } from '@/components/live/AnswerCard';
import { useLiveSession } from '@/hooks/useLiveSession';
import { AudioCapture, isTabAudioSupported, NoAudioTrackError } from '@/lib/audio/capture';

interface SessionInfo {
  id: string;
  company: string;
  title: string;
  mode: string;
  language: string;
  autoAnswer: boolean;
  state: string;
}

type Phase = 'consent' | 'starting' | 'running';

export function LiveScreen({
  wsUrl,
  session,
  locale,
}: {
  wsUrl: string;
  session: SessionInfo;
  locale: string;
}) {
  const t = useTranslations('live');
  const router = useRouter();
  const { state, send, sendAudio, feedback, pin, dismiss } = useLiveSession(wsUrl, session.id);
  const [phase, setPhase] = useState<Phase>('consent');
  const [consent, setConsent] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<AudioChannel, number>>({ me: 0, them: 0 });
  const [chat, setChat] = useState('');
  const [debugText, setDebugText] = useState('');
  const [showDebug, setShowDebug] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [compact, setCompact] = useState(false);
  const [split, setSplit] = useState(42);
  const [tab, setTab] = useState<'transcript' | 'answers'>('answers');
  const [clock, setClock] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const captureRef = useRef<AudioCapture | null>(null);
  const chatRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const supported = useMemo(
    () => (typeof window === 'undefined' ? true : isTabAudioSupported()),
    [],
  );

  // Reloj local sincronizado con el servidor.
  useEffect(() => {
    const id = setInterval(
      () => setClock(state.elapsedMs + (state.state === 'LIVE' ? Date.now() - state.elapsedAt : 0)),
      500,
    );
    return () => clearInterval(id);
  }, [state.elapsedMs, state.elapsedAt, state.state]);

  // Auto-scroll de la transcripción con pausa si el usuario sube.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [state.segments, state.partials, autoScroll]);

  // Al terminar, ir a la vista post-llamada.
  useEffect(() => {
    if (state.state === 'ENDED') {
      captureRef.current?.stop();
      const id = setTimeout(() => router.push(`/sessions/${session.id}`), 800);
      return () => clearTimeout(id);
    }
  }, [state.state, router, session.id]);

  const getCapture = useCallback(() => {
    if (!captureRef.current) {
      captureRef.current = new AudioCapture({
        onChunk: (channel, pcm) => sendAudio(channel, pcm),
        onLevel: (channel, level) => setLevels((l) => ({ ...l, [channel]: level })),
        onTabEnded: () => setCaptureError(t('noAudio')),
      });
    }
    return captureRef.current;
  }, [sendAudio, t]);

  async function startWithCapture() {
    setPhase('starting');
    setCaptureError(null);
    const cap = getCapture();
    try {
      await cap.startTab();
      try {
        await cap.startMic();
      } catch {
        /* sin micrófono: solo se transcribe a la otra parte */
      }
      setPhase('running');
    } catch (err) {
      setPhase('consent');
      setCaptureError(
        err instanceof NoAudioTrackError
          ? t('noAudio')
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
  }

  function startDebug() {
    setPhase('running');
    setShowDebug(true);
  }

  async function changeTab() {
    setCaptureError(null);
    try {
      await getCapture().changeTab();
    } catch (err) {
      setCaptureError(
        err instanceof NoAudioTrackError
          ? t('noAudio')
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
  }

  function endSession() {
    if (!confirm(t('confirmEnd'))) return;
    send({ type: 'session.end' });
  }

  function sendChat() {
    const text = chat.trim();
    if (!text) return;
    send({ type: 'chat.send', text });
    setChat('');
  }

  function inject(channel: AudioChannel) {
    const text = debugText.trim();
    if (!text) return;
    send({ type: 'debug.transcript', channel, text, isFinal: true });
    setDebugText('');
  }

  // Atajos de teclado.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        send({ type: 'answer.request' });
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        chatRef.current?.focus();
      } else if (e.key === 'Escape') {
        send({ type: 'panel.clear' });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void screenshot();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send]);

  async function screenshot() {
    const blob = await captureRef.current?.grabFrame();
    if (!blob) {
      setCaptureError(
        locale === 'en' ? 'No shared tab to capture.' : 'No hay pestaña compartida para capturar.',
      );
      return;
    }
    // Fase 6: el análisis con visión se conecta aquí; por ahora se descarga la captura.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screenshot-${Date.now()}.webp`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statusLabel =
    state.state === 'ENDED'
      ? t('ended')
      : state.state === 'PAUSED'
        ? t('paused')
        : state.connection === 'open'
          ? t('listening')
          : t('connecting');
  const answersVisible = state.answers;

  // ---------- Consentimiento ----------
  if (phase !== 'running') {
    return (
      <div className="mx-auto max-w-xl pt-10">
        <div className="card space-y-4 p-6">
          <h1 className="text-xl font-semibold">{t('consentTitle')}</h1>
          <div className="text-sm text-muted">
            {session.company} · {session.title}
          </div>
          <p className="text-sm">{t('consentText')}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{' '}
            {t('consentCheck')}
          </label>
          <p className="text-xs text-muted">{t('howTo')}</p>
          {!supported && (
            <div className="rounded-md border border-danger p-2 text-xs text-danger">
              {t('unsupported')}
            </div>
          )}
          {captureError && (
            <div className="rounded-md border border-danger p-2 text-xs text-danger">
              {captureError}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-primary"
              disabled={!consent || !supported || phase === 'starting'}
              onClick={startWithCapture}
            >
              {t('startCapture')}
            </button>
            <button className="btn" disabled={!consent} onClick={startDebug}>
              {t('startDebug')}
            </button>
          </div>
          <div className="text-xs text-muted">
            {state.connection === 'open' ? '● ' : '○ '}
            {state.connection} · STT: {state.sttProvider || '…'} · LLM: {state.llmProvider || '…'}
          </div>
        </div>
      </div>
    );
  }

  // ---------- Pantalla principal ----------
  return (
    <div
      className="flex h-[calc(100vh-2rem)] flex-col md:h-[calc(100vh-4rem)]"
      style={{ fontSize }}
    >
      {/* Barra superior */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <button className="btn" onClick={() => document.documentElement.requestFullscreen?.()}>
          ⛶ {t('fullscreen')}
        </button>
        <button className="btn" onClick={changeTab} disabled={!captureRef.current}>
          {t('changeTab')}
        </button>
        {state.state === 'PAUSED' ? (
          <button className="btn" onClick={() => send({ type: 'session.resume' })}>
            ▶ {t('resume')}
          </button>
        ) : (
          <button className="btn" onClick={() => send({ type: 'session.pause' })}>
            ⏸ {t('stop')}
          </button>
        )}
        <button className="btn" onClick={() => send({ type: 'panel.clear' })}>
          {t('clear')}
        </button>
        <select
          className="input w-auto"
          value={state.language}
          onChange={(e) => send({ type: 'language.set', language: e.target.value })}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName}
            </option>
          ))}
        </select>
        <span className="flex items-center gap-2 rounded-md border border-border bg-panel px-2 py-1">
          <span
            className={`inline-block h-2 w-2 rounded-full ${state.state === 'LIVE' && state.connection === 'open' ? 'pulse-dot bg-success' : 'bg-muted'}`}
          />
          {statusLabel}
        </span>
        <span className="font-mono">{formatClock(clock)}</span>
        {state.remainingSeconds != null && (
          <span className="text-xs text-muted">
            ⏳ {formatRemaining(state.remainingSeconds)}
          </span>
        )}
        <VuMeter label={t('them')} level={levels.them} />
        <VuMeter label={t('you')} level={levels.me} />
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={state.autoAnswer}
              onChange={(e) => send({ type: 'autoAnswer.set', enabled: e.target.checked })}
            />
            {state.autoAnswer ? t('autoAnswerOn') : t('autoAnswerOff')}
          </label>
          <button
            className="btn"
            onClick={() => setFontSize((f) => Math.max(11, f - 1))}
            title={t('fontSize')}
          >
            A-
          </button>
          <button
            className="btn"
            onClick={() => setFontSize((f) => Math.min(22, f + 1))}
            title={t('fontSize')}
          >
            A+
          </button>
          <button
            className={`btn ${compact ? 'border-accent' : ''}`}
            onClick={() => setCompact((c) => !c)}
          >
            {t('compact')}
          </button>
          <button
            className={`btn ${showDebug ? 'border-accent' : ''}`}
            onClick={() => setShowDebug((d) => !d)}
          >
            {t('debugPanel')}
          </button>
          <button className="btn btn-danger" onClick={endSession}>
            {t('end')}
          </button>
        </div>
      </div>

      {/* Avisos */}
      {(captureError || state.limitWarning != null || state.notices.length > 0) && (
        <div className="mb-2 space-y-1 text-xs">
          {captureError && (
            <div className="rounded-md border border-danger bg-panel p-2 text-danger">
              {captureError}{' '}
              <button className="underline" onClick={changeTab}>
                {t('changeTab')}
              </button>
            </div>
          )}
          {state.limitWarning != null && (
            <div className="rounded-md border border-border bg-panel p-2">
              {t('limitWarning', { seconds: state.limitWarning })}
            </div>
          )}
          {state.notices.map((n) => (
            <div
              key={n.id}
              className={`flex justify-between rounded-md border bg-panel p-2 ${n.fatal ? 'border-danger text-danger' : 'border-border'}`}
            >
              <span>{n.message}</span>
              <button onClick={() => dismiss(n.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Tabs móviles */}
      <div className="mb-2 flex gap-1 md:hidden">
        <button
          className={`btn flex-1 ${tab === 'transcript' ? 'border-accent' : ''}`}
          onClick={() => setTab('transcript')}
        >
          {t('transcript')}
        </button>
        <button
          className={`btn flex-1 ${tab === 'answers' ? 'border-accent' : ''}`}
          onClick={() => setTab('answers')}
        >
          {t('answers')}
        </button>
      </div>

      {/* Paneles */}
      <div className="flex min-h-0 flex-1 gap-2">
        <div
          ref={transcriptRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
          className={`card min-h-0 flex-1 overflow-y-auto p-3 md:flex-none ${tab === 'transcript' ? '' : 'hidden md:block'}`}
          style={{ flexBasis: `${split}%` }}
        >
          {state.segments.length === 0 && !state.partials.THEM && !state.partials.ME && (
            <div className="text-sm text-muted">{t('emptyTranscript')}</div>
          )}
          {state.segments.map((s) => (
            <Bubble
              key={s.id}
              me={s.speaker === 'ME'}
              label={s.speaker === 'ME' ? t('you') : t('them')}
              text={s.text}
              time={formatClock(s.startMs)}
            />
          ))}
          {state.partials.THEM && (
            <Bubble me={false} label={t('them')} text={state.partials.THEM} time="" partial />
          )}
          {state.partials.ME && (
            <Bubble me label={t('you')} text={state.partials.ME} time="" partial />
          )}
        </div>
        <div
          className="hidden w-1 cursor-col-resize rounded bg-border hover:bg-accent md:block"
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startSplit = split;
            const total = (e.currentTarget.parentElement?.clientWidth ?? 1000) || 1000;
            const move = (ev: MouseEvent) =>
              setSplit(
                Math.min(70, Math.max(25, startSplit + ((ev.clientX - startX) / total) * 100)),
              );
            const up = () => {
              window.removeEventListener('mousemove', move);
              window.removeEventListener('mouseup', up);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
          }}
        />
        <div
          className={`flex min-h-0 flex-1 flex-col ${tab === 'answers' ? '' : 'hidden md:flex'}`}
        >
          {state.lastQuestion && (
            <div className="mb-2 rounded-md border border-border bg-panel px-3 py-1 text-xs text-muted">
              {t('question')}: <span className="text-text">{state.lastQuestion.question}</span> ·{' '}
              {state.lastQuestion.qtype}
              {!state.lastQuestion.needsAnswer && ' · (sin respuesta automática)'}
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {answersVisible.length === 0 && (
              <div className="card p-6 text-center text-sm text-muted">{t('emptyAnswers')}</div>
            )}
            {answersVisible.map((a) => (
              <AnswerCard
                key={a.id}
                answer={a}
                onFeedback={feedback}
                onPin={pin}
                compact={compact}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="btn btn-primary flex-1 md:flex-none"
              onClick={() => send({ type: 'answer.request' })}
            >
              ⚡ {t('answer')}
            </button>
            <button className="btn flex-1 md:flex-none" onClick={() => void screenshot()}>
              📷 {t('screenshot')}
            </button>
            <input
              ref={chatRef}
              className="input flex-[3]"
              placeholder={t('typeMessage')}
              value={chat}
              onChange={(e) => setChat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) sendChat();
              }}
            />
            <button className="btn" onClick={sendChat}>
              {t('send')}
            </button>
          </div>
          <div className="mt-1 text-[11px] text-muted">{t('shortcuts')}</div>
        </div>
      </div>

      {/* Panel de debug */}
      {showDebug && (
        <div className="card mt-2 flex flex-wrap items-center gap-2 p-2 text-xs">
          <span className="font-medium">{t('debugPanel')}:</span>
          <input
            className="input flex-1"
            value={debugText}
            onChange={(e) => setDebugText(e.target.value)}
            placeholder="¿Cómo manejas los plazos ajustados?"
            onKeyDown={(e) => {
              if (e.key === 'Enter') inject('them');
            }}
          />
          <button className="btn" onClick={() => inject('them')}>
            {t('injectThem')}
          </button>
          <button className="btn" onClick={() => inject('me')}>
            {t('injectMe')}
          </button>
          {state.metrics && (
            <span className="text-muted">
              STT parcial {state.metrics.sttPartialLatencyMs ?? '—'} ms · STT final{' '}
              {state.metrics.sttFinalLatencyMs ?? '—'} ms · 1er token{' '}
              {state.metrics.lastFirstTokenMs ?? '—'} ms · frames them/me{' '}
              {state.metrics.audioFramesThem}/{state.metrics.audioFramesMe} · ws {state.connection}
              {state.reconnectAttempt ? ` (#${state.reconnectAttempt})` : ''} · {state.model}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function formatRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : formatClock(seconds * 1000);
}

function Bubble({
  me,
  label,
  text,
  time,
  partial,
}: {
  me: boolean;
  label: string;
  text: string;
  time: string;
  partial?: boolean;
}) {
  return (
    <div className={`mb-2 flex ${me ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-1.5 ${me ? 'bg-accent-soft' : 'bg-bg'} ${partial ? 'text-muted' : ''}`}
      >
        <div className="text-[10px] uppercase text-muted">
          {label} {time}
        </div>
        <div>{text}</div>
      </div>
    </div>
  );
}

function VuMeter({ label, level }: { label: string; level: number }) {
  const pct = Math.min(100, Math.round(level * 400));
  return (
    <span className="flex items-center gap-1 text-xs text-muted" title={label}>
      {label}
      <span className="inline-block h-2 w-14 overflow-hidden rounded bg-border">
        <span className="block h-full bg-success transition-all" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
