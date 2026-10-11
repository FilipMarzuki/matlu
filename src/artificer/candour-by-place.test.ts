/**
 * Acceptance tests for #1619: candour shaped by place. A culture's candour (#1590: blunt, plain,
 * guarded) decides how openly its people voice a view; where they are now nudges it, one step at
 * most either way, so a culture still sounds like itself:
 *
 * - a hard place (poor, hard-pressed, a failed harvest, dear bread) or harsh weather (winter, a
 *   storm, snow) makes people blunter and simpler;
 * - a feared or strict lord makes them more guarded, a lax or well-liked one more open;
 * - unease after lords die and seats change hands (#1608 `unsettled`) makes them guarded with strangers.
 *
 * The voicing rule (`voicingGates`, `voicedAt`) takes the candour it's given, so the effective
 * candour goes in; free questions (#1611) use it, behind the `candour-by-place` rule switch.
 */

import { describe, it, expect } from 'vitest';
import { candourOf, effectiveCandour, matchLore, placeShift, voicingGates, type Place } from './culture-lore';
import { VILLAGE_PLACES, placeOfRegion, villagePlace } from './place-candour';
import { answerQuestion, matchFreeQuestion } from './knowledge-questions';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, questionPlace, runRoadAction, ROUTE, ROAD_SEASON, type RoadState } from './road';
import { FEATURES, featureOn, ruleFeatures } from './features';
import { personById } from './villages';
import type { RegionHistory } from './world/history-format';

const maren = personById('hf-maren')!;   // fieldborn: guarded
const tobin = personById('hf-tobin')!;   // caravan-folk: plain
const runa = personById('kg-runa')!;     // mountainhold: blunt

/** A wrong view held as most are (`held`), public: only the candour moves its gates. */
const wrongView = { topic: 'view' as const, truth: 'false' as const, sensitivity: 'public' as const, strength: 'held' as const };

describe('Given a culture’s candour, when the place is hard or the weather harsh, then its people are one step blunter (#1619)', () => {
  it('a hard region makes a plain person blunt, and a guarded one plain', () => {
    expect(effectiveCandour('plain', { hard: true })).toBe('blunt');
    expect(effectiveCandour('guarded', { hard: true })).toBe('plain');
  });

  it('winter, a storm or snow does the same', () => {
    for (const p of [{ season: 'winter' }, { weather: 'storm' }, { weather: 'snow' }] as Place[]) expect(effectiveCandour('plain', p)).toBe('blunt');
    // Spring, clear skies, rain: nothing to say about the weather.
    for (const p of [{ season: 'spring' }, { weather: 'clear' }, { weather: 'rain' }] as Place[]) expect(effectiveCandour('plain', p)).toBe('plain');
  });

  it('a hard place in winter is still one step, and the bluntest stay as blunt as they are', () => {
    expect(effectiveCandour('guarded', { hard: true, season: 'winter', weather: 'snow' })).toBe('plain');
    expect(effectiveCandour('blunt', { hard: true })).toBe('blunt');
  });

  it('the same person says a wrong view to less trust: Tobin (plain) opens at 25 at home, at 0 in a hard place', () => {
    expect(voicingGates(wrongView, effectiveCandour(candourOf(tobin.culture))).said).toBe(25);
    expect(voicingGates(wrongView, effectiveCandour(candourOf(tobin.culture), { hard: true })).said).toBe(0);
  });
});

describe('Given a culture’s candour, when the lord is feared or the region uneasy, then its people are one step more guarded (#1619)', () => {
  it('a feared or strict lord makes them guarded; a lax or well-liked one, open', () => {
    expect(effectiveCandour('plain', { lord: 'feared' })).toBe('guarded');
    expect(effectiveCandour('plain', { lord: 'strict' })).toBe('guarded');
    expect(effectiveCandour('plain', { lord: 'lax' })).toBe('blunt');
    expect(effectiveCandour('plain', { lord: 'liked' })).toBe('blunt');
  });

  it('unease after seats change hands makes them guarded with strangers', () => {
    expect(effectiveCandour('blunt', { uneasy: true })).toBe('plain');
  });

  it('a feared lord in an uneasy region is still one step; the most guarded stay as guarded as they are', () => {
    expect(effectiveCandour('blunt', { lord: 'feared', uneasy: true })).toBe('plain');
    expect(effectiveCandour('guarded', { lord: 'feared' })).toBe('guarded');
  });

  it('a hard place under a feared lord: the two cancel, and they sound like themselves', () => {
    expect(placeShift({ hard: true, lord: 'feared' })).toBe(0);
    expect(effectiveCandour('plain', { hard: true, lord: 'feared' })).toBe('plain');
  });

  it('the same person keeps a view back longer: Tobin opens at 25 at home, at 50 under a feared lord', () => {
    expect(voicingGates(wrongView, effectiveCandour(candourOf(tobin.culture), { lord: 'feared' })).said).toBe(50);
  });

  it('no place, or an empty one, leaves the culture’s candour as it is', () => {
    for (const c of ['blunt', 'plain', 'guarded'] as const) {
      expect(effectiveCandour(c)).toBe(c);
      expect(effectiveCandour(c, {})).toBe(c);
    }
  });
});

describe('Given a person asked a question, when a place is given, then matchLore voices it at their effective candour (#1619)', () => {
  // Maren is fieldborn (guarded). Her People's view of the Fae is a rumour she holds: at home it
  // opens at 50; in a hard place she's plain, and says it at 25.
  const q = 'What do your people think of the Fae?';

  it('is blunter in a hard place', () => {
    expect(matchLore(q, maren, 25)).toMatchObject({ claims: [], holdingBack: true, opensAt: 50 });
    const hard = matchLore(q, maren, 25, { hard: true })!;
    expect(hard.claims.map(c => c.id)).toEqual(['people:Markfolk/view:Fae/0']);
    expect(hard.voicing).toEqual({ 'people:Markfolk/view:Fae/0': 'hedged' });
  });

  it('is more guarded under a strict lord: Runa (blunt) hedges her firm view of goblins to a stranger', () => {
    const g = 'What do you think of goblins?';
    expect(matchLore(g, runa, 0)!.voicing).toEqual({ 'culture:mountainhold/view:Goblins/0': 'plain' });
    expect(matchLore(g, runa, 0, { lord: 'strict' })!.voicing).toEqual({ 'culture:mountainhold/view:Goblins/0': 'hedged' });
  });

  it('and answerQuestion says it the same way, its gate the effective one', () => {
    const topic = 'group:Markfolk/view/group:Fae';
    expect(answerQuestion(maren, topic, 25, []).kind).toBe('not-yet');
    const told = answerQuestion(maren, topic, 25, [], { place: { hard: true } });
    expect(told.kind).toBe('told');
    expect(told.kind === 'told' && told.answer.at).toBe(25);
    expect(told.line).toContain('Between us:');
  });
});

describe('Given a region from a told history, when its state is read as a place, then hardship, lords and unease come from it (#1619)', () => {
  /** A region getting by: nothing about it to nudge anyone. */
  const base: RegionHistory = {
    id: 'ashby-country', name: 'the Ashby country', centre: { id: 'p1', name: 'Ashby' },
    provinces: [
      { id: 'p1', name: 'Ashby', livelihood: 'farming', secondary: [], founding: 'farming', wealth: 0.5 },
      { id: 'p2', name: 'Lowmere', livelihood: 'fishing', secondary: [], founding: 'fishing', wealth: 0.5 },
    ],
    primary: 'farming', venture: { kind: 'mill', province: 'Ashby', state: 'steady', since: 100 },
    prosperity: 0.5, price: 1, harvest: 'fair', levy: 0, tax: 0.35, unsettled: 0,
    leadingHouse: null, lords: [], feuds: [], alliances: [], roads: [], lines: [],
  };

  it('a region getting by is no place in particular', () => {
    expect(placeOfRegion(base)).toEqual({});
    expect(placeShift(placeOfRegion(base))).toBe(0);
  });

  it('hard times, dear bread or a poor harvest make it a hard place; so does a place on hard times in a region that gets by', () => {
    expect(placeOfRegion({ ...base, prosperity: 0.3 }).hard).toBe(true);
    expect(placeOfRegion({ ...base, price: 1.5 }).hard).toBe(true);
    expect(placeOfRegion({ ...base, harvest: 'failed' }).hard).toBe(true);
    expect(placeOfRegion({ ...base, harvest: 'poor' }).hard).toBe(true);
    const poorLowmere = { ...base, provinces: [base.provinces[0], { ...base.provinces[1], wealth: 0.25 }] };
    expect(placeOfRegion(poorLowmere, 'Lowmere').hard).toBe(true);
    expect(placeOfRegion(poorLowmere, 'p1').hard).toBeUndefined();
  });

  it('heavy dues make its lords strict, light ones lax', () => {
    expect(placeOfRegion({ ...base, tax: 0.5 }).lord).toBe('strict');
    expect(placeOfRegion({ ...base, tax: 0.2 }).lord).toBe('lax');
  });

  it('an unsettled region is uneasy, from where its facts call it so', () => {
    expect(placeOfRegion({ ...base, unsettled: 0.3 }).uneasy).toBe(true);
    expect(placeOfRegion({ ...base, unsettled: 0.1 }).uneasy).toBeUndefined();
  });

  it('so the same person is blunter in a hard region, and more guarded in an uneasy one', () => {
    expect(effectiveCandour('plain', placeOfRegion({ ...base, prosperity: 0.3 }))).toBe('blunt');
    expect(effectiveCandour('plain', placeOfRegion({ ...base, unsettled: 0.3 }))).toBe('guarded');
  });
});

describe('Given the caravan road, when the switch is on, then each village’s place nudges how its people speak (#1619)', () => {
  it('is a rules switch that arrives with this change: off in runs from before it, on in a new game', () => {
    const f = FEATURES.find(x => x.id === 'candour-by-place')!;
    expect(f).toMatchObject({ kind: 'rules', absent: false, default: true, issue: 1619 });
    expect(featureOn(undefined, 'candour-by-place')).toBe(false);
    expect(ruleFeatures()['candour-by-place']).toBe(true);
  });

  it('knows each road village’s place, with the road’s season on top', () => {
    expect(Object.keys(VILLAGE_PLACES).sort()).toEqual(['hollowford', 'kestrel-gate', 'saltmere']);
    expect(villagePlace('hollowford', ROAD_SEASON)).toMatchObject({ hard: true, season: ROAD_SEASON });
    expect(villagePlace('kestrel-gate', ROAD_SEASON)).toMatchObject({ lord: 'strict' });
    // On the wagon: only the season.
    expect(villagePlace(null, ROAD_SEASON)).toEqual({ season: ROAD_SEASON });
  });
});

/** The switches a new game has, with this one set as given. */
const switches = (on: boolean): Record<string, boolean> => ({ ...ruleFeatures(), 'candour-by-place': on });

/** A Warden on the caravan road at Hollowford (the first village), as knowledge-questions.test.ts builds one. */
function atHollowford(features: Record<string, boolean>, trust: Record<string, number>): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-candour', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10, rations: 6 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  const village = ROUTE.findIndex(l => l.kind === 'village');
  let r = createRoad(from);
  for (let i = 0; i < 10 && r.leg < village; i++) r = endRoadDay(r);
  return { ...r, focus: null, trust: { ...r.trust, ...trust }, features };
}

describe('Given Maren at Hollowford asked a free question at trust 25, when candour-by-place is on, then she is blunter (#1619)', () => {
  const q = 'What do your people think of the Fae?';
  const written = (before: RoadState, after: RoadState): string => after.log.slice(before.log.length).map(l => l.text).join(' ');

  it('on: Hollowford is hard, so she says it, hedged', () => {
    const before = atHollowford(switches(true), { 'hf-maren': 25 });
    expect(questionPlace(before)).toMatchObject({ hard: true });
    const topic = matchFreeQuestion('hf-maren', q, [], before.features)!;
    const after = runRoadAction(before, `question:hf-maren:${topic}`);
    expect(written(before, after)).toContain('Between us: A fae deal is a trick');
  });

  it('off (and in every run from before the switch): not yet, as before', () => {
    const before = atHollowford(switches(false), { 'hf-maren': 25 });
    expect(questionPlace(before)).toBeUndefined();
    const topic = matchFreeQuestion('hf-maren', q, [], before.features)!;
    const after = runRoadAction(before, `question:hf-maren:${topic}`);
    expect(written(before, after)).toMatch(/Ask me again when I know you better/);
  });

  it('on the wagon in spring, nobody is blunter or more guarded than their culture', () => {
    expect(placeShift(villagePlace(null, ROAD_SEASON))).toBe(0);
  });
});
