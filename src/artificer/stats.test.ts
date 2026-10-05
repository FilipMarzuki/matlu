/** Creation helpers for the stats step (#1258): what the point-buy screen may allow, and what it says. */

import { describe, it, expect } from 'vitest';
import { DEFAULT_STATS, canRaise, canLower, raiseCost, statNote, pointsLeft, type Stats } from './stats';

const spread = (s: Partial<Stats>): Stats => ({ ...DEFAULT_STATS, ...s });

describe('Stats creation helpers (#1258)', () => {
  it('allows only legal steps', () => {
    expect(canRaise(DEFAULT_STATS, 'str')).toBe(true);
    expect(canLower(DEFAULT_STATS, 'str')).toBe(true);
    expect(canLower(spread({ str: 7 }), 'str')).toBe(false);
    expect(canRaise(spread({ str: 15, cha: 7 }), 'str')).toBe(false); // creation max
    // 1 point left: 13 → 14 costs 2, so no; another stat 10 → 11 costs 1, so yes.
    const s = spread({ str: 13, int: 12 });
    expect(pointsLeft(s)).toBe(1);
    expect(raiseCost(13)).toBe(2);
    expect(canRaise(s, 'str')).toBe(false);
    expect(canRaise(s, 'con')).toBe(true);
    // Lowering a stat buys the step back.
    expect(canRaise(spread({ str: 13, int: 12, cha: 9 }), 'str')).toBe(true);
  });

  it('says what a score does', () => {
    expect(statNote('str', 10)).toBe('average');
    expect(statNote('str', 13)).toBe('heavy work −9% Vigor');
    expect(statNote('str', 8)).toBe('heavy work +6% Vigor');
    expect(statNote('int', 13)).toBe('study +15% insight · craft grade +1');
    expect(statNote('int', 11)).toBe('study +5% insight');
    expect(statNote('wil', 15)).toBe('mind strain −10% · focus holds to 20 Clarity');
    expect(statNote('cha', 7)).toBe('trust −3 · prices +6% (on the road)');
  });
});
