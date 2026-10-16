/**
 * The first-morning guide (#1792, part 1 of #1791), in the manner of A Dark Room: a box or control on
 * the Plan screen isn't drawn until the player can use it, and once it has appeared it stays. The
 * first time it appears it glows and the scout says a line or two beside it, until the player taps
 * "OK" or uses it. That is the whole tutorial.
 *
 * What's here is pure: the registry of what can be revealed, each element's rule, and the per-device
 * record of what's been seen. main.ts draws it and keeps the record in `localStorage`.
 *
 * - **Nothing new is saved with the game.** Each rule is read from the run's state as it already is
 *   (the day reached, hours worked today, planning learned, places to camp found, camp made, a tool
 *   made...). They only ever turn on as a run goes forward, so a box never vanishes again
 *   (reveal.test.ts plays a run to check). The sim, the save and the golden hashes don't change.
 * - **The one fact that isn't the game's** is whether the weather card has been acknowledged in this
 *   run: that's the guide's own record (the weather's line counts as seen), as the weather fold is
 *   the page's (#1788).
 * - **Sticky:** the record also keeps which elements have been shown in this run. A rule built on a
 *   belief (a place to camp you *think* is good, which camping there may correct) could in principle
 *   turn off again, so what has been shown stays shown: the belt to the rules' braces.
 * - **One line at a time,** the first one due in the order below, so the screen never fills with
 *   tips; the next one shows when that one is dismissed. Nothing is a modal and nothing blocks input.
 * - **"I've played before"** shows everything with no lines, as the screen is without the guide. It's
 *   on by default for a new Warden once this device has been through the guide once.
 *
 * The play API, the console and AI players never see any of this: it's only how the page draws.
 */

import type { Key } from '../artificer/i18n';
import { scouted } from '../artificer/exploration';
import { visibilityOn, type ActionId, type Region1State } from '../artificer/region1';
import { campAsActionOn, knownSpots, siteRatingCounts, siteRatingsOn } from '../artificer/camp-sites';

/**
 * The ui switch is the guide epic's one switch, `guide` (#1791), defined with #1793's Survival path
 * (survival-path.ts `GUIDE_FEATURE`). Off, and the Plan screen is drawn as it was before the guide.
 */
export { GUIDE_FEATURE } from './survival-path';

export type GuideId = 'weather' | 'vitals' | 'focus' | 'actions' | 'today' | 'queue' | 'runDay' | 'journal' | 'stores' | 'sites' | 'tools';

type Sim = Region1State;

/** What the rules read: the run as drawn, how much is queued, and whether the weather card was acknowledged. */
export interface GuideCtx {
  sim: Sim;
  queued: number;
  weatherAcked: boolean;
}

export interface Revealable {
  id: GuideId;
  /** Whether the element is on the screen. Pure, and only ever turns on as the run goes forward. */
  shown: (c: GuideCtx) => boolean;
  /** The scout's line the first time it appears (en and sv catalogs, `guide.line.*`). */
  line?: Key;
  /**
   * The line is only a tip: the element is drawn anyway (as part of another), and `shown` says when
   * its line is due. "Run the day" sits on the queue from the start; it glows when something's queued.
   */
  tipOnly?: true;
  /** The player has clearly done what the line says: it counts as seen without the OK. */
  used?: (c: GuideCtx) => boolean;
}

/** The run is under way: an hour worked today, or a day already behind. */
export const began = (s: Pick<Region1State, 'day' | 'hoursToday'>): boolean => s.day > 1 || s.hoursToday > 0;

/** Camp has been made (camp-view.ts `hasCamp`; a site is never unset once chosen). */
const camped = (s: Pick<Region1State, 'site'>): boolean => s.site !== null;

/**
 * A suitable place to camp is known. With site ratings (#1756), one you believe good or great; with
 * camp as an action alone, any place to camp found besides where you started; before that, the land
 * close by scouted (when the site picker opens). And once camp is made, always.
 */
export function suitableSiteKnown(s: Sim): boolean {
  if (camped(s)) return true;
  if (siteRatingsOn(s)) { const c = siteRatingCounts(s); return c.great + c.good > 0; }
  if (campAsActionOn(s)) return knownSpots(s).some(p => !p.start);
  return scouted(s.explore, 1);
}

/**
 * A tool of your own: one you made this run (it carries what its maker knew, `made`) or one an
 * earlier Warden left, or any concept worked at. The pack's own tools don't count: they're there
 * from the first morning, and the box would show before there's anything to say about it.
 */
export const firstTool = (s: Pick<Region1State, 'tools' | 'concepts'>): boolean =>
  s.tools.some(t => t.made !== undefined || t.heirloom === true) || Object.values(s.concepts).some(p => p.rank > 0 || p.insight > 0);

/** Something gathered (water, food, wood, a hunt), or the first night behind you, when supper came out of the stores. */
export const storesInPlay = (s: Pick<Region1State, 'day' | 'flags'>): boolean =>
  s.day > 1 || s.flags.everWater || s.flags.everFood || s.flags.everWood || s.flags.everHunt;

/** The action the guide suggests first: explore (with `action-visibility`) or scout, whichever the run has. */
export const suggestedAction = (s: Pick<Region1State, 'config'>): ActionId => (visibilityOn(s) ? 'explore' : 'scout');

const afterWeather = (c: GuideCtx): boolean => c.weatherAcked || began(c.sim);

/** The Plan screen's elements, in the order the first morning reveals them (and their lines are due). */
export const REVEALS: readonly Revealable[] = [
  { id: 'weather', shown: () => true, line: 'guide.line.weather', used: c => c.weatherAcked },
  { id: 'vitals', shown: afterWeather, line: 'guide.line.vitals' },
  { id: 'focus', shown: afterWeather, line: 'guide.line.focus' },
  { id: 'actions', shown: afterWeather, line: 'guide.line.actions', used: c => began(c.sim) },
  // Before planning is learned (#1350): one thing at a time, and End the day.
  { id: 'today', shown: c => began(c.sim), line: 'guide.line.today', used: c => c.sim.day > 1 || c.sim.canPlan },
  { id: 'queue', shown: c => c.sim.canPlan, line: 'guide.line.queue', used: c => c.queued > 0 },
  { id: 'runDay', shown: c => c.sim.canPlan && c.queued > 0, line: 'guide.line.runDay', tipOnly: true },
  { id: 'journal', shown: c => c.sim.day > 1 || c.sim.outcome !== null, line: 'guide.line.journal' },
  { id: 'stores', shown: c => storesInPlay(c.sim), line: 'guide.line.stores' },
  // After the weather too: where the run starts can itself rate good, and an earlier Warden can leave tools.
  { id: 'sites', shown: c => afterWeather(c) && suitableSiteKnown(c.sim), line: 'guide.line.sites', used: c => camped(c.sim) },
  { id: 'tools', shown: c => afterWeather(c) && firstTool(c.sim), line: 'guide.line.tools' },
];

export const GUIDE_IDS: readonly GuideId[] = REVEALS.map(r => r.id);
export const isGuideId = (x: unknown): x is GuideId => typeof x === 'string' && (GUIDE_IDS as readonly string[]).includes(x);

/** The elements whose rule holds now, plus those already shown this run (`sticky`). */
export function revealedNow(c: GuideCtx, sticky: readonly string[] = []): Set<GuideId> {
  return new Set(REVEALS.filter(r => r.shown(c) || sticky.includes(r.id)).map(r => r.id));
}

/** The lines the player has plainly acted on already: they count as seen. */
export const usedNow = (c: GuideCtx): GuideId[] => REVEALS.filter(r => r.used?.(c)).map(r => r.id);

/** The one line to show now: the first element revealed with a line not yet seen. None when the player has played before. */
export function activeTip(revealed: ReadonlySet<GuideId>, seen: readonly string[], playedBefore: boolean): GuideId | null {
  if (playedBefore) return null;
  return REVEALS.find(r => r.line && revealed.has(r.id) && !seen.includes(r.id))?.id ?? null;
}

/** The guide has done its work in a run: camp is made (or the run is over). The device then counts as having been through it. */
export const guideFinished = (s: Pick<Region1State, 'site' | 'outcome'>): boolean => camped(s) || s.outcome !== null;

// ── The device's record ───────────────────────────────────────────────────────

export const GUIDE_KEY = 'artificer.guide.v1';

/** One run's part: which lines were seen, which elements shown, and the "I've played before" toggle. */
export interface GuideRun { id: string; seen: GuideId[]; shown: GuideId[]; playedBefore: boolean }

/**
 * What the device keeps: whether it has been through the guide once, and the current run's part. Only
 * the current run's, so the record never grows: a new Warden starts a new one.
 */
export interface GuideRecord { done: boolean; run: GuideRun | null }

export const EMPTY_GUIDE: GuideRecord = { done: false, run: null };

const ids = (x: unknown): GuideId[] => (Array.isArray(x) ? [...new Set(x.filter(isGuideId))] : []);

/** The stored record, or an empty one when there's nothing (or junk) stored. */
export function readGuide(raw: string | null): GuideRecord {
  if (raw === null) return EMPTY_GUIDE;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return EMPTY_GUIDE;
    const o = v as Record<string, unknown>;
    const r = o.run as Record<string, unknown> | null | undefined;
    const run = r && typeof r === 'object' && typeof r.id === 'string'
      ? { id: r.id, seen: ids(r.seen), shown: ids(r.shown), playedBefore: r.playedBefore === true }
      : null;
    return { done: o.done === true, run };
  } catch {
    return EMPTY_GUIDE;
  }
}

/**
 * The record for this run. A run the record hasn't met starts with nothing seen, and with "I've
 * played before" on if `playedBefore` says so (main.ts: the device has been through the guide, or
 * this run was already under way when the guide first met it).
 */
export function guideFor(rec: GuideRecord, runId: string, playedBefore: boolean): GuideRecord {
  if (rec.run?.id === runId) return rec;
  return { ...rec, run: { id: runId, seen: [], shown: [], playedBefore } };
}

const add = (list: readonly GuideId[], more: Iterable<GuideId>): GuideId[] => [...new Set([...list, ...more])];

/** Lines seen (OK, or the element used). Returns the same record when nothing changes. */
export function markSeen(rec: GuideRecord, seen: Iterable<GuideId>): GuideRecord {
  if (!rec.run) return rec;
  const next = add(rec.run.seen, seen);
  return next.length === rec.run.seen.length ? rec : { ...rec, run: { ...rec.run, seen: next } };
}

/** Elements shown (kept, so they stay). Returns the same record when nothing changes. */
export function markShown(rec: GuideRecord, shown: Iterable<GuideId>): GuideRecord {
  if (!rec.run) return rec;
  const next = add(rec.run.shown, shown);
  return next.length === rec.run.shown.length ? rec : { ...rec, run: { ...rec.run, shown: next } };
}

/** "I've played before", on or off. */
export const setPlayedBefore = (rec: GuideRecord, on: boolean): GuideRecord => (rec.run ? { ...rec, run: { ...rec.run, playedBefore: on } } : rec);

/** "Show the guide again": the lines come back (the elements already shown stay), and "played before" goes off. */
export const showGuideAgain = (rec: GuideRecord): GuideRecord => (rec.run ? { ...rec, run: { ...rec.run, seen: [], playedBefore: false } } : rec);

/** The device has been through the guide. */
export const markDone = (rec: GuideRecord): GuideRecord => (rec.done ? rec : { ...rec, done: true });

// ── Storage (it can be missing or refuse: then the guide holds until the page is closed) ──

export type GuideStore = Pick<Storage, 'getItem' | 'setItem'>;

const storage = (): GuideStore | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function loadGuide(store: GuideStore | null = storage()): GuideRecord {
  try {
    return readGuide(store?.getItem(GUIDE_KEY) ?? null);
  } catch {
    return EMPTY_GUIDE;
  }
}

export function saveGuide(rec: GuideRecord, store: GuideStore | null = storage()): void {
  try { store?.setItem(GUIDE_KEY, JSON.stringify(rec)); } catch { /* this visit only */ }
}
