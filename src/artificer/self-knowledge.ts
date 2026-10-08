/**
 * What you learn about yourself (#1266): the journal lines that hint at a hidden talent, reveal
 * it (#1265), or reveal a quirk (#1362). The app styles them in a soft accent, so a player who
 * watches for them can notice — the words themselves never say "this is a hint".
 */

import { HINTS, TALENT_IDS, giftLine } from './talents';
import { QUIRKS } from './quirks';

const LINES = new Set<string>([
  ...Object.values(HINTS).flatMap(h => [h.vague, h.closer, h.reveal]),
  ...TALENT_IDS.map(giftLine),
  ...Object.values(QUIRKS).flatMap(q => (q.revealed ? [q.revealed] : [])),
]);

/** Is this journal line something you learned about yourself? */
export const isSelfKnowledge = (text: string): boolean => LINES.has(text);
