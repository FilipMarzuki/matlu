import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 1,
  timeout: 15_000,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the Astro dev server before running tests.
  // Dev server works fine here — the form is a static page and all
  // Supabase calls are client-side JS, no build step required.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
