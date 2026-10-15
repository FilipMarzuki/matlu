/**
 * Web-game runs (#1559): the server's half of re-simulated runs. The page writes down what it did
 * (web-log.ts); this checks a log and plays it again from its start, through the same controller
 * calls the page made, so api.ts can write a record only for a run that replays to what the page
 * says (POST /api/v1/runs/submit). A faked score doesn't replay to itself.
 *
 * The moves are the session's, but replayed as the page plays them, which differs from an API game
 * in three places:
 * - A Reach action that can't be done now is tried anyway: the page lets you tap one, and the sim
 *   skips it with a line in the journal and no hours spent. (The API refuses it, to tell its player why.)
 * - Answering an encounter doesn't carry on with the day: the page waits for its CARRY ON button,
 *   logged as the day's plan (`{ plan }`) if it ran anything, since that's all carrying on does.
 * - Pins (#1380) can be weighed and let go: `{ set: { pin: "<id>|<0–3>" } }`, `{ set: { forget } }`.
 * Meeting the caravan, boarding and staying behind need no choice, so the page doesn't log them;
 * the replay does them as the session does (session.ts advance). Nothing in between reads what
 * they change, so doing them a little earlier than the page did ends the same way.
 *
 * Pure: no network, no storage.
 */

import {
  makeWarden, act, choose, endTheDay, runQueuedDay, meetingChoose, roadAct, roadChoose, roadEndDay, forget, weighPin, queueLocked,
  type AppState,
} from '../artificer-app/controller';
import { ACTIONS, repack, type QueueItem } from '../artificer/region1';
import { RINGS, type Ring } from '../artificer/exploration';
import { talentOffer, seedOf, TALENT_PICKS, type TalentId } from '../artificer/talents';
import { validStats } from '../artificer/stats';
import { START_AGES } from '../artificer/growing';
import { validPack } from '../artificer/kit';
import { FEATURES, validFeatures } from '../artificer/features';
import { GRADES, type Tool } from '../artificer/crafting';
import { advance, applySet, isRoadAction, phaseOf, view } from './session';
import { measure, type GameMeasures } from './record-of';
import { WEB_LOG_VERSION, type WebLog, type WebMove, type WebStart } from './web-log';

/** The longest plan a day can carry: far more than any day holds, and a bound on what's replayed. */
const MAX_PLAN = 200;

// ── Checking and replaying (the server) ─────────────────────────────────────

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';

/** A Reach action as the queue holds it: "scout", "gather@2", or { q, opts } with string options. */
function validItem(item: unknown): item is QueueItem {
  const q = isObj(item) ? item.q : item;
  if (isObj(item) && (!isObj(item.opts) || !Object.values(item.opts).every(isStr))) return false;
  if (!isStr(q)) return false;
  const [id, ring] = q.split('@');
  if (!(id in ACTIONS)) return false;
  if (ring === undefined) return true;
  const r = Number(ring) as Ring;
  return RINGS.includes(r) && (r === 1 || ACTIONS[id as keyof typeof ACTIONS].ringed === true);
}

/** A tool as a legacy carries it: an item, a grade, maybe the grade it was made at and what it teaches. */
const validTool = (t: unknown): t is Tool =>
  isObj(t) && isStr(t.item) && GRADES.includes(t.grade as Tool['grade']) && (t.crafted === undefined || GRADES.includes(t.crafted as Tool['grade']))
  && (t.heirloom === undefined || typeof t.heirloom === 'boolean') && (t.made === undefined || (isObj(t.made) && Object.values(t.made).every(v => typeof v === 'number')));

/**
 * Why a log's start can't be a real Warden's, or null if it can: the creation screen's own rules
 * (the talents on offer to this id, point-buy stats, the ages, a pack that fits) and known features.
 */
export function startProblem(s: unknown): string | null {
  if (!isObj(s)) return 'The log has no start.';
  if (!isStr(s.id) || !/^[\w-]{3,64}$/.test(s.id)) return 'The Warden\'s id isn\'t one the game makes.';
  if (s.name !== undefined && (!isStr(s.name) || [...s.name].length > 24)) return 'The name is over 24 characters.';
  if (s.portrait !== undefined && !(isStr(s.portrait) && s.portrait.length <= 32)) return 'That isn\'t a portrait.';
  if (s.chosen !== undefined) {
    const offer = talentOffer(seedOf(s.id));
    // Up to two (#1728): fewer, or none, is a choice the creation screen allows — it adds to the difficulty.
    if (!Array.isArray(s.chosen) || s.chosen.length > TALENT_PICKS || new Set(s.chosen).size !== s.chosen.length || !s.chosen.every(t => offer.includes(t as TalentId))) {
      return `The talents must be up to ${TALENT_PICKS} of the ones this Warden was offered.`;
    }
  }
  if (s.stats !== undefined && !validStats(s.stats)) return 'The stats aren\'t a point-buy the creation screen allows.';
  if (s.age !== undefined && !START_AGES.includes(s.age as number)) return `The age is one of ${START_AGES.join(', ')}.`;
  if (s.pack !== undefined && !(Array.isArray(s.pack) && s.pack.every(isStr) && validPack(s.pack))) return 'The pack isn\'t one that fits.';
  const known = FEATURES.filter(f => f.kind === 'rules').map(f => f.id);
  if (!validFeatures(s.features) || Object.keys(s.features).some(k => !known.includes(k))) return 'The rule features aren\'t ones the game knows.';
  if (s.heirlooms !== null && !(Array.isArray(s.heirlooms) && s.heirlooms.length <= 40 && s.heirlooms.every(validTool))) return 'The heirlooms aren\'t tools.';
  if (s.heirloomsFrom !== undefined && s.heirloomsFrom !== null && !isStr(s.heirloomsFrom)) return 'heirloomsFrom is a game id.';
  return null;
}

/** Why a log isn't one (shape only: whether its moves are legal is the replay's call), or null. */
export function logProblem(x: unknown, maxMoves: number): string | null {
  if (!isObj(x)) return 'The body must carry the run\'s log.';
  if (x.v !== WEB_LOG_VERSION) return 'The log is in a format this server doesn\'t read.';
  if (!isStr(x.version)) return 'The log doesn\'t say which version of the game made it.';
  if (!Array.isArray(x.moves)) return 'The log has no moves.';
  if (x.moves.length > maxMoves) return `The log has more than ${maxMoves} moves.`;
  return startProblem(x.start);
}

/** The first Warden of a log: makeWarden, then the pack if one was chosen, as the page made it. */
export function startOf(s: WebStart): AppState {
  const { id, name, portrait, chosen, stats, age } = s;
  const spec = { id, ...(name !== undefined ? { name } : {}), ...(portrait !== undefined ? { portrait } : {}), ...(chosen ? { chosen } : {}), ...(stats ? { stats } : {}), ...(age !== undefined ? { age } : {}) };
  const legacy = s.heirlooms === null ? undefined : { known: [], concepts: {}, heirlooms: s.heirlooms.map(t => ({ ...t })) };
  const app = makeWarden(spec, legacy, s.features);
  return s.pack ? { ...app, sim: repack(app.sim, s.pack) } : app;
}

/**
 * One logged move, played as the page plays it. A string is why it can't be: the page never makes
 * such a move, so a log holding one wasn't written by the page.
 */
export function stepWeb(a: AppState, m: WebMove): AppState | string {
  const phase = phaseOf(a);
  if (phase === 'ended') return 'The run was already over.';
  if (!isObj(m)) return 'That isn\'t a move.';
  if ('set' in m) {
    if (!isObj(m.set)) return 'That isn\'t a setting.';
    const { forget: pinGone, pin, ...rest } = m.set;
    let s = a;
    if (pinGone !== undefined) {
      if (!isStr(pinGone)) return 'forget takes a pin id.';
      s = forget(s, pinGone);
    }
    if (pin !== undefined) {
      const [id, stars] = isStr(pin) ? pin.split('|') : [];
      const n = Number(stars);
      if (!id || ![0, 1, 2, 3].includes(n)) return 'pin is "<pin id>|<0–3>".';
      s = weighPin(s, id, n as 0 | 1 | 2 | 3);
    }
    return Object.keys(rest).length ? applySet(s, rest) : s;
  }
  if ('choose' in m) {
    if (phase !== 'encounter' && phase !== 'meeting' && phase !== 'road-encounter') return 'There was nothing to answer.';
    // The same open answers the session offers (and the page shows enabled): an unmet one can't be taken.
    const open = view({ id: a.sim.character.id, app: a }).moves.flatMap(o => ('choose' in o.move ? [o.move.choose] : []));
    if (!isStr(m.choose) || !open.includes(m.choose)) return `"${String(m.choose)}" wasn't an answer open then.`;
    return phase === 'meeting' ? meetingChoose(a, m.choose) : phase === 'encounter' ? choose(a, m.choose) : roadChoose(a, m.choose);
  }
  if (phase !== 'day' && phase !== 'road') return 'Something needed an answer first.';
  if ('endDay' in m) return m.endDay === true ? (phase === 'road' ? roadEndDay(a) : endTheDay(a)) : 'endDay is true.';
  if ('do' in m) {
    if (phase === 'road') return isStr(m.do) && isRoadAction(m.do) ? roadAct(a, m.do as Parameters<typeof roadAct>[1]) : `"${String(m.do)}" isn't a road action.`;
    return validItem(m.do) ? act(a, m.do) : `There's no action "${JSON.stringify(m.do)}".`;
  }
  if ('plan' in m) {
    if (phase !== 'day') return 'There\'s no planning on the road.';
    if (queueLocked(a)) return 'The Warden hadn\'t learned to plan yet.';
    if (!Array.isArray(m.plan) || m.plan.length > MAX_PLAN || !m.plan.every(validItem)) return 'That isn\'t a plan of actions.';
    return runQueuedDay({ ...a, queue: m.plan as QueueItem[] });
  }
  return 'That isn\'t a move the web game makes.';
}

export type Replay =
  | { ok: true; app: AppState; measures: GameMeasures }
  | { ok: false; error: string; at: number };

/**
 * Play a log again from its start. Every move must be one the game allows then, and the run must
 * end on the last one: a log that stops short, or goes on after the end, isn't a whole run.
 */
export function replayWeb(log: Pick<WebLog, 'start' | 'moves'>): Replay {
  return replayFrom(startOf(log.start), log.moves);
}

/** Play moves on from a state (a log's first Warden, or a test's fixture), as `replayWeb` does. */
export function replayFrom(from: AppState, moves: readonly WebMove[], measures: GameMeasures = {}): Replay {
  let a = advance(from);
  let m = measure(measures, a);
  for (let i = 0; i < moves.length; i++) {
    const next = stepWeb(a, moves[i]);
    if (typeof next === 'string') return { ok: false, error: `Move ${i + 1}: ${next}`, at: i };
    a = advance(next);
    m = measure(m, a);
  }
  if (phaseOf(a) !== 'ended') return { ok: false, error: 'The moves stop before the run ends.', at: moves.length };
  return { ok: true, app: a, measures: m };
}

// ── Heirlooms ──────────────────────────────────────────────────────────────

/**
 * The heirlooms a log claims, each one among those a checked run left (`allowed`): the page only
 * ever passes on some of what the last Warden left (a pack can make one unneeded), never more.
 */
export function heirloomsAllowed(claimed: readonly Tool[], allowed: readonly Tool[]): boolean {
  const key = (t: Tool): string => JSON.stringify({ item: t.item, grade: t.grade, crafted: t.crafted ?? null, made: t.made ? Object.entries(t.made).sort() : null });
  const ok = new Set(allowed.map(key));
  return claimed.every(t => ok.has(key(t)));
}
