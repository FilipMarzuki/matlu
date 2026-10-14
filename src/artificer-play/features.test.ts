/**
 * Feature switches from outside the page (#1579): a game started over the API (or MCP, or the
 * console) can switch rule features; its view and its run record say which were on, and a game
 * with free questions off refuses one. The same seed, moves and features replay the same.
 */

import { describe, it, expect } from 'vitest';
import { apply, startGame, view, serialize, gameFrom, GAME_VERSION } from './session';
import { handle, memoryStore, type ApiRequest } from './api';
import { hollowfordGame } from './fixtures';
import { loadChoices, saveChoices, devMode, devTruths } from '../artificer-app/feature-choices';

let n = 0;
const deps = { now: () => Date.parse('2026-10-11T12:00:00Z'), newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, newSeed: () => 's1' };
const post = (path: string, body: unknown): ApiRequest => ({ method: 'POST', path, body: JSON.stringify(body), ip: '203.0.113.7' });

/** The Hollowford fixture with its run's rule features set. */
function hollowfordWith(features: Record<string, boolean>) {
  const g = hollowfordGame();
  const app = { ...g.app, sim: { ...g.app.sim, config: { ...g.app.sim.config, world: { ...g.app.sim.config.world, features } } }, road: { ...g.app.road!, features } };
  return gameFrom(app, g.id);
}

describe('Features in the session core (#1579)', () => {
  it('a game says which rule features it plays with, defaults unless switched', () => {
    expect(view(startGame({ seed: 'f1' })).features).toEqual({ 'free-questions': true, referrals: true, 'knowledge-questions': true, 'scope-facts': true, 'candour-by-place': true, 'village-economies': true, organisations: true, 'humans-on-the-road': true, ties: true, 'rumours-and-lies': true, 'rumour-drift': true, 'old-history-drift': true, 'history-in-play': true, 'history-retold': true, 'grudges-and-help': true, 'caught-lies': true, 'action-length': true, 'reach-and-secrets': true, consistency: true, 'action-visibility': true, 'run-rumours': true, 'descriptive-map': true });
    expect(view(startGame({ seed: 'f1', features: { 'free-questions': false } })).features).toEqual({ 'free-questions': false, referrals: true, 'knowledge-questions': true, 'scope-facts': true, 'candour-by-place': true, 'village-economies': true, organisations: true, 'humans-on-the-road': true, ties: true, 'rumours-and-lies': true, 'rumour-drift': true, 'old-history-drift': true, 'history-in-play': true, 'history-retold': true, 'grudges-and-help': true, 'caught-lies': true, 'action-length': true, 'reach-and-secrets': true, consistency: true, 'action-visibility': true, 'run-rumours': true, 'descriptive-map': true });
  });

  it('with free questions off, the ask move is refused and the road view doesn’t offer it', () => {
    const off = hollowfordWith({ 'free-questions': false });
    expect(view(off).text).not.toMatch(/Free questions/);
    const r = apply(off, { ask: { person: 'hf-orrin', question: 'Where is the iron?' } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/off in this game/);
    const on = hollowfordWith({ 'free-questions': true });
    expect(view(on).text).toMatch(/Free questions \(an experiment\)/);
    expect(apply(on, { ask: { person: 'hf-orrin', question: 'Where is the iron?' } }).ok).toBe(true);
  });

  it('replays the same: the same seed, moves and features give the same game', () => {
    const play = () => {
      let g = startGame({ seed: 'f2', features: { 'free-questions': false } });
      for (const m of [{ do: 'scout' }, { endDay: true }, { do: 'water' }] as const) {
        const r = apply(g, m);
        if (r.ok) g = r.game;
      }
      return serialize(g);
    };
    expect(play()).toBe(play());
  });
});

describe('Features through the API (#1579)', () => {
  it('starts a game with switches, says them in the view, and keeps them in its record', async () => {
    const store = memoryStore();
    const r = await handle(post('/api/v1/games', { features: { 'free-questions': false } }), store, deps);
    expect(r.status).toBe(201);
    const b = r.body as { id: string; features: Record<string, boolean> };
    expect(b.features).toEqual({ 'free-questions': false, referrals: true, 'knowledge-questions': true, 'scope-facts': true, 'candour-by-place': true, 'village-economies': true, organisations: true, 'humans-on-the-road': true, ties: true, 'rumours-and-lies': true, 'rumour-drift': true, 'old-history-drift': true, 'history-in-play': true, 'history-retold': true, 'grudges-and-help': true, 'caught-lies': true, 'action-length': true, 'reach-and-secrets': true, consistency: true, 'action-visibility': true, 'run-rumours': true, 'descriptive-map': true });
    // Played to its end (sleeping every night), its record says what was on.
    for (let i = 0; i < 120 && store.rows.get(b.id)!.phase !== 'ended'; i++) {
      const v = (await handle({ method: 'GET', path: `/api/v1/games/${b.id}`, ip: '203.0.113.7' }, store, deps)).body as { phase: string; moves: { move: unknown }[] };
      await handle(post(`/api/v1/games/${b.id}/moves`, { move: v.phase === 'day' || v.phase === 'road' ? { endDay: true } : v.moves[0].move }), store, deps);
    }
    const run = (await store.runBySource(`game:${b.id}`))!;
    expect(run.detail.features).toEqual({ 'free-questions': false, referrals: true, 'knowledge-questions': true, 'scope-facts': true, 'candour-by-place': true, 'village-economies': true, organisations: true, 'humans-on-the-road': true, ties: true, 'rumours-and-lies': true, 'rumour-drift': true, 'old-history-drift': true, 'history-in-play': true, 'history-retold': true, 'grudges-and-help': true, 'caught-lies': true, 'action-length': true, 'reach-and-secrets': true, consistency: true, 'action-visibility': true, 'run-rumours': true, 'descriptive-map': true });
    // The lists carry the features, so the Records page can mark experimental runs.
    const list = (await handle({ method: 'GET', path: '/api/v1/runs', ip: '203.0.113.7' }, store, deps)).body as { recent: { features?: unknown }[] };
    expect(list.recent[0].features).toEqual({ 'free-questions': false, referrals: true, 'knowledge-questions': true, 'scope-facts': true, 'candour-by-place': true, 'village-economies': true, organisations: true, 'humans-on-the-road': true, ties: true, 'rumours-and-lies': true, 'rumour-drift': true, 'old-history-drift': true, 'history-in-play': true, 'history-retold': true, 'grudges-and-help': true, 'caught-lies': true, 'action-length': true, 'reach-and-secrets': true, consistency: true, 'action-visibility': true, 'run-rumours': true, 'descriptive-map': true });
  }, 30_000);

  it('refuses a feature it doesn’t know, or switches that aren’t true or false', async () => {
    const store = memoryStore();
    expect((await handle(post('/api/v1/games', { features: { 'no-such-thing': true } }), store, deps)).status).toBe(400);
    expect((await handle(post('/api/v1/games', { features: { 'free-questions': 'off' } }), store, deps)).status).toBe(400);
    expect((await handle(post('/api/v1/games', { features: ['free-questions'] }), store, deps)).status).toBe(400);
    expect(store.rows.size).toBe(0);
  });

  it('lists the features in the rules', async () => {
    const r = await handle({ method: 'GET', path: '/api/v1/rules', ip: '203.0.113.7' }, memoryStore(), deps);
    expect((r.body as { features: { id: string }[] }).features.map(f => f.id)).toContain('free-questions');
    expect(GAME_VERSION).toMatch(/^play-/);
  });
});

describe('The player’s switches and dev mode, in the browser (#1579)', () => {
  /** A stand-in for localStorage. */
  const fakeStore = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('remembers switches, and reads anything unreadable as none', () => {
    const s = fakeStore();
    expect(loadChoices(s)).toEqual({});
    saveChoices({ 'free-questions': false }, s);
    expect(loadChoices(s)).toEqual({ 'free-questions': false });
    s.setItem('artificer.features', 'not json');
    expect(loadChoices(s)).toEqual({});
    expect(loadChoices(null)).toEqual({});
  });

  it('shows the hidden truths only with ?dev=truths, never in plain dev mode (#1578)', () => {
    const s = fakeStore();
    expect(devTruths('', s)).toBe(false);
    expect(devMode('?dev=truths', s)).toBe(false); // an extra inside dev mode, never the way in (#1688)
    expect(devTruths('?dev=truths', s)).toBe(true);
    expect(devTruths('', s)).toBe(true); // remembered
    expect(devTruths('?dev', s)).toBe(false); // plain dev mode turns them off again
    expect(devTruths('', s)).toBe(false);
    expect(devTruths('?dev=truths', null)).toBe(true);
    expect(devTruths('', null)).toBe(false);
  });
});
