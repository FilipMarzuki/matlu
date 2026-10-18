/**
 * Acceptance tests for #1882: a web log is replayed under its own switches, and a switch it doesn't
 * name reads by its `absent` value (features.ts featuresOf), as a save does. Only a brand-new game
 * gets today's defaults, and a new game's log names every rule switch.
 */

import { describe, it, expect } from 'vitest';
import { makeWarden, serialize as serializeApp } from '../artificer-app/controller';
import { FEATURES, featureById, ruleFeatures } from '../artificer/features';
import { PACK_CAPACITY, PACK_LITRES, PACK_VOLUME, autoOutside, insideLitres, packWeight, type KitId } from '../artificer/kit';
import { WALK_THE_MAP } from '../artificer/walk-the-map';
import { talentOffer, seedOf } from '../artificer/talents';
import { DEFAULT_STATS } from '../artificer/stats';
import { pagePlay } from './fixtures';
import { startOf, startProblem, replayWeb } from './web-run';
import { newLog, webStart, type WebStart, type Recorder } from './web-log';

const RULE_IDS = FEATURES.filter(f => f.kind === 'rules').map(f => f.id).sort();

/** Today's rule switches without `id`: a log from before that switch existed. */
const without = (id: string): Record<string, boolean> => {
  const { [id]: _gone, ...rest } = ruleFeatures();
  return rest;
};

const ID = 'w-test-absent1';
const start = (o: Partial<WebStart> = {}): WebStart => ({
  id: ID, name: 'Vega', chosen: talentOffer(seedOf(ID)).slice(0, 2), stats: { ...DEFAULT_STATS }, age: 12,
  features: ruleFeatures(), heirlooms: null, ...o,
});

describe('Web-log replay reads switches it lacks as absent (#1882)', () => {
  it('the switches tested are ones a run from before them had off', () => {
    expect(featureById(PACK_VOLUME)).toMatchObject({ kind: 'rules', default: true, absent: false });
    expect(featureById(WALK_THE_MAP)).toMatchObject({ kind: 'rules', default: true, absent: false });
  });

  it('Given a log from before pack-volume with a light pack too bulky to close, Then its start passes and replays with pack-volume off', () => {
    // Under 9 kg, over 45 L inside even with the default straps (nothing here can be strapped on):
    // a pack that fits by weight only.
    const bulky: KitId[] = ['home-pillow', 'pillow', 'rain-gear', 'wool-underlayer', 'hat-mittens', 'toilet-paper', 'first-aid-kit', 'flamingo', 'board-game', 'hairdryer', 'lots-of-socks', 'weekend-food', 'big-bag-sweets', 'water-bottle', 'thermos'];
    expect(insideLitres(bulky, autoOutside(bulky))).toBeGreaterThan(PACK_LITRES);
    expect(packWeight(bulky)).toBeLessThanOrEqual(PACK_CAPACITY);
    const old = start({ pack: bulky, features: without(PACK_VOLUME) });
    expect(startProblem(old)).toBeNull();
    const a = startOf(old);
    expect(a.sim.config.world.features?.[PACK_VOLUME]).toBe(false);
    expect(a.sim.kit?.items).toEqual(bulky);
    // The same run made with the switch named off starts the same.
    expect(serializeApp(a)).toBe(serializeApp(startOf(start({ pack: bulky, features: ruleFeatures({ [PACK_VOLUME]: false }) }))));
    // With today's default, the switch on, that pack is refused: what the old reading did to this log.
    expect(startProblem(start({ pack: bulky, features: ruleFeatures() }))).toMatch(/pack/);
  });

  it('Given a log from before walk-the-map, Then it replays to the same game as a run made with walk-the-map off', () => {
    const off = start({ features: ruleFeatures({ [WALK_THE_MAP]: false }) });
    const rec: Recorder = { log: newLog(off), measures: {} };
    const played = pagePlay(startOf(off), rec);
    // The same moves, from a start that doesn't name the switch at all.
    const old = { ...played.rec.log, start: { ...played.rec.log.start, features: without(WALK_THE_MAP) } };
    expect(startProblem(old.start)).toBeNull();
    expect(startOf(old.start).sim.config.world.features?.[WALK_THE_MAP]).toBe(false);
    const r = replayWeb(old);
    expect(r.ok).toBe(true);
    expect(r.ok && serializeApp(r.app)).toBe(serializeApp(played.app));
    expect(r.ok && r.measures).toEqual(played.rec.measures);
  });

  it('Given a new game, Then its log names every rule switch, at the run\'s own values', () => {
    // As the page makes one: makeWarden with the player's choices (loadChoices), which may name a
    // few switches, or none, or ids that aren't rule switches.
    const cases: Record<string, boolean>[] = [{}, { [PACK_VOLUME]: false }, { [WALK_THE_MAP]: false, guide: false }];
    for (const choices of cases) {
      const a = makeWarden({ id: 'w-test-absent2' }, undefined, choices);
      const s = webStart(a, {}, null);
      expect(Object.keys(s.features).sort()).toEqual(RULE_IDS);
      expect(s.features).toEqual(ruleFeatures(choices));
      expect(startProblem(s)).toBeNull();
    }
    // Even a world that somehow lacks a switch is written out in full, read as the run reads it.
    const a = makeWarden({ id: 'w-test-absent3' });
    const partial = { ...a, sim: { ...a.sim, config: { ...a.sim.config, world: { ...a.sim.config.world, features: without(WALK_THE_MAP) } } } };
    const s = webStart(partial, {}, null);
    expect(Object.keys(s.features).sort()).toEqual(RULE_IDS);
    expect(s.features[WALK_THE_MAP]).toBe(false);
    // Heirlooms say where they came from only when there are some.
    expect(webStart(a, {}, [], 'g-1').heirloomsFrom).toBeUndefined();
    expect(webStart(a, {}, null).heirlooms).toBeNull();
  });
});
