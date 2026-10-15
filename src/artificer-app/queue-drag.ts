/**
 * Dragging queued tasks to reorder them (#1743): the pure rules the page's drag relies on.
 *
 * The page (main.ts) handles the pointer: one code path for mouse, touch and pen, through the
 * Pointer Events API. Everything it has to *decide* lives here, with no DOM, so a Node test can
 * check it: where a dragged row lands for a pointer position, how far the other rows slide to open
 * a gap, and how a row's index follows a move (so an open options menu stays with its task).
 */

/** How far (px) the pointer has to travel before a press on the grip becomes a drag. Below it, it's a tap. */
export const DRAG_THRESHOLD = 6;

/** The pointer has moved far enough from where it went down to count as a drag. */
export const pastThreshold = (x0: number, y0: number, x: number, y: number): boolean =>
  Math.hypot(x - x0, y - y0) >= DRAG_THRESHOLD;

const validIndex = (n: number, len: number): boolean => Number.isInteger(n) && n >= 0 && n < len;

/**
 * `list` with the item at `from` moved to `to` (its index afterwards). Every item is kept and only
 * the order changes; the same place, or an index out of range, gives the list back as it was.
 * Never mutates.
 */
export function moveQueueItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || !validIndex(from, list.length) || !validIndex(to, list.length)) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/** A row's vertical extent, as `getBoundingClientRect()` gives it. */
export interface RowRect { top: number; bottom: number }

/**
 * Where the row at `from` lands for a pointer at `y`, given every row's rect as laid out when the
 * drag began: past the middle of a row, and it goes on that row's far side. Counting the other rows
 * whose middle is above the pointer gives the index straight away, in the list after the move.
 */
export function dropIndex(y: number, rects: readonly RowRect[], from: number): number {
  let n = 0;
  rects.forEach((r, i) => { if (i !== from && (r.top + r.bottom) / 2 < y) n++; });
  return n;
}

/** Where row `i` is after the row at `from` moved to `to`: the moved one goes with it, those between shift by one. */
export function followMove(i: number, from: number, to: number): number {
  if (i === from) return to;
  if (from < to && i > from && i <= to) return i - 1;
  if (to < from && i >= to && i < from) return i + 1;
  return i;
}

/**
 * How far (px) row `i` slides while the row at `from` hovers over `to`, to open a gap where it will
 * land: the rows it passes move the other way by its height (`step`, the row plus the list's gap).
 */
export function gapShift(i: number, from: number, to: number, step: number): number {
  if (from < to && i > from && i <= to) return -step;
  if (to < from && i >= to && i < from) return step;
  return 0;
}
