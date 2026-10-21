/**
 * Acceptance tests for #1728 — what's left unspent at creation becomes a difficulty multiplier,
 * recorded for future high scores. One test per Given/When/Then, in the issue's order, then the
 * owner's comment's ("same for talents"):
 *
 *   1. All spent        — given stats with every point spent (and both talents chosen), the multiplier is ×1.00.
 *   2. Some left        — given N points unspent, the multiplier matches the pinned curve, and more
 *                          unspent never gives a lower multiplier.
 *   3. Fixed at BEGIN   — given a character created with points left, the run keeps that multiplier
 *                          for the whole run, and it is the same after a save and reload.
 *   4. Old saves        — given a save or run record without it, it reads as ×1.00.
 *   5. Same game        — given the same seed and stats, the same run (the multiplier changes no draws).
 *   6. Fewer talents    — given fewer talents than allowed, the multiplier is higher than with all
 *                          chosen, and BEGIN works.
 *   7. Talent unlocks   — given no talent chosen, actions a talent would have opened stay locked
 *                          (#1690), and nothing else breaks.
 */

import { describe, it, expect } from 'vitest';
import { difficultyOf, difficultyOfCharacter, difficultyRead, difficultyLabel, PER_POINT, PER_TALENT } from './difficulty';
import { DEFAULT_STATS, POINT_BUDGET, pointsLeft, type Stats } from './stats';
import { TALENT_PICKS, talentOffer, seedOf, validPick } from './talents';
import { summarizeRun } from './legacy';
import { visibilityOf } from './action-visibility';
import { EXPLORE_UNLOCKS } from './action-unlocks';
import { FULL_WORLD } from './world';
import { makeWarden, serialize, deserialize, endTheDay, act, deserializeHistory, serializeHistory, type AppState } from '../artificer-app/controller';
import { startProblem, startOf } from '../artificer-play/web-run';
import { runOf } from '../artificer-play/record-of';
import { runDifficulty } from '../artificer-play/records';
import { startGame, view, apply } from '../artificer-play/session';

const spread = (s: Partial<Stats>): Stats => ({ ...DEFAULT_STATS, ...s });
/** Every point spent: 10 → 13 is 3 points, twice. */
const ALL_SPENT = spread({ str: 13, con: 13 });
const ID = 'w-difficulty';
const two = talentOffer(seedOf(ID)).slice(0, TALENT_PICKS);

/** A few days of the same plain moves, so two runs can be compared draw for draw. */
function play(a: AppState, days = 6): AppState {
  let s = a;
  for (let d = 0; d < days && !s.sim.outcome; d++) {
    s = act(s, 'water');
    s = act(s, 'gather');
    s = endTheDay(s);
  }
  return s;
}

describe('Unspent stat points and unchosen talents become a difficulty multiplier (#1728)', () => {
  it('1. all points spent and both talents chosen: ×1.00', () => {
    expect(pointsLeft(ALL_SPENT)).toBe(0);
    expect(difficultyOf(ALL_SPENT, TALENT_PICKS)).toBe(1);
    expect(difficultyOf(ALL_SPENT, two)).toBe(1);
    expect(difficultyLabel(difficultyOf(ALL_SPENT, two))).toBe('×1.00');
    // A Warden made that way carries no multiplier above 1, so it reads ×1.00 too.
    expect(difficultyOfCharacter(makeWarden({ id: ID, chosen: two, stats: ALL_SPENT }).sim.character)).toBe(1);
  });

  it('2. N points unspent: ×(1 + 0.10 N), and more unspent is never lower', () => {
    // The pinned curve: +0.10 per stat point, +0.25 per talent pick.
    expect(PER_POINT).toBe(0.1);
    expect(PER_TALENT).toBe(0.25);
    expect(difficultyOf(spread({ str: 13, con: 12 }), two)).toBe(1.1);
    expect(difficultyOf(spread({ str: 13 }), two)).toBe(1.3);
    expect(difficultyOf(DEFAULT_STATS, two)).toBe(1.6);
    expect(difficultyLabel(difficultyOf(DEFAULT_STATS, two))).toBe('×1.60');
    // Points bought by lowering a stat, then left unspent, count too.
    expect(difficultyOf(spread({ cha: 7 }), two)).toBe(1.9);
    expect(difficultyOf(spread({ str: 7, con: 7, agi: 7, int: 7, wil: 7, cha: 7 }), 0)).toBe(3.9);
    // Monotone: walk from all spent to nothing spent to everything lowered, one point at a time.
    const path: Stats[] = [];
    let s = { ...ALL_SPENT };
    path.push({ ...s });
    for (const id of ['str', 'con'] as const) while (s[id] > 10) { s = { ...s, [id]: s[id] - 1 }; path.push({ ...s }); }
    for (const id of ['agi', 'int', 'wil'] as const) while (s[id] > 7) { s = { ...s, [id]: s[id] - 1 }; path.push({ ...s }); }
    for (let i = 1; i < path.length; i++) {
      for (const picks of [0, 1, 2]) {
        expect(pointsLeft(path[i])).toBeGreaterThan(pointsLeft(path[i - 1]));
        expect(difficultyOf(path[i], picks)).toBeGreaterThan(difficultyOf(path[i - 1], picks));
      }
    }
    expect(pointsLeft(DEFAULT_STATS)).toBe(POINT_BUDGET);
  });

  it('3. fixed at BEGIN: kept for the whole run, and the same after a save and reload', () => {
    const start = makeWarden({ id: ID, chosen: two, stats: spread({ str: 13 }) });
    expect(start.sim.character.difficulty).toBe(1.3);
    const later = play(start, 8);
    expect(later.sim.day).toBeGreaterThan(start.sim.day);
    expect(difficultyOfCharacter(later.sim.character)).toBe(1.3);
    const back = deserialize(serialize(later))!;
    expect(back).not.toBeNull();
    expect(difficultyOfCharacter(back.sim.character)).toBe(1.3);
    // A save that says something else (a string, below 1) can't make it easier: it reads ×1.00.
    const bad = JSON.parse(serialize(later));
    bad.sim.character.difficulty = 'hard';
    expect(difficultyOfCharacter(deserialize(JSON.stringify(bad))!.sim.character)).toBe(1);
    // It goes into the run record: the history's, and the API's.
    const ended: AppState = { ...later, sim: { ...later.sim, outcome: { choice: 'collapse', kind: 'died', injury: null } as never } };
    const rec = summarizeRun(ended.sim, 1);
    expect(rec.difficulty).toBe(1.3);
    expect(deserializeHistory(serializeHistory([rec]))[0].difficulty).toBe(1.3);
    const run = runOf(ended, {}, { playerKind: 'person', model: null, client: null, surface: 'api', gameVersion: 'test', name: null, moves: 1 });
    expect(run.detail.difficulty).toBe(1.3);
    expect(runDifficulty(run)).toBe(1.3);
  });

  it('4. a save or run record without it reads as ×1.00', () => {
    const a = makeWarden({ id: ID, chosen: two, stats: DEFAULT_STATS });
    expect(a.sim.character.difficulty).toBe(1.6);
    const raw = JSON.parse(serialize(a));
    delete raw.sim.character.difficulty;
    const old = deserialize(JSON.stringify(raw))!;
    expect(old.sim.character.difficulty).toBeUndefined();
    expect(difficultyOfCharacter(old.sim.character)).toBe(1);
    // A history record from before it…
    const rec = summarizeRun({ ...old.sim, outcome: { choice: 'collapse', kind: 'died', injury: null } as never }, 1);
    expect(rec.difficulty).toBeUndefined();
    expect(difficultyRead(rec.difficulty)).toBe(1);
    // …and an API run record from before it.
    expect(runDifficulty({ detail: {} })).toBe(1);
    // A quick start (no creation choices at all) is ×1.00 as before.
    expect(difficultyOfCharacter(makeWarden({ id: ID }).sim.character)).toBe(1);
  });

  it('5. the same seed and stats give the same run: the multiplier changes no draws', () => {
    const stats = spread({ str: 12 });
    const a = play(makeWarden({ id: ID, chosen: two.slice(0, 1), stats }));
    const b = play(makeWarden({ id: ID, chosen: two.slice(0, 1), stats }));
    expect(serialize(a)).toBe(serialize(b));
    // The same Warden without the multiplier (an old save of them) plays out the very same days.
    const start = makeWarden({ id: ID, chosen: two.slice(0, 1), stats });
    expect(start.sim.character.difficulty).toBe(1.65);
    const { difficulty: _d, ...character } = start.sim.character;
    const without = play({ ...start, sim: { ...start.sim, character } });
    expect({ ...without.sim, character: { ...without.sim.character, difficulty: 1.65 } }).toEqual(a.sim);
  });

  it('6. fewer talents than allowed: a higher multiplier, and BEGIN works', () => {
    expect(difficultyOf(ALL_SPENT, 1)).toBe(1.25);
    expect(difficultyOf(ALL_SPENT, 0)).toBe(1.5);
    expect(difficultyOf(ALL_SPENT, 1)).toBeGreaterThan(difficultyOf(ALL_SPENT, 2));
    expect(difficultyOf(ALL_SPENT, 0)).toBeGreaterThan(difficultyOf(ALL_SPENT, 1));
    expect(difficultyOf(DEFAULT_STATS, 0)).toBe(2.1);
    // BEGIN: any number of the offered talents up to two is a creation the game takes.
    for (const chosen of [[], two.slice(0, 1), two]) {
      expect(validPick(chosen)).toBe(true);
      expect(startProblem({ id: ID, chosen, stats: ALL_SPENT, features: {}, heirlooms: null })).toBeNull();
      const app = startOf({ id: ID, chosen, stats: ALL_SPENT, features: {}, heirlooms: null });
      expect(app.sim.character.talents.filter(t => t.known).map(t => t.id)).toEqual(chosen);
      expect(difficultyOfCharacter(app.sim.character)).toBe(difficultyOf(ALL_SPENT, chosen));
    }
    // Still no more than two, and only from the offer.
    expect(startProblem({ id: ID, chosen: talentOffer(seedOf(ID)).slice(0, 3), features: {}, heirlooms: null })).not.toBeNull();
  });

  it('7. no talent chosen: what a talent would have opened stays locked, and the run plays on', () => {
    const world = { ...FULL_WORLD, encounters: false, features: { 'action-visibility': true } };
    const keen = makeWarden({ id: ID, chosen: ['keenEye', 'hunter'] as never, stats: ALL_SPENT }, undefined, world.features);
    const none = makeWarden({ id: ID, chosen: [], stats: ALL_SPENT }, undefined, world.features);
    // With the talents, Keen Eye opens the scouting three and Hunter's Patience tracking, from day one…
    for (const u of EXPLORE_UNLOCKS) expect(visibilityOf(keen.sim, u.action).status).not.toBe('hidden');
    // …without any, they wait for the skill, like anyone's.
    for (const u of EXPLORE_UNLOCKS) expect(visibilityOf(none.sim, u.action).status).toBe('hidden');
    // The hidden talent is still rolled, and the run plays on.
    expect(none.sim.character.talents.filter(t => !t.known)).toHaveLength(1);
    const later = play(none, 10);
    expect(later.sim.day).toBeGreaterThan(none.sim.day);
    expect(difficultyOfCharacter(later.sim.character)).toBe(1.5);
  });

  it('the API: a new game can leave points unspent, and the view says the multiplier', () => {
    const g = startGame({ seed: 'difficulty-api', stats: spread({ str: 12 }) });
    expect(g.app.sim.character.difficulty).toBe(1.9);
    expect(view(g).text).toMatch(/DIFFICULTY: ×1\.90/);
    // Without stats it's a quick start, ×1.00 as before, and the view doesn't mention it.
    const q = startGame({ seed: 'difficulty-api' });
    expect(difficultyOfCharacter(q.app.sim.character)).toBe(1);
    expect(view(q).text).not.toMatch(/DIFFICULTY/);
    // In Swedish too.
    expect(view(startGame({ seed: 'difficulty-api', stats: spread({ str: 12 }), lang: 'sv' })).text).toMatch(/×1\.90/);
    expect(apply(g, { endDay: true }).ok).toBe(true);
  });
});
