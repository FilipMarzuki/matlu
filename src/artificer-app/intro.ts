/**
 * The arrival intro (#1228): pulled through a portal, a voice designates your
 * class and rank, then "Survive. Thrive. Master your new reality."
 *
 * Pure on purpose — it only decides *what* the intro says, from the sim state,
 * so it can be unit-tested; main.ts decides how it looks and when it plays.
 */

import type { Region1State } from '../artificer/region1';
import { artificerRank } from '../artificer/rank';
import { heirloomList } from '../artificer/legacy';

export { artificerRank, conceptRanks, RANKS } from '../artificer/rank';

/**
 * One screen of the intro.
 * - `narration`: the player's own senses (prose).
 * - `voice`: the strange voice — terse, system-like.
 * - `title`: the closing card.
 */
export interface Beat {
  /** `create`: the character-creation screen (name, portrait, talents, stats) — #1239, #1258, #1263. `pack`: packing for the hike (#1401). */
  kind: 'narration' | 'voice' | 'title' | 'create' | 'pack';
  lines: string[];
  /** Show the portal behind this beat. */
  portal?: boolean;
}

const CLOSING: Beat = { kind: 'title', lines: ['SURVIVE.', 'THRIVE.', 'MASTER YOUR NEW REALITY.'] };

/** The intro's beats for a Warden about to start `s`. */
export function introBeats(s: Region1State): Beat[] {
  const daysToSnow = s.config.calendar.winterDay - s.day;
  const rank = artificerRank(s).toUpperCase();
  // What the last Warden left (#1455): one run each, and the tools pass on.
  const left = s.tools.filter(t => t.heirloom);

  return [
    { kind: 'narration', portal: true, lines: ['A seam opens in the air.', 'Light folds inward — and you fall through it.'] },
    { kind: 'narration', lines: ['Cold stone under your hands.', 'Wind with no smell. A sky the colour of an old bruise.'] },
    { kind: 'voice', lines: ['⟨ ARRIVAL DETECTED ⟩', 'Scanning…', 'Crafting knowledge exceeds threshold.'] },
    { kind: 'voice', lines: ['CLASS DESIGNATED: ARTIFICER', `RANK: ${rank}`] },
    { kind: 'create', lines: ['IDENTIFY YOURSELF, ARTIFICER.'] },
    { kind: 'voice', lines: ['Registered: {name}.', 'Region: Greywind Reach.', `Winter arrives in ${daysToSnow} days.`, 'Survive it until the thaw.'] },
    ...(left.length ? [{ kind: 'voice' as const, lines: ['Someone was here before you.', `They left: ${heirloomList(left)}.`] }] : []),
    // Before any of this (#1401): the weekend hike, and what you packed for it.
    { kind: 'pack', lines: ['Friday afternoon, before any of this. Your patrol was heading out for a weekend hike in the forest — two nights, back on Sunday.', 'What did you pack?'] },
    CLOSING,
  ];
}

/** Put the Warden's name into a line ("{name}"); an unnamed Warden is just "Artificer". */
export const fillName = (line: string, name: string): string => line.replace(/\{name\}/g, name.trim() || 'Artificer');
