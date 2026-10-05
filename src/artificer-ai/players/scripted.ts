/**
 * A deterministic baseline player (#1226): the careful plan from the balance
 * tests, replied as JSON so it goes through exactly the same parsing as a
 * model. Useful as a benchmark ("does the model beat the script?") and for
 * testing the harness without an API key.
 */

import { winterReady } from '../../artificer/region1';
import { availableChoices } from '../../artificer/winter';
import type { Player } from '../runner';

type Entry = { action: string; ring: number; options: { key: string; value: string }[] };
const a = (action: string, ring = 1, options: Record<string, string> = {}): Entry =>
  ({ action, ring, options: Object.entries(options).map(([key, value]) => ({ key, value })) });

/** One queue per day, days 1–9: settle the cave, roof it, stock up, push out, find the pass. */
const PLAN: Entry[][] = [
  [a('scout'), a('wood'), a('build', 1, { site: 'cave' })],
  [a('survey'), a('track'), a('water')],
  [a('hunt'), a('hunt'), a('water')],
  [a('wood'), a('wood'), a('preserve')],
  [a('build'), a('hunt')],
  [a('hunt'), a('preserve'), a('preserve')],
  [a('wood'), a('coldGear'), a('hunt')],
  [a('scout', 2), a('hunt'), a('preserve')],
  [a('scout', 3), a('water'), a('rest')],
];

export const scriptedPlayer = (): Player => ({
  name: 'scripted',
  async decide(_message, s) {
    const exits = availableChoices(s.day, s.config.calendar);
    const exit = exits.length ? (winterReady(s) && exits.includes('caravan') ? 'caravan' : 'winter') : null;
    const queue = exit ? [] : (PLAN[s.day - 1] ?? [a('rest')]);
    return { text: JSON.stringify({ thoughts: exit ? `Leaving: ${exit}.` : `Day ${s.day} of the plan.`, site: null, exit, queue }) };
  },
});
