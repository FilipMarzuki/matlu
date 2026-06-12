import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Some specs are analysis/capture tools, not pass/fail CI gates. They're run
  // deliberately via their own npm scripts (and, where needed, their own config),
  // so exclude them from the default `npm test` / CI run:
  //   - screenshot.spec.ts     — visual capture; needs --headed (WebGL
  //     RenderTextures don't render headless). Run via `npm run screenshot`.
  //   - arena-testplay.spec.ts — a 300 sim-second balance report that writes a
  //     JSON report + screenshots. It's intentionally slow and exceeds this
  //     config's 120 s CI timeout, so it has its own playwright.arena-testplay
  //     .config.ts (180 s) run via `npm run arena:testplay`. Gating CI on it just
  //     flakes on the wall-clock timeout.
  testIgnore: ['**/screenshot.spec.ts', '**/arena-testplay.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  // GameScene.create() renders ~62 500 terrain tiles — allow generous timeout in CI.
  timeout: process.env['CI'] ? 120_000 : 30_000,
  reporter: process.env['CI'] ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start Vite preview build before running tests
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
