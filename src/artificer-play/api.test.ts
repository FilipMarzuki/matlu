/**
 * Acceptance tests for #1555 — the HTTP API over the session core, with games stored on our side.
 * The handler takes a store, so these run against an in-memory one; the Vercel function wires it
 * to Supabase.
 */

import { describe, it, expect } from 'vitest';
import { handle, memoryStore, LIMITS, type ApiRequest } from './api';

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
