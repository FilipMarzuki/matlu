/**
 * The AI play loop (#1226): observe → decide → apply → repeat, one decision
 * per game day, until the thaw — or until the Warden's body gives out (#1302).
 *
 * Pure apart from awaiting the player, so it runs the same with a real model,
 * a scripted bot or a test double. Every decision goes through
 * `parseDecision`, whoever made it.
 */

import { SUGGESTED_PACK, type KitId } from '../artificer/kit';
import { DEFAULT_AGE } from '../artificer/growing';
import { validStats, type Stats } from '../artificer/stats';
import { scouted } from '../artificer/exploration';
import { setFocus, setEating, forgetPin, setInterest, createRegion1, repack, chooseSite, chooseOption, SPOOK_LINE, runDay, runAction, DAY_HOURS, queueHours, type Region1State, parseItem, type QueueItem, type SiteId } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { encounterById, optionsFor, safestOption, chanceOf, oddsWord, stepOf, type EncounterKind, type OddsWord } from '../artificer/encounters';
import { QUIRKS, isFear, type Quirk } from '../artificer/quirks';
import type { PanicState } from '../artificer/panic';
import type { Calendar } from '../artificer/winter';
import { summarizeRun, summarizeRoad, type Legacy, type RunRecord } from '../artificer/legacy';
import { createRoad, runRoadDay, chooseRoadOption, ROAD_DAYS, type RoadActionId, type RoadState } from '../artificer/road';
import { observe, observeRoad, observeEncounter, observeMeeting, observePack, ROAD_RULES } from './observe';
import { openMeeting, meetingOptions, safestMeetingOption, chooseInMeeting, boardingOf, type Boarding, type Fare, type Meeting, type MeetingStepId } from '../artificer/caravan-meeting';
import { parseFocus } from '../artificer/focus';
import { talentOffer, seedOf, chooseFromOffer, giftLine, type TalentId } from '../artificer/talents';
import { progressOf, roadProgressOf, type Progress, type RoadProgress } from './progress';
import { invariantViolations, roadInvariantViolations } from './invariants';
import { parseDecision, parseRoadDecision, parseEncounterDecision, parsePackDecision, type Decision, type ParseResult } from './decision';
import { maxInterest, type Pin, type PinKind } from '../artificer/pins';

/** Token usage a model player reports per call (all optional; summed per run). */
export interface Usage {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  /** Actual billed USD, summed over the run's calls; null when the player doesn't report it (#1231). */
  cost: number | null;
}

/**
 * Anything that can play: given the next user message (an observation, or a
 * correction after an invalid reply) and the live state, return reply text.
 * Model players keep their own conversation history between calls.
 */
export interface Player {
  name: string;
  decide(message: string, state: Region1State): Promise<{ text: string; usage?: Partial<Usage> }>;
  /**
   * Decide a day on the caravan road (#1251), replying `{thoughts, actions}`. Optional:
   * a player without it ends the run at the thaw, as before the road existed.
   */
  decideRoad?(message: string, state: RoadState): Promise<{ text: string; usage?: Partial<Usage> }>;
  /**
   * Choose in an encounter that paused the day (#1348), replying `{thoughts, choice}`. Optional:
   * a player without it always takes the safest option.
   */
  decideEncounter?(message: string, state: Region1State): Promise<{ text: string; usage?: Partial<Usage> }>;
  /**
   * Answer the caravan master at the thaw (#1357), replying `{thoughts, choice}` like an encounter.
   * Optional: without it, `decideEncounter` answers (a model reads the message either way);
   * without either, the safest option is taken.
   */
  decideMeeting?(message: string, reach: Region1State, meeting: Meeting): Promise<{ text: string; usage?: Partial<Usage> }>;
  /**
   * Pack for the weekend hike before the run (#1401), replying `{thoughts, pack}`. Optional:
   * without it, the Warden takes the leader's packing list (or what they packed last time).
   */
  decidePack?(message: string, state: Region1State): Promise<{ text: string; usage?: Partial<Usage> }>;
}

/** What a player packed (#1401): the pack, why, and — if two replies wouldn't do — that the last pack was kept instead. */
export interface PackRecord { pack: KitId[]; thoughts: string; forced?: true; errors?: string[] }

/** What fear did in a turn (#1365): spooks on the land, fearful nights, and fears gained or faded. */
export interface TurnFright { spooks: number; uneasyNights: number; sleeplessNights: number; fearsGained: string[]; fearsLost: string[] }

/** The turn's frights, read from its journal and the quirks it began and ended with; null when nothing frightened. */
export function frightOfTurn(journal: readonly string[], before: readonly Quirk[], after: readonly Quirk[]): TurnFright | null {
  const spookLines = Object.values(SPOOK_LINE) as string[];
  const fears = (qs: readonly Quirk[]) => qs.filter(q => isFear(q.id)).map(q => q.id);
  const f: TurnFright = {
    spooks: journal.filter(l => spookLines.includes(l)).length,
    uneasyNights: journal.filter(l => l.startsWith('You lie awake a long time')).length,
    sleeplessNights: journal.filter(l => l.startsWith('A sleepless night')).length,
    fearsGained: fears(after).filter(id => !fears(before).includes(id)),
    fearsLost: fears(before).filter(id => !fears(after).includes(id)),
  };
  return f.spooks || f.uneasyNights || f.sleeplessNights || f.fearsGained.length || f.fearsLost.length ? f : null;
}

/** Places remembered and let go in a turn, and what's held at its end, by kind (#1381). */
export interface TurnPins { made: PinKind[]; forgotten: PinKind[]; held: PinKind[] }

/** The turn's pins, from those it began and ended with; null when none were made or let go. */
export function pinsOfTurn(before: readonly Pin[], after: readonly Pin[]): TurnPins | null {
  const made = after.filter(p => !before.some(b => b.id === p.id)).map(p => p.kind);
  const forgotten = before.filter(p => !after.some(a => a.id === p.id)).map(p => p.kind);
  return made.length || forgotten.length ? { made, forgotten, held: after.map(p => p.kind) } : null;
}

/**
 * What's wrong with a reply's pin orders against this state (#1381): a place you don't remember,
 * or stars your Memory can't give yet. Each comes back as an error the model can be shown.
 */
export function pinOrderErrors(s: Region1State, d: Decision): string[] {
  const held = s.pins ?? [];
  const list = held.length ? `you remember: ${held.map(p => p.id).join(', ')}` : 'you remember no places';
  const errors: string[] = [];
  if (d.forget && !held.some(p => p.id === d.forget)) errors.push(`forget: you don't remember "${d.forget}" — ${list}`);
  const top = maxInterest(s.skills);
  for (const x of d.interest ?? []) {
    if (!held.some(p => p.id === x.pin) || x.pin === d.forget) errors.push(`interest: you don't remember "${x.pin}" — ${list}`);
    else if (x.stars > top) errors.push(top ? `interest: your Memory can weigh places up to ${top} stars, not ${x.stars}` : "interest: your Memory isn't good enough to weigh places yet (it comes at Apprentice) — leave interest empty");
  }
  return errors;
}

/** A day reply, parsed and checked against the state (its pin orders, #1381). */
function decideFor(s: Region1State, text: string): ParseResult {
  const p = parseDecision(text);
  if (!p.ok) return p;
  const errors = pinOrderErrors(s, p.decision);
  return errors.length ? { ok: false, errors } : p;
}

/** Carry out a reply's pin orders (#1381): let a place go, then weigh the rest. */
export function applyPinOrders(s: Region1State, d: Decision): Region1State {
  let next = d.forget ? forgetPin(s, d.forget) : s;
  for (const x of d.interest ?? []) next = setInterest(next, x.pin, x.stars);
  return next;
}

/**
 * What an answered encounter looked like (#1348, #1365): the choice and its odds as seen, how you
 * stood (calm, shaken, panicked), whether your body overrode you — what you chose and what it
 * took instead (`freeze` for freezing) — and any quirk revealed or fear gained.
 */
export function encounterRecord(before: Region1State, after: Region1State, chosenId: string): EncounterChoice {
  const p = before.pending!;
  const t = encounterById(p.id)!;
  const options = stepOf(t, p.step).options;
  const chosen = options.find(o => o.id === chosenId)!;
  const lines = after.log.slice(before.log.length).map(l => l.text);
  const overridden = lines.some(l => l.startsWith('You meant to'));
  const taken = overridden ? (lines.includes(t.freeze.text) ? 'freeze' : options.find(o => o.id !== chosenId && lines.some(l => l.startsWith(`${o.label}: `)))?.id ?? 'freeze') : chosenId;
  const knownIds = (s: Region1State) => (s.character.quirks ?? []).filter(q => q.known && !isFear(q.id)).map(q => q.id);
  const fearIds = (s: Region1State) => (s.character.quirks ?? []).filter(q => isFear(q.id)).map(q => q.id);
  const revealed = knownIds(after).filter(id => !knownIds(before).includes(id));
  const fearsGained = fearIds(after).filter(id => !fearIds(before).includes(id));
  return {
    id: p.id, kind: t.kind, choice: chosenId, odds: oddsWord(chanceOf(before, chosen)), result: lines.join(' '),
    state: p.state ?? 'calm',
    ...(overridden ? { override: { chosen: chosenId, taken } } : {}),
    ...(revealed.length ? { revealed } : {}),
    ...(fearsGained.length ? { fearsGained } : {}),
    ...(after.outcome?.kind === 'died' ? { died: true } : {}),
  };
}

/** One encounter met during a turn (#1348), and what came of it. */
export interface EncounterChoice {
  id: string;
  kind: EncounterKind;
  choice: string;
  /** The odds of the chosen option, in words, as the player saw them. */
  odds: OddsWord;
  /** What happened, from the journal. */
  result: string;
  /** The choice killed the Warden. */
  died?: boolean;
  /** How you stood when it opened (#1365). */
  state?: PanicState;
  /** Panic took over (#1365): what you chose, and what your body did instead (`freeze` for freezing). */
  override?: { chosen: string; taken: string };
  /** Quirks this encounter revealed, and fears it left (#1365). */
  revealed?: string[];
  fearsGained?: string[];
  /** No valid choice came back (twice, or the player can't choose), so the safest was taken. */
  forced?: boolean;
  /** For a forced choice: the last raw reply and what was wrong with it. */
  reply?: string;
  errors?: string[];
}

/** One road day (#1251). */
export interface RoadTurn {
  day: number;
  thoughts: string;
  actions: RoadActionId[];
  invalid: boolean;
  /** A road encounter met at the day's dawn and how it was answered (#1349). */
  encounters?: EncounterChoice[];
  reply?: string;
  errors?: string[];
  violations?: string[];
  progress: RoadProgress;
  journal: string[];
}

/** One answer in the caravan meeting (#1357): the step, the option taken, and how it went. */
export interface MeetingTurn {
  step: MeetingStepId;
  choice: string;
  success: boolean;
  /** No valid answer came back twice (or the player can't answer): the safest option was taken. */
  forced?: true;
  reply?: string;
  errors?: string[];
}

/** The caravan meeting as played (#1357): each answer, where it ended, and how the ride was paid. */
export interface MeetingRecord { steps: MeetingTurn[]; ended: 'board' | 'stay'; fare: Fare | null; owesHelp: number }

/**
 * Play the caravan meeting (#1357): each step shown like an encounter and answered through `ask`
 * (null: the player can't answer). An invalid answer is explained back once; after that the
 * safest option is taken, and the step is marked forced. Returns the record, and what boards.
 */
export async function playMeeting(reach: Region1State, ask: ((message: string, m: Meeting) => Promise<string>) | null): Promise<{ record: MeetingRecord; boarding: Boarding | null }> {
  let m = openMeeting(reach);
  const steps: MeetingTurn[] = [];
  let notes: string[] = [];
  // A meeting is a few steps at most; a loop that doesn't end is a bug.
  for (let i = 0; i < 6 && !m.ended; i++) {
    const offered = meetingOptions(reach, m).map(o => ({ id: o.option.id, unmet: o.unmet }));
    let choice: string | null = null, reply = '', errors: string[] | undefined;
    if (ask) {
      reply = await ask(observeMeeting(reach, m, notes), m);
      let e = parseEncounterDecision(reply, offered);
      if (!e.ok) {
        reply = await ask(`Your choice was invalid:\n- ${e.errors.join('\n- ')}\nReply again with only the JSON object {"thoughts", "choice"}.`, m);
        e = parseEncounterDecision(reply, offered);
      }
      if (e.ok) choice = e.decision.choice; else errors = e.errors;
    }
    notes = [];
    const forced = choice === null;
    const step = m.step;
    const option = forced ? safestMeetingOption(reach, m).id : choice!;
    if (forced && ask) notes.push(`You never gave a valid answer, so you took the safest: ${option}.`);
    m = chooseInMeeting(reach, m, option);
    steps.push({ step, choice: option, success: m.last?.success ?? true, ...(forced ? { forced: true as const, ...(ask ? { reply, errors } : {}) } : {}) });
  }
  if (!m.ended) throw new Error('the caravan meeting did not end — it should in a few steps');
  return { record: { steps, ended: m.ended, fare: m.fare, owesHelp: m.owesHelp }, boarding: boardingOf(m) };
}

/** The road part of a run that rode on (#1251). */
export interface RoadResult {
  turns: RoadTurn[];
  start: RoadProgress;
  /** The run's record, with the road's ending (`arrived`, `died`, `collapsed`). */
  record: RunRecord;
  final: RoadState;
}

export interface Turn {
  day: number;
  thoughts: string;
  site: SiteId | null;
  queue: QueueItem[];
  /** True when the reply stayed invalid after the retry and the day was passed. */
  invalid: boolean;
  /** For an invalid day: the last raw reply and what was wrong with it, for diagnosing a model or prompt. */
  reply?: string;
  errors?: string[];
  /** Sim invariants broken at the end of the turn, if any (should never happen). */
  violations?: string[];
  /** Progression snapshot at the end of the turn (#1229). */
  progress: Progress;
  /** Encounters met this turn and the choices made (#1348). */
  encounters?: EncounterChoice[];
  /** What fear did this turn (#1365): spooks, fearful nights, fears gained or faded. */
  fright?: TurnFright;
  /** Places remembered and let go this turn, and those held at its end, by kind (#1381). */
  pins?: TurnPins;
  /** A short plan asked about (#1473): the hours it filled, and the hours of the plan that then ran. */
  fill?: { planned: number; then: number };
  /** Journal lines this turn produced. */
  journal: string[];
  /** State at the end of the turn, compactly. */
  after: { vigor: number; clarity: number; condition: number; food: number; water: number; firewood: number; materials: number; rations: number; warmth: number };
}

export interface RunResult {
  player: string;
  turns: Turn[];
  record: RunRecord;
  usage: Usage;
  /** Progression at the start of the run, before day 1 (#1229). */
  start: Progress;
  final: Region1State;
  /** The caravan meeting at the thaw, for a run that met it (#1357). */
  meeting?: MeetingRecord;
  /** The caravan road, when the run survived the thaw and was played on (#1251). `record` stays the Reach's. */
  road?: RoadResult;
  /** What was packed for the hike (#1401), for a player that packs. */
  packed?: PackRecord;
  /** The Warden's talents and quirks at the end (#1267): true tiers, signs, and when each hidden one came to light. */
  gifts?: GiftRecord;
  /** The adult stat spread the Warden was made with (#1259) — chosen, or carried from the last run. */
  spread?: Stats;
  /** The budget ran out before or during the caravan road (#1449): the Reach is whole, the road isn't recorded. */
  roadStopped?: 'budget';
}

/** Talents and quirks, for analysis (#1267). True values — the player never sees tiers. */
export interface GiftRecord {
  /**
   * `chosen`: picked at creation. `foundEarlier`: a hidden talent found in an earlier run, so already
   * known when this one began (neither a pick nor still to find). `revealedDay`: the day a hidden one
   * was found this run — on the road, counted on from the thaw like the run record's day.
   */
  talents: { id: TalentId; tier: number; chosen: boolean; foundEarlier: boolean; signs: number; revealedDay: number | null }[];
  quirks: { id: string; known: boolean; revealedDay: number | null }[];
}

/** Who the Warden was at the start of a run, for the gift record: the picks, and hidden talents already found. */
export interface GiftStart { chosen: readonly TalentId[]; foundEarlier: readonly TalentId[] }

/** The start of a run, read off its Warden: a known talent with signs was found (picks never gather signs). */
export const giftStartOf = (s: Pick<Region1State, 'character'>): GiftStart => ({
  chosen: s.character.talents.filter(t => t.known && t.signs === undefined).map(t => t.id),
  foundEarlier: s.character.talents.filter(t => t.known && t.signs !== undefined).map(t => t.id),
});

/**
 * The gifts a run ended with (#1267): each talent's true tier, where it came from, its signs, and the
 * day a hidden one was revealed (from its journal line — in the Reach, or on the road when the run rode
 * on); each quirk (fears aside — they're gained, not born with) and the day it showed itself.
 * `end` is where the run finished: the Reach, or the road (whose days count on from the thaw).
 */
export function giftsOf(reach: Pick<Region1State, 'character' | 'log' | 'day'>, start: GiftStart, road?: Pick<RoadState, 'character' | 'log'>): GiftRecord {
  const end = road ?? reach;
  const dayOf = (text: string | undefined): number | null => {
    if (!text) return null;
    const inReach = reach.log.find(l => l.text === text);
    if (inReach) return inReach.day;
    const onRoad = road?.log.find(l => l.text === text);
    return onRoad ? reach.day + onRoad.day - 1 : null;
  };
  return {
    talents: end.character.talents.map(t => {
      const chosen = start.chosen.includes(t.id), foundEarlier = start.foundEarlier.includes(t.id);
      return { id: t.id, tier: t.tier, chosen, foundEarlier, signs: t.signs ?? 0, revealedDay: chosen || foundEarlier ? null : dayOf(giftLine(t.id)) };
    }),
    quirks: (end.character.quirks ?? []).filter(q => !isFear(q.id)).map(q => ({ id: q.id, known: q.known, revealedDay: dayOf(QUIRKS[q.id]?.revealed) })),
  };
}

export interface PlayOptions {
  legacy?: Legacy;
  /**
   * The Warden's character id (#1267). It seeds the talent offer and the hidden
   * talent, exactly as for a person. Defaults to one made from the player's name;
   * pass the previous run's id to carry on as the same character.
   */
  characterId?: string;
  /** Talents the player wants (#1263) — taken only if both were offered, else the first two offered. */
  talents?: TalentId[];
  /**
   * The stat spread chosen at creation (#1259), as a person would spend their points — must be
   * valid. Default: all 10s. Carrying on, the legacy's stats win and this is ignored.
   */
  stats?: Stats;
  /** The year's calendar — the default 60-day year, or a short one for tests (#1301). */
  calendar?: Calendar;
  /**
   * A safety stop, in days (#1309): the run ends at the thaw anyway (day 61), so this only
   * catches a sim that never resolves — and throws, rather than loop forever. Defaults to the thaw day.
   */
  maxDays?: number;
  /** Called after every turn (for live progress printing). */
  onTurn?: (t: Turn) => void;
  /**
   * A spend ledger (#1449), shared by every run in a batch (and by games played in parallel).
   * Every model call — the Reach, the caravan meeting and the road — adds its cost to `spent`,
   * and no call starts once `spent` has reached `budget`: the run throws {@link BudgetExceeded}
   * with the run so far. Checking before a call, not after, never throws away a paid reply.
   */
  ledger?: SpendLedger;
  /** Whether planning is learned (#1350), as for a person — the default — or open from day 1. */
  planning?: 'learned' | 'open';
  /**
   * Ride on from the thaw (#1251): a run that survives plays the caravan road to Mistheim.
   * Off by default — it adds ~18 calls a run, so the nightly roster opts in when its budget allows.
   */
  road?: boolean;
  onRoadTurn?: (t: RoadTurn) => void;
  /**
   * Meet encounters out on the land (#1348), as people do in the app. On by default, so the
   * playtests stay a fair picture of the game; off gives the world the sim tests use.
   */
  encounters?: boolean;
  /**
   * Ask once about a plan that leaves most of the day idle (#1473). Off by default, so the scripted
   * and random baselines (and the random one's seeded choices) play as before; the scripts turn it
   * on for model players.
   */
  fillDay?: boolean;
}

/** How many single actions a locked day asks for before it ends anyway (#1350). */
const LOCKED_ASKS = 10;

/**
 * A plan filling fewer hours than this is asked about once (#1473). Llama 4 Maverick planned a
 * median 5 of the day's 14 hours and froze around day 30; Haiku planned 12 and was ready for
 * winter. A person sees the empty hour bar before ending the day; a model has to be told.
 */
export const FILL_MIN_HOURS = 8;

/** How a run's short days went (#1473): how many were asked about, and how many the second answer filled. */
export function fillTally(turns: readonly Turn[]): { asked: number; filled: number } {
  const asked = turns.filter(t => t.fill);
  return { asked: asked.length, filled: asked.filter(t => t.fill!.then >= FILL_MIN_HOURS).length };
}

/** Hours a day's plan would fill, rounded: the hours already used plus each action's own (with travel and weather). */
export function plannedHours(s: Region1State, queue: readonly QueueItem[]): number {
  return Math.round(queue.reduce((h, item) => h + queueHours(item, s), s.hoursToday));
}

/**
 * The question for a short plan (#1473), or null when the plan isn't one: it fills under
 * {@link FILL_MIN_HOURS}, has no rest in it (a light day on purpose), and the Warden has at least
 * half their Vigor to spend (under that, a short day is sense, not waste). The model can fill the
 * day or send the same plan again.
 */
export function fillQuestion(s: Region1State, queue: readonly QueueItem[], day: number): string | null {
  const planned = plannedHours(s, queue);
  const v = s.vitals.vigor, c = s.vitals.clarity;
  if (planned >= FILL_MIN_HOURS || v.current < v.cap / 2 || queue.some(item => parseItem(item).id === 'rest')) return null;
  return `Your plan for day ${day} fills about ${planned} of the ${DAY_HOURS} waking hours, leaving ${DAY_HOURS - planned} idle — hours you don't plan are simply lost. You have Vigor ${Math.round(v.current)}/${Math.round(v.cap)} and Clarity ${Math.round(c.current)}/${Math.round(c.cap)}. Add actions to use the day (READINESS and the WINTER OUTLOOK show what's short), or send the same plan again if a short day is what you want. Reply with only the JSON object for day ${day}.`;
}

function snapshot(s: Region1State, warmthOf: (s: Region1State) => number): Turn['after'] {
  return {
    vigor: Math.round(s.vitals.vigor.current), clarity: Math.round(s.vitals.clarity.current), condition: Math.round(s.vitals.condition),
    food: s.stores.rawFood, water: s.stores.water, firewood: s.stores.firewood, materials: s.stores.materials, rations: s.stores.rations,
    warmth: Math.round(warmthOf(s) * 100) / 100,
  };
}

/** What a batch has spent, and may spend (USD), across all its runs (#1449). */
export interface SpendLedger { spent: number; budget: number }

/** A run stopped because it reached its budget (#1449). `partial` is the run so far, record kind "stopped". */
export class BudgetExceeded extends Error {
  constructor(readonly partial: Pick<RunResult, 'player' | 'turns' | 'usage' | 'start'> & { record: { kind: 'stopped'; choice: 'budget'; day: number; readyDay: null } }) {
    super(`budget reached ($${(partial.usage.cost ?? 0).toFixed(3)}) on day ${partial.record.day}`);
    this.name = 'BudgetExceeded';
  }
}

/** A stable character id for an AI player: the same name gives the same Warden (and the same talents). */
export const aiCharacterId = (name: string, salt = ''): string => `ai-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${salt ? `-${salt}` : ''}`;

/** Play one Region 1 run with `player`. */
export async function playRun(player: Player, opts: PlayOptions = {}): Promise<RunResult> {
  const { warmth } = await import('../artificer/region1');
  // AI players play exactly like people (#1267): a character id, two talents from the seeded
  // offer, and a hidden one. (Carrying on, the legacy's talents win and the pick is ignored.) Like a
  // person's Warden, a scout (#1398), 12 years old (#1399), with the leader's packing list (#1400).
  const id = opts.characterId ?? aiCharacterId(player.name);
  const chosen = chooseFromOffer(talentOffer(seedOf(id)), opts.talents ?? []);
  // A spread a person couldn't pick never reaches the sim (#1259). A legacy's own stats win over it;
  // a legacy of heirlooms alone (#1455) has none, so the spread still applies.
  const spreadApplies = !!opts.stats && !opts.legacy?.stats;
  if (spreadApplies && !validStats(opts.stats!)) throw new Error(`invalid stat spread: ${JSON.stringify(opts.stats)}`);
  let s = createRegion1({ ...(opts.calendar ? { calendar: opts.calendar } : {}), planning: opts.planning ?? 'learned', world: { ...FULL_WORLD, encounters: opts.encounters ?? true } }, opts.legacy, { id, name: player.name, chosen, background: 'scout', age: DEFAULT_AGE, ...(spreadApplies ? { stats: { ...opts.stats! } } : {}), ...(opts.legacy?.pack ? {} : { pack: [...SUGGESTED_PACK] }) });
  const spread: Stats = { ...(s.character.adult ?? s.character.stats) };
  const startKnown = s.known.length;
  const start = progressOf(s, startKnown);
  // Who the Warden was at the start, for the gift record (#1267): the picks, and hidden talents already found.
  const giftStart = giftStartOf(s);
  const turns: Turn[] = [];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null };
  let notes: string[] = [];

  /**
   * Every model call goes through here (#1449) — the Reach, the caravan meeting and the road:
   * the budget is checked before the call (so no paid reply is thrown away), and its usage and
   * cost are counted after, in this run's usage and in the batch's shared ledger.
   */
  const call = async (make: () => Promise<{ text: string; usage?: Partial<Usage> }>): Promise<string> => {
    if (opts.ledger && opts.ledger.spent >= opts.ledger.budget) {
      throw new BudgetExceeded({ player: player.name, turns, usage, start, record: { kind: 'stopped', choice: 'budget', day: s.day, readyDay: null } });
    }
    const r = await make();
    usage.input += r.usage?.input ?? 0;
    usage.output += r.usage?.output ?? 0;
    usage.cacheRead += r.usage?.cacheRead ?? 0;
    usage.cacheWrite += r.usage?.cacheWrite ?? 0;
    // Unknown stays unknown: one call without a cost doesn't turn a known total into a guess.
    if (r.usage?.cost !== undefined && r.usage.cost !== null) {
      usage.cost = (usage.cost ?? 0) + r.usage.cost;
      if (opts.ledger) opts.ledger.spent += r.usage.cost;
    }
    return r.text;
  };
  const ask = (message: string, decide = player.decide.bind(player)): Promise<string> => call(() => decide(message, s));

  // Packing for the hike (#1401): a player that packs chooses before day 1. A reply that won't do is
  // explained back once; after that, the pack it already has (the leader's list, or last time's) stays.
  let packed: PackRecord | undefined;
  if (player.decidePack) {
    const decidePack = player.decidePack.bind(player);
    let reply = await ask(observePack(s), decidePack);
    let d = parsePackDecision(reply);
    const errors = d.ok ? [] : [...d.errors];
    if (!d.ok) {
      reply = await ask(`Your pack was invalid:\n- ${d.errors.join('\n- ')}\nReply again with only the JSON object {"thoughts", "pack"}.`, decidePack);
      d = parsePackDecision(reply);
      if (!d.ok) errors.push(...d.errors);
    }
    if (d.ok) s = repack(s, d.decision.pack);
    packed = d.ok ? { pack: [...d.decision.pack], thoughts: d.decision.thoughts, ...(errors.length ? { errors } : {}) } : { pack: [...(s.kit?.items ?? [])], thoughts: '', forced: true, errors };
  }

  // Encounters met this turn (#1348), and every one ever resolved, to catch one resolved twice.
  let met: EncounterChoice[] = [];
  let twice: string[] = [];
  const resolved = new Set<string>();
  /**
   * An encounter paused the day (#1348): show it to the player, apply the choice, and leave the
   * day ready to go on. An invalid choice is explained back once; after that — or for a player
   * that can't choose — the safest available option is taken, and the encounter is marked.
   */
  const settle = async (): Promise<void> => {
    while (s.pending && !s.outcome) {
      const p = s.pending;
      const t = encounterById(p.id);
      if (!t) { s = { ...s, pending: null }; continue; } // an unknown encounter (an old save): let the day go on
      const offered = optionsFor(s, t).map(o => ({ id: o.option.id, unmet: o.unmet }));
      let choice: string | null = null, reply = '', errors: string[] | undefined;
      if (player.decideEncounter) {
        const decideEncounter = player.decideEncounter.bind(player);
        reply = await ask(observeEncounter(s), decideEncounter);
        let e = parseEncounterDecision(reply, offered);
        if (!e.ok) {
          reply = await ask(`Your choice was invalid:\n- ${e.errors.join('\n- ')}\nReply again with only the JSON object {"thoughts", "choice"}.`, decideEncounter);
          e = parseEncounterDecision(reply, offered);
        }
        if (e.ok) choice = e.decision.choice; else errors = e.errors;
      }
      const forced = choice === null;
      const option = forced ? safestOption(s, t) : stepOf(t, p.step).options.find(o => o.id === choice)!;
      // Each step of a dialogue (#1346) is its own choice; the same step twice would be a bug.
      const key = `${p.id}@${p.day}:${p.step ?? 'start'}`;
      const before = s;
      s = chooseOption(s, option.id);
      if (forced && player.decideEncounter) notes.push(`You never named a valid choice in the encounter on day ${p.day}, so you took the safest: ${option.label}.`);
      met.push({
        ...encounterRecord(before, s, option.id),
        ...(forced ? { forced: true, ...(player.decideEncounter ? { reply, errors } : {}) } : {}),
      });
      if (resolved.has(key)) twice.push(`encounter ${key} resolved twice`);
      resolved.add(key);
    }
  };
  /** Close a turn: attach the encounters met during it and the turn's frights (#1365), and flag one resolved twice. */
  const close = (t: Turn): Turn => {
    const fright = frightOfTurn(t.journal, quirksAtStart, s.character.quirks ?? []);
    const pins = pinsOfTurn(pinsAtStart, s.pins ?? []);
    const out = { ...t, ...(met.length ? { encounters: met } : {}), ...(fright ? { fright } : {}), ...(pins ? { pins } : {}) };
    const v = twice;
    met = []; twice = [];
    return v.length ? { ...out, violations: [...(out.violations ?? []), ...v] } : out;
  };

  const maxDays = opts.maxDays ?? s.config.calendar.thawDay;
  // Quirks at the start of each turn, to see which fears the turn gave and took (#1365).
  let quirksAtStart: readonly Quirk[] = [];
  // …and the places remembered, to see which the turn made and let go (#1381).
  let pinsAtStart: readonly Pin[] = [];
  while (!s.outcome && s.day <= maxDays) {
    const day = s.day;
    quirksAtStart = s.character.quirks ?? [];
    pinsAtStart = s.pins ?? [];
    const logStart = s.log.length;
    // One thing at a time until planning is learned (#1350): run the first action of each reply
    // and ask again, until the player ends the day (an empty queue) or the hours run out.
    // Actions taken one at a time today before planning opened (#1350), kept for the turn's record.
    let stepped: QueueItem[] = [];
    if (!s.canPlan) {
      const done: QueueItem[] = [];
      stepped = done;
      let thoughts = '', invalid = false, lastReply = '', errors: string[] | undefined;
      for (let asks = 0; asks < LOCKED_ASKS && !s.outcome && s.day === day && !s.canPlan; asks++) {
        lastReply = await ask(observe(s, notes));
        notes = [];
        let p = decideFor(s, lastReply);
        if (!p.ok) {
          lastReply = await ask(`Your reply was invalid:\n- ${p.errors.join('\n- ')}\nReply again with only the JSON object for day ${day}.`);
          p = decideFor(s, lastReply);
        }
        if (!p.ok) { invalid = true; errors = p.errors; s = runDay(s, []).state; notes.push(`Your reply for day ${day} was invalid twice, so the day ended.`); break; }
        const d = p.decision;
        thoughts = d.thoughts || thoughts;
        if (d.focus) s = setFocus(s, parseFocus(d.focus));
        if (d.eating) s = setEating(s, d.eating);
        s = applyPinOrders(s, d);
        const first = d.queue[0];
        if (!first) { s = runDay(s, []).state; break; }
        if (d.queue.length > 1) notes.push('Only your first action ran: you take things one at a time until you learn to plan ahead. You will be asked again.');
        s = runAction(s, first);
        done.push(first);
        await settle();
        if (s.outcome) break;
        if (d.site && d.site !== s.site && scouted(s.explore, 1)) s = chooseSite(s, d.site);
        if (s.hoursToday >= DAY_HOURS) { s = runDay(s, []).state; break; }
      }
      if (!s.outcome && s.day === day && !s.canPlan) s = runDay(s, []).state; // asked enough: the day ends
      if (s.outcome || s.day !== day) {
        const t = close({ day, thoughts, site: s.site, queue: done, invalid, ...(invalid ? { reply: lastReply, errors } : {}), journal: s.log.slice(logStart).map(l => l.text), after: snapshot(s, warmth), progress: progressOf(s, startKnown), ...broken(s) });
        turns.push(t); opts.onTurn?.(t);
        continue;
      }
      // Planning opened mid-day: the rest of today is planned as usual, below.
    }
    let reply = await ask(observe(s, notes));
    let parsed = decideFor(s, reply);
    notes = [];
    if (!parsed.ok) {
      reply = await ask(`Your reply was invalid:\n- ${parsed.errors.join('\n- ')}\nReply again with only the JSON object for day ${day}.`);
      parsed = decideFor(s, reply);
    }
    if (!parsed.ok) {
      s = runDay(s, []).state;
      notes.push(`Your reply for day ${day} was invalid twice, so the day passed with nothing done.`);
      const t = close({ day, thoughts: '', site: null, queue: [], invalid: true, reply, errors: parsed.errors, journal: s.log.slice(logStart).map(l => l.text), after: snapshot(s, warmth), progress: progressOf(s, startKnown), ...broken(s) });
      turns.push(t); opts.onTurn?.(t);
      continue;
    }

    let d = parsed.decision;
    // A plan that leaves most of the day idle is asked about once (#1473). The answer replaces it
    // if it parses; one that doesn't keeps the first plan, so the question never costs a day.
    let fill: Turn['fill'];
    const question = opts.fillDay ? fillQuestion(s, d.queue, day) : null;
    if (question) {
      const planned = plannedHours(s, d.queue);
      const again = decideFor(s, await ask(question));
      if (again.ok) d = again.decision;
      fill = { planned, then: plannedHours(s, d.queue) };
    }
    if (d.focus) s = setFocus(s, parseFocus(d.focus));
    if (d.eating) s = setEating(s, d.eating);
    s = applyPinOrders(s, d);
    // A site can only be claimed once ring 1 is scouted. A day-1 plan of "scout, then settle" is
    // reasonable, so when the land isn't scouted yet the claim waits until after the day's queue.
    const deferSite = !!d.site && d.site !== s.site && !scouted(s.explore, 1);
    if (d.site && d.site !== s.site && !deferSite) s = chooseSite(s, d.site);
    // A build later in that same day still needs to know where: hand it the chosen site
    // (Build takes a `site` option, which claims the ground once the land is scouted).
    const queue = deferSite && d.site
      ? d.queue.map(item => {
        const { id, opts } = parseItem(item);
        return id === 'build' && !opts.site ? { q: typeof item === 'string' ? item : item.q, opts: { ...opts, site: d.site! } } : item;
      })
      : d.queue;
    let r = runDay(s, queue);
    s = r.state;
    // An encounter paused the day (#1348): choose, then the rest of the queue runs.
    while (s.pending && !s.outcome) {
      await settle();
      if (s.outcome) break;
      r = runDay(s, r.remaining);
      s = r.state;
    }
    if (deferSite && d.site && d.site !== s.site) s = chooseSite(s, d.site);
    if (r.remaining.length) notes.push(`${r.remaining.length} queued action(s) didn't fit in day ${day} and were dropped.`);
    const t = close({ day, thoughts: d.thoughts, site: d.site, queue: [...stepped, ...queue], invalid: false, ...(fill ? { fill } : {}), journal: s.log.slice(logStart).map(l => l.text), after: snapshot(s, warmth), progress: progressOf(s, startKnown), ...broken(s) });
    turns.push(t); opts.onTurn?.(t);
  }

  if (!s.outcome) throw new Error(`the run did not resolve by day ${maxDays} — the sim should always end at the thaw`);
  const result: RunResult = { player: player.name, turns, record: summarizeRun(s, 1), usage, start, final: s, ...(packed ? { packed } : {}), gifts: giftsOf(s, giftStart), spread };
  if (opts.road && s.outcome.kind === 'survived' && player.decideRoad) try {
    const decideRoad = player.decideRoad.bind(player);
    // First the caravan master (#1357): who you are and how you'll pay. Let them pass, and there's no road.
    const reach = s;
    const answer = player.decideMeeting ? player.decideMeeting.bind(player) : player.decideEncounter ? (msg: string) => player.decideEncounter!(msg, reach) : null;
    const met = await playMeeting(reach, answer ? (message, m) => call(() => answer(message, reach, m)) : null);
    result.meeting = met.record;
    // Road encounters (#1349) are answered like the Reach's.
    const decideEncounter = player.decideEncounter?.bind(player);
    const choose = decideEncounter ? (message: string, r: RoadState) => call(() => decideEncounter(message, r as unknown as Region1State)) : null;
    if (met.boarding) result.road = await playRoad(s, (message, r) => call(() => decideRoad(message, r)), opts.onRoadTurn, met.boarding, choose);
    // A hidden talent can still come to light on the road: the record is the run's whole story.
    if (result.road) result.gifts = giftsOf(s, giftStart, result.road.final);
  } catch (err) {
    // Out of budget on the road (#1449): the Reach year is whole and paid for — keep it, say why the road isn't there.
    if (!(err instanceof BudgetExceeded)) throw err;
    delete result.meeting;
    result.roadStopped = 'budget';
  }
  return result;
}

/**
 * Play the caravan road from a run that survived the thaw (#1251): one decision per
 * road day, through the same observe → decide → validate → apply loop as Region 1.
 * The first message carries the road's rules. An invalid reply is explained back once;
 * actions the sim can't do are skipped, and the next day's journal says why.
 */
export async function playRoad(reach: Region1State, ask: (message: string, r: RoadState) => Promise<string>, onTurn?: (t: RoadTurn) => void, boarding?: Boarding, choose?: ((message: string, r: RoadState) => Promise<string>) | null): Promise<RoadResult> {
  let r = createRoad(reach, boarding);
  /**
   * A road encounter met at dawn (#1349): shown like a Reach encounter and answered the same way.
   * An invalid answer is explained back once; after that — or for a player that can't choose —
   * the safest option is taken, and the encounter is marked.
   */
  const settle = async (): Promise<EncounterChoice[]> => {
    const met: EncounterChoice[] = [];
    while (r.pending && !r.outcome) {
      const p = r.pending, t = encounterById(p.id)!;
      const view = r as unknown as Region1State; // the encounter helpers read only what a road state shares with the Reach
      const offered = optionsFor(view, t).map(o => ({ id: o.option.id, unmet: o.unmet }));
      let choice: string | null = null, reply = '', errors: string[] | undefined;
      if (choose) {
        reply = await choose(observeEncounter(view), r);
        let e = parseEncounterDecision(reply, offered);
        if (!e.ok) {
          reply = await choose(`Your choice was invalid:\n- ${e.errors.join('\n- ')}\nReply again with only the JSON object {"thoughts", "choice"}.`, r);
          e = parseEncounterDecision(reply, offered);
        }
        if (e.ok) choice = e.decision.choice; else errors = e.errors;
      }
      const forced = choice === null;
      const option = forced ? safestOption(view, t) : stepOf(t, p.step).options.find(o => o.id === choice)!;
      const odds = oddsWord(chanceOf(view, option));
      const before = r.log.length;
      r = chooseRoadOption(r, option.id);
      met.push({ id: t.id, kind: t.kind, choice: option.id, odds, result: r.log.slice(before).map(l => l.text).join(' '), ...(r.outcome?.kind === 'died' ? { died: true } : {}), ...(forced ? { forced: true, ...(choose ? { reply, errors } : {}) } : {}) });
    }
    return met;
  };
  const start = roadProgressOf(r);
  const turns: RoadTurn[] = [];
  let notes: string[] = [];
  let first = true;
  // The road always ends at Mistheim's gates: a few days' slack, then it's a sim bug.
  const maxDays = ROAD_DAYS + 2;
  while (!r.outcome && r.day <= maxDays) {
    const day = r.day;
    const logStart = r.log.length;
    const met = await settle();
    if (r.outcome) {
      const t: RoadTurn = { day, thoughts: '', actions: [], invalid: false, encounters: met, progress: roadProgressOf(r), journal: r.log.slice(logStart).map(l => l.text) };
      turns.push(t); onTurn?.(t);
      break;
    }
    const obs = observeRoad(r, notes);
    let reply = await ask(first ? `${ROAD_RULES}\n\n${obs}` : obs, r);
    first = false;
    notes = [];
    let parsed = parseRoadDecision(reply);
    if (!parsed.ok) {
      reply = await ask(`Your reply was invalid:\n- ${parsed.errors.join('\n- ')}\nReply again with only the JSON object {"thoughts", "actions"} for road day ${day}.`, r);
      parsed = parseRoadDecision(reply);
    }
    const actions = parsed.ok ? parsed.decision.actions : [];
    const out = runRoadDay(r, actions);
    r = out.state;
    if (!parsed.ok) notes.push(`Your reply for road day ${day} was invalid twice, so the day passed with nothing done.`);
    if (out.remaining.length) notes.push(`${out.remaining.length} action(s) didn't fit in road day ${day} and were dropped.`);
    const v = roadInvariantViolations(r);
    const t: RoadTurn = {
      day, thoughts: parsed.ok ? parsed.decision.thoughts : '', actions, invalid: !parsed.ok,
      ...(met.length ? { encounters: met } : {}),
      ...(parsed.ok ? {} : { reply, errors: parsed.errors }),
      ...(v.length ? { violations: v } : {}),
      progress: roadProgressOf(r), journal: r.log.slice(logStart).map(l => l.text),
    };
    turns.push(t); onTurn?.(t);
  }
  if (!r.outcome) throw new Error(`the road did not resolve by road day ${maxDays} — it should always end at Mistheim`);
  return { turns, start, record: summarizeRoad(r, reach, 1), final: r };
}

/** `{ violations }` only when something is broken, so clean transcripts stay clean. */
function broken(s: Region1State): { violations?: string[] } {
  const v = invariantViolations(s);
  return v.length ? { violations: v } : {};
}
