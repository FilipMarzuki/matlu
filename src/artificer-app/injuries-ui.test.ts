/**
 * Tests for #1395 — injuries on screen and in the AI harness: the queue's warning for work that
 * could make an injury worse (the same rule the sim rolls), and the report's injury counts.
 * The chips and the old-wounds block are checked by screenshot.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { FLAT_WORLD } from '../artificer/world';
import { createExploration, scout } from '../artificer/exploration';
import { injure, atRisk, riskLine, canWorsen } from '../artificer/injuries';
import { previewQueue } from './controller';
import { injurySummaryOf, type Transcript } from '../artificer-ai/report';
import { observe } from '../artificer-ai/observe';

const hurt = (over: Partial<Region1State> = {}): Region1State => {
  const s = createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-ui' });
  return { ...s, explore: scout(scout(scout(createExploration(), 1), 2), 3), stores: { ...s.stores, materials: 10 }, ...over };
};

describe('Injuries on screen (#1395)', () => {
  it('warns in the queue when work could make a serious injury worse', () => {
    const s = hurt({ injuries: [injure('sprain', 'serious')] });
    const p = previewQueue({ sim: s, queue: ['wood', 'rest', 'gather', 'gather@3'] });
    expect(p.strains).toEqual(['🩹 could make your sprain worse', null, null, '🩹 could make your sprain worse']);
    // A hurt hand: crafting strains it, felling doesn't.
    const hand = previewQueue({ sim: hurt({ injuries: [injure('hand', 'serious')] }), queue: ['knife', 'wood'] });
    expect(hand.strains).toEqual(['🩹 could make your hurt hand worse', null]);
    // Treated, minor or grave: no warning (only a serious, untreated injury can worsen).
    for (const i of [{ ...injure('sprain', 'serious'), treated: 'fair' as const }, injure('sprain', 'minor'), injure('sprain', 'grave')]) {
      expect(previewQueue({ sim: hurt({ injuries: [i] }), queue: ['wood'] }).strains).toEqual([null]);
    }
    expect(atRisk([injure('cut', 'serious')], 'wood', 1, false)).toBeNull();
    expect(riskLine(injure('cut', 'serious'))).toBe('🩹 could make your cut worse');
    // The chip's warning colour: serious and untreated — work could worsen it, or a cut could fester.
    expect(canWorsen(injure('cut', 'serious'))).toBe(true);
    expect(canWorsen({ ...injure('cut', 'serious'), treated: 'good' })).toBe(false);
  });

  it('shows the AI its injuries and old wounds, and counts them in the report', () => {
    const s = hurt({ injuries: [injure('sprain', 'serious')], character: { ...hurt().character, harms: ['scar'] } });
    expect(observe(s)).toMatch(/INJURIES: serious sprained ankle .*6 healing to go — untreated: heavy work could make it grave/);
    expect(observe(s)).toMatch(/OLD WOUNDS: a scar \(it aches on cold nights\)/);
    const run = (journal: string[]) => ({ turns: [{ journal }] }) as unknown as Transcript;
    const summary = injurySummaryOf([
      run(['You turn your ankle on wet stone — a sprain. It will slow you for days. (serious)', 'You push on through it, and something gives — your sprained ankle is worse now (grave).', 'Your sprained ankle (grave) is mending — 3 more to heal.']),
      run(['The tool slips and opens your hand — it will be stiff for days. (minor)', 'The deep cut has gone bad overnight — hot, red and angry. It\'s grave now.', 'Your sprained ankle has healed, but it has left you with a stiff knee: the walk out to the far rings costs more.']),
    ]);
    expect(summary).toEqual({ bySeverity: { serious: 1, minor: 1 }, aggravated: 1, festered: 1, harms: { 'a stiff knee': 1 }, perRun: 1 });
  });
});
