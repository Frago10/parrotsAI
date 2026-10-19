// Lectura de la pestaña: elige la pestaña objetivo, inyecta el lector y captura la pantalla.
import { dataUrlToBlob, downscaleImage, type EncodedImage } from '@callpilot/live-core';
import type { PageContext } from '@callpilot/shared';
import type { ReaderResult } from '../pageReader';
import { hostOf, isBlockedUrl, isExtensionUrl, isRestrictedUrl, type Settings } from '../settings';

export type ReadErrorCode = 'no-tab' | 'restricted' | 'blocked' | 'no-access';

export class ReadError extends Error {
  constructor(
    public readonly code: ReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReadError';
  }
}

/**
 * Pestaña que se lee: la activa de esta ventana si es una página web; si el panel está en una
 * ventana propia, la última pestaña web que el service worker vio activa.
 */
export async function getTargetTab(): Promise<chrome.tabs.Tab | null> {
  const win = await chrome.windows.getCurrent();
  const [active] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (active && !isExtensionUrl(active.url)) return active;
  const { lastWebTab } = (await chrome.storage.session.get('lastWebTab')) as {
    lastWebTab?: { tabId: number };
  };
  if (lastWebTab) {
    try {
      return await chrome.tabs.get(lastWebTab.tabId);
    } catch {
      /* la pestaña se cerró */
    }
  }
  const all = await chrome.tabs.query({ active: true });
  return all.find((t) => !isExtensionUrl(t.url)) ?? null;
}

const MAX_VIEW = 12_000;

/** Inyecta el lector en la pestaña (y sus iframes) y lo convierte en el contexto que entiende el servidor. */
export async function readTab(
  tab: chrome.tabs.Tab,
  settings: Pick<Settings, 'blockedDomains' | 'fullPage'>,
): Promise<PageContext> {
  if (tab.id == null || !tab.url)
    throw new ReadError('no-tab', 'No hay una pestaña web para leer.');
  if (isRestrictedUrl(tab.url)) {
    throw new ReadError(
      'restricted',
      'Chrome no deja leer esta página (chrome://, Web Store, visor interno). Abre una página web normal.',
    );
  }
  if (isBlockedUrl(tab.url, settings.blockedDomains)) {
    throw new ReadError('blocked', `${hostOf(tab.url)} está en tu lista de dominios bloqueados.`);
  }
  let results: Array<{ result?: unknown }>;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['pageReader.js'],
    });
  } catch (err) {
    throw new ReadError(
      'no-access',
      `No se pudo leer la página: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const frames = results
    .map((r) => r.result as ReaderResult | null | undefined)
    .filter((r): r is ReaderResult => Boolean(r));
  const top = frames.find((f) => f.isTop) ?? frames[0];
  if (!top) throw new ReadError('no-access', 'La página no devolvió contenido legible.');
  const others = frames.filter((f) => f !== top);

  let viewportText = top.viewportText;
  for (const f of others) {
    if (f.viewportText.trim().length > 40 && viewportText.length < MAX_VIEW) {
      viewportText += `\n\n[iframe: ${f.frameUrl}]\n${f.viewportText}`;
    }
  }
  const pick = <T>(sel: (f: ReaderResult) => T[], max: number): T[] =>
    [top, ...others].flatMap(sel).slice(0, max);
  return {
    url: top.url,
    title: top.title,
    lang: top.lang,
    selection: frames.map((f) => f.selection).find(Boolean),
    headings: top.headings,
    viewportText: viewportText.slice(0, MAX_VIEW),
    fullText: settings.fullPage ? top.fullText : undefined,
    inputs: pick((f) => f.inputs, 60),
    tables: pick((f) => f.tables, 4),
    code: pick((f) => f.code, 6),
    images: top.images,
    scrollPct: top.scrollPct,
    viewport: top.viewport,
  };
}

/** Captura el área visible de la pestaña y la reduce para enviarla al modelo. */
export async function captureTab(tab: chrome.tabs.Tab): Promise<EncodedImage | null> {
  if (tab.id == null) return null;
  const fresh = await chrome.tabs.get(tab.id);
  // captureVisibleTab solo ve la pestaña activa de su ventana.
  if (!fresh.active) return null;
  const dataUrl = await chrome.tabs.captureVisibleTab(fresh.windowId, {
    format: 'jpeg',
    quality: 80,
  });
  return downscaleImage(await dataUrlToBlob(dataUrl), { maxSide: 1568, quality: 0.8 });
}

/** Huella del texto visible para detectar cambios de pantalla (auto-lectura). */
export function signature(page: PageContext): { url: string; words: Set<string> } {
  const words = new Set(
    page.viewportText
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4)
      .slice(0, 600),
  );
  return { url: page.url, words };
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}
