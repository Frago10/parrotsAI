// Pruebas del lector de página sobre HTML real (sin extensión): qué ve, qué ignora y cómo lo ordena.
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { EXT_DIST, startServers, type TestServers } from './helpers';

let servers: TestServers;
let browser: Browser;
let readerSource: string;

test.beforeAll(async () => {
  servers = await startServers();
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(preinstalled) ? preinstalled : undefined),
  });
  readerSource = readFileSync(`${EXT_DIST}/pageReader.js`, 'utf8');
});
test.afterAll(async () => {
  await browser?.close();
  await servers?.stop();
});

async function readPage(page: Page, path: string) {
  await page.goto(`${servers.pagesUrl}/${path}`);
  // Igual que chrome.scripting: el script devuelve el valor de la última expresión.
  return page.evaluate(
    (src) => (0, eval)(src) as import('../src/pageReader').ReaderResult,
    readerSource,
  );
}

test('quiz: lee lo visible, ignora lo oculto y las contraseñas, y separa lo que está bajo el scroll', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const r = await readPage(page, 'quiz.html');
  expect(r.title).toContain('Quiz de SQL');
  expect(r.viewportText).toContain('¿Cuál es la diferencia entre INNER JOIN y LEFT JOIN?');
  expect(r.viewportText).toContain('LEFT JOIN conserva las filas sin pareja');
  expect(r.viewportText).not.toContain('TEXTO OCULTO');
  expect(r.viewportText).not.toContain('secreto123');
  expect(r.viewportText).not.toContain('debajo del scroll');
  expect(r.fullText).toContain('debajo del scroll');
  expect(r.fullText).not.toContain('TEXTO OCULTO');
  const labels = r.inputs.map((i) => `${i.label}|${i.type}|${i.value ?? ''}`);
  expect(labels).toContain('LEFT JOIN conserva las filas sin pareja|radio|seleccionado');
  expect(labels).toContain('Correo|email|ana@ejemplo.com');
  expect(r.inputs.some((i) => i.type === 'password')).toBe(false);
  expect(r.headings).toContain('Quiz de SQL');
  expect(r.scrollPct).toBe(0);
  await page.close();
});

test('quiz: tras hacer scroll, lo de abajo pasa a ser el texto visible', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`${servers.pagesUrl}/quiz.html`);
  await page.locator('#below').scrollIntoViewIfNeeded();
  const r = await page.evaluate(
    (src) => (0, eval)(src) as import('../src/pageReader').ReaderResult,
    readerSource,
  );
  expect(r.viewportText).toContain('¿Qué hace GROUP BY?');
  expect(r.viewportText).not.toContain('Pregunta 1 de 3');
  expect(r.scrollPct).toBeGreaterThan(90);
  await page.close();
});

test('app: tablas, código, alt de imágenes, select, textarea y shadow DOM', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
  const r = await readPage(page, 'app.html');
  expect(r.tables[0]).toContain('Producto | Precio | Unidades');
  expect(r.tables[0]).toContain('Plan Team | 149 | 35');
  expect(r.code[0]).toContain('def suma(a, b):');
  expect(r.code[0]).toContain("NameError: name 'c' is not defined");
  expect(r.images).toContain('Gráfico de ventas por mes');
  const plan = r.inputs.find((i) => i.label === 'Plan');
  expect(plan).toMatchObject({ type: 'select', value: 'Pro', options: ['Free', 'Pro', 'Team'] });
  expect(r.inputs.find((i) => i.label === 'Notas')?.value).toBe('Cliente pide descuento');
  expect(r.viewportText).toContain('Texto dentro de shadow DOM');
  expect(r.headings).toEqual(expect.arrayContaining(['Panel de ventas', 'Error en producción']));
  await page.close();
});

test('el texto seleccionado se envía aparte', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`${servers.pagesUrl}/quiz.html`);
  await page.locator('h1').selectText();
  const r = await page.evaluate(
    (src) => (0, eval)(src) as import('../src/pageReader').ReaderResult,
    readerSource,
  );
  expect(r.selection).toBe('Quiz de SQL');
  await page.close();
});
