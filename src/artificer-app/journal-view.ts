/**
 * The journal (#1709, phase 3 of #1685): the LATEST list, the full JOURNAL tab, the road's journal
 * and the timer's lines, in the viewer's language.
 *
 * The log keeps the sim's English (the save, the AI observation and the API read it, and their tests
 * pin it). Each line is read back when it's drawn (sim-words.ts `simLine`): looked up whole, or
 * through its template, and said in the viewer's language. A line nothing reads shows as it came.
 * Pure: no DOM, so the test can draw it.
 */

import type { LogEntry } from '../artificer/region1';
import type { T } from '../artificer/i18n';
import { isSelfKnowledge } from '../artificer/self-knowledge';
import { esc } from './html';
import { simLine } from './sim-words';

/** A journal line's colour: hardship, a win, a skip — and, softly, what you learn about yourself (#1266). Read off the sim's English. */
export const logClass = (l: Pick<LogEntry, 'kind' | 'text'>): string =>
  isSelfKnowledge(l.text) ? 'hint' : l.kind === 'hardship' ? 'bad' : l.kind === 'milestone' || l.kind === 'outcome' ? 'good' : l.kind === 'skip' ? 'skip' : '';

/** One line, as the viewer reads it. */
export const logText = (l: Pick<LogEntry, 'text'>, t: T): string => simLine(l.text, t);

/**
 * The newest `limit` lines, newest first, each with its day (`D12` at camp, `R3` on the road).
 * Empty when there are none (the caller says what an empty journal says).
 */
export function journalItems(log: readonly LogEntry[], limit: number, dayMark: string, t: T, extra: (l: LogEntry) => string = () => ''): string {
  // `extra` adds HTML after a line (the camp journal's "See the land →" on a land trip, #1730).
  return [...log].reverse().slice(0, limit).map(l => `<li class="${logClass(l)}"><span class="d">${dayMark}${l.day}</span>${esc(logText(l, t))}${extra(l)}</li>`).join('');
}
