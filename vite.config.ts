import { defineConfig } from 'vite';
import { execSync } from 'child_process';

export default defineConfig({
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
  define: {
    'import.meta.env.VITE_GIT_SHA': JSON.stringify(
      (() => {
        try {
          return execSync('git rev-parse --short HEAD').toString().trim();
        } catch {
          return 'unknown';
        }
      })()
    ),
  },
});
