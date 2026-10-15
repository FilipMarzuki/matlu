/**
 * The LAND tab in the viewer's language (#1711, phase 4 of #1685; one tab with the old MAP, #1730):
 * what you know of the land, ring by ring, as confidence chips (design §3: ??? unknown · ~suspected
 * · observed · detailed), the finds you've made, the places you remember (pins-view.ts), and the key.
 *
 * With the descriptive-map switch on (#1686) it reads from the top down: what you know from camp
 * (your map first, once drawn, with its legend in a "Key"), then one collapsible section per ring
 * holding that ring's places in words, its chips and supply, its finds and its 📌 places; then how
 * to learn more (and what a map still needs), and the chips' key. What's new since the viewer last
 * looked is marked (land-news.ts). With the switch off it's the LAND tab as it was, with the Reach
 * map below it, as the MAP tab drew it.
 *
 * Pure functions of the run and `t`, so the tab can be drawn in a unit test. The map's grid and a
 * tapped square come from map-view.ts; main.ts hands in its cached copy with the tapped square.
 * The winter outlook the tab's status chip opens is the PROGRESS tab's (progress-view.ts).
 */

import { builtWarmthOn } from '../artificer/built-warmth';
import type { SiteId } from '../artificer/region1';
import type { Key, T } from '../artificer/i18n';
import { RINGS, TRAVEL_HOURS, FINDS, domainsOf, level, reachable, hasFind, supplyWord, type Ring } from '../artificer/exploration';
import { routeKnown, type Region1State } from '../artificer/region1';
import { campBiome, knownPlaces, mapMode } from '../artificer/descriptive-map';
import { ringOfHours } from '../artificer/world/reach';
import { hasKit } from '../artificer/kit';
import { esc } from './html';
import { buildsWords, distanceT, mapNeedsText, placeLine, ringName, siteName, spotWhere } from './sim-words';
import { campAsActionOn, knownSpots } from '../artificer/camp-sites';
import { buildsAt } from '../artificer/camp-builds';
import { distanceOn, measuredFromCamp } from '../artificer/distance-words';
import { timeWordsOn } from '../artificer/time-words';
import { pinsList, pinsRoom, ringPinChip, ringPinRows, ringPins } from './pins-view';
import { drawnMapBlock, reachMapSection } from './map-view';
import { fold } from './fold';
import { NO_NEWS, chipKey, placeKey, type LandNews } from './land-news';

/**
 * A ring's heading: its name and how far out it is. With `distance-not-rings` on (#1752) its name is
 * a distance, said from where it's measured: where you are until camp is made, camp after that; the
 * hours of walking it adds go with it, unless the time of day is told in words (#1740).
 */
function ringHead(s: Region1State, r: Ring, t: T): string {
  if (!distanceOn(s)) return `${esc(ringName(r, t).toUpperCase())} <span>${esc(TRAVEL_HOURS[r] ? t('ring.plus', { n: TRAVEL_HOURS[r] }) : t('ring.homeShort'))}</span>`;
  const from = t(measuredFromCamp(s) ? 'ring.from.camp' : 'ring.from.here');
  const plus = TRAVEL_HOURS[r] && !timeWordsOn(s) ? `${t('ring.plus', { n: TRAVEL_HOURS[r] })} · ` : '';
  return `${esc(ringName(r, t).toUpperCase())} <span>${esc(plus + from)}</span>`;
}

/** A ring you can't reach and know nothing of: it shows one line. */
const outOfReach = (s: Region1State, r: Ring): boolean => !reachable(s.explore, r) && domainsOf(r).every(d => level(s.explore, r, d) === 0);

/** The "new" mark (#1730) on what's new since the viewer last saw the tab (land-news.ts). */
const newMark = (t: T): string => ` <span class="newmark">${esc(t('land.new'))}</span>`;

/** A ring's knowledge chips (with how much each domain holds), then its finds and the pass. Chips that went up since the viewer last looked are marked. */
function ringChips(s: Region1State, r: Ring, t: T, news: LandNews = NO_NEWS): string {
  const e = s.explore;
  const chips = domainsOf(r).map(d => {
    const lv = level(e, r, d);
    const name = t(`land.domain.${d}` as Key);
    // What the land holds (#1304): only worth saying once you know the place, and once it isn't plenty.
    const supply = d === 'routes' ? null : supplyWord(e.supply[r][d]);
    const supplyText = supply ? t(`land.supply.${supply}` as Key) : '';
    const label = (lv === 0 ? '???' : lv === 1 ? `~${name}` : name) + (lv > 0 && supply && supply !== 'plenty' ? ` · ${supplyText}` : '');
    const tip = `${name}: ${t(`land.level.${lv}` as Key)}${supply ? ` · ${supplyText}` : ''}${e.worked[r][d] ? ` · ${t('land.worked', { n: e.worked[r][d] })}` : ''}`;
    const fresh = news.chips.has(chipKey(r, d));
    return `<span class="chip l${lv}${fresh ? ' new' : ''}" title="${esc(tip)}">${esc(label)}</span>${fresh ? newMark(t) : ''}`;
  }).join('');
  const finds = domainsOf(r).filter(d => hasFind(e, r, d) && FINDS[d]).map(d => { const f = t(`w.find.${d}` as Key); return `<span class="chip find">★ ${esc(f[0].toUpperCase() + f.slice(1))}</span>`; }).join('');
  const pass = r === 3 && routeKnown(s) ? `<span class="chip find">★ ${esc(t('land.pass'))}</span>` : '';
  return chips + finds + pass;
}

/**
 * What you know of the land, ring by ring, as confidence chips, plus the finds you've made. `pinRing`
 * is the ring whose remembered places are listed (tapping its 📌 opens it). The play API's text view
 * draws this too (view-words.ts), so it says what it said.
 */
export function landRings(s: Region1State, t: T, pinRing: Ring | null = null): string {
  t = distanceT(s, t);
  return RINGS.map(r => {
    const head = `<div class="ringhead">${ringHead(s, r, t)}</div>`;
    if (outOfReach(s, r)) return `${head}<p class="mood" style="margin:0 0 6px">${esc(t('land.outOfReach'))}</p>`;
    // Places you remember there (#1380): a 📌 that lists them when tapped.
    return `${head}<div class="res">${ringChips(s, r, t)}${ringPinChip(s, r, pinRing === r, t)}</div>${pinRing === r ? ringPins(s, r, t) : ''}`;
  }).join('');
}

/** The chips' key. */
export const landLegend = (t: T): string => `<div class="legend">${t('land.legendHtml')}</div>`;

/** A place you know of, in words, and whether it's new since the viewer last looked. */
interface PlaceLine { text: string; fresh: boolean }

/** The places you know of, in words, by the ring they lie in (descriptive-map.ts; beyond a day out counts as the distant ring). */
function placesByRing(s: Region1State, t: T, news: LandNews = NO_NEWS): Record<Ring, PlaceLine[]> {
  const out: Record<Ring, PlaceLine[]> = { 1: [], 2: [], 3: [] };
  for (const p of knownPlaces(s)) out[ringOfHours(p.hours) ?? 3].push({ text: placeLine(p, t), fresh: news.places.has(placeKey(p)) });
  return out;
}

const words = (lines: PlaceLine[], t: T): string => lines.length
  ? `<ul class="landwords">${lines.map(l => `<li${l.fresh ? ' class="new"' : ''}>${esc(l.text)}${l.fresh ? newMark(t) : ''}</li>`).join('')}</ul>` : '';

/**
 * One ring's section: its places in words, its chips and supply, its finds and its 📌 places, folded
 * under its name. The near ring starts open; a ring you can't reach yet is one line, folded shut.
 */
function ringSection(s: Region1State, r: Ring, places: PlaceLine[], t: T, news: LandNews): string {
  const held = (s.pins ?? []).filter(p => p.ring === r).length;
  const out = outOfReach(s, r);
  const summary = `<span class="ringhead" id="land-ring-${r}">${ringHead(s, r, t)}</span>${held ? ` <span class="foldnote">📌 ${held}</span>` : ''}${out ? ` <span class="foldnote">${esc(t('land.outOfReach'))}</span>` : ''}${news.rings.includes(r) ? newMark(t) : ''}`;
  // Out of reach with nothing seen there (not even on the skyline): only the line.
  if (out && !places.length) return `<div class="fold ringfold shut">${summary}</div>`;
  const body = `${words(places, t)}${out ? '' : `<div class="res">${ringChips(s, r, t, news)}</div>${ringPinRows(s, r, t)}`}`;
  return fold(`land.ring.${r}`, summary, body, r === 1 && !out, 'ringfold');
}

/**
 * The places to camp you know (#1732, `camp-as-action`), each marked ⛺: by name, direction and
 * walking time from where you are, your camp among them. Empty with the switch off. Making camp at
 * one is the Make camp action (or its card on the Camp tab).
 */
export function campSpotsSection(s: Region1State, t: T): string {
  if (!campAsActionOn(s)) return '';
  // Each with what's built there (#1753): "lean-to, cold pit".
  const built = (id: string): string => { const b = buildsAt(s, id); return b.length ? ` · ${esc(buildsWords(b, t))}` : ''; };
  // Its natural shelter in a word (#1763, `built-warmth`): "sheltered", "exposed".
  const shelter = (kind: SiteId): string => (builtWarmthOn(s) ? ` · ${esc(t(`shelter.word.${kind}`))}` : '');
  const rows = knownSpots(s).map(p => `<li${p.here ? ' class="here"' : ''}>⛺ <b>${esc(siteName(p.kind, t))}</b> — ${esc(spotWhere(p, t))}${p.here ? ` · ${esc(t('campsite.yours'))}` : p.start ? ` · ${esc(t('campsite.start'))}` : ''}${built(p.id)}${shelter(p.kind)}</li>`).join('');
  return `<section class="box" style="margin-top:14px"><p class="eyebrow">${esc(t('head.campSpots'))}</p><ul class="landwords campspots">${rows}</ul></section>`;
}

/** The merged LAND tab (#1730), with the descriptive-map switch on. `map` is your drawn map's block (map-view.ts). */
function mergedLand(s: Region1State, t: T, drawn: boolean, map: string, news: LandNews): string {
  const places = placesByRing(s, t, news);
  const needs = drawn ? '' : mapNeedsText(s, t);
  const top = `<section class="box"><p class="eyebrow">${esc(t(drawn ? 'head.yourMap' : 'head.landDescribed'))}</p>
    ${drawn ? map : `<p class="mapinfo">${esc(t(hasKit(s, 'map-compass') ? 'map.compassIntro' : 'map.noCompassIntro'))}</p>`}
    ${words([{ text: t(`map.camp.${campBiome(s)}`), fresh: false }], t)}</section>${campSpotsSection(s, t)}`;
  const pins = s.pins?.length ? pinsRoom(s, t) : `${pinsRoom(s, t)}<p class="mood" style="margin:0">${esc(t('pins.none'))}</p>`;
  return `${top}
    <section class="box" style="margin-top:14px"><p class="eyebrow">${esc(t('head.land'))}</p>${RINGS.map(r => ringSection(s, r, places[r], t, news)).join('')}
      <p class="eyebrow" style="margin-top:14px">${esc(t('head.pins'))}</p>${pins}
      <p class="mood">${esc(t('land.learnMore') + (needs ? t('map.needs', { needs }) : ''))}</p>
      ${fold('land.chipKey', esc(t('land.chipKey')), landLegend(t), false, 'keyfold')}</section>`;
}

/**
 * Options the page hands in: the map block drawn from its cached Reach and tapped square
 * (map-view.ts), and what's new since the viewer last saw the tab (land-news.ts).
 */
export interface LandOpts { map?: string; news?: LandNews }

/**
 * The LAND tab. With the descriptive-map switch on, the merged tab (above); with it off, the rings,
 * the key, how to learn more and the places you remember, then the Reach map, as LAND and MAP were.
 */
export function landTab(s: Region1State, t: T, pinRing: Ring | null = null, opts: LandOpts = {}): string {
  // The run's own words (#1752): its rings said as distances with `distance-not-rings` on, whoever draws it.
  t = distanceT(s, t);
  const mode = mapMode(s);
  if (mode !== 'reach') return mergedLand(s, t, mode === 'drawn', mode === 'drawn' ? opts.map ?? drawnMapBlock(s, t) : '', opts.news ?? NO_NEWS);
  return `<section class="box"><p class="eyebrow">${esc(t('head.land'))}</p>${landRings(s, t, pinRing)}${landLegend(t)}
        <p class="mood">${esc(t('land.howTo'))}</p></section>
        ${campSpotsSection(s, t)}<section class="box" style="margin-top:14px"><p class="eyebrow">${esc(t('head.pins'))}</p>${pinsList(s, t)}</section>
        <div style="margin-top:14px">${opts.map ?? reachMapSection(s, t)}</div>`;
}

/** The link from a land trip's line to its ring on the LAND tab (#1730): main.ts opens the tab there. */
export const seeLandLink = (r: Ring, t: T): string => `<button class="seeland" data-seeland="${r}">${esc(t('land.seeLand'))}</button>`;

/**
 * What a land trip turned up in its ring, for the one-at-a-time result card (#1730): the new places
 * in words and the chips that went up, then the link. Empty when the trip added nothing there.
 */
export function tripNews(s: Region1State, r: Ring, news: LandNews, t: T): string {
  if (!news.rings.includes(r)) return '';
  const fresh = placesByRing(s, t, news)[r].filter(p => p.fresh);
  const chips = domainsOf(r).filter(d => news.chips.has(chipKey(r, d)))
    .map(d => `<span class="chip l${level(s.explore, r, d)} new">${esc(t(`land.domain.${d}` as Key))}: ${esc(t(`land.level.${level(s.explore, r, d)}` as Key))}</span>`).join('');
  return `<div class="tripnews">${words(fresh, t)}${chips ? `<div class="res">${chips}</div>` : ''}<p style="margin:6px 0 0">${seeLandLink(r, t)}</p></div>`;
}
