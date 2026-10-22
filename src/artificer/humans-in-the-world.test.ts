/**
 * Humans in the world (#1631): the acceptance tests, one block per "Done when" line of the issue,
 * each written as Given / When / Then.
 *
 * 1. Generated Reaches can hold Riksfolk and Strandfolk where the cultures say so (and, as odd
 *    patches, now and then where they don't: the owner's "odd patches of extra humans").
 * 2. At least one human on the road, consistent with their village's culture and lore (Maren of
 *    Hollowford, Riksfolk, behind the `humans-on-the-road` switch).
 * 3. Asking about "humans" gives views of both human Peoples.
 * 4. Hollowford lists trade at the ford as a secondary trade (behind `village-economies`).
 * 5. Old runs replay the same: without the switch (a run from before it), Maren is Markfolk and the
 *    human topics don't exist.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FEATURES, featureOn } from './features';
import { PEOPLES_OF, ODD_PATCHES, REACH_CULTURES, REACH_PEOPLES, racesOf, type ReachCulture } from './world/peoples';
import { generateReach } from './world/reach';
import { provincesOf } from './world/provinces';
import { reachSpec } from './world/history';
import { seedOf } from './rng';
import { VILLAGES, asPlayed, personById } from './villages';
import { mentionsIn, topicsOpen } from './topics';
import { matchLore } from './culture-lore';
import { loreClaims, loreKeyOf, matchFreeQuestion, questionAbout } from './knowledge-questions';
import { VILLAGE_ECONOMY, arrivalLines, localMarket, tradesOf } from './economy';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, ROUTE, type RoadState } from './road';

const HUMANS = { 'humans-on-the-road': true };
const NO_HUMANS = { 'humans-on-the-road': false };
const ALL_ON = { 'free-questions': true, 'knowledge-questions': true, ...HUMANS };
const ALL_ON_NO_HUMANS = { 'free-questions': true, 'knowledge-questions': true, ...NO_HUMANS };

const CULTURES = JSON.parse(readFileSync(join(__dirname, '../../macro-world/cultures.json'), 'utf8')) as { cultures: { id: string; racePreferences: Record<string, number> }[] };

/** A thaw survivor at Hollowford, with these rule switches in their world. */
function atHollowford(features: Record<string, boolean>): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-humans', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = {
    ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10, rations: 6 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
    config: { ...s.config, world: { ...s.config.world, features } },
  };
  const village = ROUTE.findIndex(l => l.kind === 'village');
  let r = createRoad(from);
  for (let i = 0; i < 10 && r.leg < village; i++) r = endRoadDay(r);
  return r;
}

describe('1. Given the Reach generator, when it seats its houses, then humans live where the cultures say (#1631)', () => {
  it('Given cultures.json, when the Reach reads its cultures, then each one\'s Peoples and weights are cultures.json\'s', () => {
    for (const c of REACH_CULTURES) {
      const prefs = CULTURES.cultures.find(x => x.id === c.id)!.racePreferences;
      expect(PEOPLES_OF[c.id as ReachCulture], c.id).toEqual(Object.entries(prefs));
    }
    // Fieldborn, ridgefolk and wallborn hold Riksfolk; the engine knows both human Peoples.
    for (const c of ['fieldborn', 'ridgefolk', 'wallborn'] as const) expect(PEOPLES_OF[c].some(([p]) => p === 'Riksfolk'), c).toBe(true);
    expect(REACH_PEOPLES.map(r => r.id)).toEqual(expect.arrayContaining(['Riksfolk', 'Strandfolk']));
  });

  it('Given a culture with no humans, when a house is drawn, then the odd patches can make it human; a culture with humans keeps its own weights', () => {
    expect(racesOf('mountainhold')).toEqual([...PEOPLES_OF.mountainhold, ...ODD_PATCHES]);
    expect(racesOf('waterstead')).toEqual([...PEOPLES_OF.waterstead, ...ODD_PATCHES]);
    expect(racesOf('fieldborn')).toBe(PEOPLES_OF.fieldborn);
  });

  describe('Given forty seeds, when their Reaches are generated', () => {
    let houses: { culture: string; race: string }[] = [];
    beforeAll(() => {
      houses = Array.from({ length: 40 }, (_, i) => {
        const reach = generateReach(seedOf(`w-humans-${i}`));
        return reachSpec(reach, provincesOf(reach)).dynasties.map(d => ({ culture: d.culture ?? '', race: d.race ?? '' }));
      }).flat();
    }, 120_000);

    it('then human houses are seated in the cultures that hold humans, and only Peoples a culture allows', () => {
      expect(houses.some(h => h.race === 'Riksfolk' && ['fieldborn', 'ridgefolk', 'wallborn'].includes(h.culture))).toBe(true);
      for (const h of houses) expect(racesOf(h.culture as ReachCulture).map(([p]) => p), `${h.culture} ${h.race}`).toContain(h.race);
    });

    it('then a few houses are humans in unexpected places (the odd patches), but not many', () => {
      const unexpected = houses.filter(h => ['mountainhold', 'waterstead'].includes(h.culture));
      const human = unexpected.filter(h => h.race === 'Riksfolk' || h.race === 'Strandfolk');
      expect(human.length).toBeGreaterThan(0);
      expect(human.length).toBeLessThan(unexpected.length / 4);
    });
  });
});

describe('2. Given the humans-on-the-road switch, when the road is played, then Maren of Hollowford is Riksfolk (#1631)', () => {
  const maren = personById('hf-maren')!;

  it('Given the feature registry, then the switch is an experimental rule feature, on in new games and off for runs from before it', () => {
    expect(FEATURES.find(f => f.id === 'humans-on-the-road')).toMatchObject({ stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1631 });
  });

  it('Given the switch on, when Maren is played, then she is Riksfolk, and her culture and village hold Riksfolk', () => {
    expect(asPlayed(maren, HUMANS).people).toBe('Riksfolk');
    expect(asPlayed(maren, HUMANS)).toMatchObject({ id: maren.id, culture: 'fieldborn', role: maren.role, lore: maren.lore, need: maren.need });
    expect(CULTURES.cultures.find(c => c.id === 'fieldborn')!.racePreferences.Riksfolk).toBeGreaterThan(0);
    expect(VILLAGES.hollowford.cultures).toContain('fieldborn');
    // Her own last line is the Realm's northern hill farms, losing fields "one fence at a time".
    expect(maren.lore.at(-1)!.text).toMatch(/one fence at a time/);
  });

  it('Given the switch on, when you meet her, then the Riksfolk open as a topic; and road lore naming them is heard', () => {
    expect(topicsOpen({ stores: {}, trust: { 'hf-maren': 10 }, features: HUMANS })).toContain('group:Riksfolk');
    expect(topicsOpen({ stores: {}, trust: { 'hf-maren': 10 }, features: HUMANS })).not.toContain('group:Markfolk');
    expect(mentionsIn('Riksfolk carts come with papers for everything.', HUMANS)).toContain('group:Riksfolk');
  });

  it('Given the switch on, when she\'s asked about her people, then she answers for the Riksfolk, on the road too', () => {
    const key = matchFreeQuestion('hf-maren', 'What do your people value?', [], ALL_ON)!;
    expect(key).toMatch(/group:Riksfolk/);
    const r = atHollowford(ALL_ON);
    const after = runRoadAction(r, `question:hf-maren:${key}`);
    expect(after.log.at(-1)!.text).toMatch(/Maren: "/);
    expect(after.log.at(-1)!.text).toMatch(/charter/);
  });
});

describe('3. Given a question about "humans", when it is matched, then it answers for both human Peoples (#1631)', () => {
  const orrin = personById('hf-orrin')!;
  const ofIds = (cs: readonly { of?: { id: string } }[]) => [...new Set(cs.map(c => c.of?.id))];

  it('Given nobody in particular, when asked what humans value, then the Riksfolk\'s and the Strandfolk\'s values answer', () => {
    const m = matchLore('What do humans value?')!;
    expect([...new Set(m.claims.map(c => c.scope.id))]).toEqual(['Riksfolk', 'Strandfolk']);
    expect(m.claims.every(c => c.topic === 'values')).toBe(true);
  });

  it('Given an outsider (Orrin), when asked what he thinks of humans, then one holder\'s views of both, and the lore key finds them again', () => {
    const m = matchLore('What do you think of humans?', orrin)!;
    expect(ofIds(m.claims)).toEqual(['Riksfolk', 'Strandfolk']);
    expect(new Set(m.claims.map(c => c.scope.id)).size).toBe(1);
    const key = loreKeyOf(m.claims)!;
    expect(key).toMatch(/\/view\/group:Riksfolk\+group:Strandfolk$/);
    expect(loreClaims(orrin, key)!.map(c => c.id)).toEqual(m.claims.map(c => c.id));
    expect(questionAbout(key)).toBe('what their people think of the Riksfolk and the Strandfolk');
  });

  it('Given a People named first, when asked what they think of humans, then their views of both', () => {
    expect(ofIds(matchLore('What do the Bergfolk think of humans?')!.claims)).toEqual(['Riksfolk', 'Strandfolk']);
  });

  it('Given a human (Maren, with humans on the road), when asked what humans value, then she speaks for the Riksfolk only', () => {
    const m = matchLore('What do humans value?', asPlayed(personById('hf-maren')!, HUMANS))!;
    expect([...new Set(m.claims.map(c => c.scope.id))]).toEqual(['Riksfolk']);
  });

  it('Given a free question on the road, when it names humans, then it plays as a lore key for both', () => {
    expect(matchFreeQuestion('hf-orrin', 'What do you think of humans?', [], ALL_ON)).toMatch(/group:Riksfolk\+group:Strandfolk/);
  });
});

describe('4. Given Hollowford\'s economy, when it is read, then the trade at the ford is a secondary trade (#1631)', () => {
  it('Given the written economy, then Hollowford lives on farming, with herding and trading besides, and says so', () => {
    expect(VILLAGE_ECONOMY.hollowford.dominant).toBe('farming');
    expect(tradesOf(VILLAGE_ECONOMY.hollowford)).toEqual(['farming', 'herding', 'trading']);
    expect(VILLAGE_ECONOMY.hollowford.story).toMatch(/the trade at the ford/);
    expect(arrivalLines('hollowford')).toContain(VILLAGE_ECONOMY.hollowford.story);
  });

  it('Given one trader at the ford, when its market is read, then it is not a market town (Tobin\'s prices stay a village trader\'s)', () => {
    expect(localMarket('hollowford')!.market).toBe(false);
    expect(localMarket('kestrel-gate')!.market).toBe(true);
  });

  it('Given village economies on, when the caravan reaches Hollowford, then the arrival tells of the ford trade; off, it doesn\'t', () => {
    const told = (r: RoadState) => r.log.some(l => l.text.includes('the trade at the ford'));
    expect(told(atHollowford({ 'village-economies': true }))).toBe(true);
    expect(told(atHollowford({ 'village-economies': false }))).toBe(false);
  });
});

describe('5. Given a run from before the switch, when it replays, then the road is as it was (#1631)', () => {
  const maren = personById('hf-maren')!;

  it('Given no switch saved, then humans on the road are off, and Maren is the Markfolk she was, the same person', () => {
    expect(featureOn(undefined, 'humans-on-the-road')).toBe(false);
    expect(maren.people).toBe('Markfolk');
    expect(asPlayed(maren, undefined)).toBe(maren);
    expect(asPlayed(maren, NO_HUMANS)).toBe(maren);
  });

  it('Given the switch off, then meeting her opens the Markfolk, and road lore naming the human Peoples opens nothing new', () => {
    expect(topicsOpen({ stores: {}, trust: { 'hf-maren': 10 } })).toContain('group:Markfolk');
    expect(topicsOpen({ stores: {}, trust: { 'hf-maren': 10 } })).not.toContain('group:Riksfolk');
    expect(mentionsIn('Riksfolk carts come with papers for everything.')).toEqual([]);
    expect(mentionsIn('Strandfolk boats take the grain to market.', NO_HUMANS)).toEqual([]);
  });

  it('Given the switch off, when she\'s asked about her people, then she answers for the Markfolk, as before', () => {
    expect(matchFreeQuestion('hf-maren', 'What do your people value?', [], ALL_ON_NO_HUMANS)).toMatch(/group:Markfolk/);
  });

  it('Given the same moves and switches, when the road is played twice, then it plays the same', () => {
    const play = () => runRoadAction(atHollowford(ALL_ON), 'question:hf-orrin:culture:ridgefolk/view/group:Riksfolk+group:Strandfolk');
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});
