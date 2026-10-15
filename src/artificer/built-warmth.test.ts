/**
 * Acceptance tests for #1763 — with `built-warmth`, camp warmth comes from what you build; the site
 * gives a head start (its natural shelter), not a ceiling. One test per Given/When/Then, in the
 * issue's order, then the soft site penalties, the ratings, the words and the switch:
 *
 *   1. A bare hilltop     — the night is cold, colder than a cave with nothing built.
 *   2. A built hilltop    — a proper wood shelter, a windbreak and a fire: warm enough to rest,
 *                           within a small margin of a cave with a bed and a fire.
 *   3. A cave             — a bed and a fire, no walls: warm.
 *   4. The words          — no "MAX %" or "up to x% warm" anywhere (page in English and Swedish, the
 *                           Make camp options, the site cards, the LAND list, the AI and the API);
 *                           each site said by its natural shelter and what it needs.
 *   5. Off or absent      — today's ceilings, exactly; the same seed gives the same run.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, warmth, ACTIONS, FIRE_WARMTH, SITES, type Region1State, type SiteId, type QueueItem } from './region1';
import { FULL_WORLD, type WorldConfig } from './world';
import { coldNightNeeds, nightTemp } from './weather';
import { DEFAULT_CALENDAR, MIDWINTER_AFTER } from './winter';
import { BUILT_WARMTH, NATURAL_SHELTER, SHELTER_TEXT, WIND_EXPOSURE, DAMP, naturalWarmth, siteShelterText } from './built-warmth';
import { CAMP_AS_ACTION, knownSpots, ratingOfFacts } from './camp-sites';
import { createVitals } from './vitality';
import { en as EN } from './i18n/en';
import { makeT } from './i18n';
import { observe } from '../artificer-ai/observe';
import { choiceNote } from '../artificer-app/sim-words';
import { sitesBlock, spotsBlock } from '../artificer-app/camp-blocks';
import { campSpotsSection } from '../artificer-app/land-view';
import { startGame, view } from '../artificer-play/session';

const en = makeT('en');
const sv = makeT('sv');

/**
 * The full world's seeded weather (a fixed weather is the flat world, with no frost), no luck,
 * accidents or encounters; each test sets the day's weather itself. `on` the switch under test.
 */
const world = (on: boolean | 'absent', extra: Record<string, boolean> = {}): WorldConfig => ({
  ...FULL_WORLD, luck: false, accidents: false, encounters: false,
  features: { [CAMP_AS_ACTION]: false, ...extra, ...(on === 'absent' ? {} : { [BUILT_WARMTH]: on }) },
});

/** The deepest midwinter night: a clear one, about −19 °C. */
const MIDWINTER = DEFAULT_CALENDAR.winterDay + MIDWINTER_AFTER;

/** Settled at `site` (nothing built) on the midwinter morning, with food, water and wood for the night's fire. */
function campAt(site: SiteId, on: boolean | 'absent' = true, over: Partial<Region1State> = {}): Region1State {
  const s = chooseSite(runAction(createRegion1({ world: world(on) }, undefined, { id: 'w-astrid' }), 'scout'), site);
  return {
    ...s, day: MIDWINTER, hoursToday: 0, weatherToday: 'clear', vitals: createVitals(), tools: [],
    stores: { ...s.stores, rawFood: 10, water: 10, firewood: 40 }, ...over,
  };
}

/** A proper wood shelter: a lean-to roof and timber walls, soundly built. */
const WOOD_SHELTER: Partial<Region1State> = { tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' } };
const BED: Partial<Region1State> = { tools: [{ item: 'bedroll', grade: 'sound' }] };

/** The night's warmth with the fire kept in, as the night reckons it (region1.ts endDay). */
const withFire = (s: Region1State): number => Math.min(1, warmth(s) + FIRE_WARMTH);
/** Whether the midwinter night is a cold one, slept through in play. */
const coldNight = (s: Region1State): boolean => runDay(s, []).state.log.slice(s.log.length).some(l => /A cold, broken night/.test(l.text));
const MIDWINTER_NEEDS = coldNightNeeds(nightTemp(MIDWINTER, 'clear', DEFAULT_CALENDAR));

describe('Camp warmth comes from what you build (#1763)', () => {
  it('1. a hilltop with no shelter is cold, colder than a cave with nothing built', () => {
    const hill = campAt('hill');
    const cave = campAt('cave');
    expect(warmth(hill)).toBe(0); // no natural shelter, and the wind takes the rest
    expect(warmth(hill)).toBeLessThan(warmth(cave));
    expect(withFire(hill)).toBeLessThan(MIDWINTER_NEEDS);
    expect(coldNight(hill)).toBe(true);
    // Even on a mild autumn night the bare hilltop is cold.
    expect(coldNight({ ...hill, day: 3 })).toBe(true);
  });

  it('2. a hilltop with a proper wood shelter, a windbreak and a fire is warm enough to rest, within a small margin of a cave with a bed and a fire', () => {
    // The windbreak: timber walls, soundly built, keep the hilltop's wind off (no exposure penalty).
    const hill = campAt('hill', true, WOOD_SHELTER);
    const cave = campAt('cave', true, BED);
    expect(withFire(hill)).toBeGreaterThanOrEqual(MIDWINTER_NEEDS);
    expect(coldNight(hill)).toBe(false);
    expect(Math.abs(withFire(hill) - withFire(cave))).toBeLessThanOrEqual(0.1);
    // Winterized, as the readiness check reads it (75%).
    expect(warmth(hill)).toBeGreaterThanOrEqual(0.75);
    // A proper wood shelter is enough on any ground: the treeline and the riverbank too.
    for (const site of ['tree', 'river'] as const) {
      const s = campAt(site, true, WOOD_SHELTER);
      expect(withFire(s), site).toBeGreaterThanOrEqual(MIDWINTER_NEEDS);
      expect(coldNight(s), site).toBe(false);
    }
  });

  it('3. a cave with only a bed and a fire is warm, without building walls', () => {
    const cave = campAt('cave', true, BED);
    expect(cave.tier).toBe(0);
    expect(withFire(cave)).toBeGreaterThanOrEqual(MIDWINTER_NEEDS);
    expect(coldNight(cave)).toBe(false);
    // The rock is a roof: a rainy night in the cave isn't cold for want of one.
    const rainy = { ...cave, day: 3, weatherToday: 'rain' as const };
    expect(coldNight(rainy)).toBe(false);
    // …where the same rainy night on the hilltop, with a bed but no roof, is cold.
    expect(coldNight({ ...campAt('hill', true, BED), day: 3, weatherToday: 'rain' })).toBe(true);
    // The bed is what it needs: without one, the deepest midwinter night is still cold.
    expect(coldNight(campAt('cave'))).toBe(true);
  });

  it('natural shelter: the cave gives a lot, the treeline some, the riverbank little, the hilltop none', () => {
    expect(NATURAL_SHELTER.cave).toBeGreaterThan(NATURAL_SHELTER.tree);
    expect(NATURAL_SHELTER.tree).toBeGreaterThan(NATURAL_SHELTER.river);
    expect(NATURAL_SHELTER.river).toBeGreaterThan(NATURAL_SHELTER.hill);
    expect(NATURAL_SHELTER.hill).toBe(0);
    for (const site of Object.keys(SITES) as SiteId[]) expect(naturalWarmth(campAt(site)), site).toBeCloseTo(Math.max(0, NATURAL_SHELTER[site] - (site === 'hill' ? WIND_EXPOSURE : site === 'river' ? DAMP : 0)));
  });

  it('soft penalties: the hilltop wind costs a little without a windbreak, the riverbank damp a little without a raised floor', () => {
    // Crude timber walls on the hilltop let the wind through; sound ones break it.
    const crude = campAt('hill', true, { ...WOOD_SHELTER, shelterGrade: 'crude' });
    const sound = campAt('hill', true, WOOD_SHELTER);
    expect(warmth(sound) - warmth(crude)).toBeGreaterThan(WIND_EXPOSURE);
    // A lean-to (no walls) on the hilltop pays the wind; the same lean-to at a treeline doesn't.
    const leanto: Partial<Region1State> = { tier: 1, shelterGrade: 'sound', shelter: { type: 'leanto', walls: null } };
    const exposed = warmth(campAt('hill', true, leanto));
    expect(exposed).toBeCloseTo(warmth(campAt('hill', true, { ...leanto, shelter: { type: 'leanto', walls: null, sited: true } })) - WIND_EXPOSURE - 0.05, 5);
    // The riverbank: a crude lean-to sits on the wet ground, a sound one is raised off it.
    const wet = warmth(campAt('river', true, { ...leanto, shelterGrade: 'crude' }));
    const raised = warmth(campAt('river', true, leanto));
    expect(raised - wet).toBeGreaterThan(DAMP);
    // Small: neither penalty is a ceiling.
    expect(WIND_EXPOSURE).toBeLessThanOrEqual(0.1);
    expect(DAMP).toBeLessThanOrEqual(0.1);
  });

  it('the site ratings (#1756) read the natural shelter: the more a site shelters, the more it rates', () => {
    // A still, dry, safe reading near water and wood, the same at each kind of site: the cave rates no worse than the treeline, and so on.
    const facts: Parameters<typeof ratingOfFacts>[1] = [{ trait: 'wind', key: 'someWind' }, { trait: 'ground', key: 'groundDry' }, { trait: 'water', key: 'waterShort' }, { trait: 'fuel', key: 'woodWalk' }, { trait: 'risk', key: 'noRisk' }];
    const rank = { poor: 0, good: 1, great: 2 } as const;
    const order = (Object.keys(NATURAL_SHELTER) as SiteId[]).sort((a, b) => NATURAL_SHELTER[b] - NATURAL_SHELTER[a]);
    for (let i = 1; i < order.length; i++) expect(rank[ratingOfFacts(order[i - 1], facts)]).toBeGreaterThanOrEqual(rank[ratingOfFacts(order[i], facts)]);
  });

  describe('4. the words: natural shelter and what it needs, never a ceiling', () => {
    const NO_CEILING = /max\s*\d+\s*%|up to \d+\s*% warm|upp till \d+\s*% varmt|\(max \d+%\)/i;
    const spotWorld = (): WorldConfig => ({ ...world(true), features: { [CAMP_AS_ACTION]: true, [BUILT_WARMTH]: true } });

    it('the sim English matches the catalog', () => {
      for (const site of Object.keys(SITES) as SiteId[]) {
        expect(SHELTER_TEXT.word[site]).toBe(EN[`shelter.word.${site}`]);
        expect(SHELTER_TEXT.why[site]).toBe(EN[`shelter.why.${site}`]);
        expect(SHELTER_TEXT.needs[site]).toBe(EN[`shelter.needs.${site}`]);
      }
      expect(siteShelterText('cave')).toBe('sheltered: rock at your back · a bed and a fire make it warm');
      expect(siteShelterText('hill')).toMatch(/^exposed: it needs a full shelter · /);
    });

    it('the Make camp options and the site cards (camp as an action), English and Swedish', () => {
      const s = createRegion1({ world: spotWorld() }, undefined, { id: 'w-astrid' });
      const spots = knownSpots(s);
      expect(spots.length).toBeGreaterThan(0);
      const group = ACTIONS.camp.options!(s, {}).find(g => g.key === 'spot')!;
      for (const c of group.choices) {
        expect(c.note).not.toMatch(NO_CEILING);
        const p = spots.find(x => x.id === c.value)!;
        expect(c.note).toContain(siteShelterText(p.kind));
        expect(choiceNote(s, group, c, en)).not.toMatch(NO_CEILING);
        expect(choiceNote(s, group, c, en)).toContain(en(`shelter.why.${p.kind}`));
        expect(choiceNote(s, group, c, sv)).not.toMatch(NO_CEILING);
        expect(choiceNote(s, group, c, sv)).toContain(sv(`shelter.why.${p.kind}`));
      }
      for (const t of [en, sv]) {
        const cards = spotsBlock(s, t);
        expect(cards).not.toMatch(NO_CEILING);
        expect(cards).toContain(t(`shelter.word.${spots[0].kind}`).toUpperCase());
        expect(cards).toContain(t(`shelter.needs.${spots[0].kind}`).slice(1));
        const land = campSpotsSection(s, t);
        expect(land).not.toMatch(NO_CEILING);
        expect(land).toContain(t(`shelter.word.${spots[0].kind}`));
      }
      expect(observe(s)).not.toMatch(NO_CEILING);
      expect(observe(s)).toMatch(/natural shelter/);
    });

    it('the four sites and the build\'s Location choice (camp as an action off), English and Swedish', () => {
      const s = chooseSite(runAction(createRegion1({ world: world(true) }, undefined, { id: 'w-astrid' }), 'scout'), 'tree');
      const build = ACTIONS.build.options!(s, {});
      const site = build.find(g => g.key === 'site');
      for (const g of build) for (const c of g.choices) {
        expect(c.note).not.toMatch(NO_CEILING);
        expect(c.note).not.toMatch(/holds \d+%/);
        expect(choiceNote(s, g, c, en)).not.toMatch(NO_CEILING);
        expect(choiceNote(s, g, c, sv)).not.toMatch(NO_CEILING);
        expect(choiceNote(s, g, c, sv)).not.toMatch(/håller \d+%/);
      }
      if (site) for (const c of site.choices) expect(choiceNote(s, site, c, sv)).toContain(sv(`shelter.why.${c.value as SiteId}`));
      for (const t of [en, sv]) {
        const cards = sitesBlock(s, t);
        expect(cards).not.toMatch(NO_CEILING);
        for (const id of Object.keys(SITES) as SiteId[]) expect(cards).toContain(t(`shelter.word.${id}`).toUpperCase());
      }
      expect(observe(s)).not.toMatch(NO_CEILING);
      expect(observe(s)).toContain('Sites by natural shelter: cave sheltered');
    });

    it('the API, in English and Swedish', () => {
      for (const lang of ['en', 'sv'] as const) {
        const g = startGame({ seed: 'warm-1763', lang, features: { [BUILT_WARMTH]: true } });
        expect(JSON.stringify(view(g))).not.toMatch(NO_CEILING);
      }
    });
  });

  describe('5. off or absent: today\'s ceilings, and the same seed the same run', () => {
    it('keeps the ceilings exactly, with the switch off or absent', () => {
      for (const sw of [false, 'absent'] as const) {
        expect(warmth(campAt('cave', sw))).toBeCloseTo(0.9 * 0.3);
        expect(warmth(campAt('hill', sw, WOOD_SHELTER))).toBeCloseTo(0.2);
        expect(warmth(campAt('tree', sw, { ...WOOD_SHELTER, ...BED }))).toBeCloseTo(0.7);
        // The bare cave in the rain has no roof, as before.
        const s = chooseSite(runAction(createRegion1({ world: world(sw) }, undefined, { id: 'w-astrid' }), 'scout'), 'tree');
        const loc = ACTIONS.build.options!(s, {}).find(g => g.key === 'site')!;
        expect(loc.choices.find(c => c.value === 'cave')!.note).toBe('up to 90% warm');
        expect(sitesBlock(s, en)).toContain('MAX 90% WARM');
        expect(observe(s)).toContain('(max 70%)');
      }
    });

    it('plays the same seed the same way, on, off and absent (off and absent alike)', () => {
      const plan: QueueItem[] = ['gather', 'wood', 'water'];
      const play = (sw: boolean | 'absent'): Region1State => {
        let s = campAt('river', sw, { day: 3 });
        for (let i = 0; i < 6; i++) s = runDay({ ...s, hoursToday: 0 }, plan).state;
        return s;
      };
      expect(play(true)).toEqual(play(true));
      const off = play(false);
      const absent = play('absent');
      expect({ ...absent, config: null }).toEqual({ ...off, config: null });
    });
  });
});
