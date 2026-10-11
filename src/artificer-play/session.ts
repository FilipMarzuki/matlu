/**
 * The game session core (#1554, plan: docs/spikes/artificer-play-api.md).
 *
 * Every way of playing the Artificer from outside (the HTTP API, the remote MCP server and the text
 * console, #1555–#1557) goes through here: start a game, see what the player sees and may do,
 * apply one move, report what changed. It adds no rules of its own. The game is the app's
 * controller (src/artificer-app/controller.ts, DOM-free), and the text is what the AI benchmark's
 * players already read (src/artificer-ai/observe.ts), so an outside AI plays the same game, from
 * the same view, as our own runs and a person on the page.
 *
 * Pure: no network, no storage, no clock. The only randomness is a fresh game id when the caller
 * gives no seed, and the id is what seeds the run, so a game is fully determined by its id and its
 * moves.
 */

import {
  makeWarden, act, choose, carryOn, endTheDay, runQueuedDay, chooseFocus, chooseEating, settle, queueLocked,
  meetCaravan, meetingChoose, rideCaravan, stayBehind, roadAct, roadChoose, roadEndDay, newCharacterId,
  serialize as serializeApp, deserialize as deserializeApp, SAVE_VERSION, type AppState,
} from '../artificer-app/controller';
import { ACTIONS, DAY_HOURS, EATING_PLANS, SITES, blockedReason, queueHours, queueId, type ActionId, type EatingPlan, type QueueItem, type Region1State, type SiteId } from '../artificer/region1';
import { RINGS, reachable, type Ring } from '../artificer/exploration';
import { parseFocus } from '../artificer/focus';
import { encounterById, optionsFor } from '../artificer/encounters';
import { meetingOptions } from '../artificer/caravan-meeting';
import { ROAD_DAYS, peopleHere, type RoadActionId, type RoadState } from '../artificer/road';
import { observe, observeEncounter, observeMeeting, observeRoad } from '../artificer-ai/observe';
import { matchQuestion, QUESTION_CHARS } from '../artificer/free-questions';
import { cleanQuestion, QUESTION_NOTICE } from './questions';

/**
 * The session format's version. A stored game from another version doesn't load (it starts over
 * rather than misreading), and every run record carries it so results compare like with like.
 * Bump it with the app's SAVE_VERSION or when the meaning of a move changes.
 */
export const GAME_VERSION = `play-1/save-${SAVE_VERSION}`;

export interface Game {
  /** Seeds the whole run (the Warden's id): the same id and the same moves give the same game. */
  id: string;
  app: AppState;
}

/**
 * A move, as plain data so it travels over HTTP and MCP unchanged:
 * - `{ do }` one action now: a Reach action (`"scout"`, `"gather@2"`, or `{ q, opts }` for one
 *   with options), or on the road a road action (`"rest"`, `"talk:hf-maren"`).
 * - `{ endDay }` end the day: the night passes.
 * - `{ plan }` a whole day's actions in one go, once the Warden has learned to plan.
 * - `{ choose }` an option in an encounter or the caravan meeting.
 * - `{ set }` what the mind works on (`focus`, a key like `"goal:larder"` or `"none"`), how to
 *   eat (`eating`) or where to camp (`site`). Free: no hours.
 * - `{ ask }` on the road, a free question to someone here, in the player's own words (#1575):
 *   once per person per stay. It's matched to what they know and played as the road action
 *   `question:<person>:<topic>`, so the words never enter the game, only the topic they matched.
 */
export type Move =
  | { do: QueueItem | RoadActionId | string }
  | { endDay: true }
  | { plan: (QueueItem | string)[] }
  | { choose: string }
  | { set: { focus?: string; eating?: string; site?: string } }
  | { ask: { person: string; question: string } };

export type Phase = 'day' | 'encounter' | 'meeting' | 'road' | 'road-encounter' | 'ended';

/** A move the player can make now, with a short label (and the hours it takes, for actions). */
export interface MoveOption {
  move: Move;
  label: string;
  hours?: number;
}

export interface View {
  phase: Phase;
  /** The full view: everything the player knows now, as the AI harness writes it. */
  text: string;
  /** One line: day, hours, body, the stores that matter. Sent with every move instead of the full text. */
  status: string;
  /** The moves open now. Free settings (`set`) aren't listed; the text says what they can be. */
  moves: MoveOption[];
}

export type ApplyResult =
  | {
    ok: true; game: Game; changed: string[]; view: View;
    /** The move as played: the same move, except an `ask` becomes the road action it was matched to. Store this one. */
    played: Move;
    /** For an `ask`: the question, cleaned to keep (questions.ts), and how it went. */
    asked?: AskedQuestion;
  }
  | { ok: false; error: string; moves: MoveOption[] };

/** A free question as asked (#1575): what may be kept of it, who, what it matched, and their trust then. */
export interface AskedQuestion {
  person: string;
  text: string | null;
  blocked: boolean;
  topic: string | null;
  trust: number;
}

// ── Starting and viewing ────────────────────────────────────────────────────

/** A new game: a new Warden, seeded by `seed` if given (so it can be replayed), else a fresh one. */
export function startGame(opts: { seed?: string; name?: string } = {}): Game {
  const id = opts.seed ? `play-${opts.seed}` : `play-${newCharacterId().slice(2)}`;
  return { id, app: advance(makeWarden({ id, name: opts.name?.trim() || 'Warden' })) };
}

/** A game around an existing app state (for tests, and for loading). */
export function gameFrom(app: AppState, id: string): Game {
  return { id, app: advance(app) };
}

export function view(g: Game): View {
  const a = g.app;
  const phase = phaseOf(a);
  switch (phase) {
    case 'day':
      return { phase, text: observe(a.sim), status: dayStatus(a.sim), moves: dayMoves(a) };
    case 'encounter':
      return { phase, text: observeEncounter(a.sim), status: dayStatus(a.sim), moves: encounterMoves(a.sim) };
    case 'meeting':
      return {
        phase, text: observeMeeting(a.sim, a.meeting!), status: `The thaw, day ${a.sim.day} · meeting the caravan`,
        moves: meetingOptions(a.sim, a.meeting!).filter(o => !o.unmet).map(o => ({ move: { choose: o.option.id }, label: o.option.label })),
      };
    case 'road':
      return { phase, text: [observeRoad(a.road!), freeQuestionsText(a.road!)].filter(Boolean).join('\n\n'), status: roadStatus(a.road!), moves: roadMoves(a.road!) };
    case 'road-encounter':
      // The road carries the Warden's body and mind under the same names, so the encounter view reads it as it reads the Reach.
      return { phase, text: observeEncounter(a.road! as unknown as Region1State), status: roadStatus(a.road!), moves: encounterMoves(a.road! as unknown as Region1State) };
    case 'ended':
      return { phase, text: endText(a), status: `Run over: ${outcomeWord(a)}`, moves: [] };
  }
}

// ── Moves ───────────────────────────────────────────────────────────────────

/** Apply one move. A refused move changes nothing and says why, with the moves that are open. */
export function apply(g: Game, move: Move): ApplyResult {
  const before = g.app;
  const refuse = (error: string): ApplyResult => ({ ok: false, error, moves: view(g).moves });
  const phase = phaseOf(before);
  let next: AppState;

  if (phase === 'ended') return refuse('The run is over. Start a new game to play again.');
  let played: Move = move;
  let asked: AskedQuestion | undefined;

  if ('ask' in move) {
    if (phase !== 'road') return refuse(phase === 'road-encounter' ? 'Something needs an answer first.' : 'There\'s no one to ask yet: free questions are for the people you meet on the road.');
    const r = before.road!;
    const { person, question } = move.ask;
    const who = peopleHere(r).find(p => p.id === person);
    if (!who) return refuse(`There's no one called "${person}" here. Here: ${peopleHere(r).map(p => `${p.name} (${p.id})`).join(', ')}.`);
    if (r.hoursToday >= DAY_HOURS) return refuse('The day is spent: end the day, and ask tomorrow.');
    if ((r.questioned ?? []).includes(person)) return refuse(`You've asked ${who.name} your question this stay. Ask someone else, or ask again at the next stop.`);
    const clean = cleanQuestion(question);
    if (!clean) return refuse(`Ask a question, in up to ${QUESTION_CHARS} characters.`);
    // A blocked question matches nothing: they deflect, and it's kept without its words.
    const topic = clean.text ? matchQuestion(person, clean.text, r.asked?.[person] ?? []) : null;
    played = { do: `question:${person}${topic ? `:${topic}` : ''}` };
    asked = { person, text: clean.text, blocked: clean.blocked, topic, trust: Math.round(r.trust[person] ?? 0) };
    next = roadAct(before, played.do as RoadActionId);
  } else if ('set' in move) {
    const r = applySet(before, move.set);
    if (typeof r === 'string') return refuse(r);
    next = r;
  } else if (phase === 'encounter' || phase === 'meeting' || phase === 'road-encounter') {
    if (!('choose' in move)) return refuse(`Something needs an answer first: choose one of ${view(g).moves.map(m => (m.move as { choose: string }).choose).join(', ')}.`);
    const open = view(g).moves.map(m => (m.move as { choose: string }).choose);
    if (!open.includes(move.choose)) return refuse(`"${move.choose}" isn't an answer you can give now. Open: ${open.join(', ')}.`);
    next = phase === 'meeting' ? meetingChoose(before, move.choose) : phase === 'encounter' ? choose(before, move.choose) : roadChoose(before, move.choose);
    // A planned day that an encounter paused goes on once it's answered.
    if (phase === 'encounter' && !next.sim.pending) next = carryOn(next);
  } else if (phase === 'road') {
    if ('endDay' in move) next = roadEndDay(before);
    else if ('do' in move) {
      const id = typeof move.do === 'string' ? move.do : '';
      if (!isRoadAction(id)) return refuse(`"${id}" isn't a road action. Road actions are rest, wait, tend, help, or talk:/ask:/tell:/heal:/sell:/buy:/accept:/complete:/learn:/appraise:/craft:/study: followed by an id from the view. A free question is its own move: { "ask": { "person", "question" } }.`);
      next = roadAct(before, id as RoadActionId);
    } else return refuse('On the road: do one road action, end the day, or change your focus.');
  } else {
    // The Reach, between encounters.
    if ('endDay' in move) next = endTheDay(before);
    else if ('do' in move) {
      const why = actionRefusal(before.sim, move.do);
      if (why) return refuse(why);
      next = act(before, move.do as QueueItem);
    } else if ('plan' in move) {
      const locked = queueLocked(before);
      if (locked) return refuse(`${locked} Do one thing at a time with { do }.`);
      // Only that each planned action exists: what's possible changes as the day goes (scouting a
      // ring opens it for the next action), and the sim skips anything impossible with a journal note.
      for (const item of move.plan) {
        const why = actionRefusal(before.sim, item, { syntaxOnly: true });
        if (why) return refuse(`In the plan: ${why}`);
      }
      next = runQueuedDay({ ...before, queue: move.plan as QueueItem[] });
    } else return refuse('Nothing needs an answer now: do an action, end the day, or plan the day.');
  }

  const settled = advance(next);
  const game = { id: g.id, app: settled };
  return { ok: true, game, changed: [...changes(before, next), ...changes(next, settled)], view: view(game), played, ...(asked ? { asked } : {}) };
}

// ── Saving ──────────────────────────────────────────────────────────────────

export function serialize(g: Game): string {
  return JSON.stringify({ version: GAME_VERSION, id: g.id, app: JSON.parse(serializeApp(g.app)) });
}

/** A saved game, or null for anything that isn't one from this version. */
export function deserialize(raw: string): Game | null {
  try {
    const o = JSON.parse(raw) as { version?: string; id?: string; app?: unknown };
    if (o.version !== GAME_VERSION || typeof o.id !== 'string') return null;
    const app = deserializeApp(JSON.stringify(o.app));
    return app ? { id: o.id, app } : null;
  } catch {
    return null;
  }
}

// ── Internals ───────────────────────────────────────────────────────────────

function phaseOf(a: AppState): Phase {
  if (a.stage === 'road' && a.road) return a.road.outcome ? 'ended' : a.road.pending ? 'road-encounter' : 'road';
  if (a.meeting && !a.meeting.ended) return 'meeting';
  if (a.sim.outcome) return 'ended';
  return a.sim.pending ? 'encounter' : 'day';
}

/**
 * The steps between moves that need no choice: a Warden who survives the thaw meets the caravan;
 * a meeting that ended aboard rides on down the road, one that ended with you staying behind ends
 * the run there. The page does these on a button; here they just happen.
 */
function advance(a: AppState): AppState {
  let s = a;
  if (s.stage !== 'road' && s.sim.outcome?.kind === 'survived' && !s.meeting && !s.stayed) s = meetCaravan(s);
  if (s.meeting?.ended === 'board') s = rideCaravan(s);
  else if (s.meeting?.ended === 'stay') s = stayBehind(s);
  return s;
}

/**
 * What a move added to the journal: Reach entries, the caravan master's lines and road entries.
 * The road's journal starts as a copy of the Reach's, so a road made by this move counts from there.
 */
function changes(before: AppState, after: AppState): string[] {
  const out = after.sim.log.slice(before.sim.log.length).map(l => l.text);
  if (after.meeting) {
    const from = before.meeting ? before.meeting.lines.length : 0;
    out.push(...after.meeting.lines.slice(from).map(l => (l.speaker ? `${l.speaker}: ${l.text}` : l.text)));
  }
  if (after.road) out.push(...after.road.log.slice(before.road ? before.road.log.length : after.sim.log.length).map(l => l.text));
  return out;
}

/**
 * Why a Reach action can't be done now, or null. Same checks and words the observation uses.
 * `syntaxOnly` checks just that the action and ring exist (for a plan, which runs later).
 */
function actionRefusal(s: Region1State, item: unknown, opts: { syntaxOnly?: boolean } = {}): string | null {
  const q = typeof item === 'string' ? item : item && typeof item === 'object' && 'q' in item ? String((item as { q: unknown }).q) : '';
  const [id, ringText] = q.split('@');
  if (!(id in ACTIONS)) return `There's no action "${q}". The actions are listed in the view (e.g. "scout", "gather@2").`;
  const def = ACTIONS[id as ActionId];
  const ring = (ringText === undefined ? 1 : Number(ringText)) as Ring;
  if (!RINGS.includes(ring) || (ring !== 1 && !def.ringed)) return `"${q}" isn't a valid ring for ${id}${def.ringed ? ' (rings are 1, 2 and 3)' : ': it isn\'t done out on the land'}.`;
  if (opts.syntaxOnly) return null;
  if (def.ringed && !reachable(s.explore, ring)) return `You don't know the way to ring ${ring} yet: scout the ring before it first.`;
  const itemOpts = typeof item === 'object' && item && 'opts' in item ? (item as { opts: Record<string, string> }).opts : {};
  const blocked = blockedReason(s, id as ActionId, ring, itemOpts);
  if (blocked) return `Can't ${id}${def.ringed ? ` in ring ${ring}` : ''} now: ${blocked}.`;
  if (s.hoursToday >= DAY_HOURS) return 'The day is spent. End the day.';
  return null;
}

/** The Reach actions open now (as the observation lists them, minus the blocked ones), then ending the day. */
function dayMoves(a: AppState): MoveOption[] {
  const s = a.sim;
  const out: MoveOption[] = [];
  if (s.hoursToday < DAY_HOURS) {
    for (const id of Object.keys(ACTIONS) as ActionId[]) {
      const def = ACTIONS[id];
      for (const ring of def.ringed ? RINGS.filter(r => reachable(s.explore, r)) : [1 as Ring]) {
        if (blockedReason(s, id, ring)) continue;
        const q = queueId(id, ring);
        out.push({ move: { do: q }, label: `${def.name}${def.ringed ? ` (ring ${ring})` : ''}`, hours: Math.round(queueHours(q, s) * 10) / 10 });
      }
    }
  }
  out.push({ move: { endDay: true }, label: 'End the day' });
  return out;
}

function encounterMoves(s: Region1State): MoveOption[] {
  const t = s.pending ? encounterById(s.pending.id) : undefined;
  if (!t) return [];
  return optionsFor(s, t).filter(o => !o.unmet).map(o => ({ move: { choose: o.option.id }, label: o.option.label }));
}

/** The road's everyday actions and a talk with each person here; the view lists the rest (trade, lessons, quests…). */
function roadMoves(r: RoadState): MoveOption[] {
  const out: MoveOption[] = (['rest', 'wait', 'tend', 'help'] as const).map(id => ({ move: { do: id }, label: id[0].toUpperCase() + id.slice(1) }));
  for (const p of peopleHere(r)) out.push({ move: { do: `talk:${p.id}` }, label: `Talk with ${p.name}` });
  out.push({ move: { endDay: true }, label: 'End the day' });
  return out;
}

/** Who can still be asked a free question this stay (#1575), and how: a line under the road's view. */
function freeQuestionsText(r: RoadState): string {
  const open = peopleHere(r).filter(p => !(r.questioned ?? []).includes(p.id));
  if (!open.length) return '';
  return `Free questions: once per stay you may ask each person here one question in your own words, as { "ask": { "person": "<id>", "question": "…" } }, up to ${QUESTION_CHARS} characters. They answer from what they know, whatever their trust. ${QUESTION_NOTICE} Not asked yet: ${open.map(p => `${p.name} (${p.id})`).join(', ')}.`;
}

const ROAD_VERBS = ['talk', 'ask', 'question', 'tell', 'heal', 'sell', 'buy', 'accept', 'complete', 'learn', 'appraise', 'craft', 'study'];
function isRoadAction(id: string): boolean {
  if (['rest', 'wait', 'tend', 'help'].includes(id)) return true;
  const [verb, rest] = id.split(/:(.*)/s);
  return ROAD_VERBS.includes(verb) && !!rest;
}

/** Free settings: focus, eating, site. A string is the reason one can't be set. */
function applySet(a: AppState, set: { focus?: string; eating?: string; site?: string }): AppState | string {
  let s = a;
  if (set.focus !== undefined) {
    const focus = set.focus === 'none' ? null : parseFocus(set.focus);
    if (set.focus !== 'none' && !focus) return `"${set.focus}" isn't a focus. Focus keys look like "goal:larder", "skill:hunting" or "concept:joinery", or "none".`;
    s = chooseFocus(s, focus);
  }
  if (set.eating !== undefined) {
    if (!EATING_PLANS.includes(set.eating as EatingPlan)) return `Eating is one of ${EATING_PLANS.join(', ')}.`;
    if (s.stage === 'road') return 'On the road the caravan feeds you.';
    s = chooseEating(s, set.eating as EatingPlan);
  }
  if (set.site !== undefined) {
    if (!(set.site in SITES)) return `A camp site is one of ${Object.keys(SITES).join(', ')}.`;
    if (s.stage === 'road') return 'You left your camp behind.';
    s = settle(s, set.site as SiteId);
  }
  return s;
}

const r0 = (n: number) => Math.round(n);
function dayStatus(s: Region1State): string {
  const v = s.vitals, st = s.stores;
  return `Day ${s.day} · ${s.hoursToday}/${DAY_HOURS}h · Vigor ${r0(v.vigor.current)}/${r0(v.vigor.cap)} · Clarity ${r0(v.clarity.current)}/${r0(v.clarity.cap)} · Condition ${r0(v.condition)} · food ${st.rawFood} · water ${st.water} · firewood ${st.firewood} · rations ${st.rations}`;
}

function roadStatus(r: RoadState): string {
  const v = r.vitals;
  return `Road day ${r.day}/${ROAD_DAYS} · ${r.hoursToday}/${DAY_HOURS}h · Vigor ${r0(v.vigor.current)}/${r0(v.vigor.cap)} · Clarity ${r0(v.clarity.current)}/${r0(v.clarity.cap)} · Condition ${r0(v.condition)} · marks ${r.marks}`;
}

function outcomeWord(a: AppState): string {
  if (a.stage === 'road' && a.road?.outcome) return a.road.outcome.kind === 'arrived' ? 'reached Mistheim' : a.road.outcome.kind;
  if (a.stayed) return 'stayed in the Reach at the thaw';
  const o = a.sim.outcome;
  return o ? `${o.kind}${o.grade ? ` (${o.grade})` : ''} on day ${a.sim.day}` : 'unknown';
}

function endText(a: AppState): string {
  const log = a.stage === 'road' && a.road ? a.road.log : a.sim.log;
  return [`The run is over: ${outcomeWord(a)}.`, '', 'The last of the journal:', ...log.slice(-6).map(l => `- ${l.text}`)].join('\n');
}
