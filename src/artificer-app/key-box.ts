/**
 * The key survival box under the FOCUS chip (#1891), and the night chip with the shelter in it.
 *
 * The box shows a region's key metrics (artificer/key-metrics.ts): for Region 1 food, as the days
 * it covers (every edible store in one 🍖, its kinds behind a tap), water and firewood. Everything
 * else (materials, stone, hides, sinew) is in the CAMP tab's full stores list (camp-blocks.ts
 * `storesRow`). Moved out of main.ts so both can be drawn in a unit test: pure functions of the
 * run and `t`, no DOM.
 */

import type { Key, T } from '../artificer/i18n';
import { foodBreakdown, keyMetrics, type KeyMetric } from '../artificer/key-metrics';
import { nightFuel, tonightThermal, tonightsFright, warmth, type Region1State } from '../artificer/region1';
import { itemIcon } from './item-icons';
import { esc } from './html';
import { nightTip } from './queue-words';

const plural = (t: T, key: string, n: number, vars: Record<string, string | number> = {}): string => t(`${key}.${n === 1 ? 'one' : 'other'}` as Key, { n, ...vars });

/** Each key metric's store icon (its 32 px art, else the emoji) and the store it stands for. */
const METRIC_ICON: Readonly<Record<KeyMetric['id'], { store: string; emoji: string }>> = {
  food: { store: 'rawFood', emoji: '🍖' },
  water: { store: 'water', emoji: '💧' },
  firewood: { store: 'firewood', emoji: '🪵' },
};
/** Rations' emoji (#1890 changes it from 🧂 to 💨). */
const RATIONS_EMOJI = '💨';

/** An icon standing alone, so its name is its alt and title (the compact status bar, #1675). */
const soloIcon = (store: string, emoji: string, name: string): string => {
  const img = itemIcon(store, { alt: name });
  return img ? img.replace('<img ', `<img title="${esc(name)}" `) : emoji;
};

/** A running hunger or thirst streak (#1233): the next night without costs more. */
const streak = (n: number, word: string, tip: string): string =>
  (n ? ` <i class="streak" title="${esc(tip)}">${esc(word)} ×${n}</i>` : '');

/** The food's kinds, behind the 🍖: raw food (and of it the meat), rations, and what spoils tonight. */
export function foodKinds(s: Region1State, t: T): string {
  const f = foodBreakdown(s);
  const raw = `<li><span>${itemIcon('rawFood', { fallback: '🍖' })} ${esc(t('keys.raw'))}${f.meat ? ` <i>(${esc(t('keys.meat', { n: f.meat }))})</i>` : ''}</span><b>${f.raw}</b>`
    + `<span class="${f.spoilsTonight ? 'spoils' : 'keeps'}">${esc(f.spoilsTonight ? t('keys.spoils', { n: f.spoilsTonight }) : t('keys.noSpoil'))}</span></li>`;
  const rations = `<li><span>${itemIcon('rations', { fallback: RATIONS_EMOJI })} ${esc(t('keys.rations'))}</span><b>${f.rations}</b><span class="keeps">${esc(t('keys.keeps'))}</span></li>`;
  return `<div class="kpop"><p class="eyebrow">${esc(t('keys.kinds'))}</p><ul class="kkinds">${raw}${rations}</ul><p class="kall">${esc(t('keys.allStores'))}</p></div>`;
}

/**
 * The key box (#1891): the region's key metrics as they stand. Food reads "4 days"; tapping it (a
 * `<details>`, so it works with no script of ours) or hovering (its title) shows the kinds. The
 * hunger and thirst streaks and the `low` colour are kept from the old stores row.
 */
export function keyBox(s: Region1State, t: T): string {
  const cells = keyMetrics(s, { needs: false }).map(m => {
    const ic = METRIC_ICON[m.id];
    if (m.id === 'food') {
      const days = plural(t, 'keys.days', m.value);
      return `<details class="kfood${m.low ? ' low' : ''}"><summary title="${esc(t('keys.foodTip', { days }))}">${soloIcon(ic.store, ic.emoji, t('store.rawFood'))}<span class="kv">${esc(days)}</span>`
        + `${streak(s.deprivation.hungry, t('status.hungry'), t('status.hungryTip'))}</summary>${foodKinds(s, t)}</details>`;
    }
    const tip = m.id === 'water' ? t('keys.waterTip') : t('keys.firewoodTip', { n: nightFuel(s) });
    const extra = m.id === 'water' ? streak(s.deprivation.thirsty, t('status.thirsty'), t('status.thirstyTip')) : '';
    return `<span class="k-${m.id}${m.low ? ' low' : ''}" title="${esc(tip)}">${soloIcon(ic.store, ic.emoji, t(`store.${ic.store}` as Key))}<span class="kv">${m.value}</span>${extra}</span>`;
  }).join('');
  return `<div class="keybox sstores" role="group" aria-label="${esc(t('keys.box'))}">${cells}</div>`;
}

/** Tonight's warmth in a word: the thermal model's quality (#1770), else the shelter's warmth as a share. */
function warmthWords(s: Region1State, t: T): { short: string; long: string; quality: string } {
  const n = tonightThermal(s);
  if (n) return { short: t(`keys.warm.${n.quality}` as Key), long: t(`night.q.${n.quality}` as Key), quality: n.quality };
  const pctWarm = Math.round(warmth(s) * 100);
  return { short: t('keys.warmPct', { n: pctWarm }), long: t('site.warm', { n: pctWarm }), quality: 'pct' };
}

/**
 * The night chip (#1364, #1891): the shelter you have and how warm tonight looks, once there's a
 * camp, and, if tonight looks frightening, an uneasy or sleepless night and why (the tooltip).
 * Empty before camp on a calm night, and once the run is over.
 */
export function nightChip(s: Region1State, t: T): string {
  if (s.outcome) return '';
  const f = tonightsFright(s);
  const fright = f && f.state !== 'calm' ? { ...f, state: f.state } : null;
  if (!s.site && !fright) return '';
  const parts: string[] = [];
  const tips: string[] = [];
  let quality = '';
  if (s.site) {
    const w = warmthWords(s, t);
    quality = w.quality;
    parts.push(s.tier > 0 ? t('keys.shelter.tier', { tier: s.tier }) : t('keys.shelter.none'), w.short);
    tips.push(t('keys.nightTip', { shelter: s.tier > 0 ? t('site.shelter', { tier: s.tier }) : t('keys.openCamp'), warmth: w.long }));
  }
  if (fright) {
    // Beside the shelter the short word; alone (no camp yet), the chip's old words.
    parts.push(s.site ? t(fright.state === 'shaken' ? 'keys.uneasy' : 'keys.sleepless') : t(fright.state === 'shaken' ? 'night.uneasy' : 'night.sleepless'));
    tips.push(nightTip({ state: fright.state, perceived: fright.perceived, reasons: fright.reasons }, t));
  }
  // Frightened, it keeps the fear colours it always had; otherwise it takes the night's quality.
  const cls = fright ? `fear s-${fright.state}` : `nightq q-${quality}`;
  return `<span class="tag ${cls}" title="${esc(tips.join(' '))}">🌑 ${esc(parts.join(' · '))}</span>`;
}
