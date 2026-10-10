/**
 * Acceptance tests for #1554 — the game session core behind every way of playing from outside
 * (HTTP API, remote MCP, text console: #1553). One scenario per test, as the issue states them.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, DAY_HOURS, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { observe } from '../artificer-ai/observe';
import { makeWarden } from '../artificer-app/controller';
import { startGame, view, apply, serialize, deserialize, gameFrom, GAME_VERSION, type Game, type Move } from './session';

/** Apply a move that must succeed. */
const must = (g: Game, m: Move): Game => {
  const r = apply(g, m);
  if (!r.ok) throw new Error(`${JSON.stringify(m)} refused: ${r.error}`);
  return r.game;
};

/** A Warden who made it to the thaw (as the caravan meeting's own tests build one). */
function survivor(): Region1State {
  const s = createRegion1({}, undefined, { id: 'play-thaw', name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, tools: [], stores: { ...s.stores, rawFood: 10, water: 10, materials: 6, hides: 0, rations: 0 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
}

describe('The game session core (#1554)', () => {
  it('1. a new game opens on day 1 with the observation the AI harness writes, and scouting near', () => {
    const g = startGame({ seed: 's1' });
    const v = view(g);
    expect(v.phase).toBe('day');
    expect(v.text).toBe(observe(makeWarden({ id: g.id, name: 'Warden' }).sim));
    expect(v.text).toContain('DAY 1');
    expect(v.moves.map(m => JSON.stringify(m.move))).toContain(JSON.stringify({ do: 'scout' }));
  });

  it('2. the same seed and the same moves give the same game', () => {
    const moves: Move[] = [{ do: 'scout' }, { do: 'water' }, { endDay: true }, { do: 'wood' }, { endDay: true }];
    const play = () => moves.reduce((g, m) => { const r = apply(g, m); return r.ok ? r.game : g; }, startGame({ seed: 's1' }));
    expect(serialize(play())).toBe(serialize(play()));
    // And another seed is another world.
    expect(view(startGame({ seed: 's2' })).text).not.toBe(view(startGame({ seed: 's1' })).text);
  });

  it('3. an unknown or blocked action is refused with the reason and the legal moves, and changes nothing', () => {
    const g = startGame({ seed: 's1' });
    const before = serialize(g);
    const unknown = apply(g, { do: 'teleport' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.error).toMatch(/teleport/);
      expect(unknown.moves.length).toBeGreaterThan(0);
    }
    // Ring 3 isn't reachable on day 1: you haven't scouted the way.
    const blocked = apply(g, { do: 'scout@3' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.length).toBeGreaterThan(10);
    expect(serialize(g)).toBe(before);
  });

  it('4. one action reports only what it added to the journal, and the status shows the hours it took', () => {
    const g = startGame({ seed: 's1' });
    const logBefore = g.app.sim.log.length;
    const r = apply(g, { do: 'scout' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const added = r.game.app.sim.log.slice(logBefore).map(l => l.text);
    expect(r.changed).toEqual(added);
    expect(r.changed.join(' ')).toMatch(/Scouted/);
    const hours = r.game.app.sim.hoursToday;
    expect(hours).toBeGreaterThan(0);
    expect(r.view.status).toContain(`${hours}/${DAY_HOURS}h`);
    // The full observation is still there on demand.
    expect(view(r.game).text).toBe(observe(r.game.app.sim));
  });

  it('5. an encounter pauses the day: its options are the moves, and choosing one resolves it', () => {
    // Work the near ground (food and water, so the Warden lives) until something happens out
    // there. Seeded, so the first seed that meets an encounter is always the same one.
    const meet = (seed: string): Game | null => {
      let g = startGame({ seed });
      for (let day = 0; day < 8; day++) {
        for (const work of ['water', 'gather', 'gather']) {
          if (view(g).phase !== 'day') return view(g).phase === 'encounter' ? g : null;
          const r = apply(g, { do: work });
          if (r.ok) g = r.game;
        }
        if (view(g).phase === 'encounter') return g;
        if (view(g).phase !== 'day') return null;
        g = must(g, { endDay: true });
      }
      return null;
    };
    const g = Array.from({ length: 20 }, (_, i) => `enc-${i}`).map(meet).find(x => x)!;
    expect(g).toBeTruthy();
    const v = view(g);
    expect(v.phase).toBe('encounter');
    expect(v.moves.length).toBeGreaterThan(0);
    expect(v.moves.every(m => 'choose' in m.move)).toBe(true);
    const after = must(g, v.moves[0].move);
    // A dialogue can take more than one answer; keep answering until it's resolved.
    let h = after;
    for (let i = 0; i < 5 && view(h).phase === 'encounter'; i++) h = must(h, view(h).moves[0].move);
    expect(view(h).phase).toBe('day');
  });

  it('6. after the thaw the run goes on through the caravan meeting and the road, and ends with a summary', () => {
    let g = gameFrom({ sim: survivor(), queue: [], stage: 'reach' }, 'play-thaw');
    expect(view(g).phase).toBe('meeting');
    // Answer the caravan master until the meeting is over (the first offered answer each time).
    for (let i = 0; i < 6 && view(g).phase === 'meeting'; i++) g = must(g, view(g).moves[0].move);
    const phase = view(g).phase;
    expect(['road', 'ended']).toContain(phase);
    if (phase === 'road') {
      // Ride the whole road, a day at a time.
      for (let i = 0; i < 60 && view(g).phase !== 'ended'; i++) {
        const v = view(g);
        g = v.phase === 'road-encounter' ? must(g, v.moves[0].move) : must(g, { endDay: true });
      }
    }
    const end = view(g);
    expect(end.phase).toBe('ended');
    expect(end.moves).toEqual([]);
    expect(end.text).toMatch(/run is over/i);
    expect(apply(g, { endDay: true }).ok).toBe(false);
  });

  it('plans a whole day only once the Warden has learned to plan, as the page does', () => {
    const g = startGame({ seed: 's1' });
    const locked = apply(g, { plan: ['scout', 'water'] });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error).toMatch(/plan/i);
    // An open-planning Warden (as tests and older saves have) runs the day and sleeps.
    const open = gameFrom({ ...g.app, sim: { ...g.app.sim, canPlan: true } }, g.id);
    const r = apply(open, { plan: ['scout', 'water', 'gather@9'] });
    expect(r.ok).toBe(false); // ring 9 doesn't exist
    const ok = apply(open, { plan: ['scout', 'water'] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.game.app.sim.day).toBe(2);
  });

  it('7. a game survives being saved and loaded, and the save carries the game version', () => {
    let g = startGame({ seed: 's1' });
    g = must(g, { do: 'scout' });
    const saved = serialize(g);
    expect(JSON.parse(saved).version).toBe(GAME_VERSION);
    const loaded = deserialize(saved);
    expect(loaded).not.toBeNull();
    expect(view(loaded!)).toEqual(view(g));
    // Garbage, or a save from another version, loads as nothing rather than a broken game.
    expect(deserialize('not json')).toBeNull();
    expect(deserialize(JSON.stringify({ ...JSON.parse(saved), version: 'old' }))).toBeNull();
  });
});
