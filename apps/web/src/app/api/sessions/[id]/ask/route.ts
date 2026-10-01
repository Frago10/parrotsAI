import { NextResponse } from 'next/server';
import { realtimeHttpUrl } from '@/lib/realtime';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await req.json().catch(() => ({}));
  const res = await fetch(`${realtimeHttpUrl()}/api/sessions/${id}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
