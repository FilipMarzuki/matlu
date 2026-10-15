/**
 * Acceptance tests for #1727 — the pack's 30 odd things: funny, maybe useful, and weird. One test
 * per Given/When/Then scenario in the issue, and one per group of hidden effects.
 *
 * The hidden effects sit behind the `pack-extras` rules switch (features.ts). With it off, the new
 * items are in the pack and weigh what they weigh, and that is all; with it on, the ones the sim has
 * a hook for do their small thing. Either way no new random draws are taken, so the same seed and
 * the same pack play the same game.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, queueHours, type Region1State, type QueueItem } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD, FULL_WORLD } from './world';
import { createExploration, scout, survey } from './exploration';
import { canDrawMap } from './descriptive-map';
import { rollAccident } from './accidents';
import type { Tool } from './crafting';
import {
  KIT, KIT_IDS, KIT_GROUPS, PACK_CAPACITY, SUGGESTED_PACK, packWeight, startFromPack, kitColdCost, kitFireNeed, readKit,
  EXTRA_ITEMS, PACK_EXTRAS, type KitGroup, type KitId,
} from './kit';
import { en } from './i18n/en';
import { sv } from './i18n/sv';
import { observe, observePack } from '../artificer-ai/observe';

const ON = { [PACK_EXTRAS]: true }, OFF = { [PACK_EXTRAS]: false };

/** A scouted Warden with this pack in the flat world (no accidents, no night), switch as given. */
function packed(pack: KitId[], features: Record<string, boolean>, over: Partial<Region1State> = {}): Region1State {
  const s = runAction(createRegion1({ world: { ...FLAT_WORLD, features } }, undefined, { id: 'w-extras', pack }), 'scout');
  return { ...s, hoursToday: 2, vitals: createVitals(), character: { ...s.character, talents: [], quirks: [] }, ...over };
}
/** …fed and watered for the night. */
const fed = (pack: KitId[], features: Record<string, boolean>, over: Partial<Region1State> = {}): Region1State => {
  const s = packed(pack, features, over);
  return { ...s, stores: { ...s.stores, rawFood: 9, water: 9 } };
};
const said = (s: Region1State, re: RegExp): boolean => s.log.some(l => re.test(l.text));

/** The 30 from the issue, and the section each one belongs in. */
const PLACEMENT: Readonly<Record<string, KitGroup>> = {
  // Funny
  'family-tent': 'sleep', salsa: 'fire-food', hairdryer: 'personal', 'home-pillow': 'sleep', dumbbells: 'personal',
  hammer: 'tools', 'big-bag-sweets': 'fire-food', 'rubber-boots': 'clothes', flamingo: 'personal', rice: 'fire-food',
  // Maybe useful
  harmonica: 'personal', 'board-game': 'personal', binoculars: 'tools', 'duct-tape': 'tools', 'sewing-kit': 'tools',
  'magnifying-glass': 'tools', 'notebook-pencils': 'other', 'bird-book': 'tools', 'throat-sweets': 'fire-food', 'lots-of-socks': 'clothes',
  // Weird
  'toy-duck': 'personal', 'garden-gnome': 'personal', 'snow-globe': 'personal', 'roller-skate': 'personal', 'alarm-clock': 'personal',
  'dala-horse': 'personal', 'sock-puppet': 'personal', 'pickled-herring': 'fire-food', 'smooth-stones': 'personal', accordion: 'personal',
};

describe('The pack\'s odd things (#1727)', () => {
  // Given the kit, then all 30 items exist with an English and a Swedish name, `does` and `note`,
  // and no `does` reveals numbers or game terms.
  it('has all 30, named and described in English and Swedish, with no numbers or game terms', () => {
    const ids = Object.keys(PLACEMENT);
    expect(ids).toHaveLength(30);
    expect([...EXTRA_ITEMS].sort()).toEqual([...ids].sort());
    for (const id of ids as KitId[]) {
      const k = KIT.find(x => x.id === id);
      expect(k, id).toBeDefined();
      expect(k!.sv?.trim(), id).toBeTruthy();
      expect(k!.weight, id).toBeGreaterThan(0);
      for (const key of [`kit.${id}`, `kit.${id}.does`, `kit.${id}.note`] as const) {
        expect((en as Record<string, string>)[key]?.trim(), key).toBeTruthy();
        expect((sv as Record<string, string>)[key]?.trim(), `sv ${key}`).toBeTruthy();
      }
      for (const does of [k!.does, (sv as Record<string, string>)[`kit.${id}.does`]!]) {
        expect(does, id).not.toMatch(/[0-9%+]/);
        expect(does, id).not.toMatch(/clarity|vigor|condition|strength|firewood|insight|klarhet|\bork\b|\bved\b/i);
      }
    }
    // The heavy ones are genuinely heavy: each of these is half a pack or near it.
    const kg = (id: KitId) => KIT.find(k => k.id === id)!.weight;
    for (const id of ['family-tent', 'dumbbells', 'accordion'] as KitId[]) expect(kg(id), id).toBeGreaterThanOrEqual(3.5);
    // The 9 kg pack and the leader's list are unchanged: the new things are temptations, not defaults.
    expect(PACK_CAPACITY).toBe(9);
    expect(SUGGESTED_PACK.some(id => ids.includes(id))).toBe(false);
    expect(packWeight(SUGGESTED_PACK)).toBeLessThanOrEqual(PACK_CAPACITY);
  });

  // Given the pack sections, then every item is in exactly one section, and the Personal section
  // holds only items that fit no other.
  it('puts every item in exactly one section, and only the misfits in Personal', () => {
    expect(Object.keys(KIT_GROUPS)).toEqual(['sleep', 'fire-food', 'clothes', 'tools', 'other', 'personal']);
    for (const k of KIT) expect(Object.keys(KIT_GROUPS), k.id).toContain(k.group);
    expect(new Set(KIT_IDS).size).toBe(KIT_IDS.length);
    for (const [id, g] of Object.entries(PLACEMENT)) expect(KIT.find(k => k.id === id)!.group, id).toBe(g);
    // Personal is new, and holds only new things: everything a scout's list has fits a section of its own.
    expect(KIT.filter(k => k.group === 'personal').every(k => EXTRA_ITEMS.includes(k.id))).toBe(true);
    expect(KIT.filter(k => k.group === 'personal').map(k => k.id).sort())
      .toEqual(Object.entries(PLACEMENT).filter(([, g]) => g === 'personal').map(([id]) => id).sort());
  });

  // The AI player sees them as a player does: name and what it's for, never the rule.
  it('shows the AI the odd things by name and `does` only', () => {
    const s = createRegion1({ world: { ...FLAT_WORLD, features: ON } }, undefined, { id: 'w-ai', pack: ['accordion', 'duct-tape'] });
    const packing = observePack(s), playing = observe(s);
    for (const id of EXTRA_ITEMS) {
      const k = KIT.find(x => x.id === id)!;
      expect(packing, id).toContain(`${k.name} — ${k.does}`);
      expect(packing, id).not.toContain(k.effect);
    }
    expect(packing).toMatch(/^PERSONAL$/m);
    expect(playing).toContain('Accordion — You\'ve practised a little.; Duct tape — Fixes things.');
  });

  // Given the switch off, then a packed item changes nothing but weight.
  it('with the switch off, a packed odd thing changes nothing but the pack', () => {
    // Without the switch it's off: a run from before #1727 never had the effects.
    expect(startFromPack(['pickled-herring']).stores).toEqual(startFromPack([]).stores);
    const strip = (s: Region1State) => ({ ...s, kit: undefined, character: { ...s.character, pack: undefined } });
    const world = { ...FULL_WORLD, features: OFF };
    const days: QueueItem[][] = [['scout', 'gather', 'wood'], ['gather', 'water', 'rest'], ['wood', 'rest']];
    const play = (pack: KitId[]): Region1State => {
      let s = createRegion1({ world }, undefined, { id: 'w-off', pack });
      // Fed and watered, a little worn, in the cold of late autumn, so the night's hooks all get asked.
      s = { ...s, day: 30, weatherToday: 'clear', vitals: createVitals({ clarity: 40 }), stores: { ...s.stores, rawFood: 9, water: 9 } };
      for (const q of days) s = runDay(s, q).state;
      return s;
    };
    const bare = strip(play([]));
    for (const id of EXTRA_ITEMS) expect(strip(play([id])), id).toEqual(bare);
    // A storm day's night and a rainy day's soaking, too.
    for (const weather of ['storm', 'rain'] as const) {
      const night = (pack: KitId[]) => strip(runDay({ ...fed(pack, OFF), weatherToday: weather, wetHours: 99, vitals: createVitals({ clarity: 40 }) }, ['rest']).state);
      for (const id of EXTRA_ITEMS) expect(night([id]), `${id} in ${weather}`).toEqual(night([]));
    }
  });

  describe('with the switch on', () => {
    // Sleep and warmth: the family tent and the hard sweets ease a cold night, the pillow from home sleeps better.
    it('sleeps warmer and better', () => {
      const run = (items: KitId[], features = ON) => ({ kit: startFromPack(items).kit, config: { world: { features } } });
      expect(kitColdCost(run(['family-tent']))).toBeCloseTo(0.9, 10);
      expect(kitColdCost(run(['throat-sweets']))).toBeCloseTo(0.95, 10);
      expect(kitColdCost(run(['family-tent', 'wool-underlayer']))).toBeCloseTo(0.9 * 0.85, 10);
      expect(kitColdCost(run(['family-tent'], OFF))).toBe(1);
      // A cold night out in the open (the full world, late autumn): the tent takes the edge off.
      const night = (pack: KitId[]) => {
        const s = createRegion1({ world: { ...FULL_WORLD, encounters: false, accidents: false, features: ON } }, undefined, { id: 'w-cold', pack });
        const out = { ...s, day: 40, explore: scout(createExploration(), 1), stores: { ...s.stores, rawFood: 9, water: 9 }, character: { ...s.character, talents: [] } };
        return 100 - runDay(out, ['rest']).state.vitals.condition;
      };
      expect(night(['family-tent'])).toBeLessThan(night([]));
      // The pillow from home: a little more Clarity every night, and it says so.
      const clarity = (pack: KitId[]) => runDay(fed(pack, ON, { vitals: createVitals({ clarity: 30 }) }), []).state;
      const pillow = clarity(['home-pillow']);
      expect(pillow.vitals.clarity.current).toBe(clarity([]).vitals.clarity.current + 1);
      expect(said(pillow, /pillow from home/i)).toBe(true);
    });

    // Food: the herring is food in the stores, and the salsa makes one meal better, once.
    it('brings food and a better meal', () => {
      expect(startFromPack(['pickled-herring'], true).stores.rations).toBe(1);
      expect(createRegion1({ world: { ...FLAT_WORLD, features: ON } }, undefined, { id: 'w-f', pack: ['pickled-herring'] }).stores.rations).toBe(1);
      const night1 = runDay(fed(['salsa'], ON, { vitals: createVitals({ clarity: 30 }) }), []).state;
      const plain = runDay(fed([], ON, { vitals: createVitals({ clarity: 30 }) }), []).state;
      expect(night1.vitals.clarity.current).toBe(plain.vitals.clarity.current + 2);
      expect(said(night1, /salsa/i)).toBe(true);
      expect(night1.kit?.used).toEqual(['salsa']);
      // Once only, and the save keeps that it's been eaten.
      const night2 = runDay({ ...night1, stores: { ...night1.stores, rawFood: 9, water: 9 } }, []).state;
      expect(night2.log.filter(l => /salsa/i.test(l.text))).toHaveLength(1);
      expect(readKit(night1.kit)?.used).toEqual(['salsa']);
      expect(readKit({ ...night1.kit, used: ['chainsaw'] })?.used).toBeUndefined();
    });

    // Wet and weather: rubber boots keep you drier, the lots of socks are dry socks, the board game holds the mind up on a storm day.
    it('keeps you drier, and your mind together on a storm day', () => {
      const wet = (pack: KitId[]) => runAction({ ...packed(pack, ON), weatherToday: 'rain' }, 'gather').wetHours ?? 0;
      expect(wet(['rubber-boots'])).toBeCloseTo(wet([]) * 0.75, 10);
      const soaked = (pack: KitId[]) => runDay({ ...fed(pack, ON), weatherToday: 'rain', wetHours: 99 }, []).state;
      expect(said(soaked(['lots-of-socks']), /at least there are dry socks/)).toBe(true);
      expect(said(soaked([]), /at least there are dry socks/)).toBe(false);
      const storm = (pack: KitId[]) => runDay({ ...fed(pack, ON), weatherToday: 'storm', vitals: createVitals({ clarity: 30 }) }, []).state;
      expect(storm(['board-game']).vitals.clarity.current).toBe(storm([]).vitals.clarity.current + 2);
      expect(said(storm(['board-game']), /board game/i)).toBe(true);
      // Not on a fine day.
      expect(said(runDay({ ...fed(['board-game'], ON), weatherToday: 'clear' }, []).state, /board game/i)).toBe(false);
    });

    // Scouting and tracking: binoculars speed scouting and looking out, the bird book tracking and hunting.
    it('scouts, tracks and hunts a little faster', () => {
      const s = (pack: KitId[]) => ({ ...packed(pack, ON), explore: scout(createExploration(), 1) });
      expect(queueHours('scout', s(['binoculars']))).toBeCloseTo(queueHours('scout', s([])) * 0.9, 10);
      expect(queueHours('lookout', s(['binoculars']))).toBeCloseTo(queueHours('lookout', s([])) * 0.9, 10);
      expect(queueHours('track', s(['bird-book']))).toBeCloseTo(queueHours('track', s([])) * 0.9, 10);
      expect(queueHours('hunt', s(['bird-book']))).toBeCloseTo(queueHours('hunt', s([])) * 0.9, 10);
      expect(queueHours('gather', s(['bird-book', 'binoculars']))).toBeCloseTo(queueHours('gather', s([])), 10);
      // Stacks with the map and compass.
      expect(queueHours('scout', s(['binoculars', 'map-compass']))).toBeCloseTo(queueHours('scout', s([])) * 0.9 * 0.8, 10);
    });

    // Fire: on a sunny day the magnifying glass lights the night's fire, and a firewood is spared.
    it('lights the fire in sunshine', () => {
      const run = (items: KitId[], weatherToday: Region1State['weatherToday'], features = ON) => ({ kit: startFromPack(items).kit, config: { world: { features } }, weatherToday });
      expect(kitFireNeed(run(['magnifying-glass'], 'clear'), 4)).toBe(3);
      expect(kitFireNeed(run(['magnifying-glass'], 'overcast'), 4)).toBe(4);
      expect(kitFireNeed(run(['magnifying-glass'], 'clear'), 1)).toBe(1); // a fire still needs wood to burn
      expect(kitFireNeed(run([], 'clear'), 4)).toBe(4);
      expect(kitFireNeed(run(['magnifying-glass'], 'clear', OFF), 4)).toBe(4);
      // In play: a frosty clear night burns one firewood less with the glass.
      const night = (pack: KitId[]) => {
        const s = createRegion1({ world: { ...FULL_WORLD, encounters: false, accidents: false, features: ON } }, undefined, { id: 'w-fire', pack });
        const out = { ...s, day: 40, weatherToday: 'clear' as const, explore: scout(createExploration(), 1), stores: { ...s.stores, rawFood: 9, water: 9, firewood: 30 }, character: { ...s.character, talents: [] } };
        return runDay(out, []).state;
      };
      const glass = night(['magnifying-glass']), bare = night([]);
      expect(30 - bare.stores.firewood).toBeGreaterThanOrEqual(2);
      expect(glass.stores.firewood).toBe(bare.stores.firewood + 1);
      expect(said(glass, /magnifying glass/i)).toBe(true);
    });

    // Repair: duct tape saves a tool from one knock, once.
    it('patches one damaged tool with duct tape', () => {
      const snare: Tool = { item: 'trap-snare', grade: 'sound' };
      const grim = (id: string, items: KitId[], used?: KitId[]): Region1State => {
        const s = createRegion1({ world: { ...FULL_WORLD, luck: false, features: ON } }, undefined, { id, pack: items });
        return {
          ...s, day: 12, hoursToday: 13, weatherToday: 'storm', explore: scout(scout(createExploration(), 1), 2), tools: [snare],
          vitals: createVitals({ vigor: 15, clarity: 25 }), stores: { ...s.stores, water: 5, rawFood: 5 }, character: { ...s.character, talents: [], quirks: [] },
          ...(s.kit && used ? { kit: { ...s.kit, used } } : {}),
        };
      };
      // The first Warden whose gathering knocks the snare (the accident is the same with or without the tape: no new draw).
      let who = '';
      for (let i = 0; i < 3000 && !who; i++) if (said(runAction(grim(`w-inj-${i}`, []), 'gather'), /takes the fall|snaps under you/)) who = `w-inj-${i}`;
      expect(who).not.toBe('');
      expect(rollAccident).toBeTypeOf('function');
      const taped = runAction(grim(who, ['duct-tape']), 'gather');
      expect(taped.tools).toEqual([snare]);
      expect(said(taped, /duct tape/i)).toBe(true);
      expect(taped.kit?.used).toEqual(['duct-tape']);
      // The roll's used up: the next knock lands.
      expect(runAction(grim(who, ['duct-tape'], ['duct-tape']), 'gather').tools).toEqual([{ item: 'trap-snare', grade: 'crude', crafted: 'sound' }]);
    });

    // The map: the squared notebook is something to draw your own map on (#1686).
    it('draws a map in the squared notebook', () => {
      const knows = (pack: KitId[], features: Record<string, boolean>) => {
        const s = createRegion1({ world: { ...FLAT_WORLD, features: { 'descriptive-map': true, ...features } } }, undefined, { id: 'w-map', pack });
        return { ...s, explore: survey(createExploration(), 1) };
      };
      expect(canDrawMap(knows(['notebook-pencils'], ON))).toBe(true);
      expect(canDrawMap(knows(['notebook-pencils'], OFF))).toBe(false);
      expect(canDrawMap(knows([], ON))).toBe(false);
    });

    // Training and the morning: the dumbbells work your Strength a little each night; the alarm clock rings at dawn.
    it('trains a little with the dumbbells, and rings at dawn', () => {
      const night = runDay(fed(['dumbbells', 'alarm-clock'], ON), []).state;
      expect(night.character.pending?.str).toBe(0.5);
      expect(runDay(fed([], ON), []).state.character.pending?.str).toBeUndefined();
      expect(said(night, /alarm clock/i)).toBe(true);
      // The alarm rings once, on the first morning; after that you leave it switched off.
      const night2 = runDay({ ...night, stores: { ...night.stores, rawFood: 9, water: 9 } }, []).state;
      expect(night2.log.filter(l => /alarm clock/i.test(l.text))).toHaveLength(1);
    });
  });

  // Given the same seed and the same pack, then the same run.
  it('plays the same run from the same seed and pack, with the switch on or off', () => {
    const pack: KitId[] = ['salsa', 'home-pillow', 'binoculars', 'duct-tape', 'magnifying-glass', 'notebook-pencils', 'bird-book', 'throat-sweets', 'lots-of-socks', 'rubber-boots', 'board-game', 'pickled-herring'];
    expect(packWeight(pack)).toBeLessThanOrEqual(PACK_CAPACITY);
    const play = (features: Record<string, boolean>) => {
      let s = createRegion1({ world: { ...FULL_WORLD, features } }, undefined, { id: 'w-same', pack });
      for (const q of [['scout', 'gather', 'wood'], ['track', 'water', 'rest'], ['scout', 'gather']] as QueueItem[][]) s = runDay(s, q).state;
      return s;
    };
    expect(play(ON)).toEqual(play(ON));
    // The switch changes what the things do, never the dice: the weather and the land roll the same.
    const on = play(ON), off = play(OFF);
    expect(on.weatherToday).toBe(off.weatherToday);
    expect(on.forecast).toEqual(off.forecast);
  });
});
