/**
 * Feature switches (#1579): the registry, how a run's saved switches read, and that a run keeps the
 * rule features it started with — in its world, through the road, and through a save.
 */

import { describe, it, expect } from 'vitest';
import { FEATURES, ruleFeatures, featureOn, featuresOf, experimentalOn, validFeatures, uiFeatureOn } from './features';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, ROUTE } from './road';
import { makeWarden, serialize, deserialize, type AppState } from '../artificer-app/controller';

describe('Feature switches (#1579)', () => {
  it('registers free questions as an experimental rule feature, on by default, and on for runs from before its switch', () => {
    const f = FEATURES.find(x => x.id === 'free-questions');
    expect(f).toMatchObject({ stage: 'experimental', kind: 'rules', default: true, absent: true });
    expect(new Set(FEATURES.map(x => x.id)).size).toBe(FEATURES.length);
  });

  it('registers referrals as an experimental rule feature, on by default, and off for runs from before its switch', () => {
    const f = FEATURES.find(x => x.id === 'referrals');
    expect(f).toMatchObject({ stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1609 });
    expect(f?.note).toBeTruthy();
    expect(featureOn(undefined, 'referrals')).toBe(false);
    expect(featureOn({ referrals: true }, 'referrals')).toBe(true);
  });

  it('writes a new game’s rule features out in full: defaults, with the player’s switches on top, unknown ids dropped', () => {
    expect(ruleFeatures()).toEqual({ 'free-questions': true, referrals: true, 'knowledge-questions': true, 'scope-facts': true, 'candour-by-place': true, 'village-economies': true, organisations: true, 'humans-on-the-road': true, ties: true, 'rumours-and-lies': true, 'rumour-drift': true, 'old-history-drift': true, 'history-in-play': true, 'history-retold': true, 'grudges-and-help': true, 'caught-lies': true, 'action-length': true, 'reach-and-secrets': true, consistency: true, 'action-visibility': true, 'run-rumours': true, 'descriptive-map': true, 'pack-extras': true, 'weather-words': true, 'time-words': true, 'camp-as-action': true, 'camp-site-ratings': true, 'cold-pit-slows': true, 'distance-not-rings': true, 'camp-builds-per-site': true, 'map-learning': true, 'built-warmth': true, 'thermal-model': true, 'stone-gathering': true, 'stop-action': true, 'hunting-gear': true, 'directed-explore': true, 'camp-scavengers': true, forecasts: true, 'compass-heading': true, 'pack-axe-fishing': true, 'stats-before-pack': true });
    expect(ruleFeatures({ 'free-questions': false, 'no-such-thing': true })).toEqual({ 'free-questions': false, referrals: true, 'knowledge-questions': true, 'scope-facts': true, 'candour-by-place': true, 'village-economies': true, organisations: true, 'humans-on-the-road': true, ties: true, 'rumours-and-lies': true, 'rumour-drift': true, 'old-history-drift': true, 'history-in-play': true, 'history-retold': true, 'grudges-and-help': true, 'caught-lies': true, 'action-length': true, 'reach-and-secrets': true, consistency: true, 'action-visibility': true, 'run-rumours': true, 'descriptive-map': true, 'pack-extras': true, 'weather-words': true, 'time-words': true, 'camp-as-action': true, 'camp-site-ratings': true, 'cold-pit-slows': true, 'distance-not-rings': true, 'camp-builds-per-site': true, 'map-learning': true, 'built-warmth': true, 'thermal-model': true, 'stone-gathering': true, 'stop-action': true, 'hunting-gear': true, 'directed-explore': true, 'camp-scavengers': true, forecasts: true, 'compass-heading': true, 'pack-axe-fishing': true, 'stats-before-pack': true });
  });

  it('reads a run’s switches as saved, and a run from before the switches as each feature’s `absent`', () => {
    expect(featureOn({ 'free-questions': false }, 'free-questions')).toBe(false);
    expect(featureOn(undefined, 'free-questions')).toBe(true);
    expect(featureOn({}, 'no-such-thing')).toBe(false);
    expect(featuresOf(undefined)).toEqual({ 'free-questions': true, referrals: false, 'knowledge-questions': false, 'scope-facts': false, 'candour-by-place': false, 'village-economies': false, organisations: false, 'humans-on-the-road': false, ties: false, 'rumours-and-lies': false, 'rumour-drift': false, 'old-history-drift': false, 'history-in-play': false, 'history-retold': false, 'grudges-and-help': false, 'caught-lies': false, 'action-length': false, 'reach-and-secrets': false, consistency: false, 'action-visibility': false, 'run-rumours': false, 'descriptive-map': false, 'pack-extras': false, 'weather-words': false, 'time-words': false, 'camp-as-action': false, 'camp-site-ratings': false, 'cold-pit-slows': false, 'distance-not-rings': false, 'camp-builds-per-site': false, 'map-learning': false, 'built-warmth': false, 'thermal-model': false, 'stone-gathering': false, 'stop-action': false, 'hunting-gear': false, 'directed-explore': false, 'camp-scavengers': false, forecasts: false, 'compass-heading': false, 'pack-axe-fishing': false });
  });

  it('names the experimental features that are on, and checks the shape of a saved set', () => {
    expect(experimentalOn({ 'free-questions': true }).map(f => f.id)).toEqual(['free-questions']);
    expect(experimentalOn({ 'free-questions': false })).toEqual([]);
    expect(experimentalOn(null)).toEqual([]);
    expect(validFeatures({ a: true, b: false })).toBe(true);
    expect(validFeatures({ a: 'yes' })).toBe(false);
    expect(validFeatures(['a'])).toBe(false);
    expect(validFeatures(null)).toBe(false);
    // Not a ui feature, so never on as one.
    expect(uiFeatureOn({ 'free-questions': true }, 'free-questions')).toBe(false);
  });
});

/** A thaw survivor whose world has `features`, on the road at its first village. */
function onTheRoad(features: Record<string, boolean> | undefined): ReturnType<typeof createRoad> {
  const s = createRegion1({}, undefined, { id: 'w-features', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = {
    ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10, rations: 6 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
    config: { ...s.config, world: { ...s.config.world, ...(features ? { features } : {}) } },
  };
  const village = ROUTE.findIndex(l => l.kind === 'village');
  let r = createRoad(from);
  for (let i = 0; i < 10 && r.leg < village; i++) r = endRoadDay(r);
  return r;
}

describe('A run keeps the rule features it started with (#1579)', () => {
  it('a new game saves its switches in its world', () => {
    expect(makeWarden({ id: 'w-a' }).sim.config.world.features).toEqual({ 'free-questions': true, referrals: true, 'knowledge-questions': true, 'scope-facts': true, 'candour-by-place': true, 'village-economies': true, organisations: true, 'humans-on-the-road': true, ties: true, 'rumours-and-lies': true, 'rumour-drift': true, 'old-history-drift': true, 'history-in-play': true, 'history-retold': true, 'grudges-and-help': true, 'caught-lies': true, 'action-length': true, 'reach-and-secrets': true, consistency: true, 'action-visibility': true, 'run-rumours': true, 'descriptive-map': true, 'pack-extras': true, 'weather-words': true, 'time-words': true, 'camp-as-action': true, 'camp-site-ratings': true, 'cold-pit-slows': true, 'distance-not-rings': true, 'camp-builds-per-site': true, 'map-learning': true, 'built-warmth': true, 'thermal-model': true, 'stone-gathering': true, 'stop-action': true, 'hunting-gear': true, 'directed-explore': true, 'camp-scavengers': true, forecasts: true, 'compass-heading': true, 'pack-axe-fishing': true, 'stats-before-pack': true });
    expect(makeWarden({ id: 'w-b' }, undefined, { 'free-questions': false }).sim.config.world.features).toEqual({ 'free-questions': false, referrals: true, 'knowledge-questions': true, 'scope-facts': true, 'candour-by-place': true, 'village-economies': true, organisations: true, 'humans-on-the-road': true, ties: true, 'rumours-and-lies': true, 'rumour-drift': true, 'old-history-drift': true, 'history-in-play': true, 'history-retold': true, 'grudges-and-help': true, 'caught-lies': true, 'action-length': true, 'reach-and-secrets': true, consistency: true, 'action-visibility': true, 'run-rumours': true, 'descriptive-map': true, 'pack-extras': true, 'weather-words': true, 'time-words': true, 'camp-as-action': true, 'camp-site-ratings': true, 'cold-pit-slows': true, 'distance-not-rings': true, 'camp-builds-per-site': true, 'map-learning': true, 'built-warmth': true, 'thermal-model': true, 'stone-gathering': true, 'stop-action': true, 'hunting-gear': true, 'directed-explore': true, 'camp-scavengers': true, forecasts: true, 'compass-heading': true, 'pack-axe-fishing': true, 'stats-before-pack': true });
  });

  it('the road carries them, and a free question is refused when the feature is off', () => {
    const off = onTheRoad({ 'free-questions': false });
    expect(off.features).toEqual({ 'free-questions': false });
    const after = runRoadAction(off, 'question:hf-orrin:material:iron');
    expect(after.log.at(-1)?.text).toMatch(/free questions are off/);
    expect(after.hoursToday).toBe(off.hoursToday);
    expect(after.questioned ?? []).toEqual([]);
    // On, or from before the switches (no features saved): asked as before.
    for (const r of [onTheRoad({ 'free-questions': true }), onTheRoad(undefined)]) {
      expect(runRoadAction(r, 'question:hf-orrin:material:iron').questioned).toEqual(['hf-orrin']);
    }
  });

  it('keeps them through a save, and drops only a malformed set (the rest of the world stays)', () => {
    const app = makeWarden({ id: 'w-save' }, undefined, { 'free-questions': false });
    const back = deserialize(serialize(app))!;
    expect(back.sim.config.world.features).toEqual({ 'free-questions': false, referrals: true, 'knowledge-questions': true, 'scope-facts': true, 'candour-by-place': true, 'village-economies': true, organisations: true, 'humans-on-the-road': true, ties: true, 'rumours-and-lies': true, 'rumour-drift': true, 'old-history-drift': true, 'history-in-play': true, 'history-retold': true, 'grudges-and-help': true, 'caught-lies': true, 'action-length': true, 'reach-and-secrets': true, consistency: true, 'action-visibility': true, 'run-rumours': true, 'descriptive-map': true, 'pack-extras': true, 'weather-words': true, 'time-words': true, 'camp-as-action': true, 'camp-site-ratings': true, 'cold-pit-slows': true, 'distance-not-rings': true, 'camp-builds-per-site': true, 'map-learning': true, 'built-warmth': true, 'thermal-model': true, 'stone-gathering': true, 'stop-action': true, 'hunting-gear': true, 'directed-explore': true, 'camp-scavengers': true, forecasts: true, 'compass-heading': true, 'pack-axe-fishing': true, 'stats-before-pack': true });
    const raw = JSON.parse(serialize(app));
    raw.sim.config.world.features = { 'free-questions': 'nope' };
    const fixed = deserialize(JSON.stringify(raw))!;
    expect(fixed.sim.config.world.features).toBeUndefined();
    expect(fixed.sim.config.world.encounters).toBe(true); // the world itself kept, encounters and all
    // And on the road.
    const road = onTheRoad({ 'free-questions': false });
    const onRoad = { ...app, stage: 'road', road } as AppState;
    expect(deserialize(serialize(onRoad))?.road?.features).toEqual({ 'free-questions': false });
  });
});

describe('Referrals (#1609): someone who doesn’t know names who would', () => {
  const askMarenAboutIron = (features: Record<string, boolean> | undefined) => {
    const r = onTheRoad(features);
    const before = { ...r, focus: { kind: 'material', id: 'iron' } as const, trust: { ...r.trust, 'hf-maren': 90 } };
    return runRoadAction(before, 'ask:hf-maren').log.at(-1)?.text;
  };
  const TODAY = 'Maren thinks, and shakes their head. "I don\'t know much about iron."';

  it('with the switch on, Maren on iron sends you to Tobin', () => {
    expect(askMarenAboutIron({ referrals: true })).toBe('Maren thinks, and shakes their head. "I couldn\'t tell you — Tobin would know."');
  });

  it('with it off, or for a run from before the switch, the line is today’s', () => {
    expect(askMarenAboutIron({ referrals: false })).toBe(TODAY);
    expect(askMarenAboutIron({ 'free-questions': true })).toBe(TODAY);
    expect(askMarenAboutIron(undefined)).toBe(TODAY);
  });
});
