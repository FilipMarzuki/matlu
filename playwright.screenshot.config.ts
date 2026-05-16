import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for `npm run screenshot`.
 *
 * Runs screenshot capture specs against the Vite preview build in headed mode.
 * WebGL RenderTextures (terrain, ShimmerFilter) don't render correctly in
 * headless Chrome, so this config intentionally excludes `testIgnore` and is
 * always meant to be run with --headed.
 *
 * Requires a display (Xvfb or real monitor). See CLAUDE.md § Visual review.
 */
export default defineConfig({
  testDir:       './tests',
  testMatch:     ['**/screenshot.spec.ts', '**/screenshot-biomes.spec.ts'],
  fullyParallel: false,
  workers:       1,
  // GameScene.create() is heavy — allow generous timeout.
  timeout:       60_000,
  reporter:      'list',

  use: {
    baseURL: 'http://localhost:4173',
    trace:   'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use:  { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command:             'npm run preview',
    url:                 'http://localhost:4173',
    reuseExistingServer: true,
    timeout:             120_000,
  },
});
