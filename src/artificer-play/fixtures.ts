/**
 * Games set up for tests: built through the session core, as a player would get there, so they
 * hold whatever the real game holds at that point.
 */

import { createRegion1, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { villageOf } from '../artificer/road';
import { view, apply, gameFrom, type Game, type Move } from './session';

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
