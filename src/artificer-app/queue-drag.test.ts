/**
 * Tests for #1743 — dragging queued tasks to reorder them. The pointer handling itself is DOM
 * (exempt: ui-hud); these pin the pure rules it relies on: the array move, where a dragged row
 * lands for a pointer position, how a row's index follows a move, and the gap the other rows open.
 */

import { describe, it, expect } from 'vitest';
import { moveQueueItem, dropIndex, followMove, gapShift, DRAG_THRESHOLD, pastThreshold } from './queue-drag';

describe('moveQueueItem', () => {
  const q = ['a', 'b', 'c', 'd'];

  it('moves an item up, down, to the start and to the end, keeping every item', () => {
    expect(moveQueueItem(q, 2, 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveQueueItem(q, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveQueueItem(q, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveQueueItem(q, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    for (const [f, t] of [[0, 3], [1, 2], [3, 1]]) expect([...moveQueueItem(q, f, t)].sort()).toEqual([...q].sort());
  });

  it('is a no-op for the same place or out of range, and never mutates', () => {
    expect(moveQueueItem(q, 1, 1)).toEqual(q);
    expect(moveQueueItem(q, -1, 2)).toEqual(q);
    expect(moveQueueItem(q, 1, 4)).toEqual(q);
    expect(moveQueueItem(q, 7, 0)).toEqual(q);
    expect(moveQueueItem(q, 1.5, 0)).toEqual(q);
    moveQueueItem(q, 0, 3);
    expect(q).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('dropIndex', () => {
  // Four rows, 40px tall with a 5px gap: midpoints at 20, 65, 110, 155.
  const rects = [0, 45, 90, 135].map(top => ({ top, bottom: top + 40 }));

  it('stays put while the pointer is over its own row', () => {
    expect(dropIndex(70, rects, 1)).toBe(1);
    expect(dropIndex(50, rects, 1)).toBe(1);
  });

  it('lands above or below the rows whose middle the pointer has passed', () => {
    expect(dropIndex(10, rects, 2)).toBe(0); // above the first row's middle
    expect(dropIndex(30, rects, 2)).toBe(1); // past row 0's middle
    expect(dropIndex(120, rects, 0)).toBe(2); // past rows 1 and 2's middles
    expect(dropIndex(500, rects, 0)).toBe(3); // below everything: the end
    expect(dropIndex(-100, rects, 3)).toBe(0); // above everything: the start
  });

  it('handles a one-row queue and an empty list', () => {
    expect(dropIndex(999, [{ top: 0, bottom: 40 }], 0)).toBe(0);
    expect(dropIndex(10, [], 0)).toBe(0);
  });
});

describe('followMove', () => {
  it('a row index follows a move: the moved row goes with it, the rows between shift by one', () => {
    // a b c d → move 0 to 2 → b c a d
    expect([0, 1, 2, 3].map(i => followMove(i, 0, 2))).toEqual([2, 0, 1, 3]);
    // a b c d → move 3 to 1 → a d b c
    expect([0, 1, 2, 3].map(i => followMove(i, 3, 1))).toEqual([0, 2, 3, 1]);
    expect([0, 1, 2].map(i => followMove(i, 1, 1))).toEqual([0, 1, 2]);
  });
});

describe('gapShift', () => {
  it('opens a gap: the rows the dragged one passes move the other way by its height', () => {
    // dragging row 0 down to 2: rows 1 and 2 move up
    expect([0, 1, 2, 3].map(i => gapShift(i, 0, 2, 45))).toEqual([0, -45, -45, 0]);
    // dragging row 3 up to 1: rows 1 and 2 move down
    expect([0, 1, 2, 3].map(i => gapShift(i, 3, 1, 45))).toEqual([0, 45, 45, 0]);
    expect([0, 1, 2].map(i => gapShift(i, 1, 1, 45))).toEqual([0, 0, 0]);
  });
});

describe('the drag threshold', () => {
  it('a small wobble is still a tap; past the threshold it is a drag', () => {
    expect(pastThreshold(0, 0, 3, -2)).toBe(false);
    expect(pastThreshold(0, 0, 0, DRAG_THRESHOLD)).toBe(true);
    expect(pastThreshold(10, 10, 10 + DRAG_THRESHOLD, 10)).toBe(true);
  });
});
