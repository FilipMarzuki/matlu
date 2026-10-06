/**
 * Acceptance tests for #1367 — the environment is frightening too: darkness, storms, distance
 * and the night carry an ambient threat that can shake you, spook you off the land, keep you
 * awake, and make anything you meet look worse. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, endDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD } from './world';
import { encounterById } from './encounters';
import { landAmbient, nightAmbient, perceivedThreat, readThreat, DARK_FADES, type LandScene, type NightScene } from './panic';
import { createExploration, scout } from './exploration';
import type { Quirk } from './quirks';

const AUTUMN = 25, WINTER = 50;
const scene = (x: Partial<LandScene>): LandScene => ({ light: 1, weather: 'clear', blizzard: false, ring: 1, winter: false, knownGround: false, ...x });
const night = (x: Partial<NightScene>): NightScene => ({ weather: 'clear', blizzard: false, winter: false, sheltered: true, fire: true, fireKeptWarm: false, campDays: 0, ...x });

/**
 * A WIL-10 Warden (nerve 2) with no talents and only these quirks, out late on `day` in `weather`.
 * `fear` turns the frightening world on (it rides with encounters); off, it's the same Warden in a world without it.
 */
function lateOut(day: number, weather: Region1State['weatherToday'], quirks: Quirk[], fear = true, who = 'w-dark'): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: fear } }, undefined, { id: who });
  return {
    ...s, day, weatherToday: weather, hoursToday: 15, encounterDay: day, // 21:00, and no encounter today to muddy the numbers
    explore: scout(scout(createExploration(), 1), 2), character: { ...s.character, talents: [], quirks },
    stores: { ...s.stores, water: 6, rawFood: 6, firewood: 8 }, vitals: createVitals({ clarity: 80 }), // winter water melts snow over a fire
  };
}
const gained = (before: Region1State, after: Region1State): number => Object.entries(after.stores).reduce((n, [k, v]) => n + Math.max(0, v - before.stores[k as keyof Region1State['stores']]), 0);

describe('The environment is frightening too (#1367)', () => {
  // 1. The distant ring in full dark, in winter: ambient 4.
  it('reads the distant ring at night in winter as overwhelming', () => {
    expect(landAmbient(scene({ light: 0.05, ring: 3, winter: true }))).toBe(4);
    expect(landAmbient(scene({ light: 0.3 }))).toBe(1); // dusk
    expect(landAmbient(scene({ weather: 'fog' }))).toBe(1);
    expect(landAmbient(scene({ weather: 'storm', blizzard: true }))).toBe(2);
    expect(landAmbient(scene({ light: 0.3, knownGround: true }))).toBe(0); // ground you know well
    expect(landAmbient(scene({ winter: true }))).toBe(0); // winter by day: the wolves keep to the dark
  });

  // 2. Shaken on a trip: that stretch drains 15% more Clarity.
  it('wears the mind harder on a frightening stretch', () => {
    // Autumn, full dark (+2), fog (+1): ambient 3 against nerve 2 — shaken.
    const on = lateOut(AUTUMN, 'fog', []), off = lateOut(AUTUMN, 'fog', [], false);
    const drop = (s: Region1State) => s.vitals.clarity.current - runAction(s, 'water').vitals.clarity.current;
    expect(drop(off)).toBeGreaterThan(0);
    expect(drop(on)).toBeCloseTo(drop(off) * 1.15, 5);
  });

  // 3. A panicked runner whose spook roll fires: the trip is cut short, the haul halved, and the journal says why.
  it('sends a spooked runner home with half the haul', () => {
    // Winter, full dark (+2), winter night (+1), fog (+1): ambient 4 — panicked.
    const find = (quirk: string): string => {
      for (let i = 0; i < 200; i++) if (runAction(lateOut(WINTER, 'fog', [{ id: quirk, known: false }], true, `w-spook-${i}`), 'water').log.some(l => /hands won't stop shaking/.test(l.text))) return `w-spook-${i}`;
      throw new Error('no spook');
    };
    const who = find('runner');
    const on = lateOut(WINTER, 'fog', [{ id: 'runner', known: false }], true, who), off = lateOut(WINTER, 'fog', [{ id: 'runner', known: false }], false, who);
    const a = runAction(on, 'water'), b = runAction(off, 'water');
    expect(a.log.some(l => /you ran for camp — dropping half of what you carried/.test(l.text))).toBe(true);
    expect(gained(on, a)).toBe(Math.floor(gained(off, b) / 2));
    expect(a.hoursToday).toBeLessThan(b.hoursToday);
    expect(a.character.quirks).toContainEqual({ id: 'runner', known: true });
    expect(a.today.shaking).toBe(true);
  });

  // 4. A panicked freezer whose spook roll fires: 2 hours pass with nothing gained.
  it('freezes a spooked freezer: two hours, nothing gained', () => {
    let who = '';
    for (let i = 0; i < 200 && !who; i++) if (runAction(lateOut(WINTER, 'fog', [{ id: 'freezer', known: false }], true, `w-still-${i}`), 'water').log.some(l => /You froze where you stood/.test(l.text))) who = `w-still-${i}`;
    const on = lateOut(WINTER, 'fog', [{ id: 'freezer', known: false }], true, who), off = lateOut(WINTER, 'fog', [{ id: 'freezer', known: false }], false, who);
    const a = runAction(on, 'water'), b = runAction(off, 'water');
    expect(gained(on, a)).toBe(0);
    expect(a.hoursToday).toBe(b.hoursToday + 2);
  });

  // 5. No shelter, no fire, wolves (winter): ambient 3, and a nerve-2 Warden loses 20% of Clarity recovery.
  it('keeps you awake on a night with no shelter, no fire and wolves', () => {
    expect(nightAmbient(night({ winter: true, sheltered: false, fire: false }))).toBe(3);
    const bare = (fear: boolean): Region1State => ({ ...lateOut(WINTER, 'clear', [], fear), hoursToday: 10, tier: 0 as const, site: null, stores: { ...lateOut(WINTER, 'clear', []).stores, firewood: 0 }, vitals: createVitals({ clarity: 30 }) });
    const recovered = (s: Region1State) => endDay(s).vitals.clarity.current - s.vitals.clarity.current;
    const a = endDay(bare(true));
    expect(a.log.some(l => l.text === 'You lie awake a long time, listening to the dark.')).toBe(true);
    expect(recovered(bare(true))).toBeLessThan(recovered(bare(false)));
  });

  // 6. A tier-2 shelter with the fire kept in: the night's threat 1 lower.
  it('lets a warm shelter and a kept fire comfort the night', () => {
    expect(nightAmbient(night({ winter: true, fireKeptWarm: true }))).toBe(nightAmbient(night({ winter: true })) - 1);
    expect(nightAmbient(night({ winter: true, campDays: 10 }))).toBe(nightAmbient(night({ winter: true })) - 1); // home
  });

  // 7. An encounter at an hour whose ambient threat is 2+: its perceived threat is 1 higher.
  it('makes what you meet in the dark look worse', () => {
    const fox = encounterById('fox-at-the-treeline')!;
    const w = lateOut(AUTUMN, 'clear', []);
    expect(perceivedThreat(w, fox, 2)).toBe(perceivedThreat(w, fox, 0) + 1);
    // In the sim: a fox met at night opens a step higher than its daytime read.
    for (let i = 0; i < 400; i++) {
      const s = { ...lateOut(WINTER, 'clear', [], true, `w-night-fox-${i}`), encounterDay: undefined };
      const after = runAction(s, 'water@3');
      if (after.pending?.id !== fox.id) continue;
      expect(after.pending.perceived).toBe(Math.min(4, readThreat(s, fox, 0).perceived + 1));
      return;
    }
    throw new Error('no fox at night');
  });

  // 8. A panicked night may leave fear:dark; five calm dark nights remove it.
  it('leaves a fear of the dark after a sleepless night, and calm nights fade it', () => {
    // A blizzard (+2), winter (+1), no shelter (+1), no fire (+1): panicked.
    const awful = { ...lateOut(WINTER, 'storm', []), hoursToday: 10, tier: 0 as const, site: null, stores: { ...lateOut(WINTER, 'storm', []).stores, firewood: 0 } };
    let s = endDay(awful);
    expect(s.log.some(l => /A sleepless night/.test(l.text))).toBe(true);
    expect(s.character.quirks).toContainEqual({ id: 'fear:dark', known: true, faced: 0 });
    // Calm nights at home: autumn, a lived-in tier-2 camp, clear skies, wood to burn.
    for (let i = 1; i <= DARK_FADES; i++) {
      s = endDay({ ...s, day: AUTUMN, weatherToday: 'clear', tier: 2, site: 'cave', siteDay: 1, outcome: null, vitals: createVitals(), stores: { ...s.stores, firewood: 9, water: 9, rawFood: 9 } });
      if (i < DARK_FADES) expect(s.character.quirks).toContainEqual({ id: 'fear:dark', known: true, faced: i });
    }
    expect(s.character.quirks!.some(q => q.id === 'fear:dark')).toBe(false);
    expect(s.log.some(l => l.text === "You notice the dark doesn't frighten you the way it did.")).toBe(true);
  });

  // 9. The same state: the same ambient threat and the same spook, every time.
  it('reads the environment the same way every time', () => {
    const x = scene({ light: 0.1, weather: 'fog', ring: 2, winter: true });
    expect(landAmbient(x)).toBe(landAmbient(x));
    const s = lateOut(WINTER, 'fog', [{ id: 'runner', known: false }], true, 'w-again');
    expect(runAction(s, 'water')).toEqual(runAction(s, 'water'));
  });
});
