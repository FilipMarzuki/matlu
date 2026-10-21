/**
 * #1853: a new Warden starts on LAND, with the patrol leader's advice and one Explore button that
 * leads to PLAN with Explore highlighted and its distance chooser open at the nearest distance.
 * The page's wiring is main.ts's (and the Playwright spec's); these pin the pure parts.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { ACTIONS, createRegion1, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { createExploration, survey } from '../artificer/exploration';
import { landTab } from './land-view';
import { resetFolds } from './fold';
import { distanceOptions } from './camp-blocks';
import { START_LAND_FEATURE, START_LAND_KEY, canLeadToExplore, claimStartLand, firstView, nearestFirst, startLandUsed, startNoteBlock, startNoteDue, startTarget, waterSeen, type StartStore } from './start-land';

const en = makeT('en');
const sv = makeT('sv');
const fresh = (id = 'w-start'): Region1State => createRegion1({ world: { ...FULL_WORLD, encounters: false, features: ruleFeatures() } }, undefined, { id });

/** A storage double: a Map, or one that refuses everything (a private window). */
const memStore = (): StartStore & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
};
const refusing: StartStore = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };

describe('The switch (#1853)', () => {
  it('is a ui feature, on by default, after the journal notes', () => {
    const f = featureById(START_LAND_FEATURE)!;
    expect(f.kind).toBe('ui');
    expect(f.default).toBe(true);
    expect(uiFeatureOn({}, START_LAND_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [START_LAND_FEATURE]: false }, START_LAND_FEATURE)).toBe(false);
    expect(FEATURES.findIndex(f => f.id === START_LAND_FEATURE)).toBeGreaterThan(FEATURES.findIndex(f => f.id === 'journal-notes'));
  });
});

describe('The first view after the intro', () => {
  it('is LAND once per run for a new Warden, then the stored tab as before', () => {
    const store = memStore();
    const page = new Set<string>();
    expect(startLandUsed('w-a', store)).toBe(false);
    expect(firstView(true, true, claimStartLand('w-a', page, store))).toBe('land');
    expect(store.m.get(`${START_LAND_KEY}w-a`)).toBe('1');
    // A reload (a new page: its own memory is empty) on day 1 after leaving LAND: not forced again.
    expect(claimStartLand('w-a', new Set(), store)).toBe(false);
    expect(firstView(true, true, false)).toBeNull();
    // Another Warden gets their own first view.
    expect(claimStartLand('w-b', page, store)).toBe(true);
  });

  it('with storage refusing, still only once in this visit', () => {
    const page = new Set<string>();
    expect(claimStartLand('w-c', page, refusing)).toBe(true);
    expect(claimStartLand('w-c', page, refusing)).toBe(false);
    expect(startLandUsed('w-c', refusing)).toBe(false);
  });

  it('switch off, or the run already under way: no LAND, PLAN (the stored tab) as today', () => {
    expect(firstView(false, true, true)).toBeNull();
    expect(firstView(true, false, true)).toBeNull();
  });
});

describe('The note on LAND', () => {
  beforeEach(() => resetFolds());

  it('day 1: the note, the near area with its word, and one button, en', () => {
    const s = fresh();
    const html = landTab(s, en, null, { assess: true, foundOnly: true, startNote: startNoteBlock(s, en) });
    expect(html).toContain('You know almost nothing about this place yet. Your patrol leader always said: scout first. Find a good place for shelter, and a source of water.');
    expect(html).toContain('<button class="btn go landstartgo" data-startexplore="1">Explore</button>');
    // The near area, with its self-assessment.
    expect(html).toContain('id="land-ring-1"');
    expect(html).toContain('>Unknown</span>');
    // One button: #1836's direct Explore and its invitation give way to the note's.
    expect(html).not.toContain('landexplore');
    expect(html).not.toContain('To get to know the land better');
    expect(html.match(/<button[^>]*(data-startexplore|data-q="explore)/g)).toHaveLength(1);
    // The note comes first.
    expect(html.indexOf('landstart')).toBeLessThan(html.indexOf('id="land-ring-1"'));
  });

  it('day 1 in Swedish', () => {
    const s = fresh();
    const html = landTab(s, sv, null, { assess: true, foundOnly: true, startNote: startNoteBlock(s, sv) });
    expect(html).toContain('Du vet nästan ingenting om platsen än. Patrulledaren brukade säga: spana först. Hitta en bra plats för skydd, och en vattenkälla.');
    expect(html).toContain('data-startexplore="1">Utforska</button>');
    expect(html).toContain('>Okänt</span>');
  });

  it('without the note (switch off) LAND on day 1 is exactly #1836\'s', () => {
    const s = fresh();
    expect(landTab(s, en, null, { assess: true, foundOnly: true, startNote: '' })).toBe(landTab(s, en, null, { assess: true, foundOnly: true }));
    expect(landTab(s, en, null, { foundOnly: true })).toContain('data-q="explore">Explore</button>');
  });

  it('after day 1 the note is gone and LAND is as now', () => {
    const s = { ...fresh(), day: 2 };
    expect(startNoteDue(s)).toBe(false);
    expect(startNoteBlock(s, en)).toBe('');
    expect(landTab(s, en, null, { foundOnly: true, startNote: startNoteBlock(s, en) })).toBe(landTab(s, en, null, { foundOnly: true }));
  });

  it('stops once water and a good place for shelter are both found', () => {
    const s = fresh();
    expect(waterSeen(s)).toBe(false);
    expect(startNoteDue(s)).toBe(true);
    // Everything near and far known clearly: water seen, and (on the default rules) a good place to camp.
    const known = { ...s, explore: survey(survey(survey(createExploration(), 1), 2), 3) };
    expect(waterSeen(known)).toBe(true);
    // Camp made counts as shelter found, whatever the ratings say.
    const camped = { ...known, site: known.site ?? 'treeline' } as Region1State;
    expect(startNoteDue(camped)).toBe(false);
  });

  it('leads in front of the other LAND views too (found-only off)', () => {
    const s = fresh();
    const html = landTab(s, en, null, { startNote: startNoteBlock(s, en) });
    expect(html.indexOf('landstart')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('landstart')).toBeLessThan(html.indexOf('<section class="box">'));
  });
});

describe('The button\'s target', () => {
  it('is PLAN with Explore highlighted and its chooser open, Explore being ringed', () => {
    expect(ACTIONS.explore.ringed).toBe(true);
    expect(startTarget()).toEqual({ tab: 'plan', highlight: 'explore', chooser: 'explore' });
    expect(canLeadToExplore(fresh())).toBe(true);
  });

  it('the chooser opens at the nearest distance, even with another one remembered', () => {
    const s = { ...fresh(), explore: survey(createExploration(), 1) };
    // Remembered: half a day out. While the start's highlight holds, Explore's memory is set aside.
    const remembered = { explore: 2 as const, water: 2 as const };
    expect(distanceOptions(s, 'explore', remembered, en).find(o => o.chosen)?.ring).toBe(2);
    const start = nearestFirst(remembered);
    expect(start).toEqual({ water: 2 });
    expect(distanceOptions(s, 'explore', start, en).find(o => o.chosen)?.ring).toBe(1);
    expect(nearestFirst({ water: 3 })).toEqual({ water: 3 });
  });
});
