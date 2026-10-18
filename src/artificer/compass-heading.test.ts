/**
 * Acceptance tests for #1868 — heading out in a set direction needs a way to keep a heading (switch
 * `compass-heading`). One test per Given/When/Then of the owner's updated acceptance, in order:
 *
 *   1. Packed compass  — with the map and compass in the kit, heading out all 8 ways is open from day 1.
 *   2. Nothing         — with no compass and no needle compass, only Look around is offered, and the
 *                        chooser says what's missing.
 *   3. Needle compass  — a needle (or a hook), wool (or hair) and still water (kåsa or a pool):
 *                        Make a needle compass makes one, and heading out opens.
 *   4. Drift           — heading out with the needle compass drifts a few trips one direction off and
 *                        none by more; with the real compass none drift.
 *   5. Pull fades      — a needle compass older than its pull must be refreshed before it's used again.
 *   6. Shadow stick    — on clear or broken-cloud days heading out works with no compass, at a small
 *                        time cost; on overcast, foggy, rainy or snowy days it doesn't.
 *   7. Same game       — the same seed and moves give the same run; with the switch off or absent,
 *                        heading out works as in #1839.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, queueHours, blockedReason, ACTIONS, type Region1State, type QueueItem } from './region1';
import { FULL_WORLD, type WeatherId, type WorldConfig } from './world';
import { ruleFeatures } from './features';
import { reachOfRun } from './descriptive-map';
import { shown } from './action-visibility';
import { HOOK_LINE } from './hunting-gear';
import type { KitId } from './kit';
import { DIRS, headOutPlan, standingAt, type Dir } from './directed-explore';
import {
  COMPASS_HEADING, NEEDLE_HOURS, NEEDLE_PULL_DAYS, SHADOW_HOURS, keptHeading, keeperOf, headingLock,
} from './compass-heading';

type Switch = boolean | 'absent';
/** Daylight, a fixed weather, no luck, accidents or encounters: what happens is the rules'. */
const world = (on: Switch, weather: WeatherId): WorldConfig => {
  const features = ruleFeatures();
  if (on === 'absent') delete features[COMPASS_HEADING];
  else features[COMPASS_HEADING] = on;
  return { ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather, encounters: false, features };
};
const warden = (o: { pack?: KitId[]; weather?: WeatherId; on?: Switch; id?: string } = {}): Region1State =>
  createRegion1({ world: world(o.on ?? true, o.weather ?? 'overcast') }, undefined, { id: o.id ?? 'w-astrid', ...(o.pack ? { pack: o.pack } : {}) });
const head = (dir: Dir, ring: 1 | 2 | 3 = 1): QueueItem => ({ q: ring === 1 ? 'explore' : `explore@${ring}`, opts: { way: dir } });
const wayChoices = (s: Region1State) => ACTIONS.explore.options!(s, {})[0].choices;
const MISSING = 'you need something to keep a heading: a compass, or a needle you can magnetise';
const withHook = (s: Region1State): Region1State => ({ ...s, tools: [...s.tools, { item: HOOK_LINE, grade: 'sound' }] });
/** The neighbours of a direction on the compass rose, and itself. */
const near = (d: Dir): Dir[] => [-1, 0, 1].map(k => DIRS[(DIRS.indexOf(d) + k + 8) % 8]);

describe('#1868 keeping a heading', () => {
  it('1. with the map and compass packed, heading out all 8 ways is open from day 1', () => {
    const s = warden({ pack: ['map-compass'] });
    expect(s.day).toBe(1);
    expect(keeperOf(s)).toBe('compass');
    for (const c of wayChoices(s)) expect(c.blocked).toBeNull();
    for (const d of DIRS) {
      expect(blockedReason(s, 'explore', 1, { way: d })).toBeNull();
      const out = runAction(s, head(d));
      expect(out.log.some(l => l.text.startsWith('Headed '))).toBe(true);
    }
    // No needle to make: the real compass does it, and the craft isn't shown.
    expect(shown(s, 'needlecompass')).toBe(false);
  });

  it('2. with no compass and no needle compass, only Look around is offered, and the chooser says what’s missing', () => {
    for (const pack of [[], ['sewing-kit']] as KitId[][]) {
      const s = warden({ pack });
      expect(keeperOf(s)).toBeNull();
      const choices = wayChoices(s);
      expect(choices.find(c => c.value === 'here')!.blocked).toBeNull();
      for (const c of choices.filter(c => c.value !== 'here')) {
        expect(c.blocked).toContain(MISSING);
        // …and that the sun can do on a clear day.
        expect(c.blocked).toContain('on a clear day the sun can do');
      }
      for (const d of DIRS) expect(blockedReason(s, 'explore', 1, { way: d })).toBe(headingLock(s));
      // Heading out anyway is skipped, and you stay where you are; looking around still works.
      const tried = runAction(s, head('n'));
      expect(tried.afield).toBeUndefined();
      expect(tried.log.at(-1)!.text).toContain('skipped');
      expect(runAction(s, 'explore').log.at(-1)!.text).not.toContain('skipped');
    }
    // It names what's missing: with a sewing kit, the needle in it; without, that there's none.
    expect(headingLock(warden({ pack: ['sewing-kit'] }))).toContain('the needle from your sewing kit');
    expect(headingLock(withHook(warden({ pack: [] })))).toContain('the hook from your hook and line');
    expect(headingLock(warden({ pack: [] }))).toContain('no needle or fish hook');
  });

  it('3. a needle (or a hook), wool (or hair) and still water make a needle compass, and heading out opens', () => {
    const s = warden({ pack: ['sewing-kit', 'wool-underlayer', 'kasa'], id: 'w-needle' });
    expect(shown(s, 'needlecompass')).toBe(true);
    expect(blockedReason(s, 'needlecompass', 1)).toBeNull();
    expect(queueHours('needlecompass', s)).toBeCloseTo(NEEDLE_HOURS, 6);
    expect(NEEDLE_HOURS).toBe(0.5);
    const made = runAction(s, 'needlecompass');
    expect(made.needleCompass).toEqual({ made: 1, tool: 'needle' });
    expect(made.stores).toEqual(s.stores);
    expect(made.log.at(-1)!.text).toBe('Stroked the needle from your sewing kit on your wool underlayer, one way, forty times, and floated it on a chip of birch bark in your kåsa: it swung round to point north. You have a needle compass.');
    expect(keeperOf(made)).toBe('needle');
    for (const c of wayChoices(made)) expect(c.blocked).toBeNull();
    expect(runAction(made, head('e')).afield).toBeDefined();
    // The hook from a hook and line will do, and hair and a still pool: no wool or kåsa needed.
    const hooked = runAction(withHook(warden({ pack: [] })), 'needlecompass');
    expect(hooked.needleCompass).toEqual({ made: 1, tool: 'hook' });
    expect(hooked.log.at(-1)!.text).toBe('Stroked the hook from your hook and line on your hair, one way, forty times, and floated it on a chip of birch bark in a still pool: it swung round to point north. You have a needle compass.');
    // With neither a needle nor a hook there's nothing to magnetise.
    expect(blockedReason(warden({ pack: ['wool-underlayer'] }), 'needlecompass', 1)).toBe('needs a needle (a sewing kit) or the hook from a hook and line');
  });

  it('4. with the needle compass a few trips drift one direction off and none by more; with the real compass none drift', () => {
    const tally = (pack: KitId[], tool: 'needle' | 'hook' | null, trips = 0): { drifted: number; n: number } => {
      let drifted = 0, n = 0;
      for (let i = 0; i < 60; i++) {
        const base = warden({ pack, id: `w-drift-${i}` });
        for (const day of [1, 4, 9]) for (const d of DIRS) {
          const s: Region1State = { ...base, day, ...(tool ? { needleCompass: { made: day, tool, trips } } : {}) };
          const k = keptHeading(s, d);
          expect(near(d)).toContain(k.dir);
          if (k.dir !== d) drifted++;
          n++;
        }
      }
      return { drifted, n };
    };
    const needle = tally([], 'needle');
    expect(needle.drifted).toBeGreaterThan(0);
    expect(needle.drifted / needle.n).toBeLessThan(0.3);
    // The hook works a little less well than the needle; practice brings the chance down.
    expect(tally([], 'hook').drifted).toBeGreaterThan(needle.drifted);
    expect(tally([], 'needle', 12).drifted).toBeLessThan(needle.drifted);
    // The real compass never drifts, even with a needle compass beside it.
    expect(tally(['map-compass'], 'needle').drifted).toBe(0);
    // In play: a drifted trip ends up where the drifted heading takes you, says so, and counts as practice.
    let found: { s: Region1State; meant: Dir; went: Dir } | null = null;
    for (let i = 0; i < 40 && !found; i++) {
      const s: Region1State = { ...warden({ id: `w-drift-${i}` }), needleCompass: { made: 1, tool: 'needle' } };
      for (const d of DIRS) { const k = keptHeading(s, d); if (k.dir !== d) { found = { s, meant: d, went: k.dir }; break; } }
    }
    expect(found).not.toBeNull();
    const { s, meant, went } = found!;
    const out = runAction(s, head(meant));
    const r = reachOfRun(s);
    expect(out.afield).toEqual(headOutPlan(r, standingAt(s, r), went, 1).to);
    expect(out.log.some(l => l.text.startsWith('The needle wandered as you went'))).toBe(true);
    expect(out.needleCompass!.trips).toBe(1);
  });

  it('5. a needle compass older than its pull needs refreshing before it can be used again', () => {
    const s = warden({ pack: ['sewing-kit'] });
    const made = runAction(s, 'needlecompass');
    expect(NEEDLE_PULL_DAYS).toBe(7);
    // Still holding on its last day; gone the day after.
    const lastDay: Region1State = { ...made, day: 1 + NEEDLE_PULL_DAYS - 1 };
    expect(keeperOf(lastDay)).toBe('needle');
    expect(blockedReason(lastDay, 'needlecompass', 1)).toBe('your needle compass still holds its pull');
    const faded: Region1State = { ...made, day: 1 + NEEDLE_PULL_DAYS };
    expect(keeperOf(faded)).toBeNull();
    expect(headingLock(faded)).toBe('your needle compass has lost its pull — stroke it on wool again (Make a needle compass); on a clear day the sun can do');
    expect(blockedReason(faded, 'explore', 1, { way: 'n' })).toBe(headingLock(faded));
    // The same craft refreshes it, practice kept, and heading out opens again.
    const practised: Region1State = { ...faded, needleCompass: { ...faded.needleCompass!, trips: 3 } };
    const fresh = runAction(practised, 'needlecompass');
    expect(fresh.needleCompass).toEqual({ made: faded.day, tool: 'needle', trips: 3 });
    expect(fresh.log.at(-1)!.text).toBe('Stroked the needle from your sewing kit on your hair again and floated it in a still pool: it has its pull back.');
    expect(blockedReason(fresh, 'explore', 1, { way: 'n' })).toBeNull();
  });

  it('6. on clear or broken-cloud days the sun keeps a heading at a small time cost; on grey days it doesn’t', () => {
    for (const weather of ['clear', 'wind'] as WeatherId[]) {
      const s = warden({ weather });
      expect(keeperOf(s)).toBe('sun');
      for (const c of wayChoices(s)) expect(c.blocked).toBeNull();
      const withCompass = warden({ weather, pack: ['map-compass'] });
      expect(SHADOW_HOURS).toBe(0.5);
      expect(queueHours(head('s', 2), s)).toBeCloseTo(queueHours(head('s', 2), withCompass) + SHADOW_HOURS, 6);
      // Looking around costs nothing more.
      expect(queueHours('explore', s)).toBeCloseTo(queueHours('explore', withCompass), 6);
      const out = runAction(s, head('s'));
      expect(out.afield).toBeDefined();
      expect(out.log.some(l => l.text === "Marked the tip of a stick's shadow twice, a while apart, to find your bearings: about 0.5 hours more.")).toBe(true);
      expect(out.hoursToday).toBeCloseTo(runAction(withCompass, head('s')).hoursToday + SHADOW_HOURS, 6);
    }
    for (const weather of ['overcast', 'fog', 'rain', 'snow', 'storm'] as WeatherId[]) {
      const s = warden({ weather });
      expect(keeperOf(s)).toBeNull();
      expect(blockedReason(s, 'explore', 1, { way: 'n' })).toContain(MISSING);
    }
    // A needle compass on a sunny day is used before the stick: no time cost.
    const both: Region1State = { ...warden({ weather: 'clear' }), needleCompass: { made: 1, tool: 'needle' } };
    expect(keeperOf(both)).toBe('needle');
  });

  it('7. the same seed and moves give the same run; off or absent, heading out works as in #1839', () => {
    const plan: QueueItem[] = ['needlecompass', head('ne'), 'rest'];
    const a = runDay(runDay(warden({ pack: ['sewing-kit'] }), plan).state, [head('e')]).state;
    const b = runDay(runDay(warden({ pack: ['sewing-kit'] }), plan).state, [head('e')]).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.needleCompass).toBeDefined();
    for (const off of [false, 'absent'] as const) {
      const s = warden({ on: off, pack: ['sewing-kit'] });
      // Nothing to keep a heading with, on a grey day, and heading out is open as before.
      expect(keeperOf(s)).toBeNull();
      expect(headingLock(s)).toBeNull();
      for (const c of wayChoices(s)) expect(c.blocked).toBeNull();
      expect(shown(s, 'needlecompass')).toBe(false);
      const r = reachOfRun(s);
      const out = runAction(s, head('n', 2));
      expect(out.afield).toEqual(headOutPlan(r, standingAt(s, r), 'n', 2).to);
      expect(queueHours(head('n', 2), s)).toBeCloseTo(queueHours('explore@2', s), 6);
      const day = runDay(s, ['needlecompass', head('w'), 'rest']).state;
      expect(day.needleCompass).toBeUndefined();
      expect(day.log.some(l => /needle|shadow/i.test(l.text) && !/skipped/.test(l.text))).toBe(false);
    }
    // Off and absent are the same game.
    const offRun = runDay(warden({ on: false }), [head('n', 2), 'rest']).state;
    const absentRun = runDay(warden({ on: 'absent' }), [head('n', 2), 'rest']).state;
    expect(JSON.stringify({ ...offRun, config: null })).toBe(JSON.stringify({ ...absentRun, config: null }));
  });
});
