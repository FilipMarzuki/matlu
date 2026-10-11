/**
 * The play API and the MCP server as one Vercel function (#1555, #1556).
 * scripts/build-artificer.mjs bundles this file, with the whole sim and its JSON content, into one
 * script at artificer/.vercel/output/functions/api/play.func/ (Vercel's Build Output API), and
 * routes /api/v1/* (the HTTP API) and /mcp (MCP, see mcp.ts) to it.
 *
 * It's a plain Node `(req, res)` handler, the shape Vercel's Node launcher calls and the same one
 * `http.createServer` takes, so the tests run it as a real local server. Everything about the API
 * itself is in api.ts; this file only turns HTTP into an ApiRequest and back:
 *
 * - CORS is open (`*`, no cookies): a player's page or tool on any site may call it.
 * - The address comes from `x-vercel-forwarded-for`, which Vercel's edge sets itself, so a client
 *   can't forge it (https://vercel.com/docs/headers/request-headers). See `ipOf`.
 * - The body is read up to the size limit and no further.
 * - The store is Supabase when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. Without them
 *   the API answers 503, never a quiet in-memory store that would lose every game. PLAY_STORE=memory
 *   asks for one on purpose, for local play.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle, memoryStore, LIMITS, type ApiDeps, type GameStore } from './api';
import { mcpFetch } from './mcp';
import { supabaseStore } from './supabase-store';

// MCP clients also send Accept, their session id and the protocol version, and must be able to
// read the session id back (Expose-Headers); browser-based MCP clients need all of it.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

/** MCP messages carry tool arguments, not big data: a cap well above any real call. */
const MCP_BODY_BYTES = 65_536;

type Env = Record<string, string | undefined>;

export function storeFromEnv(env: Env): GameStore | null {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return supabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return env.PLAY_STORE === 'memory' ? memoryStore() : null;
}

/** Make a handler; the default export uses the real environment. Tests pass their own (and a store to inspect). */
export function makeHandler(env: Env = process.env, deps?: Partial<ApiDeps>, givenStore?: GameStore) {
  // One store per handler, so per warm function instance: a cold start makes it, later requests reuse it.
  let store: GameStore | null | undefined = givenStore;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const send = (status: number, body: Record<string, unknown> | null, cache?: number): void => {
      // Most answers are one player's game and must never be cached. The run records are the same
      // for everyone, so Vercel's edge may keep them briefly (s-maxage) and serve them while it
      // fetches fresh ones in the background (stale-while-revalidate); browsers always ask again.
      const cacheControl = cache ? `public, max-age=0, s-maxage=${cache}, stale-while-revalidate=${cache * 5}` : 'no-store';
      res.writeHead(status, { ...CORS, 'Cache-Control': cacheControl, ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) });
      res.end(body ? JSON.stringify(body) : undefined);
    };
    try {
      if (req.method === 'OPTIONS') return send(204, null);
      if (store === undefined) store = storeFromEnv(env);
      if (!store) return send(503, { error: 'The play API isn\'t set up on this server yet.' });
      const mcp = isMcp(req.url ?? '/');
      const limit = mcp ? MCP_BODY_BYTES : LIMITS.bodyBytes;
      const body = await readBody(req, limit);
      if (body === null) return send(413, { error: `The body is over ${limit} bytes.` });
      const apiDeps: ApiDeps = {
        now: () => Date.now(),
        newId: () => crypto.randomUUID(),
        // Any server secret will do as the salt; the service key is one the owner already set.
        salt: env.PLAY_IP_SALT || env.SUPABASE_SERVICE_ROLE_KEY || '',
        ...deps,
      };
      const ip = ipOf(req, env.VERCEL === '1');
      if (mcp) return await sendWeb(res, await mcpFetch(webRequest(req, body), { ip, store, deps: apiDeps }));
      const r = await handle({ method: req.method ?? 'GET', path: pathOf(req.url ?? '/'), body, ip }, store, apiDeps);
      send(r.status, r.body, r.cache);
    } catch (e) {
      // The reason goes to the function's log; the player gets no internals.
      console.error('play API error', e);
      send(500, { error: 'Something went wrong on our side. Try again in a moment.' });
    }
  };
}

export default makeHandler();

/** Is this the MCP endpoint? Vercel's route sends /mcp here as /api/play?surface=mcp. */
export function isMcp(url: string): boolean {
  const u = new URL(url, 'http://x');
  return u.pathname === '/mcp' || u.pathname.startsWith('/mcp/') || u.searchParams.get('surface') === 'mcp';
}

/**
 * A web-standard Request for the MCP SDK, built from Node's request and the body already read.
 * Headers that describe the old connection, not the request, are left out; fetch sets its own.
 */
function webRequest(req: IncomingMessage, body: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || ['host', 'connection', 'content-length', 'transfer-encoding'].includes(k)) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const method = req.method ?? 'GET';
  return new Request(`https://${req.headers.host ?? 'localhost'}/mcp`, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body });
}

/** Write a web-standard Response (the MCP SDK's answer) to Node's response, with our CORS headers. */
async function sendWeb(res: ServerResponse, r: Response): Promise<void> {
  const headers: Record<string, string> = { ...CORS, 'Cache-Control': 'no-store' };
  r.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(r.status, headers);
  // Copied through as it comes rather than read whole: an answer is usually one message, but an
  // event stream (text/event-stream) only ends when the server ends it.
  if (r.body) {
    const reader = r.body.getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) res.write(chunk.value);
  }
  res.end();
}

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

/**
 * The player's address. On Vercel (which sets VERCEL=1) its edge writes these headers itself and
 * overwrites any a client sent; x-vercel-forwarded-for also survives a proxy in front of Vercel, so
 * it comes first. Off Vercel (tests, local play) headers are anyone's to write, and the socket's
 * peer is the real address. x-real-ip is never read.
 */
function ipOf(req: IncomingMessage, onVercel: boolean): string {
  const header = (name: string): string | undefined => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim() || undefined;
  };
  if (onVercel) return header('x-vercel-forwarded-for') ?? header('x-forwarded-for') ?? 'unknown';
  return req.socket.remoteAddress ?? 'unknown';
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
