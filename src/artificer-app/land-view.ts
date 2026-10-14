/**
 * The LAND tab in the viewer's language (#1711, phase 4 of #1685): what you know of the land, ring
 * by ring, as confidence chips (design §3: ??? unknown · ~suspected · observed · detailed), the
 * finds you've made, the places you remember (pins-view.ts), and the key.
 *
 * Moved out of main.ts so it can be drawn in a unit test, as a pure function of the run and `t`.
 * The winter outlook the tab's status chip opens is the PROGRESS tab's (progress-view.ts).
 */

import type { Key, T } from '../artificer/i18n';
import { RINGS, TRAVEL_HOURS, FINDS, domainsOf, level, reachable, hasFind, supplyWord, type Ring } from '../artificer/exploration';
import { routeKnown, type Region1State } from '../artificer/region1';
import { esc } from './html';
import { ringName } from './sim-words';
import { pinsList, ringPinChip, ringPins } from './pins-view';

/**
 * What you know of the land, ring by ring, as confidence chips, plus the finds you've made. `pinRing`
 * is the ring whose remembered places are listed (tapping its 📌 opens it).
 */
export function landRings(s: Region1State, t: T, pinRing: Ring | null = null): string {
  const e = s.explore;
  return RINGS.map(r => {
    const head = `<div class="ringhead">${esc(ringName(r, t).toUpperCase())} <span>${esc(TRAVEL_HOURS[r] ? t('ring.plus', { n: TRAVEL_HOURS[r] }) : t('ring.homeShort'))}</span></div>`;
    if (!reachable(e, r) && domainsOf(r).every(d => level(e, r, d) === 0)) return `${head}<p class="mood" style="margin:0 0 6px">${esc(t('land.outOfReach'))}</p>`;
    const chips = domainsOf(r).map(d => {
      const lv = level(e, r, d);
      const name = t(`land.domain.${d}` as Key);
      // What the land holds (#1304): only worth saying once you know the place, and once it isn't plenty.
      const supply = d === 'routes' ? null : supplyWord(e.supply[r][d]);
      const supplyText = supply ? t(`land.supply.${supply}` as Key) : '';
      const label = (lv === 0 ? '???' : lv === 1 ? `~${name}` : name) + (lv > 0 && supply && supply !== 'plenty' ? ` · ${supplyText}` : '');
      const tip = `${name}: ${t(`land.level.${lv}` as Key)}${supply ? ` · ${supplyText}` : ''}${e.worked[r][d] ? ` · ${t('land.worked', { n: e.worked[r][d] })}` : ''}`;
      return `<span class="chip l${lv}" title="${esc(tip)}">${esc(label)}</span>`;
    }).join('');
    const finds = domainsOf(r).filter(d => hasFind(e, r, d) && FINDS[d]).map(d => { const f = t(`w.find.${d}` as Key); return `<span class="chip find">★ ${esc(f[0].toUpperCase() + f.slice(1))}</span>`; }).join('');
    const pass = r === 3 && routeKnown(s) ? `<span class="chip find">★ ${esc(t('land.pass'))}</span>` : '';
    // Places you remember there (#1380): a 📌 that lists them when tapped.
    return `${head}<div class="res">${chips}${finds}${pass}${ringPinChip(s, r, pinRing === r, t)}</div>${pinRing === r ? ringPins(s, r, t) : ''}`;
  }).join('');
}

/** The chips' key. */
export const landLegend = (t: T): string => `<div class="legend">${t('land.legendHtml')}</div>`;

/** The LAND tab: the rings, the key, how to learn more, and the places you remember. */
export function landTab(s: Region1State, t: T, pinRing: Ring | null = null): string {
  return `<section class="box"><p class="eyebrow">${esc(t('head.land'))}</p>${landRings(s, t, pinRing)}${landLegend(t)}
        <p class="mood">${esc(t('land.howTo'))}</p></section>
        <section class="box" style="margin-top:14px"><p class="eyebrow">${esc(t('head.pins'))}</p>${pinsList(s, t)}</section>`;
}
