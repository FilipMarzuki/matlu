/**
 * The play API (#1555, plan: docs/spikes/artificer-play-api.md): the session core (session.ts)
 * behind HTTP, with games stored on our side.
 *
 *   POST /api/v1/games               start a game          { name?, client?, model?, player?, features?, weekly? } → 201 view
 *   GET  /api/v1/games/:id           view it               → 200 view
 *   POST /api/v1/games/:id/moves     apply one move        { move } → 200 changed + view | 422 why
 *                                    (the move that ends a run also gets its record's link and achievements, #1559)
 *   GET  /api/v1/games/:id/run       a finished game's record (#1558) → 200 | 404
 *   GET  /api/v1/runs                the run records: the latest and the best (#1558) → 200
 *   GET  /api/v1/runs/ai             every AI's records, all versions, for the dev site (#1558) → 200
 *   GET  /api/v1/runs/week[/:week]   a weekly world's records, best first (#1559) → 200
 *   POST /api/v1/runs/submit         a web-game run, replayed before it counts (#1559) { log, claim, name? } → 201 | 422 why
 *   GET  /api/v1/weekly              this week's world: its week and seed (#1559) → 200
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
 *   The one exception is the weekly world (#1559, weekly.ts), whose seed GET /api/v1/weekly hands
 *   to anyone: the web game runs the sim in the browser, so it can't play a world without its seed.
 *   That's the trade-off of one shared world: on the weekly board anyone could run the week ahead,
 *   people and AIs alike, so it's an open book, and a fair one, since everyone holds the same seed.
 *   What stays secret is next week's: the seed is made from the week and a server secret.
 * - The player's address. It's kept only as a salted hash, for the per-address limits.
 */

import { createHash } from 'node:crypto';
import { RULES, ROAD_RULES } from '../artificer-ai/observe';
import { startGame, view, apply, serialize, deserialize, GAME_VERSION, type Game, type Move, type Phase, type View } from './session';
import { measure, runOf, type GameMeasures } from './record-of';
import { compareRuns, isRanked, type AiRun, type PlayerKind, type Run, type RunSummary, type StoredRun, type Surface } from './records';
import { achievementsOf, type Achievement } from './achievements';
import { gameIdOf, isoWeek, isWeekId, previousWeek, weekEnd, weekOfId, weekStart, weeklySeedOf } from './weekly';
import { heirloomsAllowed, logProblem, replayWeb } from './web-run';
import { claimMismatch, claimOf, type WebLog } from './web-log';
import { currentRun } from '../artificer-app/controller';
import { heirloomsOf } from '../artificer/legacy';
import { cleanQuestion, type Question } from './questions';
import { knowsAbout } from '../artificer/free-questions';
import { isQuestionTopic } from '../artificer/knowledge-questions';
import { personById } from '../artificer/villages';
import { FEATURES, validFeatures, type FeatureSwitches } from '../artificer/features';

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
  /** The best ranked records of one game version (records.ts isRanked), best first (by records.ts rankKey), without `detail`. */
  bestRuns(limit: number, version: string): Promise<RunSummary[]>;
  /** The best records of one game version played on one weekly world (#1559, `detail.week`), best first, without `detail`. */
  weekRuns(week: string, version: string, limit: number): Promise<RunSummary[]>;
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
  /**
   * The secret the weekly world's seed is made from (#1559), so next week's world can't be worked
   * out ahead. Empty means the seed follows from the week alone: fine for tests and local play.
   * Changing it changes the world mid-week, so it's set once.
   */
  weeklySalt?: string;
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
  // A web run's log (#1559): its start and every move of a whole run, a few hundred of them, so far
  // more than one move's body. Its moves are capped by movesPerGame, like any game's.
  submitBodyBytes: 262_144,
};

/** Where a web run is sent (#1559): its body may be bigger than any other request's. */
export const SUBMIT_PATH = '/api/v1/runs/submit';

/** The web game's client name (src/artificer-app/main.ts): its runs are played by people, in the browser. */
export const WEB_CLIENT = 'artificer-web';

/** The usage counter's key for every move by anyone (artificer_play_usage). */
const ALL_MOVES = 'all';
/** The same counter, for questions kept: per address under `q:<key>`, everyone's under this. */
const ALL_QUESTIONS = 'q:all';

/** The console's client name (src/artificer-app/console.ts sends it): its games are played by people. */
export const CONSOLE_CLIENT = 'artificer-console';

/** How many records the lists send: the newest and the best (GET /runs), and the AIs' (GET /runs/ai). */
export const RUNS = { recent: 500, best: 50, cacheSeconds: 60, ai: { bench: 1500, outside: 300 }, aiCacheSeconds: 300, week: 500, weeklyCacheSeconds: 300 };

/**
 * The seed of a week's world (#1559): the week, and a tag made from it and the server's secret.
 * The week is part of the seed so a game's week can be read back from its id (weekly.ts weekOfId).
 */
export function weeklySeed(week: string, salt = ''): string {
  return weeklySeedOf(week, createHash('sha256').update(`${salt}|weekly|${week}`).digest('hex').slice(0, 8));
}

/**
 * Is this id the real world of the week it names? A web run (#1559) names its world itself, so its
 * week is believed only if its id is exactly the one that week's seed gives.
 */
export function isWeeklyWorld(id: string, salt = ''): boolean {
  const week = weekOfId(id);
  return week !== null && id === gameIdOf(weeklySeed(week, salt));
}

const defaultDeps: ApiDeps = { now: () => Date.now(), newId: () => crypto.randomUUID() };

export async function handle(req: ApiRequest, store: GameStore, deps: ApiDeps = defaultDeps, limits = LIMITS): Promise<ApiResponse> {
  const maxBody = req.path.replace(/\/+$/, '') === SUBMIT_PATH ? limits.submitBodyBytes : limits.bodyBytes;
  if ((req.body?.length ?? 0) > maxBody) return fail(413, `The body is over ${maxBody} bytes.`);
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
  // GET /api/v1/runs/week[/:week]: one weekly world's records (#1559), best first: this week's, or
  // the week named. This version's only, like the main boards. Cached a minute, like them.
  if (req.method === 'GET' && resource === 'runs' && id === 'week') {
    const week = sub ?? isoWeek(deps.now());
    if (!isWeekId(week)) return fail(400, `"${week}" isn't a week. Weeks are ISO weeks, like ${isoWeek(deps.now())}.`);
    return { status: 200, body: { version: GAME_VERSION, week, runs: await store.weekRuns(week, GAME_VERSION, RUNS.week) }, cache: RUNS.cacheSeconds };
  }
  // GET /api/v1/weekly: this week's world (#1559). Its seed is public for its week (see the header):
  // the web game needs it to play the world in the browser.
  if (req.method === 'GET' && resource === 'weekly' && !id) {
    const week = isoWeek(deps.now());
    const seed = weeklySeed(week, deps.weeklySalt);
    const endsAt = weekEnd(week)!;
    // Cached at the edge, but never past the week's end: a new week must bring its new world.
    const left = Math.floor((endsAt - deps.now()) / 1000);
    return {
      status: 200,
      body: { version: GAME_VERSION, week, seed, gameId: gameIdOf(seed), startsAt: new Date(weekStart(week)!).toISOString(), endsAt: new Date(endsAt).toISOString() },
      ...(left > 0 ? { cache: Math.min(RUNS.weeklyCacheSeconds, left) } : {}),
    };
  }
  // POST /api/v1/questions: keep a free question asked in the web game (#1575). The web game plays
  // on the page, so the question was matched and answered there; this only keeps it. If it fails,
  // the game goes on: the page doesn't wait for it, and nothing in the game depends on it.
  if (req.method === 'POST' && resource === 'questions' && !id) {
    const body = parseBody(req.body);
    if (body === undefined) return fail(400, 'The body must be JSON.');
    const person = typeof body.person === 'string' ? body.person : '';
    if (!personById(person)) return fail(400, 'The body must be { "person": "<person id>", "question": "…" }, with someone the road has.');
    const text = cleanQuestion(body.question);
    if (!text) return fail(400, 'There\'s no question in that.');
    // The topic the page matched, kept only if it's one this person knows. Self-reported, like a model name.
    // With the knowledge model's matching (#1611) a topic can also be a People's or culture's ways, or
    // one someone nearby knows: `isQuestionTopic` checks those.
    const topic = typeof body.topic === 'string' && (knowsAbout(person, body.topic) || isQuestionTopic(person, body.topic)) ? body.topic : null;
    const trust = typeof body.trust === 'number' && Number.isFinite(body.trust) ? Math.min(100, Math.max(0, Math.round(body.trust))) : 0;
    // Whether they told you anything, as the page saw it (#1611: a match can meet a gate, or be one
    // someone else knows). A page from before says nothing; its matches were all topics the person
    // knows, and always answered.
    const answered = topic !== null && (typeof body.answered === 'boolean' ? body.answered : knowsAbout(person, topic));
    const q: Question = { question: text, person, topic, answered, trust, gameVersion: GAME_VERSION, surface: 'web' };
    if (!(await keepQuestion(store, q, req.ip, deps, limits))) return fail(429, 'Enough questions for today. They\'ll be kept again tomorrow.');
    return { status: 201, body: { kept: true } };
  }
  // POST /api/v1/runs/submit: a web-game run, replayed here before it counts (#1559).
  if (req.method === 'POST' && resource === 'runs' && id === 'submit' && !sub) return submitWebRun(req, store, deps, limits);
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
    // Rule features switched for this game (#1579): known ones only, so a typo isn't silently a default.
    if (body.features !== undefined) {
      const known = FEATURES.filter(f => f.kind === 'rules').map(f => f.id);
      const bad = validFeatures(body.features) ? Object.keys(body.features).filter(k => !known.includes(k)) : null;
      if (bad === null || bad.length) return fail(400, `"features" switches rule features on or off, as { "<id>": true | false }. Known: ${known.join(', ')}.`);
    }
    if (body.weekly !== undefined && typeof body.weekly !== 'boolean') return fail(400, '"weekly" is true to play this week\'s world, the one everyone plays this week.');
    // The weekly world (#1559): this week's seed for everyone; any other game gets a fresh one.
    const seed = body.weekly === true ? weeklySeed(isoWeek(deps.now()), deps.weeklySalt) : deps.newSeed?.();
    const game = startGame({ seed, name, features: body.features as FeatureSwitches | undefined });
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
    return { status: 201, body: gameBody(record.id, view(game), game) };
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
  if (req.method === 'GET' && !sub) return { status: 200, body: gameBody(id, view(game), game) };

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
        question: a.text, person: a.person, topic: a.topic, answered: a.answered, trust: a.trust,
        gameVersion: record.version, surface: record.surface === 'bench' ? 'api' : record.surface,
      };
      // Kept if today's limits allow. A failure is logged, not passed on: the move itself was saved.
      try {
        await keepQuestion(store, q, req.ip, deps, limits);
      } catch (e) {
        console.error('question not kept', e);
      }
    }
    // An ended game refuses moves, so this is the move that ended it: write its record, once, and
    // say how it compares (#1559).
    if (r.view.phase !== 'ended') return { status: 200, body: { ...gameBody(id, r.view, r.game), changed: r.changed } };
    await saveRun(store, updated, r.game);
    const achievements = await achievementsFor(store, id);
    return { status: 200, body: { ...gameBody(id, r.view, r.game), changed: r.changed, record: `/records/?game=${id}`, ...(achievements ? { achievements } : {}) } };
  }

  return fail(405, `${req.method} isn't allowed here.`);
}

/**
 * A web-game run sent to the records (#1559): `{ log, claim, name }`. The page ran the sim itself,
 * so nothing it says is taken on trust: the log is replayed from its start (web-run.ts), and only a
 * run that ends the way the claim says gets a record. It's stored as a finished game (surface
 * `web`, played by a person) so it has a game id like any other, its record lives where the Records
 * page looks (`?game=<id>`), and it counts towards the same daily limits on games.
 *
 * The game id is made from the log itself, so sending the same run twice finds the first one.
 */
async function submitWebRun(req: ApiRequest, store: GameStore, deps: ApiDeps, limits: typeof LIMITS): Promise<ApiResponse> {
  const body = parseBody(req.body);
  if (body === undefined) return fail(400, 'The body must be JSON.');
  const problem = logProblem(body.log, limits.movesPerGame);
  if (problem) return fail(400, problem);
  const log = body.log as WebLog;
  if (log.version !== GAME_VERSION) {
    return fail(422, `This run was played on another version of the game (${log.version}; this one is ${GAME_VERSION}), so it can't be replayed here.`);
  }

  // The same run sent again is the game it made the first time (its id is made from its log),
  // answered even past today's limits: nothing new is stored.
  const id = webGameId(log);
  const existing = await store.get(id);
  if (existing) {
    // Its record may not have been written then (a database blip): write it now.
    const game = deserialize(existing.session);
    if (game && !(await store.runBySource(sourceOf(id)))) await saveRun(store, existing, game);
    return { status: 200, body: { id, record: `/records/?game=${id}`, already: true, ...(await achievementsBody(store, id)) } };
  }

  const ipKey = keyOf(req.ip, deps.salt);
  const since = new Date(deps.now() - 24 * 3600_000).toISOString();
  if ((await store.countStartedSince(ipKey, since)) >= limits.gamesPerIpPerDay) return fail(429, `This address has sent or started ${limits.gamesPerIpPerDay} games in the last day. Try again later.`);
  if ((await store.countAllStartedSince(since)) >= limits.gamesPerDay) return fail(429, `The Reach has had ${limits.gamesPerDay} games in the last day, as many as it takes. Try again later today.`);

  // The weekly world: believed only if the id is that week's real world, and only this week's or
  // last week's (a run begun on Sunday night may end on Monday). It starts as everyone does, with
  // nothing an earlier Warden left.
  const start = log.start;
  const week = weekOfId(start.id);
  if (week) {
    const now = isoWeek(deps.now());
    if (!isWeeklyWorld(start.id, deps.weeklySalt)) return fail(422, `This isn't the world of ${week}.`);
    if (week !== now && week !== previousWeek(now)) return fail(422, `The world of ${week} has closed: weekly runs count in their own week, or the week after.`);
    if (start.heirlooms?.length) return fail(422, 'A run of the weekly world starts with nothing an earlier Warden left.');
  }

  // Heirlooms (#1455) are believed only from a run this server has checked: one sent here (or played
  // through the API), named by its game id, and they must be among what it left.
  if (start.heirlooms?.length) {
    const from = start.heirloomsFrom ? await store.get(start.heirloomsFrom) : null;
    if (from?.phase !== 'ended') return fail(422, 'This Warden started with heirlooms from a run that wasn\'t sent to the records, so the run can\'t be checked.');
    const left = deserialize(from.session);
    if (!left) return fail(422, 'This Warden\'s heirlooms come from a run on an older version of the game, so the run can\'t be checked.');
    if (!heirloomsAllowed(start.heirlooms, heirloomsOf(currentRun(left.app)).heirlooms ?? [])) return fail(422, 'The heirlooms aren\'t what that run left.');
  }

  const name = cleanName(body.name, limits.nameChars);
  // A log the page couldn't have written may make the sim throw rather than refuse a move: either
  // way, it doesn't replay.
  let replay: ReturnType<typeof replayWeb>;
  try {
    replay = replayWeb(log);
  } catch (e) {
    console.error('web run replay threw', e);
    replay = { ok: false, error: 'the game couldn\'t play one of its moves.', at: -1 };
  }
  if (!replay.ok) return { status: 422, body: { error: `The run doesn't replay: ${replay.error}`, at: replay.at } };
  const run = runOf(replay.app, replay.measures, { playerKind: 'person', model: null, client: WEB_CLIENT, surface: 'web', gameVersion: GAME_VERSION, name, moves: log.moves.length });
  const differs = claimMismatch(body.claim, run);
  if (differs.length) {
    return { status: 422, body: { error: `The run replays to a different end (${differs.join(', ')}), so it can't count.`, differs, replayed: claimOf(run) } };
  }

  const nowIso = new Date(deps.now()).toISOString();
  const game: Game = { id: start.id, app: replay.app };
  const record: GameRecord = {
    id, version: GAME_VERSION, session: serialize(game), moves: log.moves as Move[], phase: 'ended', name, client: WEB_CLIENT, model: null,
    ipKey, surface: 'web', player: 'person', measures: replay.measures, createdAt: nowIso, updatedAt: nowIso,
  };
  await store.insert(record);
  // Unlike a game that ends on a move, the player asked for this record, so a failure to write it
  // is theirs to see (the handler answers 500), and sending again writes it (above).
  await store.insertRun(sourceOf(id), run);
  return { status: 201, body: { id, record: `/records/?game=${id}`, ...(await achievementsBody(store, id)) } };
}

/** The achievements to send with a record, as a body fragment: nothing if they can't be worked out now. */
async function achievementsBody(store: GameStore, gameId: string): Promise<{ achievements?: Achievement[] }> {
  const achievements = await achievementsFor(store, gameId);
  return achievements ? { achievements } : {};
}

/**
 * A web run's game id: a hash of its log, shaped like the UUIDs other games get (the column is a
 * uuid). The same run sent twice is the same game.
 */
function webGameId(log: WebLog): string {
  const h = createHash('sha256').update(JSON.stringify({ version: log.version, start: log.start, moves: log.moves })).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
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
 * A finished game's achievements (#1559): its record against this version's recent ones, or for a
 * run of the weekly world against that week's, the same lists the Records page compares with. Null
 * when there's no record to compare (it wasn't written) or the records can't be read now:
 * achievements are a bonus, never a reason to fail the move.
 */
async function achievementsFor(store: GameStore, gameId: string): Promise<Achievement[] | null> {
  try {
    const mine = await store.runBySource(sourceOf(gameId));
    if (!mine) return null;
    const week = mine.detail.week;
    const others = week ? await store.weekRuns(week, mine.gameVersion, RUNS.week) : await store.recentRuns(RUNS.recent, mine.gameVersion);
    return achievementsOf(mine, others);
  } catch (e) {
    console.error('achievements not worked out', gameId, e);
    return null;
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
    [...runs.values()].filter(r => r.gameVersion === version).map(({ detail, ...summary }) => ({ ...summary, features: detail.features ?? null, week: detail.week ?? null }));
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
    bestRuns: async (limit, version) => listed(version).filter(isRanked).sort(compareRuns).slice(0, limit),
    weekRuns: async (week, version, limit) => listed(version).filter(r => r.week === week).sort(compareRuns).slice(0, limit),
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

/**
 * What a player gets back: the public id and the view, and for a game of the weekly world its week
 * (#1559). Never the session (seed and state).
 */
function gameBody(id: string, v: View, game: Game): Record<string, unknown> {
  const week = weekOfId(game.id);
  return { id, version: GAME_VERSION, phase: v.phase, status: v.status, text: v.text, moves: v.moves, features: v.features, ...(week ? { week } : {}) };
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
    // Switchable features (#1579): rule features are set per game, at POST /api/v1/games { "features": { "<id>": false } }.
    features: FEATURES.map(f => ({ id: f.id, name: f.name, note: f.note, stage: f.stage, kind: f.kind, default: f.default })),
    weekly: 'POST /api/v1/games { "weekly": true } plays this week\'s world: the same seed for everyone, people and AIs, Monday to Monday (UTC). Its runs are compared with each other at GET /api/v1/runs/week.',
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
