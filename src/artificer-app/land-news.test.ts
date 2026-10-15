/**
 * Acceptance for #1730's addition: after a land trip, its ring opens on the LAND tab and what it
 * turned up is marked "new" until the viewer has seen the tab; a trip that adds nothing changes
 * nothing. Pure: the app's snapshot of what the viewer saw (land-news.ts) and the tab (land-view.ts).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1, runAction, type QueueItem, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { ruleFeatures } from '../artificer/features';
import { createExploration, survey, RINGS, domainsOf } from '../artificer/exploration';
import { landNews, landSeen, ringsToOpen, storedSeen, storeSeen, resetSeen, tripRing } from './land-news';
import { landTab, tripNews } from './land-view';
import { foldOpen, resetFolds, setFold } from './fold';

const en = makeT('en');
const sv = makeT('sv');

/** A Warden who knows home ground (surveyed), so the far ring is in reach and still unknown. */
function homeKnown(id = 'w-land-news'): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: false, features: ruleFeatures() } }, undefined, { id });
  return { ...s, explore: survey(createExploration(), 1) };
}

/** Run one trip (and drop any encounter it raised, as the tests elsewhere do). */
const trip = (s: Region1State, q: QueueItem): Region1State => { const n = runAction(s, q); return n.pending ? { ...n, pending: null } : n; };

/** The ring of the last land trip in the journal. */
const lastTrip = (s: Region1State) => s.log.map(l => tripRing(l.text)).filter(r => r !== null).at(-1);

/** What the page does after a move (main.ts keep): open the rings a land trip turned something up in. */
const afterMove = (before: Region1State, after: Region1State): void => { for (const r of ringsToOpen(before, after)) setFold(`land.ring.${r}`, true); };

describe('After a land trip, the LAND tab shows what it found (#1730)', () => {
  beforeEach(() => { resetFolds(); resetSeen(); });

  it('reads the ring a land trip went to off its journal line, and nothing off any other line', () => {
    const s = homeKnown();
    expect(lastTrip(trip(s, 'explore@2'))).toBe(2);
    expect(lastTrip(trip(s, 'explore'))).toBe(1);
    expect(tripRing('Scouted the near ground — you can see where food, water, wood and stone lie.')).toBe(1);
    expect(tripRing('Surveyed carefully in the far ring — every trip there yields more now.')).toBe(2);
    expect(tripRing('Surveyed carefully — every trip there yields more now.')).toBe(1);
    expect(tripRing('Climbed high in the distant ring and looked out — the ground sharpens below.')).toBe(3);
    expect(tripRing('Walked the ground in the far ring again and looked closer — it\'s a little clearer now.')).toBe(2);
    expect(tripRing('Reached the distant hills — and glimpsed the pass out of the Reach.')).toBe(3);
    expect(tripRing('Gathered 4 food.')).toBeNull();
  });

  it('given an Explore into the far ring that adds a place, opens the far ring and marks the place new', () => {
    // A Warden whose far ring holds a place to find (the Reach differs by seed): the first of a few.
    const before = Array.from({ length: 40 }, (_, i) => homeKnown(`w-land-news-${i}`)).find(s => [...landNews(trip(s, 'explore@2'), landSeen(s)).places].some(k => k.endsWith('@2')))!;
    expect(before).toBeDefined();
    storeSeen(before.character.id, landSeen(before), null); // the viewer has seen the land as it was
    setFold('land.ring.2', false, null); // …and shut the far ring
    const after = trip(before, 'explore@2');
    const news = landNews(after, storedSeen(after.character.id, null));
    expect([...news.places].some(k => k.endsWith('@2'))).toBe(true);
    afterMove(before, after);
    expect(foldOpen('land.ring.2', false, null)).toBe(true);
    const html = landTab(after, en, null, { news });
    expect(html).toMatch(/data-fold="land\.ring\.2" open/);
    // The far ring's section holds a place marked new, and its chips that went up are marked too.
    const far = html.slice(html.indexOf('data-fold="land.ring.2"'), html.indexOf('data-fold="land.ring.3"') > 0 ? html.indexOf('data-fold="land.ring.3"') : undefined);
    expect(far).toMatch(/<li class="new">[^<]+ <span class="newmark">new<\/span><\/li>/);
    expect(far).toMatch(/class="chip l1 new"/);
    // The one-at-a-time card says the same, with the link; in Swedish too.
    expect(tripNews(after, 2, news, en)).toMatch(/<li class="new">.*data-seeland="2">See the land →/s);
    expect(tripNews(after, 2, news, sv)).toContain('Se landet →');
    expect(landTab(after, sv, null, { news })).toContain('nytt');
  });

  it('given the LAND tab viewed, the marks clear', () => {
    const before = homeKnown();
    const after = trip(before, 'explore@2');
    expect(landNews(after, landSeen(before)).rings).toContain(2);
    // Viewing the tab stores what it shows as seen (main.ts landNewsNow).
    storeSeen(after.character.id, landSeen(after), null);
    const news = landNews(after, storedSeen(after.character.id, null));
    expect(news.rings).toEqual([]);
    expect(landTab(after, en, null, { news })).not.toContain('newmark');
    expect(tripNews(after, 2, news, en)).toBe('');
  });

  it('given a trip that adds nothing, marks nothing and leaves every ring open or shut as it was', () => {
    // Every ring known in detail, so every place is in view already: walking the near ground again adds nothing.
    const base = homeKnown();
    const known = Object.fromEntries(RINGS.map(r => [r, Object.fromEntries(domainsOf(r).map(d => [d, 3]))]));
    const before = { ...base, explore: { ...base.explore, known: known as Region1State['explore']['known'] } };
    setFold('land.ring.1', false, null);
    setFold('land.ring.2', true, null);
    const after = trip(before, 'explore');
    expect(lastTrip(after)).toBe(1);
    expect(ringsToOpen(before, after)).toEqual([]);
    afterMove(before, after);
    expect(foldOpen('land.ring.1', true, null)).toBe(false);
    expect(foldOpen('land.ring.2', false, null)).toBe(true);
    const news = landNews(after, landSeen(before));
    expect(news.chips.size + news.places.size).toBe(0);
    expect(landTab(after, en, null, { news })).not.toContain('newmark');
  });

  it('marks nothing for a viewer with no snapshot yet, and nothing for another Warden', () => {
    const s = trip(homeKnown(), 'explore@2');
    expect(landNews(s, null).rings).toEqual([]);
    storeSeen('someone-else', landSeen(homeKnown()), null);
    expect(storedSeen(s.character.id, null)).toBeNull();
    expect(ringsToOpen(homeKnown('w-a'), trip(homeKnown('w-b'), 'explore@2'))).toEqual([]);
  });
});
