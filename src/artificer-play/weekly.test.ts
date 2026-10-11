/**
 * The weekly world (#1559): ISO weeks in UTC, and a week read back from a game's id.
 */

import { describe, it, expect } from 'vitest';
import { isoWeek, isWeekId, weekStart, weekEnd, previousWeek, weekOfId, weeklySeedOf, gameIdOf, shortWeek } from './weekly';

const at = (iso: string): number => Date.parse(iso);

describe('The weekly world (#1559)', () => {
  it('names a moment by its ISO week in UTC, Monday to Sunday', () => {
    expect(isoWeek(at('2026-10-05T00:00:00Z'))).toBe('2026-W41'); // Monday
    expect(isoWeek(at('2026-10-11T23:59:59Z'))).toBe('2026-W41'); // Sunday
    expect(isoWeek(at('2026-10-12T00:00:00Z'))).toBe('2026-W42');
    // The week of 1 January belongs to the year that holds its Thursday.
    expect(isoWeek(at('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(at('2025-12-29T12:00:00Z'))).toBe('2026-W01');
  });

  it('knows when a week starts and ends, and which weeks exist', () => {
    expect(new Date(weekStart('2026-W41')!).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(new Date(weekEnd('2026-W41')!).toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(previousWeek('2026-W01')).toBe('2025-W52');
    expect(isWeekId('2026-W53')).toBe(true);
    expect(isWeekId('2025-W53')).toBe(false); // 2025 has 52 weeks
    expect(isWeekId('2026-W00')).toBe(false);
    expect(isWeekId('2026-41')).toBe(false);
    expect(isWeekId(41)).toBe(false);
  });

  it('reads the week back from a weekly game id, and from nothing else', () => {
    const id = gameIdOf(weeklySeedOf('2026-W41', '0a1b2c3d'));
    expect(id).toBe('play-wk-2026-W41-0a1b2c3d');
    expect(weekOfId(id)).toBe('2026-W41');
    expect(weekOfId('play-s1')).toBeNull();
    expect(weekOfId('w-abc-123')).toBeNull();
    expect(weekOfId('play-wk-2026-W99-0a1b2c3d')).toBeNull();
    expect(weekOfId(null)).toBeNull();
    expect(shortWeek('2026-W41')).toBe('W41');
  });
});
