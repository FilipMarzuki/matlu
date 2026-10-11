/**
 * A deterministic baseline player (#1226): the careful plan from the balance
 * tests, replied as JSON so it goes through exactly the same parsing as a
 * model. Useful as a benchmark ("does the model beat the script?") and for
 * testing the harness without an API key.
 */

import { SUGGESTED_PACK } from '../../artificer/kit';
import { blockedReason, queueHours, queueId, winterOutlook, DAY_HOURS, type ActionId, type Region1State } from '../../artificer/region1';
import { scouted, type Ring } from '../../artificer/exploration';
import { blindInFog, stormBars, isBlizzard, iceThick } from '../../artificer/weather';
import { seasonOf } from '../../artificer/winter';
import type { Player } from '../runner';
import { daysLeftOnLeg, peopleHere, lessonFee, questsHere, tradeTerms, villageOf, ROAD_DAYS, ROUTE, type RoadActionId, type RoadState } from '../../artificer/road';
import { canComplete, QUESTS } from '../../artificer/quests';
import { peopleOf } from '../../artificer/villages';
import { buyPrice } from '../../artificer/trade';
import { canBeTaught, techniqueById } from '../../artificer/techniques';
import { skillLevel } from '../../artificer/skills';
import { encounterById, safestOption } from '../../artificer/encounters';
import { meetingOptions, safestMeetingOption } from '../../artificer/caravan-meeting';

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
export const scriptedPlayer = (): Player => stepwise(scriptedPlanner());

/**
 * Learned planning (#1350): the planner still plans a whole day, but until the Warden can
 * plan ahead it hands that day out one action per call, and the rest (if planning opens
 * mid-day) in one go. An empty queue ends the day.
 */
function stepwise(planner: Player): Player {
  let today: { day: number; plan: { thoughts: string; site: string | null; eating?: string; queue: unknown[] } } | null = null;
  return {
    ...planner,
    async decide(message, s) {
      if (today?.day !== s.day) {
        const r = await planner.decide(message, s);
        today = { day: s.day, plan: JSON.parse(r.text) };
      }
      const p = today.plan;
      const queue = s.canPlan ? p.queue.splice(0) : p.queue.splice(0, 1);
      // The site is claimed once, with the day's first reply.
      const site = p.site; p.site = null;
      return { text: JSON.stringify({ ...p, site, queue }), usage: { cost: 0 } };
    },
  };
}

const scriptedPlanner = (): Player => {
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
    async decideRoad(_message, r) {
      return { text: JSON.stringify({ thoughts: `Road day ${r.day}.`, actions: scriptedRoadDay(r) }), usage: { cost: 0 } };
    },
    // The caravan meeting (#1357): say hello, then pay in goods if it can — hides, then rations —
    // and otherwise work the passage (the road days help on the wagon, which pays it back).
    async decideMeeting(_message, reach, m) {
      const open = meetingOptions(reach, m).filter(o => !o.unmet).map(o => o.option.id);
      const choice = ['hail', 'hides', 'rations', 'work'].find(id => open.includes(id)) ?? safestMeetingOption(reach, m).id;
      return { text: JSON.stringify({ thoughts: 'Pay my way, or work it.', choice }), usage: { cost: 0 } };
    },
    // Packing (#1401): the leader's list, as every scout should.
    async decidePack() {
      return { text: JSON.stringify({ thoughts: "The leader's packing list.", pack: SUGGESTED_PACK }), usage: { cost: 0 } };
    },
    // An encounter (#1348): the best odds, ties going to the cheapest — never a gamble it can avoid.
    async decideEncounter(_message, s) {
      const t = s.pending ? encounterById(s.pending.id) : undefined;
      return { text: JSON.stringify({ thoughts: 'The safest way through.', choice: t ? safestOption(s, t).id : '' }), usage: { cost: 0 } };
    },
  };
};

// ── The road (#1251) ────────────────────────────────────────────────────────

/** Quick hand-overs first, then the long jobs: a repair or a scout eats most of a day. */
const QUEST_ORDER: Readonly<Record<string, number>> = { fetch: 0, craft: 0, repair: 1, scout: 2, deliver: 3 };

/**
 * A sensible road day (#1251), as a careful person would play it: on the wagon, rest; in a
 * village, take every quest on offer and finish what you can, keep enough food and water
 * for the road ahead, buy one lesson you can afford, then talk to everyone with more to tell.
 * The day's hours decide how far down the list it gets.
 */
export function scriptedRoadDay(r: RoadState): RoadActionId[] {
  const village = villageOf(r);
  // On the wagon: hear out the fellow travellers (#1253), then rest.
  if (!village) return [...peopleHere(r).filter(p => (r.told[p.id] ?? 0) < p.lore.length).map(p => `talk:${p.id}` as const), 'help', 'rest'];
  const out: RoadActionId[] = [];
  const offered = questsHere(r);
  for (const q of offered) out.push(`accept:${q.id}`);
  // Judge completions as if the offered ones were already taken (they will be, a moment earlier).
  const taken = new Set([...Object.entries(r.quests).filter(([, st]) => st === 'active').map(([id]) => id), ...offered.map(q => q.id)]);
  const doable = QUESTS.filter(q => taken.has(q.id) && q.village === village && q.needs.kind !== 'deliver' && canComplete(q, r) === null)
    .sort((a, b) => QUEST_ORDER[a.needs.kind] - QUEST_ORDER[b.needs.kind]);
  for (const q of doable) out.push(`complete:${q.id}`);
  // Enough to eat for every night left, and to drink for every village night left.
  const t = tradeTerms(r);
  let marks = r.marks;
  const nightsLeft = ROAD_DAYS - r.day + 1;
  const villageNights = ROUTE.slice(r.leg).reduce((n, l, i) => n + (l.kind === 'village' ? (i === 0 ? daysLeftOnLeg(r) : l.days) : 0), 0);
  for (const [good, need] of [['rawFood', nightsLeft - r.stores.rawFood - r.stores.rations], ['water', villageNights - r.stores.water]] as const) {
    if (!t || need <= 0 || !t.sells.includes(good)) continue;
    let qty = need;
    while (qty > 0 && buyPrice(good, qty, t) > marks) qty--;
    if (qty > 0) { out.push(`buy:${good}:${qty}`); marks -= buyPrice(good, qty, t); }
  }
  // One lesson a stay, if it's affordable after food: a recipe, else a technique within reach.
  const teacher = peopleOf(village).find(p => p.teaches && lessonFee(r, p.id) <= marks);
  if (teacher?.teaches) {
    const tt = teacher.teaches;
    const thing = tt.recipes.find(x => !r.known.includes(x))
      ?? tt.techniques.find(id => { const tech = techniqueById(id); return !!tech && !r.techniques.includes(id) && canBeTaught(tech, skillLevel(r.skills, tech.skill)); });
    if (thing) out.push(`learn:${teacher.id}:${thing}`);
    if (!r.appraised.includes(teacher.id)) out.push(`appraise:${teacher.id}`);
  }
  for (const p of peopleOf(village)) if ((r.told[p.id] ?? 0) < p.lore.length) out.push(`talk:${p.id}`);
  return out.length ? out : ['wait'];
}
