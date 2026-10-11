/**
 * The play API (#1555, plan: docs/spikes/artificer-play-api.md): the session core (session.ts)
 * behind HTTP, with games stored on our side.
 *
 *   POST /api/v1/games               start a game          { name?, client?, model? } → 201 view
 *   GET  /api/v1/games/:id           view it               → 200 view
 *   POST /api/v1/games/:id/moves     apply one move        { move } → 200 changed + view | 422 why
 *   GET  /api/v1/games/:id/run       a finished game's record (#1558) → 200 | 404
 *   GET  /api/v1/runs                the run records: the latest and the best (#1558) → 200
 *   GET  /api/v1/runs/ai             every AI's records, all versions, for the dev site (#1558) → 200
 *   POST /api/v1/questions           keep a free question asked in the web game (#1575) → 201 | 429
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
import { startGame, view, apply, serialize, deserialize, GAME_VERSION, type Game, type Move, type Phase, type View } from './session';
import { measure, runOf, type GameMeasures } from './record-of';
import { compareRuns, type AiRun, type PlayerKind, type Run, type RunSummary, type StoredRun, type Surface } from './records';
import { cleanQuestion, type Question } from './questions';
import { knowsAbout } from '../artificer/free-questions';
import { personById } from '../artificer/villages';

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
  /** The model the player says is playing. Self-reported: shown as such, never trusted. */
  model: string | null;
  /** A salted hash of the address that started it, for the daily limit. */
  ipKey: string;
  /** Where it's played and by whom, for its run record (#1558). `player` is self-reported. */
  surface: Surface;
  player: PlayerKind;
  /** Measures taken during play that its end state can't show (the larder at midwinter). */
  measures: GameMeasures;
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
  /** Games started by anyone since this time (ISO), for the daily cap on all games. */
  countAllStartedSince(sinceIso: string): Promise<number>;
  /** Count one move by this address on this UTC day (YYYY-MM-DD) and return its moves that day, this one included. */
  countMove(ipKey: string, day: string): Promise<number>;
  /** Write a finished game's record (#1558), once per source: a second write for the same `sourceKey` is ignored. True if it added one. */
  insertRun(sourceKey: string, run: Run): Promise<boolean>;
  /** The newest records of one game version, newest first, without `detail`. */
  recentRuns(limit: number, version: string): Promise<RunSummary[]>;
  /** The best records of one game version, best first (by records.ts rankKey), without `detail`. */
  bestRuns(limit: number, version: string): Promise<RunSummary[]>;
  runBySource(sourceKey: string): Promise<StoredRun | null>;
  /**
   * AI records of every version, newest first, with their milestone days: the playtest's (only the
   * server writes those) and other AIs' (anyone can, through this API), each with its own limit, so
   * a flood of outside games can't push the playtest's history off the page.
   */
  aiRuns(limits: { bench: number; outside: number }): Promise<AiRun[]>;
  /** Keep a free question (#1575), already cleaned. */
  insertQuestion(q: Question): Promise<void>;
}

export interface ApiRequest {
  method: string;
  path: string;
  /** The raw body, so its size can be checked before it's parsed. */
  body?: string;
  ip: string;
  /** Set by the MCP server for its calls (the HTTP API can't claim it): where a game is being played. */
  surface?: Surface;
}

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
  /** Seconds a shared cache (Vercel's CDN) may keep this answer; absent means never cache. */
  cache?: number;
}

export interface ApiDeps {
  now: () => number;
  newId: () => string;
  /** Mixed into address hashes, so a stored hash can't be matched against a list of addresses. */
  salt?: string;
  /** A new game's seed. Random unless a test pins it (a world's weather comes from its seed). */
  newSeed?: () => string;
}

/**
 * Start strict; loosen with real traffic (docs/spikes/artificer-play-api.md). The per-address
 * limits stop one player using everything; the daily caps on everyone together keep the whole
 * thing inside the free tiers (Vercel's function calls, Supabase's rows), however many addresses
 * come. Hosted MCP clients such as claude.ai reach us from shared addresses, so only the caps
 * really bound them.
 */
export const LIMITS = {
  gamesPerIpPerDay: 20, movesPerIpPerDay: 5000, movesPerGame: 5000,
  gamesPerDay: 500, movesPerDay: 20_000,
  // Free questions kept (#1575): a road meets about twenty people, each asked once a stay, so these
  // leave room for several games a day each, and keep a year of everyone's inside the free tier.
  questionsPerIpPerDay: 200, questionsPerDay: 2000,
  bodyBytes: 16_384, nameChars: 24,
};

/** The usage counter's key for every move by anyone (artificer_play_usage). */
const ALL_MOVES = 'all';
/** The same counter, for questions kept: per address under `q:<key>`, everyone's under this. */
const ALL_QUESTIONS = 'q:all';

/** The console's client name (src/artificer-app/console.ts sends it): its games are played by people. */
export const CONSOLE_CLIENT = 'artificer-console';

/** How many records the lists send: the newest and the best (GET /runs), and the AIs' (GET /runs/ai). */
export const RUNS = { recent: 500, best: 50, cacheSeconds: 60, ai: { bench: 1500, outside: 300 }, aiCacheSeconds: 300 };

const defaultDeps: ApiDeps = { now: () => Date.now(), newId: () => crypto.randomUUID() };

export async function handle(req: ApiRequest, store: GameStore, deps: ApiDeps = defaultDeps, limits = LIMITS): Promise<ApiResponse> {
  if ((req.body?.length ?? 0) > limits.bodyBytes) return fail(413, `The body is over ${limits.bodyBytes} bytes.`);
  const parts = req.path.replace(/\/+$/, '').split('/').filter(Boolean); // ['api', 'v1', ...]
  if (parts[0] !== 'api' || parts[1] !== 'v1') return fail(404, 'Not found.');
  const [, , resource, id, sub] = parts;

  if (req.method === 'GET' && resource === 'rules' && !id) return { status: 200, body: rulesBody() };
  // GET /api/v1/runs: the records, for the Records pages. Cached a minute at Vercel's edge, so a
  // busy page costs one function call a minute, not one per visitor. Only this game version's
  // records: a version that changes the rules starts a fresh board, so runs compare like with like.
  if (req.method === 'GET' && resource === 'runs' && !id) {
    const [recent, best] = await Promise.all([store.recentRuns(RUNS.recent, GAME_VERSION), store.bestRuns(RUNS.best, GAME_VERSION)]);
    return { status: 200, body: { version: GAME_VERSION, recent, best }, cache: RUNS.cacheSeconds };
  }
  // GET /api/v1/runs/ai: every AI's records across versions, for the dev site's AI page, which shows
  // how models progress and what they cost, and how that moves as the game changes. Read on another
  // site, which is what the CORS headers are for. Cached five minutes: the playtest adds runs nightly.
  if (req.method === 'GET' && resource === 'runs' && id === 'ai' && !sub) {
    return { status: 200, body: { version: GAME_VERSION, runs: await store.aiRuns(RUNS.ai) }, cache: RUNS.aiCacheSeconds };
  }
  // POST /api/v1/questions: keep a free question asked in the web game (#1575). The web game plays
  // on the page, so the question was matched and answered there; this only keeps it. If it fails,
  // the game goes on: the page doesn't wait for it, and nothing in the game depends on it.
  if (req.method === 'POST' && resource === 'questions' && !id) {
    const body = parseBody(req.body);
    if (body === undefined) return fail(400, 'The body must be JSON.');
    const person = typeof body.person === 'string' ? body.person : '';
    if (!personById(person)) return fail(400, 'The body must be { "person": "<person id>", "question": "…" }, with someone the road has.');
    const clean = cleanQuestion(body.question);
    if (!clean) return fail(400, 'There\'s no question in that.');
    // The topic the page matched, kept only if it's one this person knows. Self-reported, like a
    // model name; a blocked question matched nothing.
    const topic = clean.text && typeof body.topic === 'string' && knowsAbout(person, body.topic) ? body.topic : null;
    const trust = typeof body.trust === 'number' && Number.isFinite(body.trust) ? Math.min(100, Math.max(0, Math.round(body.trust))) : 0;
    const q: Question = { question: clean.text, blocked: clean.blocked, person, topic, answered: topic !== null, trust, gameVersion: GAME_VERSION, surface: 'web' };
    if (!(await keepQuestion(store, q, req.ip, deps, limits))) return fail(429, 'Enough questions for today. They\'ll be kept again tomorrow.');
    return { status: 201, body: { kept: true } };
  }
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
    if ((await store.countAllStartedSince(since)) >= limits.gamesPerDay) {
      return fail(429, `The Reach has had ${limits.gamesPerDay} games in the last day, as many as it takes. Try again later today.`);
    }
    const name = cleanName(body.name, limits.nameChars);
    const game = startGame({ seed: deps.newSeed?.(), name });
    const nowIso = new Date(deps.now()).toISOString();
    const client = shortText(body.client);
    // Where: the MCP server says so itself; the console by its client name; anything else is the API.
    const surface: Surface = req.surface ?? (client === CONSOLE_CLIENT ? 'console' : 'api');
    // Who: as the player says, else a person in the console and a program anywhere else.
    const player: PlayerKind = body.player === 'person' || body.player === 'ai' ? body.player : surface === 'console' ? 'person' : 'ai';
    const record: GameRecord = {
      id: deps.newId(), version: GAME_VERSION, session: serialize(game), moves: [], phase: view(game).phase,
      name, client, model: shortText(body.model), ipKey, surface, player, measures: {}, createdAt: nowIso, updatedAt: nowIso,
    };
    await store.insert(record);
    return { status: 201, body: gameBody(record.id, view(game)) };
  }

  if (!id) return fail(404, 'Not found.');
  const record = await store.get(id);
  if (!record) return fail(404, `No game "${id}".`);

  // GET /api/v1/games/:id/run: its record, once it has ended. Before the session is read, so a game
  // from an older version still finds its record.
  if (req.method === 'GET' && sub === 'run') {
    let run = await store.runBySource(sourceOf(id));
    // An ended game whose record didn't get written when it ended (a database blip): write it now.
    // The write is once per source, so this can't make a second record.
    const ended = record.phase === 'ended' ? deserialize(record.session) : null;
    if (!run && ended) {
      await saveRun(store, record, ended);
      run = await store.runBySource(sourceOf(id));
    }
    if (run) return { status: 200, body: { run }, cache: RUNS.cacheSeconds };
    return fail(404, record.phase === 'ended' ? 'This game\'s record can\'t be made: it\'s from an older version of the Artificer.' : 'This game hasn\'t ended yet: a run gets its record when it ends.');
  }

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
    if ((await store.countMove(ALL_MOVES, today)) > limits.movesPerDay) {
      return fail(429, `The Reach has had ${limits.movesPerDay} moves today (UTC), as many as it takes. Try again tomorrow.`);
    }
    const body = parseBody(req.body);
    const move = body?.move as Move | undefined;
    if (!isMove(move)) return fail(400, 'The body must be { "move": … }: one of { "do": … }, { "endDay": true }, { "plan": […] }, { "choose": … }, { "set": { … } }, { "ask": { "person", "question" } }.');
    // A free question is asked in words, so it can be kept: the road action it's played as can't be sent itself.
    if ('do' in move && typeof move.do === 'string' && move.do.startsWith('question:')) {
      return fail(400, 'Ask a free question as { "ask": { "person": "<id>", "question": "…" } }.');
    }
    const r = apply(game, move);
    if (!r.ok) return { status: 422, body: { error: r.error, moves: r.moves } };
    // The move as played is what's stored: for a question, the topic it matched, never its words.
    const updated: GameRecord = {
      ...record, session: serialize(r.game), moves: [...record.moves, r.played], phase: r.view.phase,
      measures: measure(record.measures, r.game.app), updatedAt: new Date(deps.now()).toISOString(),
    };
    if (!(await store.update(updated, record.moves.length))) {
      return fail(409, 'Another move on this game landed first. Fetch the game and try again.');
    }
    if (r.asked) {
      const a = r.asked;
      const q: Question = {
        question: a.text, blocked: a.blocked, person: a.person, topic: a.topic, answered: a.topic !== null, trust: a.trust,
        gameVersion: record.version, surface: record.surface === 'bench' ? 'api' : record.surface,
      };
      // Kept if today's limits allow. A failure is logged, not passed on: the move itself was saved.
      try {
        await keepQuestion(store, q, req.ip, deps, limits);
      } catch (e) {
        console.error('question not kept', e);
      }
    }
    // An ended game refuses moves, so this is the move that ended it: write its record, once.
    if (r.view.phase !== 'ended') return { status: 200, body: { ...gameBody(id, r.view), changed: r.changed } };
    await saveRun(store, updated, r.game);
    return { status: 200, body: { ...gameBody(id, r.view), changed: r.changed, record: `/records/?game=${id}` } };
  }

  return fail(405, `${req.method} isn't allowed here.`);
}

/**
 * Write a finished game's record. A failure is logged, not passed on: the move itself was saved,
 * and the player shouldn't see an error for a record they didn't ask for.
 */
async function saveRun(store: GameStore, g: GameRecord, game: Game): Promise<void> {
  try {
    const run = runOf(game.app, g.measures, {
      playerKind: g.player, model: g.model, client: g.client, surface: g.surface, gameVersion: g.version, name: g.name, moves: g.moves.length,
    });
    await store.insertRun(sourceOf(g.id), run);
  } catch (e) {
    console.error('run record not saved', g.id, e);
  }
}

/**
 * Keep a free question (#1575) if today's limits allow it: per address, and everyone's together.
 * False when a limit turned it away.
 */
async function keepQuestion(store: GameStore, q: Question, ip: string, deps: ApiDeps, limits: typeof LIMITS): Promise<boolean> {
  const today = new Date(deps.now()).toISOString().slice(0, 10);
  if ((await store.countMove(`q:${keyOf(ip, deps.salt)}`, today)) > limits.questionsPerIpPerDay) return false;
  if ((await store.countMove(ALL_QUESTIONS, today)) > limits.questionsPerDay) return false;
  await store.insertQuestion(q);
  return true;
}

/** A record's source key for an API game (artificer_runs.source_key). */
export const sourceOf = (gameId: string): string => `game:${gameId}`;

/** An in-memory store, for tests and local play. */
export function memoryStore(): GameStore & { rows: Map<string, GameRecord>; runs: Map<string, StoredRun>; questions: Question[] } {
  const rows = new Map<string, GameRecord>();
  const questions: Question[] = [];
  const moves = new Map<string, number>();
  const runs = new Map<string, StoredRun>();
  let written = 0;
  /** One version's records, as the lists send them (no detail). */
  const listed = (version: string): RunSummary[] =>
    [...runs.values()].filter(r => r.gameVersion === version).map(({ detail: _detail, ...summary }) => summary);
  return {
    rows,
    runs,
    questions,
    insertQuestion: async q => { questions.push(structuredClone(q)); },
    insert: async g => { rows.set(g.id, structuredClone(g)); },
    get: async id => (rows.has(id) ? structuredClone(rows.get(id)!) : null),
    update: async (g, movesBefore) => {
      if (rows.get(g.id)?.moves.length !== movesBefore) return false;
      rows.set(g.id, structuredClone(g));
      return true;
    },
    countStartedSince: async (ipKey, since) => [...rows.values()].filter(g => g.ipKey === ipKey && g.createdAt >= since).length,
    countAllStartedSince: async since => [...rows.values()].filter(g => g.createdAt >= since).length,
    countMove: async (ipKey, day) => {
      const n = (moves.get(`${ipKey}|${day}`) ?? 0) + 1;
      moves.set(`${ipKey}|${day}`, n);
      return n;
    },
    insertRun: async (key, run) => {
      if (runs.has(key)) return false;
      // A fake clock that only moves forward, so "newest first" is well defined in tests.
      runs.set(key, { ...structuredClone(run), id: crypto.randomUUID(), createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++written)).toISOString() });
      return true;
    },
    recentRuns: async (limit, version) => listed(version).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit),
    bestRuns: async (limit, version) => listed(version).sort(compareRuns).slice(0, limit),
    runBySource: async key => runs.get(key) ?? null,
    aiRuns: async ({ bench, outside }) => {
      const newest = [...runs.values()].filter(r => r.playerKind === 'ai').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return [...newest.filter(r => r.surface === 'bench').slice(0, bench), ...newest.filter(r => r.surface !== 'bench').slice(0, outside)]
        .map(({ detail, ...summary }) => ({ ...summary, milestoneDays: detail.milestones ?? null }));
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
      ask: '{ "person": "<person id>", "question": "…" }: on the road, a question in your own words, once per person per stay (up to 200 characters). Questions are kept, with nothing about you, to improve the game.',
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
  if ('ask' in o) {
    const a = o.ask as Record<string, unknown> | null;
    return !!a && typeof a === 'object' && typeof a.person === 'string' && typeof a.question === 'string';
  }
  return false;
}

/** A client or model name as given: a string, cut to 64 characters, or nothing. */
function shortText(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 64) : null;
}

/** A nickname: printable, short, or "Warden". Kept plain because the audience includes kids. */
function cleanName(raw: unknown, max: number): string {
  const s = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} '\-_.]/gu, '').trim().slice(0, max) : '';
  return s || 'Warden';
}

function keyOf(ip: string, salt = ''): string {
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32);
}
