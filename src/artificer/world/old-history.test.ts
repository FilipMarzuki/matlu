/**
 * Acceptance tests for #1650: old history bends with age, as rumours do, by who remembers it.
 *
 * The owner's rule (issue comment, 2026-10-12): living memory is measured in the holders'
 * lifetimes; drift grows with the retellings (the event's age over the holders' generation); a
 * mixed place keeps one telling per People, and they can contradict each other; culture bias
 * (claims.ts TELLING_BENDS) sets the direction, lifespan how much; lifespans come from canon.
 *
 * The acceptance scenarios come first (Given/When/Then), then what holds them up: the lifespans
 * and their sources, the slots, the facts and the switch. The told histories are built once, in
 * `beforeAll`, because telling one runs the engine's 150 years.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NEUTRAL_BIOLOGY } from '../../../storytelling/biology';
import { featureById, featureOn, ruleFeatures } from '../features';
import { REACH_CULTURES } from './peoples';
import { runHistory, LIVING_MEMORY, type ReachHistory } from './history';
import { remembered } from './remembered';
import { regionalFacts, factsOfRegion } from './regional-facts';
import { LOCAL_YEARS } from './local-history';
import {
  bendOld, generationOf, lifespanEntries, lifespanOf, livingMemoryOf, oldTellings, regionHolders, retellingsOf, slotsOf, villageHolders,
  HUMAN_LIFESPAN, type Holder,
} from './old-history';
import type { People } from '../villages';

const root = join(__dirname, '..', '..', '..');
const ON = ruleFeatures();
const OFF = { ...ON, 'old-history-drift': false };
const SEEDS = [1, 2, 3, 7, 11, 42];

let histories: ReachHistory[] = [];
beforeAll(() => { histories = SEEDS.map(s => runHistory(s)); }, 120_000);

/**
 * Every old event in the histories, regional and of a province, with the places it can blur
 * among (its region's lands) and an id to seed it by. The regional legends are mostly famines,
 * plagues and seizures told without a toll; the province lines carry the death tolls.
 */
function oldLines(): { id: string; text: string; ago: number; places: string[] }[] {
  return histories.flatMap(h => [
    ...h.regions.flatMap(r => r.lines.map((l, k) => ({
      id: `region:${r.id}:${l.year}:${k}`, text: l.text, ago: h.year - l.year, places: r.provinces.map(p => p.name),
    }))),
    ...h.provinces.flatMap(p => p.lines.map((l, k) => ({
      id: `history:${p.id}:${l.year}:${k}`, text: l.text, ago: h.year - l.year,
      places: h.regions.find(r => r.provinces.some(q => q.id === p.id))?.provinces.map(q => q.name) ?? [p.name],
    }))),
  ]).filter(l => l.ago > LIVING_MEMORY);
}

/** The people-counts in a text, in order (the `{n}` slots). */
const counts = (text: string, places: readonly string[]): number[] =>
  slotsOf(text, places).slots.flatMap(s => (s.kind === 'n' ? [s.value] : []));

const PLAGUE = 'A pestilence broke out near Hollowford and swept 7 provinces, killing 222. Among the dead were 5 of noble blood.';
const PLACES = ['Hollowford', 'Ravenford', 'Ashwater'];

describe('#1650 acceptance', () => {
  describe('1. An old event told by a short-lived and a long-lived holder differs, and the long-lived one is accurate or close', () => {
    it('Given a plague 120 years ago, When a Riksfolk (75 years) and a Bergfolk (240) village tell it, Then the human telling has been retold several times and bent, and the Bergfolk one is the eyewitnesses\' own, word for word', () => {
      const human = bendOld('test:plague', PLAGUE, 120, { people: 'Riksfolk', culture: 'fieldborn' }, PLACES);
      const dvergar = bendOld('test:plague', PLAGUE, 120, { people: 'Bergfolk', culture: 'ridgefolk' }, PLACES);
      expect(retellingsOf(120, 'Riksfolk')).toBeGreaterThanOrEqual(4);
      expect(retellingsOf(120, 'Bergfolk')).toBe(0);
      expect(dvergar.text).toBe(PLAGUE);
      expect(human.text).not.toBe(PLAGUE);
      // The death toll only grows in the retelling.
      expect(counts(human.text, PLACES)[0]).toBeGreaterThan(222);
    });

    it('Given every old event of six histories, When Lövfolk, Bergfolk and Riksfolk tell them, Then the Lövfolk are always exact, the Bergfolk retell each at most once, and the humans bend far more of them', () => {
      const lines = oldLines();
      expect(lines.length).toBeGreaterThan(20);
      let humanBent = 0, bergBent = 0;
      for (const l of lines) {
        expect(bendOld(l.id, l.text, l.ago, { people: 'Lövfolk', culture: 'grovekin' }, l.places).text).toBe(l.text);
        expect(retellingsOf(l.ago, 'Bergfolk')).toBeLessThanOrEqual(1);
        if (bendOld(l.id, l.text, l.ago, { people: 'Bergfolk', culture: 'ridgefolk' }, l.places).text !== l.text) bergBent++;
        if (bendOld(l.id, l.text, l.ago, { people: 'Riksfolk', culture: 'ridgefolk' }, l.places).text !== l.text) humanBent++;
      }
      expect(humanBent).toBeGreaterThan(bergBent * 2);
    });
  });

  describe('2. Two villages of different cultures bend an old event in their bias\'s direction', () => {
    it('Given the same old events told by Riksfolk of a loss-averse culture (fieldborn) and of a fatalist one (ridgefolk), When both retell them as often, Then the fieldborn count is never smaller, often larger, and neither falls below the truth', () => {
      let larger = 0, compared = 0;
      for (const l of oldLines()) {
        const truth = counts(l.text, l.places);
        if (!truth.length) continue;
        const worse = counts(bendOld(l.id, l.text, l.ago, { people: 'Riksfolk', culture: 'fieldborn' }, l.places).text, l.places);
        const shrugged = counts(bendOld(l.id, l.text, l.ago, { people: 'Riksfolk', culture: 'ridgefolk' }, l.places).text, l.places);
        truth.forEach((n, i) => {
          expect(shrugged[i]).toBeGreaterThanOrEqual(n);
          expect(worse[i]).toBeGreaterThanOrEqual(shrugged[i]);
          compared++;
          if (worse[i] > shrugged[i]) larger++;
        });
      }
      expect(compared).toBeGreaterThan(5);
      expect(larger / compared).toBeGreaterThan(0.5);
    });
  });

  describe('3. Years never change', () => {
    it('Given a line full of years, ages and durations beside a death toll, When it is retold twenty times over, Then every year, age and duration reads as it did, and only the toll has grown', () => {
      const text = 'In year 12 the siege of Ravenford ended — 3 years in the cold; the library founded by house Hedlund in 31 burned, killing 40. Ivar of Hedlund died at the age of 79, and a child of 1 was crowned.';
      const t = slotsOf(text, PLACES);
      expect(t.slots.filter(s => s.kind === 'n').map(s => s.kind === 'n' && s.value)).toEqual([40]);
      const bent = bendOld('test:years', text, 500, { people: 'Riksfolk', culture: 'fieldborn' }, PLACES).text;
      for (const kept of ['In year 12', '3 years in the cold', 'in 31', 'at the age of 79', 'a child of 1']) expect(bent).toContain(kept);
      expect(counts(bent, PLACES)[0]).toBeGreaterThan(40);
    });

    it('Given every old fact of six histories, When old history bends, Then each keeps its "N years ago, in year Y:" and every number that isn\'t a count, in order', () => {
      for (const h of histories) {
        const off = regionalFacts(h, OFF);
        const on = regionalFacts(h, ON);
        for (const f of on) {
          const base = off.find(o => f.id === o.id || f.id.startsWith(`${o.id}:told-by:`))!;
          expect(base).toBeDefined();
          const prefix = base.text.slice(0, base.text.indexOf(': ') + 2);
          expect(f.text.startsWith(prefix)).toBe(true);
          expect(f.year).toBe(base.year);
          const fixed = (s: string) => slotsOf(s, h.provinces.map(p => p.name)).parts.join(' ').match(/\d[\d,.]*/g) ?? [];
          expect(fixed(f.text)).toEqual(fixed(base.text));
        }
      }
    });
  });

  describe('4. Living-memory events never bend', () => {
    it('Given an event within a People\'s living memory, When any culture of that People tells it, Then it reads as it happened', () => {
      for (const people of ['Riksfolk', 'Strandfolk', 'Deepwalkers', 'Markfolk', 'Bergfolk', 'Lövfolk'] as People[]) {
        const ago = Math.floor(livingMemoryOf(people));
        for (const culture of REACH_CULTURES.map(c => c.id)) expect(bendOld('test:recent', PLAGUE, ago, { people, culture }, PLACES).text).toBe(PLAGUE);
      }
    });

    it('Given six histories, When old history bends, Then every telling held by someone whose People saw it is word for word the event, true, and every event within LIVING_MEMORY that all its holders saw is told exactly as before', () => {
      for (const h of histories) {
        const offFacts = regionalFacts(h, OFF);
        for (const f of regionalFacts(h, ON)) {
          if (!f.heldBy) { expect(offFacts).toContainEqual(f); continue; }
          if (f.heldBy.some(x => x.retellings === 0)) {
            expect(f.truth).toBe('true');
            expect(f.text).toBe(offFacts.find(o => o.id === f.id.split(':told-by:')[0])!.text);
          } else expect(f.truth).toBe('rumour');
        }
      }
    });

    it('Given any People, When it tells its village\'s local history (the last LOCAL_YEARS), Then that is within its living memory, so local history never bends', () => {
      for (const e of lifespanEntries()) expect(livingMemoryOf(e.people)).toBeGreaterThanOrEqual(LOCAL_YEARS);
    });
  });

  describe('5. The same event told twice reads the same', () => {
    it('Given one history, When the road villages and the regions tell their old history twice, and once more from a kept copy, Then every fact is the same', () => {
      const h = histories[0];
      expect(remembered(h, undefined, undefined, ON)).toEqual(remembered(h, undefined, undefined, ON));
      expect(remembered(JSON.parse(JSON.stringify(h)), undefined, undefined, ON)).toEqual(remembered(h, undefined, undefined, ON));
      expect(regionalFacts(h, ON)).toEqual(regionalFacts(h, ON));
      expect(bendOld('test:plague', PLAGUE, 120, { people: 'Riksfolk', culture: 'fieldborn' }, PLACES)).toEqual(bendOld('test:plague', PLAGUE, 120, { people: 'Riksfolk', culture: 'fieldborn' }, PLACES));
    });
  });

  describe('6. A mixed village keeps both tellings, and they can contradict each other', () => {
    it('Given Hollowford (a human elder, a goblin trader, a Lövfolk healer, a Bergfolk smith) and a plague 120 years ago, When it is told there, Then the Lövfolk and Bergfolk keep the true telling and the humans and goblins a bent one, side by side', () => {
      const holders = villageHolders('hollowford', ON);
      expect(holders.map(x => x.people).sort()).toEqual(['Bergfolk', 'Goblins', 'Lövfolk', 'Riksfolk']);
      const told = oldTellings('test:plague', PLAGUE, 120, holders, PLACES)!;
      expect(told.length).toBeGreaterThanOrEqual(2);
      const accurate = told.find(t => t.text === PLAGUE)!;
      expect(accurate.truth).toBe('true');
      expect(accurate.heldBy.map(x => x.people).sort()).toEqual(['Bergfolk', 'Lövfolk']);
      expect(told.filter(t => t.text !== PLAGUE).every(t => t.truth === 'rumour')).toBe(true);
      // Nobody to tell it, or everyone saw it: told as the history tells it.
      expect(oldTellings('test:plague', PLAGUE, 120, [], PLACES)).toBeNull();
      expect(oldTellings('test:plague', PLAGUE, 30, holders, PLACES)).toBeNull();
      // Every holder's telling is there once.
      expect(told.flatMap(t => t.heldBy.map(x => x.people)).sort()).toEqual(['Bergfolk', 'Goblins', 'Lövfolk', 'Riksfolk']);
    });
  });
});

describe('Lifespans come from canon (#1650)', () => {
  it('has one for every People, each citing words its source really holds', () => {
    const peoples: (People | 'Wildkin')[] = ['Bergfolk', 'Lövfolk', 'Markfolk', 'Viddfolk', 'Steinfolk', 'Pandor', 'Deepwalkers', 'Merfolk', 'Goblins', 'Fae', 'Giants', 'Dragons', 'Everstill', 'Constructs', 'Remnants', 'Wildkin', 'Riksfolk', 'Strandfolk'];
    expect(lifespanEntries().map(e => e.people).sort()).toEqual([...peoples].sort());
    for (const e of lifespanEntries()) {
      const file = readFileSync(join(root, e.source.split(' › ')[0]), 'utf8').replace(/\\'/g, "'");
      expect(file, `${e.people}: ${e.source}`).toContain(e.quote);
      expect(e.unbounded ? e.years === null : typeof e.years === 'number' && e.years > 0).toBe(true);
    }
  });

  it('lists the Peoples canon gives no figure for, on the story engine\'s human baseline', () => {
    expect(HUMAN_LIFESPAN).toBe(NEUTRAL_BIOLOGY.lifespan);
    expect(lifespanEntries().filter(e => e.default).map(e => e.people).sort()).toEqual(['Merfolk', 'Wildkin']);
    for (const e of lifespanEntries().filter(e => e.default)) expect(e.years).toBe(HUMAN_LIFESPAN);
  });

  it('scales living memory and a generation by lifespan, so humans keep the chronicle\'s LIVING_MEMORY and the unbounded never forget', () => {
    expect(livingMemoryOf('Riksfolk')).toBe(LIVING_MEMORY);
    expect(generationOf('Riksfolk')).toBe(LIVING_MEMORY / 2);
    expect(livingMemoryOf('Bergfolk')).toBeCloseTo(LIVING_MEMORY * 240 / 75);
    expect(lifespanOf('Dragons')).toBeNull();
    expect(livingMemoryOf('Dragons')).toBe(Infinity);
    expect(retellingsOf(10_000, 'Dragons')).toBe(0);
    // Retellings: none within living memory, then one per generation of tellers after it.
    expect(retellingsOf(40, 'Riksfolk')).toBe(0);
    expect(retellingsOf(41, 'Riksfolk')).toBe(1);
    expect(retellingsOf(60, 'Riksfolk')).toBe(1);
    expect(retellingsOf(61, 'Riksfolk')).toBe(2);
    expect(retellingsOf(150, 'Riksfolk')).toBe(6);
  });
});

describe('Slots: {n}, {place} and {who} (#1650)', () => {
  it('reads people-counts, places and named people out of the engine\'s words, and puts them back word for word', () => {
    const t = slotsOf(PLAGUE, PLACES);
    expect(t.template).toBe('A pestilence broke out near {place} and swept 7 provinces, killing {n}. Among the dead were {n} of noble blood.');
    expect(t.slots).toEqual([{ kind: 'place', value: 'Hollowford' }, { kind: 'n', value: 222, grouped: false }, { kind: 'n', value: 5, grouped: false }]);
    const who = slotsOf('Vemund II of Deepcarve died, and Ketil V of Deepcarve took up Deep Hall of Fernford and 2 other seats.', ['Fernford']);
    expect(who.template).toBe('{who} died, and {who} took up Deep Hall of Fernford and 2 other seats.');
    expect(who.slots[0]).toMatchObject({ kind: 'who', given: 'Vemund', numeral: 'II', house: 'Deepcarve' });
    // A place in a title ("of Fernford") or a region's name ("the Ashwater country") isn't moved.
    expect(slotsOf('Plague swept through the Ashwater country, 2 of its 5 lands.', PLACES).slots).toEqual([]);
    expect(slotsOf('A war-band of 1,200 riders crashed into Ravenford.', PLACES).slots).toEqual([{ kind: 'n', value: 1200, grouped: true }, { kind: 'place', value: 'Ravenford' }]);
  });

  it('swaps a name only for someone else of the same house, from the same culture\'s names', () => {
    const text = 'Ivar of Hedlund was murdered at Ravenford.';
    const fieldborn = REACH_CULTURES.find(c => c.id === 'fieldborn')!;
    let swapped = 0;
    for (let i = 0; i < 40; i++) {
      const bent = bendOld(`test:who:${i}`, text, 150, { people: 'Riksfolk', culture: 'fieldborn' }, PLACES).text;
      const m = bent.match(/^(\S+) of Hedlund was murdered at (\S+)\.$/)!;
      expect(m).not.toBeNull();
      expect(fieldborn.namesMale).toContain(m[1]);
      if (m[1] !== 'Ivar') swapped++;
      expect(PLACES).toContain(m[2]);
    }
    expect(swapped).toBeGreaterThan(0);
  });
});

describe('The facts, behind the old-history-drift switch (#1650)', () => {
  it('is registered as an experimental rule feature, on in a new game and off for runs from before it', () => {
    expect(featureById('old-history-drift')).toMatchObject({ kind: 'rules', stage: 'experimental', default: true, absent: false, issue: 1650 });
    expect(featureOn(undefined, 'old-history-drift')).toBe(false);
    expect(ON['old-history-drift']).toBe(true);
  });

  it('changes nothing with the switch off: the road villages and the regions tell their history as before', () => {
    const h = histories[1];
    expect(remembered(h, undefined, undefined, OFF)).toEqual(remembered(h));
    expect(regionalFacts(h, OFF)).toEqual(regionalFacts(h));
    for (const r of h.regions) expect(factsOfRegion(r, h.year)).toEqual(regionalFacts(h).filter(f => f.scope.id === r.id));
  });

  it('with it on, splits only old events: one fact per distinct telling, the largest holders\' under the event\'s own id, each naming who holds it', () => {
    let split = 0;
    for (const h of histories) {
      const off = regionalFacts(h, OFF);
      const on = regionalFacts(h, ON);
      const ids = on.map(f => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const o of off) expect(ids).toContain(o.id); // every event keeps its own id
      for (const f of on.filter(x => x.id.includes(':told-by:'))) {
        split++;
        expect(f.heldBy?.length).toBeGreaterThan(0);
        expect(h.year - f.year).toBeGreaterThan(Math.min(...f.heldBy!.map(x => Math.min(livingMemoryOf(x.people), LIVING_MEMORY))));
      }
      // Shares add up per event: each holder group tells it once.
      for (const o of off.filter(x => x.kind === 'event' || x.kind === 'politics' || x.kind === 'economy')) {
        const tellings = on.filter(f => f.id === o.id || f.id.startsWith(`${o.id}:told-by:`));
        if (tellings.some(t => t.heldBy)) expect(tellings.reduce((s, t) => s + t.heldBy!.reduce((a, x) => a + x.share, 0), 0)).toBeCloseTo(1);
      }
    }
    expect(split).toBeGreaterThan(0);
  });

  it('tells a region by the Peoples of its lands\' cultures, and a road village by its own people as the run plays them', () => {
    const h = histories[0];
    for (const r of h.regions) {
      const holders: Holder[] = regionHolders(h, r.id);
      expect(holders.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
      for (const x of holders) expect(['Bergfolk', 'Riksfolk', 'Markfolk', 'Pandor']).toContain(x.people);
    }
    // Maren is a Markfolk orc in a run from before humans walked the road.
    expect(villageHolders('hollowford', { ...ON, 'humans-on-the-road': false }).map(x => x.people).sort()).toEqual(['Bergfolk', 'Goblins', 'Lövfolk', 'Markfolk']);
    const r = remembered(h, undefined, undefined, ON);
    const ids = r.villages.flatMap(v => v.known.map(f => f.id));
    for (const v of r.villages) expect(new Set(v.known.map(f => f.id)).size).toBe(v.known.length);
    expect(ids.length).toBeGreaterThan(0);
  });
});
