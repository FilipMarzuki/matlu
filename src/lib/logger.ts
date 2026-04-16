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

// ── Global error + console capture ───────────────────────────────────────────
// Forwards unhandled errors, unhandled rejections, and console.warn/error calls
// to Better Stack. Deduplication prevents the same message flooding the log —
// each unique message string is only forwarded once per page session.

if (typeof window !== 'undefined') {
  const seen = new Set<string>();

  const forward = (level: 'warn' | 'error', message: string, extra?: Fields): void => {
    if (seen.has(message)) return;
    seen.add(message);
    send(level, message, extra);
  };

  // Unhandled JS errors (crashes)
  window.addEventListener('error', (event) => {
    forward('error', 'unhandled_error', {
      message:  event.message,
      filename: event.filename,
      line:     event.lineno,
      col:      event.colno,
      stack:    event.error?.stack ?? '',
    });
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    forward('error', 'unhandled_rejection', {
      message: String(event.reason),
      stack:   (event.reason as Error)?.stack ?? '',
    });
  });

  // console.warn and console.error — captures Phaser warnings and other
  // library noise, but only the first occurrence of each unique message.
  const _warn  = console.warn.bind(console);
  const _error = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    _warn(...args);
    forward('warn', args.map(String).join(' ').slice(0, 300));
  };

  console.error = (...args: unknown[]) => {
    _error(...args);
    forward('error', args.map(String).join(' ').slice(0, 300));
  };
}
