/**
 * A deterministic baseline player (#1226): the careful plan from the balance
 * tests, replied as JSON so it goes through exactly the same parsing as a
 * model. Useful as a benchmark ("does the model beat the script?") and for
 * testing the harness without an API key.
 */

import { SUGGESTED_PACK } from '../../artificer/kit';
import { blockedReason, nightFuel, queueHours, queueId, runAction, winterOutlook, DAY_HOURS, type ActionId, type ActionOpts, type QueueItem, type Region1State } from '../../artificer/region1';
import { campAsActionOn } from '../../artificer/camp-sites';
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
import { shown } from '../../artificer/action-visibility';
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

/**
 * Traps first; hunting and fishing need gear (#1821, `hunting-gear`): a hunt the Warden can't do yet
 * becomes a sling made (once), else a line of traps (one per distance), else foraging; once the bow
 * opens (Hunting enough, and the sinew from those catches) a hunt becomes the bow made; a fishing trip
 * without a hook and line becomes one made, else foraging. With the switch off nothing is hidden and
 * the plan is as it always was.
 */
function withGear(queue: Entry[], s: Region1State): Entry[] {
  const used = new Set<string>();
  const first = (action: string, ring = 1): Entry | null => {
    const key = `${action}@${ring}`;
    if (used.has(key) || !shown(s, action as ActionId) || blockedReason(s, action as ActionId, ring as Ring) !== null) return null;
    used.add(key);
    return a(action, ring);
  };
  return queue.map(e => {
    // Once it knows hunting well enough and has the sinew (from the traps and sling hunts), a bow (once).
    if (e.action === 'hunt' && shown(s, 'bow')) { const bow = first('bow'); if (bow) return bow; }
    if (e.action === 'hunt' && !shown(s, 'hunt')) return first('sling') ?? first('traps', e.ring) ?? a('gather', e.ring);
    if (e.action === 'fish' && !shown(s, 'fish')) return first('hookline') ?? a('gather', e.ring);
    return e;
  });
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
  const old = stepwise(scriptedPlanner());
  // With camp as an action (#1732) the fixed plan never makes camp, so it never builds or fetches
  // water and dies of thirst in the first fortnight (#1852): those games are played by needs instead.
  return { ...old, async decide(message, s) { return campAsActionOn(s) ? needsDay(s) : old.decide(message, s); } };
};

// ── Playing by needs (#1852) ────────────────────────────────────────────────

/** Vigor and Clarity the needs player won't work below: under them, it rests or ends the day. */
const VIGOR_FLOOR = 20, CLARITY_FLOOR = 15;

const optsOf = (e: Entry): ActionOpts => Object.fromEntries(e.options.map(o => [o.key, o.value])) as ActionOpts;
const itemOf = (e: Entry): QueueItem => {
  const q = queueId(e.action as ActionId, e.ring as Ring);
  return e.options.length ? { q, opts: optsOf(e) } : q;
};

/** Firewood the next `n` nights ask, as the sim works it out (a cave asks for little; a frost a lot). */
const fuelFor = (s: Region1State, n: number): number => {
  let need = 0;
  for (let d = s.day; d < Math.min(s.day + n, s.config.calendar.thawDay); d++) need += nightFuel(s, d);
  return need;
};

/** Is this action open now, in this ring? (Hidden, blocked or wasted by the weather: no.) */
const open = (s: Region1State, e: Entry): boolean =>
  shown(s, e.action as ActionId) && blockedReason(s, e.action as ActionId, e.ring as Ring, optsOf(e)) === null && !spoiled(e, s);

/**
 * What the needs player wants next, most urgent first (#1852): camp, the near ground known, water
 * for tonight and tomorrow, wood for the nights ahead (a winter's worth by late autumn), a roof, then
 * food (traps first, a sling and a hook and line when it can make them, then hunting, fishing and
 * foraging), then smoking the spare, cold gear and a better shelter. Each is checked against the
 * state the day's earlier actions leave, so the list adapts as the day goes.
 */
function wants(s: Region1State): Entry[] {
  const winter = seasonOf(s.day, s.config.calendar) === 'winter';
  const toWinter = Math.max(0, s.config.calendar.winterDay - s.day);
  const food = s.stores.rawFood + s.stores.rations;
  const nightsLeft = Math.max(0, s.config.calendar.thawDay - s.day);
  const out: Entry[] = [];
  if (!s.campSpot) out.push(a('camp'));
  if (!scouted(s.explore, 1)) out.push(a('scout'), a('explore'));
  // Water: two nights' worth in hand, three once the streams freeze (melting snow needs a fire).
  if (s.stores.water < (winter ? 3 : 2)) out.push(a('water'));
  // Wood: tonight and the next two nights, always; in late autumn, a growing share of the winter.
  const fuelNow = fuelFor(s, 3) + 1;
  if (s.stores.firewood < fuelNow) out.push(a('wood'));
  if (s.tier === 0) out.push(a('build'));
  // Food: keep a few nights in hand, and in autumn lay in toward the winter.
  const foodTarget = Math.min(nightsLeft, winter ? 4 : 3 + Math.max(0, 30 - toWinter) / 2);
  if (food < foodTarget) {
    out.push(a('traps'), a('traps', 2), a('sling'), a('hookline'), a('bow'));
    out.push(a('hunt', 1, { target: 'small' }), a('fish'), a('gather'), a('hunt', 2, { target: 'small' }), a('gather', 2));
  }
  // Once there's a roof, a look further out: more places to camp, forage and game, and the map's places.
  if (s.tier > 0 && !scouted(s.explore, 2)) out.push(a('scout', 2), a('explore', 2));
  if (s.stores.rawFood >= 4) out.push(a('preserve'));
  // Meat lying out at camp draws animals (#1823): put it out of reach (refused, so skipped, with nothing to store or the switch off).
  out.push(a('storemeat'));
  if (s.stores.water < 4) out.push(a('water'));
  const fuelSoon = toWinter <= 20 ? Math.min(winterOutlook(s).fuelToThaw, fuelFor(s, 20 - toWinter + 3)) : fuelNow;
  if (s.stores.firewood < fuelSoon) out.push(a('wood'));
  out.push(a('coldGear'), a('build'), a('coldPit'), a('bedroll'), a('drawmap'));
  // A better roof before the frosts: short of materials for it, cut timber (wood brings both).
  if (s.tier < 2 && /needs \d+ materials/.test(blockedReason(s, 'build', 1) ?? '')) out.push(a('wood'));
  out.push(a('sling'), a('hookline'));
  if (food < nightsLeft) out.push(a('traps'), a('hunt', 1, { target: 'small' }), a('fish'), a('gather'));
  if (s.stores.firewood < winterOutlook(s).fuelToThaw + 4) out.push(a('wood'));
  return out;
}

/** One action played forward on the plan's dice-free copy. */
const tryAction = (s: Region1State, e: Entry): Region1State => runAction(s, itemOf(e));

/** Would this action leave the Warden spent, or cost Condition (overwork, a danger)? */
const tooHard = (before: Region1State, after: Region1State): boolean =>
  after.vitals.vigor.current < VIGOR_FLOOR || after.vitals.clarity.current < CLARITY_FLOOR || after.vitals.condition < before.vitals.condition
  || after.hoursToday > DAY_HOURS || !!after.outcome;

/**
 * The day as the needs player plans it: the most urgent want that it can do without going past its
 * floors, played forward, then the next, until the day is spent or nothing else is worth doing.
 * A rest comes in when the Warden is worn and the day still has hours. Until it can plan ahead the
 * runner runs only the first entry and asks again, so each call plans from where the day stands.
 */
function planNeeds(start: Region1State): Entry[] {
  // Planned without the dice (#1852): no luck, accidents or encounters on the copy it plays forward,
  // so the plan weighs what a person could expect, never the seeded rolls still to come.
  let s: Region1State = { ...start, config: { ...start.config, world: { ...start.config.world, luck: false, accidents: false, encounters: false } } };
  const day: Entry[] = [];
  while (s.hoursToday < DAY_HOURS && day.length < 10 && !s.outcome) {
    let picked: { e: Entry; next: Region1State } | null = null;
    for (const e of wants(s)) {
      if (!open(s, e)) continue;
      const next = tryAction(s, e);
      if (next.hoursToday === s.hoursToday || tooHard(s, next)) continue;
      picked = { e, next };
      break;
    }
    if (!picked) {
      // Nothing it can do without overworking: rest if there's time and it helps, else end the day.
      const rest = a('rest');
      if (s.vitals.vigor.current < s.vitals.vigor.cap * 0.6 && open(s, rest) && DAY_HOURS - s.hoursToday >= queueHours('rest', s)) {
        day.push(rest); s = tryAction(s, rest); continue;
      }
      break;
    }
    day.push(picked.e);
    s = picked.next;
  }
  return day;
}

/** A day by needs, replied as JSON like any player's. A blizzard keeps it in, as the fixed plan does. */
function needsDay(s: Region1State): { text: string; usage: { cost: number } } {
  const eating = eatingFor(s);
  const queue = isBlizzard(s.weatherToday, s.day, s.config.calendar) ? blizzardDay(s) : planNeeds(s);
  return { text: JSON.stringify({ thoughts: `Day ${s.day}: what's needed most.`, site: null, eating, queue }), usage: { cost: 0 } };
}

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
      queue = withGear(queue, s);
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
