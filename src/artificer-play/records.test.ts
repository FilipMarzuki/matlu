/**
 * Run records (#1558): nicknames fit for a public board, how runs rank, and records built from
 * real finished games (one that dies in the Reach, one that rides the road to its end).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { startGame, view, apply, gameFrom, GAME_VERSION, type Game, type Move } from './session';
import { nicknameOf, compareRuns, rankKey, percentBeaten, tierOf, outcomeLine, groupOf, type Run } from './records';
import { measure, runOf, midwinterDay, type RunMeta } from './record-of';
import { runToRow } from './supabase-store';

const must = (g: Game, m: Move): Game => {
  const r = apply(g, m);
  if (!r.ok) throw new Error(`${JSON.stringify(m)} refused: ${r.error}`);
  return r.game;
};

/** Sleep through every day until the run ends: the Warden starves or freezes in the Reach. */
function diedInTheReach(): Game {
  let g = startGame({ seed: 'records-1', name: 'Vega' });
  for (let i = 0; i < 80 && view(g).phase !== 'ended'; i++) {
    const v = view(g);
    g = must(g, v.phase === 'day' ? { endDay: true } : v.moves[0].move);
  }
  return g;
}

/** A Warden at the thaw, then the meeting and the road to the end (as session.test.ts does). */
function rodeTheRoad(): Game {
  const s = createRegion1({}, undefined, { id: 'play-thaw', name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  const thaw: Region1State = { ...s, day: 61, vitals, tools: [], stores: { ...s.stores, rawFood: 10, water: 10, materials: 6, hides: 0, rations: 0 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  let g = gameFrom({ sim: thaw, queue: [], stage: 'reach' }, 'play-thaw');
  for (let i = 0; i < 80 && view(g).phase !== 'ended'; i++) {
    const v = view(g);
    g = must(g, v.phase === 'road' ? { endDay: true } : v.moves[0].move);
  }
  return g;
}

const meta: RunMeta = { playerKind: 'person', model: null, client: 'artificer-console', surface: 'console', gameVersion: GAME_VERSION, name: 'Vega', moves: 12 };

/** A run with only the fields ranking reads set; the rest are defaults. */
const run = (o: Partial<Run>): Run => ({
  playerKind: 'ai', model: 'm', client: null, surface: 'api', gameVersion: GAME_VERSION, nickname: null,
  outcome: 'died', grade: null, stage: 'reach', endDay: 10, readyDay: null, larderMidwinter: null, shelterTier: 0,
  skillLevels: 0, conceptRanks: 0, recipes: 0, milestones: 0, moves: 0, costUsd: null,
  detail: { site: null, tools: [], topConcept: null, skills: {} }, ...o,
});

describe('Run records (#1558)', () => {
  it('keeps a nickname to one word of letters, and drops blocked words and the default', () => {
    expect(nicknameOf('Vega')).toBe('Vega');
    expect(nicknameOf('  Anna Svensson ')).toBe('Anna'); // a first and last name together could be a real person's
    expect(nicknameOf('Max2013')).toBe('Max'); // digits could be a birth year
    expect(nicknameOf('Åsa-Lena')).toBe('Åsa-Lena');
    expect(nicknameOf('ThisNameIsFarTooLongToShow')).toHaveLength(16);
    expect(nicknameOf('Warden')).toBeNull();
    expect(nicknameOf('')).toBeNull();
    expect(nicknameOf(null)).toBeNull();
    expect(nicknameOf('sh1thead')).toBeNull(); // look-alike digits are read as letters
    expect(nicknameOf('Fitta')).toBeNull();
    expect(nicknameOf('dick')).toBeNull();
    // Ordinary names that hold a short blocked stem stay.
    expect(nicknameOf('Thora')).toBe('Thora');
    expect(nicknameOf('Peacock')).toBe('Peacock');
    expect(nicknameOf('Skillet')).toBe('Skillet');
  });

  it('ranks further runs first: Mistheim, then the thaw (by grade), then the day the body gave out', () => {
    const arrived = run({ outcome: 'arrived', stage: 'road', endDay: 70 });
    const roadDeath = run({ outcome: 'died', stage: 'road', endDay: 66 });
    const hale = run({ outcome: 'survived', grade: 'hale', endDay: 61, readyDay: 25 });
    const broken = run({ outcome: 'survived', grade: 'broken', endDay: 61, readyDay: 20 });
    const day30 = run({ endDay: 30 });
    const day11 = run({ endDay: 11 });
    expect([day11, broken, roadDeath, day30, arrived, hale].sort(compareRuns)).toEqual([arrived, roadDeath, hale, broken, day30, day11]);
    expect([tierOf(arrived), tierOf(roadDeath), tierOf(hale), tierOf(day11)]).toEqual([3, 2, 2, 1]);
    // Each part of the rank key has its own digits: no number of milestones outweighs a day further.
    expect(rankKey(run({ endDay: 12 }))).toBeGreaterThan(rankKey(run({ endDay: 11, milestones: 99, readyDay: 1, grade: 'hale' })));
    expect(percentBeaten(day30, [day11, hale, broken, day30])).toBe(38); // beats one, ties one (half): 1.5 of 4
    expect(percentBeaten(day30, [])).toBeNull();
    expect(outcomeLine(day11)).toBe('died on day 11');
    expect(outcomeLine(hale)).toBe('survived the winter (hale)');
    expect(outcomeLine(arrived)).toBe('reached Mistheim');
    expect(groupOf(run({ playerKind: 'person', model: 'x' }))).toBe('People');
    expect(groupOf(run({ model: null }))).toBe('AI (model not given)');
  });

  it('records a game that ended in the Reach, with who played it and how far it got', () => {
    const g = diedInTheReach();
    expect(view(g).phase).toBe('ended');
    const r = runOf(g.app, {}, meta);
    expect(r).toMatchObject({ playerKind: 'person', surface: 'console', nickname: 'Vega', stage: 'reach', endDay: g.app.sim.day, larderMidwinter: null, moves: 12, costUsd: null });
    expect(['died', 'collapsed']).toContain(r.outcome);
    expect(tierOf(r)).toBe(1);
    expect(r.skillLevels).toBe(Object.values(r.detail.skills).reduce((n, l) => n + l, 0));
    expect(() => runOf(startGame({ seed: 'records-2' }).app, {}, meta)).toThrow(/finished/);
  });

  it('records a run that rode the road, from where it ended', () => {
    const g = rodeTheRoad();
    expect(view(g).phase).toBe('ended');
    const r = runOf(g.app, {}, { ...meta, playerKind: 'ai', model: 'some-model', surface: 'mcp' });
    expect(r.grade).toBe('hale');
    if (g.app.stage === 'road') {
      expect(r.stage).toBe('road');
      expect(r.endDay).toBeGreaterThan(61);
      expect(r.detail.road).toBeDefined();
    } else {
      expect(r.outcome).toBe('survived'); // stayed behind at the thaw
    }
    expect(tierOf(r)).toBeGreaterThanOrEqual(2);
  });

  it('stores a record as a row: whole numbers in the integer columns, and the rank key beside it', () => {
    const r = run({ endDay: 10, larderMidwinter: 2.5, costUsd: 0.0123 });
    expect(runToRow('game:abc', r)).toMatchObject({ source_key: 'game:abc', end_day: 10, larder_midwinter: 3, cost_usd: 0.0123, rank_key: rankKey(r), ready_day: null });
  });

  it('takes the larder once, on the first morning at or past midwinter', () => {
    const app = startGame({ seed: 'records-3' }).app;
    expect(measure({}, app)).toEqual({});
    const at = (day: number, rations: number) => ({ ...app, sim: { ...app.sim, day, stores: { ...app.sim.stores, rations } } });
    const mid = midwinterDay(app.sim);
    const taken = measure({}, at(mid, 7));
    expect(taken).toEqual({ larderMidwinter: 7 });
    expect(measure(taken, at(mid + 3, 2))).toEqual({ larderMidwinter: 7 });
    expect(runOf(diedInTheReach().app, taken, meta).larderMidwinter).toBe(7);
  });
});
