// Utilidades de las pruebas E2E: servidor realtime simulado, servidor de páginas y Chromium con la extensión.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIST = path.resolve(here, '../dist');
const ROOT = path.resolve(here, '../../..');
export const REALTIME_PORT = 4011;
export const SERVER_URL = `http://localhost:${REALTIME_PORT}`;
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export interface TestServers {
  logDir: string;
  pagesUrl: string;
  stop: () => Promise<void>;
}

async function waitForHealth(url: string, ms: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* aún no arranca */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`El servidor no respondió en ${url}`);
}

/** Levanta el servidor realtime (proveedores simulados) y un servidor estático con las páginas de prueba. */
export async function startServers(): Promise<TestServers> {
  const logDir = mkdtempSync(path.join(tmpdir(), 'callpilot-e2e-'));
  const realtime: ChildProcess = spawn('pnpm', ['exec', 'tsx', 'src/server.ts'], {
    cwd: path.join(ROOT, 'apps/realtime'),
    env: {
      ...process.env,
      STT_PROVIDER: 'fake',
      LLM_PROVIDER: 'fake',
      REALTIME_PORT: String(REALTIME_PORT),
      SESSION_LOG_DIR: logDir,
      FAKE_LLM_CHUNK_DELAY_MS: '0',
      FAKE_LLM_FIRST_TOKEN_MS: '50',
      LOG_LEVEL: 'warn',
    },
    stdio: 'ignore',
  });
  await waitForHealth(`${SERVER_URL}/health`, 60_000);

  const pages: Server = createServer((req, res) => {
    const name = (req.url ?? '/').split('?')[0]!.replace(/^\/+/, '') || 'quiz.html';
    const file = path.join(here, 'fixtures', name);
    if (!file.startsWith(path.join(here, 'fixtures')) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(file));
  });
  await new Promise<void>((resolve) => pages.listen(0, '127.0.0.1', resolve));
  const port = (pages.address() as AddressInfo).port;
  return {
    logDir,
    pagesUrl: `http://127.0.0.1:${port}`,
    stop: async () => {
      realtime.kill('SIGTERM');
      await new Promise<void>((resolve) => pages.close(() => resolve()));
    },
  };
}

export interface ExtensionHandle {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  openPanel: () => Promise<Page>;
  setSettings: (patch: Record<string, unknown>) => Promise<void>;
}

/** Chromium con la extensión cargada (headless "new", que sí soporta extensiones). */
export async function launchWithExtension(): Promise<ExtensionHandle> {
  if (!existsSync(path.join(EXT_DIST, 'manifest.json'))) {
    throw new Error(
      'Falta apps/extension/dist: ejecuta "pnpm --filter @callpilot/extension build" antes de las pruebas.',
    );
  }
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'callpilot-profile-'));
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(PREINSTALLED) ? PREINSTALLED : undefined);
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    args: [
      '--headless=new',
      `--disable-extensions-except=${EXT_DIST}`,
      `--load-extension=${EXT_DIST}`,
      '--no-sandbox',
    ],
    viewport: { width: 1100, height: 760 },
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  // Las APIs de chrome.* pueden tardar unos instantes en estar disponibles tras arrancar el service worker.
  for (let i = 0; i < 50; i++) {
    const ready = await worker
      .evaluate(
        () =>
          typeof chrome.storage?.local?.get === 'function' &&
          typeof chrome.tabs?.query === 'function',
      )
      .catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const setSettings = async (patch: Record<string, unknown>) => {
    await worker.evaluate(async (p) => {
      const current = (await chrome.storage.local.get('settings')).settings ?? {};
      await chrome.storage.local.set({ settings: { ...current, ...p } });
    }, patch);
  };
  await setSettings({ serverUrl: SERVER_URL, audioConsent: true });

  const openPanel = async () => {
    const popupPromise = context.waitForEvent('page');
    await worker.evaluate(
      (url) => chrome.windows.create({ url, type: 'popup', width: 430, height: 820 }),
      `chrome-extension://${extensionId}/sidepanel.html`,
    );
    const panel = await popupPromise;
    await panel.waitForLoadState('domcontentloaded');
    return panel;
  };
  return { context, worker, extensionId, openPanel, setSettings };
}

/** Eventos de todos los JSONL de sesión escritos por el servidor durante la prueba. */
export function readSessionLogs(logDir: string): Array<Record<string, unknown>> {
  return readdirSync(logDir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) =>
      readFileSync(path.join(logDir, f), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
    );
}
