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
import { makeWarden, act, choose, endTheDay, enqueue, previewQueue, runQueuedDay, type AppState } from './controller';
import { APP_TABS, tabIsDev, tabToOpen, visibleTabs } from './feature-choices';
import {
  GUIDE_FEATURE, GUIDE_IDS, REVEALS, EMPTY_GUIDE, PROGRESS_DAY, TAB_GUIDE, activeTip, began, coldNightAhead, firstTool, guideFinished, guideFor,
  heldTabs, landKnown, markDone, markSeen, markShown, queueReach, readGuide, revealedNow, setPlayedBefore, showGuideAgain, skillCameEasier, snowStays,
  storesInPlay, suggestedAction, suitableSiteKnown, usedNow, loadGuide, saveGuide,
  type GuideCtx, type GuideId, type GuideRecord,
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

// ── The tabs and the just-in-time tips (#1794) ────────────────────────────────

const TAB_IDS = APP_TABS.map(d => d.id);
const TIP_IDS = ['injury', 'lock', 'cold', 'snow', 'skill', 'longQueue'] as const;
const shownIn = (c: GuideCtx, sticky: readonly string[] = []) => { const r = revealedNow(c, sticky); return (id: GuideId) => r.has(id); };
/** The tabs drawn for a state with the guide at work (not in dev mode). */
const tabsFor = (c: GuideCtx, sticky: readonly string[] = []): string[] =>
  visibleTabs(APP_TABS, { dev: false, camp: c.sim.site !== null, held: heldTabs(TAB_IDS, shownIn(c, sticky)) }).map(d => d.id);
const withLog = (a: AppState, text: string, kind: 'milestone' | 'action' = 'milestone'): AppState => ({ ...a, sim: { ...a.sim, log: [...a.sim.log, { day: a.sim.day, text, kind }] } });
const onDay = (a: AppState, day: number): AppState => ({ ...a, sim: { ...a.sim, day } });
const CAME_EASIER = 'The axe finds the grain more easily now — woodcraft comes easier.';

describe('the tabs (#1794)', () => {
  it('a fresh run with the guide shows PLAN alone; with nothing held (the guide off) the tabs are as before', () => {
    const a = fresh();
    expect(tabsFor(ctx(a, false))).toEqual(['plan']);
    expect(tabsFor(ctx(a))).toEqual(['plan']);
    expect(heldTabs(TAB_IDS, () => true).size).toBe(0);
    expect(visibleTabs(APP_TABS, { dev: false, camp: false }).map(d => d.id)).toEqual(['plan', 'land', 'progress']);
  });

  it('CAMP once camp is made', () => {
    const a = fresh();
    expect(rule('camp').shown(ctx(a))).toBe(false);
    const camped = act(a, { q: 'camp', opts: { spot: knownSpots(a.sim)[0].id } });
    expect(rule('camp').shown(ctx(camped))).toBe(true);
    expect(tabsFor(ctx(camped))).toContain('camp');
  });

  it('LAND once ground out there is at least suspected (or a place to camp found, or the map drawable): not for what’s in sight on the first morning', () => {
    const a = fresh();
    expect(landKnown(a.sim)).toBe(false);
    const k = a.sim.explore.known;
    const suspected: AppState = { ...a, sim: { ...a.sim, explore: { ...a.sim.explore, known: { ...k, 1: { ...k[1], water: 1 } } } } };
    expect(landKnown(suspected.sim)).toBe(true);
    expect(rule('land').shown(ctx(suspected))).toBe(true);
    expect(rule('land').shown(ctx(suspected, false))).toBe(false); // after the weather, like the rest
    expect(tabsFor(ctx(suspected))).toEqual(['plan', 'land']);
  });

  it('the guide never holds the Warden back (#1807): no Warden tab or rule; the skill tip (the header button’s glow) once a skill comes easier', () => {
    const a = fresh();
    expect(GUIDE_IDS).not.toContain('warden');
    expect(Object.values(TAB_GUIDE)).not.toContain('warden');
    expect(heldTabs(['warden'], () => false).size).toBe(0);
    expect(Object.values(a.sim.skills).some(h => (h ?? 0) > 0)).toBe(true); // a scout's training doesn't count
    expect(rule('skill').shown(ctx(a))).toBe(false);
    expect(skillCameEasier(withLog(a, CAME_EASIER).sim)).toBe(true);
    expect(skillCameEasier(withLog(a, CAME_EASIER, 'action').sim)).toBe(false);
    expect(rule('skill').shown(ctx(withLog(a, CAME_EASIER)))).toBe(true);
  });

  it(`PROGRESS (and dev mode's HISTORY) from day ${PROGRESS_DAY}`, () => {
    const a = fresh();
    expect(rule('progress').shown(ctx(onDay(a, PROGRESS_DAY - 1)))).toBe(false);
    expect(rule('progress').shown(ctx(onDay(a, PROGRESS_DAY)))).toBe(true);
    expect(TAB_GUIDE.history).toBe('progress');
    const held = heldTabs(TAB_IDS, shownIn(ctx(onDay(a, PROGRESS_DAY - 1))));
    expect(held.has('history') && held.has('progress')).toBe(true);
    expect(tabsFor(ctx(onDay(a, PROGRESS_DAY)))).toContain('progress');
  });

  it('dev mode shows held tabs early, tagged DEV; an open tab that’s held falls back to PLAN', () => {
    const held = new Set(['land', 'progress', 'history', 'camp']);
    expect(visibleTabs(APP_TABS, { dev: true, camp: false, held }).map(d => d.id)).toEqual(TAB_IDS);
    expect(tabIsDev(APP_TABS.find(d => d.id === 'land')!, { dev: true, camp: false, held })).toBe(true);
    expect(tabToOpen('land', APP_TABS, { dev: false, camp: false, held })).toBe('plan');
    expect(tabToOpen('land', APP_TABS, { dev: false, camp: false })).toBe('land');
  });
});

describe('the just-in-time tips’ rules (#1794)', () => {
  it('none on a fresh run, and none of them hides anything', () => {
    const r = revealedNow(ctx(fresh()));
    for (const id of TIP_IDS) {
      expect(r.has(id), id).toBe(false);
      expect(rule(id).tipOnly, id).toBe(true);
    }
  });

  it('the first injury, the survival lock, the snow, and a skill come easier', () => {
    const a = fresh();
    expect(rule('injury').shown(ctx({ ...a, sim: { ...a.sim, injuries: [{ kind: 'sprain' } as never] } }))).toBe(true);
    expect(rule('lock').shown(ctx({ ...a, sim: { ...a.sim, deprivation: { hungry: 0, thirsty: 1 } } }))).toBe(true);
    const winter = a.sim.config.calendar.winterDay;
    expect(snowStays(onDay(a, winter - 1).sim)).toBe(false);
    expect(rule('snow').shown(ctx(onDay(a, winter)))).toBe(true);
    expect(rule('skill').shown(ctx(withLog(a, CAME_EASIER)))).toBe(true);
  });

  it('a cold night ahead: tonight wants a fire (once the run is under way)', () => {
    const a = fresh();
    expect(coldNightAhead(a.sim)).toBe(false);
    const deep = a.sim.config.calendar.winterDay + 10;
    const going = onDay(act(a, suggestedAction(a.sim)), deep);
    expect(coldNightAhead(going.sim)).toBe(true);
    expect(rule('cold').shown(ctx(going))).toBe(true);
  });

  it('the queue reaching past today, from its preview', () => {
    expect(queueReach([])).toBe(0);
    expect(queueReach([0, 0])).toBe(1);
    expect(queueReach([0, 0, 1])).toBe(2);
    const a = fresh();
    let p: AppState = { ...a, sim: { ...a.sim, canPlan: true } };
    for (let i = 0; i < 8; i++) p = enqueue(p, 'explore');
    const days = queueReach(previewQueue(p).dayOffset);
    expect(days).toBeGreaterThan(1);
    expect(rule('longQueue').shown({ ...ctx(p), queueDays: days })).toBe(true);
    expect(rule('longQueue').shown({ ...ctx(p), queueDays: 1 })).toBe(false);
  });
});

/** One draw of the page's guide, as main.ts `guideView` works it out, with the player tapping OK on each line as it shows. */
function step(rec: GuideRecord, c: GuideCtx, said: GuideId[]): GuideRecord {
  let r = markSeen(rec, usedNow(c));
  const revealed = revealedNow(c, r.run!.shown);
  r = markShown(r, revealed);
  for (let tip = activeTip(revealed, r.run!.seen, r.run!.playedBefore); tip; tip = activeTip(revealed, r.run!.seen, r.run!.playedBefore)) {
    said.push(tip);
    r = markSeen(r, [tip]);
  }
  return r;
}

describe('a long run: tabs stay, each tip once (#1794)', () => {
  /**
   * A first week played (by hand, then by plan: a long queue every third day, camp once a suitable
   * place is known), then the calendar run on into the winter from where it got to. The sim's
   * survival isn't what's tested here; the days ahead are what the tips need.
   */
  function play(onEach: (c: GuideCtx) => void): AppState {
    let a = fresh();
    const look = () => onEach({ ...ctx(a), queueDays: queueReach(previewQueue(a).dayOffset) });
    look();
    for (let day = 0; day < 6 && !a.sim.outcome; day++) {
      if (!a.sim.canPlan) {
        for (const q of ['explore', 'water', 'explore', 'gather'] as const) { a = settleEncounter(act(a, q)); look(); }
        a = settleEncounter(endTheDay(a));
        look();
        continue;
      }
      const good = suitableSiteKnown(a.sim) && a.sim.site === null ? knownSpots(a.sim).find(p => !p.start) : undefined;
      if (good) a = enqueue(a, { q: 'camp', opts: { spot: good.id } });
      const work = day % 3 === 0 ? ['explore', 'wood', 'water', 'gather', 'wood', 'explore', 'wood'] as const : ['wood', 'water', 'gather'] as const;
      for (const q of work) a = enqueue(a, q);
      look();
      a = settleEncounter(runQueuedDay(a));
      look();
    }
    expect(a.sim.outcome).toBeNull();
    const winter = a.sim.config.calendar.winterDay;
    for (let d = a.sim.day + 1; d <= winter + 12; d++) { a = { ...onDay(a, d), queue: [] }; look(); }
    return a;
  }

  it('no tab that has appeared disappears, by the rules alone, and every tab appears', () => {
    const had = new Set<string>();
    const end = play(c => {
      const now = tabsFor(c);
      for (const id of had) expect(now, `${id} on day ${c.sim.day}`).toContain(id);
      for (const id of now) had.add(id);
    });
    expect(end.sim.day).toBeGreaterThan(end.sim.config.calendar.winterDay);
    expect([...had].sort()).toEqual(['camp', 'land', 'plan', 'progress']);
  });

  it('each line shows once, never with "I’ve played before", and comes back with "Show the guide again"', () => {
    const said: GuideId[] = [];
    let record = guideFor(EMPTY_GUIDE, 'w-probe-1', false);
    let last: GuideCtx | null = null;
    play(c => { record = step(record, c, said); last = c; });
    expect(new Set(said).size).toBe(said.length);
    for (const id of ['cold', 'snow', 'skill', 'longQueue', 'camp', 'land', 'progress'] as const) expect(said, id).toContain(id);
    // Each in its moment: the tabs' lines in the order the run reached them, the snow's after the rest.
    expect(said.indexOf('camp')).toBeLessThan(said.indexOf('snow'));

    const quiet: GuideId[] = [];
    let played = guideFor(EMPTY_GUIDE, 'w-probe-1', true);
    play(c => { played = step(played, c, quiet); });
    expect(quiet).toEqual([]);

    // "Show the guide again": the lines of what has appeared come back, one at a time, in the registry's order.
    const again: GuideId[] = [];
    step(showGuideAgain(record), last!, again);
    for (const id of ['snow', 'skill', 'camp', 'land', 'progress'] as const) expect(again, id).toContain(id);
    expect(again).toEqual(REVEALS.map(r => r.id).filter(id => again.includes(id)));
  });
});
