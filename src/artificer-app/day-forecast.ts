/**
 * Where the day ends, in words (#1930, ui feature `day-forecast`; roadmap item 8 of the design
 * review #1914, F8 and §1.6).
 *
 * Before you run the day, the queue said "15.4 / 14h · ends NIGHT" and each task's haul, but not
 * where all that leaves you at dusk. WalkScape shows one number before you commit ("1,240 steps");
 * this says one sentence under the queue, and on the phone's queue strip:
 *
 *   "Back at camp by dusk, tired, with wood for 3 nights."
 *
 * - **When and where:** when today's last task ends (the time in words, `time-words`, or the clock
 *   with the hours shown), and where you are then: back at camp after a trip, done at camp, at a
 *   camp you've just made, or still out on the land with a night under the sky ahead (#1839).
 * - **How tired:** the worse of Vigor and Clarity at dusk, in the word the header will show then
 *   (vital-words.ts).
 * - **What the trips bring:** each key store (food, water, firewood) one of today's trips fills, as
 *   the nights it covers at dusk: the same counts as the key box (food one meal a night, water one
 *   drink) and the winter outlook (firewood at each night's burn), so the line, the status bar and
 *   the "where you stand" line agree.
 *
 * Everything is read off the queue's preview (controller.ts `previewQueue`): the state each task
 * runs in, and the state after the last one. Today's dusk is the state the first of tomorrow's
 * tasks starts in (or the end, if all of the queue runs today). The preview runs no night, so
 * nothing about tonight is guessed.
 *
 * **What you can't know, it doesn't say** (rules feature `forecasts`, #1827). A trip's haul is
 * learned by doing it, so a store filled by a trip you've never done there is "whatever wood you
 * find" (several such stores said together), and one you've done a few times is the card's rough word ("some more wood"), the same word
 * the card and the queue row show. How tired a whole day will leave you is the day forecast's to
 * judge: with it closed (INT under 9, or something in the queue never done) the line leaves
 * tiredness out, and with it open the word is judged like the forecast's own verdicts (sometimes a
 * step off, from a seeded generator of its own, so it doesn't flicker as the page redraws).
 *
 * Pure: the app's state and the preview in, data (`dayEnd`) and then text (`dayEndText`) out, so a
 * unit test reads it without a browser. Nothing is saved, no sim stream is drawn from, and the AI's
 * observation (observe.ts) and the play API never see it.
 */

import type { Key, T } from '../artificer/i18n';
import { ACTIONS, parseItem, winterOutlook, type ActionId } from '../artificer/region1';
import { awayFromCamp } from '../artificer/directed-explore';
import { endWords, type DayPart } from '../artificer/time-words';
import { forecastRand, forecastsOn, judged, knowThreshold, knowing, misjudgeChance, queueKeyOf, taskKey } from '../artificer/forecasts';
import { queueForecast, taskCard } from './forecast-words';
import { vitalLevel, vitalWord, type VitalLevel } from './vital-words';
import { todayHours, type AppState, type QueuePreview } from './controller';
import { compactEnd } from './plan-layout';
import { esc } from './html';

/** The ui switch (features.ts). Off, the queue's footer is exactly as before. */
export const DAY_FORECAST_FEATURE = 'day-forecast';

/** The key stores the line speaks of, in the key box's order. */
export type Store = 'food' | 'water' | 'wood';
const STORES: readonly Store[] = ['food', 'water', 'wood'];
/** The trips that fill each store. (Stone isn't a key store; a snare line's catch comes overnight.) */
const FILLS: Partial<Record<ActionId, Store>> = { gather: 'food', hunt: 'food', traps: 'food', fish: 'food', water: 'water', wood: 'wood' };

/** Where you are when the day's work is done. */
export type Where =
  /** At camp, after a trip out. */
  | 'back'
  /** Where you were: the day's work was at camp (or there's no camp yet to go back to). */
  | 'done'
  /** At the camp you made today. */
  | 'newcamp'
  /** Out on the land with a camp to go back to: tonight is under the sky. */
  | 'out';

/** A store at dusk, as much as you can tell of it. */
export type StoreEnd =
  /** The nights it covers (`thaw`: it lasts to the thaw). */
  | { store: Store; known: 'exact'; nights: number; thaw: boolean }
  /** A trip you're still learning: the rough word its card shows (0 a little · 1 some · 2 plenty). */
  | { store: Store; known: 'rough'; level: number }
  /** A trip you've never done there. */
  | { store: Store; known: 'unknown' };

export interface DayEnd {
  /** The part of the day the last of today's work ends in. */
  part: DayPart;
  /** The clock it ends at ("19:30") when the hours are shown, else null (the time in words). */
  clock: string | null;
  where: Where;
  /** The worse of Vigor and Clarity at dusk (Vigor on a tie), or null when the Warden can't see that far. */
  tired: { id: 'vigor' | 'clarity'; level: VitalLevel } | null;
  stores: StoreEnd[];
}

/**
 * Where today's plan leaves you, or null when there's nothing to say: the run is over, planning
 * isn't learned yet (one thing at a time, no queue), or nothing in the queue runs today. `words`:
 * whether the time of day is shown in words (time-view.ts `timeWordsShown`), else the clock.
 */
export function dayEnd(a: AppState, preview: QueuePreview, words: boolean, t: T): DayEnd | null {
  const s = a.sim;
  if (s.outcome || !s.canPlan) return null;
  // Today's tasks that run: a refused one takes no time, so it doesn't end the day either.
  const today = a.queue.map((_, i) => i).filter(i => preview.dayOffset[i] === 0 && !preview.warnings[i]);
  if (!today.length) return null;
  const later = preview.dayOffset.findIndex(d => d > 0);
  const dusk = later >= 0 ? preview.before[later] : preview.projected;
  const hours = todayHours(a, preview);
  const ids = today.map(i => parseItem(a.queue[i]));

  const where: Where = awayFromCamp(dusk) ? 'out'
    : !dusk.site ? 'done'
      : ids.some(x => x.id === 'camp') ? 'newcamp'
        : ids.some(x => ACTIONS[x.id].ringed) ? 'back' : 'done';

  return { part: endWords(s.day, hours, s.config.calendar), clock: words ? null : compactEnd(hours, null), where, tired: tiredness(a, preview, dusk), stores: storesAt(a, preview, today, dusk, t) };
}

/** How tired you'll be at dusk, as far as you can tell (see the file's header). */
function tiredness(a: AppState, preview: QueuePreview, dusk: QueuePreview['projected']): DayEnd['tired'] {
  const vigor = vitalLevel(dusk.vitals.vigor.current, dusk.vitals.vigor.cap);
  const clarity = vitalLevel(dusk.vitals.clarity.current, dusk.vitals.clarity.cap);
  const worst = clarity > vigor ? { id: 'clarity' as const, level: clarity } : { id: 'vigor' as const, level: vigor };
  const known = a.sim;
  if (!forecastsOn(known)) return worst;
  const cast = queueForecast(a, preview);
  if (!cast) return null;
  const int = known.character.stats.int;
  const level = judged(worst.level, 4, misjudgeChance(int, cast.fam, knowThreshold(int)), forecastRand(known, queueKeyOf(a.queue), 'dusk')) as VitalLevel;
  return { id: worst.id, level };
}

/** Each key store one of today's trips fills, at dusk (see the file's header). */
function storesAt(a: AppState, preview: QueuePreview, today: readonly number[], dusk: QueuePreview['projected'], t: T): StoreEnd[] {
  const known = a.sim;
  const learning = forecastsOn(known);
  let outlook: ReturnType<typeof winterOutlook> | null = null;
  const out: StoreEnd[] = [];
  for (const store of STORES) {
    const trips = today.map(i => ({ i, ...parseItem(a.queue[i]) })).filter(x => FILLS[x.id] === store);
    if (!trips.length) continue;
    if (learning) {
      const how = trips.map(x => knowing(known, taskKey(x.id, x.ring)));
      if (how.includes('unknown')) { out.push({ store, known: 'unknown' }); continue; }
      if (how.includes('rough')) {
        // The card's own word for each trip still being learned (forecast-words.ts taskCard): the most any of them says.
        const level = Math.max(...trips.map(x => taskCard(known, preview.before[x.i], x.id, x.ring, t)?.level ?? 0));
        out.push({ store, known: 'rough', level });
        continue;
      }
    }
    outlook ??= winterOutlook(dusk);
    const nights = store === 'food' ? outlook.foodDays : store === 'water' ? outlook.waterDays : outlook.fuelDays;
    out.push({ store, known: 'exact', nights, thaw: outlook.nightsToThaw > 0 && nights >= outlook.nightsToThaw });
  }
  return out;
}

const lowerFirst = (x: string): string => x.charAt(0).toLocaleLowerCase() + x.slice(1);

/** "food for 3 nights", "some more wood"; the unknown ones are said together (`storesText`). */
export function storeText(x: Exclude<StoreEnd, { known: 'unknown' }>, t: T): string {
  if (x.known === 'rough') return t(`dayend.rough.${x.level as 0 | 1 | 2}`, { what: t(`fc.what.${x.store}`) });
  if (x.thaw) return t(`dayend.thaw.${x.store}`);
  if (x.nights === 0) return t(`dayend.none.${x.store}`);
  return t(`dayend.nights.${x.store}.${x.nights === 1 ? 'one' : 'other'}` as Key, { n: x.nights });
}

/** "a", "a and b", "a, b and c". */
const listText = (xs: readonly string[], t: T): string =>
  xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${t('dayend.and')} ${xs[xs.length - 1]}`;

/**
 * The stores in a list: each known or rough one by itself, then the ones you can't tell together,
 * "whatever food and wood you find", rather than "whatever food you find and whatever wood you find".
 */
export function storesText(xs: readonly StoreEnd[], t: T): string {
  const told = xs.flatMap(x => (x.known === 'unknown' ? [] : [storeText(x, t)]));
  const unknown = xs.filter(x => x.known === 'unknown').map(x => t(`fc.what.${x.store}`));
  return listText(unknown.length ? [...told, t('dayend.unknown', { what: listText(unknown, t) })] : told, t);
}

/** The sentence: "Back at camp by dusk, tired, with wood for 3 nights." */
export function dayEndText(e: DayEnd, t: T): string {
  const when = e.clock ? t('dayend.clock', { clock: e.clock }) : t(`dayend.when.${e.part}`);
  const parts = [t(`dayend.${e.where}`, { when })];
  if (e.tired) parts.push(lowerFirst(vitalWord(e.tired.id, e.tired.level, t)));
  if (e.stores.length) parts.push(t('dayend.with', { what: storesText(e.stores, t) }));
  return `${parts.join(', ')}.${e.where === 'out' ? ` ${t('dayend.sky')}` : ''}`;
}

/** The line in the queue's Run bar, or nothing when there's none. (The phone's strip says `dayEndText` in its total's place.) */
export const dayEndHtml = (e: DayEnd | null, t: T): string => (e ? `<p class="dayend">${esc(dayEndText(e, t))}</p>` : '');
