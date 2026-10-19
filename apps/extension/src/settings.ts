// Ajustes de la extensión (chrome.storage.local) y utilidades de URL.
export interface Settings {
  serverUrl: string;
  language: string;
  model: string;
  instructions: string;
  includeImage: boolean;
  fullPage: boolean;
  autoWatch: boolean;
  autoIntervalSec: number;
  autoAnswer: boolean;
  /** Dominios donde el lector no lee ni captura nada (separados por coma). */
  blockedDomains: string;
  audioConsent: boolean;
  sessionId: string | null;
  sessionLabel: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: 'http://localhost:4001',
  language: 'es',
  model: 'claude-haiku-4-5',
  instructions: '',
  includeImage: true,
  fullPage: false,
  autoWatch: false,
  autoIntervalSec: 10,
  autoAnswer: true,
  blockedDomains: '',
  audioConsent: false,
  sessionId: null,
  sessionLabel: null,
};

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get('settings')).settings as
    Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function wsUrlFrom(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/ws`;
}

const RESTRICTED =
  /^(chrome|chrome-extension|chrome-search|chrome-untrusted|edge|about|devtools|view-source|moz-extension):/i;

/** Páginas que Chrome no deja leer ni capturar (chrome://, Web Store, visor interno...). */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  if (RESTRICTED.test(url)) return true;
  try {
    const u = new URL(url);
    return (
      u.hostname === 'chromewebstore.google.com' ||
      (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))
    );
  } catch {
    return true;
  }
}

export function isExtensionUrl(url: string | undefined): boolean {
  return Boolean(url && url.startsWith(`chrome-extension://${chrome.runtime.id}`));
}

export function isBlockedUrl(url: string, blocked: string): boolean {
  const list = blocked
    .split(/[,\n]/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return list.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
}
