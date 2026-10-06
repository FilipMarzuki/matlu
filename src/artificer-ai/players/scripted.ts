/**
 * A deterministic baseline player (#1226): the careful plan from the balance
 * tests, replied as JSON so it goes through exactly the same parsing as a
 * model. Useful as a benchmark ("does the model beat the script?") and for
 * testing the harness without an API key.
 */

import { blockedReason, queueHours, queueId, winterOutlook, DAY_HOURS, type ActionId, type Region1State } from '../../artificer/region1';
import { scouted, type Ring } from '../../artificer/exploration';
import { blindInFog, stormBars, isBlizzard, iceThick } from '../../artificer/weather';
import { seasonOf } from '../../artificer/winter';
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

/**
 * After the plan, through the rest of autumn (#1302): keep hunting, smoking
 * and fetching, and keep the woodpile up for the cold nights to come.
 */
const ROUTINE: Entry[][] = [
  [a('hunt'), a('preserve'), a('water')],
  [a('wood'), a('hunt'), a('preserve')],
  [a('water'), a('wood'), a('rest')],
];

/**
 * The winter routine (#1309): keep the fire fed first, fish once the lake ice
 * holds (hunt until then), fetch water, and smoke what's spare. Short days, so
 * three near-camp jobs a day.
 */
const WINTER: Entry[][] = [
  [a('wood'), a('fish'), a('water')],
  [a('hunt'), a('preserve'), a('wood')],
  [a('wood'), a('water'), a('fish')],
];

/** A blizzard day stays in (#1315) — and spends it on a craft that helps, if there are materials for one. */
function blizzardDay(s: Region1State): Entry[] {
  const craft = (['snare', 'bedroll'] as const).find(id => blockedReason(s, id, 1) === null);
  return craft ? [a(craft), a('rest')] : [a('rest'), a('rest')];
}

/** The day's routine once the plan is done: autumn's, or winter's (fishing only once the ice is thick). */
function routineDay(s: Region1State): Entry[] {
  if (seasonOf(s.day, s.config.calendar) !== 'winter') return [...ROUTINE[s.day % ROUTINE.length]];
  return WINTER[s.day % WINTER.length].map(e => (e.action === 'fish' && !iceThick(s.day, s.config.calendar) ? a('hunt') : e));
}

/** Half rations when the food won't reach the thaw at a meal a night; full again once it will (#1305). */
const eatingFor = (s: Region1State): 'full' | 'half' => {
  const o = winterOutlook(s);
  return seasonOf(s.day, s.config.calendar) === 'winter' && o.foodDays < o.nightsToThaw ? 'half' : 'full';
};

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
      const today = remaining.shift() ?? routineDay(s);
      const eating = eatingFor(s);
      // A winter blizzard keeps everyone in (#1315): the day's plan waits, and the Warden rests by the fire.
      if (isBlizzard(s.weatherToday, s.day, s.config.calendar)) {
        remaining.unshift(today);
        return { text: JSON.stringify({ thoughts: 'A blizzard — staying in.', site: null, eating, queue: blizzardDay(s) }), usage: { cost: 0 } };
      }
      let queue = today.map(e => (spoiled(e, s) ? a('wood') : e));
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
      // Bad luck can cost the first roof (#1314): until there's a shelter, claim the cave and put one up first —
      // cutting the wood for it if the materials are short.
      let site: string | null = null;
      if (s.day > 1 && s.tier === 0 && scouted(s.explore, 1)) {
        if (!s.site) site = 'cave';
        if (!queue.some(e => e.action === 'build')) {
          // The roof takes the day; the plan waits a day rather than losing steps it depends on.
          const short = /needs (\d+) materials/.test(blockedReason(s.site ? s : { ...s, site: 'cave' }, 'build', 1) ?? '');
          // (Entries the weather spoiled were already moved to later days.)
          remaining.unshift(today.filter(e => !spoiled(e, s)));
          queue = [...(short ? [a('wood'), a('wood')] : []), a('build', 1, site ? { site } : {})];
        }
      }
      return { text: JSON.stringify({ thoughts: `Day ${s.day} of the plan.`, site, eating, queue }), usage: { cost: 0 } };
    },
  };
};
