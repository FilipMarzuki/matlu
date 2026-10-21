/**
 * Acceptance tests for #1714 — a death in the Reach and a death on the road each close the run with
 * their own words, in both languages, on the page and in the API's text view.
 *
 * The bug: the road's catalog defined `end.died` again, and because the area files are spread into
 * one catalog the road's sentence replaced the camp's ("THE REACH TAKES YOU"). Now the road's has
 * its own key (`road.end.died`).
 */

import { describe, it, expect } from 'vitest';
import { makeT, type Lang } from '../artificer/i18n';
import { en } from '../artificer/i18n/en';
import { sv } from '../artificer/i18n/sv';
import { createRegion1, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { viewText } from '../artificer-play/view-words';
import { rideCaravan, type AppState } from './controller';
import { outcomeCard } from './camp-blocks';
import { roadEnd } from './road-view';

/** The text a player reads, without the markup. */
const text = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

const CAMP_DIED = { en: 'THE REACH TAKES YOU', sv: 'REACH TAR DIG' } as const;
const ROAD_DIED = { en: 'The road was one hardship too many.', sv: 'Vägen var en prövning för mycket.' } as const;
const LANGS: Lang[] = ['en', 'sv'];

function diedInTheReach(): AppState {
  const s = createRegion1({}, undefined, { id: 'w-1714', name: 'Vega' });
  const sim: Region1State = { ...s, day: 23, outcome: { choice: 'collapse', kind: 'died', vitals: createVitals() } };
  return { sim, queue: [], stage: 'reach' };
}

function diedOnTheRoad(): AppState {
  const s = createRegion1({}, undefined, { id: 'w-1714-road', name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  const sim: Region1State = { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 30, water: 20, firewood: 4 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  const a = rideCaravan({ sim, queue: [], stage: 'reach' });
  return { ...a, road: { ...a.road!, outcome: { kind: 'died', vitals: a.road!.vitals } } };
}

describe('the closing card for a death (#1714)', () => {
  it("reads the camp's words for a death in the Reach, in both languages", () => {
    const a = diedInTheReach();
    for (const lang of LANGS) {
      const t = makeT(lang);
      const card = text(outcomeCard(a, undefined, t));
      expect(card).toContain(CAMP_DIED[lang]);
      expect(card).not.toContain(ROAD_DIED[lang]);
      // The API's text view draws the same card.
      const view = viewText(a, 'ended', t);
      expect(view).toContain(CAMP_DIED[lang]);
      expect(view).not.toContain(ROAD_DIED[lang]);
    }
    // The catalogs themselves agree: `end.died` is the camp's sentence again.
    expect(en['end.died']).toBe(CAMP_DIED.en);
    expect(sv['end.died']).toBe(CAMP_DIED.sv);
  });

  it("reads the road's words for a death on the road, in both languages", () => {
    const a = diedOnTheRoad();
    for (const lang of LANGS) {
      const t = makeT(lang);
      const card = text(roadEnd(a.road!, t));
      expect(card).toContain(ROAD_DIED[lang]);
      expect(card).not.toContain(CAMP_DIED[lang]);
      const view = viewText(a, 'ended', t);
      expect(view).toContain(ROAD_DIED[lang]);
      expect(view).not.toContain(CAMP_DIED[lang]);
    }
  });
});
