/**
 * Acceptance tests for #1344 — animals met on the land, each with options that suit the animal,
 * shifted by talents, skills, stats and gear. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, chooseOption, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD } from './world';
import { encounterById, chanceOf, optionsFor, encounterFor, rollOutcome } from './encounters';
import { seedOf } from './talents';
import type { Talent } from './talents';

/** A Warden with no talents or quirks facing `id`, calm, at full health unless told otherwise. */
function facing(id: string, extra: Partial<Region1State> = {}, who = 'w-animals', talents: Talent[] = []): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: true } }, undefined, { id: who });
  return {
    ...s, character: { ...s.character, talents, quirks: [] }, hoursToday: 4,
    pending: { id, day: 5, hour: 12, ring: 2, action: 'hunt', state: 'calm', margin: 0 }, encounterDay: 5, ...extra,
  };
}
const option = (id: string, opt: string) => encounterById(id)!.options.find(o => o.id === opt)!;
const withStat = (s: Region1State, stat: 'str' | 'con', v: number): Region1State => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, [stat]: v } } });

describe('Animals (#1344)', () => {
  // 1. The she-bear with Scouting 2+: "back away" reads safe and never fails.
  it('lets a good scout back away from a bear safely', () => {
    const scout = (who: string) => facing('she-bear', { skills: { scouting: 20 } }, who);
    expect(optionsFor(scout('w-bear'), encounterById('she-bear')!).find(o => o.option.id === 'back-away')!.odds).toBe('safe');
    for (let i = 0; i < 30; i++) {
      const after = chooseOption(scout(`w-bear-${i}`), 'back-away');
      expect(after.log.at(-1)!.text).toBe('Back away slowly, eyes down: You give her all the room she wants, and she lets you go.');
    }
    // Without the scouting it's a gamble.
    expect(chanceOf(facing('she-bear'), option('she-bear', 'back-away'))).toBeLessThan(1);
  });

  // 2. Wolves, with firewood: building a fire costs its firewood and never fails.
  it('holds the wolves off with a fire, at the cost of the wood', () => {
    for (let i = 0; i < 20; i++) {
      const s = facing('wolf-pack', { stores: { ...createRegion1().stores, firewood: 5 } }, `w-wolf-${i}`);
      const after = chooseOption(s, 'fire');
      expect(after.stores.firewood).toBe(3);
      expect(after.vitals.condition).toBe(s.vitals.condition);
      expect(after.log.at(-1)!.text).toMatch(/The fire holds them at the edge of the light/);
      expect(after.hoursToday).toBe(s.hoursToday + 3);
    }
    // No wood, no fire.
    expect(optionsFor(facing('wolf-pack'), encounterById('wolf-pack')!).find(o => o.option.id === 'fire')!.unmet).toBe('needs 2 firewood');
  });

  // 3. A fight option: better odds with a knife, and at STR 14 than at STR 8.
  it('makes a fight likelier to go your way with a knife and with strength', () => {
    for (const [id, opt] of [['she-bear', 'fight'], ['wolf-pack', 'fight'], ['wild-boar', 'fight']] as const) {
      const bare = facing(id);
      const armed = { ...bare, tools: [{ item: 'stone-knife', grade: 'sound' as const }] };
      expect(chanceOf(armed, option(id, opt))).toBeGreaterThan(chanceOf(bare, option(id, opt)));
      expect(chanceOf(withStat(bare, 'str', 14), option(id, opt))).toBeGreaterThan(chanceOf(withStat(bare, 'str', 8), option(id, opt)));
    }
  });

  // 4. Condition 20, failing "fight" against the bear: the run ends died, "Killed by a bear".
  it('can kill: a lost fight with a bear', () => {
    let s: Region1State | null = null;
    for (let i = 0; i < 100 && !s; i++) {
      const c = facing('she-bear', { vitals: createVitals({ condition: 20 }) }, `w-mauled-${i}`);
      if (rollOutcome(seedOf(`w-mauled-${i}`), c.pending!, option('she-bear', 'fight'), chanceOf(c, option('she-bear', 'fight'))).tier === 'fail') s = c;
    }
    const after = chooseOption(s!, 'fight');
    expect(after.outcome?.kind).toBe('died');
    expect(after.log.at(-1)!.text).toBe('Killed by a bear.');
    // A tough body clings on, once (the last stand).
    const tough = { ...s!, character: { ...s!.character, talents: [{ id: 'tough' as const, tier: 3, known: true }] } };
    const clung = chooseOption(tough, 'fight');
    expect(clung.outcome).toBeNull();
    expect(clung.vitals.condition).toBe(1);
    expect(clung.character.lastStandUsed).toBe(true);
    // A wound is softened by CON: the same mauling costs less at CON 14 than at CON 6.
    const hurt = (con: number) => { const w = withStat({ ...s!, vitals: createVitals({ condition: 100 }) }, 'con', con); return w.vitals.condition - chooseOption(w, 'fight').vitals.condition; };
    expect(hurt(14)).toBeLessThan(hurt(6));
    expect(hurt(10)).toBe(30);
  });

  // 5. "Throw her food" with fewer than 2 food: unavailable, with the reason.
  it('needs food to throw the bear', () => {
    const hungry = facing('she-bear', { stores: { ...createRegion1().stores, rawFood: 1 } });
    expect(optionsFor(hungry, encounterById('she-bear')!).find(o => o.option.id === 'throw-food')!.unmet).toBe('needs 2 food');
    const fed = facing('she-bear', { stores: { ...createRegion1().stores, rawFood: 4 } });
    expect(chooseOption(fed, 'throw-food').stores.rawFood).toBe(2);
  });

  // 6. Hunter's Patience: putting the wounded deer down yields +1 food over the same roll without.
  it('gets a patient hunter more from the wounded deer', () => {
    const knife = { tools: [{ item: 'stone-knife', grade: 'sound' as const }] };
    const plain = chooseOption(facing('wounded-deer', knife), 'put-down');
    const hunter = chooseOption(facing('wounded-deer', knife, 'w-animals', [{ id: 'hunter', tier: 1, known: true }]), 'put-down');
    expect(hunter.stores.rawFood).toBe(plain.stores.rawFood + 1);
    expect(hunter.stores.hides).toBe(plain.stores.hides);
    // No knife, no mercy.
    expect(optionsFor(facing('wounded-deer'), encounterById('wounded-deer')!).find(o => o.option.id === 'put-down')!.unmet).toBe('needs a stone knife');
  });

  it('puts each animal where and when it belongs', () => {
    // Wolves come in winter — or at dusk, any time; bears and rutting elk only in autumn.
    const met = (season: 'autumn' | 'winter', dark: boolean) => {
      const seen = new Set<string>();
      for (let d = 1; d <= 400; d++) for (const h of [8, 12, 16]) { const t = encounterFor(seedOf('w-where'), d, h, 3, season, dark); if (t) seen.add(t.id); }
      return seen;
    };
    expect(met('winter', false)).toContain('wolf-pack');
    expect(met('winter', false)).not.toContain('she-bear');
    expect(met('autumn', true)).toContain('wolf-pack');
    expect(met('autumn', false)).not.toContain('wolf-pack');
    expect(met('autumn', false)).toContain('she-bear');
    // Watching the lynx teaches hunting.
    const watched = chooseOption(facing('lynx-kill'), 'watch');
    expect(watched.skills.hunting ?? 0).toBeGreaterThan(0);
  });
});
