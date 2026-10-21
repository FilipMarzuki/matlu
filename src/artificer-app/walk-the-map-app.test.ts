/**
 * #1876 outside the sim: the journal's walking lines and the API's "where you are" read in Swedish
 * as well as English, and the days' paths (`trail`) go through a save only with the switch on and
 * only when they read right.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1, runAction, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { ruleFeatures } from '../artificer/features';
import { knownSpots } from '../artificer/camp-sites';
import { survey, createExploration } from '../artificer/exploration';
import { WALK_THE_MAP, planTrip } from '../artificer/walk-the-map';
import { makeWarden, serialize, deserialize, type AppState } from './controller';
import { simLine } from './sim-words';
import { viewText } from '../artificer-play/view-words';

const enT = makeT('en');
const sv = makeT('sv');

const warden = (on = true): Region1State => {
  const features = { ...ruleFeatures(), 'compass-heading': false, [WALK_THE_MAP]: on };
  return createRegion1({ world: { ...FULL_WORLD, encounters: false, luck: false, accidents: false, darkness: false, weather: 'clear', features } }, undefined, { id: 'w-walker' });
};
const camped = (on = true): Region1State => {
  const s = { ...warden(on), explore: survey(createExploration(), 1) };
  return runAction(s, { q: 'camp', opts: { spot: knownSpots(s)[0].id } });
};
const app = (sim: Region1State): AppState => ({ ...makeWarden({ id: sim.character.id }), sim, queue: [] });
const WALK_LINE = /^(Where the work was|Into land you hadn't seen|You stopped out on the land|Walked back to camp)/;

describe('#1876 walking the map, in words and in the save', () => {
  it('says where a trip went, and where a stop left you, in Swedish', () => {
    const s = camped();
    const trip = planTrip(s, 'water', 2)!;
    const stopped = runAction(s, 'water@2', trip.outHours / 3);
    const back = runAction(stopped, 'wood');
    const lines = [...stopped.log, ...back.log, ...runAction(s, 'water@2').log].map(l => l.text).filter(l => WALK_LINE.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) {
      const said = simLine(l, sv);
      expect(said, l).not.toBe(l);
      expect(said).not.toMatch(/\b(north|south|east|west|hours|about|minutes|camp|stopped|work)\b/);
      // And in English, exactly the sim's words.
      expect(simLine(l, enT)).toBe(l);
    }
    // Where you are, on the API's day: at camp, or out on the land.
    expect(viewText(app(s), 'day', enT)).toContain('You are at camp.');
    expect(viewText(app(s), 'day', sv)).toContain('Du är i lägret.');
    expect(viewText(app(stopped), 'day', enT)).toMatch(/You are out on the land, .+ from camp\./);
    expect(viewText(app(stopped), 'day', sv)).toMatch(/Du är ute i landet, .+ från lägret\./);
    // With the switch off, no such line.
    expect(viewText(app(camped(false)), 'day', enT)).not.toContain('You are at camp.');
  });

  it('keeps the days’ paths through a save with the switch on, and drops them off or malformed', () => {
    const s = runAction(camped(), 'water@2');
    expect(s.trail?.length).toBeGreaterThan(0);
    expect(deserialize(serialize(app(s)))!.sim.trail).toEqual(s.trail);
    // Off, a stray trail is dropped.
    const off = camped(false);
    expect(deserialize(serialize(app({ ...off, trail: s.trail })))!.sim.trail).toBeUndefined();
    // Malformed (a square that isn't one or is off the map, a day that isn't, too many days), dropped and the rest kept.
    for (const bad of [[{ day: 1, path: [-1] }], [{ day: 1, path: [48 * 32] }], [{ day: 0, path: [1] }], [{ day: 1, path: ['x'] }], [1, 2, 3, 4].map(day => ({ day, path: [1] })), 'nope']) {
      const raw = JSON.parse(serialize(app(s)));
      raw.sim.trail = bad;
      const read = deserialize(JSON.stringify(raw))!;
      expect(read.sim.trail).toBeUndefined();
      expect(read.sim.campSpot).toEqual(s.campSpot);
    }
  });
});
