/**
 * How well you know each area (#1835) and LAND as only what you've found (#1836). Both are ui
 * features (exempt from ATDD: look and feel), but the thresholds are a pure function, so they're
 * pinned here against hand-built land and a scripted run; the tab is drawn as strings, en and sv.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1, runAction, runDay, type QueueItem, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { createExploration, explore, survey, work, scout, RINGS, DOMAINS, domainsOf, type Exploration, type Ring } from '../artificer/exploration';
import { BLIND_WORK, CLOSE_WORK, LAND_ASSESS_FEATURE, WELL_WORK, assessmentTag, nextStep, selfAssessment, type Assessment } from './land-assessment';
import { LAND_FOUND_FEATURE, exploreRing, landTab } from './land-view';
import { resetFolds } from './fold';

const en = makeT('en');
const sv = makeT('sv');

const fresh = (id = 'w-assess'): Region1State => createRegion1({ world: { ...FULL_WORLD, encounters: false, features: ruleFeatures() } }, undefined, { id });

/** Every domain in ring 1 at `lv`, with `trips` spread over its workable domains. */
function home(lv: number, trips = 0, ring: Ring = 1): Exploration {
  const e = createExploration();
  for (const d of domainsOf(ring)) e.known[ring][d] = d === 'routes' ? Math.min(lv, 2) : lv;
  const workable = domainsOf(ring).filter(d => d !== 'routes');
  for (let i = 0; i < trips; i++) e.worked[ring][workable[i % workable.length]] += 1;
  return e;
}

describe('the ui features (#1835, #1836)', () => {
  it('are ui features, experimental, on by default, after the ui features before them, and no run saves them', () => {
    for (const [id, issue] of [[LAND_ASSESS_FEATURE, 1835], [LAND_FOUND_FEATURE, 1836]] as const) {
      expect(featureById(id)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue });
      expect(uiFeatureOn({}, id)).toBe(true);
      expect(uiFeatureOn({ [id]: false }, id)).toBe(false);
      expect(Object.keys(ruleFeatures())).not.toContain(id);
      // Other ui features may be added after these, so only the order against the earlier ones is pinned.
      const at = (x: string): number => FEATURES.findIndex(f => f.id === x);
      expect(at(id)).toBeGreaterThan(at('side-queue'));
    }
  });
});

describe('selfAssessment: the thresholds (#1835)', () => {
  it('nothing seen is Unknown; something glimpsed is A hunch', () => {
    expect(selfAssessment(createExploration(), 1)).toBe(0);
    const e = createExploration();
    e.known[1].water = 1;
    expect(selfAssessment(e, 1)).toBe(1);
    expect(selfAssessment(scout(createExploration(), 1), 1)).toBe(1);
  });

  it('every domain seen and two seen clearly is A rough idea', () => {
    const e = scout(createExploration(), 1);
    e.known[1].forage = 2;
    expect(selfAssessment(e, 1)).toBe(1);
    e.known[1].water = 2;
    expect(selfAssessment(e, 1)).toBe(2);
  });

  it('every domain observed and some work done is Well explored; observed but barely worked stays A rough idea', () => {
    expect(selfAssessment(home(2, WELL_WORK - 1), 1)).toBe(2);
    expect(selfAssessment(home(2, WELL_WORK), 1)).toBe(3);
  });

  it('two domains in detail and plenty of work is Know it closely', () => {
    const e = home(2, CLOSE_WORK);
    e.known[1].forage = 3;
    expect(selfAssessment(e, 1)).toBe(3);
    e.known[1].water = 3;
    expect(selfAssessment(e, 1)).toBe(4);
    expect(selfAssessment({ ...e, worked: home(2, CLOSE_WORK - 1).worked }, 1)).toBe(3);
  });

  it('Could work it blindfolded needs every domain in detail and a great deal of work', () => {
    expect(selfAssessment(home(3, BLIND_WORK - 1), 1)).toBe(4);
    expect(selfAssessment(home(3, BLIND_WORK), 1)).toBe(5);
    // Routes are never worked, so out there observed is as well as they can be known.
    expect(selfAssessment(home(3, BLIND_WORK, 2), 2)).toBe(5);
    const e = home(3, BLIND_WORK);
    e.known[1].stone = 2.9;
    expect(selfAssessment(e, 1)).toBe(4);
  });

  it('the tooltip names what would raise it, en and sv', () => {
    const e = scout(createExploration(), 1);
    e.known[1].water = 0;
    expect(nextStep(e, 1, en)).toBe("you haven't found water there.");
    expect(nextStep(e, 1, sv)).toBe('du har inte hittat vatten där.');
    expect(nextStep(home(2, 0), 1, en)).toBe('work there more.');
    expect(nextStep(createExploration(), 1, en)).toBe('go out and take a first look.');
    expect(nextStep(home(3, BLIND_WORK), 1, en)).toBe('');
    expect(assessmentTag(e, 1, en)).toBe(`<span class="assess a1" title="A hunch. To know it better: you haven&#39;t found water there.">A hunch</span>`);
    expect(assessmentTag(home(3, BLIND_WORK), 1, sv)).toContain('>Hittar i blindo</span>');
  });
});

describe('a scripted run (#1835): the word rises at sensible points', () => {
  it('day 1 close by is Unknown, then A hunch, A rough idea and Well explored in the first days, and the top only after a long stay', () => {
    let s = fresh();
    expect(s.day).toBe(1);
    expect(selfAssessment(s.explore, 1)).toBe(0);
    const seen: Assessment[] = [];
    // The real game for the first days: explore, fetch water, gather, as a new Warden might.
    for (let d = 0; d < 4; d++) {
      s = runDay(s, ['explore', 'water', 'gather'] as QueueItem[]).state;
      seen.push(selfAssessment(s.explore, 1));
    }
    expect(seen[0]).toBe(1); // after day 1: A hunch
    expect(seen.at(-1)).toBeGreaterThanOrEqual(2); // a few days in: a rough idea at least
    expect(seen.at(-1)).toBeLessThanOrEqual(3);
    expect(selfAssessment(s.explore, 2)).toBe(0); // nothing seen half a day out yet

    // Then a long stay working home ground (the land model alone, three trips a day): the word only rises.
    let e = s.explore;
    let last = selfAssessment(e, 1);
    const reached: Partial<Record<Assessment, number>> = {};
    const jobs = DOMAINS.filter(d => d !== 'routes');
    for (let trip = 0; trip < 120; trip++) {
      e = trip % 6 === 0 ? explore(e, 1) : work(e, 1, jobs[trip % jobs.length]).exploration;
      const a = selfAssessment(e, 1);
      expect(a).toBeGreaterThanOrEqual(last);
      if (reached[a] === undefined) reached[a] = trip;
      last = a;
    }
    expect(reached[3]).toBeDefined();
    expect(reached[4]).toBeGreaterThan(reached[3]!);
    // Blindfolded takes weeks of work (three trips a day): not before about day 15.
    expect(reached[5]).toBeGreaterThan(reached[4]!);
    expect(reached[5]! / 3).toBeGreaterThan(10);
  });
});

/** Home ground surveyed, then one look half a day out: the far ring holds what it showed. */
function later(id = 'w-assess-later'): Region1State {
  const s = { ...fresh(id), explore: survey(createExploration(), 1) };
  const n = runAction(s, 'explore@2');
  return n.pending ? { ...n, pending: null } : n;
}

describe('LAND with the self-assessment (#1835)', () => {
  beforeEach(() => resetFolds());

  it('shows the word beside each reachable ring\'s heading, en and sv', () => {
    const s = later();
    const html = landTab(s, en, null, { assess: true });
    const ring1 = html.slice(html.indexOf('id="land-ring-1"'), html.indexOf('</summary>', html.indexOf('id="land-ring-1"')));
    expect(ring1).toContain('class="assess a2"');
    expect(ring1).toContain('>A rough idea</span>');
    const ring2 = html.slice(html.indexOf('id="land-ring-2"'), html.indexOf('</summary>', html.indexOf('id="land-ring-2"')));
    expect(ring2).toContain('>A hunch</span>');
    expect(landTab(s, sv, null, { assess: true })).toContain('>Grov uppfattning</span>');
    expect(landTab(s, sv, null, { assess: true })).toContain('>En aning</span>');
  });

  it('a ring out of reach shows nothing new', () => {
    // Home ground surveyed: half a day out is in reach, a day out isn't.
    const html = landTab({ ...fresh(), explore: survey(createExploration(), 1) }, en, null, { assess: true });
    expect(html.slice(html.indexOf('id="land-ring-2"')).slice(0, 400)).toContain('>Unknown</span>');
    const ring3 = html.slice(html.indexOf('id="land-ring-3"'));
    expect(ring3.slice(0, ring3.indexOf('</div>'))).not.toContain('class="assess');
  });

  it('switched off, LAND is exactly as before', () => {
    const s = later();
    expect(landTab(s, en, null, { assess: false })).toBe(landTab(s, en));
    expect(landTab(s, en)).not.toContain('class="assess');
  });
});

describe('LAND as only what you\'ve found (#1836)', () => {
  beforeEach(() => resetFolds());

  it('day 1: only the line and the Explore button, en and sv', () => {
    const s = fresh();
    const html = landTab(s, en, null, { assess: true, foundOnly: true });
    expect(html).toContain('To get to know the land better, explore your surroundings.');
    expect(html).toMatch(/<button class="pill landexplore" data-q="explore">Explore<\/button>/);
    for (const gone of ['class="chip', 'class="legend', 'ringfold', 'pinrow', 'data-pinring', 'campspots', 'head.']) expect(html, gone).not.toContain(gone);
    expect(html.match(/<section/g)).toHaveLength(1);
    const svHtml = landTab(s, sv, null, { foundOnly: true });
    expect(svHtml).toContain('För att lära känna landet bättre kan du utforska din omgivning.');
    expect(svHtml).toContain('data-q="explore">Utforska</button>');
  });

  it('later: the places found by area, each heading with its word; no chips, key, supply or pin rows', () => {
    const s = later();
    const html = landTab(s, en, null, { assess: true, foundOnly: true });
    expect(html).toContain('id="land-ring-1"');
    expect(html).toContain('>A rough idea</span>');
    expect(html).toMatch(/<ul class="landwords"><li>/);
    for (const gone of ['class="chip', 'class="legend', 'keyfold', 'data-pinring', 'pins.none']) expect(html, gone).not.toContain(gone);
    expect(landTab(s, sv, null, { assess: true, foundOnly: true })).toContain('>Grov uppfattning</span>');
    // Home ground is clear now (surveyed), so the button explores half a day out.
    expect(exploreRing(s)).toBe(2);
    expect(html).toContain('data-q="explore@2"');
  });

  it('says where a queued Explore went, with a link to the plan, en and sv', () => {
    const s = later();
    expect(landTab(s, en, null, { foundOnly: true })).not.toContain('landqueued');
    const html = landTab(s, en, null, { foundOnly: true, queue: ['water', 'explore@2'] });
    expect(html).toContain('In your queue: Explore · half a day out. <button class="seeland" data-tab="plan">See the plan →</button>');
    expect(landTab(s, sv, null, { foundOnly: true, queue: ['explore'] })).toContain('I din kö: Utforska.');
  });

  it('finds and the pass become place lines', () => {
    const base = later();
    const e = home(3, 0);
    e.finds = ['1:water'];
    const s = { ...base, explore: e };
    expect(landTab(s, en, null, { foundOnly: true })).toContain('<li>★ Clear spring</li>');
    expect(landTab(s, sv, null, { foundOnly: true })).toContain('<li>★ Klar källa</li>');
  });

  it('the places you remember become place lines too, with what each does', () => {
    const s: Region1State = { ...later(), pins: [{ id: 'deep-pool@1', place: 'deep-pool', kind: 'fishing', ring: 1, day: 2 }] };
    const html = landTab(s, en, null, { foundOnly: true });
    expect(html).toMatch(/<li>📌 [^<]+ · \+1 water and fish there<\/li>/);
    expect(html).not.toContain('data-forget');
  });

  it('without the self-assessment, the headings carry no word', () => {
    expect(landTab(later(), en, null, { foundOnly: true })).not.toContain('class="assess');
  });

  it('switched off, LAND is exactly as before', () => {
    const s = later();
    expect(landTab(s, en, null, { foundOnly: false })).toBe(landTab(s, en));
    expect(landTab(fresh(), en)).toContain('class="chip');
  });
});

describe('exploreRing (#1836)', () => {
  it('is the nearest reachable area with something still unclear, else close by', () => {
    const s = fresh();
    expect(exploreRing(s)).toBe(1);
    const known = createExploration();
    for (const r of RINGS) for (const d of domainsOf(r)) known.known[r][d] = 2;
    expect(exploreRing({ ...s, explore: known })).toBe(1);
  });
});
