import { defineConfig } from 'vitest/config';

// Los E2E (Playwright) viven en e2e/ y se ejecutan con "pnpm --filter @callpilot/extension e2e".
export default defineConfig({
  test: { exclude: ['e2e/**', 'node_modules/**', 'dist/**'], passWithNoTests: true },
});
