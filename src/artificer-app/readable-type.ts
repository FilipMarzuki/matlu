/**
 * Readable type (#1923, ui feature `readable-type`; roadmap item 1 of the design review #1914, F3).
 *
 * The game's small labels were set in Silkscreen, a pixel font, at 7–9 px and letter-spaced: every
 * action's name, the tabs, the status tags, the vital labels, the milestones. The line the eye
 * should land on was the hardest to read, on a tablet at arm's length and more so on a phone.
 * With the switch on, those labels are in the body font (Chakra Petch) at 14–16 px, nothing on the
 * page is under 12 px, and Silkscreen is kept only for headings of 16 px and up.
 *
 * How it works: the whole change is one stylesheet, readable-type.css, whose rules all start with
 * `:where(.readable-type)`. This file only puts that class on `<html>` (or takes it off), the way
 * looks.ts puts `data-look` there. `:where()` adds no specificity, so each override ties with the
 * style.css rule it replaces and wins only by coming later in the bundle: a more specific rule in
 * style.css (a bigger stepper button, say) still wins, as it did before.
 *
 * Fonts aren't per look: looks.ts holds colours, images and shadows only (a look never moves a box,
 * and type moves boxes), so `--display` and `--body` are style.css's alone and every one of the nine
 * looks gets this change.
 */

/** The ui feature (features.ts). */
export const READABLE_TYPE_FEATURE = 'readable-type';

/** The class on `<html>` that readable-type.css keys on. */
export const READABLE_TYPE_CLASS = 'readable-type';

/** Show the page's type as the switch says: the class on `<html>`, or not. */
export function applyReadableType(on: boolean, doc: Pick<Document, 'documentElement'> = document): void {
  doc.documentElement.classList.toggle(READABLE_TYPE_CLASS, on);
}
