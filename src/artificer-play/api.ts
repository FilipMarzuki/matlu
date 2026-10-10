/**
 * The play API (#1555, plan: docs/spikes/artificer-play-api.md): the session core (session.ts)
 * behind HTTP, with games stored on our side.
 *
 *   POST /api/v1/games               start a game          { name?, client? } → 201 view
 *   GET  /api/v1/games/:id           view it               → 200 view
 *   POST /api/v1/games/:id/moves     apply one move        { move } → 200 changed + view | 422 why
 *   GET  /api/v1/rules               the rules text        → 200
 *
 * Nothing here knows about Vercel or Supabase: `handle` takes a request, a store and a clock, and
 * returns a status and a body. The Vercel function (vercel-handler.ts) wires it to the real store;
 * tests use `memoryStore`. That keeps every rule of the API testable without a network.
 *
 * Two things never leave the server:
 * - The seed. A session's id seeds its world, and the sim's code is public, so anyone holding it
 *   could run the world ahead and see the weather and encounters coming. Players get a separate
 *   random game id.
 * - The player's address. It's kept only as a salted hash, for the per-address limits.
 */

import { createHash } from 'node:crypto';
import { RULES, ROAD_RULES } from '../artificer-ai/observe';
import { startGame, view, apply, serialize, deserialize, GAME_VERSION, type Move, type Phase, type View } from './session';

/** A stored game. `session` is the serialized session, seed included: it never goes out. */
export interface GameRecord {
  id: string;
  version: string;
  session: string;
  moves: Move[];
  phase: Phase;
  name: string;
  /** The client's own name, if it gave one (e.g. an MCP client's `clientInfo.name`). */
  client: string | null;
  /** A salted hash of the address that started it, for the daily limit. */
  ipKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface GameStore {
  insert(g: GameRecord): Promise<void>;
  get(id: string): Promise<GameRecord | null>;
  /**
   * Save a game, but only if it still has `movesBefore` moves: two moves sent at once on one game
   * would otherwise both apply to the same state and one would be lost. False if it had moved on.
   */
  update(g: GameRecord, movesBefore: number): Promise<boolean>;
  /** Games started by this address since this time (ISO). */
  countStartedSince(ipKey: string, sinceIso: string): Promise<number>;
  /** Count one move by this address on this UTC day (YYYY-MM-DD) and return its moves that day, this one included. */
  countMove(ipKey: string, day: string): Promise<number>;
}

export interface ApiRequest {
  method: string;
  path: string;
  /** The raw body, so its size can be checked before it's parsed. */
  body?: string;
  ip: string;
}

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface ApiDeps {
  now: () => number;
  newId: () => string;
  /** Mixed into address hashes, so a stored hash can't be matched against a list of addresses. */
  salt?: string;
  /** A new game's seed. Random unless a test pins it (a world's weather comes from its seed). */
  newSeed?: () => string;
}

/** Start strict; loosen with real traffic (docs/spikes/artificer-play-api.md). */
export const LIMITS = { gamesPerIpPerDay: 20, movesPerIpPerDay: 5000, movesPerGame: 5000, bodyBytes: 16_384, nameChars: 24 };

const defaultDeps: ApiDeps = { now: () => Date.now(), newId: () => crypto.randomUUID() };

export async function handle(req: ApiRequest, store: GameStore, deps: ApiDeps = defaultDeps, limits = LIMITS): Promise<ApiResponse> {
  if ((req.body?.length ?? 0) > limits.bodyBytes) return fail(413, `The body is over ${limits.bodyBytes} bytes.`);
  const parts = req.path.replace(/\/+$/, '').split('/').filter(Boolean); // ['api', 'v1', ...]
  if (parts[0] !== 'api' || parts[1] !== 'v1') return fail(404, 'Not found.');
  const [, , resource, id, sub] = parts;

  if (req.method === 'GET' && resource === 'rules' && !id) return { status: 200, body: rulesBody() };
  if (resource !== 'games') return fail(404, 'Not found.');

  // POST /api/v1/games: start a game.
  if (req.method === 'POST' && !id) {
    const body = parseBody(req.body);
    if (body === undefined) return fail(400, 'The body must be JSON.');
    const ipKey = keyOf(req.ip, deps.salt);
    const since = new Date(deps.now() - 24 * 3600_000).toISOString();
    if ((await store.countStartedSince(ipKey, since)) >= limits.gamesPerIpPerDay) {
      return fail(429, `This address has started ${limits.gamesPerIpPerDay} games in the last day. Try again later.`);
    }
    const name = cleanName(body.name, limits.nameChars);
    const game = startGame({ seed: deps.newSeed?.(), name });
    const nowIso = new Date(deps.now()).toISOString();
    const record: GameRecord = {
      id: deps.newId(), version: GAME_VERSION, session: serialize(game), moves: [], phase: view(game).phase,
      name, client: typeof body.client === 'string' ? body.client.slice(0, 64) : null, ipKey, createdAt: nowIso, updatedAt: nowIso,
    };
    await store.insert(record);
    return { status: 201, body: gameBody(record.id, view(game)) };
  }

  if (!id) return fail(404, 'Not found.');
  const record = await store.get(id);
  if (!record) return fail(404, `No game "${id}".`);
  const game = deserialize(record.session);
  if (!game) return fail(410, 'This game was made by an older version of the Artificer and can\'t be continued. Start a new one.');

  // GET /api/v1/games/:id: view it.
  if (req.method === 'GET' && !sub) return { status: 200, body: gameBody(id, view(game)) };

  // POST /api/v1/games/:id/moves: apply one move.
  if (req.method === 'POST' && sub === 'moves') {
    if (record.moves.length >= limits.movesPerGame) return fail(429, `This game has reached ${limits.movesPerGame} moves.`);
    // Counted by whoever sends the move, across all their games: it's what keeps one address from
    // spending the whole free tier of function calls.
    const today = new Date(deps.now()).toISOString().slice(0, 10);
    if ((await store.countMove(keyOf(req.ip, deps.salt), today)) > limits.movesPerIpPerDay) {
      return fail(429, `This address has made ${limits.movesPerIpPerDay} moves today (UTC). Try again tomorrow.`);
    }
    const body = parseBody(req.body);
    const move = body?.move as Move | undefined;
    if (!isMove(move)) return fail(400, 'The body must be { "move": … }: one of { "do": … }, { "endDay": true }, { "plan": […] }, { "choose": … }, { "set": { … } }.');
    const r = apply(game, move);
    if (!r.ok) return { status: 422, body: { error: r.error, moves: r.moves } };
    const updated: GameRecord = { ...record, session: serialize(r.game), moves: [...record.moves, move], phase: r.view.phase, updatedAt: new Date(deps.now()).toISOString() };
    if (!(await store.update(updated, record.moves.length))) {
      return fail(409, 'Another move on this game landed first. Fetch the game and try again.');
    }
    return { status: 200, body: { ...gameBody(id, r.view), changed: r.changed } };
  }

  return fail(405, `${req.method} isn't allowed here.`);
}

/** An in-memory store, for tests and local play. */
export function memoryStore(): GameStore & { rows: Map<string, GameRecord> } {
  const rows = new Map<string, GameRecord>();
  const moves = new Map<string, number>();
  return {
    rows,
    insert: async g => { rows.set(g.id, structuredClone(g)); },
    get: async id => (rows.has(id) ? structuredClone(rows.get(id)!) : null),
    update: async (g, movesBefore) => {
      if (rows.get(g.id)?.moves.length !== movesBefore) return false;
      rows.set(g.id, structuredClone(g));
      return true;
    },
    countStartedSince: async (ipKey, since) => [...rows.values()].filter(g => g.ipKey === ipKey && g.createdAt >= since).length,
    countMove: async (ipKey, day) => {
      const n = (moves.get(`${ipKey}|${day}`) ?? 0) + 1;
      moves.set(`${ipKey}|${day}`, n);
      return n;
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const fail = (status: number, error: string): ApiResponse => ({ status, body: { error } });

/** What a player gets back: the public id and the view. Never the session (seed and state). */
function gameBody(id: string, v: View): Record<string, unknown> {
  return { id, version: GAME_VERSION, phase: v.phase, status: v.status, text: v.text, moves: v.moves };
}

function rulesBody(): Record<string, unknown> {
  return {
    version: GAME_VERSION,
    rules: RULES,
    roadRules: ROAD_RULES,
    moves: {
      do: 'One action now: "scout", "gather@2" (ring 2), or { "q": "build", "opts": { … } }. On the road: "rest", "talk:<person id>", "sell:<item>" …',
      endDay: 'true: end the day; the night passes.',
      plan: 'A whole day\'s actions in order, once the Warden has learned to plan.',
      choose: 'An option id in an encounter or the caravan meeting.',
      set: '{ "focus": "goal:larder" | "none", "eating": "full" | "half" | "none", "site": "cave" | … }: free, no hours.',
    },
  };
}

function parseBody(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Shape check only; whether the move is legal now is the session's call. */
function isMove(m: unknown): m is Move {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  if ('do' in o) return typeof o.do === 'string' || (!!o.do && typeof o.do === 'object' && typeof (o.do as Record<string, unknown>).q === 'string');
  if ('endDay' in o) return o.endDay === true;
  if ('plan' in o) return Array.isArray(o.plan) && o.plan.length <= 40;
  if ('choose' in o) return typeof o.choose === 'string';
  if ('set' in o) return !!o.set && typeof o.set === 'object';
  return false;
}

/** A nickname: printable, short, or "Warden". Kept plain because the audience includes kids. */
function cleanName(raw: unknown, max: number): string {
  const s = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} '\-_.]/gu, '').trim().slice(0, max) : '';
  return s || 'Warden';
}

function keyOf(ip: string, salt = ''): string {
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32);
}
