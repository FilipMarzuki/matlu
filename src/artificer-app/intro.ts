/**
 * The arrival intro (#1228): packing for a weekend hike (#1666), then pulled
 * through a portal, a voice designates your class and rank, then
 * "Survive. Thrive. Master your new reality."
 *
 * Pure on purpose — it only decides *what* the intro says, from the sim state,
 * so it can be unit-tested; main.ts decides how it looks and when it plays.
 *
 * The words come from the string catalog (#1707) in the viewer's language: `t` is the page's
 * translate function, English by default (the tests, and anything else that asks).
 */

import { CRAFT_WORLD, type Region1State } from '../artificer/region1';
import { artificerRank } from '../artificer/rank';
import { makeT, type T } from '../artificer/i18n';
import { gradeWord, rankName, recipeName } from './sim-words';

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

const EN = makeT('en');

/** The intro's beats for a Warden about to start `s`, in the language `t` speaks. */
export function introBeats(s: Region1State, t: T = EN): Beat[] {
  const daysToSnow = s.config.calendar.winterDay - s.day;
  const rank = rankName(artificerRank(s, CRAFT_WORLD.concepts), t).toUpperCase();
  // What the last Warden left (#1455): one run each, and the tools pass on.
  const left = s.tools.filter(x => x.heirloom).map(x => t('intro.heirloom', { grade: gradeWord(x.grade, t), item: recipeName(x.item, t).toLowerCase() })).join(', ');

  return [
    // First the weekend (#1666): the hike, and packing for it — then the portal.
    { kind: 'narration', lines: [t('intro.hike1'), t('intro.hike2'), t('intro.hike3')] },
    { kind: 'pack', lines: [t('intro.pack')] },
    { kind: 'narration', portal: true, lines: [t('intro.seam1'), t('intro.seam2')] },
    { kind: 'narration', lines: [t('intro.stone1'), t('intro.stone2')] },
    { kind: 'voice', lines: [t('intro.arrival'), t('intro.scanning'), t('intro.threshold')] },
    { kind: 'voice', lines: [t('intro.class'), t('intro.rank', { rank })] },
    { kind: 'create', lines: [t('intro.identify')] },
    // `{name}` stays in the line: fillName fills it once the Warden has one.
    { kind: 'voice', lines: [t('intro.registered'), t('intro.region'), t('intro.winter', { n: daysToSnow }), t('intro.survive')] },
    ...(left ? [{ kind: 'voice' as const, lines: [t('intro.before'), t('intro.left', { list: left })] }] : []),
    { kind: 'title', lines: [t('intro.close1'), t('intro.close2'), t('intro.close3')] },
  ];
}

/** Put the Warden's name into a line ("{name}"); an unnamed Warden is just "Artificer". */
export const fillName = (line: string, name: string, t: T = EN): string => line.replace(/\{name\}/g, name.trim() || t('intro.noName'));
