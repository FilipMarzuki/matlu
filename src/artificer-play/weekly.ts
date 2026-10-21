/**
 * The weekly world (#1559): one seed a week that everyone plays, people and AIs, so the week's
 * records compare runs on the same weather, the same encounters, the same talents on offer.
 *
 * A week is an ISO 8601 week in UTC ("2026-W41": Monday 00:00 to the next Monday 00:00). ISO weeks
 * because they're a standard every language can compute, never split a week across a year end in a
 * confusing way (the week of 1 January belongs to the year that holds its Thursday), and sort as
 * text. UTC because players are everywhere: the world turns over at the same moment for all.
 *
 * The week's seed is `wk-<week>-<tag>`, and its game (and Warden) id is `play-<seed>`, the same id a
 * session game gets from a seed (session.ts startGame). The tag comes from a server secret (api.ts
 * weeklySeed), so next week's world can't be worked out and practised ahead. The week is written
 * into the seed so a game's week can be read back from its id alone: no database column needed.
 *
 * Pure, no clock: callers pass the time, so tests pin it.
 */

const DAY_MS = 86_400_000;
const WEEK = /^(\d{4})-W(\d{2})$/;
/** A weekly game id: play-wk-<week>-<8 hex>. */
const WEEKLY_ID = /^play-wk-(\d{4}-W\d{2})-[0-9a-f]{8}$/;

/** The ISO week a moment falls in, in UTC: "2026-W41". */
export function isoWeek(ms: number): string {
  const d = new Date(ms);
  // The Thursday of this week decides the year (ISO 8601): move to it, then count weeks from 1 January.
  const day = d.getUTCDay() || 7; // Monday 1 … Sunday 7
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - day);
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export const isWeekId = (w: unknown): w is string => typeof w === 'string' && WEEK.test(w) && weekStart(w) !== null;

/** When a week starts (Monday 00:00 UTC, in ms), or null for something that isn't a week. */
export function weekStart(week: string): number | null {
  const m = WEEK.exec(week);
  if (!m) return null;
  const year = Number(m[1]), n = Number(m[2]);
  // 4 January is always in week 1; week 1 starts on the Monday on or before it.
  const jan4 = Date.UTC(year, 0, 4);
  const start = jan4 - ((new Date(jan4).getUTCDay() || 7) - 1) * DAY_MS + (n - 1) * 7 * DAY_MS;
  // Week 53 exists only in some years: a week that isn't really in this year isn't a week.
  return n >= 1 && isoWeek(start) === week ? start : null;
}

/** When a week ends: the next Monday 00:00 UTC (ms). */
export const weekEnd = (week: string): number | null => {
  const s = weekStart(week);
  return s === null ? null : s + 7 * DAY_MS;
};

/** The week before this one. */
export const previousWeek = (week: string): string | null => {
  const s = weekStart(week);
  return s === null ? null : isoWeek(s - DAY_MS);
};

/** The seed of a week's world, given its tag (api.ts weeklySeed makes the tag). */
export const weeklySeedOf = (week: string, tag: string): string => `wk-${week}-${tag}`;

/** The game (and Warden) id a seed gives, as session.ts startGame makes it. */
export const gameIdOf = (seed: string): string => `play-${seed}`;

/**
 * The week a game was played on, read from its id (or its Warden's, which is the same), or null
 * for any other game. Only the shape is read: the server checks a web run's id really is that
 * week's world (api.ts) before it believes it.
 */
export function weekOfId(id: string | null | undefined): string | null {
  const m = id ? WEEKLY_ID.exec(id) : null;
  return m && isWeekId(m[1]) ? m[1] : null;
}

/** "W41": a week, short, for a chip in a header. */
export const shortWeek = (week: string): string => week.slice(5);
