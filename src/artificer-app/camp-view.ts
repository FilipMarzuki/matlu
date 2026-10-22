/**
 * The Camp tab and the camp's journal line (#1691): the tab stays hidden until the Warden has made
 * camp, and appears with "You have a camp now." in the journal.
 *
 * Presentation only. A camp exists once a site is chosen (`site` set by `chooseSite`, or by a queued
 * build that names a location: both go through region1's `moveCamp`, which logs "Chose the … as your
 * ground"). The journal line is added here, when the journal is drawn, after the first of those, so
 * the sim's log, its RNG stream, saves and the AI's transcripts don't change. A save loaded after the
 * camp was made shows the tab and the line, since both are read from the state.
 */

import type { LogEntry, Region1State } from '../artificer/region1';

/** Whether the Warden has made camp. */
export const hasCamp = (s: Pick<Region1State, 'site'>): boolean => s.site !== null;

/** The journal's line for the moment the camp tab appears. */
export const CAMP_LINE = 'You have a camp now.';

/** The sim's line when a site is first chosen (region1's `moveCamp`). */
const CHOSE_GROUND = /^Chose the .+ as your ground/;

/**
 * The log as the journal shows it: the sim's lines, with the camp line after the first "Chose the …
 * as your ground" (later moves of camp don't repeat it). Returns the same array when there's no camp.
 */
export function withCampLine(log: readonly LogEntry[]): readonly LogEntry[] {
  const i = log.findIndex(l => CHOSE_GROUND.test(l.text));
  if (i < 0) return log;
  return [...log.slice(0, i + 1), { day: log[i].day, text: CAMP_LINE, kind: 'milestone' }, ...log.slice(i + 1)];
}
