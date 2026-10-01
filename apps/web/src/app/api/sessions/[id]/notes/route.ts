import { NextResponse } from 'next/server';
import { realtimeHttpUrl } from '@/lib/realtime';

// Proxy al servidor realtime, que tiene el generador de notas.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${realtimeHttpUrl()}/api/sessions/${id}/notes`, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
