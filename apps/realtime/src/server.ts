// Servidor realtime: WebSocket /ws para sesiones en vivo y API HTTP para notas y Ask AI.
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import pino from 'pino';
import { prisma } from '@callpilot/db';
import { buildAskAiSystemPrompt, encodeServerMessage, type ServerMessage } from '@callpilot/shared';
import { resolveProviderForModel } from '@callpilot/ai';
import { loadConfig } from './config';
import { LiveSession } from './session/liveSession';
import { generateNotes } from './session/notes';
import { FileSessionLog } from './session/sessionLog';
import { TranscriptWindow } from './session/transcriptWindow';
import { createSttProvider } from './stt';

const config = loadConfig();
const logger = pino({ level: config.logLevel, transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' } });
const stt = createSttProvider(config);

export async function buildServer() {
  const app = Fastify({ loggerInstance: logger });
  await app.register(cors, { origin: true });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  app.get('/health', async () => ({ ok: true, stt: stt.id, llmProvider: process.env.LLM_PROVIDER ?? 'auto' }));

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
      const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
      if (isBinary) session.handleBinary(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      else void session.handleText(buf.toString('utf8')).catch((err) => logger.error({ err }, 'error procesando mensaje'));
    });
    socket.on('close', () => void session.onSocketClosed());
    socket.on('error', (err) => logger.warn({ err }, 'error de socket'));
  });

  // Regenera las notas de una sesión terminada.
  app.post<{ Params: { id: string } }>('/api/sessions/:id/notes', async (req, reply) => {
    const s = await prisma.callSession.findUnique({ where: { id: req.params.id } });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    const segments = await prisma.transcriptSegment.findMany({ where: { sessionId: s.id }, orderBy: { startMs: 'asc' } });
    const llm = resolveProviderForModel(s.model);
    const { notes, model } = await generateNotes(llm.provider, llm.modelId, {
      segments: segments.map((x) => ({ id: x.id, speaker: x.speaker, text: x.text, startMs: x.startMs, endMs: x.endMs })),
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
  app.post<{ Params: { id: string }; Body: { question: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> } }>(
    '/api/sessions/:id/ask',
    async (req, reply) => {
      const s = await prisma.callSession.findUnique({ where: { id: req.params.id }, include: { notes: true } });
      if (!s) return reply.code(404).send({ error: 'not_found' });
      const question = (req.body?.question ?? '').trim();
      if (!question) return reply.code(400).send({ error: 'empty_question' });
      const segments = await prisma.transcriptSegment.findMany({ where: { sessionId: s.id }, orderBy: { startMs: 'asc' } });
      const transcript = TranscriptWindow.format(segments.map((x) => ({ id: x.id, speaker: x.speaker, text: x.text, startMs: x.startMs, endMs: x.endMs })));
      const llm = resolveProviderForModel(s.model);
      const history = (req.body.history ?? []).slice(-10);
      const res = await llm.provider.complete({
        model: llm.modelId,
        system: buildAskAiSystemPrompt({ transcript: transcript.slice(0, 120_000), notesJson: s.notes ? JSON.stringify(s.notes) : null, language: s.language }),
        messages: [...history, { role: 'user', content: question }],
        maxTokens: 1000,
        purpose: 'ask',
      });
      return { answer: res.text, model: res.model, usage: res.usage };
    },
  );

  return app;
}

const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  buildServer()
    .then((app) => app.listen({ port: config.port, host: config.host }))
    .then(() => logger.info({ port: config.port, stt: stt.id, logDir: config.sessionLogDir }, 'realtime listo'))
    .catch((err) => {
      logger.error(err, 'no se pudo iniciar el servidor');
      process.exit(1);
    });
}
