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
import { experimentalOn } from '../artificer/features';
import { achievementLines, type Achievement } from './achievements';
import { makeT, LANGS, type Lang, type T } from '../artificer/i18n';

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
  'You are playing the Artificer: a Warden alone in an unnamed mountain valley,',
  'with 30 days of autumn to prepare for a 60-night winter. Survive to the thaw; then a caravan may take you on.',
  'Start with new_game and keep its game_id: every other tool needs it. look shows everything you know and the',
  'moves open now; act makes one move and answers with what changed. Call rules once for how the world works.',
].join(' ');

function buildServer(opts: McpOptions, request: Request): McpServer {
  const server = new McpServer(
    { name: 'artificer', title: 'The Artificer', version: GAME_VERSION },
    { instructions: INSTRUCTIONS },
  );
  // Every call says it comes from MCP, so the games it starts are recorded as played here (#1558).
  const call = (method: string, path: string, body?: unknown): Promise<ApiResponse> =>
    handle({ method, path, body: body === undefined ? undefined : JSON.stringify(body), ip: opts.ip, surface: 'mcp' }, opts.store, opts.deps);
  const after = (r: ApiResponse): CallToolResult => afterMove(r, request.url);
  const gameId = z.string().describe('The game_id new_game gave you.');

  server.registerTool('new_game', {
    title: 'Start a game',
    description: 'Start a new game of the Artificer, on a fresh world or (weekly: true) this week\'s shared one. Returns its game_id (pass it to every other tool), the opening view and the moves open now.',
    inputSchema: z.object({
      name: z.string().max(24).optional().describe("Your Warden's name, shown on the records (default: Warden)."),
      model: z.string().max(64).optional().describe('Which AI model is playing, if you know. Shown on the records as self-reported.'),
      features: z.record(z.string(), z.boolean()).optional().describe('Switch experimental rule features for this game, e.g. {"free-questions": false}. The rules tool lists them; leave out for the defaults.'),
      weekly: z.boolean().optional().describe("true to play this week's world: the same world (weather, encounters) for everyone, people and AIs, this week, so its runs compare fairly. Leave out for a fresh world."),
      // Any string, so an unknown language gets the API's own refusal (a 400 that names the ones there are).
      lang: z.string().optional().describe(`The language of the game's text: ${LANGS.map(l => `"${l}"`).join(' or ')}. Leave out for English (the default). Only the words change: the same game in each.`),
      // Any numbers, so a spread that isn't a legal point-buy gets the API's own refusal, which says the rules.
      stats: z.record(z.string(), z.number()).optional().describe('Your stats, as the creation screen\'s point-buy: {"str":12,"con":11,"agi":10,"int":10,"wil":10,"cha":10}. Each starts at 10, 6 points to spend (1 per step to 13, 2 above), lower one to 7 to buy more. Points left unspent are allowed and raise the difficulty multiplier the run records (+0.10 each). Leave out for a quick start: all 10s, recorded as ×1.00.'),
    }),
  }, async ({ name, model, features, weekly, lang, stats }, ctx) => {
    const r = await call('POST', '/api/v1/games', { name, model, features, ...(weekly ? { weekly: true } : {}), ...(lang !== undefined ? { lang } : {}), ...(stats !== undefined ? { stats } : {}), client: clientName(ctx.mcpReq.envelope, request) });
    if (r.status !== 201) return failure(r);
    const b = gameBody(r);
    const t = tOf(b);
    const world = b.week ? `${t ? t('api.mcp.weekly', { week: b.week }) : `This is the weekly world, ${b.week}: everyone who plays this week plays the same one.`}\n` : '';
    const started = t ? t('api.mcp.started', { id: b.id }) : `Game started. game_id: ${b.id}\nPass this game_id to every other tool.`;
    return text(`${started}\n${world}${featuresLine(b.features, t)}\n${b.text}\n\n${movesBlock(b.moves, t)}`);
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
    return text(`${b.text}\n\n${movesBlock(b.moves, tOf(b))}`);
  });

  server.registerTool('act', {
    title: 'Make one move',
    description: [
      'Make one move. move is an action id from the moves list, such as "explore", "water" or "gather@2" (ring 2),',
      'or "end_day" to sleep, or any move exactly as the moves list shows it (a JSON object). Free settings take',
      'no hours: {"set": {"eating": "full" | "half" | "none"}}, {"set": {"focus": "goal:larder" | "none"}},',
      '{"set": {"site": "cave"}}. Gathering can take a length when the game has the action-length feature:',
      '{"do": {"q": "wood@2", "hours": 3}} (walks included) or {"do": {"q": "wood", "until": 10}}.',
      'Answers with what changed and a status line; in an encounter or on the road it',
      'also shows the options. A refused move changes nothing and says why.',
    ].join(' '),
    inputSchema: z.object({
      game_id: gameId,
      move: z.union([z.string(), z.record(z.string(), z.unknown())]).describe('An action id like "explore", "end_day", or a move object from the list.'),
    }),
  }, async ({ game_id, move }) => after(await call('POST', movesPath(game_id), { move: toMove(move) })));

  server.registerTool('plan_day', {
    title: 'Plan a whole day',
    description: 'Queue a whole day of actions in order, run them, and sleep. Only once the Warden has learned to plan (the view says when); until then, use act one move at a time.',
    inputSchema: z.object({
      game_id: gameId,
      actions: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).min(1).max(40).describe('Action ids in order, such as ["water", "gather", "wood"]. With the action-length feature, a gathering action can take a length: {"q": "wood@2", "hours": 3} or {"q": "wood", "until": 10}.'),
      stop: z.object({ action: z.number().int().min(0), hours: z.number().min(0) }).optional().describe('With the stop-action feature: stop the plan\'s action `action` (from 0) `hours` into it. It keeps what it had got by then (the view\'s STOPPING line says what), and the day pauses after it, with no night.'),
    }),
  }, async ({ game_id, actions, stop }) => after(await call('POST', movesPath(game_id), { move: { plan: actions, ...(stop ? { stop } : {}) } })));

  server.registerTool('choose', {
    title: 'Answer an encounter',
    description: 'Pick an option in an encounter, a meeting or on the road: the option id from the moves list (the "choose" value).',
    inputSchema: z.object({ game_id: gameId, option: z.string().describe('The option id, e.g. "help" or "board".') }),
  }, async ({ game_id, option }) => after(await call('POST', movesPath(game_id), { move: { choose: option } })));

  server.registerTool('ask_question', {
    title: 'Ask someone a question',
    description: [
      'On the road: ask someone here one question in your own words, once per person per stay, up to 200',
      'characters. They answer from what they know, or say they can\'t; the view says how far trust matters in this game, and lists who',
      'can still be asked. Questions are kept to improve the game, with nothing about the player: never put',
      'anyone\'s name, age or details in one.',
    ].join(' '),
    inputSchema: z.object({
      game_id: gameId,
      person: z.string().describe('The person id from the view, e.g. "hf-orrin".'),
      question: z.string().describe('The question, e.g. "Where does the iron here come from?"'),
    }),
  }, async ({ game_id, person, question }) => after(await call('POST', movesPath(game_id), { move: { ask: { person, question } } })));

  server.registerTool('rules', {
    title: 'Read the rules',
    description: 'How the Artificer works: seasons, the body, stores, building, the land in rings, the caravan and the road. Read it once at the start.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    const r = await call('GET', '/api/v1/rules');
    if (r.status !== 200) return failure(r);
    const b = r.body as { rules: string; roadRules: string; features?: { id: string; name: string; note: string; stage: string; default: boolean }[] };
    const features = (b.features ?? []).map(f => `- ${f.id} (${f.stage}, ${f.default ? 'on' : 'off'} by default): ${f.name}. ${f.note}`).join('\n');
    return text(`${b.rules}\n\nON THE ROAD\n${b.roadRules}${features ? `\n\nFEATURES (switch them at new_game)\n${features}` : ''}`);
  });

  return server;
}

// ── Turning API answers into tool results ───────────────────────────────────

interface GameBody { id: string; phase: string; status: string; text: string; moves: MoveOption[]; changed?: string[]; record?: string; features?: Record<string, boolean>; achievements?: Achievement[]; week?: string; lang?: Lang }

/**
 * The catalog for a game in another language (#1713), for the lines this file writes around its
 * text; null for an English game, whose lines stay exactly as they were.
 */
const tOf = (b: { lang?: Lang }): T | null => (b.lang && b.lang !== 'en' ? makeT(b.lang) : null);

/** Which experimental features this game plays with (#1579), as a line under its id; empty if none. */
function featuresLine(features: Record<string, boolean> | undefined, t: T | null = null): string {
  const on = experimentalOn(features);
  if (!on.length) return '';
  // In another language (#1713) by id, the way new_game takes them: the features' names are English only.
  return t ? `${t('api.mcp.features', { ids: on.map(f => `"${f.id}"`).join(', ') })}\n` : `Experimental features on in this game: ${on.map(f => f.name).join(', ')}.\n`;
}

const movesPath = (id: string): string => `/api/v1/games/${encodeURIComponent(id)}/moves`;
/** The API's body for a game (its shape is api.ts's gameBody). */
const gameBody = (r: ApiResponse): GameBody => r.body as unknown as GameBody;
const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] });

/** A refused or failed call: the reason, plus the open moves when the game said what they are. */
function failure(r: ApiResponse): CallToolResult {
  const b = r.body as { error?: string; moves?: MoveOption[]; lang?: Lang };
  const t = tOf(b);
  const why = r.status === 422 ? (t ? t('api.mcp.refused', { why: b.error ?? '' }) : `Refused: ${b.error}`) : `Error (${r.status}): ${b.error ?? 'unknown'}`;
  return { content: [{ type: 'text', text: b.moves?.length ? `${why}\n\n${movesBlock(b.moves, t)}` : why }], isError: true };
}

/**
 * After a move: what changed and the status line, kept short because it lands in the player's
 * context every turn. When the game wants a choice (an encounter, the meeting, the road) or has
 * ended, the full view comes too, since the next call depends on it.
 */
function afterMove(r: ApiResponse, base: string): CallToolResult {
  if (r.status !== 200) return failure(r);
  const b = gameBody(r);
  const t = tOf(b);
  const changed = b.changed?.length ? b.changed.join('\n') : t ? t('api.mcp.nothingNew') : '(nothing new)';
  const head = `${changed}\n\n${b.status}`;
  if (b.phase === 'day') return text(`${head}\n${t ? t('api.mcp.lookHint') : '(look shows the full view and the moves open now.)'}`);
  // A finished run has a record (#1558): a full link, for the player's AI to pass on to them, and
  // the achievements it earned against everyone's records (#1559).
  const earned = b.achievements ? achievementLines(b.achievements) : [];
  const achieved = b.achievements ? `\n\n${earned.length ? `Achievements earned:\n${earned.map(l => `- ${l}`).join('\n')}` : 'No achievements this run.'}` : '';
  const record = b.record ? `\n\nHow this run compares with everyone's: ${new URL(b.record, base).href}` : '';
  return text(`${head}\n\n${b.text}${b.moves.length ? `\n\n${movesBlock(b.moves, t)}` : ''}${achieved}${record}`);
}

function movesBlock(moves: MoveOption[], t: T | null = null): string {
  if (!moves.length) return t ? t('api.mcp.noMoves') : 'No moves left: the run is over.';
  const lines = moves.map(m => `- ${JSON.stringify(m.move)}  ${m.label}${m.hours !== undefined ? ` (${m.hours}h)` : ''}`);
  return `${t ? t('api.mcp.moves') : 'MOVES NOW (pass one to act, or just its action id):'}\n${lines.join('\n')}`;
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
