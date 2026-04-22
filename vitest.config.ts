import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only pick up test files under src/, wiki/src/, and dev/src/.
    // Excluding tests/ prevents Vitest from picking up Playwright specs, which
    // use a different test() API and would throw at runtime.
    include: ['src/**/*.test.ts', 'wiki/src/**/*.test.ts', 'dev/src/**/*.test.ts'],
  },
});
