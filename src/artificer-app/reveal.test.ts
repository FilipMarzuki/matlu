/**
 * The first-morning guide (#1792, reveal.ts): each element's rule on scripted states, a played run in
 * which nothing that has appeared disappears again, the order the lines come in, and the device's
 * record (seen lines, "I've played before", "Show the guide again").
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { en } from '../artificer/i18n/en';
import { sv } from '../artificer/i18n/sv';
import { FEATURES, uiFeatureOn } from '../artificer/features';
import { encounterById, stepOf } from '../artificer/encounters';
import { knownSpots, siteRatingCounts } from '../artificer/camp-sites';
import { makeWarden, act, choose, endTheDay, enqueue, runQueuedDay, type AppState } from './controller';
import {
  GUIDE_FEATURE, GUIDE_IDS, REVEALS, EMPTY_GUIDE, activeTip, began, firstTool, guideFinished, guideFor, markDone, markSeen, markShown,
  readGuide, revealedNow, setPlayedBefore, showGuideAgain, storesInPlay, suggestedAction, suitableSiteKnown, usedNow, loadGuide, saveGuide,
  type GuideCtx, type GuideId,
} from './reveal';

// A Warden whose starting place rates poor (most do), so a place to camp has to be found.
const fresh = (): AppState => makeWarden({ id: 'w-probe-1', name: 'Ada' });
const ctx = (a: AppState, weatherAcked = true): GuideCtx => ({ sim: a.sim, queued: a.queue.length, weatherAcked });
const rule = (id: GuideId) => REVEALS.find(r => r.id === id)!;

/** Answer whatever encounter is waiting with its first option. */
function settleEncounter(a: AppState): AppState {
  let x = a;
  for (let i = 0; i < 6 && x.sim.pending; i++) {
    const p = x.sim.pending!;
    const tpl = encounterById(p.id);
    if (!tpl) break;
    x = choose(x, stepOf(tpl, p.step).options[0].id);
  }
  return x;
}

describe('the switch (#1792)', () => {
  it('is a ui feature, on by default, that a player can switch off', () => {
    expect(FEATURES.find(f => f.id === GUIDE_FEATURE)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, issue: 1793 });
    expect(uiFeatureOn({}, GUIDE_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [GUIDE_FEATURE]: false }, GUIDE_FEATURE)).toBe(false);
  });
});

describe('each element’s rule (#1792)', () => {
  it('a fresh run shows only the weather until it’s acknowledged', () => {
    const a = fresh();
    expect([...revealedNow(ctx(a, false))]).toEqual(['weather']);
    expect(began(a.sim)).toBe(false);
  });

  it('acknowledging the weather brings the vitals, the FOCUS chip and the actions, and nothing else', () => {
    expect([...revealedNow(ctx(fresh()))]).toEqual(['weather', 'vitals', 'focus', 'actions']);
  });

  it('the first thing done brings one-at-a-time and End the day, even with the weather never acknowledged (a reload)', () => {
    const a = act(fresh(), suggestedAction(fresh().sim));
    expect(a.sim.hoursToday).toBeGreaterThan(0);
    const r = revealedNow(ctx(a, false));
    for (const id of ['vitals', 'focus', 'actions', 'today'] as const) expect(r.has(id)).toBe(true);
    expect(r.has('queue')).toBe(false);
    expect(r.has('journal')).toBe(false);
  });

  it('suggests exploring (with action-visibility) or scouting', () => {
    const a = fresh();
    expect(suggestedAction(a.sim)).toBe('explore');
    const off = { ...a.sim, config: { ...a.sim.config, world: { ...a.sim.config.world, features: { ...a.sim.config.world.features, 'action-visibility': false } } } };
    expect(suggestedAction(off)).toBe('scout');
  });

  it('the journal and the stores after the first night; the stores sooner once something is gathered', () => {
    const a = fresh();
    expect(rule('journal').shown(ctx(a))).toBe(false);
    expect(storesInPlay(a.sim)).toBe(false);
    const next = endTheDay(a);
    expect(rule('journal').shown(ctx(next))).toBe(true);
    expect(rule('stores').shown(ctx(next))).toBe(true);
    const watered = { ...a.sim, flags: { ...a.sim.flags, everWater: true } };
    expect(storesInPlay(watered)).toBe(true);
  });

  it('the queue once planning is learned; Run the day’s line once something is queued', () => {
    const a = fresh();
    const planning: AppState = { ...a, sim: { ...a.sim, canPlan: true } };
    expect(rule('queue').shown(ctx(a))).toBe(false);
    expect(rule('queue').shown(ctx(planning))).toBe(true);
    expect(rule('runDay').shown(ctx(planning))).toBe(false);
    const queued = enqueue(planning, 'explore');
    expect(rule('runDay').shown(ctx(queued))).toBe(true);
    expect(usedNow(ctx(queued))).toContain('queue');
  });

  it('the places to camp once a suitable one is known (rated good or great), and always once camp is made', () => {
    const a = fresh();
    expect(knownSpots(a.sim).length).toBe(1); // where the run starts, rated poor
    expect(suitableSiteKnown(a.sim)).toBe(false);
    const camped = act(a, { q: 'camp', opts: { spot: knownSpots(a.sim)[0].id } });
    expect(camped.sim.site).not.toBeNull();
    expect(suitableSiteKnown(camped.sim)).toBe(true);
    expect(guideFinished(camped.sim)).toBe(true);
    expect(usedNow(ctx(camped))).toContain('sites');
  });

  it('where the run starts can rate good: then the places to camp come with the actions, after the weather', () => {
    const a = makeWarden({ id: 'w-guide-1', name: 'Ada' });
    expect(suitableSiteKnown(a.sim)).toBe(true);
    expect([...revealedNow(ctx(a, false))]).toEqual(['weather']);
    expect(revealedNow(ctx(a)).has('sites')).toBe(true);
  });

  it('the tools once one is made (or left by an earlier Warden): the pack’s own don’t count', () => {
    const a = fresh();
    expect(a.sim.tools.length).toBeGreaterThan(0); // the pack's
    expect(firstTool(a.sim)).toBe(false);
    expect(firstTool({ ...a.sim, tools: [...a.sim.tools, { item: 'pouch', grade: 'crude', made: {} }] })).toBe(true);
    expect(firstTool({ ...a.sim, tools: [...a.sim.tools, { item: 'pouch', grade: 'crude', heirloom: true }] })).toBe(true);
    const id = Object.keys(a.sim.concepts)[0] ?? 'binding';
    expect(firstTool({ ...a.sim, concepts: { ...a.sim.concepts, [id]: { rank: 0, insight: 1 } as never } })).toBe(true);
  });
});

describe('a played run: nothing that appears disappears again (#1792)', () => {
  it('plays a first week by hand, then by plan, and checks every element after every move', () => {
    let a = fresh();
    let seen = new Set<GuideId>();
    const order: GuideId[] = [];
    let acked = false;
    const check = (label: string) => {
      const now = revealedNow(ctx(a, acked));
      for (const id of seen) {
        if (rule(id).tipOnly) continue;
        expect(now.has(id), `${id} disappeared after ${label}`).toBe(true);
      }
      for (const id of now) if (!seen.has(id)) order.push(id);
      seen = new Set([...seen, ...[...now].filter(id => !rule(id).tipOnly)]);
    };
    check('the start');
    acked = true;
    check('the weather');
    for (let day = 0; day < 12 && !a.sim.outcome; day++) {
      if (!a.sim.canPlan) {
        for (const q of ['explore', 'water', 'explore', 'gather'] as const) { a = settleEncounter(act(a, q)); check(`${q} on day ${a.sim.day}`); }
        a = settleEncounter(endTheDay(a));
        check(`the night of day ${a.sim.day - 1}`);
        continue;
      }
      // Planning: queue a day, make camp once a suitable place is known, and run it.
      const good = suitableSiteKnown(a.sim) && a.sim.site === null ? knownSpots(a.sim).find(p => !p.start) : undefined;
      a = enqueue(a, 'explore');
      if (good) a = enqueue(a, { q: 'camp', opts: { spot: good.id } });
      a = enqueue(a, 'wood');
      check(`queueing on day ${a.sim.day}`);
      a = settleEncounter(runQueuedDay(a));
      check(`day ${a.sim.day - 1}`);
    }
    // The run got far enough for the whole first morning to unfold.
    for (const id of ['weather', 'vitals', 'focus', 'actions', 'today', 'queue', 'journal', 'stores', 'sites'] as const) expect(seen.has(id), id).toBe(true);
    expect(order.slice(0, 4)).toEqual(['weather', 'vitals', 'focus', 'actions']);
    expect(a.sim.canPlan).toBe(true);
    expect(siteRatingCounts(a.sim).good + siteRatingCounts(a.sim).great > 0 || a.sim.site !== null).toBe(true);
  });
});

describe('the lines (#1792)', () => {
  it('come one at a time, in the registry’s order, and never once the player has played before', () => {
    const r = revealedNow(ctx(fresh()));
    expect(activeTip(r, [], false)).toBe('weather');
    expect(activeTip(r, ['weather'], false)).toBe('vitals');
    expect(activeTip(r, ['weather', 'vitals'], false)).toBe('focus');
    expect(activeTip(r, ['weather', 'vitals', 'focus'], false)).toBe('actions');
    expect(activeTip(r, ['weather', 'vitals', 'focus', 'actions'], false)).toBeNull();
    expect(activeTip(r, [], true)).toBeNull();
  });

  it('every element has a line in English and Swedish, short enough for two lines', () => {
    const tEn = makeT('en'), tSv = makeT('sv');
    for (const r of REVEALS) {
      expect(r.line, r.id).toBeTruthy();
      expect(en[r.line!], r.id).toBeTruthy();
      expect(sv[r.line!], r.id).toBeTruthy();
      expect(tSv(r.line!)).not.toBe(tEn(r.line!));
      for (const text of [tEn(r.line!), tSv(r.line!)]) expect(text.length, text).toBeLessThanOrEqual(130);
    }
    expect(tSv('guide.playedBefore')).toBe('Jag har spelat förut');
    expect(tEn('guide.playedBefore')).toBe("I've played before");
  });
});

describe('the device’s record (#1792)', () => {
  it('keeps one run: seen lines and shown elements, and a new Warden starts again', () => {
    let rec = guideFor(EMPTY_GUIDE, 'w-a', false);
    rec = markSeen(rec, ['weather', 'vitals']);
    rec = markShown(rec, ['weather', 'vitals', 'focus']);
    expect(markSeen(rec, ['weather'])).toBe(rec);
    expect(markShown(rec, ['focus'])).toBe(rec);
    expect(readGuide(JSON.stringify(rec))).toEqual(rec);
    expect(guideFor(rec, 'w-a', true)).toBe(rec);
    const next = guideFor(markDone(rec), 'w-b', true);
    expect(next).toEqual({ done: true, run: { id: 'w-b', seen: [], shown: [], playedBefore: true } });
  });

  it('"Show the guide again" brings the lines back and keeps what was shown; "I\'ve played before" flips', () => {
    let rec = markShown(markSeen(guideFor(EMPTY_GUIDE, 'w-a', true), GUIDE_IDS), ['vitals']);
    rec = showGuideAgain(rec);
    expect(rec.run).toEqual({ id: 'w-a', seen: [], shown: ['vitals'], playedBefore: false });
    expect(setPlayedBefore(rec, true).run?.playedBefore).toBe(true);
  });

  it('reads junk as nothing, drops unknown ids, and survives storage that throws', () => {
    expect(readGuide(null)).toEqual(EMPTY_GUIDE);
    expect(readGuide('{not json')).toEqual(EMPTY_GUIDE);
    expect(readGuide('[1,2]')).toEqual({ done: false, run: null });
    expect(readGuide(JSON.stringify({ done: true, run: { id: 'w', seen: ['weather', 'nope', 3], shown: 'x', playedBefore: 'yes' } })))
      .toEqual({ done: true, run: { id: 'w', seen: ['weather'], shown: [], playedBefore: false } });
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadGuide(broken)).toEqual(EMPTY_GUIDE);
    expect(() => saveGuide(EMPTY_GUIDE, broken)).not.toThrow();
    const kept: Record<string, string> = {};
    const mem = { getItem: (k: string) => kept[k] ?? null, setItem: (k: string, v: string) => { kept[k] = v; } };
    const rec = markSeen(guideFor(EMPTY_GUIDE, 'w-a', false), ['weather']);
    saveGuide(rec, mem);
    expect(loadGuide(mem)).toEqual(rec);
  });
});
