/**
 * The Artificer as a remote MCP server (#1556, plan: docs/spikes/artificer-play-api.md): anyone
 * adds https://artificer.corewarden.app/mcp to their AI (a claude.ai custom connector, or any
 * client that speaks MCP over HTTP) and the AI plays, one move per tool call, on its own tokens.
 *
 * MCP (Model Context Protocol) is how AI apps call tools on outside servers: the client asks for
 * the list of tools (names, descriptions, input schemas), the model picks one, and the client
 * sends the call as JSON-RPC over HTTP. The official SDK (@modelcontextprotocol/server) speaks
 * the protocol, both the 2025 revisions and 2026-07-28; this file only says what the tools are.
 *
 * Every tool goes through `handle()` in api.ts, as an HTTP request would. So MCP games are stored
 * in the same table, keep the seed on the server, and count toward the same limits.
 *
 * Stateless, so it fits a serverless function: each HTTP request gets a fresh server from the
 * factory, and the game lives in the store, named by the `game_id` the AI passes back each time.
 *
 * Which client is playing (MCP's `clientInfo`) is stored with the game. A 2026-07-28 client sends
 * it with every request. A 2025-era client sends it once, in `initialize`; a stateless server
 * forgets it by the next request, so the reply to `initialize` carries it back in the
 * `Mcp-Session-Id` header, which those clients repeat on every later request. Clients can write
 * anything there, which is fine: like the model name, it's a label, not a credential.
 */

import { McpServer, createMcpHandler, CLIENT_INFO_META_KEY, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { handle, type ApiDeps, type ApiResponse, type GameStore } from './api';
import { GAME_VERSION, type Move, type MoveOption } from './session';

export interface McpOptions {
  /** The player's address (as the HTTP API takes it), for the per-address limits. */
  ip: string;
  store: GameStore;
  deps?: ApiDeps;
}

/** Answer one MCP request (a web-standard Request), as a web-standard Response. */
export async function mcpFetch(request: Request, opts: McpOptions): Promise<Response> {
  const initClient = await initializeClientName(request);
  // A fresh handler per request: it holds nothing between requests anyway, and this way the
  // tools close over this request's address and client.
  const handler = createMcpHandler(ctx => buildServer(opts, ctx.requestInfo ?? request));
  const res = await handler.fetch(request);
  if (initClient === null || res.headers.has('mcp-session-id')) return res;
  const headers = new Headers(res.headers);
  headers.set('Mcp-Session-Id', sessionIdFor(initClient));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const INSTRUCTIONS = [
  'You are playing "Greywind Reach", the first region of the Artificer: a Warden alone in a mountain valley',
  'with 30 days of autumn to prepare for a 60-night winter. Survive to the thaw; then a caravan may take you on.',
  'Start with new_game and keep its game_id: every other tool needs it. look shows everything you know and the',
  'moves open now; act makes one move and answers with what changed. Call rules once for how the world works.',
].join(' ');

function buildServer(opts: McpOptions, request: Request): McpServer {
  const server = new McpServer(
    { name: 'artificer', title: 'The Artificer: Greywind Reach', version: GAME_VERSION },
    { instructions: INSTRUCTIONS },
  );
  // Every call says it comes from MCP, so the games it starts are recorded as played here (#1558).
  const call = (method: string, path: string, body?: unknown): Promise<ApiResponse> =>
    handle({ method, path, body: body === undefined ? undefined : JSON.stringify(body), ip: opts.ip, surface: 'mcp' }, opts.store, opts.deps);
  const after = (r: ApiResponse): CallToolResult => afterMove(r, request.url);
  const gameId = z.string().describe('The game_id new_game gave you.');

  server.registerTool('new_game', {
    title: 'Start a game',
    description: 'Start a new game of Greywind Reach. Returns its game_id (pass it to every other tool), the opening view and the moves open now.',
    inputSchema: z.object({
      name: z.string().max(24).optional().describe("Your Warden's name, shown on the records (default: Warden)."),
      model: z.string().max(64).optional().describe('Which AI model is playing, if you know. Shown on the records as self-reported.'),
    }),
  }, async ({ name, model }, ctx) => {
    const r = await call('POST', '/api/v1/games', { name, model, client: clientName(ctx.mcpReq.envelope, request) });
    if (r.status !== 201) return failure(r);
    const b = gameBody(r);
    return text(`Game started. game_id: ${b.id}\nPass this game_id to every other tool.\n\n${b.text}\n\n${movesBlock(b.moves)}`);
  });

  server.registerTool('look', {
    title: 'Look around',
    description: 'The full view of a game: day, body, stores, camp, what you know of the land, people met, and the moves open now. Call it when you need the whole picture; act only reports what changed.',
    inputSchema: z.object({ game_id: gameId }),
    annotations: { readOnlyHint: true },
  }, async ({ game_id }) => {
    const r = await call('GET', `/api/v1/games/${encodeURIComponent(game_id)}`);
    if (r.status !== 200) return failure(r);
    const b = gameBody(r);
    return text(`${b.text}\n\n${movesBlock(b.moves)}`);
  });

  server.registerTool('act', {
    title: 'Make one move',
    description: [
      'Make one move. move is an action id from the moves list, such as "scout", "water" or "gather@2" (ring 2),',
      'or "end_day" to sleep, or any move exactly as the moves list shows it (a JSON object). Free settings take',
      'no hours: {"set": {"eating": "full" | "half" | "none"}}, {"set": {"focus": "goal:larder" | "none"}},',
      '{"set": {"site": "cave"}}. Answers with what changed and a status line; in an encounter or on the road it',
      'also shows the options. A refused move changes nothing and says why.',
    ].join(' '),
    inputSchema: z.object({
      game_id: gameId,
      move: z.union([z.string(), z.record(z.string(), z.unknown())]).describe('An action id like "scout", "end_day", or a move object from the list.'),
    }),
  }, async ({ game_id, move }) => after(await call('POST', movesPath(game_id), { move: toMove(move) })));

  server.registerTool('plan_day', {
    title: 'Plan a whole day',
    description: 'Queue a whole day of actions in order, run them, and sleep. Only once the Warden has learned to plan (the view says when); until then, use act one move at a time.',
    inputSchema: z.object({
      game_id: gameId,
      actions: z.array(z.string()).min(1).max(40).describe('Action ids in order, such as ["water", "gather", "wood"].'),
    }),
  }, async ({ game_id, actions }) => after(await call('POST', movesPath(game_id), { move: { plan: actions } })));

  server.registerTool('choose', {
    title: 'Answer an encounter',
    description: 'Pick an option in an encounter, a meeting or on the road: the option id from the moves list (the "choose" value).',
    inputSchema: z.object({ game_id: gameId, option: z.string().describe('The option id, e.g. "help" or "board".') }),
  }, async ({ game_id, option }) => after(await call('POST', movesPath(game_id), { move: { choose: option } })));

  server.registerTool('rules', {
    title: 'Read the rules',
    description: 'How Greywind Reach works: seasons, the body, stores, building, the land in rings, the caravan and the road. Read it once at the start.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    const r = await call('GET', '/api/v1/rules');
    if (r.status !== 200) return failure(r);
    const b = r.body as { rules: string; roadRules: string };
    return text(`${b.rules}\n\nON THE ROAD\n${b.roadRules}`);
  });

  return server;
}

// ── Turning API answers into tool results ───────────────────────────────────

interface GameBody { id: string; phase: string; status: string; text: string; moves: MoveOption[]; changed?: string[]; record?: string }

const movesPath = (id: string): string => `/api/v1/games/${encodeURIComponent(id)}/moves`;
/** The API's body for a game (its shape is api.ts's gameBody). */
const gameBody = (r: ApiResponse): GameBody => r.body as unknown as GameBody;
const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] });

/** A refused or failed call: the reason, plus the open moves when the game said what they are. */
function failure(r: ApiResponse): CallToolResult {
  const b = r.body as { error?: string; moves?: MoveOption[] };
  const why = r.status === 422 ? `Refused: ${b.error}` : `Error (${r.status}): ${b.error ?? 'unknown'}`;
  return { content: [{ type: 'text', text: b.moves?.length ? `${why}\n\n${movesBlock(b.moves)}` : why }], isError: true };
}

/**
 * After a move: what changed and the status line, kept short because it lands in the player's
 * context every turn. When the game wants a choice (an encounter, the meeting, the road) or has
 * ended, the full view comes too, since the next call depends on it.
 */
function afterMove(r: ApiResponse, base: string): CallToolResult {
  if (r.status !== 200) return failure(r);
  const b = gameBody(r);
  const changed = b.changed?.length ? b.changed.join('\n') : '(nothing new)';
  const head = `${changed}\n\n${b.status}`;
  if (b.phase === 'day') return text(`${head}\n(look shows the full view and the moves open now.)`);
  // A finished run has a record (#1558): a full link, for the player's AI to pass on to them.
  const record = b.record ? `\n\nHow this run compares with everyone's: ${new URL(b.record, base).href}` : '';
  return text(`${head}\n\n${b.text}${b.moves.length ? `\n\n${movesBlock(b.moves)}` : ''}${record}`);
}

function movesBlock(moves: MoveOption[]): string {
  if (!moves.length) return 'No moves left: the run is over.';
  const lines = moves.map(m => `- ${JSON.stringify(m.move)}  ${m.label}${m.hours !== undefined ? ` (${m.hours}h)` : ''}`);
  return `MOVES NOW (pass one to act, or just its action id):\n${lines.join('\n')}`;
}

/** The act tool's move: a shorthand string or a move object as listed. The API checks the shape. */
export function toMove(input: string | Record<string, unknown>): Move {
  if (typeof input !== 'string') return input as Move;
  const s = input.trim();
  if (/^(end[ _-]?(the[ _-]?)?day|sleep)$/i.test(s)) return { endDay: true };
  return { do: s };
}

// ── Which client is playing ──────────────────────────────────────────────────

const SESSION_PREFIX = 'artificer';

/** The client's name: from the 2026-07-28 envelope, else from the session id we handed out. */
function clientName(envelope: Record<string, unknown> | undefined, request: Request): string | null {
  const fromEnvelope = nameOf(envelope?.[CLIENT_INFO_META_KEY]);
  return fromEnvelope ?? clientFromSessionId(request.headers.get('mcp-session-id'));
}

function nameOf(info: unknown): string | null {
  const name = info && typeof info === 'object' ? (info as { name?: unknown }).name : undefined;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 64) : null;
}

/** artificer.<client name, base64url>.<random>: the random part keeps two players' ids apart. */
export function sessionIdFor(client: string): string {
  return `${SESSION_PREFIX}.${Buffer.from(client).toString('base64url')}.${crypto.randomUUID().slice(0, 8)}`;
}

export function clientFromSessionId(id: string | null): string | null {
  const [prefix, encoded] = id?.split('.') ?? [];
  if (prefix !== SESSION_PREFIX || !encoded) return null;
  try {
    return nameOf({ name: Buffer.from(encoded, 'base64url').toString('utf8') });
  } catch {
    return null;
  }
}

/** If this request is a 2025-era `initialize`, the client's name; otherwise null. */
async function initializeClientName(request: Request): Promise<string | null> {
  if (request.method !== 'POST') return null;
  try {
    const msg = (await request.clone().json()) as unknown;
    const init = (Array.isArray(msg) ? msg : [msg]).find(m => (m as { method?: unknown })?.method === 'initialize') as
      | { params?: { clientInfo?: unknown } }
      | undefined;
    return init ? nameOf(init.params?.clientInfo) ?? 'unknown client' : null;
  } catch {
    return null;
  }
}
