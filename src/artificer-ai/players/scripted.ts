/**
 * A deterministic baseline player (#1226): the careful plan from the balance
 * tests, replied as JSON so it goes through exactly the same parsing as a
 * model. Useful as a benchmark ("does the model beat the script?") and for
 * testing the harness without an API key.
 */

import { winterReady, blockedReason, queueHours, queueId, DAY_HOURS, type ActionId, type Region1State } from '../../artificer/region1';
import { scouted, type Ring } from '../../artificer/exploration';
import { blindInFog, stormBars } from '../../artificer/weather';
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

/** Would today's weather waste or bar this action? (Fog blinds scouting; a storm bars the far rings — #1284.) */
const spoiled = (e: Entry, s: Region1State): boolean => blindInFog(s.weatherToday, e.action as never) || stormBars(s.weatherToday, e.ring);

/** Hours a plan day takes, by the sim's own estimate. */
const dayHours = (day: Entry[], s: Region1State): number =>
  day.reduce((h, e) => h + queueHours(queueId(e.action as ActionId, e.ring as Ring), s), 0);

/**
 * Like a sensible person, the script works around the weather: an action the
 * weather would waste (a survey in fog, a far-ring trip in a storm) is put off
 * to the first later day with room for it in its waking hours — never piling
 * up a day that would push the Warden past empty — and its slot today goes to
 * near-camp wood, always useful and dependent on nothing. If no day has room,
 * it trades places with a later wood trip. Each run gets a
 * fresh player, so the plan is per run.
 */
export const scriptedPlayer = (): Player => {
  const remaining = PLAN.map(day => [...day]);
  return {
    name: 'scripted',
    async decide(_message, s) {
      const exits = availableChoices(s.day, s.config.calendar);
      const exit = exits.length ? (winterReady(s) && exits.includes('caravan') ? 'caravan' : 'winter') : null;
      let queue: Entry[] = [];
      if (!exit) {
        const today = remaining.shift() ?? [a('rest')];
        queue = today.map(e => (spoiled(e, s) ? a('wood') : e));
        // Short of materials for today's build (bad weather cost a trip)? Cut more wood first — a trip per missing unit, two at most.
        const short = /needs (\d+) materials \(have (\d+)\)/.exec(blockedReason(s, 'build', 1) ?? '');
        if (short && queue.some(e => e.action === 'build' && !e.options.length)) {
          queue = [...Array(Math.min(2, Number(short[1]) - Number(short[2]))).fill(a('wood')), ...queue];
        }
        if (!scouted(s.explore, 1) && today.some(e => e.action === 'scout' && spoiled(e, s))) {
          // Fog before the first scout: no camp can be staked, so the whole day waits while the Warden lays in wood and water.
          remaining.unshift(today);
          queue = [a('wood'), a('wood'), a('water')];
        } else {
          for (const e of today.filter(x => spoiled(x, s))) {
            const room = remaining.findIndex(day => dayHours([...day, e], s) <= DAY_HOURS);
            if (room >= 0) { remaining[room] = [e, ...remaining[room]]; continue; }
            // No day has room: swap it for a later wood trip, since today's slot already went to wood.
            const swap = remaining.findIndex(day => day.some(x => x.action === 'wood'));
            if (swap >= 0) remaining[swap] = [e, ...remaining[swap].filter((_x, i, d) => i !== d.findIndex(y => y.action === 'wood'))];
          }
        }
      }
      return { text: JSON.stringify({ thoughts: exit ? `Leaving: ${exit}.` : `Day ${s.day} of the plan.`, site: null, exit, queue }), usage: { cost: 0 } };
    },
  };
};
