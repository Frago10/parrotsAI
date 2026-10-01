// Sesión en vivo: una instancia por conexión WebSocket. Orquesta audio -> STT -> detección de
// preguntas -> respuestas, persiste en la base de datos y escribe el registro JSONL.
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@callpilot/db';
import {
  AUDIO_SAMPLE_RATE,
  creditsForSeconds,
  decodeAudioFrame,
  parseClientMessage,
  type AudioChannel,
  type ClientMessage,
  type ServerMessage,
  type SessionContext,
  type SessionLogEvent,
  type Speaker,
} from '@callpilot/shared';
import type { ProviderResolution } from '@callpilot/ai';
import type { Logger } from 'pino';
import type { RealtimeConfig } from '../config';
import type { SttProvider, SttStream } from '../stt/types';
import { Answerer, type AnswerJob } from './answerer';
import { loadSession, type LoadedSession } from './context';
import { generateNotes } from './notes';
import { QuestionPipeline, type DetectedQuestion } from './questionPipeline';
import type { SessionLogSink } from './sessionLog';
import { TranscriptWindow, type WindowSegment } from './transcriptWindow';

export interface LiveSessionDeps {
  prisma: PrismaClient | null;
  stt: SttProvider;
  resolveLlm: (modelId: string) => ProviderResolution;
  config: RealtimeConfig;
  createLog: (sessionId: string) => SessionLogSink;
  send: (msg: ServerMessage) => void;
  logger: Logger;
  /** Para tests: carga de sesión sin base de datos. */
  loadSessionOverride?: (sessionId: string) => Promise<LoadedSession | null>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Evento de registro sin los campos que añade la sesión. */
type LogInput = DistributiveOmit<SessionLogEvent, 't' | 'sessionId'>;

const SPEAKER_OF: Record<AudioChannel, Speaker> = { me: 'ME', them: 'THEM' };
const WARN_BEFORE_LIMIT_S = 120;

export class LiveSession {
  private session: LoadedSession | null = null;
  private llm: ProviderResolution | null = null;
  private log: SessionLogSink | null = null;
  private window!: TranscriptWindow;
  private pipeline: QuestionPipeline | null = null;
  private answerer: Answerer | null = null;
  private streams: Partial<Record<AudioChannel, SttStream>> = {};
  private streamOffsetMs: Partial<Record<AudioChannel, number>> = {};
  private audioFrames: Record<AudioChannel, number> = { me: 0, them: 0 };
  private baseMs = 0;
  private resumedAt: number | null = null;
  private paused = false;
  private ended = false;
  private closed = false;
  private lastDetected: DetectedQuestion | null = null;
  private previousAnswers: string[] = [];
  private lastHeartbeat = Date.now();
  private limitWarned = false;
  private tick: NodeJS.Timeout | null = null;
  private metrics = { sttPartial: null as number | null, sttFinal: null as number | null, firstToken: null as number | null };
  private autoAnswer = true;
  private language = 'es';
  private context!: SessionContext;

  constructor(private readonly deps: LiveSessionDeps) {}

  // ---------- Reloj de sesión ----------
  /** Milisegundos activos (sin pausas) desde el inicio real de la sesión. */
  elapsedMs(): number {
    return this.baseMs + (this.resumedAt != null && !this.paused ? Date.now() - this.resumedAt : 0);
  }

  private logEv(ev: LogInput): void {
    if (!this.session || !this.log) return;
    this.log.write({ ...ev, t: this.elapsedMs(), sessionId: this.session.id } as SessionLogEvent);
  }

  private send(msg: ServerMessage): void {
    if (this.closed) return;
    try {
      this.deps.send(msg);
    } catch (err) {
      this.deps.logger.warn({ err }, 'no se pudo enviar al cliente');
    }
  }

  private sendState(): void {
    if (!this.session) return;
    this.send({
      type: 'session.state',
      state: this.ended ? 'ENDED' : this.paused ? 'PAUSED' : 'LIVE',
      sessionId: this.session.id,
      startedAt: this.session.startedAt?.toISOString() ?? null,
      elapsedMs: this.elapsedMs(),
      autoAnswer: this.autoAnswer,
      language: this.language,
      model: this.llm?.modelId ?? this.session.model,
      sttProvider: this.deps.stt.id,
      llmProvider: this.llm?.provider.id ?? 'fake',
      remainingSeconds: this.remainingSeconds(),
    });
  }

  private remainingSeconds(): number | null {
    if (!this.session || this.session.remainingSeconds == null) return null;
    const usedSinceJoin = (this.elapsedMs() - this.session.durationSeconds * 1000) / 1000;
    return Math.max(0, Math.floor(this.session.remainingSeconds - usedSinceJoin));
  }

  // ---------- Entrada desde el socket ----------
  async handleText(raw: string): Promise<void> {
    const msg = parseClientMessage(raw);
    if (!msg) {
      this.send({ type: 'error', code: 'bad_message', message: 'Mensaje no válido', fatal: false });
      return;
    }
    if (msg.type === 'session.join') {
      await this.join(msg.sessionId);
      return;
    }
    if (!this.session) {
      this.send({ type: 'error', code: 'not_joined', message: 'Primero envía session.join', fatal: true });
      return;
    }
    if (this.ended && msg.type !== 'heartbeat') return;
    await this.dispatch(msg);
  }

  handleBinary(frame: Uint8Array): void {
    if (!this.session || this.ended || this.paused) return;
    const decoded = decodeAudioFrame(frame);
    if (!decoded) return;
    this.audioFrames[decoded.channel]++;
    const stream = this.streams[decoded.channel];
    if (stream) stream.send(decoded.pcm);
    else void this.openStream(decoded.channel).then((s) => s?.send(decoded.pcm));
  }

  private async dispatch(msg: Exclude<ClientMessage, { type: 'session.join' }>): Promise<void> {
    switch (msg.type) {
      case 'heartbeat':
        this.lastHeartbeat = Date.now();
        this.send({ type: 'heartbeat.ack', clientTs: msg.clientTs, serverTs: Date.now() });
        return;
      case 'session.pause':
        this.setPaused(true);
        this.logEv({ ev: 'user.action', action: 'pause', detail: null });
        return;
      case 'session.resume':
        this.setPaused(false);
        this.logEv({ ev: 'user.action', action: 'resume', detail: null });
        return;
      case 'session.end':
        this.logEv({ ev: 'user.action', action: 'end', detail: null });
        await this.end('user');
        return;
      case 'answer.request':
        this.logEv({ ev: 'user.action', action: 'answer', detail: null });
        this.forceAnswer();
        return;
      case 'answer.cancel':
        this.answerer?.cancel();
        return;
      case 'chat.send':
        this.logEv({ ev: 'user.action', action: 'chat', detail: msg.text });
        await this.chat(msg.text);
        return;
      case 'panel.clear':
        this.previousAnswers = [];
        this.answerer?.cancel();
        this.logEv({ ev: 'user.action', action: 'clear', detail: null });
        this.send({ type: 'panel.cleared' });
        return;
      case 'language.set':
        await this.setLanguage(msg.language);
        return;
      case 'autoAnswer.set':
        this.autoAnswer = msg.enabled;
        this.logEv({ ev: 'user.action', action: 'autoAnswer', detail: String(msg.enabled) });
        await this.deps.prisma?.callSession.update({ where: { id: this.session!.id }, data: { autoAnswer: msg.enabled } });
        this.sendState();
        return;
      case 'feedback':
        this.logEv({ ev: 'user.feedback', messageId: msg.messageId, value: msg.value, note: msg.note ?? null });
        await this.deps.prisma?.aiMessage
          .update({ where: { id: msg.messageId }, data: { feedback: msg.value } })
          .catch(() => undefined);
        return;
      case 'debug.transcript':
        this.ingest(msg.channel, msg.text, msg.isFinal, { startMs: this.elapsedMs() - 1500, endMs: this.elapsedMs(), confidence: null, language: null }, true);
        return;
    }
  }

  // ---------- Ciclo de vida ----------
  private async join(sessionId: string): Promise<void> {
    if (this.session) {
      this.send({ type: 'error', code: 'already_joined', message: 'La conexión ya tiene sesión', fatal: false });
      return;
    }
    const loader = this.deps.loadSessionOverride ?? ((id: string) => loadSession(this.deps.prisma!, id));
    const s = await loader(sessionId);
    if (!s) {
      this.send({ type: 'error', code: 'not_found', message: 'Sesión no encontrada', fatal: true });
      return;
    }
    if (s.state === 'ENDED') {
      this.send({ type: 'error', code: 'ended', message: 'La sesión ya terminó', fatal: true });
      return;
    }
    this.session = s;
    this.context = s.context;
    this.language = s.language;
    this.autoAnswer = s.autoAnswer;
    this.llm = this.deps.resolveLlm(s.model);
    this.log = this.deps.createLog(s.id);
    this.window = new TranscriptWindow(this.deps.config.transcriptWindowMs);
    this.baseMs = s.durationSeconds * 1000;
    this.resumedAt = Date.now();
    const cfg = this.deps.config;

    if (!s.startedAt) {
      s.startedAt = new Date();
      await this.deps.prisma?.callSession.update({
        where: { id: s.id },
        data: { state: 'LIVE', startedAt: s.startedAt, model: this.llm.modelId },
      });
    } else {
      await this.deps.prisma?.callSession.update({ where: { id: s.id }, data: { state: 'LIVE' } });
      // Reconexión: recupera la transcripción previa para el contexto.
      const prev = await this.deps.prisma?.transcriptSegment.findMany({ where: { sessionId: s.id }, orderBy: { startMs: 'asc' } });
      for (const seg of prev ?? []) this.window.push({ id: seg.id, speaker: seg.speaker, text: seg.text, startMs: seg.startMs, endMs: seg.endMs });
      const prevAnswers = await this.deps.prisma?.aiMessage.findMany({
        where: { sessionId: s.id, kind: { in: ['AUTO_ANSWER', 'MANUAL_ANSWER'] } },
        orderBy: { createdAt: 'asc' },
        take: 5,
      });
      this.previousAnswers = (prevAnswers ?? []).map((m) => m.content);
    }

    this.pipeline = new QuestionPipeline({
      llm: cfg.llmClassifier ? this.llm.provider : null,
      classifierModel: this.llm.classifierModelId,
      debounceMs: cfg.answerDebounceMs,
      utteranceEndFallbackMs: cfg.utteranceEndFallbackMs,
      recentThem: () => TranscriptWindow.format(this.window.recentThem(this.elapsedMs())),
      onHeuristic: (text, h) =>
        this.logEv({ ev: 'question.heuristic', text, isQuestion: h.isQuestion, needsAnswer: h.needsAnswer, qtype: h.type, score: h.score, reasons: h.reasons }),
      onClassified: (q, latencyMs) =>
        this.logEv({ ev: 'question.classified', isQuestion: true, needsAnswer: q.needsAnswer, qtype: q.qtype, question: q.question, latencyMs, model: this.llm!.classifierModelId }),
      onDetected: (q) => this.onQuestion(q),
      onError: (err) => this.deps.logger.warn({ err }, 'clasificador falló; se usa heurística'),
    });

    this.answerer = new Answerer(this.llm.provider, this.llm.modelId, () => this.context, {
      onStart: (job) => {
        this.send({ type: 'answer.start', messageId: job.messageId, kind: job.kind, detectedQuestion: job.question, createdAt: new Date().toISOString(), model: this.llm!.modelId });
        this.logEv({ ev: 'answer.start', messageId: job.messageId, kind: job.kind, question: job.question, model: this.llm!.modelId, promptTokensEstimate: null });
      },
      onFirstToken: (job, latencyMs) => {
        this.metrics.firstToken = latencyMs;
        this.logEv({ ev: 'answer.first_token', messageId: job.messageId, latencyMs });
      },
      onDelta: (job, delta) => this.send({ type: 'answer.delta', messageId: job.messageId, delta }),
      onDone: (job, r) => {
        if (r.content.trim()) {
          this.previousAnswers.push(r.content);
          if (this.previousAnswers.length > 5) this.previousAnswers.shift();
        }
        this.send({
          type: 'answer.done',
          messageId: job.messageId,
          content: r.content,
          latencyMs: r.latencyMs,
          firstTokenMs: r.firstTokenMs,
          tokensIn: r.usage.inputTokens,
          tokensOut: r.usage.outputTokens,
          cacheReadTokens: r.usage.cacheReadTokens,
          model: r.model,
          aborted: r.aborted,
        });
        this.logEv({ ev: 'answer.done', messageId: job.messageId, latencyMs: r.latencyMs, tokensIn: r.usage.inputTokens, tokensOut: r.usage.outputTokens, cacheReadTokens: r.usage.cacheReadTokens, aborted: r.aborted, content: r.content });
        void this.persistAiMessage(job, r);
      },
      onError: (job, err) => {
        this.deps.logger.error({ err }, 'error generando respuesta');
        this.send({ type: 'answer.error', messageId: job.messageId, message: err.message });
        this.logEv({ ev: 'answer.error', messageId: job.messageId, message: err.message });
      },
    });

    this.logEv({
      ev: 'session.start',
      mode: s.mode,
      language: s.language,
      model: this.llm.modelId,
      sttProvider: this.deps.stt.id,
      llmProvider: this.llm.provider.id,
      autoAnswer: this.autoAnswer,
    });
    if (this.llm.notice) this.send({ type: 'error', code: 'llm_notice', message: this.llm.notice, fatal: false });
    this.sendState();
    await Promise.all([this.openStream('them'), this.openStream('me')]);
    this.tick = setInterval(() => this.onTick(), 1000);
  }

  private setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    if (paused) {
      this.baseMs = this.elapsedMs();
      this.paused = true;
      this.resumedAt = null;
    } else {
      this.paused = false;
      this.resumedAt = Date.now();
    }
    this.sendState();
  }

  private onTick(): void {
    if (!this.session || this.ended) return;
    // Sin heartbeat del cliente se pausa el cobro (medición en servidor, no en cliente).
    if (!this.paused && Date.now() - this.lastHeartbeat > this.deps.config.heartbeatTimeoutMs) {
      this.deps.logger.warn('sin heartbeat; sesión pausada');
      this.setPaused(true);
    }
    const remaining = this.remainingSeconds();
    if (remaining != null) {
      if (!this.limitWarned && remaining <= WARN_BEFORE_LIMIT_S) {
        this.limitWarned = true;
        this.send({ type: 'limit.warning', remainingSeconds: remaining });
      }
      if (remaining <= 0) {
        void this.end('limit');
        return;
      }
    }
    this.send({
      type: 'metrics',
      sttPartialLatencyMs: this.metrics.sttPartial,
      sttFinalLatencyMs: this.metrics.sttFinal,
      lastFirstTokenMs: this.metrics.firstToken,
      audioFramesMe: this.audioFrames.me,
      audioFramesThem: this.audioFrames.them,
      serverTs: Date.now(),
    });
  }

  // ---------- STT ----------
  private async openStream(channel: AudioChannel): Promise<SttStream | null> {
    if (!this.session || this.ended) return null;
    if (this.streams[channel]) return this.streams[channel]!;
    const offset = this.elapsedMs();
    this.streamOffsetMs[channel] = offset;
    try {
      const stream = await this.deps.stt.open(
        { language: this.language, sampleRate: AUDIO_SAMPLE_RATE, keyterms: this.session.keyterms },
        {
          onPartial: (ev) => this.ingest(channel, ev.text, false, { ...ev, confidence: null, language: null }),
          onFinal: (ev) => this.ingest(channel, ev.text, true, ev),
          onUtteranceEnd: () => {
            this.logEv({ ev: 'utterance.end', channel });
            if (channel === 'them') this.pipeline?.onUtteranceEnd();
          },
          onError: (err) => {
            this.deps.logger.error({ err, channel }, 'error STT');
            this.send({ type: 'error', code: 'stt_error', message: `STT (${channel}): ${err.message}`, fatal: false });
          },
          onClose: () => {
            if (this.streams[channel]) delete this.streams[channel];
          },
        },
      );
      this.streams[channel] = stream;
      return stream;
    } catch (err) {
      this.deps.logger.error({ err, channel }, 'no se pudo abrir STT');
      this.send({ type: 'error', code: 'stt_open_failed', message: `No se pudo abrir la transcripción (${channel})`, fatal: false });
      return null;
    }
  }

  private async closeStreams(): Promise<void> {
    const open = Object.entries(this.streams) as Array<[AudioChannel, SttStream]>;
    this.streams = {};
    await Promise.all(open.map(([, s]) => s.close().catch(() => undefined)));
  }

  /** Entrada de texto transcrito (del STT o del panel de debug). */
  private ingest(
    channel: AudioChannel,
    text: string,
    isFinal: boolean,
    ev: { startMs: number; endMs: number; confidence: number | null; language: string | null },
    absolute = false,
  ): void {
    if (!this.session || this.ended) return;
    const offset = absolute ? 0 : (this.streamOffsetMs[channel] ?? 0);
    const startMs = Math.max(0, offset + ev.startMs);
    const endMs = Math.max(startMs, offset + ev.endMs);
    const speaker = SPEAKER_OF[channel];
    const latency = Math.max(0, this.elapsedMs() - endMs);
    if (!isFinal) {
      this.metrics.sttPartial = latency;
      this.send({ type: 'transcript.partial', speaker, text, startMs, endMs });
      this.logEv({ ev: 'transcript.partial', channel, text, startMs, endMs });
      return;
    }
    this.metrics.sttFinal = latency;
    const seg: WindowSegment = { id: randomUUID(), speaker, text, startMs, endMs };
    this.window.push(seg);
    this.send({ type: 'transcript.final', segment: { ...seg, confidence: ev.confidence ?? undefined, language: ev.language ?? undefined } });
    this.logEv({ ev: 'transcript.final', id: seg.id, channel, speaker, text, startMs, endMs, confidence: ev.confidence, sttLatencyMs: latency });
    if (this.session.saveTranscript && this.deps.prisma) {
      void this.deps.prisma.transcriptSegment
        .create({ data: { id: seg.id, sessionId: this.session.id, speaker, text, startMs, endMs, confidence: ev.confidence, language: ev.language } })
        .catch((err) => this.deps.logger.error({ err }, 'no se pudo guardar el segmento'));
    }
    if (channel === 'them') this.pipeline?.onFinalSegment(text);
  }

  // ---------- Preguntas y respuestas ----------
  private onQuestion(q: DetectedQuestion): void {
    this.lastDetected = q;
    this.send({ type: 'question.detected', question: q.question, qtype: q.qtype, needsAnswer: q.needsAnswer, source: q.source, score: q.score });
    if (q.needsAnswer && this.autoAnswer) this.startAnswer('AUTO_ANSWER', q.question, q.qtype, null);
  }

  private forceAnswer(): void {
    const pending = this.pipeline?.flush();
    if (pending?.heuristic.isQuestion) {
      this.startAnswer('MANUAL_ANSWER', pending.heuristic.question, pending.heuristic.type, null);
      return;
    }
    if (pending) {
      // Hay texto reciente de THEM sin señal clara de pregunta: se responde a ese texto.
      this.startAnswer('MANUAL_ANSWER', pending.text, 'other', null);
      return;
    }
    if (this.lastDetected && this.elapsedMs() - this.lastDetectedAt < 45_000) {
      this.startAnswer('MANUAL_ANSWER', this.lastDetected.question, this.lastDetected.qtype, null);
      return;
    }
    this.startAnswer('MANUAL_ANSWER', null, null, null);
  }
  private lastDetectedAt = 0;

  private startAnswer(kind: AnswerJob['kind'], question: string | null, qtype: AnswerJob['qtype'], userInstruction: string | null): void {
    if (!this.answerer) return;
    if (question) this.lastDetectedAt = this.elapsedMs();
    const now = this.elapsedMs();
    const job: AnswerJob = {
      messageId: randomUUID(),
      kind,
      question,
      qtype,
      recentTranscript: question ? this.window.formatRecent(now) : this.window.formatRecent(now, 45_000) || this.window.formatRecent(now),
      previousAnswers: [...this.previousAnswers],
      userInstruction,
    };
    void this.answerer.run(job);
  }

  private async chat(text: string): Promise<void> {
    if (!this.session) return;
    const userMsgId = randomUUID();
    const createdAt = new Date();
    this.send({ type: 'chat.user', messageId: userMsgId, text, createdAt: createdAt.toISOString() });
    await this.deps.prisma?.aiMessage
      .create({ data: { id: userMsgId, sessionId: this.session.id, kind: 'CHAT_USER', content: text, model: '', sessionMs: this.elapsedMs(), createdAt } })
      .catch((err) => this.deps.logger.error({ err }, 'no se pudo guardar el chat'));
    const now = this.elapsedMs();
    const job: AnswerJob = {
      messageId: randomUUID(),
      kind: 'CHAT_AI',
      question: null,
      qtype: null,
      recentTranscript: this.window.formatRecent(now),
      previousAnswers: [...this.previousAnswers],
      userInstruction: text,
    };
    void this.answerer?.run(job);
  }

  private async persistAiMessage(job: AnswerJob, r: { content: string; latencyMs: number; firstTokenMs: number | null; usage: { inputTokens: number; outputTokens: number }; model: string }): Promise<void> {
    if (!this.session || !this.deps.prisma || !r.content.trim()) return;
    await this.deps.prisma.aiMessage
      .create({
        data: {
          id: job.messageId,
          sessionId: this.session.id,
          kind: job.kind,
          detectedQuestion: job.question,
          questionType: job.qtype,
          content: r.content,
          model: r.model,
          latencyMs: r.latencyMs,
          firstTokenMs: r.firstTokenMs,
          tokensIn: r.usage.inputTokens,
          tokensOut: r.usage.outputTokens,
          sessionMs: this.elapsedMs(),
        },
      })
      .catch((err) => this.deps.logger.error({ err }, 'no se pudo guardar la respuesta'));
  }

  private async setLanguage(language: string): Promise<void> {
    if (!this.session) return;
    this.language = language;
    this.context = { ...this.context, language };
    this.logEv({ ev: 'user.action', action: 'language', detail: language });
    await this.deps.prisma?.callSession.update({ where: { id: this.session.id }, data: { language } });
    // Cambio en caliente: se reabren las conexiones STT con el nuevo idioma.
    await this.closeStreams();
    await Promise.all([this.openStream('them'), this.openStream('me')]);
    this.sendState();
  }

  // ---------- Fin ----------
  async end(reason: 'user' | 'limit' | 'error'): Promise<void> {
    if (!this.session || this.ended) return;
    this.ended = true;
    if (this.tick) clearInterval(this.tick);
    this.pipeline?.reset();
    this.answerer?.cancel();
    this.baseMs = this.elapsedMs();
    this.resumedAt = null;
    await this.closeStreams();
    const durationSeconds = Math.round(this.baseMs / 1000);
    const credits = this.session.remainingSeconds == null ? 0 : creditsForSeconds(durationSeconds);
    this.logEv({ ev: 'session.end', durationMs: this.baseMs, reason });
    this.sendState();
    if (this.deps.prisma) {
      const prisma = this.deps.prisma;
      const s = this.session;
      try {
        await prisma.$transaction(async (tx) => {
          const user = await tx.user.findUnique({ where: { id: s.userId } });
          const trialLeft = Math.max(0, 600 - (user?.freeTrialUsedSeconds ?? 600));
          const usedFreeTrial = user?.plan === 'FREE' && trialLeft > 0 && durationSeconds <= trialLeft;
          await tx.callSession.update({
            where: { id: s.id },
            data: { state: 'ENDED', endedAt: new Date(), durationSeconds, creditsUsed: usedFreeTrial ? 0 : credits, usedFreeTrial },
          });
          if (usedFreeTrial) {
            await tx.user.update({ where: { id: s.userId }, data: { freeTrialUsedSeconds: { increment: durationSeconds } } });
          } else if (credits > 0) {
            await tx.user.update({ where: { id: s.userId }, data: { creditsBalance: { decrement: credits } } });
            await tx.creditLedger.create({ data: { userId: s.userId, delta: -credits, reason: 'SESSION_USAGE', sessionId: s.id } });
          }
        });
      } catch (err) {
        this.deps.logger.error({ err }, 'no se pudo cerrar la sesión en la base de datos');
      }
      void this.generateAndStoreNotes(durationSeconds);
    }
    await this.log?.flush();
  }

  private async generateAndStoreNotes(durationSeconds: number): Promise<void> {
    if (!this.session || !this.deps.prisma || !this.llm) return;
    const started = Date.now();
    try {
      const { notes, usage, model } = await generateNotes(this.llm.provider, this.llm.modelId, {
        segments: this.window.all(),
        company: this.session.company || null,
        title: this.session.title || null,
        mode: this.session.mode,
        durationSeconds,
      });
      await this.deps.prisma.callNotes.upsert({
        where: { sessionId: this.session.id },
        update: { ...notes, model, generatedAt: new Date() },
        create: { sessionId: this.session.id, ...notes, model },
      });
      this.logEv({ ev: 'notes.generated', latencyMs: Date.now() - started, tokensIn: usage.inputTokens, tokensOut: usage.outputTokens });
      await this.log?.flush();
    } catch (err) {
      this.deps.logger.error({ err }, 'no se pudieron generar las notas');
    }
  }

  /** El socket se cerró. Si la sesión sigue viva se guarda el progreso para poder reconectar. */
  async onSocketClosed(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.tick) clearInterval(this.tick);
    this.pipeline?.reset();
    this.answerer?.cancel();
    await this.closeStreams();
    if (this.session && !this.ended) {
      this.baseMs = this.elapsedMs();
      this.resumedAt = null;
      await this.deps.prisma?.callSession
        .update({ where: { id: this.session.id }, data: { durationSeconds: Math.round(this.baseMs / 1000) } })
        .catch(() => undefined);
    }
    await this.log?.flush();
  }
}
