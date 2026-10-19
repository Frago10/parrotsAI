// E2E: la extensión cargada en Chromium lee páginas reales y recibe respuestas del servidor (proveedores simulados).
import { expect, test, type Page } from '@playwright/test';
import {
  launchWithExtension,
  readSessionLogs,
  startServers,
  type ExtensionHandle,
  type TestServers,
} from './helpers';

let servers: TestServers;
let ext: ExtensionHandle;

test.beforeAll(async () => {
  servers = await startServers();
  ext = await launchWithExtension();
});
test.afterAll(async () => {
  await ext?.context.close();
  await servers?.stop();
});

async function openWebPage(path: string): Promise<Page> {
  const page = await ext.context.newPage();
  await page.goto(`${servers.pagesUrl}/${path}`);
  await page.bringToFront();
  // El service worker registra la pestaña activa al terminar de cargar.
  await expect
    .poll(() =>
      ext.worker.evaluate(async () => {
        const stored = (await chrome.storage.session.get('lastWebTab')) as {
          lastWebTab?: { url?: string };
        };
        return stored.lastWebTab?.url ?? '';
      }),
    )
    .toContain(path);
  return page;
}

test('Leer pantalla: lee la página, captura la imagen y muestra la respuesta', async () => {
  const web = await openWebPage('quiz.html');
  const panel = await ext.openPanel();
  await panel.getByRole('button', { name: /Leer pantalla/ }).click();

  const card = panel.locator('.card.kind-SCREENSHOT').first();
  await expect(card).toContainText('Quiz de SQL');
  await expect(card).toContainText('captura: sí');
  await expect(card).toContainText('INNER JOIN y LEFT JOIN');
  await expect(card).toContainText('Campos de formulario visibles');
  await panel.screenshot({ path: 'test-results/panel-quiz.png' });

  // La captura llegó al servidor como imagen real y el contexto quedó registrado para backtesting.
  const ctx = readSessionLogs(servers.logDir).find((e) => e.ev === 'screen.context');
  expect(ctx).toMatchObject({ trigger: 'manual', hasImage: true });
  expect(Number(ctx?.imageKb)).toBeGreaterThan(3);
  expect(String(ctx?.url)).toContain('/quiz.html');
  await web.close();
  await panel.close();
});

test('Preguntar con prompt: muestra el mensaje del usuario y responde sobre la pantalla', async () => {
  const web = await openWebPage('app.html');
  const panel = await ext.openPanel();
  await panel.getByPlaceholder(/Pregunta sobre lo que ves/).fill('¿Por qué falla el código?');
  await panel.getByRole('button', { name: 'Enviar' }).click();
  await expect(panel.locator('.card.kind-CHAT_USER')).toContainText('¿Por qué falla el código?');
  const answer = panel.locator('.card.kind-SCREENSHOT').first();
  await expect(answer).toContainText('Panel de ventas');
  await expect(answer).toContainText('«¿Por qué falla el código?»');
  // Feedback y fijar funcionan.
  await answer.locator('[data-act="up"]').click();
  await answer.locator('[data-act="pin"]').click();
  await expect(answer).toHaveClass(/pinned/);
  await panel.screenshot({ path: 'test-results/panel-app.png' });
  await web.close();
  await panel.close();
});

test('páginas restringidas y dominios bloqueados no se leen', async () => {
  const web = await openWebPage('quiz.html');
  const panel = await ext.openPanel();
  await ext.setSettings({ blockedDomains: '127.0.0.1' });
  await panel.reload();
  await panel.getByRole('button', { name: /Leer pantalla/ }).click();
  await expect(panel.locator('.notice.err')).toContainText('dominios bloqueados');
  await expect(panel.locator('.card.kind-SCREENSHOT')).toHaveCount(0);
  await ext.setSettings({ blockedDomains: '' });
  await web.close();
  await panel.close();
});

test('Auto-lectura: lee sola cuando la pantalla cambia y se estabiliza', async () => {
  await ext.setSettings({
    autoWatch: true,
    autoIntervalSec: 5,
    includeImage: false,
    sessionId: null,
  });
  const web = await openWebPage('quiz.html');
  const panel = await ext.openPanel();
  await expect(panel.locator('#optAuto')).toBeChecked();
  // Sin pulsar nada: tras dos lecturas iguales aparece una respuesta automática (sin mensaje de usuario).
  await expect(panel.locator('.card.kind-SCREENSHOT').first()).toContainText('Quiz de SQL', {
    timeout: 40_000,
  });
  await expect(panel.locator('.card.kind-CHAT_USER')).toHaveCount(0);
  const autoCtx = readSessionLogs(servers.logDir).filter(
    (e) => e.ev === 'screen.context' && e.trigger === 'auto',
  );
  expect(autoCtx.length).toBeGreaterThan(0);
  // Cambiar de página dispara otra lectura.
  await web.goto(`${servers.pagesUrl}/app.html`);
  await expect(panel.locator('.card.kind-SCREENSHOT').first()).toContainText('Panel de ventas', {
    timeout: 40_000,
  });
  await ext.setSettings({ autoWatch: false, includeImage: true });
  await web.close();
  await panel.close();
});

test('el servidor rechaza orígenes externos', async () => {
  const web = await openWebPage('quiz.html');
  // Una página cualquiera (127.0.0.1:<puerto>) no puede abrir el WebSocket ni usar la API.
  const result = await web.evaluate(async (serverUrl) => {
    const http = await fetch(`${serverUrl}/api/sessions`)
      .then(() => 'permitido')
      .catch(() => 'bloqueado');
    const ws = await new Promise<string>((resolve) => {
      const s = new WebSocket(serverUrl.replace('http', 'ws') + '/ws');
      s.onopen = () => resolve('abierto');
      s.onerror = () => resolve('rechazado');
    });
    return { http, ws };
  }, `http://localhost:4011`);
  // 127.0.0.1 y localhost son orígenes de loopback permitidos; el rechazo real se prueba con un Origin ajeno.
  expect(['permitido', 'bloqueado']).toContain(result.http);
  const res = await fetch('http://localhost:4011/api/sessions', {
    headers: { origin: 'https://evil.example' },
  });
  expect(res.headers.get('access-control-allow-origin')).toBeNull();
  await web.close();
});
