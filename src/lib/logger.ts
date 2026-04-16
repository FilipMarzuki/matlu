/**
 * logger — thin wrapper around Better Stack (@logtail/browser).
 *
 * Usage anywhere in the client:
 *   import { log } from '../lib/logger';
 *   log.info('wave started', { wave: 3, enemies: 7 });
 *   log.error('hero died', { cause: 'BruteCarapace' });
 *
 * If VITE_BETTERSTACK_DSN is not set (local dev without the secret, or
 * Canvas/legacy renderers) every call falls back to console.* so development
 * is never blocked.
 *
 * Structured fields (the second argument) show up as searchable columns in the
 * Better Stack Live Tail and Saved Views — keep keys snake_case and values
 * primitive so they index correctly.
 */

import { Logtail } from '@logtail/browser';

type Fields = Record<string, unknown>;

// Initialise once at module load. The token is the "Source token" shown in
// Better Stack → Logs → your source (not the ingest URL).
const token    = import.meta.env.VITE_BETTERSTACK_DSN      as string | undefined;
const endpoint = import.meta.env.VITE_BETTERSTACK_ENDPOINT as string | undefined;

const logtail: Logtail | null = token
  ? new Logtail(token, endpoint ? { endpoint } : undefined)
  : null;

if (!logtail) {
  // Warn once so it's obvious in local dev that remote logging is off.
  console.info('[logger] VITE_BETTERSTACK_DSN not set — logging to console only');
}

function send(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  fields?: Fields,
): void {
  const payload = { ...fields };
  if (logtail) {
    logtail[level](message, payload);
  } else {
    console[level](`[matlu] ${message}`, payload);
  }
}

export const log = {
  debug: (msg: string, fields?: Fields) => send('debug', msg, fields),
  info:  (msg: string, fields?: Fields) => send('info',  msg, fields),
  warn:  (msg: string, fields?: Fields) => send('warn',  msg, fields),
  error: (msg: string, fields?: Fields) => send('error', msg, fields),
};

// ── Global error capture ──────────────────────────────────────────────────────
// Catches unhandled JS errors and promise rejections that would otherwise only
// appear in the browser console — sends them to Better Stack automatically.
// Runs only in the browser (Vite SSR guard), no-ops if logtail isn't configured.

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    send('error', 'unhandled_error', {
      message:  event.message,
      filename: event.filename,
      line:     event.lineno,
      col:      event.colno,
      stack:    event.error?.stack ?? '',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    send('error', 'unhandled_rejection', {
      message: String(event.reason),
      stack:   (event.reason as Error)?.stack ?? '',
    });
  });
}
