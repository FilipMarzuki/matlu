/**
 * Acceptance tests for #1757 — with `cold-pit-slows`, the cold pit slows spoilage instead of
 * stopping it. One test per Given/When/Then scenario, plus the switch and determinism checks.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, spoilage, nightSpoilage, coldCapacity, pitSlowing, type Region1State, type SiteId, type QueueItem } from './region1';
import { createVitals } from './vitality';
import { STEADY_WORLD } from './test-helpers';
import type { WorldConfig } from './world';
import { makeT } from './i18n';
import { simLine } from '../artificer-app/sim-words';
import { yieldText } from '../artificer-app/camp-blocks';
import { newGame, serialize, deserialize } from '../artificer-app/controller';

const ON: WorldConfig = { ...STEADY_WORLD, features: { 'cold-pit-slows': true } };
const OFF: WorldConfig = { ...STEADY_WORLD, features: { 'cold-pit-slows': false } };
const ABSENT: WorldConfig = { ...STEADY_WORLD };

/** A Warden camped at `site` on `day` with a cold pit dug there and `food` raw food (luck off). */
function pitCamp(site: SiteId, day: number, food: number, world: WorldConfig = ON, over: Partial<Region1State> = {}): Region1State {
  const s = chooseSite(runAction(createRegion1({ world }), 'scout'), site);
  return { ...s, day, hoursToday: 0, weatherToday: 'overcast', tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' }, vitals: createVitals(), coldPitAt: site, stores: { ...s.stores, rawFood: food, rations: 0, water: 20, firewood: 40, stone: 8, materials: 6 }, ...over };
}

/** Food left after `nights` nights at `t` °C with no eating: the pure nightly spoilage, carried. */
function week(s: Region1State, t: number, nights = 7): number {
  let food = s.stores.rawFood;
  let pitRot = s.pitRot;
  for (let i = 0; i < nights; i++) {
    const sp = nightSpoilage({ ...s, stores: { ...s.stores, rawFood: food }, pitRot }, t);
    food -= sp.spoiled;
    pitRot = sp.pitRot;
  }
  return food;
}

const lines = (s: Region1State): string => s.log.map(l => l.text).join('\n');

describe('The cold pit slows spoilage (#1757)', () => {
  // 1. Given 8 raw food in a cold pit over a mild week, then some spoils, clearly less than in the open.
  it('spoils some pit food over a mild week, clearly less than food left in the open', () => {
    const pit = pitCamp('cave', 3, 8);
    const open = pitCamp('cave', 3, 8, ON, { coldPitAt: null });
    const inPit = week(pit, 8);
    const inOpen = week(open, 8);
    expect(inPit).toBeLessThan(8); // some of it spoils
    expect(inOpen).toBe(0); // in the open, a mild week takes all of it
    expect(8 - inPit).toBeLessThanOrEqual((8 - inOpen) / 2); // the pit loses well under half as much
    expect(inPit).toBe(5); // 3 of 8 over the week, a third of the open rate
    // Food beyond the pit's capacity spoils at the open rate.
    expect(nightSpoilage(pitCamp('cave', 3, 18), 8)).toMatchObject({ kept: 8, exposed: 10, inPit: 8 });
    expect(nightSpoilage(pitCamp('cave', 3, 18), 8).spoiled - spoilage(18, 8, 8).spoiled).toBeLessThanOrEqual(1);
    // In play: a week at the pit, eating, and the journal says what went bad.
    let s = pitCamp('cave', 3, 15);
    for (let i = 0; i < 7; i++) s = runDay(s, []).state;
    expect(lines(s)).toMatch(/raw food went bad\./);
  });

  // 2. Given the same food on frosty nights, then it spoils more slowly than on mild nights.
  it('spoils pit food more slowly on frosty nights than on mild ones', () => {
    const pit = pitCamp('cave', 3, 8);
    expect(week(pit, 0, 14)).toBeGreaterThan(week(pit, 8, 14));
    // A hard frost stops it.
    expect(week(pit, -6, 14)).toBe(8);
  });

  // 3. Given a pit at the river, then food there spoils more slowly than in a pit elsewhere.
  it('spoils food more slowly in a river pit than in a pit elsewhere', () => {
    expect(pitSlowing('river')).toBeLessThan(pitSlowing('cave'));
    expect(week(pitCamp('river', 3, 8), 8, 14)).toBeGreaterThan(week(pitCamp('cave', 3, 8), 8, 14));
  });

  // 4. Given the switch is off or absent, then today's behaviour holds: nothing within capacity spoils.
  it('keeps today\'s spoilage with the switch off or absent', () => {
    for (const world of [OFF, ABSENT]) {
      for (const [food, t] of [[8, 8], [12, 0], [18, 8], [3, 4]] as const) {
        const s = pitCamp('cave', 3, food, world);
        expect(nightSpoilage(s, t)).toEqual({ ...spoilage(food, coldCapacity(s, t), t), inPit: 0 });
      }
      expect(week(pitCamp('cave', 3, 8, world), 8, 30)).toBe(8);
      let s = pitCamp('cave', 3, 9, world);
      for (let i = 0; i < 5; i++) s = runDay(s, []).state;
      expect(s.stores.rawFood).toBe(9 - 5); // eaten, never spoiled
      expect(lines(s)).not.toMatch(/went bad/);
      expect(s.pitRot).toBeUndefined();
    }
  });

  // 5. The same seed gives the same run, on and off.
  it('plays a scripted run the same way twice from the same seed', () => {
    const plan: QueueItem[][] = [['scout'], ['hunt', 'water'], ['quarry', 'gather'], ['coldPit', 'hunt'], ['water', 'hunt', 'wood'], ['gather', 'water'], ['hunt', 'wood']];
    const play = (world: WorldConfig): Region1State => {
      let s = createRegion1({ world }, undefined, { id: 'pit-seed-1', name: 'Pit' });
      s = chooseSite(runAction(s, 'scout'), 'cave');
      for (let day = 0; day < 40 && !s.outcome; day++) s = runDay(s, plan[day % plan.length]).state;
      return s;
    };
    for (const world of [ON, OFF]) expect(JSON.stringify(play(world))).toBe(JSON.stringify(play(world)));
  });

  // Review finding: the carried rot belongs to the pit it built up in, never a new one.
  it('leaves the carried rot behind when camp moves, and starts a newly dug pit with none', () => {
    const owing = pitCamp('cave', 3, 8, ON, { pitRot: 0.9 });
    expect(chooseSite(owing, 'river').pitRot).toBeUndefined();
    const dug = runAction(pitCamp('river', 3, 8, ON, { coldPitAt: null, pitRot: 0.9 }), 'coldPit');
    expect(dug.coldPitAt).toBe('river');
    expect(dug.pitRot).toBeUndefined();
    // So a fresh pit's first mild night spoils nothing it wouldn't have from zero.
    expect(nightSpoilage(dug, 8).spoiled).toBe(nightSpoilage({ ...dug, pitRot: undefined }, 8).spoiled);
  });

  // 6. The carried rot is saved with the run, and only a well-formed one is kept.
  it('keeps the carried rot through a save, and drops a malformed one', () => {
    const s = { ...pitCamp('cave', 3, 8), pitRot: 0.4 };
    const saved = { ...newGame(), sim: s };
    expect(deserialize(serialize(saved))?.sim.pitRot).toBe(0.4);
    for (const bad of [-1, 2, 'x', null]) {
      const raw = JSON.parse(serialize(saved));
      raw.sim.pitRot = bad;
      expect(deserialize(JSON.stringify(raw))?.sim.pitRot).toBeUndefined();
    }
    // With the switch off, there's nothing to carry.
    const off = JSON.parse(serialize({ ...newGame(), sim: { ...pitCamp('cave', 3, 8, OFF), pitRot: 0.4 } }));
    expect(deserialize(JSON.stringify(off))?.sim.pitRot).toBeUndefined();
  });

  // 7. The words: "keeps raw food cold and slows the rot", in English and Swedish; the old words with it off.
  it('says the pit slows the rot, in English and Swedish, and keeps the old words with it off', () => {
    const dig = (world: WorldConfig): string => lines(runAction(pitCamp('cave', 3, 0, world, { coldPitAt: null }), 'coldPit'));
    expect(dig(ON)).toMatch(/it keeps 8 raw food cold and slows the rot\./);
    expect(dig(OFF)).toMatch(/it keeps 8 raw food cold\.$/m);
    const sv = makeT('sv');
    const en = makeT('en');
    const line = 'Dug a cold pit and lined it with stone — it keeps 8 raw food cold and slows the rot.';
    expect(simLine(line, en)).toBe(line);
    expect(simLine(line, sv)).toMatch(/kylgrop.*saktar ner förruttnelsen/);
    const s = pitCamp('cave', 3, 0);
    expect(yieldText('coldPit', s, 1, en)).toMatch(/keeps 8 raw food cold and slows the rot/);
    expect(yieldText('coldPit', pitCamp('cave', 3, 0, OFF), 1, en)).toMatch(/keeps 8 raw food from spoiling/);
    expect(yieldText('coldPit', s, 1, sv)).toMatch(/saktar ner förruttnelsen/);
  });
});
