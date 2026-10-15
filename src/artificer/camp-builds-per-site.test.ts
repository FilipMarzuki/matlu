/**
 * Acceptance tests for #1753 — each camp site keeps what you built there (switch
 * `camp-builds-per-site`, on top of `camp-as-action`). One test per Given/When/Then, in the issue's
 * order, then the save checks:
 *
 *   1. Back at A          — a cold pit and a shelter built at A are there again after a stay at B.
 *   2. Not at A           — a build at B isn't available while camped at A.
 *   3. Food in A's pit    — comes with you by default (Make camp's `pitFood: take`), leaving an
 *                           empty pit; with `pitFood: leave` it stays at A, back in your stores when
 *                           you return, and it spoils while you're away only as it would in the pit.
 *                           The option shows only with a pit and food; the AI and API default is take.
 *   4. An old save        — loads, and its builds belong to the current camp.
 *   5. Off or absent      — the game behaves as it did before the switch; the same seed, the same run.
 *   6. The save           — round-trips with the switch on; a malformed `siteBuilds` is dropped.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, ACTIONS, blockedReason, nightSpoilage, type Region1State, type QueueItem } from './region1';
import { survey, createExploration } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { CAMP_AS_ACTION, knownSpots, campSpotOf } from './camp-sites';
import { CAMP_BUILDS_PER_SITE, WEATHER_DAYS, buildsAt, buildsText, validSiteBuilds } from './camp-builds';
import { apply, startGame, view } from '../artificer-play/session';
import { nightTemp, weatherFor } from './weather';
import { seedOf } from './rng';
import { makeT } from './i18n';
import { serialize, deserialize, makeWarden } from '../artificer-app/controller';
import { observe } from '../artificer-ai/observe';
import { choiceNote } from '../artificer-app/sim-words';
import { spotsBlock } from '../artificer-app/camp-blocks';
import { campSpotsSection } from '../artificer-app/land-view';

const en = makeT('en');
const sv = makeT('sv');

/** Daylight, clear weather, no luck, accidents or encounters; `builds` the switch under test. */
const world = (builds: boolean | 'absent', extra: Partial<WorldConfig> = {}): WorldConfig => ({
  ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false, ...extra,
  features: { [CAMP_AS_ACTION]: true, 'cold-pit-slows': true, ...(builds === 'absent' ? {} : { [CAMP_BUILDS_PER_SITE]: builds }) },
});
const camp = (spot: string): QueueItem => ({ q: 'camp', opts: { spot } });
/** Make camp at `spot`, leaving the cold pit's food in the pit (#1753's `pitFood: leave`). */
const campLeaving = (spot: string): QueueItem => ({ q: 'camp', opts: { spot, pitFood: 'leave' } });
/** A fresh morning: the day's hours unspent, so the next move isn't cut short. */
const morning = (s: Region1State): Region1State => ({ ...s, hoursToday: 0 });

/** Camped at the start (A) with every ring surveyed, a sound lean-to with timber walls and a cold pit, and `food` raw food. */
function campedAtA(builds: boolean | 'absent' = true, food = 5, extra: Partial<WorldConfig> = {}): { s: Region1State; a: string; b: string } {
  const fresh = createRegion1({ world: world(builds, extra) }, undefined, { id: 'w-astrid' });
  const a = knownSpots(fresh)[0].id;
  let s = runAction(fresh, camp(a));
  s = {
    ...morning(s), explore: survey(survey(survey(createExploration(), 1), 2), 3),
    tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' }, coldPitAt: s.site,
    stores: { ...s.stores, rawFood: food, water: 20, firewood: 20, materials: 10, stone: 8 },
  };
  const b = knownSpots(s).find(p => !p.here)!.id;
  return { s, a, b };
}

describe('Each camp site keeps what you built there (#1753)', () => {
  it('1. a cold pit and a shelter built at A are there again after camp moves to B and back', () => {
    const { s, a, b } = campedAtA();
    const atB = runAction(s, camp(b));
    expect(campSpotOf(atB)?.at).toBe(b);
    expect(atB.tier).toBe(0);
    expect(atB.coldPitAt).toBeNull();
    // A's camp is kept where it stands, and the page and the AI can say what's there.
    expect(buildsAt(atB, a).map(x => x.key)).toEqual(['leanto', 'timber', 'pit']);
    const back = runAction(morning(atB), camp(a));
    expect(campSpotOf(back)?.at).toBe(a);
    expect(back.tier).toBe(2);
    expect(back.shelterGrade).toBe('sound');
    expect(back.shelter).toEqual({ type: 'leanto', walls: 'timber' });
    expect(back.coldPitAt).toBe(back.site);
    expect(blockedReason(back, 'coldPit', 1)).toMatch(/already a cold pit here/);
    expect(back.log.some(l => l.text === 'Your shelter here still stands.')).toBe(true);
    // A's record is back in the live camp, so it isn't kept twice.
    expect(back.siteBuilds?.[a]).toBeUndefined();
  });

  it('1b. a shelter left a long time weathers, a grade for every few days away, never below crude', () => {
    const { s, a, b } = campedAtA();
    let away = runAction({ ...s, shelterGrade: 'fine' }, camp(b));
    away = { ...morning(away), day: away.day + WEATHER_DAYS };
    const back = runAction(away, camp(a));
    expect(back.shelterGrade).toBe('sound');
    expect(back.log.some(l => l.text === 'Your shelter here still stands, a little weathered.')).toBe(true);
    let long = runAction(s, camp(b));
    long = { ...morning(long), day: long.day + WEATHER_DAYS * 5 };
    expect(runAction(long, camp(a)).shelterGrade).toBe('crude');
  });

  it('2. a build at B isn\'t available while camped at A', () => {
    const { s, a, b } = campedAtA();
    // Move to B (A keeps its camp), build there, and come back to A.
    let atB = runAction({ ...s, stores: { ...s.stores, rawFood: 0 } }, camp(b));
    atB = { ...morning(atB), tier: 1, shelterGrade: 'crude', shelter: { type: 'hut', walls: null } };
    const atA = runAction(morning(atB), camp(a));
    expect(atA.shelter.type).toBe('leanto');
    expect(buildsAt(atA, b).map(x => x.key)).toEqual(['hut']);
    expect(atA.siteBuilds?.[b]?.shelter?.type).toBe('hut');
    // …and the hut is B's again when you go back there.
    expect(runAction(morning(atA), camp(b)).shelter.type).toBe('hut');
  });

  it('3. by default the pit\'s food comes with you, and A keeps an empty pit', () => {
    const { s, a, b } = campedAtA(true, 11);
    const atB = runAction(s, camp(b));
    expect(atB.stores.rawFood).toBe(11);
    expect(atB.siteBuilds?.[a]?.pit).toEqual({ food: 0 });
    expect(atB.log.some(l => /raw food in the cold pit/.test(l.text))).toBe(false);
    expect(buildsText(buildsAt(atB, a))).toBe('lean-to, timber walls, cold pit');
    // The pit is still A's: back there, it's dug, and empty.
    const back = runAction(morning(atB), camp(a));
    expect(back.coldPitAt).toBe(back.site);
    expect(back.stores.rawFood).toBe(11);
    expect(back.pitRot).toBeUndefined();
    expect(back.log.some(l => l.text === 'The cold pit here is as you left it.')).toBe(true);
    // `take` said outright is the same move as no choice at all.
    const said = runAction(s, { q: 'camp', opts: { spot: b, pitFood: 'take' } });
    expect(JSON.stringify(said)).toBe(JSON.stringify(atB));
  });

  it('3a. with "leave", food in A\'s cold pit stays at A: left when you go, back when you return', () => {
    const { s, a, b } = campedAtA(true, 11);
    const atB = runAction(s, campLeaving(b));
    // The pit at A holds 8 (12 at the river); what it holds stays there, the rest goes with you.
    const held = Math.min(11, s.site === 'river' ? 12 : 8);
    expect(atB.stores.rawFood).toBe(11 - held);
    expect(atB.siteBuilds?.[a]?.pit?.food).toBe(held);
    expect(atB.log.some(l => l.text === `You leave ${held} raw food in the cold pit.`)).toBe(true);
    // It isn't yours at B: not counted, not eaten, not spoiled with what you carry.
    expect(buildsText(buildsAt(atB, a))).toBe(`lean-to, timber walls, cold pit (${held} raw food)`);
    // Clear weather (no cold, no spoilage here): it's all there when you come back.
    const back = runAction(morning({ ...atB, day: atB.day + 3 }), camp(a));
    expect(back.stores.rawFood).toBe(11);
    expect(back.log.some(l => l.text === `You take ${held} raw food back out of the cold pit.`)).toBe(true);
  });

  it('3b. food left in a pit spoils while you\'re away exactly as it would in the pit, by the run\'s own weather', () => {
    const { s, a, b } = campedAtA(true, 8, { weather: 'seeded' });
    const atB = runAction({ ...s, day: 3 }, campLeaving(b));
    const left = atB.siteBuilds![a].pit!.food;
    const days = 7;
    const back = runAction(morning({ ...atB, day: atB.day + days }), camp(a));
    // The same nights in the pit, worked out with the camp's own rule.
    let food = left;
    let pitRot: number | undefined;
    for (let d = atB.day; d < atB.day + days; d++) {
      const t = nightTemp(d, weatherFor(seedOf(s.character.id), d, s.config.world, s.config.calendar), s.config.calendar);
      const sp = nightSpoilage({ ...s, day: d, stores: { ...s.stores, rawFood: food }, pitRot }, t);
      food -= sp.spoiled;
      pitRot = sp.pitRot;
    }
    expect(food).toBeLessThan(left);
    expect(back.stores.rawFood).toBe(atB.stores.rawFood + food);
    expect(back.pitRot ?? 0).toBeCloseTo(pitRot ?? 0, 6);
    // With the pit stopping the rot (`cold-pit-slows` off), it keeps.
    const keeps = campedAtA(true, 8, { weather: 'seeded' });
    const offWorld = { ...keeps.s.config.world, features: { ...keeps.s.config.world.features, 'cold-pit-slows': false } };
    const k0 = { ...keeps.s, day: 3, config: { ...keeps.s.config, world: offWorld } };
    const kB = runAction(k0, campLeaving(keeps.b));
    expect(runAction(morning({ ...kB, day: kB.day + days }), camp(keeps.a)).stores.rawFood).toBe(8);
  });

  it('3c. the pit\'s food is a choice only when the camp you\'re leaving has a cold pit and you have raw food', () => {
    const { s, b } = campedAtA(true, 5);
    const groups = ACTIONS.camp.options!(s, {});
    expect(groups.map(g => g.key)).toEqual(['spot', 'pitFood']);
    const g = groups[1];
    expect(g.value).toBe('take');
    expect(g.choices.map(c => c.value)).toEqual(['take', 'leave']);
    const site = `the ${s.site === 'tree' ? 'treeline' : s.site === 'river' ? 'riverbank' : s.site === 'hill' ? 'hilltop' : 'cave'}`;
    expect(g.choices[0].note).toBe('you take your food with you');
    expect(g.choices[1].note).toBe(`leaves 5 raw food in the cold pit at ${site}`);
    expect(ACTIONS.camp.options!(s, { pitFood: 'leave' })[1].value).toBe('leave');
    // The page's English is the sim's, and the Swedish its own.
    for (const c of g.choices) expect(choiceNote(s, g, c, en)).toBe(c.note);
    expect(choiceNote(s, g, g.choices[1], sv)).toMatch(/^lämnar 5 mat i kylgropen vid /);
    expect(choiceNote(s, g, g.choices[0], sv)).toBe('du tar med dig maten');
    // No raw food, no pit, or the switch off or absent: no choice.
    const keys = (x: Region1State): string[] => ACTIONS.camp.options!(x, {}).map(o => o.key);
    expect(keys({ ...s, stores: { ...s.stores, rawFood: 0 } })).toEqual(['spot']);
    expect(keys({ ...s, coldPitAt: null })).toEqual(['spot']);
    expect(keys(campedAtA(false).s)).toEqual(['spot']);
    expect(keys(campedAtA('absent').s)).toEqual(['spot']);
    // Nor at B, where no pit was dug.
    expect(keys(runAction(s, camp(b)))).toEqual(['spot']);
  });

  it('3d. the AI and the API see the choice, and their default is take: an AI that ignores it keeps its food', () => {
    const { s, b } = campedAtA(true, 5);
    // The AI's observation lists the option like any other.
    expect(observe(s)).toContain('options "pitFood": take (Take it: you take your food with you) | leave (Leave it in the pit: leaves 5 raw food in the cold pit at');
    // The API: a game whose camp has a pit and food; Make camp without the option keeps the food.
    const g0 = startGame({ seed: 'pitfood' });
    const g = { ...g0, app: { ...g0.app, sim: s } };
    expect(view(g).text).toContain('"pitFood"');
    const r = apply(g, { do: { q: 'camp', opts: { spot: b } } });
    if (!r.ok) throw new Error(r.error);
    expect(r.game.app.sim.stores.rawFood).toBe(5);
    expect(r.game.app.sim.siteBuilds?.[knownSpots(s).find(p => p.here)!.id]?.pit?.food).toBe(0);
  });

  it('4. a save from before the switch loads, and its builds belong to the current camp', () => {
    const { s, a, b } = campedAtA();
    // A save written before #1753: no `siteBuilds`, and no switch in its features (absent: off).
    const features = { ...s.config.world.features };
    delete features[CAMP_BUILDS_PER_SITE];
    const old = { ...s, config: { ...s.config, world: { ...s.config.world, features } } };
    const app = makeWarden({ id: 'w-astrid' });
    const loaded = deserialize(serialize({ ...app, sim: old }))!.sim;
    expect(loaded.siteBuilds).toBeUndefined();
    expect(loaded.tier).toBe(2);
    expect(loaded.coldPitAt).toBe(loaded.site);
    expect(buildsAt(loaded, a)).toEqual([]); // switch absent: nothing listed, as before
    // And a save with the switch on but no record yet: the camp's builds are the current camp's.
    const onSave = deserialize(serialize({ ...app, sim: s }))!.sim;
    expect(buildsAt(onSave, a).map(x => x.key)).toEqual(['leanto', 'timber', 'pit']);
    expect(runAction(onSave, camp(b)).siteBuilds?.[a]?.shelter?.tier).toBe(2);
  });

  it('5. with the switch off or absent, moving camp leaves everything behind as before, and the same seed plays the same', () => {
    const play = (builds: boolean | 'absent'): Region1State => {
      const { s, a, b } = campedAtA(builds);
      const atB = runAction(s, camp(b));
      return runAction(morning(atB), camp(a));
    };
    for (const builds of [false, 'absent'] as const) {
      const back = play(builds);
      expect(back.tier).toBe(0);
      expect(back.shelterGrade).toBeNull();
      expect(back.shelter).toEqual({ type: null, walls: null });
      expect(back.coldPitAt).toBeNull();
      expect(back.stores.rawFood).toBe(5); // no food left anywhere
      expect('siteBuilds' in back).toBe(false);
      expect(back.log.some(l => /old shelter is left behind/.test(l.text))).toBe(true);
    }
    // Off and absent are the same game, line for line.
    const strip = (x: Region1State): string => JSON.stringify({ ...x, config: null });
    expect(strip(play(false))).toBe(strip(play('absent')));
    // The same seed and moves give the same run, with the switch on too.
    const script = (): string => {
      const { s, a, b } = campedAtA(true, 9, { weather: 'seeded' });
      let x = runDay(s, [camp(b), 'water']).state;
      x = runDay(x, ['wood', camp(a)]).state;
      return JSON.stringify(x);
    };
    expect(script()).toBe(script());
  });

  it('6. the save round-trips with the switch on, and a malformed siteBuilds is dropped', () => {
    const { s, b } = campedAtA();
    const atB = runAction(s, camp(b));
    const app = makeWarden({ id: 'w-astrid' });
    const back = deserialize(serialize({ ...app, sim: atB }))!.sim;
    expect(back.siteBuilds).toEqual(atB.siteBuilds);
    expect(validSiteBuilds(atB.siteBuilds)).toBe(true);
    for (const bad of [
      'nope', [], { 'cave@1,2': 'lean-to' }, { 'nowhere': { left: 3 } }, { 'cave@1,2': { left: 3 } },
      { 'cave@1,2': { left: 3, shelter: { tier: 3, grade: 'sound', type: 'leanto', walls: null } } },
      { 'cave@1,2': { left: 3, pit: { food: -1 } } }, { 'cave@1,2': { left: 3, pit: { food: 2, rot: 4 } } },
    ]) {
      expect(validSiteBuilds(bad)).toBe(false);
      const raw = JSON.parse(serialize({ ...app, sim: atB }));
      raw.sim.siteBuilds = bad;
      expect(deserialize(JSON.stringify(raw))!.sim.siteBuilds).toBeUndefined();
    }
  });

  it('7. the page, the AI and the API say what\'s built at each site, in English and Swedish', () => {
    const { s, a, b } = campedAtA();
    const atB = runAction(s, campLeaving(b));
    // The Make camp option for A says what's there; the English note is the sim's own.
    const g = ACTIONS.camp.options!(atB, {})[0];
    const toA = g.choices.find(c => c.value === a)!;
    expect(toA.note).toContain('built there: lean-to, timber walls, cold pit (5 raw food)');
    expect(choiceNote(atB, g, toA, en)).toBe(toA.note);
    expect(choiceNote(atB, g, toA, sv)).toContain('vindskydd');
    // Leaving A, the option says the camp stays (what happens to the pit's food is the pitFood option's).
    const toB = ACTIONS.camp.options!(s, {})[0].choices.find(c => c.value === b)!;
    expect(toB.note).toContain('your camp here stays as it is');
    expect(toB.note).not.toContain('raw food in the cold pit');
    expect(toB.note).not.toContain('leaves your shelter behind');
    expect(choiceNote(s, ACTIONS.camp.options!(s, {})[0], toB, en)).toBe(toB.note);
    // The Camp tab's site cards and the LAND tab's ⛺ list.
    expect(spotsBlock(atB, en)).toContain('Built here: lean-to, timber walls, cold pit (5 raw food)');
    expect(spotsBlock(atB, sv)).toContain('vindskydd');
    expect(campSpotsSection(atB, en)).toContain('lean-to, timber walls, cold pit (5 raw food)');
    // The AI's observation (and so the English API view).
    expect(observe(atB)).toContain(`BUILT AT OTHER PLACES: ${a}: lean-to, timber walls, cold pit (5 raw food)`);
  });
});
