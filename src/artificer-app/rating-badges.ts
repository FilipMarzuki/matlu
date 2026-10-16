/**
 * The camp-site rating badges (#1756, switch `camp-site-ratings`), in one place so every place that
 * shows them draws the same markup (#1798): the Make camp card and its list of sites (camp-blocks.ts),
 * the LAND tab's places to camp (land-view.ts) and the map-drawing session's list (map-session-view.ts).
 *
 * Both read `siteRating`, so a site shows what the Warden *believes* about it, a vague reading's
 * mistakes included, and both are '' with the switch off: a page that calls them is unchanged then.
 */

import type { T } from '../artificer/i18n';
import { ratingBadges, siteRating, siteRatingCounts, siteRatingsOn, type CampSpot } from '../artificer/camp-sites';
import { esc } from './html';

type Run = Parameters<typeof siteRatingCounts>[0];

/**
 * One site's badge: "★ GREAT" or "✓ GOOD" beside its name, styled `.rate.great` / `.rate.good`.
 * A poor site isn't marked, and nothing is with the switch off.
 */
export function siteBadge(s: Run, p: Pick<CampSpot, 'kind' | 'x' | 'y'>, t: T): string {
  if (!siteRatingsOn(s)) return '';
  const r = siteRating(s, p);
  return r === 'poor' ? '' : `<span class="rate ${r}">${esc(t(`campsite.rate.${r}`))}</span>`;
}

/**
 * The count of them (#1756): how many places to camp you know that you believe great (★) and good
 * (✓), "★ 1 · ✓ 3", with the full words in its tooltip. Nothing until one rates good or better, so
 * they pop up as you find sites. One short inline span, so a title row keeps its height.
 */
export function campBadges(s: Run, t: T): string {
  const c = siteRatingCounts(s);
  const text = ratingBadges(c);
  return text ? `<span class="cbadges" title="${esc(t('campsite.badgesTip', { great: c.great, good: c.good }))}">${esc(text)}</span>` : '';
}
