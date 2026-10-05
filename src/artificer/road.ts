/**
 * Region 1.5 — the caravan road (#1244, epic #1235).
 *
 * Leaving Greywind Reach with the caravan no longer ends the run: the Warden
 * rides to Mistheim, stopping at three villages on the way. This module is the
 * skeleton of that journey — the route, the day clock, and survival on the
 * move. People, trade, quests and teachers build on it (#1245–#1249).
 *
 * The caravan keeps its own schedule: a village stay lasts a fixed number of
 * days and then the wagons roll out whether you're ready or not, a soft
 * deadline like winter was in Region 1.
 *
 * Pure and deterministic like the rest of the sim core: nights go through the
 * same `sleepNight` as Region 1, so needs, collapse and death work the same
 * wherever the Warden sleeps.
 */

import { applyActivity, type Vitals } from './vitality';
import { survivalLock } from './focus';
import { ACTIONS, DAY_HOURS, deathLine, sleepNight, type LogEntry, type Region1State, type Sleeper } from './region1';

// ── The route ───────────────────────────────────────────────────────────────

/** A stretch of the journey: days on the wagon, or a stay in a village. */
export type Leg =
  | { kind: 'travel'; days: number; to: string }
  | { kind: 'village'; id: string; name: string; days: number };

/**
 * Three villages (staying 3 / 3 / 4 days), two travel days before each and two
 * more to Mistheim. Names are placeholders until the lore pass (#1253).
 */
export const ROUTE: readonly Leg[] = [
  { kind: 'travel', days: 2, to: 'Hollowford' },
  { kind: 'village', id: 'hollowford', name: 'Hollowford', days: 3 },
  { kind: 'travel', days: 2, to: 'Saltmere' },
  { kind: 'village', id: 'saltmere', name: 'Saltmere', days: 3 },
  { kind: 'travel', days: 2, to: 'Kestrel Gate' },
  { kind: 'village', id: 'kestrel-gate', name: 'Kestrel Gate', days: 4 },
  { kind: 'travel', days: 2, to: 'Mistheim' },
];

/** The whole journey, in days. */
export const ROAD_DAYS = ROUTE.reduce((n, l) => n + l.days, 0);

/**
 * How warm a night is: the wagon camp (canvas, a shared fire) or a village
 * roof. Both beat a bare Region 1 camp, so the road is never a cold night.
 */
export const ROAD_WARMTH: Readonly<Record<Leg['kind'], number>> = { travel: 0.6, village: 0.8 };

/** A ragged Warden boards half-frozen: Condition starts no higher than this. */
export const RAGGED_CONDITION = 70;

// ── State ───────────────────────────────────────────────────────────────────

/** How the road ended: arrival in Mistheim, or the body gave out on the way. */
export interface RoadOutcome { kind: 'arrived' | 'died' | 'collapsed'; vitals: Vitals }

/**
 * The Warden on the road. The body, mind and knowledge are Region 1's fields
 * (so the shared night works on both); the camp, land and season are gone,
 * replaced by where on the route you are.
 */
export interface RoadState extends Sleeper, Pick<Region1State, 'skills' | 'techniques' | 'manuals' | 'known' | 'studiedToday'> {
  /** Index into ROUTE. */
  leg: number;
  /** Day within the current leg, from 1. */
  legDay: number;
  /** How you left Greywind Reach — later issues key trust and standing off it. */
  arrival: 'thrive' | 'ragged';
  log: LogEntry[];
  outcome: RoadOutcome | null;
}

/** Start the road from a Region 1 run that left with the caravan. Throws for any other ending. */
export function createRoad(from: Region1State): RoadState {
  const o = from.outcome;
  if (!o || o.choice !== 'caravan' || (o.kind !== 'thrive' && o.kind !== 'ragged')) {
    throw new Error('the road starts only from a caravan exit (thrive or ragged)');
  }
  const ragged = o.kind === 'ragged';
  const vitals: Vitals = { vigor: { ...from.vitals.vigor }, clarity: { ...from.vitals.clarity }, condition: from.vitals.condition };
  if (ragged) vitals.condition = Math.min(vitals.condition, RAGGED_CONDITION);
  const s: RoadState = {
    day: 1,
    hoursToday: 0,
    vitals,
    // Rations were the winter larder; on the road they're simply food.
    stores: { ...from.stores, rawFood: from.stores.rawFood + from.stores.rations, rations: 0 },
    tools: [...from.tools],
    concepts: { ...from.concepts },
    today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false },
    deprivation: { ...from.deprivation },
    character: { ...from.character, traits: [...from.character.traits], stats: { ...from.character.stats } },
    focus: from.focus,
    skills: { ...from.skills },
    techniques: [...from.techniques],
    manuals: [...from.manuals],
    known: [...from.known],
    studiedToday: {},
    leg: 0,
    legDay: 1,
    arrival: ragged ? 'ragged' : 'thrive',
    log: [],
    outcome: null,
  };
  say(s, `You climb onto the last wagon as Greywind Reach falls behind. Mistheim is ${ROAD_DAYS} days down the road.`, 'milestone');
  if (ragged) say(s, "The caravan took you in half-frozen. It'll be days before you're right.", 'hardship');
  return s;
}

function clone(s: RoadState): RoadState {
  return {
    ...s,
    vitals: { vigor: { ...s.vitals.vigor }, clarity: { ...s.vitals.clarity }, condition: s.vitals.condition },
    stores: { ...s.stores },
    tools: [...s.tools],
    concepts: { ...s.concepts },
    today: { ...s.today },
    deprivation: { ...s.deprivation },
    character: { ...s.character, traits: [...s.character.traits], stats: { ...s.character.stats } },
    skills: { ...s.skills },
    techniques: [...s.techniques],
    manuals: [...s.manuals],
    known: [...s.known],
    studiedToday: { ...s.studiedToday },
    log: [...s.log],
  };
}

const say = (s: RoadState, text: string, kind: LogEntry['kind']): void => { s.log.push({ day: s.day, text, kind }); };

/** The leg you're on. */
export const legOf = (s: RoadState): Leg => ROUTE[s.leg];

/** Days left on this leg, today included. */
export const daysLeftOnLeg = (s: RoadState): number => legOf(s).days - s.legDay + 1;

/** Why the mind is locked to survival on the road, or null. There's no winter to race here, only needs. */
export const roadLockOf = (s: RoadState): string | null =>
  survivalLock({ thirsty: s.deprivation.thirsty, hungry: s.deprivation.hungry, condition: s.vitals.condition, daysToWinter: Infinity, winterReady: true });

// ── Actions ─────────────────────────────────────────────────────────────────

/** What you can do on the road so far. Travel and village verbs come in #1245–#1249. */
export type RoadActionId = 'rest' | 'wait';

/** Do one thing now. Nothing happens once the road is over, or when the day's hours are spent. */
export function runRoadAction(s: RoadState, id: RoadActionId): RoadState {
  if (s.outcome || s.hoursToday >= DAY_HOURS) return s;
  const next = clone(s);
  if (id === 'wait') {
    // Let the day pass: no work, no strain.
    next.hoursToday = DAY_HOURS;
    const leg = legOf(next);
    say(next, leg.kind === 'travel' ? 'You watch the road go by.' : `You pass the day in ${leg.name}.`, 'action');
    return next;
  }
  // Rest works as it did in Region 1.
  const def = ACTIONS.rest;
  const r = applyActivity(next.vitals, { hours: def.hours, vigorRate: def.vigorRate, clarityRate: def.clarityRate });
  next.vitals = r.vitals;
  next.today.loadVigor += r.loadVigor;
  next.today.loadClarity += r.loadClarity;
  next.hoursToday += def.hours;
  say(next, 'Sat a while and let the ache settle.', 'action');
  return next;
}

/**
 * End the day: a night as in Region 1 (the caravan's barrels water you on
 * travel days; in a village you fend for yourself), then the caravan moves
 * along its route — into a village, out of one at the end of the stay, or
 * through Mistheim's gates.
 */
export function endRoadDay(s: RoadState): RoadState {
  if (s.outcome) return s;
  const next = clone(s);
  const leg = legOf(next);
  const night = sleepNight(next, {
    warmth: ROAD_WARMTH[leg.kind],
    coldNight: false,
    lockedToday: roadLockOf(next) !== null,
    providedWater: leg.kind === 'travel',
  });
  if (night.ended) {
    next.outcome = { kind: night.ended, vitals: next.vitals };
    say(next, night.ended === 'died'
      ? deathLine(next)
      : 'Your body gives out. The caravan carries you on as cargo — this journey is over.', 'outcome');
    return next;
  }

  next.day += 1;
  next.hoursToday = 0;
  next.today = { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false };
  next.studiedToday = {};
  next.legDay += 1;
  if (next.legDay <= leg.days) return next;

  // This leg is done: the caravan moves on, on schedule.
  if (leg.kind === 'village') say(next, `The caravan rolls out at dawn, leaving ${leg.name} behind.`, 'milestone');
  if (next.leg === ROUTE.length - 1) {
    next.legDay = leg.days;
    next.outcome = { kind: 'arrived', vitals: next.vitals };
    say(next, "The road ends at Mistheim's gates. You made it.", 'outcome');
    return next;
  }
  next.leg += 1;
  next.legDay = 1;
  const now = legOf(next);
  if (now.kind === 'village') say(next, `The caravan reaches ${now.name}. It stays ${now.days} days.`, 'milestone');
  return next;
}

/** Run a queue for today (until the hours run out), then end the day. Returns the unrun remainder. */
export function runRoadDay(s: RoadState, queue: readonly RoadActionId[]): { state: RoadState; remaining: RoadActionId[] } {
  if (s.outcome) return { state: s, remaining: [...queue] };
  let state = s;
  const remaining = [...queue];
  while (remaining.length > 0 && state.hoursToday < DAY_HOURS) state = runRoadAction(state, remaining.shift() as RoadActionId);
  return { state: endRoadDay(state), remaining };
}
