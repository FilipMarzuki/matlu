/**
 * Acceptance tests for #1816 — start by gathering loose stone; quarrying comes once you know the
 * cleave (switch `stone-gathering`). One test per Given/When/Then, in the issue's order:
 *
 *   1. New run          — given a new run with the switch on, "Gather stones" is available and
 *                          "Quarry stone" is hidden (the sim, the AI's observation and the API's moves).
 *   2. Near camp        — gathering stones near camp yields stone, less than quarrying the same
 *                          place, on lighter work, and trains Stonework.
 *   3. Loose stone      — on a riverbank or a hill (scree) camp, gathering yields more than on the
 *                          forest floor of a treeline camp.
 *   4. The cleave       — once the Warden learns Finding the cleave, "Quarry stone" appears and
 *                          works as today; until then the journal's find note names gathering.
 *   5. Switch off       — off or absent, quarry is shown from the start, there's no gathering, and
 *                          the same seed plays the same run.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, ACTIONS, type Region1State, type QueueItem } from './region1';
import { visibilityOf, shown } from './action-visibility';
import { survey, scout, createExploration } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { makeWarden } from '../artificer-app/controller';
import { startGame, view } from '../artificer-play/session';
import { observe } from '../artificer-ai/observe';
import { simLine } from '../artificer-app/sim-words';
import { makeT } from './i18n';

const svT = makeT('sv'), enT = makeT('en');

/** Daylight, clear weather, no luck, accidents or encounters: what happens is the rules'. `absent`: a run from before the switch. */
const world = (on: boolean | 'absent', visible = true): WorldConfig => ({
  ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false,
  features: { 'action-visibility': visible, ...(on === 'absent' ? {} : { 'stone-gathering': on }) },
});

/** A Warden who knows the near ring (stone observed), camped at a treeline unless told otherwise. */
function warden(on: boolean | 'absent' = true, visible = true): Region1State {
  const s = createRegion1({ world: world(on, visible) }, undefined, { id: 'w-stone' });
  return { ...s, site: s.site ?? 'tree', explore: survey(scout(createExploration(), 1), 1) };
}

const gained = (before: Region1State, after: Region1State): number => after.stores.stone - before.stores.stone;

describe('Gather stones first; quarry once you know the cleave (#1816)', () => {
  it('1. a new run with the switch on offers "Gather stones" and hides "Quarry stone"', () => {
    const s = warden();
    expect(ACTIONS.gatherstone.name).toBe('Gather stones');
    expect(visibilityOf(s, 'gatherstone').status).toBe('available');
    expect(visibilityOf(s, 'quarry').status).toBe('hidden');
    expect(visibilityOf(s, 'quarry').reason).toMatch(/cleave/);
    // Asked for anyway, quarrying is refused as something you don't know how to do yet.
    const tried = runAction(s, 'quarry');
    expect(tried.stores.stone).toBe(s.stores.stone);
    expect(tried.log.at(-1)?.kind).toBe('skip');
    // The game's own start has it on, with the cleave not yet known.
    const game = makeWarden({ id: 'w-stone-game' }).sim;
    expect(shown(game, 'gatherstone')).toBe(true);
    expect(shown(game, 'quarry')).toBe(false);
    // The AI's observation and the API's moves list gathering, not quarrying.
    const text = observe(s);
    expect(text).toMatch(/^- gatherstone /m);
    expect(text).not.toMatch(/^- quarry /m);
    const moves = view(startGame({ seed: 'stone-moves' })).moves.map(m => JSON.stringify(m.move));
    expect(moves.some(m => m.includes('"gatherstone'))).toBe(true);
    expect(moves.some(m => m.includes('"quarry'))).toBe(false);
  });

  it('2. gathering near camp yields stone, less than quarrying there, on lighter work, and trains Stonework', () => {
    const s = warden();
    const gathered = runAction(s, 'gatherstone');
    expect(gained(s, gathered)).toBeGreaterThan(0);
    // The same place quarried (as a run without the switch quarries it).
    const q = warden(false);
    const quarried = runAction(q, 'quarry');
    expect(gained(s, gathered)).toBeLessThan(gained(q, quarried));
    // Lighter and a little shorter than quarrying.
    expect(ACTIONS.gatherstone.hours).toBeLessThan(ACTIONS.quarry.hours);
    expect(Math.abs(ACTIONS.gatherstone.vigorRate)).toBeLessThan(Math.abs(ACTIONS.quarry.vigorRate));
    expect(s.vitals.vigor.current - gathered.vitals.vigor.current).toBeLessThan(q.vitals.vigor.current - quarried.vitals.vigor.current);
    // It trains Stonework.
    expect(gathered.skills.stonework ?? 0).toBeGreaterThan(s.skills.stonework ?? 0);
    expect(gathered.log.map(l => l.text)).toContainEqual(expect.stringMatching(/^Gathered \d+ stone/));
  });

  it('3. on a riverbank or a hill, gathering yields more than on the forest floor', () => {
    const forest = { ...warden(), site: 'tree' as const };
    const river = { ...warden(), site: 'river' as const };
    const hill = { ...warden(), site: 'hill' as const };
    const atForest = gained(forest, runAction(forest, 'gatherstone'));
    expect(gained(river, runAction(river, 'gatherstone'))).toBeGreaterThan(atForest);
    expect(gained(hill, runAction(hill, 'gatherstone'))).toBeGreaterThan(atForest);
  });

  it('4. learning Finding the cleave opens "Quarry stone", which works as today; until then the find note names gathering', () => {
    // A little Stonework short of the cleave (worked out alone at 4h): one gathering trip gets there.
    const s = { ...warden(), skills: { ...warden().skills, stonework: 1 } };
    expect(shown(s, 'quarry')).toBe(false);
    const after = runAction(s, 'gatherstone');
    expect(after.techniques).toContain('cleave');
    expect(after.log.map(l => l.text)).toContainEqual(expect.stringMatching(/worked out finding the cleave/));
    expect(visibilityOf(after, 'quarry').status).toBe('available');
    // Quarrying then is exactly what it is without the switch, with the same cleave known.
    const ready = { ...after, hoursToday: 0 };
    const today = { ...warden(false), skills: ready.skills, techniques: ready.techniques, vitals: ready.vitals, stores: ready.stores, explore: ready.explore, patches: ready.patches };
    const a = runAction(ready, 'quarry'), b = runAction(today, 'quarry');
    expect(gained(ready, a)).toBe(gained(today, b));
    expect(a.vitals).toEqual(b.vitals);
    const broke = (x: Region1State, from: Region1State): string | undefined => x.log.slice(from.log.length).find(l => /^Broke out/.test(l.text))?.text;
    expect(broke(a, ready)).toBe(broke(b, today));
    expect(broke(a, ready)).toBeDefined();

    // The find a worked stone domain turns up names the action you have: gathering, before the cleave.
    let g = { ...warden(), techniques: [] as string[] };
    for (let i = 0; i < 6 && !g.log.some(l => /found a flint seam/.test(l.text)); i++) g = runAction({ ...g, hoursToday: 0, techniques: [] }, 'gatherstone');
    const line = g.log.find(l => /found a flint seam/.test(l.text))!.text;
    expect(line).toMatch(/gathering stones/);
    expect(line).not.toMatch(/quarrying/);
    // …and the page says both in Swedish, gathering's way: "Samla sten", "att samla sten ger +1 sten".
    expect(simLine(line, enT)).toBe(line);
    expect(simLine(line, svT)).toMatch(/att samla sten ger \+1 sten/);
    expect(simLine('Gathered 3 stone.', svT)).toBe('Samlade 3 sten.');
    expect(svT('act.gatherstone')).toBe('Samla sten');
    expect(simLine(visibilityOf(warden(), 'quarry').reason!, svT)).toBe('du kan inte bryta sten än — samla sten, så hittar du klyvningen (Stenarbete)');
  });

  it('5. with the switch off or absent, quarry is shown from the start and the same seed plays the same run', () => {
    for (const on of [false, 'absent'] as const) {
      for (const visible of [true, false]) {
        const s = warden(on, visible);
        expect(shown(s, 'quarry')).toBe(true);
        expect(shown(s, 'gatherstone')).toBe(false);
        expect(runAction(s, 'gatherstone').log.at(-1)?.kind).toBe('skip');
      }
    }
    // Off and absent play the same run, day for day.
    const plan: QueueItem[][] = [['scout'], ['quarry', 'wood'], ['quarry', 'gather', 'water'], ['quarry', 'quarry']];
    const play = (on: false | 'absent'): Region1State => {
      let s = createRegion1({ world: { ...FULL_WORLD, encounters: false, features: { ...(on === 'absent' ? {} : { 'stone-gathering': false }) } } }, undefined, { id: 'w-stone-same' });
      for (let day = 0; day < 12 && !s.outcome; day++) s = runDay(s, plan[day % plan.length]).state;
      return s;
    };
    const off = play(false), absent = play('absent');
    expect(off.log).toEqual(absent.log);
    expect(off.stores).toEqual(absent.stores);
    expect(off.vitals).toEqual(absent.vitals);
    expect(off.skills).toEqual(absent.skills);
    // Quarrying from the first day, without the cleave.
    expect(off.stores.stone).toBeGreaterThan(0);
  });
});
