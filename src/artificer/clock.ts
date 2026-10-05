/**
 * The clock and daylight (#1280, epic #1272).
 *
 * A Region 1 day has 14 waking hours from 06:00, so the clock is simply
 * 06:00 + hours spent. Daylight shrinks through autumn: sunrise slips 7.5
 * minutes later each day and sunset 15 minutes earlier, from 11½ hours of
 * light on day 1 to 7 by day 13, when winter arrives.
 *
 * Light is 1 in daylight, 0.5 in the hour of twilight before sunrise and after
 * sunset, and 0 in the dark. Times are in hours (18.5 = 18:30). This module
 * only models light; what darkness *does* comes in #1281.
 */

/** The waking day starts at 06:00. */
export const DAY_START = 6;
/** Twilight lasts this long, before sunrise and after sunset. */
export const TWILIGHT_HOURS = 1;

/** The clock time after `hoursToday` hours of the waking day. */
export const clockHour = (hoursToday: number): number => DAY_START + hoursToday;

/** Sunrise on a given day: 7:00 on day 1, 7.5 minutes later each day. */
export const sunrise = (day: number): number => 7 + (7.5 / 60) * (day - 1);
/** Sunset on a given day: 18:30 on day 1, 15 minutes earlier each day. */
export const sunset = (day: number): number => 18.5 - 0.25 * (day - 1);

/** Light at a moment: 1 by day, 0.5 in twilight, 0 in the dark. */
export function lightAt(day: number, hour: number): number {
  const up = sunrise(day), down = sunset(day);
  if (hour >= up && hour < down) return 1;
  if ((hour >= up - TWILIGHT_HOURS && hour < up) || (hour >= down && hour < down + TWILIGHT_HOURS)) return 0.5;
  return 0;
}

/**
 * The average light over a span starting at `start` and lasting `hours`.
 * Light is piecewise constant, so this integrates exactly between the
 * twilight and daylight boundaries rather than sampling.
 */
export function lightOver(day: number, start: number, hours: number): number {
  if (hours <= 0) return lightAt(day, start);
  const end = start + hours;
  const up = sunrise(day), down = sunset(day);
  const edges = [up - TWILIGHT_HOURS, up, down, down + TWILIGHT_HOURS].filter(t => t > start && t < end);
  const points = [start, ...edges, end];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += lightAt(day, points[i]) * (points[i + 1] - points[i]);
  return total / hours;
}
