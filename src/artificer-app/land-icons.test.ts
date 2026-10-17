/**
 * LAND with `land-found-only` (#1846, #1847): no "what you know of it, from camp" box and no places
 * to camp; each area's heading carries icons for what it holds. Ui features (exempt from ATDD: look
 * and feel), pinned here as strings, en and sv.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { createExploration, survey, type Exploration } from '../artificer/exploration';
import { CAMP_AS_ACTION, CAMP_SITE_RATINGS, knownSpots, siteRating } from '../artificer/camp-sites';
import { DESCRIPTIVE_MAP } from '../artificer/descriptive-map';
import { ringOfHours } from '../artificer/world/reach';
import { landTab } from './land-view';
import { ICON_LEVEL, landIcons } from './land-icons';
import { pinsRoom } from './pins-view';
import { resetFolds } from './fold';
import { esc } from './html';
import { landDescribedHead, whereLine } from './sim-words';

const en = makeT('en');
const sv = makeT('sv');

/** A Warden on a described land with places to camp, rated, and `explore` as given. */
function run(e: Exploration, ratings = true, id = 'w-astrid'): Region1State {
  const s = createRegion1({
    world: {
      ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false,
      features: { [CAMP_AS_ACTION]: true, [DESCRIPTIVE_MAP]: true, [CAMP_SITE_RATINGS]: ratings },
    },
  }, undefined, { id, stats: { str: 10, con: 10, agi: 10, int: 13, wil: 10, cha: 10 } });
  return { ...s, explore: e };
}
const everywhere = (): Exploration => survey(survey(survey(createExploration(), 1), 2), 3);
/** The icons in an area's heading, by their labels. */
const labels = (html: string): string[] => [...html.matchAll(/class="licon[^"]*"[^>]*aria-label="([^"]*)"/g)].map(m => m[1]);

describe('LAND without the from-camp box or the places to camp (#1846)', () => {
  beforeEach(() => resetFolds());

  it('found-only: no described-land heading, compass line, where-line or PLACES TO CAMP, en and sv', () => {
    const s = run(everywhere());
    expect(knownSpots(s).length).toBeGreaterThan(1);
    for (const t of [en, sv]) {
      const html = landTab(s, t, null, { assess: true, foundOnly: true });
      for (const gone of [landDescribedHead(s, t), t('map.compassIntro'), t('map.noCompassIntro'), t('head.campSpots'), 'campspots', whereLine(s, t)]) {
        expect(html, gone).not.toContain(esc(gone));
      }
      // The found places by area, and the Explore line, stay.
      expect(html).toContain('id="land-ring-1"');
      expect(html).toContain('landinvite');
    }
  });

  it('switched off, the boxes are still there', () => {
    const s = run(everywhere());
    const html = landTab(s, en);
    expect(html).toContain('campspots');
    expect(html).toContain(esc(en('map.noCompassIntro')));
    expect(html).toContain(esc(landDescribedHead(s, en)));
  });
});

describe('An area\'s resource icons on LAND (#1847)', () => {
  beforeEach(() => resetFolds());

  it('only for what\'s been seen there: none before, the seen ones after', () => {
    const e = createExploration();
    expect(landIcons(run(e), 1, en)).toBe('');
    // Suspected isn't seen: a scout's look lights nothing.
    e.known[1].water = 1;
    expect(landIcons(run(e), 1, en)).toBe('');
    e.known[1].water = ICON_LEVEL;
    e.known[1].timber = 3;
    const one = labels(landIcons(run(e, false), 1, en));
    expect(one).toEqual(expect.arrayContaining(['Water: observed', 'Timber: detailed']));
    expect(one.some(l => /Forage|Game|Stone/.test(l))).toBe(false);
    expect(labels(landIcons(run(e, false), 1, sv))).toEqual(expect.arrayContaining([`${sv('land.domain.water')}: ${sv('land.level.2')}`]));
  });

  it('dimmed when the supply there is scarce, with that in its label', () => {
    const e = createExploration();
    e.known[1].stone = 2;
    e.supply[1].stone = 0.3;
    const html = landIcons(run(e, false), 1, en);
    expect(html).toMatch(/class="licon dim"[^>]*aria-label="Stone: observed · scarce"/);
    e.supply[1].stone = 1;
    expect(landIcons(run(e, false), 1, en)).not.toContain('dim');
  });

  it('⛺ where a good or great place to camp is known, and only with the ratings on', () => {
    const s = run(everywhere());
    const ringOf = (h: number) => ringOfHours(h) ?? 3;
    for (const r of [1, 2, 3] as const) {
      const rates = knownSpots(s).filter(p => ringOf(p.hours) === r).map(p => siteRating(s, p));
      const want = rates.includes('great') ? en('land.icon.camp.great') : rates.includes('good') ? en('land.icon.camp.good') : null;
      const ls = labels(landIcons(s, r, en));
      if (want) expect(ls).toContain(want); else expect(ls.some(l => /place to camp/.test(l))).toBe(false);
    }
    expect([1, 2, 3].some(r => labels(landIcons(s, r as 1 | 2 | 3, en)).some(l => /place to camp/.test(l)))).toBe(true);
    expect(landIcons(s, 1, sv)).toMatch(/lägerplats/);
    for (const r of [1, 2, 3] as const) expect(landIcons(run(everywhere(), false), r, en)).not.toContain('⛺');
  });

  it('an area out of reach shows none', () => {
    const e = createExploration();
    e.known[3].water = 2;
    expect(landIcons(run(e), 3, en)).toBe('');
  });

  it('sit beside the area\'s word under found-only; not drawn with it off', () => {
    const s = run(everywhere());
    const html = landTab(s, en, null, { assess: true, foundOnly: true });
    const head = html.slice(html.indexOf('id="land-ring-1"'), html.indexOf('</summary>', html.indexOf('id="land-ring-1"')));
    expect(head).toMatch(/class="assess[^"]*"[^>]*>[^<]+<\/span> <span class="landicons">/);
    expect(landTab(s, en)).not.toContain('landicons');
  });
});

describe('How many places you can hold in mind (#1847)', () => {
  it('names what holds more, en and sv', () => {
    const s = run(createExploration());
    expect(pinsRoom(s, en)).toMatch(/more with a sharper mind \(INT\) and more Memory\./);
    expect(pinsRoom(s, sv)).toMatch(/fler med ett skarpare sinne \(INT\) och mer Minne\./);
  });
});
