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
