/**
 * The clock and daylight (#1280, epic #1272).
 *
 * A Region 1 day has 14 waking hours from 06:00, so the clock is simply
 * 06:00 + hours spent. Daylight follows the year (#1301): 11½ hours on day 1,
 * about 8 by the end of autumn, a low of 6 at midwinter, and 7½ again by the
 * end of winter. Of the light lost, a third comes off the morning and two
 * thirds off the evening, as it always did (sunrise 7:00, sunset 18:30 on day 1).
 *
 * Light is 1 in daylight, 0.5 in the hour of twilight before sunrise and after
 * sunset, and 0 in the dark. Times are in hours (18.5 = 18:30). This module
 * only models light; what darkness *does* comes in #1281.
 */

import { DEFAULT_CALENDAR, seasonCurve, type Calendar } from './winter';

/** The waking day starts at 06:00. */
export const DAY_START = 6;
/** Twilight lasts this long, before sunrise and after sunset. */
export const TWILIGHT_HOURS = 1;

/** The clock time after `hoursToday` hours of the waking day. */
export const clockHour = (hoursToday: number): number => DAY_START + hoursToday;

/** Hours of daylight on day 1, the last day of autumn, midwinter and the last day of winter. */
export const DAYLIGHT: readonly [number, number, number, number] = [11.5, 8, 6, 7.5];

/** Hours between sunrise and sunset on a day. */
export const daylightHours = (day: number, cal: Calendar = DEFAULT_CALENDAR): number => seasonCurve(day, cal, DAYLIGHT);

/** Daylight lost since day 1. */
const lost = (day: number, cal: Calendar): number => DAYLIGHT[0] - daylightHours(day, cal);

/** Sunrise: 7:00 on day 1, later by a third of the daylight lost since. */
export const sunrise = (day: number, cal: Calendar = DEFAULT_CALENDAR): number => 7 + lost(day, cal) / 3;
/** Sunset: 18:30 on day 1, earlier by two thirds of the daylight lost since. */
export const sunset = (day: number, cal: Calendar = DEFAULT_CALENDAR): number => 18.5 - (2 * lost(day, cal)) / 3;

/** Light at a moment: 1 by day, 0.5 in twilight, 0 in the dark. */
export function lightAt(day: number, hour: number, cal: Calendar = DEFAULT_CALENDAR): number {
  const up = sunrise(day, cal), down = sunset(day, cal);
  if (hour >= up && hour < down) return 1;
  if ((hour >= up - TWILIGHT_HOURS && hour < up) || (hour >= down && hour < down + TWILIGHT_HOURS)) return 0.5;
  return 0;
}

/**
 * The average light over a span starting at `start` and lasting `hours`.
 * Light is piecewise constant, so this integrates exactly between the
 * twilight and daylight boundaries rather than sampling.
 */
export function lightOver(day: number, start: number, hours: number, cal: Calendar = DEFAULT_CALENDAR): number {
  if (hours <= 0) return lightAt(day, start, cal);
  const end = start + hours;
  const up = sunrise(day, cal), down = sunset(day, cal);
  const edges = [up - TWILIGHT_HOURS, up, down, down + TWILIGHT_HOURS].filter(t => t > start && t < end);
  const points = [start, ...edges, end];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += lightAt(day, points[i], cal) * (points[i + 1] - points[i]);
  return total / hours;
}
