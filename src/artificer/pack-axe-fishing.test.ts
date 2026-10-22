/**
 * Acceptance tests for #1870 — a hand axe and a fishing kit on the pack list (switch
 * `pack-axe-fishing`). One test per Given/When/Then, numbered as the issue numbers them (2, the
 * shelter, was dropped by the owner):
 *
 *   1. Hand axe       — wood (firewood and materials) trips take about 20–25% less time and about
 *                        half the Vigor; the same haul; without it, as today.
 *   3. Fishing kit    — with `hunting-gear` on, fishing is open from day 1 with no hook and line to
 *                        make; a real hook catches a little better; it does for a needle compass.
 *   4. Pack screen    — both show in their groups with en and sv names and weights, and count
 *                        toward the pack's weight; the AI's packing turn lists them too.
 *   5. Determinism    — the same seed and moves play the same run. With the switch off or absent,
 *                        the items aren't offered, and a pack naming them plays as one without them.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, repack, type Region1State } from './region1';
import { visibilityOf } from './action-visibility';
import { scout, survey, createExploration } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { SUGGESTED_PACK, KIT, kitItem, offeredKit, packWeight, validPack, packProblem, AXE_TIME, type KitId } from './kit';
import { needleSource } from './compass-heading';
import { createVitals } from './vitality';
import { makeT } from './i18n';
import { packForm, groupSummary } from '../artificer-app/opening-view';
import { makeWarden } from '../artificer-app/controller';
import { observePack } from '../artificer-ai/observe';
import { parsePackDecision } from '../artificer-ai/decision';
import { randomPack, rng } from '../artificer-ai/players/random';

const enT = makeT('en'), svT = makeT('sv');
const AXE: KitId = 'hand-axe', FISH: KitId = 'fishing-kit';

/** Daylight, clear, no luck, accidents or encounters: the work's own numbers. `on` 'absent': a run from before the switch. */
const world = (on: boolean | 'absent', extra: Record<string, boolean> = {}): WorldConfig => ({
  ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false,
  features: { 'action-visibility': true, 'hunting-gear': true, ...extra, ...(on === 'absent' ? {} : { 'pack-axe-fishing': on }) },
});

/** A rested Warden camped at the treeline who has seen the near ground, with this pack. */
function warden(pack: readonly KitId[], on: boolean | 'absent' = true, id = 'w-axe'): Region1State {
  const s = createRegion1({ world: world(on) }, undefined, { id, pack: [...pack] });
  return { ...s, site: s.site ?? 'tree', vitals: createVitals(), explore: survey(scout(createExploration(), 1), 1), stores: { ...s.stores, materials: 10, rawFood: 5, water: 5, firewood: 5 } };
}

describe('A hand axe and a fishing kit in the pack (#1870)', () => {
  it('1. with the hand axe, a wood trip is about a fifth quicker and costs about half the Vigor, for the same haul; without it, as today', () => {
    const bare = warden(SUGGESTED_PACK), axe = warden([...SUGGESTED_PACK, AXE]);
    const a = runAction(bare, 'wood'), b = runAction(axe, 'wood');
    const hoursBare = a.hoursToday - bare.hoursToday, hoursAxe = b.hoursToday - axe.hoursToday;
    const vigorBare = bare.vitals.vigor.current - a.vitals.vigor.current, vigorAxe = axe.vitals.vigor.current - b.vitals.vigor.current;
    // 20–25% less time…
    expect(hoursAxe / hoursBare).toBeGreaterThanOrEqual(0.75);
    expect(hoursAxe / hoursBare).toBeLessThanOrEqual(0.8);
    expect(hoursAxe).toBeCloseTo(hoursBare * AXE_TIME, 5);
    // …about half the Vigor (the walk, here none, isn't the axe's)…
    expect(vigorBare).toBeGreaterThan(0);
    expect(vigorAxe / vigorBare).toBeGreaterThan(0.4);
    expect(vigorAxe / vigorBare).toBeLessThan(0.6);
    // …and no bigger haul: the same firewood and materials.
    expect(b.stores.firewood - axe.stores.firewood).toBe(a.stores.firewood - bare.stores.firewood);
    expect(b.stores.materials - axe.stores.materials).toBe(a.stores.materials - bare.stores.materials);
    // Other work doesn't change: water takes the same hours and Vigor with or without the axe.
    const wa = runAction(bare, 'water'), wb = runAction(axe, 'water');
    expect(wb.hoursToday - axe.hoursToday).toBeCloseTo(wa.hoursToday - bare.hoursToday, 9);
    expect(axe.vitals.vigor.current - wb.vitals.vigor.current).toBeCloseTo(bare.vitals.vigor.current - wa.vitals.vigor.current, 9);
  });

  it('3. with the fishing kit and hunting-gear on, fishing is open on day 1 with no hook and line made; a real hook catches a little better, and it does for a needle compass', () => {
    const bare = warden(SUGGESTED_PACK), kit = warden([...SUGGESTED_PACK, FISH]);
    expect(bare.day).toBe(1);
    expect(visibilityOf(bare, 'fish').status).toBe('hidden');
    expect(visibilityOf(kit, 'fish').status).toBe('available');
    expect(kit.tools.some(t => t.item === 'hook-line')).toBe(false);
    // A real hook beats a whittled one: the kit's catch against a made hook and line's, the same trip.
    const whittled: Region1State = { ...bare, tools: [...bare.tools, { item: 'hook-line', grade: 'sound' }] };
    const caughtKit = runAction(kit, 'fish').stores.rawFood - kit.stores.rawFood;
    const caughtLine = runAction(whittled, 'fish').stores.rawFood - whittled.stores.rawFood;
    expect(caughtKit).toBeGreaterThan(caughtLine);
    expect(caughtKit).toBeLessThanOrEqual(caughtLine + 1);
    // Its hook is a hook wherever the game looks for one: the needle compass's fallback (#1868).
    expect(needleSource(bare)).toBeNull();
    expect(needleSource(kit)).toBe('hook');
  });

  it('4. both show on the pack screen in their groups, with en and sv names and weights, and count toward the pack; the AI is offered them too', () => {
    expect(kitItem(AXE)).toMatchObject({ name: 'Hand axe', sv: 'handyxa', group: 'tools', weight: 0.6 });
    expect(kitItem(FISH)).toMatchObject({ name: 'Fishing kit', sv: 'fiskeset', group: 'fire-food', weight: 0.2 });
    // Not on the leader's list: you choose them.
    expect(SUGGESTED_PACK).not.toContain(AXE);
    expect(SUGGESTED_PACK).not.toContain(FISH);
    const list = offeredKit(world(true).features);
    const en = packForm([...SUGGESTED_PACK], enT, false, {}, list), sv = packForm([...SUGGESTED_PACK], svT, false, {}, list);
    const group = (html: string, g: string) => html.slice(html.indexOf(`data-group="${g}"`), html.indexOf('</details>', html.indexOf(`data-group="${g}"`)));
    expect(group(en, 'tools')).toContain('data-kit="hand-axe"');
    expect(group(en, 'fire-food')).toContain('data-kit="fishing-kit"');
    expect(en).toMatch(/Hand axe<\/b> <i>handyxa<\/i><span class="kkg">0\.6 kg/);
    expect(en).toMatch(/Fishing kit<\/b> <i>fiskeset<\/i><span class="kkg">0\.2 kg/);
    expect(sv).toContain('<b>Handyxa</b>');
    expect(sv).toContain('<b>Fiskeset</b>');
    // They weigh what they say, in the pack and in their section's sum.
    const packed = [...SUGGESTED_PACK, AXE, FISH];
    expect(packWeight(packed)).toBeCloseTo(packWeight(SUGGESTED_PACK) + 0.8, 9);
    expect(groupSummary('tools', [AXE], enT, list)).toMatch(/0\.6 kg/);
    expect(validPack(packed, world(true))).toBe(true);
    // A new game (every switch at its default) offers them; the AI's packing turn lists them.
    const msg = observePack(makeWarden({ id: 'w-pack-ai' }).sim);
    // With the pack's volume on too (#1871, a default), each line also says its litres and whether it straps on.
    expect(msg).toContain(`- hand-axe (0.6 kg, 1 L, can strap outside): Hand axe — ${kitItem(AXE).does}`);
    expect(msg).toContain(`- fishing-kit (0.2 kg, 0.5 L): Fishing kit — ${kitItem(FISH).does}`);
    expect(parsePackDecision('{"pack":["hand-axe","fishing-kit"]}', world(true))).toMatchObject({ ok: true });
  });

  it('5. the same seed and moves play the same run; with the switch off or absent the items aren\'t offered, and a run naming them plays as one without them', () => {
    const moves = ['wood', 'fish', 'water'] as const;
    const on = () => runDay(warden([...SUGGESTED_PACK, AXE, FISH], true, 'w-same'), [...moves]).state;
    expect(JSON.stringify(on())).toBe(JSON.stringify(on()));
    for (const off of [false, 'absent'] as const) {
      const features = world(off).features;
      // Not on the list: not on the screen, not to the AI, not in a pack.
      expect(offeredKit(features).map(k => k.id)).toEqual(KIT.map(k => k.id).filter(id => id !== AXE && id !== FISH));
      const html = packForm([...SUGGESTED_PACK], enT, false, {}, offeredKit(features));
      expect(html).not.toContain('hand-axe');
      expect(html).not.toContain('fishing-kit');
      const s = warden([...SUGGESTED_PACK], off, 'w-off');
      expect(observePack(s)).not.toContain('hand-axe');
      expect(observePack(s)).not.toContain('fishing-kit');
      expect(packProblem([AXE], world(off))).toBe('there\'s no "hand-axe" on the list');
      expect(parsePackDecision('{"pack":["fishing-kit"]}', world(off))).toMatchObject({ ok: false });
      expect(repack(s, [...SUGGESTED_PACK, AXE])).toBe(s);
      for (let seed = 1; seed <= 20; seed++) expect(randomPack(rng(seed), features)).not.toContain(AXE);
      // A pack naming them (a Warden carried on from a run with the switch) starts as the pack without them, and plays the same.
      const named = warden([...SUGGESTED_PACK, AXE, FISH], off, 'w-off');
      expect(named.kit?.items).toEqual([...SUGGESTED_PACK]);
      expect(JSON.stringify(runDay(named, [...moves]).state)).toBe(JSON.stringify(runDay(s, [...moves]).state));
    }
    // The random player's pack is the one it always was without the switch (the list's order and length are the old ones).
    expect(randomPack(rng(3), world('absent').features)).toEqual(randomPack(rng(3), world(false).features));
  });
});
