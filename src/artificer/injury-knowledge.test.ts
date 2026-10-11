/**
 * Tests for #1410 — injuries, part 6: what you understand of an injury, by First aid. Pain is felt
 * by everyone (#1409); First aid turns it into understanding, rung by rung.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD } from './world';
import { createExploration, scout } from './exploration';
import { LEVEL_HOURS } from './skills';
import { injure, injuryView, injuryWords, riskFor, healingLine, KNOWS, AGGRAVATE_CHANCE } from './injuries';
import { observe } from '../artificer-ai/observe';

const sprain = injure('sprain', 'serious');

describe('What you understand of an injury (#1410)', () => {
  it('reveals more with each rung of First aid', () => {
    // Untrained: only the part that hurts.
    expect(injuryView(sprain, 0)).toEqual({ name: 'ankle' });
    // Novice: light or bad.
    expect(injuryView(sprain, KNOWS.badness)).toEqual({ name: 'bad sprain', badness: 'bad' });
    expect(injuryView(injure('sprain', 'minor'), KNOWS.badness).name).toBe('light sprain');
    // Apprentice (a scout's start): the severity, and that heavy work could make it worse.
    expect(injuryView(sprain, KNOWS.severity)).toEqual({ name: 'sprained ankle', badness: 'bad', severity: 'serious', risk: true });
    // Adept: about how many good nights — a treated one heals faster.
    expect(injuryView(sprain, KNOWS.nights).nights).toBe(6);
    expect(injuryView({ ...sprain, treated: 'good' }, KNOWS.nights).nights).toBe(2);
    // Journeyman: festering, the odds, and whether it will leave a mark.
    expect(injuryView(sprain, KNOWS.everything)).toMatchObject({ worsenChance: AGGRAVATE_CHANCE, willMark: false, festers: false });
    expect(injuryView(injure('cut', 'serious'), KNOWS.everything).festers).toBe(true);
    expect(injuryView(injure('cut', 'grave'), KNOWS.everything).willMark).toBe(true);
    expect(injuryView({ ...injure('cut', 'grave'), mended: true }, KNOWS.everything).willMark).toBe(false);
    // In words, for the screen and the AI.
    expect(injuryWords(sprain, 0)).toBe('ankle, walking and heavy work are harder, untreated');
    expect(injuryWords(sprain, KNOWS.everything)).toBe('serious sprained ankle, physical work and walking cost 1.3x, about 6 more good nights to heal, untreated, heavy work could make it worse (15% each time)');
    expect(healingLine({ ...sprain, heal: 3 }, 0)).toBe('Your ankle is mending.');
    expect(healingLine({ ...sprain, heal: 3 }, KNOWS.nights)).toBe('Your sprained ankle (serious) is mending — about 3 more good nights.');
  });

  it('warns about risky work only from Apprentice', () => {
    expect(riskFor([sprain], 'wood', 1, false, KNOWS.badness)).toBeNull();
    expect(riskFor([sprain], 'wood', 1, false, KNOWS.severity)).toBe('🩹 could make your sprain worse');
  });

  it('names the severity in the journal only from Apprentice', () => {
    // A Warden for whom gathering in the worst conditions ends in a sprain.
    const grim = (id: string, firstaid: number): Region1State => {
      const s = createRegion1({ world: { ...FULL_WORLD, luck: false } }, undefined, { id });
      return { ...s, day: 12, hoursToday: 13, weatherToday: 'storm', explore: scout(scout(createExploration(), 1), 2), skills: { firstaid: LEVEL_HOURS[firstaid] }, vitals: createVitals({ vigor: 15, clarity: 25 }), stores: { ...s.stores, water: 5, rawFood: 5 }, character: { ...s.character, talents: [], quirks: [] } };
    };
    let who = '';
    for (let i = 0; i < 3000 && !who; i++) if (runAction(grim(`w-inj-${i}`, 0), 'gather').injuries?.some(x => x.kind === 'sprain')) who = `w-inj-${i}`;
    const line = (fa: number) => runAction(grim(who, fa), 'gather').log.find(l => /turn your ankle/.test(l.text))!.text;
    expect(line(0)).not.toMatch(/\((minor|serious|grave)\)$/);
    expect(line(KNOWS.severity)).toMatch(/\((minor|serious|grave)\)$/);
  });

  it('shows the AI only what the Warden understands — and the pain, always', () => {
    const at = (firstaid: number): Region1State => {
      const s = createRegion1({}, undefined, { id: 'w-know' });
      return { ...s, injuries: [sprain], skills: { firstaid: LEVEL_HOURS[firstaid] } };
    };
    const untrained = observe(at(0));
    expect(untrained).toMatch(/INJURIES \(as far as your first aid tells you\): ankle, walking and heavy work are harder, untreated/);
    expect(untrained).not.toMatch(/serious/);
    expect(untrained).toMatch(/PAIN: ache/);
    expect(observe(at(KNOWS.everything))).toMatch(/serious sprained ankle, .*about 6 more good nights to heal, untreated, heavy work could make it worse \(15% each time\)/);
  });
});
