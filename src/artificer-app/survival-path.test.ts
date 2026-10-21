/**
 * Acceptance tests for #1793 (part 2 of the guide epic #1791): the Survival path, a pure function
 * of the game state, shown through the FOCUS chip and its picker behind the `guide` ui feature.
 *
 * The step function, one Given/When/Then each:
 *   1. Given a new run, the current step is 1 (find a site).
 *   2. Given a known suitable site, step 2 (make camp).
 *   3. Given camp made, step 3 (a roof over you).
 *   4. Given a shelter built, step 4 (food laid by).
 *   5. Given food laid by, step 5 (ready for winter).
 *   6. Given winter-ready, the path is done.
 * Then the chip and picker: the lock wins over the path, the switch off draws them as before, and
 * the suggested goal focus is the picker's ordinary set-focus choice.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { en as EN } from '../artificer/i18n/en';
import { sv as SV } from '../artificer/i18n/sv';
import { createRegion1, survivalLockOf, winterReady, type Region1State } from '../artificer/region1';
import { createExploration, type Domain, type Exploration } from '../artificer/exploration';
import { FULL_WORLD } from '../artificer/world';
import { featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { CAMP_AS_ACTION, CAMP_SITE_RATINGS, knownSpots } from '../artificer/camp-sites';
import { parseFocus } from '../artificer/focus';
import { SKILL_IDS } from '../artificer/skills';
import { FOOD_LAID_BY, GUIDE_FEATURE, PATH_STEPS, stepGoal, suitableSiteKnown, survivalPath } from './survival-path';
import { chooseFocus, makeWarden, type AppState } from './controller';
import { focusChip, focusPopAfter, focusPopover, FOCUS_POP_ID } from './focus-popover';

const en = makeT('en');
const sv = makeT('sv');
const ON = { guide: true }, OFF = { guide: false };

const stats = (int: number) => ({ str: 10, con: 10, agi: 10, int, wil: 10, cha: 10 });
/** The game's own rules (every rule feature at its default), no encounters to get in the way. */
const run = (int = 10, features = ruleFeatures()): Region1State =>
  createRegion1({ world: { ...FULL_WORLD, encounters: false, features } }, undefined, { id: 'w-astrid', name: 'Vega', stats: stats(int) });
/** Only these domains observed, in every ring: only those kinds of site are known (as camp-site-ratings.test.ts). */
function observedOnly(...domains: Domain[]): Exploration {
  const e = createExploration();
  for (const r of [1, 2, 3] as const) for (const d of domains) e.known[r][d] = 2;
  return e;
}

// The path, step by step, as a run might walk it.
/** A new run. */
const s1 = (): Region1State => run(13);
/** An explored riverbank read fairly (Intelligence 13): a good place to camp (camp-site-ratings.test.ts #2). */
const s2 = (): Region1State => ({ ...s1(), explore: observedOnly('water') });
/** Camp made at it. */
const s3 = (): Region1State => ({ ...s2(), site: 'river', campSpot: { at: knownSpots(s2()).find(p => p.kind === 'river')!.id, camped: [] } });
/** A lean-to built there. */
const s4 = (): Region1State => { const s = s3(); return { ...s, tier: 1, shelterGrade: 'sound', shelter: { ...s.shelter, type: 'leanto' } }; };
/** Food for a week in the stores. */
const s5 = (): Region1State => { const s = s4(); return { ...s, stores: { ...s.stores, rawFood: 4, rations: 3 } }; };
/** The larder, the woodpile, the shelter and the body all ready for winter. */
const s6 = (): Region1State => {
  const s = s5();
  return { ...s, tier: 2, shelterGrade: 'fine', shelter: { ...s.shelter, type: 'hut', walls: 'stone', sited: true },
    stores: { ...s.stores, rations: 20, firewood: 40 }, tools: [...s.tools, { item: 'bedroll', grade: 'fine' } as Region1State['tools'][number]] };
};
/** Three nights without water: survival takes over. */
const locked = (s: Region1State): Region1State => ({ ...s, deprivation: { ...s.deprivation, thirsty: 3 } });

const stepOf = (s: Region1State): number | null => { const c = survivalPath(s).current; return c === null ? null : c + 1; };

describe('The Survival path is a pure function of the state (#1793)', () => {
  it('1. Given a new run, When the path is read, Then the current step is 1: find a camp site', () => {
    const s = s1();
    expect(suitableSiteKnown(s)).toBe(false);
    expect(stepOf(s)).toBe(1);
    expect(survivalPath(s).steps.map(x => x.id)).toEqual(['site', 'camp', 'roof', 'food', 'winter']);
    expect(survivalPath(s).steps.every(x => !x.done)).toBe(true);
  });

  it('2. Given a known suitable site, Then step 2: make camp', () => {
    const s = s2();
    expect(suitableSiteKnown(s)).toBe(true);
    expect(stepOf(s)).toBe(2);
  });

  it('3. Given camp made, Then step 3: a roof over you', () => {
    expect(stepOf(s3())).toBe(3);
    // Camping where you woke up, before finding anywhere better, counts for step 1 too.
    expect(stepOf({ ...s1(), site: 'hill' })).toBe(3);
  });

  it('4. Given a shelter built at camp, Then step 4: food laid by', () => {
    expect(stepOf(s4())).toBe(4);
    // A cave's rock is a roof (built-warmth's naturalRoof).
    expect(stepOf({ ...s3(), site: 'cave' })).toBe(4);
  });

  it(`5. Given food for ${FOOD_LAID_BY} nights (raw food and rations), Then step 5: ready for winter`, () => {
    expect(stepOf(s5())).toBe(5);
    const short = s5();
    // The most a run starts with (2 raw food and the weekend food's 4 rations) isn't a week's worth.
    expect(stepOf({ ...short, stores: { ...short.stores, rawFood: 2, rations: 4 } })).toBe(4);
  });

  it('6. Given winter-ready, Then the path is done', () => {
    const s = s6();
    expect(winterReady(s)).toBe(true);
    expect(survivalPath(s).current).toBeNull();
  });

  it('goes back to a step whose fact stops holding: the larder eaten down returns it to step 4', () => {
    const s = s5();
    expect(stepOf({ ...s, stores: { ...s.stores, rawFood: 0, rations: 1 } })).toBe(4);
  });

  it('reads step 1 under the older camp rules too', () => {
    // Camp as an action without the ratings: any known place other than the start.
    const noRatings = run(13, { ...ruleFeatures(), [CAMP_SITE_RATINGS]: false });
    expect(suitableSiteKnown(noRatings)).toBe(false);
    expect(suitableSiteKnown({ ...noRatings, explore: observedOnly('water') })).toBe(true);
    // The old site picker: the near ring scouted, when its sites can be chosen.
    const old = run(13, { ...ruleFeatures(), [CAMP_AS_ACTION]: false });
    expect(suitableSiteKnown(old)).toBe(false);
    expect(suitableSiteKnown({ ...old, explore: observedOnly('forage', 'timber', 'stone', 'water', 'game') })).toBe(true);
  });

  it('suggests the goal focus that helps: Explore, none, Shelter, Larder, and for winter what is short', () => {
    const s = s5();
    expect(PATH_STEPS.map(id => stepGoal(s, id))).toEqual(['explore', null, 'shelter', 'larder', 'larder']);
    // The larder full, the woodpile short: Shelter (its actions are build and wood).
    expect(stepGoal({ ...s, stores: { ...s.stores, rations: 20 } }, 'winter')).toBe('shelter');
  });

  it('is pure: the same state reads the same path, and reading it changes nothing', () => {
    const s = s3();
    const before = JSON.stringify(s);
    expect(survivalPath(s)).toEqual(survivalPath(s3()));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('The FOCUS chip shows the Survival path (#1793)', () => {
  it('names the current step with no focus, in English and Swedish', () => {
    const chip = focusChip(s1(), en, false, ON);
    expect(chip).toContain('class="focuschip path"');
    expect(chip).toContain('FOCUS <b>Survive 1/5:</b> <span>find a camp site</span>');
    expect(focusChip(s1(), sv, false, ON)).toContain('FOKUS <b>Överleva 1/5:</b> <span>hitta en lägerplats</span>');
    expect(focusChip(s4(), en, false, ON)).toContain('<b>Survive 4/5:</b> <span>food laid by</span>');
    expect(focusChip(s3(), sv, false, ON)).toContain('<b>Överleva 3/5:</b> <span>tak över huvudet</span>');
    expect(focusChip(s5(), en, false, ON)).toContain('<b>Survive 5/5:</b> <span>ready for winter</span>');
  });

  it('names the step with a goal focus, and keeps a skill or concept focus', () => {
    const goal = { ...s1(), focus: { kind: 'goal' as const, id: 'larder' as const } };
    expect(focusChip(goal, en, false, ON)).toContain('Survive 1/5:');
    const skill = { ...s1(), focus: { kind: 'skill' as const, id: SKILL_IDS[0] } };
    expect(focusChip(skill, en, false, ON)).toBe(focusChip(skill, en, false, OFF));
  });

  it('Given the survival lock, Then the chip shows the lock, not the path', () => {
    for (const s of [locked(s1()), locked(s3())]) {
      expect(survivalLockOf(s)).not.toBeNull();
      const chip = focusChip(s, en, false, ON);
      expect(chip).toContain('class="focuschip locked"');
      expect(chip).toContain('SURVIVAL');
      expect(chip).not.toContain('Survive ');
      expect(chip).toBe(focusChip(s, en, false, OFF));
    }
  });

  it('after step 5 shows the focus as before', () => {
    expect(focusChip(s6(), en, false, ON)).toBe(focusChip(s6(), en, false, OFF));
    expect(focusChip(s6(), en, false, ON)).not.toContain('Survive');
  });

  it('with the switch off is drawn exactly as before', () => {
    for (const s of [s1(), s3(), s5(), locked(s1())]) {
      expect(focusChip(s, en, true, OFF)).toBe(focusChip(s, en, true));
      expect(focusChip(s, en, false, OFF)).not.toContain('Survive');
    }
  });
});

describe('The focus picker lists the steps and suggests a goal focus (#1793)', () => {
  /** The suggested focus button, if any: its data-focus and whether it is disabled. */
  const suggest = (html: string): { focus: string; disabled: boolean } | null => {
    const m = /<button class="fchip fpsuggest" data-focus="([^"]+)"[^>]*?( disabled)?>/.exec(html);
    return m ? { focus: m[1], disabled: !!m[2] } : null;
  };

  it('shows the five steps, the done ones ticked and the current one marked', () => {
    const pop = focusPopover(s3(), en, ON);
    expect(pop).toContain('class="fppath"');
    expect(pop).toContain('SURVIVE 3/5');
    const items = [...pop.matchAll(/<li class="([^"]*)"/g)].map(m => m[1]);
    expect(items).toEqual(['done', 'done', 'now', '', '']);
    expect(pop).toContain('aria-current="step"');
    expect(pop).toContain('Build a shelter at camp.');
    expect(focusPopover(s3(), sv, ON)).toContain('Bygg ett skydd i lägret.');
  });

  it('suggests the goal focus for the step, as the picker\'s own set-focus choice', () => {
    expect(suggest(focusPopover(s1(), en, ON))).toEqual({ focus: 'goal:explore', disabled: false });
    expect(suggest(focusPopover(s2(), en, ON))).toBeNull();
    expect(suggest(focusPopover(s3(), en, ON))).toEqual({ focus: 'goal:shelter', disabled: false });
    expect(suggest(focusPopover(s4(), en, ON))).toEqual({ focus: 'goal:larder', disabled: false });
    expect(focusPopover(s1(), en, ON)).toContain('>Focus: Explore</button>');
    expect(focusPopover(s1(), sv, ON)).toContain('>Fokus: Utforska</button>');
    // It is inside the picker, so main.ts's set-focus handler closes the picker after it.
    const pop = focusPopover(s1(), en, ON);
    expect(pop.indexOf('fpsuggest')).toBeGreaterThan(pop.indexOf(`id="${FOCUS_POP_ID}"`));
    expect(focusPopAfter(true, 'pick')).toBe(false);
    // And it is the existing move: the same key the goal chip sets.
    expect(pop).toContain('<button class="fchip" data-focus="goal:explore"');
    const f = parseFocus(suggest(pop)!.focus);
    const a: AppState = { ...makeWarden({ id: 'w-astrid' }), sim: s1(), queue: [] };
    expect(chooseFocus(a, f).sim.focus).toEqual({ kind: 'goal', id: 'explore' });
  });

  it('says the goal is already your focus instead of offering it again', () => {
    const s = { ...s1(), focus: { kind: 'goal' as const, id: 'explore' as const } };
    const pop = focusPopover(s, en, ON);
    expect(suggest(pop)).toBeNull();
    expect(pop).toContain('Your focus: Explore');
  });

  it('says how much food is laid by on step 4', () => {
    expect(focusPopover(s4(), en, ON)).toContain(`Lay by food for ${FOOD_LAID_BY} nights: 2 so far.`);
  });

  it('greys the suggestion out while survival has taken over', () => {
    expect(suggest(focusPopover(locked(s1()), en, ON))).toEqual({ focus: 'goal:explore', disabled: true });
  });

  it('shows no checklist once the path is done, and none with the switch off', () => {
    expect(focusPopover(s6(), en, ON)).not.toContain('fppath');
    for (const s of [s1(), s3(), locked(s1())]) {
      expect(focusPopover(s, en, OFF)).toBe(focusPopover(s, en));
      expect(focusPopover(s, en, OFF)).not.toContain('fppath');
    }
  });
});

describe('The guide ui feature (#1793)', () => {
  it('is a ui feature, on by default, that a player can switch off and no run saves', () => {
    const f = featureById(GUIDE_FEATURE);
    expect(f?.kind).toBe('ui');
    expect(uiFeatureOn({}, GUIDE_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [GUIDE_FEATURE]: false }, GUIDE_FEATURE)).toBe(false);
    expect(Object.keys(ruleFeatures())).not.toContain(GUIDE_FEATURE);
  });

  it('has every string in English and Swedish, with the same {vars}', () => {
    const keys = Object.keys(EN).filter(k => k.startsWith('path.'));
    expect(keys.length).toBeGreaterThan(10);
    const vars = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for (const k of keys) {
      const s = (SV as Record<string, string>)[k];
      expect(s, k).toBeTruthy();
      expect(vars(s), k).toEqual(vars((EN as Record<string, string>)[k]));
    }
  });
});
