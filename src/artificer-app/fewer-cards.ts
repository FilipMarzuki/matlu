/**
 * Fewer cards (#1925, ui feature `fewer-cards`; roadmap item 3 of the design review #1914, F2):
 * PLAN shows only the actions you can do now. In each group the rest fold into one line, "4 more
 * you can't do yet", which opens to each of them with its reason, and the guide's suggestion comes
 * first in its group, on a card as wide as the group.
 *
 * What can be done is still action-visibility's to say (#1690, `visibilityOf`): a card is folded
 * exactly when it has a reason, which is when it would have been drawn greyed (or, with that rules
 * switch off, dashed: tappable, but it would be skipped). Hidden actions stay hidden. Only where the
 * cards are drawn changes, so the play API, the console and AI players, which read
 * action-visibility themselves, see nothing new.
 *
 * Pure: the split takes each card's action and reason, and the fold takes words already in the
 * viewer's language, so a test can check both without a browser.
 */

import type { T } from '../artificer/i18n';
import type { ActionId } from '../artificer/region1';
import { esc } from './html';
import { fold } from './fold';

export const FEWER_CARDS_FEATURE = 'fewer-cards';

/** One card in a group, as the palette judged it: its action and why it can't be done now (null: it can). */
export interface CardSlot { id: ActionId; why: string | null }

/** A group's cards split: the ones drawn as cards, in order, and the ones folded, each with its reason. */
export interface CardSplit { shown: ActionId[]; folded: { id: ActionId; why: string }[] }

/**
 * Split a group's cards. The ones you can do now stay, in the group's own order, except that the
 * guide's suggestion, when it's one of them, goes first. Every card with a reason is folded, in
 * order. A suggestion that can't be done now is folded like any other: the guide only lifts a card
 * you can tap.
 */
export function splitCards(slots: readonly CardSlot[], suggest: ActionId | null = null): CardSplit {
  const can = slots.filter(c => c.why === null).map(c => c.id);
  const shown = suggest !== null && can.includes(suggest) ? [suggest, ...can.filter(id => id !== suggest)] : can;
  const folded = slots.flatMap(c => (c.why === null ? [] : [{ id: c.id, why: c.why }]));
  return { shown, folded };
}

/** The folded line's words: "4 more you can't do yet" ("1 more…" for one). */
export const cantYetLine = (n: number, t: T): string => t(n === 1 ? 'group.cantYet.one' : 'group.cantYet.other', { n });

/** One folded action as the list inside says it: its icon, its name and the reason, already in the viewer's words. */
export interface FoldedCard { icon: string; name: string; why: string }

/** The fold's id in fold.ts's record: one per group, so each group stays open or shut on its own. */
export const cantYetId = (group: string): string => `cantyet-${group}`;

/**
 * The one line under a group: shut, "4 more you can't do yet"; open, each action with why it can't
 * be done now (the same words the greyed card said). '' when nothing is folded.
 *
 * A plain `<details>` (fold.ts), so a tap, Enter or Space opens it and a screen reader announces it
 * as expandable, with no script of its own. The page redraws by replacing its HTML, which would shut
 * it again, so fold.ts remembers it per viewer (the page's `toggle` listener) and the next draw
 * writes it the same way. Shut at first.
 */
export function cantYetFold(group: string, items: readonly FoldedCard[], t: T): string {
  if (!items.length) return '';
  const list = `<ul class="cantlist">${items.map(i => `<li><span class="cn"><span aria-hidden="true">${esc(i.icon)}</span> ${esc(i.name)}</span> <span class="gate">${esc(i.why)}</span></li>`).join('')}</ul>`;
  return fold(cantYetId(group), `<span class="cantline">${esc(cantYetLine(items.length, t))}</span>`, list, false, 'cantyet');
}
