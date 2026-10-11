/**
 * Run records (#1558): nicknames fit for a public board, how runs rank, and records built from
 * real finished games (one that dies in the Reach, one that rides the road to its end).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { startGame, view, apply, gameFrom, GAME_VERSION, type Game, type Move } from './session';
import { nicknameOf, compareRuns, rankKey, percentBeaten, tierOf, outcomeLine, groupOf, type Run } from './records';
import { measure, runOf, midwinterDay, milestoneDays, runOfTranscript, modelOf, isModelGame, type RunMeta } from './record-of';
import { playRun, aiCharacterId } from '../artificer-ai/runner';
import { scriptedPlayer } from '../artificer-ai/players/scripted';
import type { Transcript } from '../artificer-ai/report';
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
    // Cut by characters: a letter outside the basic plane is never split in half.
    const fancy = nicknameOf(`a${'𝓪'.repeat(20)}`)!;
    expect([...fancy]).toHaveLength(16);
    expect(fancy).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
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

  it('ranks Mistheim first, then alive after the thaw (by grade), then deaths by how long the Warden lasted', () => {
    const arrived = run({ outcome: 'arrived', stage: 'road', endDay: 70 });
    const roadDeath = run({ outcome: 'died', stage: 'road', endDay: 66 });
    const hale = run({ outcome: 'survived', grade: 'hale', endDay: 61, readyDay: 25 });
    const broken = run({ outcome: 'survived', grade: 'broken', endDay: 61, readyDay: 20 });
    const day30 = run({ endDay: 30 });
    const day11 = run({ endDay: 11 });
    expect([day11, broken, roadDeath, day30, arrived, hale].sort(compareRuns)).toEqual([arrived, hale, broken, roadDeath, day30, day11]);
    // Among the living the day says nothing: a slower arrival isn't a better one.
    const slow = run({ outcome: 'arrived', stage: 'road', endDay: 90, grade: 'worn' });
    const fast = run({ outcome: 'arrived', stage: 'road', endDay: 72, grade: 'hale' });
    expect(compareRuns(fast, slow)).toBeLessThan(0);
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

  it('carries the full progress: stats, skills, stores, concepts, the land, readiness, and the day of every milestone', () => {
    const g = diedInTheReach();
    const d = runOf(g.app, {}, meta).detail;
    expect(Object.keys(d.stats ?? {})).toEqual(expect.arrayContaining(['str', 'con', 'agi', 'int']));
    expect(d.stores).toMatchObject({ rawFood: expect.any(Number), water: expect.any(Number), rations: expect.any(Number) });
    expect(d.exploration?.total).toBe(Object.values(d.exploration!.byRing).reduce((n, x) => n + x, 0));
    expect(d.readiness?.overall).toBeGreaterThanOrEqual(0);
    expect(d.vitals?.condition).toBeGreaterThanOrEqual(0);
    expect(d.concepts).toEqual(expect.any(Object)); // empty here: sleeping every day teaches nothing
    // Milestones come with the day each was reached, in order, none after the run ended.
    const days = d.milestones!.map(m => m.day);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(days.every(x => x <= g.app.sim.day)).toBe(true);
    expect(milestoneDays([{ day: 2, text: 'Milestone — Water secured' }, { day: 5, text: 'Milestone — Water secured' }, { day: 3, text: 'Scouted' }])).toEqual([{ name: 'Water secured', day: 2 }]);
  });

  it("records a playtest transcript in the same shape, from its day-by-day progress", async () => {
    // A real transcript: the scripted baseline lives through the winter and rides the road.
    const played = await playRun(scriptedPlayer(), { road: true, characterId: aiCharacterId('scripted', 'records') });
    const { final: _final, ...saved } = played;
    const t = JSON.parse(JSON.stringify(saved)) as Transcript;
    const r = runOfTranscript(t, { gameVersion: GAME_VERSION })!;
    expect(r).toMatchObject({ playerKind: 'ai', surface: 'bench', client: 'artificer-bench', model: 'scripted', nickname: null, grade: t.record.grade ?? null });
    expect(r.moves).toBe(t.turns.length + (t.road?.turns.length ?? 0));
    expect(r.stage).toBe(t.road ? 'road' : 'reach');
    if (t.road) expect(r.endDay).toBeGreaterThan(t.record.day);
    expect(r.larderMidwinter).toBe(t.turns.find(x => x.progress.day >= 45)!.progress.stores.rations); // it lived through midwinter
    expect(r.detail.milestones!.length).toBeGreaterThan(0);
    expect(r.detail.milestones!.find(m => m.name === 'Winter-ready')?.day ?? null).toBe(t.record.readyDay);
    // Only models' games become records; a game the budget stopped mid-run has none.
    expect(isModelGame(t)).toBe(false);
    expect(isModelGame({ player: 'openrouter:google/gemini-2.5-pro' })).toBe(true);
    expect(modelOf('openrouter:google/gemini-2.5-pro')).toBe('google/gemini-2.5-pro');
    expect(modelOf('claude:claude-haiku-5-5:low')).toBe('claude-haiku-5-5');
    expect(runOfTranscript({ ...t, record: { ...t.record, kind: 'stopped' } }, { gameVersion: GAME_VERSION })).toBeNull();
  }, 60_000);

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
