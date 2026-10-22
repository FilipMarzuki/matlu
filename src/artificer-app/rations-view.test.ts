/**
 * #1848: the eating plan's setting leaves the status bar. Hidden until the first evening meal; the
 * morning after, a one-time note says how it went and that the setting is with the Warden; then a
 * Rations row in the Warden's view. Behind the `rations-warden` ui switch; off, the chip stays.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { makeWarden, act, endTheDay, chooseEating, type AppState } from './controller';
import { wardenTab } from './warden-view';
import { RATIONS_FEATURE, eatingChip, firstMealHad, firstMealVerdict, rationsNote, rationsNoteDue, rationsPlace, rationsRow, type MealVerdict } from './rations-view';

const en = makeT('en');
const sv = makeT('sv');

const fresh = (): AppState => makeWarden({ id: 'w-rations-1', name: 'Ada' });
/** Day 1 worked (or not) on a plan, then the night slept: the morning of day 2. */
const morningAfter = (plan: 'full' | 'half' | 'none', work = true): AppState => {
  let a = fresh();
  if (plan !== 'full') a = chooseEating(a, plan);
  if (work) a = act(a, 'gather');
  return endTheDay(a);
};

/** What the page would draw for the setting, as main.ts composes it. */
const drawn = (a: AppState, on: boolean) => {
  const place = rationsPlace(a.sim, on);
  return {
    status: place === 'status' ? eatingChip(a.sim, en) : '',
    warden: wardenTab(a, en, false, place === 'warden' ? rationsRow(a.sim, en) : ''),
  };
};

describe('the switch (#1848)', () => {
  it('is a ui feature, experimental, on by default, after the Menu, and no run saves it', () => {
    expect(featureById(RATIONS_FEATURE)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue: 1848 });
    expect(uiFeatureOn({}, RATIONS_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [RATIONS_FEATURE]: false }, RATIONS_FEATURE)).toBe(false);
    expect(Object.keys(ruleFeatures())).not.toContain(RATIONS_FEATURE);
    expect(FEATURES.findIndex(f => f.id === RATIONS_FEATURE)).toBeGreaterThan(FEATURES.findIndex(f => f.id === 'meny'));
  });
});

describe('before the first evening meal (#1848)', () => {
  it('day 1: no setting in the status bar or the Warden view, and no note', () => {
    const a = act(fresh(), 'gather');
    expect(a.sim.day).toBe(1);
    expect(firstMealHad(a.sim)).toBe(false);
    expect(rationsPlace(a.sim, true)).toBeNull();
    const d = drawn(a, true);
    expect(d.status).toBe('');
    expect(d.warden).not.toContain('data-eat');
    expect(d.warden).not.toContain('RATIONS');
    expect(rationsNoteDue(a.sim, true, false)).toBe(false);
  });
});

describe('after the first evening meal (#1848)', () => {
  it('the night is behind you on day 2', () => {
    const a = morningAfter('full');
    expect(a.sim.day).toBe(2);
    expect(firstMealHad(a.sim)).toBe(true);
    expect(rationsPlace(a.sim, true)).toBe('warden');
  });

  it('judges the meal from what the sim wrote that night', () => {
    expect(firstMealVerdict(morningAfter('full').sim)).toBe<MealVerdict>('justRight');
    expect(firstMealVerdict(morningAfter('full', false).sim)).toBe<MealVerdict>('tooMuch');
    expect(firstMealVerdict(morningAfter('half').sim)).toBe<MealVerdict>('tooLittle');
    expect(firstMealVerdict(morningAfter('none').sim)).toBe<MealVerdict>('tooLittle');
  });

  it('no food at all is too little too', () => {
    const s = { log: [{ day: 1, text: 'Hungry — no food.', kind: 'hardship' as const }] };
    expect(firstMealVerdict(s)).toBe('tooLittle');
  });

  const lines: Record<MealVerdict, [AppState, string, string]> = {
    justRight: [morningAfter('full'), 'You ate a meal last night — it was just right.', 'Du åt ett mål mat i går kväll. Det räckte precis.'],
    tooMuch: [morningAfter('full', false), 'more than you needed', 'Det var mer än du behövde'],
    tooLittle: [morningAfter('half'), 'really enough', 'Det räckte inte riktigt.'],
  };
  for (const [v, [a, enLine, svLine]] of Object.entries(lines)) {
    it(`the note, ${v}, in English and Swedish, says where the setting is now`, () => {
      const e = rationsNote(a.sim, en);
      expect(e).toContain(enLine);
      expect(e).toContain('How much you eat is set with your Warden');
      expect(e).toContain('data-cmd="rationsok"');
      expect(e).toContain('class="box rationsnote"');
      const s = rationsNote(a.sim, sv);
      expect(s).toContain(svLine);
      expect(s).toContain('Hur mycket du äter ställer du in hos din väktare');
    });
  }

  it('the note shows once: the morning after, until dismissed, and not later on', () => {
    const a = morningAfter('full');
    expect(rationsNoteDue(a.sim, true, false)).toBe(true);
    expect(rationsNoteDue(a.sim, true, true)).toBe(false);
    expect(rationsNoteDue(a.sim, false, false)).toBe(false);
    expect(rationsNoteDue(endTheDay(a).sim, true, false)).toBe(false);
  });

  it('the Warden view has a Rations row with the three plans, the current one pressed', () => {
    const a = morningAfter('half');
    const d = drawn(a, true);
    expect(d.status).toBe('');
    expect(d.warden).toContain('RATIONS — how much you eat each evening');
    for (const p of ['full', 'half', 'none']) expect(d.warden).toContain(`data-eat="${p}"`);
    expect(d.warden).toContain('data-eat="half" aria-pressed="true"');
    expect(d.warden).toContain('data-eat="full" aria-pressed="false"');
    expect(rationsRow(a.sim, sv)).toContain('RANSONER');
  });

  it('with the switch on, the status bar never shows the chip, whatever the day', () => {
    let a = fresh();
    for (let i = 0; i < 5; i++) {
      expect(drawn(a, true).status).toBe('');
      a = endTheDay(act(a, 'gather'));
    }
  });
});

describe('switch off (#1848): as before', () => {
  it('the chip is in the status bar from day 1, and the Warden view has no row', () => {
    for (const a of [fresh(), morningAfter('none')]) {
      const d = drawn(a, false);
      expect(d.status).toContain('data-cmd="eat"');
      expect(d.status).toContain('RATIONS');
      expect(d.warden).not.toContain('data-eat');
    }
    expect(eatingChip(morningAfter('none').sim, en)).toContain('<b>NONE</b>');
    expect(eatingChip(fresh().sim, sv)).toContain('MAT <b>HELT</b>');
  });
});
