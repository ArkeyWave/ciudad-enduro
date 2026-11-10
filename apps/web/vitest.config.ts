import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e/ belongs to Playwright.
    include: ['src/**/*.test.ts', '*.test.ts'],
    maxWorkers: 4,
  },
});
