/**
 * The play API as a Vercel function (#1555). scripts/build-artificer.mjs bundles this file, with
 * the whole sim and its JSON content, into one script at
 * artificer/.vercel/output/functions/api/play.func/ (Vercel's Build Output API), and routes
 * /api/v1/* to it.
 *
 * It's a plain Node `(req, res)` handler, the shape Vercel's Node launcher calls and the same one
 * `http.createServer` takes, so the tests run it as a real local server. Everything about the API
 * itself is in api.ts; this file only turns HTTP into an ApiRequest and back:
 *
 * - CORS is open (`*`, no cookies): a player's page or tool on any site may call it.
 * - The address comes from `x-real-ip`, which Vercel sets itself (a client can't forge it there).
 * - The body is read up to the size limit and no further.
 * - The store is Supabase when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. Without them
 *   the API answers 503, never a quiet in-memory store that would lose every game. PLAY_STORE=memory
 *   asks for one on purpose, for local play.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle, memoryStore, LIMITS, type ApiDeps, type GameStore } from './api';
import { supabaseStore } from './supabase-store';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

type Env = Record<string, string | undefined>;

export function storeFromEnv(env: Env): GameStore | null {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return supabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return env.PLAY_STORE === 'memory' ? memoryStore() : null;
}

/** Make a handler; the default export uses the real environment. Tests pass their own. */
export function makeHandler(env: Env = process.env, deps?: Partial<ApiDeps>) {
  // One store per handler, so per warm function instance: a cold start makes it, later requests reuse it.
  let store: GameStore | null | undefined;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const send = (status: number, body: Record<string, unknown> | null): void => {
      res.writeHead(status, { ...CORS, 'Cache-Control': 'no-store', ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) });
      res.end(body ? JSON.stringify(body) : undefined);
    };
    try {
      if (req.method === 'OPTIONS') return send(204, null);
      if (store === undefined) store = storeFromEnv(env);
      if (!store) return send(503, { error: 'The play API isn\'t set up on this server yet.' });
      const body = await readBody(req, LIMITS.bodyBytes);
      if (body === null) return send(413, { error: `The body is over ${LIMITS.bodyBytes} bytes.` });
      const r = await handle(
        { method: req.method ?? 'GET', path: pathOf(req.url ?? '/'), body, ip: ipOf(req) },
        store,
        {
          now: () => Date.now(),
          newId: () => crypto.randomUUID(),
          // Any server secret will do as the salt; the service key is one the owner already set.
          salt: env.PLAY_IP_SALT || env.SUPABASE_SERVICE_ROLE_KEY || '',
          ...deps,
        },
      );
      send(r.status, r.body);
    } catch (e) {
      // The reason goes to the function's log; the player gets no internals.
      console.error('play API error', e);
      send(500, { error: 'Something went wrong on our side. Try again in a moment.' });
    }
  };
}

export default makeHandler();

/**
 * The API path asked for. Vercel's route sends /api/v1/<rest> here as /api/play?path=<rest>, in case
 * the function sees the rewritten URL rather than the one asked for; a direct call keeps its own.
 */
export function pathOf(url: string): string {
  const u = new URL(url, 'http://x');
  if (u.pathname.startsWith('/api/v1')) return u.pathname;
  const rest = u.searchParams.get('path');
  return rest !== null ? `/api/v1/${rest.replace(/^\/+/, '')}` : u.pathname;
}

function ipOf(req: IncomingMessage): string {
  const header = (name: string): string | undefined => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim() || undefined;
  };
  return header('x-real-ip') ?? header('x-forwarded-for') ?? req.socket.remoteAddress ?? 'unknown';
}

/** The body as text, or null once it passes `max` bytes (the rest is drained, not kept). */
function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (c: Buffer): void => {
      size += c.length;
      if (size > max) {
        // Stop keeping it, but let the rest drain: the connection must stay open for the 413.
        req.off('data', onData);
        req.resume();
        resolve(null);
        return;
      }
      chunks.push(c);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
