/**
 * Acceptance tests for #1221 — Climb & Look Out and recipe discovery.
 * Criteria 1–4; criterion 5 (balance plans) is playthrough.test.ts and the
 * tools-first canary in region1-shelter.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, ACTIONS, STARTING_RECIPES, queueHours, routeKnown, type Region1State } from './region1';
import { createExploration, scout, survey, track, level, lookout } from './exploration';

const scouted = (over: Partial<Region1State> = {}): Region1State => {
  const s = runAction(createRegion1(), 'scout');
  return { ...s, stores: { ...s.stores, materials: 20, rawFood: 10 }, ...over };
};

describe('Climb & Look Out', () => {
  // 1. A ring sharpens one level (to observed); the next ring comes into view, routes included.
  it('sharpens the ring and shows the next one', () => {
    const e = lookout(scout(createExploration(), 1), 1);
    expect(level(e, 1, 'stone')).toBe(2);
    expect(level(e, 2, 'forage')).toBe(1);
    expect(level(e, 2, 'routes')).toBe(1);
    // Never past observed from a look-out alone.
    expect(level(lookout(e, 1), 1, 'stone')).toBe(2);

    // From the far ring you can see the pass without walking to the distant hills.
    let s = runAction(scouted(), 'scout@2');
    expect(routeKnown(s)).toBe(false);
    s = runAction({ ...s, hoursToday: 0 }, 'lookout@2');
    expect(routeKnown(s)).toBe(true);
    expect(queueHours('lookout@2')).toBe(5 + 3);

    // Camped on the hilltop, the near look-out is a short climb.
    const hill = chooseSite(scouted(), 'hill');
    const climbed = runAction(hill, 'lookout');
    expect(climbed.hoursToday).toBe(hill.hoursToday + 2);
    expect(queueHours('lookout', hill)).toBe(2);
    expect(queueHours('lookout', scouted())).toBe(5);
  });
});

describe('Recipe discovery', () => {
  // 2. Only the starting recipes are known; unknown ones are refused for free and blocked in options.
  it('starts knowing only the basics', () => {
    const s = scouted();
    expect(s.known).toEqual([...STARTING_RECIPES]);
    const tried = runAction(s, 'snare');
    expect(tried.log.at(-1)?.text).toMatch(/haven't worked out how to make a snare/);
    expect(tried.hoursToday).toBe(s.hoursToday);
    expect(tried.stores.materials).toBe(s.stores.materials);

    const camp = chooseSite(s, 'cave');
    const hutChoice = ACTIONS.build.options?.(camp, {}).find(g => g.key === 'type')?.choices.find(c => c.value === 'hut');
    expect(hutChoice?.blocked).toBe('not yet discovered');
    expect(runAction(camp, { q: 'build', opts: { type: 'hut' } }).log.at(-1)?.text).toMatch(/haven't worked out how to make a brush hut/);
    // Known recipes still work.
    expect(runAction(camp, 'build').tier).toBe(1);
  });

  // 3. Observations and finds teach recipes, once each, with a journal line.
  it('discovers recipes from what you see and find', () => {
    // Tracking game → the snare.
    const tracked = runAction(scouted(), 'track');
    expect(tracked.known).toContain('trap-snare');
    expect(tracked.log.some(l => /Worked out: Snare/.test(l.text))).toBe(true);
    expect(runAction(tracked, 'snare').tools.map(t => t.item)).toEqual(['trap-snare']);

    // Surveying the near ring → forage observed (brush hut) and stone observed (stone walls).
    const surveyed = runAction(scouted(), 'survey');
    expect(surveyed.known).toEqual(expect.arrayContaining(['shelter-hut', 'shelter-stone']));

    // A first hide → waterskin and hide parka; a first roof → the shovel.
    const hunted = runAction({ ...scouted(), explore: track(scout(createExploration(), 1), 1) }, 'hunt');
    expect(hunted.known).toEqual(expect.arrayContaining(['waterskin', 'hide-parka']));
    const roofed = runAction(chooseSite(scouted(), 'cave'), 'build');
    expect(roofed.known).toContain('crude-shovel');

    // Once each.
    const again = runAction({ ...tracked, hoursToday: 0 }, 'track');
    expect(again.log.filter(l => /Worked out: Snare/.test(l.text))).toHaveLength(1);
    // Nothing is learned from a survey you never made.
    expect(scouted().known).not.toContain('shelter-stone');
    expect(level(survey(createExploration(), 1), 1, 'stone')).toBe(2);
  });

  // 4. Study reaches the same recipes by thinking: rank 1 in a concept reveals what uses it.
  it('reveals recipes through study', () => {
    let s = scouted();
    const opts = ACTIONS.study.options?.(s, { concept: 'joinery' })[0];
    expect(opts?.choices.find(c => c.value === 'joinery')?.note).toMatch(/reveals brush hut, stone-banked walls/);

    // Study joinery across a few days (each session costs a third of Clarity; nights reset it).
    for (let day = 0; day < 3 && !s.known.includes('shelter-hut'); day++) {
      s = runAction({ ...s, hoursToday: 0, studiedToday: {}, vitals: { ...s.vitals, clarity: { ...s.vitals.clarity, current: s.vitals.clarity.cap } } }, { q: 'study', opts: { concept: 'joinery' } });
    }
    expect(s.concepts.joinery?.rank).toBe(1);
    expect(s.known).toEqual(expect.arrayContaining(['shelter-hut', 'shelter-stone']));
    expect(s.log.some(l => /your study of joinery shows the way/.test(l.text))).toBe(true);

    // Too foggy to study is refused for free.
    const foggy = { ...scouted(), vitals: { ...scouted().vitals, clarity: { current: 10, cap: 100 } } };
    expect(runAction(foggy, 'study').log.at(-1)?.text).toMatch(/too foggy/);
  });
});
