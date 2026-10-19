// Servidor realtime: WebSocket /ws para sesiones en vivo y API HTTP para notas y Ask AI.
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { z } from 'zod';
import pino from 'pino';
import { ensureDefaultUser, prisma } from '@callpilot/db';
import {
  DEFAULT_MODEL_ID,
  LANGUAGES,
  MODEL_CATALOG,
  buildAskAiSystemPrompt,
  encodeServerMessage,
  type ServerMessage,
} from '@callpilot/shared';
import { resolveProviderForModel } from '@callpilot/ai';
import { isAllowedOrigin, loadConfig } from './config';
import { LiveSession } from './session/liveSession';
import { generateNotes } from './session/notes';
import { FileSessionLog } from './session/sessionLog';
import { TranscriptWindow } from './session/transcriptWindow';
import { createSttProvider } from './stt';

const config = loadConfig();
const logger = pino({
  level: config.logLevel,
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});
const stt = createSttProvider(config);

export async function buildServer() {
  const app = Fastify({ loggerInstance: logger });
  // Solo la web local, la extensión y los orígenes de ALLOWED_ORIGINS pueden usar el servidor.
  await app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin, config.allowedOrigins)),
  });
  await app.register(websocket, {
    options: {
      // Las capturas de pantalla llegan en base64 por el mismo socket (hasta ~7 MB).
      maxPayload: 10 * 1024 * 1024,
      verifyClient: (info, next) =>
        next(isAllowedOrigin(info.origin, config.allowedOrigins), 403, 'origin no permitido'),
    },
  });

  app.get('/health', async () => ({
    ok: true,
    stt: stt.id,
    llmProvider: process.env.LLM_PROVIDER ?? 'auto',
  }));

  // Configuración que necesita la extensión: modelos disponibles y proveedores activos.
  app.get('/api/config', async () => {
    const forcedFake = process.env.LLM_PROVIDER === 'fake';
    return {
      stt: stt.id,
      llmProvider: process.env.LLM_PROVIDER ?? 'auto',
      defaultModel: DEFAULT_MODEL_ID,
      models: MODEL_CATALOG.map((m) => ({
        id: m.id,
        label: m.label,
        provider: m.provider,
        speed: m.speed,
        vision: m.vision,
        available:
          m.provider === 'fake' ||
          (!forcedFake &&
            Boolean(m.requiresEnv && process.env[m.requiresEnv]) &&
            m.provider === 'anthropic'),
      })),
      languages: LANGUAGES.length,
    };
  });

  app.get<{ Querystring: { state?: string; limit?: string } }>('/api/sessions', async (req) => {
    const user = await ensureDefaultUser(prisma);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));
    const state = req.query.state;
    const sessions = await prisma.callSession.findMany({
      where: {
        userId: user.id,
        ...(state === 'active'
          ? { state: { in: ['READY', 'LIVE'] } }
          : state === 'ended'
            ? { state: 'ENDED' }
            : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        company: true,
        title: true,
        mode: true,
        state: true,
        language: true,
        model: true,
        createdAt: true,
      },
    });
    return { sessions };
  });

  const NewSession = z.object({
    company: z.string().trim().max(200).default(''),
    title: z.string().trim().max(200).default(''),
    description: z.string().trim().max(2000).default(''),
    mode: z.enum(['INTERVIEW', 'REGULAR']).default('REGULAR'),
    language: z.string().min(2).max(10).default('es'),
    model: z.string().min(1).default(DEFAULT_MODEL_ID),
    instructions: z.string().max(50_000).default(''),
    autoAnswer: z.boolean().default(true),
    saveTranscript: z.boolean().default(true),
    saveForEval: z.boolean().default(false),
  });

  // Sesión rápida desde la extensión (sin pasar por el formulario de la web).
  app.post('/api/sessions', async (req, reply) => {
    const parsed = NewSession.safeParse(req.body ?? {});
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const user = await ensureDefaultUser(prisma);
    const session = await prisma.callSession.create({
      data: { userId: user.id, ...parsed.data, source: 'TAB_SHARE' },
      select: {
        id: true,
        company: true,
        title: true,
        mode: true,
        state: true,
        language: true,
        model: true,
        createdAt: true,
      },
    });
    return reply.code(201).send(session);
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const session = new LiveSession({
      prisma,
      stt,
      resolveLlm: (modelId) => resolveProviderForModel(modelId),
      config,
      createLog: (sessionId) => new FileSessionLog(config.sessionLogDir, sessionId),
      send: (msg: ServerMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(encodeServerMessage(msg));
      },
      logger,
    });
    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      const buf = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data);
      if (isBinary)
        session.handleBinary(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      else
        void session
          .handleText(buf.toString('utf8'))
          .catch((err) => logger.error({ err }, 'error procesando mensaje'));
    });
    socket.on('close', () => void session.onSocketClosed());
    socket.on('error', (err) => logger.warn({ err }, 'error de socket'));
  });

  // Regenera las notas de una sesión terminada.
  app.post<{ Params: { id: string } }>('/api/sessions/:id/notes', async (req, reply) => {
    const s = await prisma.callSession.findUnique({ where: { id: req.params.id } });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    const segments = await prisma.transcriptSegment.findMany({
      where: { sessionId: s.id },
      orderBy: { startMs: 'asc' },
    });
    const llm = resolveProviderForModel(s.model);
    const { notes, model } = await generateNotes(llm.provider, llm.modelId, {
      segments: segments.map((x) => ({
        id: x.id,
        speaker: x.speaker,
        text: x.text,
        startMs: x.startMs,
        endMs: x.endMs,
      })),
      company: s.company || null,
      title: s.title || null,
      mode: s.mode,
      durationSeconds: s.durationSeconds,
    });
    const saved = await prisma.callNotes.upsert({
      where: { sessionId: s.id },
      update: { ...notes, model, generatedAt: new Date() },
      create: { sessionId: s.id, ...notes, model },
    });
    return saved;
  });

  // Ask AI: pregunta sobre la transcripción y las notas de una sesión terminada.
  app.post<{
    Params: { id: string };
    Body: { question: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> };
  }>('/api/sessions/:id/ask', async (req, reply) => {
    const s = await prisma.callSession.findUnique({
      where: { id: req.params.id },
      include: { notes: true },
    });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    const question = (req.body?.question ?? '').trim();
    if (!question) return reply.code(400).send({ error: 'empty_question' });
    const segments = await prisma.transcriptSegment.findMany({
      where: { sessionId: s.id },
      orderBy: { startMs: 'asc' },
    });
    const transcript = TranscriptWindow.format(
      segments.map((x) => ({
        id: x.id,
        speaker: x.speaker,
        text: x.text,
        startMs: x.startMs,
        endMs: x.endMs,
      })),
    );
    const llm = resolveProviderForModel(s.model);
    const history = (req.body.history ?? []).slice(-10);
    const res = await llm.provider.complete({
      model: llm.modelId,
      system: buildAskAiSystemPrompt({
        transcript: transcript.slice(0, 120_000),
        notesJson: s.notes ? JSON.stringify(s.notes) : null,
        language: s.language,
      }),
      messages: [...history, { role: 'user', content: question }],
      maxTokens: 1000,
      purpose: 'ask',
    });
    return { answer: res.text, model: res.model, usage: res.usage };
  });

  return app;
}

const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  buildServer()
    .then((app) => app.listen({ port: config.port, host: config.host }))
    .then(() =>
      logger.info(
        { port: config.port, stt: stt.id, logDir: config.sessionLogDir },
        'realtime listo',
      ),
    )
    .catch((err) => {
      logger.error(err, 'no se pudo iniciar el servidor');
      process.exit(1);
    });
}
