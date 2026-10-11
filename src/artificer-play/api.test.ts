/**
 * Acceptance tests for #1555 — the HTTP API over the session core, with games stored on our side.
 * The handler takes a store, so these run against an in-memory one; the Vercel function wires it
 * to Supabase.
 */

import { describe, it, expect } from 'vitest';
import { handle, memoryStore, weeklySeed, LIMITS, type ApiRequest } from './api';
import { pagePlay } from './fixtures';
import { startOf } from './web-run';
import { newLog, claimOf, type WebStart } from './web-log';
import { runOf } from './record-of';
import { GAME_VERSION } from './session';
import { ruleFeatures } from '../artificer/features';
import { talentOffer, seedOf } from '../artificer/talents';
import { heirloomsOf } from '../artificer/legacy';
import { currentRun } from '../artificer-app/controller';

let n = 0;
// The seed is pinned so the weather is too: a foggy first morning would make scouting see nothing.
const deps = { now: () => Date.parse('2026-10-11T12:00:00Z'), newId: () => `g${++n}`, newSeed: () => 's1' };
const post = (path: string, body: unknown, ip = '203.0.113.7'): ApiRequest => ({ method: 'POST', path, body: JSON.stringify(body), ip });
const get = (path: string, ip = '203.0.113.7'): ApiRequest => ({ method: 'GET', path, ip });

describe('The play API (#1555)', () => {
  it('1. starting a game returns 201 with its id and first view, and stores it', async () => {
    const store = memoryStore();
    const r = await handle(post('/api/v1/games', { name: 'Ada' }), store, deps);
    expect(r.status).toBe(201);
    const b = r.body as { id: string; phase: string; text: string; moves: unknown[] };
    expect(b.phase).toBe('day');
    expect(b.text).toContain('DAY 1');
    expect(b.moves.length).toBeGreaterThan(0);
    expect(store.rows.get(b.id)).toBeDefined();
  });

  it('2. a legal move returns 200 with what changed and the new view, and updates the stored game', async () => {
    const store = memoryStore();
    const { id } = (await handle(post('/api/v1/games', {}), store, deps)).body as { id: string };
    const r = await handle(post(`/api/v1/games/${id}/moves`, { move: { do: 'scout' } }), store, deps);
    expect(r.status).toBe(200);
    const b = r.body as { changed: string[]; status: string };
    expect(b.changed.join(' ')).toMatch(/Scouted/);
    expect(b.status).toMatch(/Day 1/);
    expect(store.rows.get(id)!.moves).toEqual([{ do: 'scout' }]);
  });

  it('3. an illegal move returns 422 with the reason and the open moves, and changes nothing stored', async () => {
    const store = memoryStore();
    const { id } = (await handle(post('/api/v1/games', {}), store, deps)).body as { id: string };
    const before = JSON.stringify(store.rows.get(id));
    const r = await handle(post(`/api/v1/games/${id}/moves`, { move: { do: 'teleport' } }), store, deps);
    expect(r.status).toBe(422);
    const b = r.body as { error: string; moves: unknown[] };
    expect(b.error).toMatch(/teleport/);
    expect(b.moves.length).toBeGreaterThan(0);
    expect(JSON.stringify(store.rows.get(id))).toBe(before);
    // Not a move at all.
    expect((await handle(post(`/api/v1/games/${id}/moves`, { nope: 1 }), store, deps)).status).toBe(400);
  });

  it('4. an unknown game is 404, viewed or moved', async () => {
    const store = memoryStore();
    expect((await handle(get('/api/v1/games/nope'), store, deps)).status).toBe(404);
    expect((await handle(post('/api/v1/games/nope/moves', { move: { endDay: true } }), store, deps)).status).toBe(404);
    expect((await handle(get('/api/v1/elsewhere'), store, deps)).status).toBe(404);
  });

  it('5. an address that has started the daily limit of games gets 429 for one more, and no game', async () => {
    const store = memoryStore();
    for (let i = 0; i < LIMITS.gamesPerIpPerDay; i++) expect((await handle(post('/api/v1/games', {}), store, deps)).status).toBe(201);
    const over = await handle(post('/api/v1/games', {}), store, deps);
    expect(over.status).toBe(429);
    expect(store.rows.size).toBe(LIMITS.gamesPerIpPerDay);
    // Another address still can.
    expect((await handle(post('/api/v1/games', {}, '198.51.100.9'), store, deps)).status).toBe(201);
  });

  it('6. no response carries the seed or the raw state, and the address is stored only as a hash', async () => {
    const store = memoryStore();
    const start = await handle(post('/api/v1/games', {}), store, deps);
    const { id } = start.body as { id: string };
    const row = store.rows.get(id)!;
    const seedId = JSON.parse(row.session).id as string;
    expect(seedId).toMatch(/^play-/);
    const responses = [start, await handle(get(`/api/v1/games/${id}`), store, deps), await handle(post(`/api/v1/games/${id}/moves`, { move: { do: 'scout' } }), store, deps)];
    for (const r of responses) {
      const text = JSON.stringify(r.body);
      expect(text).not.toContain(seedId);
      expect(text).not.toContain('"sim"');
      expect(text).not.toContain('"session"');
    }
    expect(id).not.toBe(seedId);
    expect(JSON.stringify(row)).not.toContain('203.0.113.7');
  });

  it('serves the rules, refuses oversized bodies, and caps the moves in one game', async () => {
    const store = memoryStore();
    const rules = await handle(get('/api/v1/rules'), store, deps);
    expect(rules.status).toBe(200);
    expect(JSON.stringify(rules.body)).toContain('Greywind Reach');
    const big = { method: 'POST', path: '/api/v1/games', body: 'x'.repeat(LIMITS.bodyBytes + 1), ip: '203.0.113.7' };
    expect((await handle(big, store, deps)).status).toBe(413);
    const { id } = (await handle(post('/api/v1/games', {}), store, deps)).body as { id: string };
    store.rows.get(id)!.moves = Array.from({ length: LIMITS.movesPerGame }, () => ({ endDay: true as const }));
    expect((await handle(post(`/api/v1/games/${id}/moves`, { move: { endDay: true } }), store, deps)).status).toBe(429);
  });

  it('counts moves per address per day, across games, and refuses past the limit with 429', async () => {
    const store = memoryStore();
    const limits = { ...LIMITS, movesPerIpPerDay: 3 };
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) ids.push(((await handle(post('/api/v1/games', {}), store, deps, limits)).body as { id: string }).id);
    const move = (id: string, ip?: string) => handle(post(`/api/v1/games/${id}/moves`, { move: { do: 'scout' } }, ip), store, deps, limits);
    expect((await move(ids[0])).status).toBe(200);
    expect((await move(ids[1])).status).toBe(200);
    expect((await move(ids[0])).status).toBe(200);
    const over = await move(ids[1]);
    expect(over.status).toBe(429);
    expect(store.rows.get(ids[1])!.moves.length).toBe(1);
    // Another address playing the same game still can.
    expect((await move(ids[1], '198.51.100.9')).status).toBe(200);
  });

  it('stores the client and a self-reported model with the game, trimmed', async () => {
    const store = memoryStore();
    const r = await handle(post('/api/v1/games', { name: 'Ada', client: 'claude-ai', model: 'some-model-v1' }), store, deps);
    const row = store.rows.get((r.body as { id: string }).id)!;
    expect(row.client).toBe('claude-ai');
    expect(row.model).toBe('some-model-v1');
    const long = await handle(post('/api/v1/games', { model: 'm'.repeat(200) }), store, deps);
    expect(store.rows.get((long.body as { id: string }).id)!.model).toHaveLength(64);
    const none = await handle(post('/api/v1/games', {}), store, deps);
    expect(store.rows.get((none.body as { id: string }).id)!.model).toBeNull();
  });

  it('caps games and moves per UTC day across every address, so the free tiers hold', async () => {
    const store = memoryStore();
    const limits = { ...LIMITS, gamesPerDay: 2, movesPerDay: 2 };
    const start = (ip: string) => handle(post('/api/v1/games', {}, ip), store, deps, limits);
    const a = await start('198.51.100.1');
    expect(a.status).toBe(201);
    expect((await start('198.51.100.2')).status).toBe(201);
    const full = await start('198.51.100.3');
    expect(full.status).toBe(429);
    expect((full.body as { error: string }).error).toMatch(/today/i);
    const id = (a.body as { id: string }).id;
    const move = (ip: string) => handle(post(`/api/v1/games/${id}/moves`, { move: { do: 'scout' } }, ip), store, deps, limits);
    expect((await move('198.51.100.1')).status).toBe(200);
    expect((await move('198.51.100.2')).status).toBe(200);
    expect((await move('198.51.100.3')).status).toBe(429);
  });

  it('refuses a move that raced another on the same game, keeping the one that landed first', async () => {
    const store = memoryStore();
    const { id } = (await handle(post('/api/v1/games', {}), store, deps)).body as { id: string };
    // Both read the game before either saves: the second save finds it already moved on.
    const realGet = store.get;
    const snapshot = await realGet(id);
    store.get = async () => structuredClone(snapshot);
    const a = await handle(post(`/api/v1/games/${id}/moves`, { move: { do: 'scout' } }), store, deps);
    const b = await handle(post(`/api/v1/games/${id}/moves`, { move: { do: 'water' } }), store, deps);
    expect(a.status).toBe(200);
    expect(b.status).toBe(409);
    expect(store.rows.get(id)!.moves).toEqual([{ do: 'scout' }]);
  });
});

/** Play a stored game to its end through the API: sleep each day, take the first answer when asked. */
async function playToTheEnd(store: ReturnType<typeof memoryStore>, id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  let last = await handle(get(`/api/v1/games/${id}`), store, deps);
  for (let i = 0; i < 100 && (last.body as { phase: string }).phase !== 'ended'; i++) {
    const b = last.body as { phase: string; moves: { move: unknown }[] };
    last = await handle(post(`/api/v1/games/${id}/moves`, { move: b.phase === 'day' ? { endDay: true } : b.moves[0].move }), store, deps);
    expect(last.status).toBe(200);
  }
  return last;
}

describe('Run records from the play API (#1558)', () => {
  it('writes one record when a game ends, says where it is, and serves it', async () => {
    const store = memoryStore();
    const { id } = (await handle(post('/api/v1/games', { name: 'Ada Lovelace', model: 'some-model', client: 'curl' }), store, deps)).body as { id: string };
    expect((await handle(get(`/api/v1/games/${id}/run`), store, deps)).status).toBe(404); // not ended yet
    const end = await playToTheEnd(store, id);
    expect(end.body.record).toBe(`/records/?game=${id}`);
    expect(store.runs.size).toBe(1);

    const r = await handle(get(`/api/v1/games/${id}/run`), store, deps);
    expect(r.status).toBe(200);
    expect(r.cache).toBeGreaterThan(0);
    const run = (r.body as { run: Record<string, unknown> }).run;
    expect(run).toMatchObject({ playerKind: 'ai', model: 'some-model', client: 'curl', surface: 'api', nickname: 'Ada', stage: 'reach' });
    expect(run.moves).toBe(store.rows.get(id)!.moves.length);
    expect(JSON.stringify(run)).not.toContain(id); // the game id stays on the server

    const list = await handle(get('/api/v1/runs'), store, deps);
    expect(list.status).toBe(200);
    expect(list.cache).toBeGreaterThan(0);
    const { recent, best } = list.body as { recent: unknown[]; best: unknown[] };
    expect(recent).toHaveLength(1);
    expect(best).toHaveLength(1);
  });

  it("records the console's games as people's, and a player's own word over the default", async () => {
    const store = memoryStore();
    const consoleGame = (await handle(post('/api/v1/games', { client: 'artificer-console' }), store, deps)).body as { id: string };
    const said = (await handle(post('/api/v1/games', { player: 'person' }), store, deps)).body as { id: string };
    expect(store.rows.get(consoleGame.id)).toMatchObject({ surface: 'console', player: 'person' });
    expect(store.rows.get(said.id)).toMatchObject({ surface: 'api', player: 'person' });
    // The MCP server marks its own calls; a body can't claim it.
    const claimed = (await handle(post('/api/v1/games', { surface: 'mcp' }), store, deps)).body as { id: string };
    expect(store.rows.get(claimed.id)).toMatchObject({ surface: 'api', player: 'ai' });
    const viaMcp = (await handle({ ...post('/api/v1/games', {}), surface: 'mcp' }, store, deps)).body as { id: string };
    expect(store.rows.get(viaMcp.id)).toMatchObject({ surface: 'mcp', player: 'ai' });
  });

  it('writes a missing record when it is asked for, and lists only this version, without detail', async () => {
    const store = memoryStore();
    const insert = store.insertRun;
    let down = true;
    store.insertRun = async (k, r) => { if (down) throw new Error('database down'); return insert(k, r); };
    const realError = console.error;
    console.error = () => {};
    try {
      const { id } = (await handle(post('/api/v1/games', { name: 'Ada' }), store, deps)).body as { id: string };
      await playToTheEnd(store, id);
      expect(store.runs.size).toBe(0); // lost when the game ended
      down = false;
      const r = await handle(get(`/api/v1/games/${id}/run`), store, deps);
      expect(r.status).toBe(200);
      expect(store.runs.size).toBe(1);
      expect((await handle(get(`/api/v1/games/${id}/run`), store, deps)).status).toBe(200);
      expect(store.runs.size).toBe(1); // still one
    } finally {
      console.error = realError;
    }
    // Another version's record stays off the boards.
    const [own] = store.runs.values();
    await store.insertRun('game:old', { ...own, gameVersion: 'play-0/save-1' });
    const list = (await handle(get('/api/v1/runs'), store, deps)).body as { version: string; recent: Record<string, unknown>[]; best: Record<string, unknown>[] };
    expect(list.recent).toHaveLength(1);
    expect(list.best).toHaveLength(1);
    expect(list.recent[0].gameVersion).toBe(list.version);
    expect(list.recent[0]).not.toHaveProperty('detail');
  });

  it("serves every AI's records for the dev site: all versions, no people, milestone days instead of detail", async () => {
    const store = memoryStore();
    const ai = (await handle(post('/api/v1/games', { model: 'some-model' }), store, deps)).body as { id: string };
    const person = (await handle(post('/api/v1/games', { client: 'artificer-console' }), store, deps)).body as { id: string };
    await playToTheEnd(store, ai.id);
    await playToTheEnd(store, person.id);
    const own = (await store.runBySource(`game:${ai.id}`))!;
    await store.insertRun('bench:older', { ...own, gameVersion: 'play-0/save-1' });
    const r = await handle(get('/api/v1/runs/ai'), store, deps);
    expect(r.status).toBe(200);
    expect(r.cache).toBeGreaterThan(0);
    const runs = (r.body as { runs: Record<string, unknown>[] }).runs;
    expect(runs).toHaveLength(2);
    expect(runs.every(x => x.playerKind === 'ai')).toBe(true);
    expect(new Set(runs.map(x => x.gameVersion)).size).toBe(2);
    expect(runs[0]).not.toHaveProperty('detail');
    expect(runs[0].milestoneDays).toEqual(own.detail.milestones);
    // A record is written once per source, and says whether it was added.
    expect(await store.insertRun('bench:once', { ...own, surface: 'bench' })).toBe(true);
    expect(await store.insertRun('bench:once', { ...own, surface: 'bench' })).toBe(false);
    // Outside games, however many, can't push the playtest's runs off the list: each has its own limit.
    for (let i = 0; i < 5; i++) await store.insertRun(`flood:${i}`, { ...own, surface: 'api' });
    const capped = await store.aiRuns({ bench: 10, outside: 2 });
    expect(capped.filter(x => x.surface === 'bench')).toHaveLength(1);
    expect(capped.filter(x => x.surface !== 'bench')).toHaveLength(2);
  });

  it("still saves the move that ends a game when its record can't be written", async () => {
    const store = memoryStore();
    store.insertRun = async () => { throw new Error('database down'); };
    const { id } = (await handle(post('/api/v1/games', {}), store, deps)).body as { id: string };
    const errors: unknown[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      const end = await playToTheEnd(store, id);
      expect(end.status).toBe(200);
    } finally {
      console.error = realError;
    }
    expect(store.rows.get(id)!.phase).toBe('ended');
    expect(errors).toHaveLength(1);
  });
});

describe('Achievements from the play API (#1559)', () => {
  it('the move that ends a game says which achievements it earned, against the records before it', async () => {
    const store = memoryStore();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(((await handle(post('/api/v1/games', { model: 'm' }), store, deps)).body as { id: string }).id);
    const ends = [];
    for (const id of ids) ends.push(await playToTheEnd(store, id));
    const list = ends[2].body.achievements as { id: string; status: string; detail: string }[];
    expect(list.length).toBeGreaterThanOrEqual(5);
    // Two runs before it: too few to call anything a percentile.
    expect(list.find(a => a.id === 'top-tenth')!.status).toBe('open');
    expect(list.find(a => a.id === 'top-tenth')!.detail).toMatch(/2 so far/);
    expect(list.find(a => a.id === 'reached-mistheim')!.status).toBe('missed');
  });

  it("still ends the game, without achievements, when the records can't be read", async () => {
    const store = memoryStore();
    store.recentRuns = async () => { throw new Error('database down'); };
    const { id } = (await handle(post('/api/v1/games', {}), store, deps)).body as { id: string };
    const realError = console.error;
    console.error = () => {};
    try {
      const end = await playToTheEnd(store, id);
      expect(end.status).toBe(200);
      expect(end.body).not.toHaveProperty('achievements');
      expect(end.body.record).toBe(`/records/?game=${id}`);
    } finally {
      console.error = realError;
    }
  });
});

describe('The weekly world from the play API (#1559)', () => {
  /** The world a stored game plays: its session's id, which seeds it. */
  const worldOf = (store: ReturnType<typeof memoryStore>, id: string): string => JSON.parse(store.rows.get(id)!.session).id as string;

  it("Given this week, When anyone starts a weekly game, Then everyone gets the same world, and it's this week's", async () => {
    const store = memoryStore();
    const weekly = await handle(get('/api/v1/weekly'), store, deps);
    expect(weekly.status).toBe(200);
    const w = weekly.body as { week: string; seed: string; gameId: string; endsAt: string };
    expect(w.week).toBe('2026-W41'); // deps.now is Sunday 11 October 2026
    expect(w.gameId).toBe(`play-${w.seed}`);
    expect(w.endsAt).toBe('2026-10-12T00:00:00.000Z');
    expect(weekly.cache).toBe(300);

    const a = await handle(post('/api/v1/games', { weekly: true }), store, deps);
    const b = await handle(post('/api/v1/games', { weekly: true, name: 'Vega' }, '198.51.100.9'), store, deps);
    const plain = await handle(post('/api/v1/games', {}), store, deps);
    expect(a.status).toBe(201);
    expect((a.body as { week?: string }).week).toBe('2026-W41');
    expect(worldOf(store, (a.body as { id: string }).id)).toBe(w.gameId);
    expect(worldOf(store, (b.body as { id: string }).id)).toBe(w.gameId);
    expect((a.body as { text: string }).text).toBe((b.body as { text: string }).text);
    expect(worldOf(store, (plain.body as { id: string }).id)).toBe('play-s1');
    expect(plain.body).not.toHaveProperty('week');
    expect((await handle(post('/api/v1/games', { weekly: 'yes' }), store, deps)).status).toBe(400);
  });

  it("makes next week's seed from a server secret, and knows a week's real world from a look-alike", async () => {
    const { weeklySeed, isWeeklyWorld } = await import('./api');
    expect(weeklySeed('2026-W41', 'secret')).not.toBe(weeklySeed('2026-W41'));
    expect(weeklySeed('2026-W41', 'secret')).toMatch(/^wk-2026-W41-[0-9a-f]{8}$/);
    const salted = await handle(get('/api/v1/weekly'), memoryStore(), { ...deps, weeklySalt: 'secret' });
    expect((salted.body as { seed: string }).seed).toBe(weeklySeed('2026-W41', 'secret'));
    expect(isWeeklyWorld(`play-${weeklySeed('2026-W41', 'secret')}`, 'secret')).toBe(true);
    expect(isWeeklyWorld('play-wk-2026-W41-00000000', 'secret')).toBe(false);
    expect(isWeeklyWorld('play-s1', 'secret')).toBe(false);
  });

  it("Given a weekly run that ends, Then its record carries the week, the week's board lists it, and its achievements compare within the week", async () => {
    const store = memoryStore();
    // Five runs on fresh worlds first: plenty to compare with, but none on this week's world.
    for (let i = 0; i < 5; i++) await playToTheEnd(store, ((await handle(post('/api/v1/games', {}), store, deps)).body as { id: string }).id);
    const { id } = (await handle(post('/api/v1/games', { weekly: true, name: 'Vega' }), store, deps)).body as { id: string };
    const end = await playToTheEnd(store, id);
    const run = (await store.runBySource(`game:${id}`))!;
    expect(run.detail.week).toBe('2026-W41');
    const top = (end.body.achievements as { id: string; status: string; detail: string }[]).find(a => a.id === 'top-tenth')!;
    expect(top.status).toBe('open');
    expect(top.detail).toMatch(/0 so far/);

    const board = await handle(get('/api/v1/runs/week'), store, deps);
    expect(board.status).toBe(200);
    const body = board.body as { week: string; runs: { week: string | null; nickname: string | null }[] };
    expect(body.week).toBe('2026-W41');
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ week: '2026-W41', nickname: 'Vega' });
    expect(((await handle(get('/api/v1/runs/week/2026-W40'), store, deps)).body as { runs: unknown[] }).runs).toHaveLength(0);
    expect((await handle(get('/api/v1/runs/week/next-week'), store, deps)).status).toBe(400);
    // The main lists mark it too.
    const recent = ((await handle(get('/api/v1/runs'), store, deps)).body as { recent: { week: string | null }[] }).recent;
    expect(recent.filter(r => r.week === '2026-W41')).toHaveLength(1);
  });
});

describe('Web-game runs sent to the records, replayed first (#1559)', () => {
  /** A whole run played as the web page plays it, and what the page would send: its log and its claim. */
  function webRun(id: string, o: Partial<WebStart> = {}) {
    const start: WebStart = { id, name: 'Vega', chosen: talentOffer(seedOf(id)).slice(0, 2), features: ruleFeatures(), heirlooms: null, ...o };
    const { app, rec } = pagePlay(startOf(start), { log: newLog(start), measures: {} });
    const claim = claimOf(runOf(app, rec.measures, { playerKind: 'person', model: null, client: 'artificer-web', surface: 'web', gameVersion: GAME_VERSION, name: 'Vega', moves: rec.log.moves.length }));
    return { log: rec.log, claim, app };
  }
  const submit = (body: unknown, ip?: string) => handle(post('/api/v1/runs/submit', body, ip), memo.store, deps, memo.limits);
  const memo: { store: ReturnType<typeof memoryStore>; limits: typeof LIMITS } = { store: memoryStore(), limits: LIMITS };
  const fresh = (limits = LIMITS) => { memo.store = memoryStore(); memo.limits = limits; return memo.store; };

  it('Given a run that replays to what the page says, Then it gets a record, as a person in the web game, with achievements; sent again, it is the same one', async () => {
    const store = fresh();
    const { log, claim } = webRun('w-test-sub1');
    const r = await submit({ log, claim, name: 'Ada Lovelace' });
    expect(r.status).toBe(201);
    const { id, record, achievements } = r.body as { id: string; record: string; achievements: unknown[] };
    expect(record).toBe(`/records/?game=${id}`);
    expect(achievements.length).toBeGreaterThanOrEqual(5);
    expect(store.rows.get(id)).toMatchObject({ surface: 'web', player: 'person', phase: 'ended', client: 'artificer-web' });
    const run = ((await handle(get(`/api/v1/games/${id}/run`), store, deps)).body as { run: Record<string, unknown> }).run;
    expect(run).toMatchObject({ surface: 'web', playerKind: 'person', nickname: 'Ada', outcome: claim.outcome, endDay: claim.endDay, moves: log.moves.length });
    const again = await submit({ log, claim, name: 'Someone' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id, already: true });
    expect(store.runs.size).toBe(1);
  });

  it("Given a run that doesn't replay to the same end, Then it's refused with 422 and nothing is kept", async () => {
    const store = fresh();
    const { log, claim } = webRun('w-test-sub2');
    // A better end than the run had.
    const better = await submit({ log, claim: { ...claim, outcome: claim.outcome === 'arrived' ? 'died' : 'arrived', skillLevels: claim.skillLevels + 5 } });
    expect(better.status).toBe(422);
    expect((better.body as { differs: string[] }).differs).toEqual(expect.arrayContaining(['outcome', 'skillLevels']));
    // A move taken out of the middle: the rest no longer lines up.
    const cut = await submit({ log: { ...log, moves: [...log.moves.slice(0, 10), ...log.moves.slice(12)] }, claim });
    expect(cut.status).toBe(422);
    // Another version's run, and something that isn't a log.
    expect((await submit({ log: { ...log, version: 'play-0/save-1' }, claim })).status).toBe(422);
    expect((await submit({ log: { nope: true }, claim })).status).toBe(400);
    expect((await submit({ log: { ...log, start: { ...log.start, stats: { str: 18, con: 18, agi: 18, int: 18, wil: 18, cha: 18 } } }, claim })).status).toBe(400);
    expect(store.rows.size).toBe(0);
    expect(store.runs.size).toBe(0);
  });

  it("takes a whole run's log in one body, which no other request may send, and counts it among the day's games", async () => {
    fresh({ ...LIMITS, gamesPerIpPerDay: 1 });
    const padded = JSON.stringify({ log: { pad: 'x'.repeat(LIMITS.bodyBytes) } });
    expect((await handle({ method: 'POST', path: '/api/v1/runs/submit', body: padded, ip: '203.0.113.7' }, memo.store, deps)).status).toBe(400);
    expect((await handle({ method: 'POST', path: '/api/v1/games', body: padded, ip: '203.0.113.7' }, memo.store, deps)).status).toBe(413);
    const one = webRun('w-test-sub3');
    expect((await submit({ log: one.log, claim: one.claim })).status).toBe(201);
    const two = webRun('w-test-sub4');
    expect((await submit({ log: two.log, claim: two.claim })).status).toBe(429);
    // Sending the first one again stores nothing new, so it's still answered.
    expect((await submit({ log: one.log, claim: one.claim })).status).toBe(200);
  });

  it("Given this week's world, Then its runs count on its board; a look-alike world, an old week or heirlooms don't", async () => {
    const store = fresh();
    const weekly = `play-${weeklySeed('2026-W41')}`;
    const w = webRun(weekly);
    const ok = await submit({ log: w.log, claim: w.claim });
    expect(ok.status).toBe(201);
    expect((await store.runBySource(`game:${(ok.body as { id: string }).id}`))!.detail.week).toBe('2026-W41');
    expect(((await handle(get('/api/v1/runs/week'), store, deps)).body as { runs: unknown[] }).runs).toHaveLength(1);
    // Last week's world still counts (a run begun on Sunday night); the week before that has closed.
    const last = webRun(`play-${weeklySeed('2026-W40')}`);
    expect((await submit({ log: last.log, claim: last.claim })).status).toBe(201);
    const old = webRun(`play-${weeklySeed('2026-W39')}`);
    expect((await submit({ log: old.log, claim: old.claim })).status).toBe(422);
    const fake = webRun('play-wk-2026-W41-00000000');
    expect((await submit({ log: fake.log, claim: fake.claim })).body).toMatchObject({ error: expect.stringMatching(/isn't the world of 2026-W41/) });
    const kept = { ...w.log, start: { ...w.log.start, heirlooms: [{ item: 'knife', grade: 'sound', heirloom: true }] } };
    expect((await submit({ log: kept, claim: w.claim })).status).toBe(422);
  });

  it('Given heirlooms, Then they count only from a run that was sent and checked, and only what it left', async () => {
    const store = fresh();
    const first = webRun('w-test-heir1');
    const a = await submit({ log: first.log, claim: first.claim });
    expect(a.status).toBe(201);
    const fromId = (a.body as { id: string }).id;
    const left = heirloomsOf(currentRun(first.app)).heirlooms ?? [];
    expect(left.length).toBeGreaterThan(0);
    // The next Warden, with what the first one left.
    const next = webRun('w-test-heir2', { heirlooms: left, heirloomsFrom: fromId });
    expect((await submit({ log: next.log, claim: next.claim })).status).toBe(201);
    // The same heirlooms without saying where from, and heirlooms that run never left.
    const unchecked = webRun('w-test-heir3', { heirlooms: left });
    expect((await submit({ log: unchecked.log, claim: unchecked.claim })).body).toMatchObject({ error: expect.stringMatching(/wasn't sent to the records/) });
    const invented = webRun('w-test-heir4', { heirlooms: [{ item: left[0].item, grade: 'masterwork', heirloom: true }], heirloomsFrom: fromId });
    expect((await submit({ log: invented.log, claim: invented.claim })).body).toMatchObject({ error: expect.stringMatching(/aren't what that run left/) });
    expect(store.runs.size).toBe(2);
  });
});
