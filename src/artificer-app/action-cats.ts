/**
 * The action categories (#2020): the palette's groups as one row of buttons over the cards, each
 * opening its group's cards. The owner: "the main action categories on one row. Then they expand
 * when picked. Explore, build, gather etc. … Would make it easier to overview."
 *
 * One group is open at a time. Tapping a category opens it and shuts the last one; tapping the open
 * one shuts it, leaving just the row. Which one is open is the viewer's own choice, kept in this
 * browser (`artificer.group`) for the Warden it was made for, like the distances a Warden's
 * choosers remember: a new Warden starts with Explore open, where the first morning's guide points.
 * An open distance chooser keeps its action's category open (LAND's Look around opens Explore's
 * chooser, so Explore).
 *
 * Every group's cards are still drawn, the shut ones `hidden`, so a category button always has a
 * panel to point at (`aria-controls`) and the page's other code finds the cards it looks for. Only
 * the open one shows.
 *
 * Presentation only: nothing here is in the save or the sim, and the play API, the console and AI
 * players, which list actions themselves, see nothing new. Pure apart from the storage, which is
 * wrapped (storage can be missing or refuse), so a test can check it without a browser.
 */

import type { T } from '../artificer/i18n';
import { esc } from './html';

/**
 * The palette's groups (camp-blocks.ts GROUPS), in the order the row shows them: the one list of
 * them. Build, Craft and Carry were one each until the owner (#2025): "build, carry and craft all is
 * the same core action". They're Make now.
 */
export const GROUP_KEYS = ['explore', 'provision', 'make', 'think'] as const;
export type GroupKey = typeof GROUP_KEYS[number];

/** What the viewer picked last: a group, or `null` for all shut. Never picked: undefined. */
export type GroupPick = GroupKey | null;

/** Each category's icon: the group's best-known action's icon (camp-blocks.ts ICON). */
export const CAT_ICON: Readonly<Record<GroupKey, string>> = {
  explore: '🧭', provision: '🌿', make: '🔨', think: '📖',
};

export const isGroupKey = (k: unknown): k is GroupKey => typeof k === 'string' && (GROUP_KEYS as readonly string[]).includes(k);

/**
 * Which group is open: the one an open chooser is in; else the viewer's pick, if that group is
 * there now (all shut, if they shut it); else the first group there. `known`: the groups the
 * palette shows, in order (a group the Warden can do nothing in yet isn't shown, #1690).
 */
export function openGroup(known: readonly GroupKey[], pick: GroupPick | undefined, chooser: GroupKey | null = null): GroupKey | null {
  if (chooser && known.includes(chooser)) return chooser;
  if (pick === null) return null;
  if (pick && known.includes(pick)) return pick;
  return known[0] ?? null;
}

/** The pick after tapping `key`: that group, or all shut if it was the open one (`wasOpen`). */
export const tapGroup = (key: GroupKey, wasOpen: boolean): GroupPick => (wasOpen ? null : key);

/** One category as the row draws it: its group, how many of its actions you can do now, and whether the guide's suggestion is in it. */
export interface Cat { key: GroupKey; can: number; suggested: boolean }

/** The panel's id, for the button's `aria-controls`. */
export const panelId = (key: GroupKey): string => `grp-${key}`;
export const catId = (key: GroupKey): string => `cat-${key}`;

/**
 * The row: one button per category, as wide as each other, with its icon, its short name and how
 * many of its actions you can do now. The open one is pressed (`aria-expanded`). A shut one holding
 * the guide's suggestion glows like the suggested card does, so the guide still points the way.
 * None you can do now: drawn dim, still tappable, to see why (the fold under the cards).
 */
export function catsRow(cats: readonly Cat[], open: GroupKey | null, t: T): string {
  if (!cats.length) return '';
  const btns = cats.map(c => {
    const on = c.key === open;
    const cls = ['cat', on ? 'on' : '', c.can === 0 ? 'none' : '', c.suggested && !on ? 'guide-suggest' : ''].filter(Boolean).join(' ');
    const name = t(`cat.${c.key}`);
    // Said with the name it shows ("Gather: 4 you can do now"), so a voice user can say what they
    // see (WCAG 2.5.3); the hover shows the group's whole name ("Provision: 4 you can do now").
    const label = t('cat.label', { name, n: c.can });
    const tip = t('cat.label', { name: t(`group.${c.key}`), n: c.can });
    return `<button type="button" class="${cls}" id="${catId(c.key)}" data-group="${c.key}" aria-expanded="${on}" aria-controls="${panelId(c.key)}" aria-label="${esc(label)}" title="${esc(tip)}">`
      + `<span class="caticon" aria-hidden="true">${CAT_ICON[c.key]}</span><span class="catname">${esc(name)}</span><b class="catnum" aria-hidden="true">${c.can}</b></button>`;
  }).join('');
  return `<div class="cats" style="--cats:${cats.length}">${btns}</div>`;
}

// ── The viewer's pick, in this browser ─────────────────────────────────────

export const GROUP_KEY = 'artificer.group';
export type GroupStore = Pick<Storage, 'getItem' | 'setItem'>;
const storage = (): GroupStore | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** The groups Make took in (#2025): a pick of one of them, kept from before, opens Make. */
const INTO_MAKE: readonly string[] = ['build', 'craft', 'carry'];

/**
 * The pick kept in this browser for this Warden (`{ id, pick }`; pick null: all shut). Another
 * Warden's pick, junk or no storage: never picked.
 */
export function loadGroupPick(characterId: string, store: GroupStore | null = storage()): GroupPick | undefined {
  try {
    const raw = JSON.parse(store?.getItem(GROUP_KEY) ?? 'null') as { id?: unknown; pick?: unknown } | null;
    if (!raw || raw.id !== characterId) return undefined;
    if (raw.pick === null) return null;
    if (typeof raw.pick === 'string' && INTO_MAKE.includes(raw.pick)) return 'make';
    return isGroupKey(raw.pick) ? raw.pick : undefined;
  } catch { return undefined; }
}

export function saveGroupPick(characterId: string, pick: GroupPick, store: GroupStore | null = storage()): void {
  try { store?.setItem(GROUP_KEY, JSON.stringify({ id: characterId, pick })); } catch { /* kept for this visit only */ }
}
