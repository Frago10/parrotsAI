import { defineConfig } from 'vitest/config';

// Los tests E2E (Playwright) viven en e2e/ y no deben ejecutarse con Vitest.
export default defineConfig({
  test: { exclude: ['e2e/**', 'node_modules/**', '.next/**'], passWithNoTests: true },
});
