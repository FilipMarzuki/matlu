/**
 * Games set up for tests: built through the session core, as a player would get there, so they
 * hold whatever the real game holds at that point.
 */

import { createRegion1, type QueueItem, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { peopleHere, villageOf, type RoadActionId } from '../artificer/road';
import { scouted } from '../artificer/exploration';
import { featureOn } from '../artificer/features';
import {
  act, choose, carryOn, endTheDay, runQueuedDay, chooseFocus, chooseEating, settle, weighPin, meetCaravan, meetingChoose, rideCaravan, stayBehind,
  roadAct, roadChoose, roadEndDay, serialize as serializeApp, deserialize as deserializeApp, type AppState,
} from '../artificer-app/controller';
import { parseFocus } from '../artificer/focus';
import { view, apply, gameFrom, type Game, type Move } from './session';
import { recordMove, runOver, type Recorder, type WebMove } from './web-log';
import { matchQuestion } from '../artificer/free-questions';

const must = (g: Game, m: Move): Game => {
  const r = apply(g, m);
  if (!r.ok) throw new Error(`${JSON.stringify(m)} refused: ${r.error}`);
  return r.game;
};

/**
 * A game that has reached Hollowford, the caravan road's first village: a Warden who came through
 * the winter hale, took the first answer at the caravan meeting, and rode on.
 */
export function hollowfordGame(): Game {
  const s = createRegion1({}, undefined, { id: 'play-thaw', name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  const sim: Region1State = { ...s, day: 61, vitals, tools: [], stores: { ...s.stores, rawFood: 10, water: 10, materials: 6, hides: 0, rations: 0 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  let g = gameFrom({ sim, queue: [], stage: 'reach' }, 'play-thaw');
  for (let i = 0; i < 6 && view(g).phase === 'meeting'; i++) g = must(g, view(g).moves[0].move);
  for (let i = 0; i < 20 && view(g).phase !== 'ended' && (view(g).phase === 'road-encounter' || !villageOf(g.app.road!)); i++) {
    g = must(g, view(g).phase === 'road-encounter' ? view(g).moves[0].move : { endDay: true });
  }
  if (villageOf(g.app.road!) !== 'hollowford') throw new Error('the fixture game did not reach Hollowford');
  return g;
}

/** A Warden at the thaw, hale, still in the Reach: the caravan has come up the valley. */
export function thawApp(): AppState {
  const s = createRegion1({}, undefined, { id: 'play-thaw', name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  const sim: Region1State = { ...s, day: 61, vitals, tools: [], stores: { ...s.stores, rawFood: 10, water: 10, materials: 6, hides: 0, rations: 0 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  return { sim, queue: [], stage: 'reach' };
}

/** Taps tried each day before planning is learned: some can't be done yet, and the page lets you tap them anyway. */
const ONE_AT_A_TIME: QueueItem[] = ['explore', 'water', 'gather', 'explore@2', 'hunt', 'wood', 'gather', 'rest'];
const DAY_PLAN: QueueItem[] = ['water', 'gather', 'wood', 'preserve', 'gather@2', 'wood', 'build'];

/**
 * Play like the web page (src/artificer-app/main.ts): the controller calls its buttons make, each
 * written down the way the page writes it (web-log.ts recordMove), and the steps the page takes on
 * a button but doesn't log (meeting the caravan, boarding, staying behind). `reload` saves and
 * loads the game after every tap, as reloading the page would. The policy is simple and steady, not
 * good: it's there to touch every kind of move: taps that get skipped, settings, pins, planned
 * days, encounters and carrying on, the meeting, road actions, free questions and road encounters.
 */
export function pagePlay(from: AppState, rec: Recorder, opts: { reload?: boolean; maxTaps?: number; stay?: boolean } = {}): { app: AppState; rec: Recorder } {
  let app = from;
  const tap = (next: AppState, move: WebMove | null): void => {
    if (move) rec = recordMove(rec, app, next, move)!;
    app = opts.reload ? deserializeApp(serializeApp(next))! : next;
  };
  const firstOpen = (): string => {
    const m = view({ id: app.sim.character.id, app }).moves.find(o => 'choose' in o.move);
    return (m!.move as { choose: string }).choose;
  };
  let day = -1, k = 0;
  const once = new Set<string>();
  for (let i = 0; i < (opts.maxTaps ?? 6000) && !runOver(app); i++) {
    if (app.stage === 'road' && app.road) {
      const r = app.road;
      if (r.pending) { const c = firstOpen(); tap(roadChoose(app, c), { choose: c }); continue; }
      if (r.day !== day) { day = r.day; k = 0; }
      const people = peopleHere(r);
      const asking = featureOn(r.features, 'free-questions') ? people.find(p => !(r.questioned ?? []).includes(p.id)) : undefined;
      const step = k++;
      if (step === 0 && people.length) tap(roadAct(app, `talk:${people[0].id}` as RoadActionId), { do: `talk:${people[0].id}` });
      else if (step === 1 && asking) {
        // As the page's question form does: matched here, played as the topic it matched.
        const topic = matchQuestion(asking.id, 'Where does the iron here come from?', r.asked?.[asking.id] ?? []);
        const id = `question:${asking.id}${topic ? `:${topic}` : ''}`;
        tap(roadAct(app, id as RoadActionId), { do: id });
      } else if (step === 2) tap(roadAct(app, 'rest'), { do: 'rest' });
      else if (step > 2) tap(roadEndDay(app), { endDay: true });
      continue;
    }
    if (app.meeting && !app.meeting.ended) {
      // The last answer (watching them go) when asked to stay, else the first open one.
      const open = view({ id: app.sim.character.id, app }).moves.flatMap(o => ('choose' in o.move ? [o.move.choose] : []));
      const c = opts.stay ? open[open.length - 1] : open[0];
      tap(meetingChoose(app, c), { choose: c });
      continue;
    }
    if (app.meeting?.ended === 'board') { tap(rideCaravan(app), null); continue; }
    if (app.meeting?.ended === 'stay') { tap(stayBehind(app), null); continue; }
    const s = app.sim;
    if (s.outcome?.kind === 'survived') { tap(meetCaravan(app), null); continue; }
    if (s.pending) {
      const c = firstOpen();
      tap(choose(app, c), { choose: c });
      // CARRY ON: the rest of the planned day, logged as that day's plan if it ran anything.
      if (!app.sim.pending) { const q = app.queue; tap(carryOn(app), { plan: q }); }
      continue;
    }
    if (s.day !== day) { day = s.day; k = 0; }
    // Free settings now and then: a camp, a focus, the rations, a pin.
    if (!s.site && scouted(s.explore, 1) && !once.has('site')) { once.add('site'); tap(settle(app, 'cave'), { set: { site: 'cave' } }); continue; }
    if (s.day === 3 && !once.has('focus')) { once.add('focus'); tap(chooseFocus(app, parseFocus('goal:larder')), { set: { focus: 'goal:larder' } }); continue; }
    if (s.day === 5 && !once.has('half')) { once.add('half'); tap(chooseEating(app, 'half'), { set: { eating: 'half' } }); continue; }
    if (s.day === 6 && !once.has('full')) { once.add('full'); tap(chooseEating(app, 'full'), { set: { eating: 'full' } }); continue; }
    if (s.pins?.length && !once.has('pin')) { once.add('pin'); tap(weighPin(app, s.pins[0].id, 1), { set: { pin: `${s.pins[0].id}|1` } }); continue; }
    if (!s.canPlan) {
      const step = k++;
      if (step < ONE_AT_A_TIME.length) tap(act(app, ONE_AT_A_TIME[step]), { do: ONE_AT_A_TIME[step] });
      else tap(endTheDay(app), { endDay: true });
      continue;
    }
    // RUN THE DAY: what's left of yesterday's plan, or a fresh one.
    const queue = app.queue.length ? app.queue : DAY_PLAN;
    tap(runQueuedDay({ ...app, queue }), { plan: queue });
  }
  return { app, rec };
}
