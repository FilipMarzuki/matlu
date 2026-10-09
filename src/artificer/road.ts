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
import { healerTarget, healerCare, HARM_LORE, HARM_NAME, INJURY_NAME, HEAL_FEE, FRIEND_HEAL, HEAL_HOURS } from './injuries';
import { peopleOf, personById, TRAVELLERS, MISTHEIM_ARRIVAL, startingTrust, wordFrom, talk, TALK_HOURS, APPRAISE_HOURS, CONTACT_TRUST, FRIEND_LESSON, LESSON_FEE, LESSON_HOURS, LESSON_INSIGHT, type Person } from './villages';
import { survivalLock } from './focus';
import { buyPrice, isGood, parseLot, sellPrice, traderAmong, KIND_OF, SALE_TRUST, TRADER_STOCK, TRADE_HOURS, type Terms } from './trade';
import { GRADES, addInsight, type Grade } from './crafting';
import { availableQuests, canComplete, questById, toolFor, DELIVER_FAIL_TRUST, EXPIRE_TRUST, HAND_OVER_HOURS, QUEST_TRUST, QUEST_TRUST_VILLAGE, REPAIR_INSIGHT, REPAIR_RATES, SCOUT_RATES, type QuestStatus, type QuestTemplate } from './quests';
import { practise, skillFor, skillLevel, perceivedLevel, drainMult, LEVELS, SKILLS, type SkillId } from './skills';
import { TALENTS, hasHidden, type TalentId } from './talents';
import { canBeTaught, manualById, techniqueById, techniqueEffects, type Guidance } from './techniques';
import { ACTIONS, CRAFT_WORLD, creditedPractice, createRegion1, runAction, blockedReason, DAY_HOURS, TRAVEL_CLARITY_RATE, TRAVEL_VIGOR_RATE, deathLine, sleepNight, exerciseStats, noticeHidden, differenceOf, hiddenless, type ActionId, type LogEntry, type QueueItem, type Region1State, type Sleeper } from './region1';
import { createExploration, scout } from './exploration';
import { UNPAID_HELP_TRUST, type Boarding, type Fare } from './caravan-meeting';
import { ENCOUNTERS, encounterById, stepOf, unmet as encounterUnmet, chanceOf, rollOutcome, type EncounterTemplate, type PendingEncounter } from './encounters';
import { streamFor } from './rng';
import { seedOf } from './talents';

// ── The route ───────────────────────────────────────────────────────────────

/** A stretch of the journey: days on the wagon, or a stay in a village. */
export type Leg =
  | { kind: 'travel'; days: number; to: string }
  | { kind: 'village'; id: string; name: string; days: number };

/**
 * Three villages (staying 3 / 3 / 4 days), two travel days before each and two
 * more to Mistheim. The villages are written up in villages.ts (#1253).
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
export interface RoadState extends Sleeper, Pick<Region1State, 'skills' | 'techniques' | 'manuals' | 'known' | 'studiedToday' | 'met'> {
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
  /** Caravan scrip (#1247): what you've sold for, and what you buy with. Carried from an earlier road (#1250). */
  marks: number;
  /** People who trusted you on an earlier road (#1250): they start at CONTACT_TRUST when you meet them again. */
  contacts: string[];
  /** Quests taken (#1248), by id: active until done, failed or expired. */
  quests: Record<string, QuestStatus>;
  /** How recipes learned on the road were come by (#1249): a teacher's lesson, or a quest's reward. */
  discovery: Record<string, 'taught' | 'quest'>;
  /** Teachers who've appraised you in this village (#1249) — once each per stay. */
  appraised: string[];
  /** How the ride was paid for at the meeting (#1355); absent for a road begun before the meeting existed. */
  fare?: Fare | null;
  /** Days of `help` promised to Bodil for the ride (#1355), still owed. Due by the first village. */
  owesHelp?: number;
  /** Road encounters are met (#1349): carried from the Reach's world. */
  encounters?: boolean;
  /** A road encounter waiting for your choice (#1349): the day can't go on until you make it. */
  pending?: PendingEncounter | null;
  log: LogEntry[];
  outcome: RoadOutcome | null;
}

/**
 * Start the road from a Region 1 run that survived to the thaw (#1307). How the
 * Warden came through sets the arrival: hale rides on thriving, worn or broken
 * rides on ragged. Throws for any other ending — the dead take no road.
 *
 * `boarding` is what the meeting with the caravan settled (#1355): the fare is taken from your
 * stores and marks, trust won or lost is added, and help promised is owed. Without one, the
 * Warden simply climbs on, as before the meeting existed.
 */
export function createRoad(from: Region1State, boarding?: Boarding): RoadState {
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
    // Encounters lived through (#1360) travel with you, so the next Reach remembers them.
    ...(from.met ? { met: { ...from.met } } : {}),
    // Injuries (#1286) ride with you, and mend on the road.
    ...(from.injuries?.length ? { injuries: from.injuries.map(i => ({ ...i })) } : {}),
    studiedToday: {},
    leg: 0,
    legDay: 1,
    arrival: ragged ? 'ragged' : 'thrive',
    trust: {},
    told: {},
    idleTalks: {},
    word: 0,
    marks: from.marks ?? 0,
    contacts: [...(from.contacts ?? [])],
    quests: {},
    discovery: {},
    appraised: [],
    log: [],
    outcome: null,
    // Road encounters (#1349) where the Reach had them.
    ...(from.config.world.encounters ? { encounters: true } : {}),
  };
  // The caravan's own people (#1253) ride with you from the start; they know you as well as anyone in the first village will.
  const met = startingTrust(s.arrival, statEffects(s.character.stats).trust, 0);
  for (const t of TRAVELLERS) s.trust[t.id] = s.contacts.includes(t.id) ? Math.max(met, CONTACT_TRUST) : met;
  if (boarding) {
    // The meeting at the thaw (#1355): what was said goes in the journal, and what was agreed is settled.
    for (const l of boarding.lines) say(s, l.speaker ? `${TRAVELLERS.find(t => t.id === l.speaker)?.name ?? l.speaker}: ${l.text}` : `You: ${l.text}`, 'action');
    for (const [k, n] of Object.entries(boarding.paid.stores)) s.stores[k as keyof RoadState['stores']] = Math.max(0, s.stores[k as keyof RoadState['stores']] - (n ?? 0));
    s.marks = Math.max(0, s.marks - boarding.paid.marks);
    for (const [id, d] of Object.entries(boarding.trust)) s.trust[id] = Math.max(0, Math.min(100, (s.trust[id] ?? 0) + d));
    s.fare = boarding.fare;
    s.owesHelp = boarding.owesHelp;
  }
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
    discovery: { ...s.discovery },
    contacts: [...s.contacts],
    appraised: [...s.appraised],
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
 * And from its teachers (#1249): `learn:<teacherId>:<technique|recipe|concept>`
 * and `appraise:<teacherId>`. Anywhere on the road your hands and mind are free
 * (#1245): `craft:<recipe>`, `study:<concept>`, `tend`; on the wagon, `help`. A healer — Ottilia on the
 * wagon, or the village's — tends an injury (#1394): `heal:<healerId>`.
 */
export type RoadActionId = 'rest' | 'wait' | 'tend' | 'help' | `talk:${string}` | `heal:${string}` | `sell:${string}` | `buy:${string}` | `accept:${string}` | `complete:${string}` | `learn:${string}` | `appraise:${string}` | `craft:${string}` | `study:${string}`
  /** Region 1's camp and land work — refused on the road ("Not from the wagon"), but named so a player can try. */
  | ActionId;

/** The village you're in, or null on the wagon. */
export const villageOf = (s: RoadState): string | null => { const l = legOf(s); return l.kind === 'village' ? l.id : null; };

/** Who you can talk to now: the village's people, or on the wagon your fellow travellers (#1253). */
export const peopleHere = (s: RoadState): readonly Person[] => (villageOf(s) ? peopleOf(villageOf(s)) : TRAVELLERS);

/** Open a village (#1246): everyone you meet starts at the arrival's trust, your Charisma, and the word that travelled ahead. */
function openVillage(s: RoadState, id: string): void {
  const start = startingTrust(s.arrival, statEffects(s.character.stats).trust, s.word);
  // Someone who came to trust you on an earlier road remembers you (#1250).
  for (const p of peopleOf(id)) if (s.trust[p.id] === undefined) s.trust[p.id] = s.contacts.includes(p.id) ? Math.max(start, CONTACT_TRUST) : start;
}

/** Leave a village (#1246): word of how they took to you travels to the next. */
function leaveVillage(s: RoadState, id: string): void {
  s.word = wordFrom(peopleOf(id).map(p => s.trust[p.id] ?? 0));
}

/** Do one thing now. Nothing happens once the road is over, or when the day's hours are spent. */
export function runRoadAction(s: RoadState, id: RoadActionId): RoadState {
  const next = runRoadActionCore(s, id);
  // A hidden talent's hand on the road (#1265) — Silver Tongue's fairer prices and warmer welcome, say.
  if (next !== s && hasHidden(s.character.talents)) noticeHidden(next, differenceOf(next, runRoadActionCore(hiddenless(s), id)));
  return next;
}

function runRoadActionCore(s: RoadState, id: RoadActionId): RoadState {
  // An encounter waiting (#1349): nothing else happens until you choose.
  if (s.outcome || s.pending || s.hoursToday >= DAY_HOURS) return s;
  const next = clone(s);
  if (id.startsWith('talk:')) {
    // Talk to someone here (#1246): only people in this village, and it takes a couple of hours.
    const pid = id.slice(5);
    const person = peopleHere(next).find(p => p.id === pid);
    if (!person) { say(next, `Talk: skipped — there's no one called ${pid} here.`, 'skip'); return next; }
    const r = talk(person, next.trust[pid] ?? 0, next.told[pid] ?? 0, next.idleTalks[pid] ?? 0);
    // A fellow traveller's talk (#1245) also teaches a little of their trade: insight in their concept per line told.
    if (person.concept && r.told > (next.told[pid] ?? 0)) addInsight(next.concepts, person.concept, TRAVELLER_INSIGHT, CRAFT_WORLD.concepts);
    next.trust[pid] = r.trust;
    next.told[pid] = r.told;
    next.idleTalks[pid] = r.idleTalks;
    const a = applyActivity(next.vitals, { hours: TALK_HOURS, vigorRate: 0, clarityRate: -1 });
    next.vitals = a.vitals;
    next.today.loadClarity += a.loadClarity;
    next.hoursToday += TALK_HOURS;
    exerciseStats(next, { cha: TALK_HOURS }); // talking to people (#1257)
    say(next, r.line, 'action');
    return next;
  }
  if (id.startsWith('sell:') || id.startsWith('buy:')) return trade(next, id);
  if (id.startsWith('accept:')) return accept(next, id.slice(7));
  if (id.startsWith('complete:')) return complete(next, id.slice(9));
  if (id.startsWith('learn:')) return learn(next, id.slice(6));
  if (id.startsWith('heal:')) return healAt(next, id.slice(5));
  if (id.startsWith('craft:')) return wagonCraft(next, id.slice(6));
  if (id.startsWith('study:')) return wagonStudy(next, id.slice(6));
  if (id === 'tend') return tend(next);
  if (id === 'help') return help(next);
  // Region 1's camp and land work has no place on the road (#1245).
  if (id !== 'rest' && id !== 'wait' && id in ACTIONS) {
    say(next, `${ACTIONS[id as ActionId].name}: skipped — ${villageOf(next) ? 'Not here: that is camp work, and you are a guest in the village.' : 'Not from the wagon.'}`, 'skip');
    return next;
  }
  if (id.startsWith('appraise:')) return appraise(next, id.slice(9));
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
 * The terms the trader here offers you right now (#1247): the village trader, or on the wagon the
 * caravan's merchant (#1355). Null when no one here is trading.
 */
export function tradeTerms(s: RoadState): (Terms & { trader: string; name: string; sells: readonly string[] }) | null {
  const trader = traderAmong(peopleHere(s));
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
  exerciseStats(next, { cha: TRADE_HOURS }); // haggling, too (#1257)
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
  if (learnt) { next.known.push(learnt); next.discovery[learnt] = 'quest'; }
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
    next.skills = practise(next.skills, 'scouting', creditedPractice(next, 'scouting', n.hours, guidanceOn(next, 'scouting'))).practice;
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

// ── Hands and mind free (#1245) ─────────────────────────────────────────────

/** A craft on the road takes this long — slow, lap work on a moving wagon — and practises its skill for as long. */
export const WAGON_CRAFT_HOURS = 4;
/** Helping drive and pitch camp: hours, how hard on the body, and the cook's thanks. */
export const HELP_HOURS = 4, HELP_VIGOR_RATE = -3, HELP_FOOD = 1;
/** Mending gear takes this long. */
export const TEND_HOURS = 2;
/** Insight a fellow traveller's lore line gives in their concept. */
export const TRAVELLER_INSIGHT = 0.5;

/**
 * Which Region 1 action makes each recipe you can craft on the road: anything that needs
 * no site or shelter (no building, no cold pit). The hide parka is cold gear made of hide.
 */
export const ROAD_CRAFTS: Readonly<Record<string, QueueItem>> = {
  ...Object.fromEntries((Object.keys(ACTIONS) as ActionId[])
    .filter(id => ACTIONS[id].recipe && id !== 'coldPit')
    .map(id => [ACTIONS[id].recipe!.id, id])),
  'cold-gear': 'coldGear',
  'hide-parka': { q: 'coldGear', opts: { material: 'hide' } },
};

/** A clean Region 1 state, made once: the shape a road craft or study borrows (#1245). */
let blank: Region1State | null = null;

/**
 * The Warden on the road in Region 1's shape, so a craft or a study runs through exactly
 * Region 1's rules — the same grades, costs and insight. Camp, land and weather are a fair
 * daytime with nothing in the way (the wagon is neither a camp nor the land).
 */
function regionView(r: RoadState): Region1State {
  blank ??= createRegion1({}, undefined, { id: 'road-view' });
  return {
    ...blank,
    day: 1, hoursToday: r.hoursToday, weatherToday: 'clear', forecast: {},
    vitals: { vigor: { ...r.vitals.vigor }, clarity: { ...r.vitals.clarity }, condition: r.vitals.condition },
    stores: { ...r.stores }, tools: [...r.tools], concepts: { ...r.concepts }, today: { ...r.today }, deprivation: { ...r.deprivation },
    character: r.character, focus: r.focus, skills: { ...r.skills }, techniques: [...r.techniques], manuals: [...r.manuals],
    known: [...r.known], studiedToday: { ...r.studiedToday }, strain: r.strain,
    explore: scout(createExploration(), 1), log: [],
  };
}

/** Take back what a borrowed Region 1 action changed, and its journal lines. */
function fromView(next: RoadState, v: Region1State): void {
  next.vitals = v.vitals;
  next.stores = { ...v.stores };
  next.tools = v.tools;
  next.concepts = v.concepts;
  next.today = v.today;
  next.studiedToday = v.studiedToday;
  next.known = v.known;
  for (const l of v.log) next.log.push({ day: next.day, text: l.text, kind: l.kind });
}

/** Craft a known recipe on the road (#1245): Region 1's craft, four hours of lap work, practice to match. */
function wagonCraft(next: RoadState, recipe: string): RoadState {
  const item = ROAD_CRAFTS[recipe];
  if (!item) { say(next, `Craft: skipped — ${recipe.replace(/-/g, ' ')} can't be made on the road.`, 'skip'); return next; }
  if (!next.known.includes(recipe)) { say(next, `Craft: skipped — you don't know how to make ${recipe.replace(/-/g, ' ')} yet.`, 'skip'); return next; }
  const view = regionView(next);
  const id = (typeof item === 'string' ? item : item.q) as ActionId;
  const why = blockedReason(view, id, 1, typeof item === 'string' ? {} : item.opts);
  if (why) { say(next, `Craft: skipped — ${why}.`, 'skip'); return next; }
  const skills = next.skills;
  fromView(next, runAction(view, item));
  // The road sets the hours and the practice: four hours on the wagon, credited as Region 1 credits work.
  next.skills = skills;
  const skill = skillFor(id, recipe);
  if (skill) next.skills = practise(skills, skill, creditedPractice(next, skill, WAGON_CRAFT_HOURS, guidanceOn(next, skill))).practice;
  next.hoursToday += WAGON_CRAFT_HOURS;
  return next;
}

/** Study a concept on the road (#1245), exactly as in Region 1. */
function wagonStudy(next: RoadState, concept: string): RoadState {
  const view = regionView(next);
  const opts = { concept };
  const why = blockedReason(view, 'study', 1, opts);
  if (why) { say(next, `Study: skipped — ${why}.`, 'skip'); return next; }
  const after = runAction(view, { q: 'study', opts });
  fromView(next, after);
  next.hoursToday += after.hoursToday - view.hoursToday;
  return next;
}

/** Mend gear (#1245): a tool worn below the grade it was made at goes back up one. */
function tend(next: RoadState): RoadState {
  const at = next.tools.findIndex(t => t.crafted && GRADES.indexOf(t.grade) < GRADES.indexOf(t.crafted));
  if (at < 0) { say(next, 'Tend: skipped — nothing needs mending.', 'skip'); return next; }
  const t = next.tools[at];
  const grade = GRADES[GRADES.indexOf(t.grade) + 1];
  next.tools[at] = { ...t, grade };
  work(next, TEND_HOURS, -0.5, -1);
  say(next, `Mended the ${t.item.replace(/-/g, ' ')} — ${grade} again.`, 'action');
  return next;
}

/** Help drive and pitch camp (#1245): hard on the body, and the cook sees you right. Only on the wagon. */
function help(next: RoadState): RoadState {
  if (villageOf(next)) { say(next, 'Help: skipped — the caravan is resting in the village; there is nothing to drive or pitch.', 'skip'); return next; }
  work(next, HELP_HOURS, HELP_VIGOR_RATE, 0);
  next.stores.rawFood += HELP_FOOD;
  say(next, 'You help drive the oxen and pitch camp at dusk. The cook slips you an extra portion.', 'action');
  // Working off the ride (#1355): each help pays a day of what you promised Bodil.
  if (next.owesHelp) {
    next.owesHelp -= 1;
    say(next, next.owesHelp ? `That's a day of your passage worked off; ${next.owesHelp} to go before Hollowford.` : 'Your passage is worked off. Bodil nods to you at supper.', 'action');
  }
  return next;
}

// ── Teachers (#1249) ────────────────────────────────────────────────────────

/** What a healer's care costs you now (#1394): free for a friend. */
export const healFee = (s: RoadState, hid: string): number => ((s.trust[hid] ?? 0) >= FRIEND_HEAL ? 0 : HEAL_FEE);

/**
 * A healer's care (#1394): an hour with Ottilia on the wagon or the village's healer. They tend your
 * worst untreated injury (well — a treated injury heals faster), heal two points of it at once, and —
 * if they trust you 60+ — set a grave one properly, so it heals without leaving its mark. Free for a
 * friend (trust 40+), else marks. With nothing to tend, they tell you about an old harm, if you have one.
 */
function healAt(next: RoadState, hid: string): RoadState {
  const healer = peopleHere(next).find(p => p.id === hid && p.role === 'healer');
  if (!healer) { say(next, `Heal: skipped — there's no healer called ${hid} here.`, 'skip'); return next; }
  const trust = next.trust[hid] ?? 0;
  const target = healerTarget(next.injuries, trust);
  if (!target) {
    const harm = next.character.harms?.[0];
    if (harm) say(next, `${healer.name} looks at your ${HARM_NAME[harm].replace(/^an? /, '')}: "${HARM_LORE[harm]}"`, 'action');
    else say(next, `Heal: skipped — ${healer.name} finds nothing that needs her${next.injuries?.length ? ' — your injuries are already tended' : ''}.`, 'skip');
    return next;
  }
  const fee = healFee(next, hid);
  if (next.marks < fee) { say(next, `Heal: skipped — ${healer.name} asks ${fee} marks for her care; you have ${next.marks}.`, 'skip'); return next; }
  next.marks -= fee;
  work(next, HEAL_HOURS, 0, -1);
  const cared = healerCare(target, trust);
  next.injuries = next.injuries!.map(i => (i === target ? cared : i));
  const set = cared.mended && !target.mended;
  say(next, `${healer.name} tends your ${INJURY_NAME[target.kind]}${set ? ' and sets it properly — it will heal straight' : ''}.${fee ? ` (${fee} marks)` : ' — no charge between friends'}`, 'milestone');
  return next;
}

/** A teacher in the village you're in, by id, or null. */
const teacherHere = (s: RoadState, tid: string): (Person & { teaches: NonNullable<Person['teaches']> }) | null => {
  const p = peopleOf(villageOf(s)).find(x => x.id === tid);
  return p?.teaches ? (p as Person & { teaches: NonNullable<Person['teaches']> }) : null;
};

/** Apprenticing: practice in a skill is fully guided while one of its teachers is in the village; else a manual you carry helps. */
export const guidanceOn = (s: RoadState, skill: SkillId): Guidance =>
  peopleOf(villageOf(s)).some(p => p.teaches?.skill === skill) ? 'teacher' : s.manuals.some(m => manualById(m)?.skill === skill) ? 'manual' : 'none';

/** What a lesson with this teacher costs you now: free for a friend. */
export const lessonFee = (s: RoadState, tid: string): number => ((s.trust[tid] ?? 0) >= FRIEND_LESSON ? 0 : LESSON_FEE);

/**
 * A lesson (#1249): a technique (within TEACH_REACH of your true level), a recipe, or a concept.
 * Four hours, and the fee unless the teacher counts you a friend. A rejection costs no hours.
 */
function learn(next: RoadState, spec: string): RoadState {
  const [tid, thing] = spec.split(':');
  const teacher = teacherHere(next, tid);
  if (!teacher) { say(next, `Learn: skipped — no one called ${tid} teaches here.`, 'skip'); return next; }
  const t = teacher.teaches;
  const tech = t.techniques.includes(thing) ? techniqueById(thing) : undefined;
  const recipe = t.recipes.includes(thing) ? thing : null;
  const concept = t.concept === thing ? thing : null;
  if (!tech && !recipe && !concept) { say(next, `Learn: skipped — ${teacher.name} doesn't teach ${thing}.`, 'skip'); return next; }
  if ((tech && next.techniques.includes(tech.id)) || (recipe && next.known.includes(recipe))) { say(next, `Learn: skipped — you already know ${thing}.`, 'skip'); return next; }
  // A concept already at its own full rank (#1469: sealing and leverage stop at 2) has nothing left to teach — don't take the fee.
  if (concept && (next.concepts[concept]?.rank ?? 0) >= (CRAFT_WORLD.concepts[concept]?.ranks ?? 3)) { say(next, `Learn: skipped — you already understand ${concept} as far as it goes.`, 'skip'); return next; }
  if (tech && !canBeTaught(tech, skillLevel(next.skills, tech.skill))) {
    say(next, `${teacher.name} shakes their head at ${tech.name.toLowerCase()}: "Come back when you can follow it."`, 'skip');
    return next;
  }
  const fee = lessonFee(next, tid);
  if (next.marks < fee) { say(next, `Learn: skipped — ${teacher.name}'s lesson costs ${fee} marks; you have ${next.marks}.`, 'skip'); return next; }
  next.marks -= fee;
  work(next, LESSON_HOURS, -1, -3);
  const paid = fee ? ` (${fee} marks)` : ' — no charge between friends';
  if (tech) {
    next.techniques.push(tech.id);
    say(next, `Taught by ${teacher.name}: ${tech.name.toLowerCase()} — ${tech.how}.${paid}`, 'milestone');
  } else if (recipe) {
    next.known.push(recipe);
    next.discovery[recipe] = 'taught';
    say(next, `${teacher.name} shows you how to make the ${recipe}.${paid}`, 'milestone');
  } else if (concept) {
    addInsight(next.concepts, concept, LESSON_INSIGHT, CRAFT_WORLD.concepts);
    say(next, `${teacher.name} talks you through ${concept} — it makes more sense now.${paid}`, 'milestone');
  }
  return next;
}

/** The talent a teacher of each skill would recognise in you (#1262). */
const TALENT_FIELD: Partial<Record<SkillId, TalentId>> = { hunting: 'hunter', foraging: 'forager', scouting: 'keenEye', fieldcraft: 'waterfinder' };

/**
 * Honest appraisal (#1249): the one person who'll tell you your true level in their skill —
 * whatever you think it is (#1241). Once per teacher per village. A teacher of the field also
 * recognises a talent you didn't know you had (#1262).
 */
function appraise(next: RoadState, tid: string): RoadState {
  const teacher = teacherHere(next, tid);
  if (!teacher) { say(next, `Appraise: skipped — no one called ${tid} teaches here.`, 'skip'); return next; }
  if (next.appraised.includes(tid)) { say(next, `Appraise: skipped — ${teacher.name} has already told you what they think.`, 'skip'); return next; }
  next.appraised.push(tid);
  work(next, APPRAISE_HOURS, 0, -1);
  const skill = teacher.teaches.skill;
  const trueLvl = skillLevel(next.skills, skill), thinks = perceivedLevel(next.skills, skill);
  const name = SKILLS[skill].name.toLowerCase();
  const verdict = trueLvl === thinks
    ? `You're ${article(LEVELS[trueLvl])} ${LEVELS[trueLvl]} at ${name} — and you know it.`
    : `You're ${article(LEVELS[trueLvl])} ${LEVELS[trueLvl]} at ${name}, whatever you think.`;
  say(next, `${teacher.name} watches you work a while. "${verdict}"`, 'milestone');
  const field = TALENT_FIELD[skill];
  const hidden = field ? next.character.talents.find(x => x.id === field && !x.known) : undefined;
  if (hidden) {
    hidden.known = true;
    say(next, `${teacher.name}: "You have ${article(TALENTS[hidden.id].name)} ${TALENTS[hidden.id].name.toLowerCase()}. Has no one ever told you?"`, 'milestone');
  }
  return next;
}

const article = (word: string): string => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * End the day: a night as in Region 1 (the caravan's barrels water you on
 * travel days; in a village you fend for yourself), then the caravan moves
 * along its route — into a village, out of one at the end of the stay, or
 * through Mistheim's gates.
 */
export function endRoadDay(s: RoadState): RoadState {
  if (s.outcome || s.pending) return s;
  const next = clone(s);
  const leg = legOf(next);
  const nightOpts = {
    warmth: ROAD_WARMTH[leg.kind],
    coldNight: false,
    lockedToday: roadLockOf(next) !== null,
    providedWater: leg.kind === 'travel',
  };
  // The same night without the hidden talent (#1265): did it make a difference?
  const withoutGift = hasHidden(next.character.talents) ? clone(hiddenless(next)) : null;
  const night = sleepNight(next, nightOpts);
  if (withoutGift && !night.ended) { const other = sleepNight(withoutGift, nightOpts); noticeHidden(next, differenceOf(next, withoutGift, !!other.ended)); }
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
  if (next.legDay <= leg.days) return dawn(next);

  // This leg is done: the caravan moves on, on schedule.
  if (leg.kind === 'village') {
    expireQuests(next, leg.id);
    leaveVillage(next, leg.id);
    next.appraised = [];
    say(next, `The caravan rolls out at dawn, leaving ${leg.name} behind.`, 'milestone');
  }
  if (next.leg === ROUTE.length - 1) {
    next.legDay = leg.days;
    next.outcome = { kind: 'arrived', vitals: next.vitals };
    say(next, MISTHEIM_ARRIVAL, 'outcome');
    return next;
  }
  next.leg += 1;
  next.legDay = 1;
  const now = legOf(next);
  if (now.kind === 'village') {
    // Help promised for the ride and never given (#1355): Bodil remembers.
    if (next.owesHelp) {
      next.trust['cv-bodil'] = Math.max(0, (next.trust['cv-bodil'] ?? 0) - UNPAID_HELP_TRUST);
      say(next, `Bodil hasn't forgotten the ${next.owesHelp} day${next.owesHelp === 1 ? '' : 's'} of help you promised and never gave. She doesn't say a word about it, which is worse.`, 'hardship');
      next.owesHelp = 0;
    }
    openVillage(next, now.id);
    say(next, `The caravan reaches ${now.name}. It stays ${now.days} days.`, 'milestone');
    arriveWithDeliveries(next, now.id);
  }
  return dawn(next);
}

// ── Road encounters (#1349) ─────────────────────────────────────────────────

/** Chance of an encounter on a road day, from the wagon or in a village. At most one a day. */
export const ROAD_ENCOUNTER_CHANCE: Readonly<Record<Leg['kind'], number>> = { travel: 0.3, village: 0.12 };

/** Does an encounter meet you today on the road? A seeded roll for the day, then a seeded, weighted pick. */
export function roadEncounterFor(seed: number, day: number, where: Leg['kind']): EncounterTemplate | null {
  const roll = streamFor(seed, day, 'road-encounter');
  if (roll() >= ROAD_ENCOUNTER_CHANCE[where]) return null;
  const fits = ENCOUNTERS.filter(e => e.road === 'any' || e.road === (where === 'travel' ? 'wagon' : 'village'));
  const total = fits.reduce((n, e) => n + e.weight, 0);
  let pick = roll() * total;
  for (const e of fits) { pick -= e.weight; if (pick < 0) return e; }
  return null;
}

/** A new road day dawns (#1349): perhaps something meets you, and the day waits for your choice. */
function dawn(next: RoadState): RoadState {
  if (!next.encounters || next.outcome) return next;
  const t = roadEncounterFor(seedOf(next.character.id), next.day, legOf(next).kind);
  if (!t) return next;
  next.pending = { id: t.id, day: next.day, hour: 8, ring: 1, action: 'road', state: 'calm', perceived: t.threat, margin: 0 };
  say(next, t.text, 'hardship');
  return next;
}

/**
 * Choose in a road encounter (#1349): pay its cost, roll its seeded outcome, and apply it — to the
 * body, the stores, your marks and the trust of the caravan's people. A lost fight can kill.
 */
export function chooseRoadOption(s: RoadState, optionId: string): RoadState {
  if (!s.pending) return s;
  const p = s.pending;
  const t = encounterById(p.id);
  const o = t ? stepOf(t, p.step).options.find(x => x.id === optionId) : undefined;
  const next = clone(s);
  if (!t || !o) { say(next, `Choice: skipped — there's no "${optionId}" here.`, 'skip'); return next; }
  const why = encounterUnmet(next, o);
  if (why) { say(next, `${o.label}: skipped — ${why}.`, 'skip'); return next; }
  for (const [k, n] of Object.entries(o.cost?.stores ?? {})) next.stores[k as keyof RoadState['stores']] -= n ?? 0;
  next.marks -= o.cost?.marks ?? 0;
  const { tier, effect } = rollOutcome(seedOf(next.character.id), p, o, chanceOf(next, o));
  const v = next.vitals;
  const pool = (q: Vitals['vigor'], d = 0): Vitals['vigor'] => ({ ...q, current: Math.max(0, Math.min(q.cap, q.current + d)) });
  next.vitals = { vigor: pool(v.vigor, effect.vigor), clarity: pool(v.clarity, effect.clarity), condition: Math.max(0, Math.min(100, v.condition + (effect.condition ?? 0) - (effect.wound ?? 0))) };
  for (const [k, n] of Object.entries(effect.stores ?? {})) next.stores[k as keyof RoadState['stores']] = Math.max(0, next.stores[k as keyof RoadState['stores']] + (n ?? 0));
  next.marks = Math.max(0, next.marks + (effect.marks ?? 0));
  for (const [pid, d] of Object.entries(effect.trust ?? {})) bump(next, pid, d);
  if (effect.practice) next.skills = practise(next.skills, effect.practice.skill, effect.practice.hours).practice;
  next.hoursToday += (o.cost?.hours ?? 0) + (effect.hours ?? 0);
  next.pending = null;
  say(next, `${o.label}: ${effect.text}`, tier === 'fail' ? 'hardship' : 'action');
  if (next.vitals.condition <= 0) {
    next.outcome = { kind: 'died', vitals: next.vitals };
    say(next, `Killed by ${effect.killedBy ?? 'what met you on the road'}.`, 'outcome');
  }
  return next;
}

/** Run a queue for today (until the hours run out), then end the day. Returns the unrun remainder. */
export function runRoadDay(s: RoadState, queue: readonly RoadActionId[]): { state: RoadState; remaining: RoadActionId[] } {
  // An encounter waiting (#1349): the day can't start until it's answered.
  if (s.outcome || s.pending) return { state: s, remaining: [...queue] };
  let state = s;
  const remaining = [...queue];
  while (remaining.length > 0 && state.hoursToday < DAY_HOURS) state = runRoadAction(state, remaining.shift() as RoadActionId);
  return { state: endRoadDay(state), remaining };
}
