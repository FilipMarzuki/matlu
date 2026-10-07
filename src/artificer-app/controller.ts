/**
 * Artificer web frontend — the app controller (#1209).
 *
 * A thin, pure layer between the DOM and the Region 1 sim core
 * (`src/artificer/`). The sim knows nothing about a player's *plan*; this adds
 * the one piece of UI-owned state — the action queue — plus save/load.
 *
 * Kept free of `document` / `localStorage` on purpose so every rule here can be
 * unit-tested in Node (see controller.test.ts); `main.ts` does the rendering
 * and the browser storage.
 */

import { ACTIONS, chooseOption, forgetPin, setInterest, SITES, blockedReason, dangerOf, tripLoad, tripUnease, type TripLoad, DAY_HOURS, setFocus, setEating, EATING_PLANS, type EatingPlan, chooseSite, createRegion1, runAction, runDay, parseQueueId, parseItem, queueHours, type QueueId, type QueueItem, type Region1State, type SiteId } from '../artificer/region1';
import { summarizeRun, summarizeRoad, legacyOf, legacyOfRoad, addRun, canContinue, runNumberFor, type RunRecord } from '../artificer/legacy';
import { createRoad, endRoadDay, runRoadAction, runRoadDay, chooseRoadOption, type RoadActionId, type RoadState } from '../artificer/road';
import { startingTalents, validPick, validTalents } from '../artificer/talents';
import { parseFocus, type Focus } from '../artificer/focus';
import { DEFAULT_STATS, STAT_IDS, type Stats } from '../artificer/stats';
import { FULL_WORLD, validWorld, type WorldConfig } from '../artificer/world';
import { WEATHER_IDS, weatherFor } from '../artificer/weather';
import { supplyFromWorked } from '../artificer/exploration';
import { seedOf } from '../artificer/rng';
import { openMeeting, chooseInMeeting, boardingOf, MEETING_STEPS, type Meeting } from '../artificer/caravan-meeting';
import { startingQuirks, type Quirk } from '../artificer/quirks';
import { SUGGESTED_PACK, validPack, readKit, type KitId } from '../artificer/kit';
import { DEFAULT_AGE } from '../artificer/growing';
import { BACKGROUNDS, type Background } from '../artificer/scout';
import { skillLevel } from '../artificer/skills';
import { readInjury, riskFor, HARM_NAME, type Harm, type Injury } from '../artificer/injuries';

export interface AppState {
  /** The Region 1 run — kept once the road begins, since the run's record starts from it. */
  sim: Region1State;
  /** The player's plan: runs in order, spilling over day boundaries. */
  queue: QueueItem[];
  /** Where the run is (#1250): in the Reach, or on the caravan road after the thaw. Absent means the Reach. */
  stage?: 'reach' | 'road';
  /** The road sim, once the Warden rides with the caravan (#1250). */
  road?: RoadState;
  /** Meeting the caravan at the thaw (#1356): the dialogue, while it's open and until you board or watch them go. */
  meeting?: Meeting;
  /** You let the caravan pass (#1356): no road this run. */
  stayed?: boolean;
}

/** The world a new game plays: everything on, encounters included (#1347). Older saves keep the world they were made with. */
export const GAME_WORLD: WorldConfig = { ...FULL_WORLD, encounters: true };

/** Bump the version (and the key) whenever the saved shape changes incompatibly. */
export const SAVE_VERSION = 7;
export const SAVE_KEY = 'artificer.region1.v7';

/** Long enough for any real plan; stops a runaway loop if the sim ever stalls. */
const MAX_DAYS_PER_RUN = 60;

/** A fresh character id. App-level (not in the sim) because it needs randomness; the sim stays deterministic. */
export const newCharacterId = (): string => `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A brand-new Warden: a new character, knowing nothing. */
export function newGame(): AppState {
  // A new Warden learns to plan as they go (#1350).
  return { sim: createRegion1({ planning: 'learned', world: GAME_WORLD }, undefined, { id: newCharacterId(), background: 'scout', age: DEFAULT_AGE, pack: [...SUGGESTED_PACK] }), queue: [], stage: 'reach' };
}

/**
 * Start the next run. If `from` is a resolved run whose character lived, that
 * same character goes on — same id, name, portrait, stats and talents — keeping what
 * they learned (#1242). Otherwise (no run, unfinished, or the character died)
 * it's a new Warden with nothing carried.
 */
export function newRun(from?: Region1State | RoadState): AppState {
  if (!from || !canContinue(from)) return newGame();
  const c = from.character;
  // A run that rode the road carries its marks and contacts too (#1250).
  const legacy = 'leg' in from ? legacyOfRoad(from) : legacyOf(from);
  return { sim: createRegion1({ planning: 'learned', world: GAME_WORLD }, legacy, { id: c.id || newCharacterId(), name: c.name, portrait: c.portrait, talents: c.talents, stats: c.adult ?? c.stats }), queue: [], stage: 'reach' };
}

/** Where the run ended up: the road once it has begun, else the Reach. What `newRun` and `canContinue` look at. */
export const currentRun = (a: AppState): Region1State | RoadState => (a.stage === 'road' && a.road ? a.road : a.sim);

// ── The caravan road (#1250) ────────────────────────────────────────────────

/**
 * Ride with the spring caravan (#1307): a run that survived to the thaw goes on
 * down the road instead of ending. Refused for any other ending — the dead and
 * the collapsed take no road — and for a run already on it.
 */
export function rideCaravan(a: AppState): AppState {
  if (a.stage === 'road' || a.sim.outcome?.kind !== 'survived' || a.stayed) return a;
  // After a meeting (#1356), the road starts from what was agreed; only once it ended on the wagon.
  if (a.meeting && !boardingOf(a.meeting)) return a;
  const { meeting: _done, ...rest } = a;
  return { ...rest, stage: 'road', road: createRoad(a.sim, a.meeting ? boardingOf(a.meeting)! : undefined), queue: [] };
}

/** Meet the caravan at the thaw (#1356): open the dialogue with Bodil. Only once, and only for a Warden who survived. */
export function meetCaravan(a: AppState): AppState {
  if (a.stage === 'road' || a.sim.outcome?.kind !== 'survived' || a.meeting || a.stayed) return a;
  return { ...a, meeting: openMeeting(a.sim) };
}

/** Answer in the meeting (#1356). The meeting stays open after it ends, so the screen can show how it went. */
export function meetingChoose(a: AppState, optionId: string): AppState {
  if (!a.meeting || a.meeting.ended) return a;
  return { ...a, meeting: chooseInMeeting(a.sim, a.meeting, optionId) };
}

/** Watch the caravan go (#1356): the meeting ended with you staying behind, and the run ends at the thaw. */
export function stayBehind(a: AppState): AppState {
  if (a.meeting?.ended !== 'stay') return a;
  const { meeting: _done, ...rest } = a;
  return { ...rest, stayed: true };
}

/**
 * Do one thing on the road now (#1252) — the road screen acts as you tap, rather than
 * queueing: a talk, a sale, a lesson. Anything the sim can't do is skipped (and the
 * journal says why) without spending hours.
 */
export function roadAct(a: AppState, id: RoadActionId): AppState {
  if (a.stage !== 'road' || !a.road || a.road.outcome) return a;
  return { ...a, road: runRoadAction(a.road, id) };
}

/** Answer a road encounter (#1349). */
export function roadChoose(a: AppState, optionId: string): AppState {
  if (a.stage !== 'road' || !a.road?.pending) return a;
  return { ...a, road: chooseRoadOption(a.road, optionId) };
}

/** End the road day (#1252): the night, then the caravan's next move. */
export function roadEndDay(a: AppState): AppState {
  if (a.stage !== 'road' || !a.road || a.road.outcome) return a;
  return { ...a, road: endRoadDay(a.road) };
}

/** Run one day on the road: these actions as far as the hours go, then the night and the caravan's next move. */
export function runRoadQueuedDay(a: AppState, actions: readonly RoadActionId[] = []): AppState {
  if (a.stage !== 'road' || !a.road || a.road.outcome) return a;
  return { ...a, road: runRoadDay(a.road, actions).state };
}

// ── Run history (saved separately from the game, so starting over keeps it) ──

export const HISTORY_KEY = 'artificer.history.v1';

/**
 * Record a run once it has resolved. Calling it again for the same resolved
 * run is a no-op, so the page can call it after every update.
 */
export function recordRun(history: readonly RunRecord[], before: AppState, after: AppState): RunRecord[] {
  if (after.stage === 'road' && after.road) {
    // The road resolving finishes the run that survived the thaw (#1250): its record replaces
    // that run's thaw record (same run number), or is added if there wasn't one.
    if (!after.road.outcome || (before.stage === 'road' && before.road?.outcome)) return [...history];
    const id = after.sim.character.id;
    const thaw = history.findIndex(r => r.characterId === id && r.kind === 'survived' && r.day === after.sim.day && r.stage !== 'road');
    if (thaw >= 0) {
      const rec = summarizeRoad(after.road, after.sim, history[thaw].run);
      return history.map((r, i) => (i === thaw ? rec : r));
    }
    return addRun(history, summarizeRoad(after.road, after.sim, runNumberFor(history, id)));
  }
  if (!after.sim.outcome || before.sim.outcome) return [...history];
  return addRun(history, summarizeRun(after.sim, runNumberFor(history, after.sim.character.id)));
}

export function serializeHistory(h: readonly RunRecord[]): string {
  return JSON.stringify({ version: 1, runs: h });
}

/** Parse saved history; anything malformed is simply an empty history. */
export function deserializeHistory(raw: string | null | undefined): RunRecord[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObj(data) || data.version !== 1 || !Array.isArray(data.runs)) return [];
    const ok = data.runs.every(r => isObj(r) && isNum(r.run) && isNum(r.day) && typeof r.kind === 'string' && typeof r.choice === 'string' && Array.isArray(r.tools));
    return ok ? (data.runs as RunRecord[]) : [];
  } catch { return []; }
}

export function enqueue(a: AppState, id: QueueItem): AppState {
  // No queue until planning is learned (#1350): use `act` instead.
  if (a.sim.outcome || a.stage === 'road' || !a.sim.canPlan) return a;
  return { ...a, queue: [...a.queue, id] };
}

/** Why the queue is closed, or null (#1350). */
export const queueLocked = (a: AppState): string | null =>
  a.sim.canPlan ? null : "You're taking it one thing at a time — you haven't learned to plan ahead yet.";

/**
 * Do one thing now (#1350): before planning is learned, each action runs as it's chosen.
 * Nothing happens once the run is over or the day's hours are spent.
 */
export function act(a: AppState, item: QueueItem): AppState {
  if (a.sim.outcome || a.stage === 'road' || a.sim.hoursToday >= DAY_HOURS) return a;
  return { ...a, sim: runAction(a.sim, item) };
}

/** Choose an option in the encounter that's waiting (#1347). The day stays where it was until you carry on. */
export function choose(a: AppState, optionId: string): AppState {
  if (!a.sim.pending) return a;
  return { ...a, sim: chooseOption(a.sim, optionId) };
}

/**
 * Carry on after an encounter (#1347): the rest of the queue runs, as the day would have. Before
 * planning is learned there is no queue, so you simply carry on by hand.
 */
/** Let a remembered place go (#1380). */
export function forget(a: AppState, pinId: string): AppState {
  return { ...a, sim: forgetPin(a.sim, pinId) };
}

/** Weigh a remembered place, ★ to ★★★ or none (#1380), as far as Memory allows. */
export function weighPin(a: AppState, pinId: string, stars: 0 | 1 | 2 | 3): AppState {
  return { ...a, sim: setInterest(a.sim, pinId, stars) };
}

export function carryOn(a: AppState): AppState {
  if (a.sim.pending || a.sim.outcome || !a.queue.length || !a.sim.canPlan) return a;
  return runQueuedDay(a);
}

/** End the day without a queue (#1350): the night passes. */
export function endTheDay(a: AppState): AppState {
  if (a.sim.outcome || a.stage === 'road') return a;
  const r = runDay(a.sim, []);
  return { ...a, sim: r.state, queue: r.state.outcome ? [] : a.queue };
}

export function dequeueAt(a: AppState, index: number): AppState {
  if (index < 0 || index >= a.queue.length) return a;
  return { ...a, queue: a.queue.filter((_, i) => i !== index) };
}

/**
 * Choose an option on one queued action (e.g. the location of a build). The
 * entry becomes `{ q, opts }`; other entries are untouched.
 */
export function setOption(a: AppState, index: number, key: string, value: string): AppState {
  if (index < 0 || index >= a.queue.length) return a;
  const { opts } = parseItem(a.queue[index]);
  const item = a.queue[index];
  const q = typeof item === 'string' ? item : item.q;
  const queue = a.queue.map((it, i) => (i === index ? { q, opts: { ...opts, [key]: value } } : it));
  return { ...a, queue };
}

export function clearQueue(a: AppState): AppState {
  return { ...a, queue: [] };
}

/** Run today: as much of the queue as fits, then sleep. The rest waits for tomorrow. */
export function runQueuedDay(a: AppState): AppState {
  if (a.sim.outcome) return a;
  const r = runDay(a.sim, a.queue);
  // A run that ends tonight (the thaw, or the body giving out) leaves nothing to plan.
  return { ...a, sim: r.state, queue: r.state.outcome ? [] : r.remaining };
}

/** Run day after day until the queue is empty (or the region resolves). */
export function runWholeQueue(a: AppState): AppState {
  let s = a;
  // A waiting encounter (#1343) stops the run of days: the choice comes first.
  for (let i = 0; i < MAX_DAYS_PER_RUN && s.queue.length > 0 && !s.sim.outcome && !s.sim.pending; i++) {
    s = runQueuedDay(s);
  }
  return s;
}

/** Set (or clear) the Warden's focus (#1238). Free: no hours, no queue entry. */
export function chooseFocus(a: AppState, focus: Focus | null): AppState {
  return { ...a, sim: setFocus(a.sim, focus) };
}

/** Set how the Warden eats (#1305). */
export function chooseEating(a: AppState, plan: EatingPlan): AppState {
  return { ...a, sim: setEating(a.sim, plan) };
}

export function settle(a: AppState, site: SiteId): AppState {
  return { ...a, sim: chooseSite(a.sim, site) };
}


// ── Planning previews ───────────────────────────────────────────────────────

export interface QueuePreview {
  /** Days from now each queued action will run on (0 = today). */
  dayOffset: number[];
  /**
   * Why each action would be skipped, judged against the state after the
   * actions before it — or null if it should run. An approximation: it
   * ignores the nightly meal, so it can miss a skip caused by eating.
   */
  warnings: (string | null)[];
  /** How frightening each land trip will be (#1364): shaken or panicked, and why — null when calm or not on the land. */
  unease: ({ state: 'shaken' | 'panicked'; reasons: string[] } | null)[];
  /** What each ringed trip would bring home and how heavy it is to carry (#1296); null for camp work. */
  loads: (TripLoad | null)[];
  /** A danger the Warden can see coming (a blizzard, with Intelligence 12+, #1315) — or null. The action still runs. */
  dangers: (string | null)[];
  /** Work that could make a serious, untreated injury worse (#1395) — or null. */
  strains: (string | null)[];
  /** The state after every queued action has run (no nights in between). */
  projected: Region1State;
  /** The state each entry would run in — what its options are judged against. */
  before: Region1State[];
}

/**
 * Preview the queue without committing it. Uses the same day-splitting rule
 * as `runDay`: an action starts only if the day still has hours left.
 */
export function previewQueue(a: AppState): QueuePreview {
  const dayOffset: number[] = [];
  const warnings: (string | null)[] = [];
  const dangers: (string | null)[] = [];
  const strains: (string | null)[] = [];
  const loads: (TripLoad | null)[] = [];
  const unease: QueuePreview['unease'] = [];
  let hours = a.sim.hoursToday;
  let day = 0;
  let projected = a.sim;
  const before: Region1State[] = [];
  for (const item of a.queue) {
    if (hours >= DAY_HOURS) { day += 1; hours = 0; }
    dayOffset.push(day);
    before.push(projected);
    const { id, ring, opts } = parseItem(item);
    const reason = blockedReason(projected, id, ring, opts);
    warnings.push(reason);
    dangers.push(reason ? null : dangerOf(projected, id, ring));
    // Work through a serious injury (#1392) and it may give: the same rule the sim rolls (crafts strain a hand).
    const craft = !!(ACTIONS[id].recipe || ACTIONS[id].recipeFor);
    // …but only someone who knows that (Apprentice First aid, #1410) is warned.
    strains.push(reason ? null : riskFor(projected.injuries, id, ring, craft, skillLevel(projected.skills, 'firstaid')));
    // What the trip would bring home, and how heavy it is to carry (#1296).
    loads.push(reason ? null : tripLoad(projected, item));
    // How it will feel out there at that hour (#1364): the dark, the weather, the distance.
    const u = reason ? null : tripUnease(projected, item);
    unease.push(u && u.state !== 'calm' ? { state: u.state, reasons: u.reasons } : null);
    // A refused action costs no time in the sim, so it costs none here either.
    if (!reason) hours += queueHours(item, projected);
    projected = runAction(projected, item);
  }
  return { dayOffset, warnings, dangers, strains, unease, loads, projected, before };
}

// ── Save / load ─────────────────────────────────────────────────────────────

export function serialize(a: AppState): string {
  return JSON.stringify({ version: SAVE_VERSION, sim: a.sim, queue: a.queue, stage: a.stage ?? 'reach', ...(a.road ? { road: a.road } : {}), ...(a.meeting ? { meeting: a.meeting } : {}), ...(a.stayed ? { stayed: true } : {}) });
}

/**
 * Parse a saved road (#1250), filling in fields a later Region 1.5 issue added. Null when
 * it isn't one — the same shape checks as the Reach: what the sim reads, then trust the rest.
 */
function parseRoad(x: unknown): RoadState | null {
  if (!isObj(x)) return null;
  const v = x.vitals;
  if (!isNum(x.day) || !isNum(x.hoursToday) || !isNum(x.leg) || !isNum(x.legDay) || !isObj(v) || !isPool(v.vigor) || !isPool(v.clarity) || !isNum(v.condition)) return null;
  if (!isObj(x.stores) || !Array.isArray(x.tools) || !Array.isArray(x.log) || !isObj(x.trust) || !isObj(x.character)) return null;
  const obj = (y: unknown) => (isObj(y) ? y : {});
  const strs = (y: unknown): string[] => (Array.isArray(y) && y.every(z => typeof z === 'string') ? [...y] : []);
  return {
    ...(x as unknown as RoadState),
    told: obj(x.told) as RoadState['told'], idleTalks: obj(x.idleTalks) as RoadState['idleTalks'], word: isNum(x.word) ? x.word : 0,
    marks: isNum(x.marks) ? x.marks : 0, contacts: strs(x.contacts), quests: obj(x.quests) as RoadState['quests'],
    discovery: obj(x.discovery) as RoadState['discovery'], appraised: strs(x.appraised),
    // Injuries (#1392): an older save's `daysLeft` reads as a minor one.
    injuries: Array.isArray(x.injuries) ? (x.injuries as unknown[]).map(readInjury).filter((i): i is Injury => i !== null) : undefined,
  };
}

/** A saved meeting (#1356): the fields the screen and the boarding read. */
const isMeeting = (x: unknown): x is Meeting =>
  isObj(x) && typeof x.step === 'string' && x.step in MEETING_STEPS && (x.ended === null || x.ended === 'board' || x.ended === 'stay')
  && Array.isArray(x.lines) && isObj(x.trust) && isObj(x.paid) && isObj(x.paid.stores) && isNum(x.paid.marks) && isNum(x.owesHelp);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isPool = (x: unknown): boolean => isObj(x) && isNum(x.current) && isNum(x.cap);

/**
 * Parse a save. Returns null — never throws — for anything that isn't a
 * well-formed save of this version, so a corrupt or stale save just means
 * "start fresh" instead of a broken page.
 */
export function deserialize(raw: string | null | undefined): AppState | null {
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!isObj(data) || data.version !== SAVE_VERSION) return null;

  const { sim, queue } = data;
  const validQ = (item: unknown): boolean => {
    const q = isObj(item) ? item.q : item;
    if (isObj(item) && (!isObj(item.opts) || !Object.values(item.opts).every(v => typeof v === 'string'))) return false;
    if (typeof q !== 'string') return false;
    const { id, ring } = parseQueueId(q as QueueId);
    return id in ACTIONS && [1, 2, 3].includes(ring) && (ring === 1 || ACTIONS[id].ringed === true);
  };
  if (!Array.isArray(queue) || !queue.every(validQ)) return null;
  if (!isObj(sim)) return null;
  const v = sim.vitals;
  if (!isNum(sim.day) || !isNum(sim.hoursToday) || !isObj(v) || !isPool(v.vigor) || !isPool(v.clarity) || !isNum(v.condition)) return null;
  if (!isObj(sim.stores) || typeof sim.stores.hides !== 'number' || !isObj(sim.explore) || !isObj(sim.flags) || !isObj(sim.today) || !isObj(sim.config)) return null;
  if (!Array.isArray(sim.known) || !isObj(sim.studiedToday)) return null;
  if (!Array.isArray(sim.milestones) || !Array.isArray(sim.log) || !Array.isArray(sim.tools) || !isObj(sim.concepts)) return null;
  if (sim.shelterGrade !== null && typeof sim.shelterGrade !== 'string') return null;
  // The road (#1250): saves from before Region 1.5 have no stage, and load in the Reach.
  const road = data.stage === 'road' ? parseRoad(data.road) : null;
  if (data.stage === 'road' && !road) return null;
  // The caravan meeting (#1356): a malformed one is dropped, and the meeting simply starts again.
  const meeting = !road && isMeeting(data.meeting) ? data.meeting : null;

  // Saves from before food/water streaks (#1233) start with none, rather than being thrown away.
  const d = sim.deprivation;
  const deprivation = isObj(d) && isNum(d.hungry) && isNum(d.thirsty) ? { hungry: d.hungry, thirsty: d.thirsty } : { hungry: 0, thirsty: 0 };

  // The shape checks above cover what the sim reads; trust the rest.
  // …and saves from before skills (#1236) start with no practice.
  const skills = isObj(sim.skills) && Object.values(sim.skills).every(isNum) ? sim.skills as Region1State['skills'] : {};
  // …and saves from before character creation (#1237/#1239) get an unnamed Warden with no talents.
  const ch = sim.character;
  // …and saves from before stats (#1256) get average stats. Grown stats may pass the creation max, so only the 3–18 range is checked.
  const st = isObj(ch) ? ch.stats : undefined;
  const stats: Stats = isObj(st) && STAT_IDS.every(id => Number.isInteger(st[id]) && (st[id] as number) >= 3 && (st[id] as number) <= 18)
    ? Object.fromEntries(STAT_IDS.map(id => [id, st[id] as number])) as Stats
    : { ...DEFAULT_STATS };
  // Growing up (#1399): the age and the adult stats, if the save has them; without, an adult.
  const ad = isObj(ch) ? ch.adult : undefined;
  const grown = isObj(ch) && Number.isInteger(ch.age) && (ch.age as number) >= 1 && isObj(ad) && STAT_IDS.every(k => Number.isInteger(ad[k]) && (ad[k] as number) >= 3 && (ad[k] as number) <= 18)
    ? { age: ch.age as number, adult: Object.fromEntries(STAT_IDS.map(k => [k, ad[k] as number])) as Stats } : {};
  // Talents (#1263): kept as saved; saves from before talents turn their two traits into known
  // talents (the same eight names) and roll a hidden one from the character id.
  const id = isObj(ch) && typeof ch.id === 'string' ? ch.id : '';
  const talents = isObj(ch) && validTalents(ch.talents) ? ch.talents.map(t => ({ ...t }))
    : isObj(ch) && Array.isArray(ch.traits) && validPick(ch.traits as string[]) ? startingTalents(ch.traits as Parameters<typeof startingTalents>[0], id)
    : [];
  // Quirks (#1362): kept as saved; saves from before quirks roll them from the character id, as a new Warden would.
  const savedQuirks = isObj(ch) && Array.isArray(ch.quirks) && ch.quirks.every(q => isObj(q) && typeof q.id === 'string' && typeof q.known === 'boolean')
    ? (ch.quirks as Quirk[]).map(q => ({ ...q })) : id ? startingQuirks(seedOf(id)) : null;
  const quirks = savedQuirks ? { quirks: savedQuirks } : {};
  // Lasting harms (#1392): kept as saved, if they're harms we know.
  const harmList = isObj(ch) && Array.isArray(ch.harms) ? (ch.harms as unknown[]).filter((h): h is Harm => typeof h === 'string' && h in HARM_NAME) : [];
  const harms = harmList.length ? { harms: harmList } : {};
  // Background (#1398): a scout, if the save says so.
  const background = isObj(ch) && BACKGROUNDS.includes(ch.background as Background) ? { background: ch.background as Background } : {};
  // The hike pack (#1400): kept if it's a pack we know.
  const pack = isObj(ch) && Array.isArray(ch.pack) && validPack(ch.pack as string[]) ? { pack: [...(ch.pack as KitId[])] } : {};
  const character = isObj(ch) && typeof ch.name === 'string'
    ? { id, name: ch.name, portrait: typeof ch.portrait === 'string' ? ch.portrait : null, talents, lastStandUsed: ch.lastStandUsed === true, stats, ...grown, ...quirks, ...harms, ...background, ...pack }
    : { id: '', name: '', portrait: null, talents: [], lastStandUsed: false, stats };
  // …and saves from before focus (#1238) have none; a stored focus is re-validated.
  const f = sim.focus;
  const focus = isObj(f) && typeof f.kind === 'string' && typeof f.id === 'string' ? parseFocus(`${f.kind}:${f.id}`) : null;
  // …and saves from before techniques/manuals (#1243) start with none.
  const strings = (x: unknown): string[] => (Array.isArray(x) && x.every(v => typeof v === 'string') ? [...x] : []);
  // …and saves from before the living world (#1279) play the full world.
  const cfg = sim.config as Record<string, unknown>;
  // …and saves from before the 60-day year (#1301) keep their calendar, with a 30-day winter after it.
  const cal = cfg.calendar as Region1State['config']['calendar'];
  const calendar = isNum(cal.thawDay) ? { ...cal } : { ...cal, thawDay: cal.winterDay + 30 };
  const config = { ...(cfg as unknown as Region1State['config']), calendar, world: validWorld(cfg.world) ? { ...cfg.world } : { ...FULL_WORLD } };
  // …and saves from before land supply (#1304) get it from their trip counts.
  const ex = sim.explore as Record<string, unknown>;
  const explore = isObj(ex.supply) ? { ...(ex as unknown as Region1State['explore']) } : { ...(ex as unknown as Region1State['explore']), supply: supplyFromWorked(ex.worked as Region1State['explore']['worked']) };
  // …and saves from before weather (#1282) get today's weather and no forecast.
  const day = isNum(sim.day) ? sim.day : 1;
  const weatherToday = WEATHER_IDS.includes(sim.weatherToday as never) ? sim.weatherToday as Region1State['weatherToday'] : weatherFor(seedOf(character.id), day, config.world, config.calendar);
  const forecast = isObj(sim.forecast) && Object.values(sim.forecast).every(w => WEATHER_IDS.includes(w as never)) ? { ...(sim.forecast as Region1State['forecast']) } : {};
  // …and an eating plan that isn't one of the three (or none at all, before #1305) means full rations.
  const eating = EATING_PLANS.includes(sim.eating as EatingPlan) ? sim.eating as EatingPlan : undefined;
  // …and a cold pit only at a real site (#1295); none before it.
  const coldPitAt = typeof sim.coldPitAt === 'string' && sim.coldPitAt in SITES ? sim.coldPitAt as Region1State['site'] : undefined;
  // …and saves from before learned planning (#1350) can plan: nobody loses their queue mid-run.
  const canPlan = typeof sim.canPlan === 'boolean' ? sim.canPlan : true;
  // Injuries (#1392): read as saved; an older save's `daysLeft` sprain is a minor one.
  const injuries = Array.isArray(sim.injuries) ? (sim.injuries as unknown[]).map(readInjury).filter((i): i is Injury => i !== null) : [];
  return { sim: { ...(sim as unknown as Region1State), canPlan, eating, coldPitAt, config, explore, deprivation, skills, character, focus, techniques: strings(sim.techniques), manuals: strings(sim.manuals), weatherToday, forecast, ...(injuries.length ? { injuries } : { injuries: undefined }), kit: readKit(sim.kit), dressings: typeof sim.dressings === 'number' && sim.dressings > 0 ? sim.dressings : undefined }, queue: queue as QueueItem[], stage: road ? 'road' : 'reach', ...(road ? { road } : {}), ...(meeting ? { meeting } : {}), ...(!road && data.stayed === true ? { stayed: true } : {}) };
}
