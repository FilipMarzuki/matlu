/**
 * What an area holds, as small icons beside its heading on LAND (#1847, with `land-found-only`):
 * water, wood, food plants, game, stone, fish, and ⛺ for a good place to camp.
 *
 * The icons are the game's own action icons (`ICON` in camp-blocks.ts), so 💧 on LAND is the 💧 on
 * the Fetch water card. An icon shows only once that domain has been *seen* at that distance: known
 * to "observed" (level 2) or better, not merely suspected (a scout's first look suspects everything,
 * which would light every icon at once and say nothing). Dimmed when what's there is scarce or bare.
 * Each carries its name and how well it's known as its tooltip and its accessible name.
 *
 * Fish needs water seen *and* a lake or stream known there (the descriptive map's places). ⛺ shows
 * when a place to camp in that area is believed good or great, from the same `siteRating` the
 * rating badges use (#1798), so it's there only with `camp-site-ratings` on, like the badges.
 */

import type { Key, T } from '../artificer/i18n';
import type { Region1State } from '../artificer/region1';
import { level, reachable, supplyWord, domainsOf, type Domain, type Ring } from '../artificer/exploration';
import { knownPlaces } from '../artificer/descriptive-map';
import { knownSpots, siteRating, siteRatingsOn } from '../artificer/camp-sites';
import { ringOfHours } from '../artificer/world/reach';
import { ICON } from './camp-blocks';
import { esc } from './html';

/** Known well enough to show its icon: observed or better. */
export const ICON_LEVEL = 2;

/** Each domain's icon, by the action that works it. Routes have none: there's nothing to fetch. */
const DOMAIN_ICON: Partial<Record<Domain, string>> = {
  water: ICON.water, timber: ICON.wood, forage: ICON.gather, game: ICON.hunt, stone: ICON.gatherstone,
};
/** The order they're shown in. */
const ORDER: readonly Domain[] = ['water', 'timber', 'forage', 'game', 'stone'];

const icon = (glyph: string, label: string, dim: boolean): string =>
  `<span class="licon${dim ? ' dim' : ''}" role="img" title="${esc(label)}" aria-label="${esc(label)}">${glyph}</span>`;

/** The ring a place lies in (beyond a day out counts as the distant ring), as LAND sorts them. */
const ringOf = (hours: number): Ring => ringOfHours(hours) ?? 3;

/**
 * An area's icons (#1847), '' when there's nothing to show. An area out of reach shows none:
 * it's one line saying so.
 */
export function landIcons(s: Region1State, r: Ring, t: T): string {
  const e = s.explore;
  if (!reachable(e, r)) return '';
  const out: string[] = [];
  for (const d of ORDER) {
    if (!domainsOf(r).includes(d) || level(e, r, d) < ICON_LEVEL) continue;
    const supply = supplyWord(e.supply[r][d]);
    const dim = supply === 'scarce' || supply === 'bare';
    const label = `${t(`land.domain.${d}` as Key)}: ${t(`land.level.${level(e, r, d)}` as Key)}${dim ? ` · ${t(`land.supply.${supply}` as Key)}` : ''}`;
    out.push(icon(DOMAIN_ICON[d]!, label, dim));
    // Fish: water seen, and a lake or stream to fish in.
    if (d === 'water' && knownPlaces(s).some(p => (p.kind === 'lake' || p.kind === 'stream') && ringOf(p.hours) === r)) {
      out.push(icon(ICON.fish, `${t('land.icon.fish')}: ${t(`land.level.${level(e, r, d)}` as Key)}${dim ? ` · ${t(`land.supply.${supply}` as Key)}` : ''}`, dim));
    }
  }
  if (siteRatingsOn(s)) {
    const rates = knownSpots(s).filter(p => ringOf(p.hours) === r).map(p => siteRating(s, p));
    const best = rates.includes('great') ? 'great' : rates.includes('good') ? 'good' : null;
    if (best) out.push(icon('⛺', t(`land.icon.camp.${best}`), false));
  }
  return out.length ? ` <span class="landicons">${out.join('')}</span>` : '';
}
