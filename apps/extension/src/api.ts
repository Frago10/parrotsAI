// Cliente HTTP del servidor realtime (configuración y sesiones rápidas).
export interface ServerModel {
  id: string;
  label: string;
  provider: string;
  speed: string;
  vision: boolean;
  available: boolean;
}

export interface ServerConfig {
  stt: string;
  llmProvider: string;
  defaultModel: string;
  models: ServerModel[];
}

export interface SessionSummary {
  id: string;
  company: string;
  title: string;
  mode: string;
  state: string;
  language: string;
  model: string;
  createdAt: string;
}

async function request<T>(serverUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const getConfig = (serverUrl: string) => request<ServerConfig>(serverUrl, '/api/config');

export async function listSessions(serverUrl: string): Promise<SessionSummary[]> {
  return (
    await request<{ sessions: SessionSummary[] }>(serverUrl, '/api/sessions?state=active&limit=15')
  ).sessions;
}

export const createSession = (
  serverUrl: string,
  body: {
    company: string;
    title: string;
    language: string;
    model: string;
    instructions: string;
    autoAnswer: boolean;
    saveForEval?: boolean;
  },
) =>
  request<SessionSummary>(serverUrl, '/api/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
