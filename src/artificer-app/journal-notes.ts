/**
 * How to play, in the journal (#1838): the Warden's own notes ("My notes" / "Mina anteckningar")
 * at the front of the journal, opened from a small 📖 on the journal box's heading. They say what
 * the old ? panel said, in the journal's first-person voice. The header has no ? at all.
 *
 * A ui feature (`journal-notes`), on top of the ⚙ Menu (whose How to play section becomes a link
 * to these notes): off, the journal heading and the Menu are drawn exactly as before. Pure: no DOM,
 * so a unit test can draw it.
 */

import type { Key, T } from '../artificer/i18n';
import { esc } from './html';

export const NOTES_FEATURE = 'journal-notes';

/** The notes, in the order they're read: the situation, the day, the evening, the land, the winter, the save. */
export const NOTE_KEYS = ['notes.arrive', 'notes.queue', 'notes.evening', 'notes.land', 'notes.winter', 'notes.save'] as const satisfies readonly Key[];

/**
 * The 📖 beside the journal's heading: opens and shuts the notes. A button (not a link) because it
 * changes the page in place; `aria-expanded` says whether they show.
 */
export function notesButton(open: boolean, t: T): string {
  return `<button class="noteslink${open ? ' on' : ''}" data-cmd="notes" aria-expanded="${open}" aria-controls="notes" aria-label="${esc(t('notes.open'))}" title="${esc(t('notes.open'))}">📖</button>`;
}

/** The notes themselves, with their way back to the journal. `winterDay` is the day the snow comes. */
export function notesPage(winterDay: number, t: T): string {
  const items = NOTE_KEYS.map(k => `<li>${esc(t(k, { winterDay }))}</li>`).join('');
  return `<div class="notes" id="notes" role="region" aria-labelledby="notes-title">`
    + `<p class="eyebrow notestitle" id="notes-title" tabindex="-1">${esc(t('notes.title'))}</p>`
    + `<ul class="notelist">${items}</ul>`
    + `<button class="pill" data-cmd="notes">${esc(t('notes.close'))}</button></div>`;
}

/**
 * A journal box's heading (LATEST on PLAN, JOURNAL on PROGRESS, the road's journal), and with the
 * notes on, its 📖 and, while open, the notes under it ("at the front of the journal"). Off, the
 * heading is the very string it was before (`style` included), so nothing changes.
 */
export function journalHead(label: string, style: string, o: { on: boolean; open: boolean; winterDay: number }, t: T): string {
  const st = style ? ` style="${style}"` : '';
  if (!o.on) return `<p class="eyebrow"${st}>${esc(label)}</p>`;
  return `<p class="eyebrow jhead"${st}>${esc(label)} ${notesButton(o.open, t)}</p>${o.open ? notesPage(o.winterDay, t) : ''}`;
}

/**
 * The Menu's How to play section. With the notes on it's a link into the journal (one copy of the
 * text, in one place); without them, the two-row header's copy of the old ? panel's text (`lede`),
 * or nothing.
 */
export function howtoBody(o: { notes: boolean; lede: string }, t: T): string {
  if (!o.notes) return o.lede;
  return `<p class="mood">${esc(t('notes.menyNote'))}</p><div class="menyrow"><button class="pill" data-cmd="notesopen">${esc(t('notes.menyLink'))}</button></div>`;
}

/** Whether the notes show: as the player last set them, else open while the journal is still empty (a first morning). */
export const notesShown = (chosen: boolean | null, journalEmpty: boolean): boolean => chosen ?? journalEmpty;
