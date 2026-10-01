import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { formatClock } from '@callpilot/shared';
import { prisma } from '@/lib/db';

// Exporta la transcripción (txt/md) o el registro JSONL de la sesión para backtesting.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(req.url).searchParams.get('format') ?? 'txt';
  const session = await prisma.callSession.findUnique({
    where: { id },
    include: { segments: { orderBy: { startMs: 'asc' } }, notes: true },
  });
  if (!session) return new Response('not found', { status: 404 });

  if (format === 'jsonl') {
    const dir = path.resolve(process.cwd(), process.env.SESSION_LOG_DIR ?? '../../data/sessions');
    try {
      const data = await readFile(path.join(dir, `${id}.jsonl`), 'utf8');
      return new Response(data, {
        headers: {
          'content-type': 'application/x-ndjson',
          'content-disposition': `attachment; filename="${id}.jsonl"`,
        },
      });
    } catch {
      return new Response('no session log', { status: 404 });
    }
  }

  const lines = session.segments.map(
    (s) => `[${formatClock(s.startMs)}] ${s.speaker === 'ME' ? 'Yo' : 'Ellos'}: ${s.text}`,
  );
  if (format === 'md') {
    const md = [
      `# ${session.company} — ${session.title}`,
      '',
      session.notes ? `## Resumen\n${session.notes.summary}\n` : '',
      '## Transcripción',
      '',
      ...lines.map((l) => `- ${l}`),
    ].join('\n');
    return new Response(md, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${id}.md"`,
      },
    });
  }
  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${id}.txt"`,
    },
  });
}
