import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for `npm run arena:testplay`.
 *
 * Runs only arena-testplay.spec.ts against the Vite preview build (headless).
 * Uses a generous timeout because the spec simulates 90 s of game time via
 * sys.step(), which takes ~30–60 s of real time depending on the machine.
 *
 * For GPU-accurate screenshots (ShimmerFilter, sprite colours), use:
 *   npm run arena:testplay:headed
 */
export default defineConfig({
  testDir:       './tests',
  testMatch:     ['**/arena-testplay.spec.ts'],
  fullyParallel: false,
  workers:       1,
  // Arena boot (~8 s) + 90 s sim + screenshot overhead → 3 min should be enough.
  timeout:       180_000,
  reporter:      process.env['CI'] ? 'github' : 'list',

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
    reuseExistingServer: !process.env['CI'],
    timeout:             120_000,
  },
});
