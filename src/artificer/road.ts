/**
 * Region 1.5 — the caravan road (#1244, epic #1235).
 *
 * Surviving the winter in Greywind Reach no longer ends the run: at the thaw
 * a caravan comes up the valley (#1307), and the Warden rides with it to
 * Mistheim, stopping at three villages on the way. The road runs in spring —
 * mild nights, no ice — so the fixed warmth of the wagon camp and the village
 * roofs is all the cold there is. This module is the
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
import { statEffects } from './stats';
import { peopleOf, personById, startingTrust, wordFrom, talk, TALK_HOURS } from './villages';
import { survivalLock } from './focus';
import { buyPrice, isGood, parseLot, sellPrice, traderAmong, KIND_OF, SALE_TRUST, TRADER_STOCK, TRADE_HOURS, type Terms } from './trade';
import { GRADES, addInsight, type Grade } from './crafting';
import { availableQuests, canComplete, questById, toolFor, DELIVER_FAIL_TRUST, EXPIRE_TRUST, HAND_OVER_HOURS, QUEST_TRUST, QUEST_TRUST_VILLAGE, REPAIR_INSIGHT, REPAIR_RATES, SCOUT_RATES, type QuestStatus, type QuestTemplate } from './quests';
import { practise, skillLevel, drainMult } from './skills';
import { techniqueEffects } from './techniques';
import { ACTIONS, CRAFT_WORLD, DAY_HOURS, TRAVEL_CLARITY_RATE, TRAVEL_VIGOR_RATE, deathLine, sleepNight, type LogEntry, type Region1State, type Sleeper } from './region1';

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

/** The season on the road: the thaw is behind you, so no night on it is a cold one. */
export const ROAD_SEASON = 'spring' as const;

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
  /** How you came through the winter: hale is `thrive`, worn or broken `ragged`. Later issues key trust and standing off it. */
  arrival: 'thrive' | 'ragged';
  /** Trust per person met (#1246), 0–100. */
  trust: Record<string, number>;
  /** Lore lines each person has told you, and talks since they ran out (for diminishing returns). */
  told: Record<string, number>;
  idleTalks: Record<string, number>;
  /** The word that travels ahead of you (#1246): added to the next village's starting trust. */
  word: number;
  /** Caravan scrip (#1247): what you've sold for, and what you buy with. */
  marks: number;
  /** Quests taken (#1248), by id: active until done, failed or expired. */
  quests: Record<string, QuestStatus>;
  log: LogEntry[];
  outcome: RoadOutcome | null;
}

/**
 * Start the road from a Region 1 run that survived to the thaw (#1307). How the
 * Warden came through sets the arrival: hale rides on thriving, worn or broken
 * rides on ragged. Throws for any other ending — the dead take no road.
 */
export function createRoad(from: Region1State): RoadState {
  const o = from.outcome;
  if (!o || o.kind !== 'survived') throw new Error('the road starts only from a run that survived the winter');
  const ragged = o.grade !== 'hale';
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
    character: { ...from.character, talents: from.character.talents.map(t => ({ ...t })), stats: { ...from.character.stats } },
    focus: from.focus,
    skills: { ...from.skills },
    techniques: [...from.techniques],
    manuals: [...from.manuals],
    known: [...from.known],
    studiedToday: {},
    leg: 0,
    legDay: 1,
    arrival: ragged ? 'ragged' : 'thrive',
    trust: {},
    told: {},
    idleTalks: {},
    word: 0,
    marks: 0,
    quests: {},
    log: [],
    outcome: null,
  };
  say(s, `You climb onto the last wagon as Greywind Reach falls behind, the valley green with ${ROAD_SEASON}. Mistheim is ${ROAD_DAYS} days down the road.`, 'milestone');
  if (ragged) say(s, "The winter took a lot out of you. It'll be days on the wagon before you're right.", 'hardship');
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
    character: { ...s.character, talents: s.character.talents.map(t => ({ ...t })), stats: { ...s.character.stats } },
    skills: { ...s.skills },
    techniques: [...s.techniques],
    manuals: [...s.manuals],
    known: [...s.known],
    studiedToday: { ...s.studiedToday },
    trust: { ...s.trust },
    told: { ...s.told },
    idleTalks: { ...s.idleTalks },
    quests: { ...s.quests },
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

/**
 * What you can do on the road so far: rest, let the day pass, talk to someone
 * in the village (#1246), or trade with its trader (#1247) — `sell:<item>`,
 * `sell:<item>:<qty|grade>`, `buy:<good>`, `buy:<good>:<qty>` — or take on
 * and finish its quests (#1248): `accept:<questId>`, `complete:<questId>`.
 * Teachers come in #1249.
 */
export type RoadActionId = 'rest' | 'wait' | `talk:${string}` | `sell:${string}` | `buy:${string}` | `accept:${string}` | `complete:${string}`;

/** The village you're in, or null on the wagon. */
export const villageOf = (s: RoadState): string | null => { const l = legOf(s); return l.kind === 'village' ? l.id : null; };

/** Open a village (#1246): everyone you meet starts at the arrival's trust, your Charisma, and the word that travelled ahead. */
function openVillage(s: RoadState, id: string): void {
  const start = startingTrust(s.arrival, statEffects(s.character.stats).trust, s.word);
  for (const p of peopleOf(id)) if (s.trust[p.id] === undefined) s.trust[p.id] = start;
}

/** Leave a village (#1246): word of how they took to you travels to the next. */
function leaveVillage(s: RoadState, id: string): void {
  s.word = wordFrom(peopleOf(id).map(p => s.trust[p.id] ?? 0));
}

/** Do one thing now. Nothing happens once the road is over, or when the day's hours are spent. */
export function runRoadAction(s: RoadState, id: RoadActionId): RoadState {
  if (s.outcome || s.hoursToday >= DAY_HOURS) return s;
  const next = clone(s);
  if (id.startsWith('talk:')) {
    // Talk to someone here (#1246): only people in this village, and it takes a couple of hours.
    const pid = id.slice(5);
    const person = peopleOf(villageOf(next)).find(p => p.id === pid);
    if (!person) { say(next, `Talk: skipped — there's no one called ${pid} here.`, 'skip'); return next; }
    const r = talk(person, next.trust[pid] ?? 0, next.told[pid] ?? 0, next.idleTalks[pid] ?? 0);
    next.trust[pid] = r.trust;
    next.told[pid] = r.told;
    next.idleTalks[pid] = r.idleTalks;
    const a = applyActivity(next.vitals, { hours: TALK_HOURS, vigorRate: 0, clarityRate: -1 });
    next.vitals = a.vitals;
    next.today.loadClarity += a.loadClarity;
    next.hoursToday += TALK_HOURS;
    say(next, r.line, 'action');
    return next;
  }
  if (id.startsWith('sell:') || id.startsWith('buy:')) return trade(next, id);
  if (id.startsWith('accept:')) return accept(next, id.slice(7));
  if (id.startsWith('complete:')) return complete(next, id.slice(9));
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

/** The terms the village trader offers you right now (#1247), or null when no one here is trading. */
export function tradeTerms(s: RoadState): (Terms & { trader: string; name: string; sells: readonly string[] }) | null {
  const trader = traderAmong(peopleOf(villageOf(s)));
  if (!trader) return null;
  const stock = TRADER_STOCK[trader.id];
  return { trader: trader.id, name: trader.name, wants: stock.wants, sells: stock.sells, trust: s.trust[trader.id] ?? 0, priceFactor: statEffects(s.character.stats).priceFactor };
}

/** Which copy of a tool a sale takes: the grade asked for, or else your worst (you keep the best). */
function copyToSell(s: RoadState, item: string, grade: Grade | null): number {
  let at = -1;
  s.tools.forEach((t, i) => {
    if (t.item !== item || (grade && t.grade !== grade)) return;
    if (at < 0 || GRADES.indexOf(t.grade) < GRADES.indexOf(s.tools[at].grade)) at = i;
  });
  return at;
}

/**
 * One sale or purchase with the village trader (#1247). A rejected trade
 * (no trader, nothing to sell, not enough marks) costs no hours.
 */
function trade(next: RoadState, id: string): RoadState {
  const selling = id.startsWith('sell:');
  const verb = selling ? 'Sell' : 'Buy';
  const terms = tradeTerms(next);
  if (!terms) { say(next, `${verb}: skipped — No one here is trading.`, 'skip'); return next; }
  const lot = parseLot(id.slice(selling ? 5 : 4));
  if (selling) {
    let grade: Grade = 'sound', qty = lot.qty;
    if (isGood(lot.item)) {
      if (next.stores[lot.item] < qty) { say(next, `Sell: skipped — you don't have ${qty} ${lot.item}.`, 'skip'); return next; }
      next.stores[lot.item] -= qty;
    } else {
      const at = copyToSell(next, lot.item, lot.grade);
      if (at < 0 || KIND_OF[lot.item] === undefined) { say(next, `Sell: skipped — you have no ${lot.grade ? `${lot.grade} ` : ''}${lot.item} to sell.`, 'skip'); return next; }
      grade = next.tools[at].grade;
      qty = 1;
      next.tools.splice(at, 1);
    }
    const price = sellPrice(lot.item, grade, qty, terms);
    next.marks += price;
    next.trust[terms.trader] = Math.min(100, terms.trust + SALE_TRUST);
    say(next, `Sold ${qty > 1 ? `${qty} ` : ''}${isGood(lot.item) ? lot.item : `${grade} ${lot.item}`} to ${terms.name} for ${price} marks.`, 'action');
  } else {
    if (!isGood(lot.item) || !terms.sells.includes(lot.item)) { say(next, `Buy: skipped — ${terms.name} doesn't sell ${lot.item}.`, 'skip'); return next; }
    const price = buyPrice(lot.item, lot.qty, terms);
    if (next.marks < price) { say(next, `Buy: skipped — ${lot.qty} ${lot.item} costs ${price} marks; you have ${next.marks}.`, 'skip'); return next; }
    next.marks -= price;
    next.stores[lot.item] += lot.qty;
    say(next, `Bought ${lot.qty} ${lot.item} from ${terms.name} for ${price} marks.`, 'action');
  }
  const a = applyActivity(next.vitals, { hours: TRADE_HOURS, vigorRate: 0, clarityRate: -1 });
  next.vitals = a.vitals;
  next.today.loadClarity += a.loadClarity;
  next.hoursToday += TRADE_HOURS;
  return next;
}

// ── Quests (#1248) ──────────────────────────────────────────────────────────

/** The quests on offer where you are. */
export const questsHere = (s: RoadState): QuestTemplate[] => availableQuests(villageOf(s), s.trust, s.quests);

const nameOf = (pid: string): string => personById(pid)?.name ?? pid;
const bump = (s: RoadState, pid: string, by: number): void => { s.trust[pid] = Math.max(0, Math.min(100, (s.trust[pid] ?? 0) + by)); };

/** Take on a quest (no time): it must be offered here. A delivery hands you what to carry. */
function accept(next: RoadState, qid: string): RoadState {
  const quest = questsHere(next).find(x => x.id === qid);
  if (!quest) { say(next, `Accept: skipped — no one here is offering "${qid}".`, 'skip'); return next; }
  next.quests[qid] = 'active';
  const n = quest.needs;
  if (n.kind === 'deliver') next.stores[n.item] += n.qty;
  say(next, `${nameOf(quest.giver)}: "${quest.offer}" You take on ${quest.title}.`, 'action');
  return next;
}

/** Pay out a finished quest: marks, any item or recipe, and trust with the giver and their village. */
function reward(next: RoadState, quest: QuestTemplate): void {
  next.quests[quest.id] = 'done';
  const r = quest.reward;
  next.marks += r.marks;
  if (r.item) next.stores[r.item.item] += r.item.qty;
  const learnt = r.recipe && !next.known.includes(r.recipe) ? r.recipe : null;
  if (learnt) next.known.push(learnt);
  bump(next, quest.giver, QUEST_TRUST);
  for (const p of peopleOf(quest.village)) if (p.id !== quest.giver) bump(next, p.id, QUEST_TRUST_VILLAGE);
  const extras = [`${r.marks} marks`, r.item && `${r.item.qty} ${r.item.item}`, learnt && `the ${learnt} recipe`].filter(Boolean).join(', ');
  say(next, `${nameOf(quest.giver)}: "${quest.thanks}" ${quest.title} done — ${extras}.`, 'milestone');
}

/** Spend hours of work on the road, draining as given (rates per hour). */
function work(next: RoadState, hours: number, vigorRate: number, clarityRate: number): void {
  const a = applyActivity(next.vitals, { hours, vigorRate, clarityRate });
  next.vitals = a.vitals;
  next.today.loadVigor += a.loadVigor;
  next.today.loadClarity += a.loadClarity;
  next.today.pushedVigor ||= a.pushedVigor;
  next.today.pushedClarity ||= a.pushedClarity;
  next.hoursToday += hours;
}

/** Finish a quest you've taken. A rejection says what's needed and costs no hours. */
function complete(next: RoadState, qid: string): RoadState {
  const quest = questById(qid);
  if (!quest || next.quests[qid] !== 'active') { say(next, `Complete: skipped — you haven't taken on "${qid}".`, 'skip'); return next; }
  if (quest.needs.kind !== 'deliver' && villageOf(next) !== quest.village) { say(next, `Complete: skipped — ${quest.title} is for ${nameOf(quest.giver)}, back in their village.`, 'skip'); return next; }
  const why = canComplete(quest, next);
  if (why) { say(next, `Complete: skipped — ${quest.title} ${why}.`, 'skip'); return next; }
  const n = quest.needs;
  if (n.kind === 'fetch') {
    next.stores[n.item] -= n.qty;
    work(next, HAND_OVER_HOURS, 0, 0);
  } else if (n.kind === 'craft') {
    next.tools.splice(toolFor(next.tools, n.item, n.grade), 1);
    work(next, HAND_OVER_HOURS, 0, 0);
  } else if (n.kind === 'repair') {
    work(next, n.hours, REPAIR_RATES.vigorRate, REPAIR_RATES.clarityRate);
    addInsight(next.concepts, n.concept, REPAIR_INSIGHT, CRAFT_WORLD.concepts);
  } else if (n.kind === 'scout') {
    // As Region 1's Scout: your scouting skill lightens the work, and Pathfinding (and Agility) the walk.
    const lvl = skillLevel(next.skills, 'scouting');
    const te = techniqueEffects(next.techniques, 'scout', undefined, true);
    const walk = te.travelDrain * statEffects(next.character.stats).travel;
    work(next, n.hours, SCOUT_RATES.vigorRate * drainMult(lvl) * te.drain, SCOUT_RATES.clarityRate * drainMult(lvl) * te.drain);
    work(next, n.walk, TRAVEL_VIGOR_RATE * walk, TRAVEL_CLARITY_RATE * walk);
    next.skills = practise(next.skills, 'scouting', n.hours).practice;
  }
  reward(next, quest);
  return next;
}

/** The caravan leaves a village: quests still open there expire. */
function expireQuests(next: RoadState, villageId: string): void {
  for (const [qid, st] of Object.entries(next.quests)) {
    const quest = questById(qid);
    if (st !== 'active' || !quest || quest.village !== villageId || quest.needs.kind === 'deliver') continue;
    next.quests[qid] = 'expired';
    bump(next, quest.giver, -EXPIRE_TRUST);
    say(next, `${quest.title} is left undone — ${nameOf(quest.giver)} watches the caravan go.`, 'hardship');
  }
}

/** The caravan reaches a village: deliveries bound here complete, if you still have the goods. */
function arriveWithDeliveries(next: RoadState, villageId: string): void {
  for (const [qid, st] of Object.entries(next.quests)) {
    const quest = questById(qid);
    const n = quest?.needs;
    if (st !== 'active' || !quest || n?.kind !== 'deliver' || n.to !== villageId) continue;
    if (next.stores[n.item] >= n.qty) {
      next.stores[n.item] -= n.qty;
      say(next, `You hand ${n.qty} ${n.item} to ${nameOf(n.recipient)}, as promised.`, 'action');
      reward(next, quest);
    } else {
      next.quests[qid] = 'failed';
      bump(next, quest.giver, -DELIVER_FAIL_TRUST);
      say(next, `You reach ${nameOf(n.recipient)} without the ${n.item} ${nameOf(quest.giver)} trusted you with. Word will get back.`, 'hardship');
    }
  }
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
  if (leg.kind === 'village') {
    expireQuests(next, leg.id);
    leaveVillage(next, leg.id);
    say(next, `The caravan rolls out at dawn, leaving ${leg.name} behind.`, 'milestone');
  }
  if (next.leg === ROUTE.length - 1) {
    next.legDay = leg.days;
    next.outcome = { kind: 'arrived', vitals: next.vitals };
    say(next, "The road ends at Mistheim's gates. You made it.", 'outcome');
    return next;
  }
  next.leg += 1;
  next.legDay = 1;
  const now = legOf(next);
  if (now.kind === 'village') {
    openVillage(next, now.id);
    say(next, `The caravan reaches ${now.name}. It stays ${now.days} days.`, 'milestone');
    arriveWithDeliveries(next, now.id);
  }
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
