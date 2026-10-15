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

import { numText, type T } from '../artificer/i18n';
import { visibilityOf, greyedTappable, shown } from '../artificer/action-visibility';
import { hasKit } from '../artificer/kit';
import { visibilityOn, ACTIONS, SITES, BUILD_COST, FISH_CATCH, DISCOVERIES, HIDE_PARKA_RECIPE, coldPitHolds, coldCapacity, spoilage, warmth, queueId, queueHours, parseItem, type ActionId, type SiteId } from '../artificer/region1';
import { RINGS, TRAVEL_HOURS, RICHNESS, reachable, scouted, tripYield, hasFind, type Domain, type Ring } from '../artificer/exploration';
import { modifiersFor } from '../artificer/crafting';
import { seasonOf, MIDWINTER_AFTER, type Grade } from '../artificer/winter';
import { daylightHours } from '../artificer/clock';
import { dayMean, nightTemp, isBlizzard, BLIZZARD_HOURS, type WeatherId } from '../artificer/weather';
import { BASELINE, CAP_CEIL, morale, type Pool } from '../artificer/vitality';
import type { Haul } from '../artificer/load';
import type { RunRecord } from '../artificer/legacy';
import { difficultyRead, difficultyOfCharacter, difficultyLabel } from '../artificer/difficulty';
import { vitalCostLabel } from './feature-choices';
import { itemIcon } from './item-icons';
import { esc, hrs, pct, band } from './html';
import { actionName, conceptName, gradeWord, landLines, mapNeedsText, recipeName, ringName, siteName, simLine, weatherLines, weatherWord } from './sim-words';
import { seasonView, weatherReport } from '../artificer/weather-words';
import type { previewQueue, AppState } from './controller';
import type { DayPlay, Moment } from './playback';

type Sim = AppState['sim'];
export type Preview = ReturnType<typeof previewQueue>;

// ── The actions ─────────────────────────────────────────────────────────────

/** The action palette's groups: `key` names the heading in the catalog (`group.*`). */
export const GROUPS: { key: 'explore' | 'provision' | 'build' | 'craft' | 'carry' | 'think'; ids: ActionId[] }[] = [
  { key: 'explore', ids: ['explore', 'scout', 'survey', 'track', 'lookout'] },
  { key: 'provision', ids: ['gather', 'hunt', 'water', 'wood', 'quarry', 'fish', 'preserve'] },
  { key: 'build', ids: ['build', 'coldPit', 'coldGear'] },
  { key: 'craft', ids: ['knife', 'snare', 'waterskin', 'bedroll', 'shovel'] },
  { key: 'carry', ids: ['basket', 'backpack', 'harness', 'sled'] },
  { key: 'think', ids: ['study', 'experiment', 'tinker', 'rest', 'treat'] },
];

export const ICON: Record<ActionId, string> = {
  scout: '🥾', survey: '📐', track: '🐾', gather: '🌿', hunt: '🏹', water: '💧',
  wood: '🪵', quarry: '⛰️', preserve: '🧂', build: '⛺', coldGear: '🧥', tinker: '🛠️', rest: '☕', treat: '🩹',
  lookout: '🔭', study: '📖', explore: '🧭', experiment: '🧪', knife: '🔪', snare: '🪤', waterskin: '🫗', bedroll: '🛏️', shovel: '⛏️', fish: '🎣', coldPit: '🧊', basket: '🧺', backpack: '🎒', harness: '🪢', sled: '🛷',
};

/** Extra yield your tools give an action (shown in the hint). */
const bonus = (s: Sim, id: ActionId): number => modifiersFor(s.tools, id).yieldAdd;
/** +2 if you've made the find in this ring × domain. */
const fb = (s: Sim, r: Ring, d: Domain): number => (hasFind(s.explore, r, d) ? 2 : 0);
/** Shorthand: this trip's yield from what you know of the ring (mirrors region1.ts). */
const ty = (s: Sim, r: Ring, d: Domain, base: number, per: number): number => tripYield(s.explore, r, d, base, per);

/** One line of "what you get" per action, in the chosen ring. Numbers mirror region1.ts yields. */
export function yieldText(id: ActionId, s: Sim, r: Ring, t: T): string {
  switch (id) {
    case 'gather': return t(fb(s, r, 'forage') ? 'yield.gatherFiber' : 'yield.gather', { n: ty(s, r, 'forage', 3, 2) + bonus(s, 'gather') });
    case 'hunt': return t('yield.hunt', { n: ty(s, r, 'game', 7, 0) + bonus(s, 'hunt') + fb(s, r, 'game') });
    case 'water': return t('yield.water', { n: ty(s, r, 'water', 4, 1) + (s.site === 'river' && r === 1 ? 2 : 0) + bonus(s, 'water') + fb(s, r, 'water') });
    case 'wood': return t('yield.wood', { n: ty(s, r, 'timber', 4, 1) + (s.site === 'tree' && r === 1 ? 1 : 0) + fb(s, r, 'timber'), m: ty(s, r, 'timber', 2, 1) });
    case 'quarry': return t('yield.quarry', { n: ty(s, r, 'stone', 3, 1) + fb(s, r, 'stone') });
    case 'fish': return t('yield.fish', { n: FISH_CATCH * RICHNESS[r] });
    case 'build': return s.tier < 2 ? t('yield.build', { n: s.tier + 1, m: BUILD_COST[s.tier as 0 | 1] }) : t('yield.winterized');
    case 'coldPit': return t('yield.coldPit', { n: coldPitHolds(s.site) });
    default: return t(`yield.${id}`);
  }
}

/** What a trip carries home, short (a craft's ingredients, the load bar). */
export const haulWord = (k: string, t: T): string =>
  (['rawFood', 'rations', 'water', 'firewood', 'materials', 'stone', 'hides'] as (keyof Haul)[]).includes(k as keyof Haul) ? t(`haul.${k as keyof Haul}`) : k;

/**
 * A craft's ingredients (#1675) as icon chips under its card: "[icon] 2 mat". The recipe is the one
 * the action would use with its default options (cold gear: woven fiber; a build: the plan as it
 * stands), so a chosen option can change it; the queue row's options say what the choice costs.
 */
function ingredients(def: (typeof ACTIONS)[ActionId], s: Sim, t: T): string {
  const recipe = def.recipeFor?.(s, {}) ?? def.recipe;
  if (!recipe?.inputs.length) return '';
  return `<div class="ingr">${recipe.inputs.map(i => `<span>${itemIcon(i.item)}<b>${i.qty}</b> ${esc(haulWord(i.item, t))}</span>`).join('')}</div>`;
}

/**
 * The actions area: ring tabs, then each group's actions with their hours and what they yield, or
 * why they can't be done. Gates are judged against the state *after* the queue so far, so you can
 * plan "scout, then gather" in one go. Land actions go to the ring picked in the tabs.
 */
export function paletteBlock(a: AppState, preview: Preview, opts: { ring: Ring; dev: boolean; t: T }): string {
  const { ring: focusRing, dev, t } = opts;
  const resolved = a.sim.outcome !== null;
  const tabs = `<div class="rings">${RINGS.map(r => {
    const open = reachable(preview.projected.explore, r);
    return `<button class="ringtab ${focusRing === r ? 'on' : ''} ${open ? '' : 'locked'}" data-ring="${r}" title="${open ? '' : esc(t('ring.lockedTip'))}">`
      + `${esc(ringName(r, t).toUpperCase())}<span>${esc(TRAVEL_HOURS[r] ? t('ring.travel', { n: TRAVEL_HOURS[r] }) : t('ring.home'))}</span></button>`;
  }).join('')}</div>`;
  // A group with nothing the Warden knows how to do yet (#1690) isn't shown at all.
  const known = GROUPS.map(g => ({ ...g, ids: g.ids.filter(id => shown(preview.projected, id)) })).filter(g => g.ids.length);
  return tabs + known.map(g => `<div class="group"><h4>${esc(t(`group.${g.key}`))}${g.key === 'explore' || g.key === 'provision' ? ` <span class="ringnote">${esc(t('group.ringNote', { ring: ringName(focusRing, t).toLowerCase() }))}</span>` : ''}</h4><div class="acts">${g.ids.map(id => {
    const def = ACTIONS[id];
    const r: Ring = def.ringed ? focusRing : 1;
    const q = queueId(id, r);
    // What the Warden knows how to do (#1690): hidden if not, greyed out (with why) if not right now.
    // With the switch off a blocked action stays tappable, as before: it would just be skipped.
    const vis = visibilityOf(preview.projected, id, r);
    if (vis.status === 'hidden') return '';
    const why = vis.reason ? simLine(vis.reason, t) : null;
    const greyed = !!why && !greyedTappable(preview.projected);
    // Which vitals it spends: a dev-mode view (#1688); players plan by hours and read the bars.
    const spends = vitalCostLabel(def, dev);
    return `<button class="act ${why ? 'soft' : ''} ${greyed ? 'greyed' : ''}" data-q="${q}" ${resolved || greyed ? 'disabled' : ''} title="${why ? esc(greyed ? why : t('act.wouldSkip', { why })) : ''}">`
      + `<div class="t">${ICON[id]} ${esc(actionName(id, t).toUpperCase())}<span class="h">${hrs(queueHours(q, preview.projected), t)}H</span></div>`
      + `<div class="y">${why ? `<span class="gate">${esc(why)}</span>` : `<span class="yield">${esc(yieldText(id, preview.projected, r, t))}</span>${spends ? ` · <span class="vc">${spends}</span>` : ''}`}</div>${ingredients(def, preview.projected, t)}</button>`;
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

/**
 * The weather box (#1729, switch `weather-words`): the weather and the season in words, and as
 * much of the calendar as the Warden has earned (weather-words.ts). In words at the start; with a
 * tally kept, the day and about how long to the snow; once a season has turned, the strip as well
 * (its bars and markers, never the hours of light or the degrees). Dev mode shows the strip with
 * its numbers alongside the words from day 1. With the switch off it's the season strip, as today.
 */
export function weatherBox(s: Sim, t: T, opts: { dev?: boolean } = {}): string {
  const view = seasonView(s);
  if (view === 'numbers') return seasonStrip(s, t);
  const seeded = s.config.world.weather === 'seeded';
  const blizzard = seeded && isBlizzard(s.weatherToday, s.day, s.config.calendar);
  const words = `<div class="wxwords"><p class="eyebrow">${seeded ? `${WEATHER_ICON[s.weatherToday]} ` : ''}${esc(t('wx.head'))}</p>`
    + weatherLines(s, t).map(l => `<p>${esc(l)}</p>`).join('') + '</div>';
  const strip = opts.dev ? seasonStrip(s, t)
    : view === 'strip' ? `<div class="seasonstrip" aria-label="${esc(t('season.label'))}">${stripBars(s, t, false)}</div>`
      : '';
  // The dev strip carries its own blizzard banner.
  return `<div class="wxbox">${words}${strip}`
    + (blizzard && !opts.dev ? `<p class="lockbanner">${esc(t('season.blizzard', { n: BLIZZARD_HOURS }))}</p>` : '')
    + '</div>';
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

type StoreKey = keyof Sim['stores'];
const STORE_EMOJI: Record<StoreKey, string> = { rawFood: '🍖', water: '💧', firewood: '🪵', materials: '🪨', rations: '🧂', stone: '⛰️', hides: '🦌' };

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
    + `${storeChip('firewood', st.firewood, t)}${storeChip('materials', st.materials, t)}${storeChip('rations', st.rations, t)}${storeChip('stone', st.stone, t)}${storeChip('hides', st.hides, t)}</div>`;
}

/** The CAMP tab's cold storage (#1296): raw food kept cold or exposed, and what tonight will cost. */
export function coldBlock(s: Sim, t: T): string {
  if (s.config.world.weather !== 'seeded') return '';
  const temp = nightTemp(s.day, s.weatherToday, s.config.calendar);
  const cap = coldCapacity(s, temp);
  const sp = spoilage(s.stores.rawFood, cap, temp);
  const pitHolds = s.site && s.coldPitAt === s.site ? coldPitHolds(s.site) : 0;
  const pit = pitHolds ? t('cold.pit', { n: pitHolds }) : null;
  const snow = cap - pitHolds > 0 ? t('cold.snow', { n: cap - pitHolds }) : null;
  const where = pit && snow ? t('cold.and', { a: pit, b: snow }) : pit ?? snow ?? t('cold.nothing');
  return `<div class="coldrow"><span>${t('cold.keptHtml', { n: sp.kept, cap })}</span><span>${t('cold.exposedHtml', { n: sp.exposed })}</span>`
    + `<span class="${sp.spoiled ? 'warn' : 'ok'}">${esc(sp.spoiled ? t('cold.spoil', { n: sp.spoiled }) : t('cold.noSpoil'))}</span></div>`
    + `<p class="mood" style="margin:4px 0 0">${esc(t('cold.storage', { where }))}</p>`;
}

/** Where camp can be made: each site, how warm it can get, and the camp as it stands. */
export function sitesBlock(s: Sim, t: T): string {
  const sites = (Object.keys(SITES) as SiteId[]).map(id => {
    const here = s.site === id
      ? ` ${[t('site.shelter', { tier: s.tier }) + (s.shelterGrade ? ` (${gradeWord(s.shelterGrade, t)})` : ''), t('site.warm', { n: Math.round(warmth(s) * 100) }), ...(s.coldPitAt === id ? [t('site.pit', { n: coldPitHolds(id) })] : [])].join(' · ')}.`
      : '';
    return `<button class="siteopt ${s.site === id ? 'chosen' : ''}" data-site="${id}" ${scouted(s.explore, 1) && !s.outcome ? '' : 'disabled'}>`
      + `<div class="t">${esc(siteName(id, t).toUpperCase())}<span class="warm" style="margin-left:auto">${esc(t('site.maxWarm', { n: Math.round(SITES[id].warmth * 100) }))}</span></div>`
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

/** The leg of a trip session (#1668), in words; else the action's hours. */
export function phaseText(p: DayPlay, m: Moment, t: T): string {
  if (m.index >= p.steps.length) return t('timer.sleep');
  const st = p.steps[m.index];
  if (m.phase) return `${m.phase.trips > 1 ? t('timer.trip', { n: m.phase.trip, total: m.phase.trips }) : ''}${t(`timer.${m.phase.kind}`)}`;
  return st.hours > 0 ? `${hrs(st.hours, t)}h` : t('timer.skipped');
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
  const head = o.choice === 'collapse' ? t('end.ended', { n: run?.run ?? '' }) : t('end.complete', { n: run?.run ?? '' });
  return `<h3>${esc(head)}</h3><div class="outcome"><span class="head">${esc(t(`end.${o.kind}`))}</span>${esc(t(`end.${o.kind}.body`))}</div>${o.kind === 'survived' ? thawSummary(a, t) : ''}${facts}`;
}

// ── The MAP tab before a map is drawn (#1686) ───────────────────────────────

/** The MAP tab with no map yet: what you know of the land as a scout would tell it, and what it'd take to draw a map. */
export function describedMap(s: Sim, t: T): string {
  const lines = landLines(s, t).map(l => `<li>${esc(l)}</li>`).join('');
  const needs = mapNeedsText(s, t);
  return `<section class="box"><p class="eyebrow">${esc(t('head.landDescribed'))}</p>
    <p class="mapinfo">${esc(t(hasKit(s, 'map-compass') ? 'map.compassIntro' : 'map.noCompassIntro'))}</p>
    <ul class="landwords">${lines}</ul>
    <p class="mood">${esc(t('map.exploreMore') + (needs ? t('map.needs', { needs }) : ''))}</p></section>`;
}
