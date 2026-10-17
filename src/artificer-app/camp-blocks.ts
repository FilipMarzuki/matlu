/**
 * A day at camp, drawn in the viewer's language (#1707, phase 2 of #1685): the season strip and
 * weather, the actions with what they yield and why one can't be done, the stores and cold
 * storage, the Warden's vitals, the site picker and tools, the timer's words, the closing card,
 * and the MAP tab before a map is drawn.
 *
 * Moved out of main.ts so they can be drawn in a test without a browser (camp-i18n.test.ts draws
 * them in Swedish and looks for English). Each takes `t`, the page's translate function; what the
 * sim says in English goes through sim-words.ts. Pure: state in, HTML out.
 */

import { builtWarmthOn } from '../artificer/built-warmth';
import { numText, type T } from '../artificer/i18n';
import { visibilityOf, greyedTappable, shown } from '../artificer/action-visibility';
import { hasKit } from '../artificer/kit';
import { huntingGearOn } from '../artificer/hunting-gear';
import { visibilityOn, huntOddsOf, sinewOf, huntTool, ACTIONS, SITES, BUILD_COST, DISCOVERIES, HIDE_PARKA_RECIPE, coldPitHolds, coldCapacity, nightSpoilage, warmth, tonightThermal, queueId, queueHours, parseItem, type ActionId, type QueueId, type SiteId } from '../artificer/region1';
import { RINGS, TRAVEL_HOURS, reachable, scouted, hasFind, type Ring } from '../artificer/exploration';
import { yieldAmounts } from './yield-amounts';
import { cardYield, craftCard, taskCard, type CraftCard } from './forecast-words';
import { queueKeyOf } from '../artificer/forecasts';
import { seasonOf, MIDWINTER_AFTER, type Grade } from '../artificer/winter';
import { daylightHours } from '../artificer/clock';
import { featureOn } from '../artificer/features';
import { dayMean, nightTemp, isBlizzard, BLIZZARD_HOURS, type WeatherId } from '../artificer/weather';
import { BASELINE, CAP_CEIL, morale, type Pool } from '../artificer/vitality';
import type { Haul } from '../artificer/load';
import type { RunRecord } from '../artificer/legacy';
import { difficultyRead, difficultyOfCharacter, difficultyLabel } from '../artificer/difficulty';
import { vitalCostLabel } from './feature-choices';
import { itemIcon } from './item-icons';
import { esc, pct, band } from './html';
import { chevron } from './fold';
import { actionName, buildsWords, conceptName, distanceT, gradeWord, landDescribedHead, landLines, mapNeedsText, recipeName, ringName, siteName, simLine, spotReading, spotWhere, weatherLines, weatherWord } from './sim-words';
import { campAsActionOn, knownSpots } from '../artificer/camp-sites';
import { campBadges, siteBadge } from './rating-badges';
import { buildsAt } from '../artificer/camp-builds';
import { seasonView, weatherReport } from '../artificer/weather-words';
import { actionTime, timerLength, timeWordsShown } from './time-view';
import { preselect, type RingDefaults } from './distance-defaults';
import type { previewQueue, AppState } from './controller';
import type { DayPlay, Moment } from './playback';

type Sim = AppState['sim'];
export type Preview = ReturnType<typeof previewQueue>;

// ── The actions ─────────────────────────────────────────────────────────────

/** The action palette's groups: `key` names the heading in the catalog (`group.*`). */
export const GROUPS: { key: 'explore' | 'provision' | 'build' | 'craft' | 'carry' | 'think'; ids: ActionId[] }[] = [
  { key: 'explore', ids: ['explore', 'scout', 'survey', 'track', 'lookout'] },
  { key: 'provision', ids: ['gather', 'traps', 'hunt', 'water', 'wood', 'gatherstone', 'quarry', 'fish', 'preserve'] },
  { key: 'build', ids: ['camp', 'build', 'coldPit', 'coldGear'] },
  { key: 'craft', ids: ['knife', 'snare', 'sling', 'bow', 'hookline', 'waterskin', 'bedroll', 'shovel'] },
  { key: 'carry', ids: ['basket', 'backpack', 'harness', 'sled'] },
  { key: 'think', ids: ['study', 'experiment', 'drawmap', 'tinker', 'rest', 'treat'] },
];

export const ICON: Record<ActionId, string> = {
  scout: '🥾', survey: '📐', track: '🐾', gather: '🌿', hunt: '🏹', water: '💧',
  wood: '🪵', gatherstone: '🪨', quarry: '⛰️', preserve: '🧂', build: '⛺', coldGear: '🧥', tinker: '🛠️', rest: '☕', treat: '🩹',
  lookout: '🔭', study: '📖', explore: '🧭', experiment: '🧪', knife: '🔪', snare: '🪤', waterskin: '🫗', bedroll: '🛏️', shovel: '⛏️', fish: '🎣', coldPit: '🧊', camp: '🏕️', drawmap: '🗺️', basket: '🧺', backpack: '🎒', harness: '🪢', sled: '🛷',
  traps: '🪤', sling: '🪃', bow: '🏹', hookline: '🪝',
};

/**
 * One line of "what you get" per action, in the chosen ring: the numbers (yield-amounts.ts, which
 * mirror region1.ts yields), exact as they've always been. With `forecasts` (#1827) the card shows
 * what the Warden knows instead (`cardYield`, forecast-words.ts); this stays the exact line.
 */
export function yieldText(id: ActionId, s: Sim, r: Ring, t: T): string {
  const a = yieldAmounts(id, s, r);
  switch (id) {
    case 'gather': return t(hasFind(s.explore, r, 'forage') ? 'yield.gatherFiber' : 'yield.gather', { n: a!.n });
    case 'hunt': {
      // With `hunting-gear` (#1821): what the tool allows (a sling small game, a bow deer too) and the odds in words.
      const odds = huntOddsOf(s, 'hunt', r);
      if (!odds) return t('yield.hunt', { n: a!.n });
      return t(huntTool(s) === 'bow' ? 'yield.huntBow' : 'yield.huntSling', { n: a!.n, odds: t(`odds.hunt.${odds}`) });
    }
    case 'traps': return t('yield.traps', { n: a!.n, odds: t(`odds.hunt.${huntOddsOf(s, 'traps', r) ?? 'fair'}`) });
    case 'water': return t('yield.water', { n: a!.n });
    case 'wood': return t('yield.wood', { n: a!.n, m: a!.m ?? 0 });
    case 'quarry': case 'gatherstone': return t('yield.quarry', { n: a!.n });
    case 'fish': return t('yield.fish', { n: a!.n });
    case 'build': return s.tier < 2 ? t('yield.build', { n: s.tier + 1, m: BUILD_COST[s.tier as 0 | 1] }) : t('yield.winterized');
    // With `cold-pit-slows` (#1757) the pit slows the rot rather than stopping it, and says so.
    case 'coldPit': return t(featureOn(s.config.world.features, 'cold-pit-slows') ? 'yield.coldPitSlows' : 'yield.coldPit', { n: coldPitHolds(s.site) });
    default: return t(`yield.${id}`);
  }
}

/** What a trip carries home, short (a craft's ingredients, the load bar). */
export const haulWord = (k: string, t: T): string =>
  // Sinew (#1821) isn't a hauled store: the bow's ingredient chip names it by its store word.
  k === 'sinew' ? t('storeword.sinew') : (['rawFood', 'rations', 'water', 'firewood', 'materials', 'stone', 'hides'] as (keyof Haul)[]).includes(k as keyof Haul) ? t(`haul.${k as keyof Haul}`) : k;

/**
 * A craft's ingredients (#1675) as icon chips under its card: "[icon] 2 mat". The recipe is the one
 * the action would use with its default options (cold gear: woven fiber; a build: the plan as it
 * stands), so a chosen option can change it; the queue row's options say what the choice costs.
 */
function ingredients(def: (typeof ACTIONS)[ActionId], s: Sim, t: T, fc?: CraftCard | null): string {
  // With `forecasts` (#1827), until the recipe is made often enough: the amounts in rough words, and the waste warning.
  if (fc?.rough) {
    if (!fc.rough.length) return '';
    return `<div class="ingr fc">${fc.rough.map(i => `<span>${itemIcon(i.item)}<b>${esc(t(`fc.qty.${i.level as 0 | 1 | 2}`))}</b> ${esc(haulWord(i.item, t))}</span>`).join('')}${fc.waste ? `<span class="waste">${esc(t('fc.waste'))}</span>` : ''}</div>`;
  }
  const recipe = def.recipeFor?.(s, {}) ?? def.recipe;
  if (!recipe?.inputs.length) return '';
  return `<div class="ingr">${recipe.inputs.map(i => `<span>${itemIcon(i.item)}<b>${i.qty}</b> ${esc(haulWord(i.item, t))}</span>`).join('')}</div>`;
}

/**
 * One distance in an action's chooser (#1814): where it is, how far to walk, what it would bring,
 * and whether it can be chosen now (`open`). An unreachable distance says why (`ring.lockedTip`, as
 * the old tabs did); a reachable one blocked today says the action's own reason. `greyed` means it
 * can't be tapped; `why` without `greyed` is a soft gate (the switch off: it would just be skipped).
 */
export interface DistanceOption {
  ring: Ring;
  q: QueueId;
  reachable: boolean;
  open: boolean;
  why: string | null;
  greyed: boolean;
  /** The walk there and back ("+3h travel"), or home ground. */
  travel: string;
  /** What the action would bring there (`yieldText`). */
  yield: string;
  /** The one the chooser preselects, and whether that is the one remembered ("last time"). */
  chosen: boolean;
  last: boolean;
}

/**
 * A ringed action's distances (#1814), judged against the state after the queue so far, with the
 * preselected one: the distance remembered for this action if it's open, else the nearest open.
 * `remembered` is this Warden's choices (distance-defaults.ts). Pure, for the chooser and its tests.
 */
export function distanceOptions(s: Sim, id: ActionId, remembered: RingDefaults, tIn: T, known: Sim = s, queueKey = ''): DistanceOption[] {
  const t = distanceT(s, tIn);
  const base = RINGS.map(r => {
    const reach = reachable(s.explore, r);
    const vis = visibilityOf(s, id, r);
    const gate = vis.reason ? simLine(vis.reason, t) : null;
    const why = reach ? gate : t('ring.lockedTip');
    const greyed = !reach || (!!gate && !greyedTappable(s));
    return {
      ring: r, q: queueId(id, r), reachable: reach, open: !greyed, why, greyed,
      travel: TRAVEL_HOURS[r] ? t('ring.travel', { n: TRAVEL_HOURS[r] }) : t('ring.home'),
      // With `forecasts` (#1827): what the Warden knows of it at this distance (`known`: the run as it is).
      yield: cardYield(known, s, id, r, t, yieldText(id, s, r, t), queueKey),
    };
  });
  const pick = preselect(base, remembered[id]);
  return base.map(o => ({ ...o, chosen: o.ring === pick.ring, last: o.ring === pick.ring && pick.last }));
}

/** The chooser under a ringed action's card (#1814): its distances, the preselected one marked, and ✕. */
function distanceChooser(a: AppState, preview: Preview, id: ActionId, options: DistanceOption[], t: T, dev: boolean): string {
  return `<div class="ringpick" role="group" aria-label="${esc(t('ringpick.aria', { action: actionName(id, t) }))}">`
    + `<div class="rphead"><span>${esc(t('ringpick.head'))}</span><button class="rpx" data-cmd="ringclose" aria-label="${esc(t('ringpick.close'))}" title="${esc(t('ringpick.close'))}">✕</button></div>`
    + `<div class="rpopts">${options.map(o => {
      const soft = !!o.why && !o.greyed;
      const title = o.why ? (o.greyed ? o.why : t('act.wouldSkip', { why: o.why })) : '';
      return `<button class="rpopt${o.chosen ? ' on' : ''}${o.greyed ? ' locked' : ''}${soft ? ' soft' : ''}" data-ringpick="${o.q}" data-pickfor="${id}" data-pickring="${o.ring}"${o.greyed ? ' disabled' : ''} aria-pressed="${o.chosen}" title="${esc(title)}">`
        + `<span class="rpn">${esc(ringName(o.ring, t).toUpperCase())}${o.last ? ` <span class="rplast">${esc(t('ringpick.last'))}</span>` : ''}</span>`
        + `<span class="rpt">${esc(o.travel)}${o.reachable ? ` · ${esc(actionTime(a, preview, queueHours(o.q, preview.projected), t, dev))}` : ''}</span>`
        + `<span class="y">${o.why ? `<span class="gate">${esc(o.why)}</span>` : `<span class="yield">${esc(o.yield)}</span>`}</span></button>`;
    }).join('')}</div></div>`;
}

/**
 * The actions area: each group's actions with their hours and what they yield, or why they can't
 * be done. Gates are judged against the state *after* the queue so far, so you can plan "scout,
 * then gather" in one go. An action done out on the land (`ringed`) opens its distance chooser
 * when tapped (#1814; `chooser` is the one open, `defaults` this Warden's remembered distances);
 * its card shows it at the distance the chooser would preselect. The others queue on one tap.
 */
// The Make camp card's badges (#1756, `camp-site-ratings`) are drawn by rating-badges.ts (#1798), with the LAND tab's.
export { campBadges } from './rating-badges';

export function paletteBlock(a: AppState, preview: Preview, opts: { dev: boolean; t: T; suggest?: ActionId | null; defaults?: RingDefaults; chooser?: ActionId | null }): string {
  const { dev } = opts;
  const defaults = opts.defaults ?? {};
  // The run's own words (#1752): its rings said as distances with `distance-not-rings` on.
  const t = distanceT(a.sim, opts.t);
  const resolved = a.sim.outcome !== null;
  // A group with nothing the Warden knows how to do yet (#1690) isn't shown at all.
  // In words (#1740), the length gets a line of its own under the name.
  const tw = timeWordsShown(a.sim, dev);
  const known = GROUPS.map(g => ({ ...g, ids: g.ids.filter(id => shown(preview.projected, id)) })).filter(g => g.ids.length);
  // Forecasts (#1827): judged in the queue's projection, from what the Warden has really done (a.sim), seeded by the queue.
  const qk = queueKeyOf(a.queue);
  return known.map(g => `<div class="group"><h4>${esc(t(`group.${g.key}`))}</h4><div class="acts">${g.ids.map(id => {
    const def = ACTIONS[id];
    // A land action is shown at the distance its chooser would preselect.
    const options = def.ringed ? distanceOptions(preview.projected, id, defaults, t, a.sim, qk) : null;
    const r: Ring = options?.find(o => o.chosen)?.ring ?? 1;
    const q = queueId(id, r);
    // What the Warden knows how to do (#1690): hidden if not, greyed out (with why) if not right now.
    // With the switch off a blocked action stays tappable, as before: it would just be skipped.
    const vis = visibilityOf(preview.projected, id, r);
    if (vis.status === 'hidden') return '';
    const why = vis.reason ? simLine(vis.reason, t) : null;
    const greyed = !!why && !greyedTappable(preview.projected);
    // Which vitals it spends: a dev-mode view (#1688); players plan by hours and read the bars.
    const spends = vitalCostLabel(def, dev);
    // The first-morning guide's suggestion (#1792, reveal.ts): it glows until a place to camp is known.
    const suggested = opts.suggest === id && !why ? ' guide-suggest' : '';
    // A land action's tap opens its chooser (data-chooser); any other queues itself (data-q).
    const open = !!options && opts.chooser === id && !resolved && !greyed;
    const tap = options ? `data-chooser="${id}" aria-expanded="${open}"` : `data-q="${q}"`;
    const exact = yieldText(id, preview.projected, r, t);
    const craftFc = why ? null : craftCard(a.sim, preview.projected, id, t, exact, qk);
    const line = craftFc?.text ?? taskCard(a.sim, preview.projected, id, r, t, qk)?.text ?? exact;
    return `<button class="act ${why ? 'soft' : ''} ${greyed ? 'greyed' : ''}${suggested}${open ? ' picking' : ''}" ${tap}${resolved || greyed ? ' disabled' : ''} title="${why ? esc(greyed ? why : t('act.wouldSkip', { why })) : ''}">`
      // Its hours, or (#1740, `time-words`) how long it would take after the queue, in words.
      + `<div class="t">${ICON[id]} ${esc(actionName(id, t).toUpperCase())}${id === 'camp' ? campBadges(a.sim, t) : ''}<span class="h${tw ? ' tw' : ''}">${esc(actionTime(a, preview, queueHours(q, preview.projected), t, dev))}</span></div>`
      + `<div class="y">${why ? `<span class="gate">${esc(why)}</span>` : `<span class="yield">${esc(line)}</span>${spends ? ` · <span class="vc">${spends}</span>` : ''}`}</div>${ingredients(def, preview.projected, t, craftFc)}</button>`
      + (open && options ? distanceChooser(a, preview, id, options, t, dev) : '');
  }).join('')}</div></div>`).join('');
}

// ── The season strip and the weather ────────────────────────────────────────

const WEATHER_ICON: Record<WeatherId, string> = { clear: '☀', overcast: '☁', rain: '🌧', fog: '🌫', wind: '🌬', storm: '⛈', snow: '❄' };

/**
 * The strip's bars and markers: one bar per day from day 1 to the thaw, its height the day's
 * daylight, the first snow and midwinter marked. `hours` puts each day's hours of light in its
 * tooltip; the strip earned in words (#1729) leaves them out, as there's nothing to measure them by.
 */
function stripBars(s: Sim, t: T, hours: boolean): string {
  const cal = s.config.calendar;
  const days = cal.thawDay - 1;
  const midwinter = cal.winterDay + MIDWINTER_AFTER;
  const bars = Array.from({ length: days }, (_, i) => {
    const d = i + 1;
    const cls = [seasonOf(d, cal), d < s.day ? 'past' : d === s.day ? 'now' : '', d === cal.winterDay || d === midwinter ? 'mark' : ''].join(' ');
    const tip = hours ? t('season.dayTip', { d, h: numText(daylightHours(d, cal), t, 1) }) : t('wx.dayTip', { d });
    // Daylight runs about 6–11.5 hours; scale it so midwinter's short days still show.
    return `<i class="${cls}" style="height:${Math.round(25 + 75 * Math.min(1, (daylightHours(d, cal) - 5) / 7))}%" title="${esc(tip)}"></i>`;
  }).join('');
  // Markers sit over the centre of their day's bar.
  const at = (d: number): string => `left:${(((d - 0.5) / days) * 100).toFixed(2)}%`;
  const marks = `<span class="sm" style="${at(cal.winterDay)}">${esc(t('season.firstSnow'))}</span><span class="sm" style="${at(midwinter)}">${esc(t('season.midwinter'))}</span><span class="sm end">${esc(t('season.thaw'))}</span>`;
  return `<div class="bars">${bars}</div><div class="marks">${marks}</div>`;
}

/**
 * The season strip (#1308): one bar per day from day 1 to the thaw, its
 * height the day's daylight — so the shortening days are something you see —
 * coloured by season, with the first snow and midwinter marked. Under it,
 * today: the weather, the light, the cold and the snow cover.
 */
export function seasonStrip(s: Sim, t: T): string {
  const cal = s.config.calendar;
  const seeded = s.config.world.weather === 'seeded';
  const blizzard = seeded && isBlizzard(s.weatherToday, s.day, cal);
  const today = [
    seeded ? `<span class="wx ${blizzard ? 'danger' : ''}">${WEATHER_ICON[s.weatherToday]} ${esc(weatherWord(s.weatherToday, s.day, cal, t))}</span>` : '',
    `<span>${esc(t('season.light', { h: numText(daylightHours(s.day, cal), t, 1) }))}</span>`,
    seeded ? `<span>${Math.round(dayMean(s.day, cal))}°C</span>` : '',
    seeded && (s.snowDepth ?? 0) > 0 ? `<span>${esc(t('season.snowCover', { n: Math.round((s.snowDepth ?? 0) * 100) }))}</span>` : '',
  ].filter(Boolean).join('');
  return `<div class="seasonstrip" aria-label="${esc(t('season.label'))}">${stripBars(s, t, true)}`
    + `<div class="today">${today}</div>`
    + (blizzard ? `<p class="lockbanner">${esc(t('season.blizzard', { n: BLIZZARD_HOURS }))}</p>` : '')
    + '</div>';
}

/** One chip of the condensed weather box (#1788): an icon, a short word, and the full sentence it stands for. */
export interface WeatherChip { id: 'sky' | 'felt' | 'ground' | 'season'; icon: string; text: string; full: string }

const SEASON_ICON = { autumn: '🍂', winter: '❄', thaw: '💧' } as const;

/**
 * The condensed weather box's chips (#1788): the sky, the cold as felt, the snow underfoot (only
 * when there is some) and the season, with the count to the snow or the thaw once one is known.
 * They say only what the full box says (weather-words.ts gates it): words at the start, a rough
 * count once the days are tallied, and degrees, snow cover and exact counts only in the numbers
 * view (the switch off) or dev mode, where the full box shows them too. Each chip's `full` is the
 * box's own sentence for it, for its tooltip and screen readers.
 */
export function weatherChips(s: Sim, t: T, opts: { dev?: boolean } = {}): WeatherChip[] {
  const cal = s.config.calendar;
  const r = weatherReport(s);
  const numbers = r.view === 'numbers' || !!opts.dev;
  const chips: WeatherChip[] = [];
  if (r.sky) chips.push({ id: 'sky', icon: WEATHER_ICON[s.weatherToday], text: weatherWord(s.weatherToday, s.day, cal, t), full: t(`wx.sky.${r.sky}`) });
  if (r.felt) {
    const word = t(`wx.short.felt.${r.felt}`);
    chips.push({ id: 'felt', icon: '🌡', text: numbers ? `${word} · ${Math.round(dayMean(s.day, cal))}°C` : word, full: t(`wx.felt.${r.felt}`) });
  }
  if (r.ground) {
    const word = t(`wx.short.ground.${r.ground}`);
    chips.push({ id: 'ground', icon: '❄', text: numbers ? `${word} · ${Math.round((s.snowDepth ?? 0) * 100)}%` : word, full: t(`wx.ground.${r.ground}`) });
  }
  const season = seasonOf(s.day, cal);
  const icon = SEASON_ICON[season];
  const seasonLine = t(`wx.season.${r.season}`);
  if (numbers) {
    // As the numbers view's header chip: the exact count to the snow in autumn, to the thaw in winter.
    const n = season === 'autumn' ? cal.winterDay - s.day : season === 'winter' ? cal.thawDay - s.day : null;
    const word = t(`wx.short.season.${r.season}`);
    const toKey = season === 'autumn' ? 'wx.full.toSnow' : 'wx.full.toThaw';
    chips.push(n === null
      ? { id: 'season', icon, text: word, full: seasonLine }
      : { id: 'season', icon, text: `${word} · ${t('wx.short.days', { n })}`, full: `${seasonLine} ${t(n === 1 ? `${toKey}.one` : `${toKey}.other`, { n })}` });
    return chips;
  }
  // With the snow's count, "snow soon" would say it twice (as in the header chip): it's just late autumn.
  const count = r.toSnow ?? r.toThaw;
  const word = t(`wx.short.season.${r.season === 'snowSoon' && r.toSnow !== null ? 'late' : r.season}`);
  const countLine = r.toSnow !== null ? t(r.toSnow === 1 ? 'wx.toSnow.one' : 'wx.toSnow.other', { n: r.toSnow })
    : r.toThaw !== null ? t(r.toThaw === 1 ? 'wx.toThaw.one' : 'wx.toThaw.other', { n: r.toThaw }) : '';
  chips.push({
    id: 'season', icon,
    text: count !== null ? `${word} · ${t('wx.short.about', { n: count })}` : word,
    full: countLine ? `${seasonLine} ${countLine}` : seasonLine,
  });
  return chips;
}

/** How the weather box is folded (#1788, weather-fold.ts); without it, the box is drawn open with no toggle. */
export interface WeatherFoldView { mode: 'intro' | 'open' | 'condensed'; hint: boolean }

/** The fold's heading: a real button (keyboard and screen readers), its chevron turned when open. */
const wxToggle = (t: T, open: boolean, icon: string): string =>
  `<button type="button" class="eyebrow foldhead wxtoggle" data-wxfold aria-expanded="${open}">${chevron()}<span>${icon}${esc(t('wx.head'))}</span></button>`;

/**
 * The weather box (#1729, switch `weather-words`): the weather and the season in words, and as
 * much of the calendar as the Warden has earned (weather-words.ts). In words at the start; with a
 * tally kept, the day and about how long to the snow; once a season has turned, the strip as well
 * (its bars and markers, never the hours of light or the degrees). Dev mode shows the strip with
 * its numbers alongside the words from day 1. With the switch off it's the season strip, as today.
 *
 * With `fold` (#1788) its heading opens and condenses it: `intro` is the first time's card, ending
 * in "Got it"; `condensed` is one row of icon chips (weatherChips), with a hint until the box has
 * been opened once. A blizzard's warning shows in every state.
 */
export function weatherBox(s: Sim, t: T, opts: { dev?: boolean; fold?: WeatherFoldView } = {}): string {
  const view = seasonView(s);
  const fold = opts.fold;
  const seeded = s.config.world.weather === 'seeded';
  const blizzard = seeded && isBlizzard(s.weatherToday, s.day, s.config.calendar);
  const banner = blizzard ? `<p class="lockbanner">${esc(t('season.blizzard', { n: BLIZZARD_HOURS }))}</p>` : '';
  const skyIcon = seeded && view !== 'numbers' ? `${WEATHER_ICON[s.weatherToday]} ` : '';
  if (fold?.mode === 'condensed') {
    // A tap anywhere on the row opens the box; the heading is the button keyboards and screen readers use.
    const chips = weatherChips(s, t, opts).map(c => `<span class="wxchip" role="img" title="${esc(c.full)}" aria-label="${esc(c.full)}"><span aria-hidden="true">${c.icon}</span> ${esc(c.text)}</span>`).join('');
    return `<div class="wxbox condensed"><div class="wxrow" data-wxfold>${wxToggle(t, false, '')}`
      + `<span class="wxchips" role="group" aria-label="${esc(t('wx.chips'))}">${chips}</span>`
      + (fold.hint ? `<span class="wxhint">${esc(t('wx.hint'))}</span>` : '')
      + `</div>${banner}</div>`;
  }
  const head = !fold ? null : fold.mode === 'open' ? wxToggle(t, true, skyIcon) : `<p class="eyebrow">${skyIcon}${esc(t('wx.head'))}</p>`;
  const ack = fold?.mode === 'intro' ? `<div class="wxackrow"><button type="button" class="btn go wxack" data-wxack>${esc(t('wx.ack'))}</button></div>` : '';
  const cls = fold?.mode === 'intro' ? 'wxbox wxintro' : 'wxbox';
  // The switch off: the season strip and its numbers, as before (under the fold's heading, if folding).
  if (view === 'numbers') return head === null ? seasonStrip(s, t) : `<div class="${cls}">${head}${seasonStrip(s, t)}${ack}</div>`;
  const words = `<div class="wxwords">${head ?? `<p class="eyebrow">${skyIcon}${esc(t('wx.head'))}</p>`}`
    + weatherLines(s, t).map(l => `<p>${esc(l)}</p>`).join('') + '</div>';
  const strip = opts.dev ? seasonStrip(s, t)
    : view === 'strip' ? `<div class="seasonstrip" aria-label="${esc(t('season.label'))}">${stripBars(s, t, false)}</div>`
      : '';
  // The dev strip carries its own blizzard banner.
  return `<div class="${cls}">${words}${strip}${opts.dev ? '' : banner}${ack}</div>`;
}

/**
 * Where we are in the season, in a few words (the header chip). With the switch off, once the
 * strip is earned, or in dev mode: "AUTUMN · SNOW IN 30 DAYS", as today. Before that (#1729): the
 * season in words ("LATE AUTUMN"), and with a tally the snow's rough count ("LATE AUTUMN · SNOW IN
 * ABOUT 15 DAYS").
 */
export function seasonChip(s: Sim, t: T, opts: { dev?: boolean } = {}): string {
  const cal = s.config.calendar;
  const d = s.day;
  const season = seasonOf(d, cal);
  const cls = season === 'autumn' ? 'phase' : season === 'thaw' ? 'phase gold' : 'phase ice';
  const r = weatherReport(s);
  if (r.view === 'numbers' || r.view === 'strip' || opts.dev) {
    if (season === 'thaw') return `<span class="${cls}">${esc(t('top.thaw'))}</span>`;
    const n = season === 'autumn' ? cal.winterDay - d : cal.thawDay - d;
    const key = season === 'autumn' ? (n === 1 ? 'top.autumn.one' : 'top.autumn.other') : (n === 1 ? 'top.winter.one' : 'top.winter.other');
    return `<span class="${cls}">${esc(t(key, { n }))}</span>`;
  }
  // With the snow's count, "snow soon" would say it twice: the season is just late autumn.
  const name = t(`wx.chip.${r.season === 'snowSoon' && r.toSnow !== null ? 'late' : r.season}`);
  const text = r.toSnow !== null ? t(r.toSnow === 1 ? 'wx.chip.snowIn.one' : 'wx.chip.snowIn.other', { season: name, n: r.toSnow }) : name;
  return `<span class="${cls}">${esc(text)}</span>`;
}

// ── The camp: vitals, stores, cold storage, the site, tools ─────────────────

function poolRow(label: string, p: Pool): string {
  const b = band(p.cap > 0 ? p.current / p.cap : 0);
  // One scale up to the ceiling, so growth past the baseline is visible.
  return `<div class="vital"><span class="vn">${esc(label)}</span><div class="track">`
    + `<div class="fill ${b}" style="width:${pct(p.current / CAP_CEIL)}%"></div>`
    + `<span class="mark base" style="left:${pct(BASELINE / CAP_CEIL)}%"></span>`
    + `<span class="mark cap" style="left:${pct(p.cap / CAP_CEIL)}%"></span>`
    + `</div><span class="vs ${b}">${Math.round(p.current)} / ${Math.round(p.cap)}</span></div>`;
}

/** How the Warden feels, in a line. */
export function moodLine(s: Sim, t: T): string {
  const v = s.vitals;
  if (v.vigor.current <= 0) return t('mood.spent');
  if (v.clarity.current <= 0) return t('mood.burnt');
  const m = morale(v);
  return t(m > 0.78 ? 'mood.sharp' : m > 0.58 ? 'mood.steady' : m > 0.38 ? 'mood.worn' : 'mood.fumes');
}

export function vitalsBlock(s: Sim, t: T): string {
  const v = s.vitals;
  return `<div class="vitals">${poolRow(t('vital.vigor'), v.vigor)}${poolRow(t('vital.clarity'), v.clarity)}
      <div class="vital"><span class="vn">${esc(t('vital.reserve'))}</span><div class="track"><div class="fill ${band(v.condition / 100)}" style="width:${pct(v.condition / 100)}%"></div></div><span class="vs ${band(v.condition / 100)}">${Math.round(v.condition)}%</span></div>
    </div><p class="mood">${esc(moodLine(s, t))}</p>`;
}

/** A chip in the stores row: a store, or sinew (#1821, `hunting-gear`), kept beside them on the sim. */
type StoreKey = keyof Sim['stores'] | 'sinew';
const STORE_EMOJI: Record<StoreKey, string> = { rawFood: '🍖', water: '💧', firewood: '🪵', materials: '🪨', rations: '🧂', stone: '⛰️', hides: '🦌', sinew: '🧵' };

/**
 * A store chip: the good's 32 px icon (#1675), or its old emoji until it has one, the name as text
 * and the count. The name is printed, so the icon's alt is empty (see item-icons.ts). `extra` goes
 * inside the chip after the count (a hunger streak).
 */
export const storeChip = (id: StoreKey, n: number, t: T, low = false, extra = ''): string =>
  `<span class="r ${low ? 'low' : ''}">${itemIcon(id, { fallback: STORE_EMOJI[id] })} ${esc(t(`store.${id}`))} <b>${n}</b>${extra}</span>`;

export function storesRow(s: Sim, t: T): string {
  const st = s.stores;
  // A running hunger/thirst streak shows on the chip: the next night without costs more (#1233).
  const streak = (n: number, word: string): string => (n ? ` <span class="streak">${esc(word)} ×${n}</span>` : '');
  return `<div class="res">${storeChip('rawFood', st.rawFood, t, st.rawFood < 1, streak(s.deprivation.hungry, t('status.hungry')))}${storeChip('water', st.water, t, st.water < 1, streak(s.deprivation.thirsty, t('status.thirsty')))}`
    + `${storeChip('firewood', st.firewood, t)}${storeChip('materials', st.materials, t)}${storeChip('rations', st.rations, t)}${storeChip('stone', st.stone, t)}${storeChip('hides', st.hides, t)}`
    // Sinew (#1821) only with `hunting-gear` on: off, the row is as it always was.
    + `${huntingGearOn(s) ? storeChip('sinew', sinewOf(s), t) : ''}</div>`;
}

/** The CAMP tab's cold storage (#1296): raw food kept cold or exposed, and what tonight will cost. */
export function coldBlock(s: Sim, t: T): string {
  if (s.config.world.weather !== 'seeded') return '';
  const temp = nightTemp(s.day, s.weatherToday, s.config.calendar);
  const cap = coldCapacity(s, temp);
  const sp = nightSpoilage(s, temp);
  const pitHolds = s.site && s.coldPitAt === s.site ? coldPitHolds(s.site) : 0;
  const pit = pitHolds ? t('cold.pit', { n: pitHolds }) : null;
  const snow = cap - pitHolds > 0 ? t('cold.snow', { n: cap - pitHolds }) : null;
  const where = pit && snow ? t('cold.and', { a: pit, b: snow }) : pit ?? snow ?? t('cold.nothing');
  return `<div class="coldrow"><span>${t('cold.keptHtml', { n: sp.kept, cap })}</span><span>${t('cold.exposedHtml', { n: sp.exposed })}</span>`
    + `<span class="${sp.spoiled ? 'warn' : 'ok'}">${esc(sp.spoiled ? t('cold.spoil', { n: sp.spoiled }) : t('cold.noSpoil'))}</span></div>`
    + `<p class="mood" style="margin:4px 0 0">${esc(t('cold.storage', { where }))}</p>`;
}

/**
 * A site card's warmth (#1763): with `built-warmth`, its natural shelter in a word ("SHELTERED",
 * "EXPOSED") in the corner and, under it, why and what building it needs; otherwise the ceiling.
 */
const warmTag = (s: Sim, site: SiteId, t: T): string =>
  `<span class="warm" style="margin-left:auto">${esc(builtWarmthOn(s) ? t(`shelter.word.${site}`).toUpperCase() : t('site.maxWarm', { n: Math.round(SITES[site].warmth * 100) }))}</span>`;
const upper1 = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);
const shelterLine = (s: Sim, site: SiteId, t: T): string =>
  (builtWarmthOn(s) ? `<div class="d shelterwords">${esc(`${upper1(t(`shelter.why.${site}`))}: ${t(`shelter.needs.${site}`)}.`)}</div>` : '');

/** How warm camp is, in a few words: tonight's quality with `thermal-model` (#1770), else the warmth fraction. */
const warmWords = (s: Sim, t: T): string => {
  const n = tonightThermal(s);
  return n ? t(`night.q.${n.quality}`) : t('site.warm', { n: Math.round(warmth(s) * 100) });
};

/** Where camp is now, as it stands: the shelter, how warm, the cold pit. */
const campNow = (s: Sim, t: T): string =>
  ` ${[t('site.shelter', { tier: s.tier }) + (s.shelterGrade ? ` (${gradeWord(s.shelterGrade, t)})` : ''), warmWords(s, t), ...(s.site && s.coldPitAt === s.site ? [t('site.pit', { n: coldPitHolds(s.site) })] : [])].join(' · ')}.`;

/**
 * Tonight at camp as a heat balance (#1770, `thermal-model`): the night's quality in words, and in
 * dev mode the numbers behind them (the air and wind at the sleeper, IREQ, the insulation held).
 * Empty with the switch off or before there's a camp.
 */
export function nightBlock(s: Sim, t: T, opts: { dev?: boolean } = {}): string {
  const n = tonightThermal(s);
  if (!n) return '';
  const f1 = (x: number): string => numText(x, t, 1);
  const nums = opts.dev
    ? `<p class="mood devnums" style="margin:2px 0 0;font-family:var(--mono, monospace);font-size:12px">${esc(t('night.dev', {
      temp: f1(n.env.airC), radiant: f1(n.env.radiantC), wind: f1(n.env.windMs), feels: f1(n.env.feelsC),
      min: f1(n.required.min), neutral: f1(n.required.neutral), limit: f1(n.required.limit), held: f1(n.heldClo),
      clothes: f1(n.held.clothingClo), bag: f1(n.held.bagClo), pad: f1(n.held.padR),
    }))}</p>`
    : '';
  return `<p class="mood nightwords ${n.quality}" style="margin:6px 0 0">${esc(t(`night.look.${n.quality}`))}</p>${nums}`;
}

/**
 * Camp as an action (#1732): the places to camp you know, each a real place on the Reach, with
 * where it is, how warm it can get and what you can tell of it. Tapping one makes camp there the
 * way any action is done: queued once you plan, done now before then (main.ts `data-camp`).
 */
export function spotsBlock(s: Sim, t: T): string {
  const spots = knownSpots(s).map(p => {
    const here = p.here ? campNow(s, t) : '';
    const tag = p.here ? ` · ${t('campsite.yours')}` : p.start ? ` · ${t('campsite.start')}` : '';
    // How good you believe it is (#1756): ★ great or ✓ good beside the name; a poor one isn't marked.
    const rated = siteBadge(s, p, t);
    const built = buildsAt(s, p.id);
    return `<button class="siteopt ${p.here ? 'chosen' : ''}" data-camp="${esc(p.id)}" ${p.here || s.outcome ? 'disabled' : ''}>`
      + `<div class="t">${esc(siteName(p.kind, t).toUpperCase())}${rated}${warmTag(s, p.kind, t)}</div>`
      + `<div class="d"><b>${esc(spotWhere(p, t) + tag)}</b></div>`
      + shelterLine(s, p.kind, t)
      + `<div class="d">${esc(spotReading(s, p, t) + here)}</div>`
      // What's built there (#1753, `camp-builds-per-site`): each camp keeps its own.
      + (built.length ? `<div class="d built">${esc(t('campsite.builtHere', { list: buildsWords(built, t) }))}</div>` : '')
      + (p.here ? '' : `<div class="d go">${esc(t('campsite.go'))}</div>`) + `</button>`;
  }).join('');
  return `<div class="sites">${spots}</div><p class="mood">${esc(t('campsite.pick'))}</p>`;
}

/** Where camp can be made: each site, how warm it can get, and the camp as it stands. */
export function sitesBlock(s: Sim, t: T): string {
  if (campAsActionOn(s)) return spotsBlock(s, t);
  const sites = (Object.keys(SITES) as SiteId[]).map(id => {
    const here = s.site === id
      ? ` ${[t('site.shelter', { tier: s.tier }) + (s.shelterGrade ? ` (${gradeWord(s.shelterGrade, t)})` : ''), warmWords(s, t), ...(s.coldPitAt === id ? [t('site.pit', { n: coldPitHolds(id) })] : [])].join(' · ')}.`
      : '';
    return `<button class="siteopt ${s.site === id ? 'chosen' : ''}" data-site="${id}" ${scouted(s.explore, 1) && !s.outcome ? '' : 'disabled'}>`
      + `<div class="t">${esc(siteName(id, t).toUpperCase())}${warmTag(s, id, t)}</div>`
      + shelterLine(s, id, t)
      + `<div class="d">${esc(t(`site.note.${id}`) + here)}</div></button>`;
  }).join('');
  return `<div class="sites">${sites}</div><p class="mood">${esc(t(scouted(s.explore, 1) ? 'site.pick' : 'site.scoutFirst'))}</p>`;
}

/** The tools you've made, the concepts you hold, and the recipes you know. */
export function toolsBlock(s: Sim, t: T): string {
  // Tool names come from the recipes that make them (a tool's item is its recipe's id).
  const toolName = (item: string): string => {
    const english = item === HIDE_PARKA_RECIPE.output.item ? HIDE_PARKA_RECIPE.name : Object.values(ACTIONS).find(x => x.recipe?.output.item === item)?.recipe?.name ?? item;
    return recipeName(item, t, english);
  };
  const tools = s.tools.map(x => `<span class="r tool ${x.grade}">${itemIcon(x.item)}${esc(toolName(x.item))} <b>${esc(gradeWord(x.grade, t).toUpperCase())}</b></span>`).join('');
  const concepts = Object.entries(s.concepts).filter(([, p]) => p.rank > 0 || p.insight > 0)
    .map(([id, p]) => `<span class="r concept">${esc(conceptName(id, t).toLowerCase())} <b>R${p.rank}</b></span>`).join('');
  const knownNames = s.known.map(id => recipeName(id, t, DISCOVERIES.find(d => d.recipe === id)?.name ?? id)).join(', ');
  const left = DISCOVERIES.filter(d => !s.known.includes(d.recipe)).length;
  return `<div class="res">${tools || `<span class="mood" style="margin:0">${esc(t('tools.none'))}</span>`}</div>
    ${concepts ? `<div class="res" style="margin-top:6px">${concepts}</div>` : ''}
    <p class="mood" style="margin:6px 0 0">${esc(t('tools.known', { list: knownNames }) + (left ? t('tools.toWork', { n: left }) : ''))}</p>`;
}

/** The journal's line before anything has happened. */
export const firstJournalLine = (s: Sim, t: T): string => t(visibilityOn(s) ? 'journal.firstExplore' : 'journal.firstScout');

// ── The day on the timer (#1669) ────────────────────────────────────────────

/** What the step running is called: "🪵 GATHER WOOD · FAR". */
export function stepName(p: DayPlay, m: Moment, t: T): string {
  if (m.index >= p.steps.length) return esc(t('timer.night'));
  const { id, ring } = parseItem(p.steps[m.index].item);
  return `${ICON[id]} ${esc(actionName(id, t).toUpperCase())}${ring > 1 ? ` · ${esc(ringName(ring, t).toUpperCase())}` : ''}`;
}

/** The leg of a trip session (#1668), in words; else the action's hours (or, #1740, its length in words). */
export function phaseText(p: DayPlay, m: Moment, t: T, dev = false): string {
  if (m.index >= p.steps.length) return t('timer.sleep');
  const st = p.steps[m.index];
  if (m.phase) return `${m.phase.trips > 1 ? t('timer.trip', { n: m.phase.trip, total: m.phase.trips }) : ''}${t(`timer.${m.phase.kind}`)}`;
  return st.hours > 0 ? timerLength(p.before.sim, st.start, st.hours, t, dev) : t('timer.skipped');
}

// ── The closing card ────────────────────────────────────────────────────────

/**
 * The winter's worst nights, from the journal: the winter days with the most
 * hardship, worst first (ties go to the earlier night), with what went wrong.
 */
function worstNights(s: Sim, n = 3): { day: number; lines: string[] }[] {
  const byDay = new Map<number, string[]>();
  for (const l of s.log) {
    // Work lines carry their hour (`at`); what's left is the evening and the night — the cold, hunger and thirst.
    if (l.kind !== 'hardship' || l.at || seasonOf(l.day, s.config.calendar) !== 'winter') continue;
    byDay.set(l.day, [...(byDay.get(l.day) ?? []), l.text]);
  }
  return [...byDay].map(([day, lines]) => ({ day, lines })).sort((x, y) => y.lines.length - x.lines.length || x.day - y.day).slice(0, n);
}

/**
 * The thaw summary (#1308): how you came through, what was left, the winter's
 * worst nights (the journal's own lines: English until phase 3), and the spring caravan.
 */
export function thawSummary(a: AppState, t: T): string {
  const s = a.sim;
  const grade: Grade = s.outcome?.grade ?? 'worn';
  const st = s.stores;
  const worst = worstNights(s);
  return `<div class="thaw"><p class="eyebrow ice">${esc(t('thaw.title', { n: s.day }))}</p><span class="grade g-${grade}">${esc(t(`thaw.${grade}`))}</span>
    <p class="mood" style="margin:6px 0 10px">${esc(t('thaw.condition', { n: Math.round(s.vitals.condition) }))}</p>
    <p class="fgroup">${esc(t('thaw.left'))}</p><div class="res">${storeChip('rawFood', st.rawFood, t)}${storeChip('rations', st.rations, t)}${storeChip('water', st.water, t)}${storeChip('firewood', st.firewood, t)}${storeChip('materials', st.materials, t)}</div>
    <p class="fgroup" style="margin-top:12px">${esc(t('thaw.worst'))}</p>${worst.length
      ? `<ul class="worst">${worst.map(w => `<li><span class="d">D${w.day}</span>${w.lines.map(l => esc(simLine(l, t))).join(" ")}</li>`).join("")}</ul>`
      : `<p class="mood" style="margin:0">${esc(t('thaw.noWorst'))}</p>`}
    ${a.stayed
      ? `<p class="mood" style="margin-top:12px">${esc(t('thaw.stayed'))}</p>`
      : `<div class="runbar" style="margin-top:12px"><button class="btn go" data-cmd="meet" title="${esc(t('thaw.meetTip'))}">${esc(t('thaw.meet'))}</button>
      <span class="mood" style="margin:0">${esc(t('thaw.wagons'))}</span></div>`}</div>`;
}

/**
 * The closing card's head: how the run ended, what that means, the thaw summary when it was
 * survived, and the run's facts. main.ts adds the records box and the new-Warden button.
 */
export function outcomeCard(a: AppState, run: RunRecord | undefined, t: T): string {
  const o = a.sim.outcome;
  if (!o) return '';
  // Difficulty (#1728): the run's record says it; without one (the API's views), the Warden's own.
  // In the facts always, so a full spend reads ×1.00 too; with no record, only when above ×1.00.
  const mult = run ? difficultyRead(run.difficulty) : difficultyOfCharacter(a.sim.character);
  const hard = `<li>${esc(t('end.difficulty', { m: difficultyLabel(mult) }))}</li>`;
  const facts = run ? `<ul class="runfacts">
      <li>${t(run.choice === 'thaw' ? 'end.thawOnHtml' : run.choice === 'collapse' ? 'end.endedOnHtml' : 'end.leftOnHtml', { n: run.day })}${run.grade ? t('end.gradeHtml', { grade: esc(t(`grade.${run.grade}`)) }) : ''}${run.readyDay ? t('end.readyOnHtml', { n: run.readyDay }) : esc(t('end.neverReady'))}</li>
      <li>${esc([run.site ? t('end.camp', { site: siteName(run.site, t), n: run.tier }) + (run.shelterGrade ? ` (${gradeWord(run.shelterGrade, t)})` : '') : t('end.noCamp'), t(run.tools.length === 1 ? 'end.tools.one' : 'end.tools.other', { n: run.tools.length }), t('end.recipes', { n: run.recipes }), t('end.milestones', { n: run.milestones })].join(' · '))}</li>
      ${hard}
    </ul>` : mult > 1 ? `<ul class="runfacts">${hard}</ul>` : '';
  const head = o.choice === 'collapse' ? t('end.ended') : t('end.complete');
  return `<h3>${esc(head)}</h3><div class="outcome"><span class="head">${esc(t(`end.${o.kind}`))}</span>${esc(t(`end.${o.kind}.body`))}</div>${o.kind === 'survived' ? thawSummary(a, t) : ''}${facts}`;
}

// ── The MAP tab before a map is drawn (#1686) ───────────────────────────────

/** The MAP tab with no map yet: what you know of the land as a scout would tell it, and what it'd take to draw a map. */
export function describedMap(s: Sim, t: T): string {
  const lines = landLines(s, t).map(l => `<li>${esc(l)}</li>`).join('');
  const needs = mapNeedsText(s, t);
  return `<section class="box"><p class="eyebrow">${esc(landDescribedHead(s, t))}</p>
    <p class="mapinfo">${esc(t(hasKit(s, 'map-compass') ? 'map.compassIntro' : 'map.noCompassIntro'))}</p>
    <ul class="landwords">${lines}</ul>
    <p class="mood">${esc(t('map.exploreMore') + (needs ? t('map.needs', { needs }) : ''))}</p></section>`;
}
