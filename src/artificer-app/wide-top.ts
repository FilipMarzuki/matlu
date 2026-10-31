/**
 * Fewer rows over the plan on a wide screen (#1998, ui switch `wide-top`).
 *
 * The UI re-measure (#1997, docs/design/artificer-vs-runescape-walkscape.md §1.7) found that on a
 * 1024 × 700 tablet the first action card still started at y = 407: five full-width rows stacked
 * over it (the title, the status line, the "where you stand" line, the tabs and the weather row),
 * and the title and the status line both said "DAY 14". The status line and the tab row each had
 * room to spare. With the switch on, on a screen wide enough that the tabs stay at the top:
 *
 * - the "where you stand" line sits in the status line, in its spare room, instead of in a row of
 *   its own under it (and its focus picker opens under it there);
 * - on PLAN, the weather row's button sits in the tab row; what it opens still opens under the
 *   tabs, and so does a blizzard's warning;
 * - the day is said once, in the status line, which stays on screen as the page scrolls.
 *
 * Narrower, where the tabs are the phone's bottom bar (#1924), nothing changes. The page is drawn in
 * one arrangement or the other, so main.ts draws it again when the width crosses the line, as it does
 * for the journal beside the queue (#1931). Presentation only: no run saves the switch, and the play
 * API, the console and AI players never see it.
 */

/** The ui switch (features.ts). Off, the top of the page is as #1924 and #1951 left it. */
export const WIDE_TOP_FEATURE = 'wide-top';

/**
 * Wide enough: wider than 900px, where the compact status line's tabs stay at the top (style.css
 * puts them in the bottom bar at `max-width: 900px`).
 */
export const WIDE_TOP_QUERY = '(min-width: 901px)';
