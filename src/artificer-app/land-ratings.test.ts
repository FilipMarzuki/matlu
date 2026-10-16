/**
 * #1798: the LAND tab's places to camp carry the same rating badges as Make camp (#1756,
 * `camp-site-ratings`), from the same helper (rating-badges.ts), and the heading the same count.
 * The map-drawing session's list marks its places to camp the same way. With the switch off or
 * absent the LAND tab is exactly as it was.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { createExploration, survey } from '../artificer/exploration';
import { CAMP_AS_ACTION, CAMP_SITE_RATINGS, knownSpots, ratingBadges, siteRating, siteRatingCounts } from '../artificer/camp-sites';
import { DESCRIPTIVE_MAP } from '../artificer/descriptive-map';
import { MAP_LEARNING, NEW_SESSION } from '../artificer/map-learning';
import { campSpotsSection, landTab } from './land-view';
import { mapSessionModal, newSessionUi } from './map-session-view';
import { campBadges, siteBadge } from './rating-badges';
import { sitesBlock } from './camp-blocks';

const en = makeT('en');
const sv = makeT('sv');

type Ratings = boolean | 'absent';
/** A Warden who knows every ring (so a cave, a tree, a riverbank and hills are known), the ratings as asked. */
function known(ratings: Ratings, extra: Record<string, boolean> = {}, id = 'w-astrid'): Region1State {
  const s = createRegion1({
    world: {
      ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false,
      features: { [CAMP_AS_ACTION]: true, ...extra, ...(ratings === 'absent' ? {} : { [CAMP_SITE_RATINGS]: ratings }) },
    },
  }, undefined, { id, stats: { str: 10, con: 10, agi: 10, int: 13, wil: 10, cha: 10 } });
  return { ...s, explore: survey(survey(survey(createExploration(), 1), 2), 3) };
}
/** The LAND tab's list of places to camp, row by row. */
const rows = (html: string): string[] => [...html.matchAll(/<ul class="landwords campspots">([\s\S]*?)<\/ul>/g)].flatMap(m => m[1].split('</li>').filter(Boolean));
const DESCRIBED = { [DESCRIPTIVE_MAP]: true };

describe('The LAND tab rates the places to camp you know (#1798)', () => {
  it('each known spot shows the badge Make camp shows it: ★ great, ✓ good, nothing when poor', () => {
    for (const extra of [{}, DESCRIBED]) {
      const s = known(true, extra);
      const spots = knownSpots(s);
      const ratings = spots.map(p => siteRating(s, p));
      // The Reach this Warden walks has all three: a great cave, good sites and poor hilltops.
      expect(ratings).toContain('great');
      expect(ratings).toContain('good');
      expect(ratings).toContain('poor');
      for (const t of [en, sv]) {
        const list = rows(landTab(s, t));
        expect(list).toHaveLength(spots.length);
        spots.forEach((p, i) => {
          const badge = siteBadge(s, p, t);
          expect(badge === '').toBe(ratings[i] === 'poor');
          if (badge) expect(list[i]).toContain(badge);
          else expect(list[i]).not.toMatch(/class="rate/);
        });
        // The very markup Make camp's list of sites draws, so the two can't drift.
        for (const p of spots) { const b = siteBadge(s, p, t); if (b) expect(sitesBlock(s, t)).toContain(b); }
      }
    }
  });

  it('the heading carries the same count as Make camp: "★ 1 · ✓ 2", in both languages', () => {
    const s = known(true);
    const c = siteRatingCounts(s);
    expect(c.great + c.good).toBeGreaterThan(0);
    const section = campSpotsSection(s, sv);
    expect(section).toContain(campBadges(s, sv));
    expect(section).toContain(`>${ratingBadges(c)}<`);
    expect(section).toContain(sv('campsite.badgesTip', { great: c.great, good: c.good }));
    expect(section).toContain(sv('campsite.rate.great'));
    expect(campSpotsSection(s, en)).toContain(en('campsite.rate.good'));
  });

  it('reads the belief: a vague reading the rating believes is what LAND shows', () => {
    // Badges follow siteRating (what the Warden believes), whatever the reading: same as Make camp.
    for (const id of ['w-fen', 'w-a', 'w-b']) {
      const s = known(true, {}, id);
      const list = rows(campSpotsSection(s, en));
      knownSpots(s).forEach((p, i) => {
        const r = siteRating(s, p);
        if (r === 'poor') expect(list[i]).not.toMatch(/[★✓]/);
        else expect(list[i]).toContain(`<span class="rate ${r}">`);
      });
    }
  });

  it('with the switch off or absent, the LAND tab is exactly as it was', () => {
    for (const extra of [{}, DESCRIBED]) {
      const off = known(false, extra), absent = known('absent', extra);
      for (const t of [en, sv]) {
        const html = landTab(off, t);
        expect(html).toBe(landTab(absent, t));
        expect(html).not.toMatch(/class="rate|cbadges/);
        expect(campSpotsSection(off, t)).not.toMatch(/class="rate|cbadges/);
        // And the list is the one the badges are added to, with only the badges removed.
        const on = campSpotsSection(known(true, extra), t).replace(/<span class="(rate [a-z]+|cbadges)"[^>]*>[^<]*<\/span>/g, '');
        expect(on).toBe(campSpotsSection(off, t));
      }
      for (const p of knownSpots(off)) expect(siteBadge(off, p, en)).toBe('');
      expect(campBadges(off, en)).toBe('');
    }
  });

  it('the map-drawing session marks its places to camp with the same badge, and nothing with the switch off', () => {
    const extra = { ...DESCRIBED, [MAP_LEARNING]: true };
    const on = known(true, extra, 'w-a'), off = known(false, extra, 'w-a');
    const ui = newSessionUi(NEW_SESSION);
    const html = mapSessionModal(on, ui, sv);
    const badges = knownSpots(on).map(p => siteBadge(on, p, sv)).filter(Boolean);
    expect(html).toContain('⛺');
    // At least one rated spot is on the session's list (spots at your feet or on another place's square aren't).
    expect(badges.some(b => html.includes(b))).toBe(true);
    const offHtml = mapSessionModal(off, ui, sv);
    expect(offHtml).not.toMatch(/class="rate/);
    expect(html.replace(/<span class="rate [a-z]+">[^<]*<\/span>/g, '')).toBe(offHtml);
  });
});
