/**
 * The status bar's focus picker (#1758): the same choices as the Warden tab's, disabled while
 * survival holds the mind, and a toggle that only the chip opens. The look and the taps are
 * checked by screenshot (Playwright); these are the pure parts.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1, survivalLockOf, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { SKILL_IDS } from '../artificer/skills';
import { ruleFeatures } from '../artificer/features';
import { focusChip, focusPopover, focusPopAfter, FOCUS_POP_ID } from './focus-popover';
import { focusBlock, wardenTab } from './warden-view';

const en = makeT('en');
const sv = makeT('sv');

const fresh = (): Region1State => createRegion1({ world: { ...FULL_WORLD, encounters: false, features: ruleFeatures() } }, undefined, { id: 'w-focuspop', name: 'Vega' });
/** Three nights without water: survival takes over. */
const locked = (): Region1State => { const s = fresh(); return { ...s, deprivation: { ...s.deprivation, thirsty: 3 } }; };

/** Each choice as `key|pressed|title|label`, in order: what a player can pick, and what it says. */
const choices = (html: string): string[] => [...html.matchAll(/<button class="fchip" data-focus="([^"]+)" aria-pressed="(true|false)" title="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map(m => m.slice(1).join('|'));
const disabledCount = (html: string): number => [...html.matchAll(/<button class="fchip"[^>]* disabled>/g)].length;

describe('The status bar focus picker (#1758)', () => {
  it('offers the same choices, notes and descriptions as the Warden tab', () => {
    for (const t of [en, sv]) {
      const s: Region1State = { ...fresh(), focus: { kind: 'skill', id: SKILL_IDS[0] } };
      const pop = focusPopover(s, t);
      expect(choices(pop).length).toBeGreaterThan(5);
      expect(choices(pop)).toEqual(choices(wardenTab({ sim: s }, t)));
      expect(choices(pop)).toEqual(choices(focusBlock(s, t)));
      expect(pop).toContain(`id="${FOCUS_POP_ID}"`);
      expect(pop).toContain('role="dialog"');
      expect(disabledCount(pop)).toBe(0);
      expect(choices(pop).filter(c => c.includes('|true|'))).toHaveLength(1);
    }
  });

  it('disables every choice while survival has taken over, and says why', () => {
    const s = locked();
    expect(survivalLockOf(s)).not.toBeNull();
    const pop = focusPopover(s, en);
    expect(disabledCount(pop)).toBe(choices(pop).length);
    expect(disabledCount(pop)).toBeGreaterThan(5);
    expect(pop).toContain('class="lockbanner"');
    expect(pop).toContain('SURVIVAL HAS TAKEN OVER');
    // The close button still works.
    expect(pop).toMatch(/<button class="fpclose" data-cmd="focuspopclose"[^>]*>/);
    expect(pop).not.toMatch(/fpclose[^>]* disabled/);
    // The Warden tab's own picker is unchanged: its chips stay tappable.
    expect(disabledCount(wardenTab({ sim: s }, en))).toBe(0);
  });

  it('marks the chip as a button that opens the picker, and says whether it is open', () => {
    for (const s of [fresh(), locked()]) {
      const shut = focusChip(s, en, false), open = focusChip(s, en, true);
      expect(shut).toContain('data-cmd="focuspop"');
      expect(shut).toContain('aria-haspopup="dialog"');
      expect(shut).toContain(`aria-controls="${FOCUS_POP_ID}"`);
      expect(shut).toContain('aria-expanded="false"');
      expect(open).toContain('aria-expanded="true"');
      // It no longer switches to the Warden tab.
      expect(shut).not.toContain('data-tab');
    }
    expect(focusChip(locked(), en, false)).toContain('SURVIVAL');
    expect(focusChip(locked(), sv, false)).toContain('ÖVERLEVNAD');
  });

  it('opens only on the chip; the chip again, a tap outside, Esc or a choice close it', () => {
    expect(focusPopAfter(false, 'chip')).toBe(true);
    expect(focusPopAfter(true, 'chip')).toBe(false);
    for (const ev of ['outside', 'escape', 'pick'] as const) {
      expect(focusPopAfter(true, ev)).toBe(false);
      expect(focusPopAfter(false, ev)).toBe(false);
    }
  });

  it('says its close button in the viewer\'s language', () => {
    expect(focusPopover(fresh(), en)).toContain('aria-label="Close the focus picker"');
    expect(focusPopover(fresh(), sv)).toContain('aria-label="Stäng fokusväljaren"');
  });
});
