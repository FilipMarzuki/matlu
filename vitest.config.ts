import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only pick up test files under src/. Without this, Vitest's default glob
    // also finds tests/ which contains Playwright specs — those use a different
    // test() API and will throw "Playwright Test did not expect test() to be
    // called here."
    include: ['src/**/*.test.ts'],
  },
});
