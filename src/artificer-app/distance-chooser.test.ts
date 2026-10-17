/**
 * #1814: the distance is chosen after the action, with the last choice preselected. The palette
 * has no row of distance tabs; a land action's card opens a chooser under it, listing the
 * distances (reachable or greyed with the reason), their walk and what the action brings there,
 * and the distance last chosen for that action is preselected and marked. The choices are kept per
 * action and per Warden on the device (distance-defaults.ts). UI only: the queue id carries the distance.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1, queueId, ACTIONS, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { survey, createExploration } from '../artificer/exploration';
import { SUGGESTED_PACK } from '../artificer/kit';
import { distanceOptions, paletteBlock, yieldText } from './camp-blocks';
import { previewQueue, makeWarden, type AppState } from './controller';
import {
  RING_DEFAULTS_KEY, defaultsFor, loadRingDefaults, preselect, readRingDefaults, rememberRing, saveRingDefaults, type RingDefaultsStorage,
} from './distance-defaults';

const en = makeT('en');
const sv = makeT('sv');

/** A Warden with only the land close by known (the start), or with the two inner rings scouted. */
function warden(far = false, id = 'w-astrid'): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: false } }, undefined, { id, pack: [...SUGGESTED_PACK] });
  return far ? { ...s, explore: survey(survey(createExploration(), 1), 2) } : s;
}
const app = (sim: Region1State): AppState => ({ ...makeWarden({ id: sim.character.id }), sim, queue: [] });
const palette = (sim: Region1State, opts: Partial<Parameters<typeof paletteBlock>[2]> = {}): string => {
  const a = app(sim);
  return paletteBlock(a, previewQueue(a), { dev: false, t: en, ...opts });
};
/** The chooser's HTML, if one is drawn. */
const chooserIn = (html: string): string => /<div class="ringpick"[\s\S]*?<\/div><\/div>/.exec(html)?.[0] ?? '';
/** A fake `localStorage`, or one that refuses everything (a private window). */
function memory(): RingDefaultsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}
const refusing: RingDefaultsStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

describe('the remembered distances (#1814, distance-defaults.ts)', () => {
  it('Given nothing stored, When read, Then there are no choices; junk and non-land actions are dropped', () => {
    expect(readRingDefaults(null)).toEqual({});
    expect(readRingDefaults('not json')).toEqual({});
    expect(readRingDefaults('[1,2]')).toEqual({});
    expect(readRingDefaults(JSON.stringify({ a: { wood: 2, rest: 3, water: 9, nope: 2 }, b: 'x' }))).toEqual({ a: { wood: 2 } });
  });

  it('Given far chosen for wood, When remembered, Then wood keeps far, water keeps its own, and another Warden has none', () => {
    let store = rememberRing({}, 'w-astrid', 'water', 1);
    store = rememberRing(store, 'w-astrid', 'wood', 3);
    store = rememberRing(store, 'w-astrid', 'wood', 2);
    expect(defaultsFor(store, 'w-astrid')).toEqual({ water: 1, wood: 2 });
    expect(defaultsFor(store, 'w-bjorn')).toEqual({});
    // And it survives the trip through storage.
    const mem = memory();
    saveRingDefaults(store, mem);
    expect(JSON.parse(mem.data.get(RING_DEFAULTS_KEY) ?? '')).toEqual({ 'w-astrid': { water: 1, wood: 2 } });
    expect(loadRingDefaults(mem)).toEqual(store);
  });

  it('Given storage that refuses, When loaded and saved, Then nothing is remembered and nothing throws', () => {
    expect(loadRingDefaults(refusing)).toEqual({});
    expect(loadRingDefaults(null)).toEqual({});
    expect(() => saveRingDefaults(rememberRing({}, 'w', 'wood', 2), refusing)).not.toThrow();
  });

  it('Given the open distances, When preselecting, Then the remembered one if open ("last time"), else the nearest open', () => {
    const open = [{ ring: 1 as const, open: true }, { ring: 2 as const, open: true }, { ring: 3 as const, open: false }];
    expect(preselect(open, undefined)).toEqual({ ring: 1, last: false });
    expect(preselect(open, 2)).toEqual({ ring: 2, last: true });
    expect(preselect(open, 3)).toEqual({ ring: 1, last: false });
    expect(preselect([{ ring: 1, open: false }, { ring: 2, open: true }, { ring: 3, open: true }], undefined)).toEqual({ ring: 2, last: false });
  });
});

describe('the chooser\'s distances (#1814, distanceOptions)', () => {
  it('Given a new Warden, When wood\'s distances are listed, Then only close by is open, the others greyed with the reason, and close by is preselected', () => {
    const s = warden();
    const opts = distanceOptions(s, 'wood', {}, en);
    expect(opts.map(o => o.ring)).toEqual([1, 2, 3]);
    expect(opts.map(o => o.reachable)).toEqual([true, false, false]);
    for (const o of opts.slice(1)) { expect(o.greyed).toBe(true); expect(o.why).toBe(en('ring.lockedTip')); }
    expect(opts.filter(o => o.chosen).map(o => o.ring)).toEqual([1]);
    expect(opts.some(o => o.last)).toBe(false);
    // Even a remembered far is not preselected while it can't be reached.
    expect(distanceOptions(s, 'wood', { wood: 2 }, en).find(o => o.chosen)?.ring).toBe(1);
  });

  it('Given far remembered for wood, When listed, Then far is preselected and marked last time, with each distance\'s walk, queue id and yield', () => {
    const s = warden(true);
    const opts = distanceOptions(s, 'wood', { wood: 2, water: 3 }, en);
    expect(opts.map(o => o.reachable)).toEqual([true, true, true]);
    expect(opts.find(o => o.chosen)).toMatchObject({ ring: 2, last: true, q: queueId('wood', 2) });
    for (const o of opts) expect(o.yield).toBe(yieldText('wood', s, o.ring, en));
    expect(opts[0].travel).toBe(en('ring.home'));
    expect(opts[1].travel).toBe(en('ring.travel', { n: 3 }));
    // Another action keeps its own: water at the distance remembered for water.
    expect(distanceOptions(s, 'water', { wood: 2, water: 3 }, en).find(o => o.chosen)?.ring).toBe(3);
    expect(distanceOptions(s, 'gather', { wood: 2, water: 3 }, en).find(o => o.chosen)).toMatchObject({ ring: 1, last: false });
  });
});

describe('the palette (#1814)', () => {
  it('Given the plan, When drawn, Then there is no distance row and no "at <distance>" note on the headings', () => {
    const html = palette(warden(true));
    expect(html).not.toContain('class="rings"');
    expect(html).not.toContain('ringtab');
    expect(html).not.toContain('ringnote');
    expect(html).not.toContain('data-ring=');
  });

  it('Given land actions and others, When drawn, Then a land action\'s card opens its chooser and any other queues on one tap', () => {
    const html = palette(warden(true));
    for (const id of ['wood', 'water', 'gather'] as const) {
      expect(ACTIONS[id].ringed).toBe(true);
      expect(html).toContain(`data-chooser="${id}"`);
      expect(html).not.toMatch(new RegExp(`data-q="${id}(@\\d)?"`));
    }
    expect(html).toMatch(/data-q="(rest|study|tinker|camp|build)"/);
    expect(chooserIn(html)).toBe('');
  });

  it('Given wood\'s chooser open, When drawn, Then it lists every distance under the wood card, far preselected and marked, with a close button', () => {
    const html = palette(warden(true), { chooser: 'wood', defaults: { wood: 2 } });
    const pick = chooserIn(html);
    expect(pick).not.toBe('');
    // Right under the wood card: the card, then its chooser.
    expect(html).toMatch(/data-chooser="wood" aria-expanded="true"[\s\S]*?<\/button><div class="ringpick"/);
    for (const r of [1, 2, 3]) expect(pick).toContain(`data-ringpick="${queueId('wood', r as 1 | 2 | 3)}" data-pickfor="wood" data-pickring="${r}"`);
    expect(pick).toMatch(/class="rpopt on" data-ringpick="wood@2"/);
    expect(pick).toContain(en('ringpick.last'));
    expect(pick).toContain('data-cmd="ringclose"');
    // The wood card shows wood at the preselected distance.
    const card = /<button class="act[^"]*" data-chooser="wood"[\s\S]*?<\/button>/.exec(html)?.[0] ?? '';
    expect(card).toContain(yieldText('wood', warden(true), 2, en));
    // In Swedish, "senast".
    expect(chooserIn(palette(warden(true), { chooser: 'wood', defaults: { wood: 2 }, t: sv }))).toContain('senast');
  });

  it('Given a new Warden, When wood\'s chooser opens, Then the far distances are disabled with the reason, and nothing says last time', () => {
    const pick = chooserIn(palette(warden(), { chooser: 'wood' }));
    expect(pick).toMatch(/class="rpopt on" data-ringpick="wood"/);
    expect(pick).toMatch(/class="rpopt locked" data-ringpick="wood@2"[^>]* disabled[^>]*title="Scout the ring inside it first"/);
    expect(pick).not.toContain(en('ringpick.last'));
  });

  it('Given the guide suggests a land action, When drawn, Then its card still glows', () => {
    expect(palette(warden(), { suggest: 'scout' })).toMatch(/class="act[^"]*guide-suggest[^"]*" data-chooser="scout"/);
  });
});
