import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // screenshot.spec.ts is a visual capture tool, not a pass/fail test suite.
  // It requires --headed mode (WebGL RenderTextures don't render in headless Chrome)
  // and is meant to be run manually via `npm run screenshot`, not in CI.
  testIgnore: process.env['PLAYWRIGHT_INCLUDE_SCREENSHOTS'] === '1'
    ? []
    : ['**/screenshot.spec.ts'],
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
