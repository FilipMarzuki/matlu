/**
 * The opening's two forms (#1707), in the viewer's language: the packing screen (#1401) and
 * character creation (#1239, #1258, #1263, #1399). Moved out of main.ts so they can be drawn in a
 * test without a browser; main.ts calls them with its `t` and the draft it keeps.
 *
 * Pure: state in, HTML out. Each takes `t`, the page's translate function, so every word on these
 * screens comes from the catalog.
 */

import type { T } from '../artificer/i18n';
import { KIT, KIT_GROUPS, PACK_CAPACITY, packWeight, kitItem, type KitGroup, type KitId } from '../artificer/kit';
import { talentOffer, seedOf, TALENT_PICKS, type TalentId } from '../artificer/talents';
import { STAT_IDS, POINT_BUDGET, canRaise, canLower, raiseCost, pointsLeft, type Stats } from '../artificer/stats';
import { grownStats, START_AGES } from '../artificer/growing';
import { itemIcon } from './item-icons';
import { esc, portraitEl } from './html';
import { kitName, statNoteText } from './sim-words';

/** What the creation screen is choosing (main.ts keeps it, and saves it as it changes). */
export interface DraftView { id: string; name: string; portrait: string; talents: TalentId[]; stats: Stats; age: number }

/**
 * A packed item's hover text: what it's for and the scout's note (#1684), never its rule, unless
 * the hidden truths are on (`?dev=truths`).
 */
export function packTitle(id: KitId, t: T, truths: boolean): string {
  return `${t(`kit.${id}.does`)} ${t(`kit.${id}.note`)}${truths ? ` [rule: ${kitItem(id).effect}]` : ''}`;
}

/** Which pack sections the viewer has opened or folded (#1727), by section: what main.ts keeps in the browser. */
export type PackOpen = Partial<Record<KitGroup, boolean>>;

/** Where main.ts keeps `PackOpen`, per browser (a convenience: lose it and the sections fall back to their defaults). */
export const PACK_OPEN_KEY = 'artificer.packOpen';

/**
 * Is a pack section open? As the viewer last left it; until they've touched it, open when it holds
 * something packed, so the leader's list shows what's in the pack and the 30 odd things don't
 * bury it (#1727).
 */
export function sectionOpen(g: KitGroup, pack: readonly KitId[], open: PackOpen = {}): boolean {
  return open[g] ?? KIT.some(k => k.group === g && pack.includes(k.id));
}

/** A stored `PackOpen`, kept only where it's a section id and a boolean; anything else reads as nothing touched. */
export function readPackOpen(raw: string | null): PackOpen {
  try {
    const o = JSON.parse(raw ?? 'null') as unknown;
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return {};
    return Object.fromEntries(Object.entries(o).filter(([g, v]) => Object.hasOwn(KIT_GROUPS, g) && typeof v === 'boolean')) as PackOpen;
  } catch { return {}; }
}

/**
 * The packing screen (#1401): the whole list, by group — each item with its weight, what it is for
 * out here, and a scout's note. Tap to pack, tap again to take it out; what won't fit is greyed.
 * The weight bar and the leader's list stay at the bottom.
 *
 * Each section folds (#1727): a `<details>` whose `<summary>` main.ts listens to. The page redraws
 * on every tap, so whether a section is open comes from `open` (the viewer's choices), not from
 * the browser's own toggle, which a redraw would forget.
 */
export function packForm(pack: readonly KitId[], t: T, truths = false, open: PackOpen = {}): string {
  const kg = packWeight(pack);
  const groups = (Object.keys(KIT_GROUPS) as KitGroup[]).map(g => {
    const items = KIT.filter(k => k.group === g).map(k => {
      const on = pack.includes(k.id);
      const fits = on || packWeight([...pack, k.id]) <= PACK_CAPACITY;
      const name = kitName(k.id, t);
      // In English the scout's Swedish name shows beside it, for flavour; in Swedish the name already is it.
      const flavour = k.sv && k.sv.toLowerCase() !== name.toLowerCase() && name === k.name ? ` <i>${esc(k.sv)}</i>` : '';
      return `<button type="button" class="kchoice" data-kit="${k.id}" aria-pressed="${on}" ${fits ? '' : 'disabled'} title="${fits ? '' : esc(t('pack.wontFit'))}">`
        + `<span class="khead">${itemIcon(k.id)}<b>${esc(name)}</b>${flavour}<span class="kkg">${esc(t('pack.kg', { n: k.weight }))}</span></span>`
        // What a scout would say it's for, never the rule it plays (#1684): the player finds out
        // what's useful by playing. The rule shows only with the hidden truths (`?dev=truths`).
        + `<span class="kdoes">${esc(t(`kit.${k.id}.does`))}</span><span class="knote">${esc(t(`kit.${k.id}.note`))}</span>`
        + `${truths ? `<span class="devtruth" title="${esc(t('pack.ruleTip'))}">${esc(t('pack.rule', { rule: k.effect }))}</span>` : ''}</button>`;
    }).join('');
    const packedHere = KIT.filter(k => k.group === g && pack.includes(k.id)).length;
    return `<details class="kgroup" data-group="${g}"${sectionOpen(g, pack, open) ? ' open' : ''}>`
      + `<summary class="clabel" data-kitgroup="${g}">${esc(t(`kitgroup.${g}`).toUpperCase())} <span>${esc(t('pack.inGroup', { n: packedHere }))}</span></summary>`
      + `<div class="kchoices">${items}</div></details>`;
  }).join('');
  const fill = Math.min(100, (kg / PACK_CAPACITY) * 100);
  return `<form class="create pack" onsubmit="return false">
    <p class="mood" style="margin:0">${esc(t('pack.free', { kg: PACK_CAPACITY }))}</p>
    ${groups}
    <div class="kfoot">
      <div class="kbar" role="meter" aria-label="${esc(t('pack.weight'))}" aria-valuemin="0" aria-valuemax="${PACK_CAPACITY}" aria-valuenow="${kg}"><span style="width:${fill}%"></span></div>
      <span class="kweight"><b>${kg}</b> / ${esc(t('pack.kg', { n: PACK_CAPACITY }))}</span>
      <button type="button" class="pill" data-kitcmd="leader">${esc(t('pack.leader'))}</button>
      <button type="button" class="pill" data-kitcmd="empty">${esc(t('pack.empty'))}</button>
    </div>
  </form>`;
}

/** The creation form: your name (written, beside the standard portrait), two of four offered talents, age, stats. Choices live in the draft until Continue. */
export function createForm(draft: DraftView, t: T): string {
  const offer = talentOffer(seedOf(draft.id));
  const talents = offer.map(id => `<button class="tchoice" data-talent="${id}" aria-pressed="${draft.talents.includes(id)}"><b>${esc(t(`talent.${id}`))}</b><span class="up">+ ${esc(t(`talent.${id}.blurb`))}</span></button>`).join('');
  return `<form class="create" onsubmit="return false">
    <label class="clabel" for="wname">${esc(t('create.name'))}</label>
    <div class="cwho">${portraitEl(draft.portrait, 64)}<input id="wname" class="cname" maxlength="24" autocomplete="off" spellcheck="false" placeholder="${esc(t('create.placeholder'))}" value="${esc(draft.name)}"></div>
    <p class="clabel">${esc(t('create.talents', { n: TALENT_PICKS }))} <span>(${draft.talents.length}/${TALENT_PICKS})</span></p><div class="tchoices">${talents}</div>
    <p class="mood" style="margin:0">${esc(t('create.unknown'))}</p>
    <p class="clabel">${esc(t('create.age'))}</p>
    <div class="achoices">${START_AGES.map(a => `<button type="button" class="achoice" data-age="${a}" aria-pressed="${draft.age === a}">${a}</button>`).join('')}</div>
    <p class="mood" style="margin:0">${esc(t('create.grow'))}</p>
    ${statsForm(draft, t)}
  </form>`;
}

/**
 * The stats step (#1258): point-buy over the six stats. Every stat starts at 10
 * with 6 points to spend; steps above 13 cost 2. All 10s is a valid Warden, so
 * this never blocks BEGIN — unspent points just get a nudge.
 */
export function statsForm(draft: DraftView, t: T): string {
  const left = pointsLeft(draft.stats);
  const rows = STAT_IDS.map(id => {
    const v = draft.stats[id];
    const dear = v >= 13 && v < 15 ? ' dear' : '';
    const name = t(`stat.${id}`);
    // Growing up (#1399): what you have now, at the age chosen; the score is who you'll be at 18.
    const now = grownStats(draft.stats, draft.age)[id];
    return `<div class="srow"><div class="sname"><b>${esc(name)}</b><span>${esc(t(`stat.${id}.blurb`))}</span><span class="snote ${v > 10 ? 'up' : v < 10 ? 'cost' : ''}">${esc(statNoteText(id, v, t))}</span>${now !== v ? `<span class="snow">${esc(t('create.now', { n: now, age: draft.age }))}</span>` : ''}</div>`
      + `<div class="sstep"><button type="button" class="pill" data-stat="${id}" data-delta="-1" aria-label="${esc(t('create.lower', { stat: name }))}" ${canLower(draft.stats, id) ? '' : 'disabled'}>−</button>`
      + `<span class="sval">${v}</span>`
      + `<button type="button" class="pill${dear}" data-stat="${id}" data-delta="1" aria-label="${esc(t('create.raise', { stat: name, n: raiseCost(v) }))}" title="${esc(t(v >= 13 ? 'create.costs2' : 'create.costs1'))}" ${canRaise(draft.stats, id) ? '' : 'disabled'}>+</button></div></div>`;
  }).join('');
  return `<p class="clabel">${esc(t('create.stats', { n: POINT_BUDGET }))} <span>(${esc(t('create.left', { n: left }))}${left > 0 ? esc(t('create.wasted')) : ''})${esc(t('create.rules'))}</span></p>
    <div class="schoices">${rows}</div>`;
}
