import { defineConfig } from '@playwright/test';

// E2E de la extensión: carga dist/ en Chromium y habla con un servidor realtime simulado (puerto 4011).
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
});
