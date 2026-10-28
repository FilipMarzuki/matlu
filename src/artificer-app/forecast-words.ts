/**
 * Forecasts in words (#1827, rules feature `forecasts`): what an action card says when the Warden
 * is still learning the task or the craft, and the queue's forecast of the day and the days after.
 *
 * Two states feed every forecast. `known` is the run as it is (the sim the page holds): what the
 * Warden has actually done, their INT, the days played. `s` is the state the card or row is judged
 * in (the queue's projection): the numbers a trip would bring there. Familiarity is read from
 * `known` only, so queueing wood four times doesn't make you know wood: doing it does.
 *
 * Every rough word goes through `judged` (forecasts.ts): sometimes one step off, from a seeded
 * generator of its own, so the page shows the same words on every redraw. A card's word is keyed by
 * the run, the day and the card (`cardRand`), so editing the queue never redraws it; the day's and
 * the days' verdicts also by the queue's contents (`forecastRand`), since they judge the queue as a
 * whole. Exact numbers are never misjudged.
 *
 * Pure: states in, text (or the parts of it) out. The page (camp-blocks.ts, main.ts), the play
 * API's text (view-words.ts) and the AI's observation (observe.ts, in English) all read these.
 */

import type { T } from '../artificer/i18n';
import { ACTIONS, craftOutlook, parseItem, queueHours, queueId, huntOddsOf, type ActionId, type QueueItem } from '../artificer/region1';
import type { Ring } from '../artificer/exploration';
import type { Stack } from '../artificer/crafting';
import {
  forecastsOn, taskKey, craftKey, familiarity, knowThreshold, knowing, misjudgeChance, judged, forecastRand, cardRand, queueKeyOf,
  roughAmount, roughQty, craftBand, CRAFT_BANDS, roughGrade, dayForecastOpen, farForecastOpen, type Knowing, type CraftBand,
} from '../artificer/forecasts';
import { PROVISION_TASKS, yieldAmounts } from './yield-amounts';
import { actionName, gradeWord, recipeName } from './sim-words';
import { esc } from './html';
import type { AppState, QueuePreview } from './controller';

type Sim = AppState['sim'];

/** What each trip's rough word is a quantity of. */
const WHAT: Partial<Record<ActionId, 'food' | 'water' | 'wood' | 'stone'>> = {
  gather: 'food', hunt: 'food', traps: 'food', fish: 'food', water: 'water', wood: 'wood', quarry: 'stone', gatherstone: 'stone',
};

/** Crafts: the actions that make something (a recipe), whose cards forecast success, grade and cost. */
export const isCraft = (id: ActionId): boolean => !!(ACTIONS[id].recipe || ACTIONS[id].recipeFor);

const chanceFor = (known: Sim, fam: number, daysAhead = 0): number =>
  misjudgeChance(known.character.stats.int, fam, knowThreshold(known.character.stats.int), daysAhead);

/** A provisioning trip's true rough level (0 a little, 1 some, 2 plenty) where it's judged. */
export function taskLevel(id: ActionId, s: Sim, r: Ring): number | null {
  const a = yieldAmounts(id, s, r);
  return a ? roughAmount(a.n + (a.m ?? 0)) : null;
}

/**
 * A provisioning trip's card with `forecasts` on, or null when the card shows its numbers as
 * before (switch off, not a trip, or done N times at this distance). Never done at this distance:
 * unknown, even if it's known nearer in. Fewer than N: a rough word, sometimes a step off.
 */
export function taskCard(known: Sim, s: Sim, id: ActionId, r: Ring, t: T): { knowing: Knowing; level: number | null; text: string } | null {
  if (!forecastsOn(known) || !PROVISION_TASKS.includes(id)) return null;
  const key = taskKey(id, r);
  const k = knowing(known, key);
  if (k === 'exact') return null;
  if (k === 'unknown') return { knowing: k, level: null, text: t('fc.task.unknown') };
  const truth = taskLevel(id, s, r) ?? 0;
  const level = judged(truth, 3, chanceFor(known, familiarity(known, key)), cardRand(known, key));
  // A hunt's or a trap line's odds are already words (#1821): they stay.
  const odds = id === 'hunt' || id === 'traps' ? huntOddsOf(s, id, r) ?? (id === 'traps' ? 'fair' : null) : null;
  const text = t(`fc.amount.${level as 0 | 1 | 2}`, { what: t(`fc.what.${WHAT[id]!}`) }) + (odds ? ` · ${t(`odds.hunt.${odds}`)}` : '');
  return { knowing: k, level, text };
}

/** One input as a rough amount: the item and its word level (0 a little, 1 some, 2 a lot). */
export interface RoughInput { item: string; level: number }

export interface CraftCard {
  knowing: Knowing;
  /** The card's line: what it's for and how sure you are, or (made N times) today's line with the odds band and grade. */
  text: string;
  /** The verdict shown (rough) or the real band (exact); null when never made. */
  band: CraftBand | null;
  /** The grade level shown (0 rough, 1 decent, 2 good), or the real grade made N times; null when none is said. */
  grade: number | string | null;
  /** The inputs in rough words, or null when the exact chips show. */
  rough: RoughInput[] | null;
  /** "You may waste some of it": shown with the rough cost when it could fail. */
  waste: boolean;
}

/**
 * A craft's card with `forecasts` on, or null when it shows as before (switch off, not a craft,
 * nothing to make). Never made: you're not sure you can, and the cost in rough words. Fewer than
 * N tries: success and the likely grade in words (a step off at times), the cost roughly, and the
 * waste warning when it could fail. N or more: `exact` (today's line, the odds band, the grade).
 */
export function craftCard(known: Sim, s: Sim, id: ActionId, t: T, exactLine: string, item: QueueItem = queueId(id)): CraftCard | null {
  if (!forecastsOn(known) || !isCraft(id)) return null;
  const o = craftOutlook(s, item);
  if (!o) return null;
  const key = craftKey(o.recipe.id);
  const k = knowing(known, key);
  const truth = craftBand(o.score);
  if (k === 'exact') {
    const grade = o.grade ? ` · ${t('fc.gradeExact', { grade: gradeWord(o.grade, t) })}` : '';
    return { knowing: k, text: `${exactLine} · ${t(`fc.odds.${truth}`)}${grade}`, band: truth, grade: o.grade, rough: null, waste: false };
  }
  const chance = chanceFor(known, familiarity(known, key));
  const rand = cardRand(known, key);
  // Cost in rough words: each input judged too ("can be off by a step").
  const rough = o.recipe.inputs.map((i: Stack) => ({ item: i.item, level: judged(roughQty(i.qty), 3, chance, rand) }));
  const purpose = t(`fc.purpose.${id}` as Parameters<T>[0]);
  if (k === 'unknown') return { knowing: k, text: `${purpose} · ${t('fc.craft.unknown')}`, band: null, grade: null, rough, waste: false };
  const band = CRAFT_BANDS[judged(CRAFT_BANDS.indexOf(truth), 3, chance, rand)];
  // The likely grade: from the grade it would come out at (a failure reads as rough work, if you think you'd manage).
  const grade = band === 'beyond' ? null : judged(o.grade ? roughGrade(o.grade) : 0, 3, chance, rand);
  const text = `${purpose} · ${t(`fc.craft.${band}`)}${grade === null ? '' : ` · ${t(`fc.grade.${grade as 0 | 1 | 2}`)}`}`;
  return { knowing: k, text, band, grade, rough, waste: band !== 'likely' };
}

/**
 * The card's yield line, as the page and the API say it (#1827): the forecast's words with
 * `forecasts` on (until the numbers are known), else `exactLine` (`yieldText`) as before.
 */
export function cardYield(known: Sim, s: Sim, id: ActionId, r: Ring, t: T, exactLine: string): string {
  return taskCard(known, s, id, r, t)?.text ?? craftCard(known, s, id, t, exactLine)?.text ?? exactLine;
}

// ── The queue's forecast ────────────────────────────────────────────────────

export interface DayCast {
  /** Days from today (0 today). */
  offset: number;
  /** 0 light · 1 full · 2 exhausting · 3 more than you can manage (as judged). */
  effort: number;
  /** 0 not much · 1 a fair amount · 2 a good haul (as judged). */
  haul: number;
  /** Each craft that day: 0 won't come together · 1 rough · 2 decent · 3 well (as judged). */
  crafts: { id: ActionId; recipe: string; recipeName: string; level: number }[];
  /** The preview's warnings, in the forecast's voice: what won't happen, and what sounds dangerous. */
  skips: ActionId[];
  dangers: ActionId[];
}

export interface QueueCast {
  /** The days forecast: today's (or the first day the queue reaches), and the rest once you can see that far. */
  days: DayCast[];
  /** Later days the Warden can't see yet (offsets). */
  unseen: number[];
  /** The whole stretch, when several days are forecast. */
  stretch: 'worn' | 'steady' | null;
  /** The times the least practised thing in the queue was done: what sets how sure the forecast is. */
  fam: number;
}

/** Effort from the share of a pool the day takes, and its hours: a long day is at least a full one. */
const effortLevel = (share: number, hours: number): number => Math.max(share < 0.3 ? 0 : share < 0.55 ? 1 : share < 0.85 ? 2 : 3, hours >= 10 ? 1 : 0);
/** The haul from everything the day brings into the stores. */
const haulLevel = (n: number): number => (n < 4 ? 0 : n < 10 ? 1 : 2);

/** Is this queued item something the Warden has done (a trip at its distance, a craft's recipe)? Null: nothing to know. */
function itemFamiliarity(known: Sim, before: Sim, item: QueueItem): number | null {
  const { id, ring } = parseItem(item);
  if (PROVISION_TASKS.includes(id)) return familiarity(known, taskKey(id, ring));
  if (!isCraft(id)) return null;
  const o = craftOutlook(before, item);
  return o ? familiarity(known, craftKey(o.recipe.id)) : null;
}

/**
 * The queue's forecast (#1827), or null when there's none: switch off, INT under 9, an empty queue,
 * or anything in it the Warden has never done (at its distance). Effort and haul are read off the
 * preview's own projection (the hours, the drain on the pools, what comes into the stores); crafts
 * off `craftOutlook`. Days past the first show only once the Warden can see that far.
 */
export function queueForecast(a: AppState, preview: QueuePreview): QueueCast | null {
  const known = a.sim;
  if (!forecastsOn(known) || !dayForecastOpen(known) || !a.queue.length) return null;
  const fams = a.queue.map((item, i) => itemFamiliarity(known, preview.before[i], item));
  if (fams.some(f => f === 0)) return null;
  const n = knowThreshold(known.character.stats.int);
  const counted = fams.filter((f): f is number => f !== null);
  // The least practised thing in the queue sets how sure the whole forecast is.
  const fam = counted.length ? Math.min(...counted) : 2 * n;
  const queueKey = queueKeyOf(a.queue);
  const offsets = [...new Set(preview.dayOffset)];
  const far = farForecastOpen(known);
  const cast = (offset: number): DayCast => {
    const idx = a.queue.map((_, i) => i).filter(i => preview.dayOffset[i] === offset);
    const first = preview.before[idx[0]];
    const last = idx[idx.length - 1];
    const after = preview.before[last + 1] ?? preview.projected;
    // Today counts what's already been done today too (a.sim's own `today`); the projection never
    // runs a night, so a later day's load is what that day adds.
    const from = offset === 0 ? { loadVigor: 0, loadClarity: 0 } : first.today;
    const share = Math.max((after.today.loadVigor - from.loadVigor) / Math.max(1, first.vitals.vigor.cap), (after.today.loadClarity - from.loadClarity) / Math.max(1, first.vitals.clarity.cap));
    const hours = (offset === 0 ? known.hoursToday : 0) + idx.reduce((h, i) => h + (preview.warnings[i] ? 0 : queueHours(a.queue[i], preview.before[i])), 0);
    const brought = (Object.keys(after.stores) as (keyof Sim['stores'])[]).reduce((sum, k) => sum + Math.max(0, after.stores[k] - first.stores[k]), 0);
    const chance = chanceFor(known, fam, offset);
    const rand = forecastRand(known, queueKey, `day${offset}`);
    const crafts = idx.filter(i => !preview.warnings[i] && isCraft(parseItem(a.queue[i]).id)).flatMap(i => {
      const o = craftOutlook(preview.before[i], a.queue[i]);
      return o ? [{ id: parseItem(a.queue[i]).id, recipe: o.recipe.id, recipeName: o.recipe.name, level: judged(o.grade ? 1 + roughGrade(o.grade) : 0, 4, chance, rand) }] : [];
    });
    return {
      offset,
      effort: judged(effortLevel(share, hours), 4, chance, rand),
      haul: judged(haulLevel(brought), 3, chance, rand),
      crafts,
      skips: idx.filter(i => preview.warnings[i]).map(i => parseItem(a.queue[i]).id),
      dangers: idx.filter(i => preview.dangers[i]).map(i => parseItem(a.queue[i]).id),
    };
  };
  const days = (far ? offsets : offsets.slice(0, 1)).map(cast);
  const unseen = far ? [] : offsets.slice(1);
  const stretch = days.length >= 2 ? (days.some(d => d.effort >= 2) ? 'worn' : 'steady') : null;
  return { days, unseen, stretch, fam };
}

const lower = (x: string): string => x.charAt(0).toLowerCase() + x.slice(1);
const upper = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);

/** The forecast as lines of text, in the viewer's language. `day` is today's day number. */
export function forecastLines(c: QueueCast, day: number, t: T): string[] {
  const out: string[] = [];
  const name = (id: ActionId): string => lower(actionName(id, t));
  for (const d of c.days) {
    const vars = { effort: t(`fc.effort.${d.effort as 0 | 1 | 2 | 3}`), haul: t(`fc.haul.${d.haul as 0 | 1 | 2}`) };
    out.push(d.offset === 0 ? t('fc.today', vars) : t('fc.dayN', { ...vars, n: day + d.offset }));
    for (const k of d.crafts) out.push(`${upper(t(`fc.dayCraft.${k.level as 0 | 1 | 2 | 3}`, { name: lower(recipeName(k.recipe, t, k.recipeName)) }))}.`);
    for (const id of d.skips) out.push(`${upper(t('fc.daySkip', { name: name(id) }))}.`);
    for (const id of d.dangers) out.push(`${upper(t('fc.dayDanger', { name: name(id) }))}.`);
  }
  for (const o of c.unseen) out.push(t('fc.dayFar', { n: day + o }));
  if (c.stretch) out.push(t(`fc.stretch.${c.stretch}`));
  return out;
}

/** The forecast under the queue (#1827), or nothing when there's none to give. */
export function forecastBlock(a: AppState, preview: QueuePreview, t: T): string {
  const c = queueForecast(a, preview);
  if (!c) return '';
  return `<div class="forecast" aria-live="polite"><span class="fchead">${esc(t('fc.head'))}</span>${forecastLines(c, a.sim.day, t).map(l => `<p>${esc(l)}</p>`).join('')}</div>`;
}
