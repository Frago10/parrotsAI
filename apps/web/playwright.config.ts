import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// En el entorno de Claude Code on the web hay un Chromium preinstalado; en local se usa el de Playwright.
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(PREINSTALLED) ? PREINSTALLED : undefined);

// E2E contra los servidores de desarrollo ya levantados (web :3000 y realtime :4001) con proveedores simulados.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    launchOptions: { executablePath },
    permissions: ['microphone'],
  },
});
