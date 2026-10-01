// URLs del servidor realtime: WS para el navegador y HTTP para llamadas desde el servidor Next.
export function realtimeWsUrl(): string {
  return process.env.NEXT_PUBLIC_REALTIME_WS_URL ?? 'ws://localhost:4001/ws';
}

export function realtimeHttpUrl(): string {
  if (process.env.REALTIME_HTTP_URL) return process.env.REALTIME_HTTP_URL;
  const ws = realtimeWsUrl();
  return ws.replace(/^ws/, 'http').replace(/\/ws$/, '');
}
