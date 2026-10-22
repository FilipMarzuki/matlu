/**
 * Acceptance tests for #1934 — auto-unblock: `blocked` comes off an issue once every issue its
 * body says it's blocked by is closed as completed. Pure functions only, no network.
 */

import { describe, it, expect } from 'vitest';
import { parseBlockers, decide, unblockComment, type BlockerState } from '../.github/scripts/unblock-issues.mjs';

const done: BlockerState = { state: 'closed', stateReason: 'completed' };
const open: BlockerState = { state: 'open', stateReason: null };
const notPlanned: BlockerState = { state: 'closed', stateReason: 'not_planned' };
const blocked = (body: string, number = 99) => ({ number, body, labels: [{ name: 'ready' }, { name: 'blocked' }] });

describe('acceptance (#1934)', () => {
  it('Given "Blocked by #10, #11", when both are closed as completed, then blocked is removed', () => {
    const d = decide(blocked('Blocked by #10, #11'), { 10: done, 11: done });
    expect(d.unblock).toBe(true);
    expect(d.blockers).toEqual([10, 11]);
    expect(unblockComment(d.blockers)).toBe('Unblocked: #10, #11 closed.');
  });

  it('Given one of them is still open, then the label stays', () => {
    const d = decide(blocked('Blocked by #10, #11'), { 10: done, 11: open });
    expect(d.unblock).toBe(false);
    expect(d.open).toEqual([11]);
  });

  it('Given a blocker closed as not planned, then the label stays and it is reported', () => {
    const d = decide(blocked('Blocked by #10, #11'), { 10: done, 11: notPlanned });
    expect(d.unblock).toBe(false);
    expect(d.notPlanned).toEqual([11]);
    expect(d.reason).toContain('#11');
  });

  it('Given no parseable reference, then the issue is untouched', () => {
    for (const body of ['Blocked until roadmap items 1–4 have merged.', 'Blocked on the `mapgen/` extraction.', '', 'See #10 and #11.']) {
      const d = decide(blocked(body), {});
      expect(d.unblock).toBe(false);
      expect(d.blockers).toEqual([]);
    }
  });
});

describe('parseBlockers: phrasings from the hex-world issues', () => {
  it.each([
    // #1908
    ['- **Depends on:** #1907 (`tileChunk`). **Blocked by #1907:** remove `blocked` once it merges.', [1907]],
    // #1901
    ['- **Depends on:** #1899 (the window, `landOfRun`), #1900 (`noteSeenCells`, the save fields), #1898 (`hexName`). **Blocked by #1900 and #1898:** remove `blocked` once both merge.', [1899, 1900, 1898]],
    // #1920
    ['Blocked by #1902 (and #1900). Remove `blocked` once they merge.', [1902, 1900]],
    // #1899
    ['- **Depends on:** #1896 and #1897 (`worldCell`, `hexCells`). **Blocked by #1897:** remove `blocked` once it merges.', [1896, 1897]],
    // #1910: the "(#1904 merges well before it)" after the colon is not a list item
    ['- **Depends on:** #1904 (outer provinces and their cultures), #1908 (world mode). **Blocked by #1908:** remove `blocked` once it merges (#1904 merges well before it).', [1904, 1908]],
  ])('%s', (body, want) => {
    expect(parseBlockers(body)).toEqual(want);
  });

  it('accepts Waits on / Waiting on / Depends on and several separators', () => {
    expect(parseBlockers('Waits on #1897 (and #1896)')).toEqual([1897, 1896]);
    expect(parseBlockers('Blocked by #1896 and #1897')).toEqual([1896, 1897]);
    expect(parseBlockers('waiting on #5, and #6 & #7 + #8')).toEqual([5, 6, 7, 8]);
    expect(parseBlockers('Depends on #3')).toEqual([3]);
  });

  it('only reads dependency lines: stray mentions, the text after the list and code blocks do not count', () => {
    const body = [
      'The words view (#1902), the journal (#1901) need a summary.',
      '**Blocked by #1896:** remove `blocked` once it merges. See also #1903.',
      '```', 'Blocked by #42', '```',
      'Already unblocked by nothing; other/repo#7 is elsewhere.',
    ].join('\n');
    expect(parseBlockers(body)).toEqual([1896]);
    expect(parseBlockers('Blocked by other/repo#7')).toEqual([]);
    expect(parseBlockers(null)).toEqual([]);
  });
});

describe('decide: edge cases', () => {
  it('treats a closed issue with no state_reason as completed', () => {
    expect(decide(blocked('Blocked by #10'), { 10: { state: 'closed', stateReason: null } }).unblock).toBe(true);
  });

  it('keeps the label when a blocker is a duplicate or could not be read', () => {
    expect(decide(blocked('Blocked by #10'), { 10: { state: 'closed', stateReason: 'duplicate' } }).notPlanned).toEqual([10]);
    const d = decide(blocked('Blocked by #10, #11'), { 10: done });
    expect(d.unblock).toBe(false);
    expect(d.unknown).toEqual([11]);
  });

  it('ignores an issue not labelled blocked and a reference to itself', () => {
    expect(decide({ number: 5, body: 'Blocked by #10', labels: ['ready'] }, { 10: done }).unblock).toBe(false);
    expect(decide(blocked('Blocked by #99, #10', 99), { 10: done })).toMatchObject({ unblock: true, blockers: [10] });
  });
});
