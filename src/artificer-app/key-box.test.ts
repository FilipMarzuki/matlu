/**
 * Acceptance tests for #1891 — the key survival box under FOCUS (key-box.ts), the night chip with
 * the shelter in it, the PROGRESS rows against the winter outlook (progress-view.ts) and the CAMP
 * tab's full stores list (camp-blocks.ts). Drawn as HTML strings, in English and Swedish.
 *
 * #1915 folds the PROGRESS rows into the winter outlook block itself (`outlookBlock`), one row per
 * key metric, one unit each — no more separate "KEY STORES FOR THE WINTER" list.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1, runAction, chooseSite, winterOutlook, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { STEADY_WORLD } from '../artificer/test-helpers';
import { newGame } from './controller';
import { outlookNights } from '../artificer/key-metrics';
import { foodKinds, keyBox, nightChip } from './key-box';
import { outlookBlock, progressTab } from './progress-view';
import { storesRow } from './camp-blocks';

const en = makeT('en');
const sv = makeT('sv');

function camp(day: number, stores: Partial<Region1State['stores']>, over: Partial<Region1State> = {}): Region1State {
  const s = chooseSite(runAction(createRegion1({ world: STEADY_WORLD }), 'scout'), 'cave');
  return { ...s, day, hoursToday: 0, weatherToday: 'overcast', tier: 1, shelterGrade: 'sound', shelter: { type: 'leanto', walls: null }, vitals: createVitals(),
    stores: { ...s.stores, rawFood: 3, rations: 1, water: 6, firewood: 12, materials: 9, stone: 2, hides: 1, ...stores }, ...over };
}
const text = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the key box (#1891)', () => {
  it('Given 3 raw food and 1 ration, Then food shows as one 🍖 covering "4 days"', () => {
    const box = keyBox(camp(3, {}), en);
    expect(text(box)).toContain('4 days');
    expect(box).toContain('rawFood.png');
    expect(keyBox(camp(3, {}), sv)).toContain('4 dagar');
    expect(text(keyBox(camp(3, { rawFood: 1, rations: 0 }), en))).toContain('1 day');
  });

  it('Given the box, Then water and firewood show as counts, and materials and rations are gone from it', () => {
    const box = keyBox(camp(3, {}), en);
    expect(box).toContain('class="k-water"');
    expect(box).toMatch(/class="k-firewood[^"]*"[^>]*>.*<span class="kv">12<\/span>/);
    expect(box).toMatch(/<span class="kv">6<\/span>/);
    expect(box).not.toContain('materials.png');
    expect(box).not.toContain('🪨');
    // Rations are inside the food's breakdown only, not a cell of their own.
    expect(box.split('</summary>')[0]).not.toContain('item-ration.png');
  });

  it('Given no food and no water, Then both are marked low, with the hunger and thirst streaks', () => {
    const s = camp(3, { rawFood: 0, rations: 0, water: 0 }, { deprivation: { hungry: 2, thirsty: 1 } });
    const box = keyBox(s, en);
    expect(box).toContain('class="kfood low"');
    expect(box).toContain('class="k-water low"');
    expect(text(box)).toContain('HUNGRY ×2');
    expect(text(box)).toContain('THIRSTY ×1');
  });

  it('Given raw food that spoils tonight, When the food is opened, Then it lists the kinds, marks what spoils, and rations keep', () => {
    const s = camp(3, { rawFood: 10, rations: 4 });
    const kinds = text(foodKinds(s, en));
    expect(kinds).toContain('Raw food (meat, fish, forage) 10');
    expect(kinds).toMatch(/\d will spoil tonight/);
    expect(kinds).toContain('Rations (smoked or dried) 4 keeps');
    expect(kinds).toContain('Every store is listed under CAMP.');
    expect(keyBox(s, en)).toContain('<details class="kfood">');
    expect(text(foodKinds(s, sv))).toContain('håller sig');
  });
});

describe('the night chip with the shelter (#1891)', () => {
  it('Given a lean-to at camp, Then the chip says the shelter tier and how warm tonight looks', () => {
    const chip = nightChip(camp(3, {}), en);
    expect(chip).toContain('SHELTER 1/2');
    expect(text(chip)).toMatch(/SHELTER 1\/2 · (WARM NIGHT|COOL NIGHT|COLD NIGHT|DANGEROUSLY COLD|\d+% WARM)/);
    expect(chip).toMatch(/title="Tonight: Shelter tier 1\/2, /);
    expect(nightChip(camp(3, {}), sv)).toContain('SKYDD 1/2');
  });

  it('Given an open camp, Then the chip says there is no shelter', () => {
    expect(nightChip(camp(3, {}, { tier: 0, shelter: { type: null, walls: null } }), en)).toContain('NO SHELTER');
    expect(nightChip(camp(3, {}, { tier: 0, shelter: { type: null, walls: null } }), sv)).toContain('INGET SKYDD');
  });

  it('Given no camp and a calm night, or a finished run, Then there is no chip', () => {
    const fresh = createRegion1({ world: STEADY_WORLD });
    expect(nightChip(fresh, en)).toBe('');
    expect(nightChip(camp(3, {}, { outcome: { kind: 'survived', day: 60, text: '' } as unknown as Region1State['outcome'] }), en)).toBe('');
  });
});

describe('PROGRESS: the key metrics folded into the winter outlook, one unit each (#1915)', () => {
  it('Given a run, Then food and firewood read "n of ~need" from the outlook, each tagged holding or short', () => {
    const s = camp(20, { rawFood: 4, rations: 0, firewood: 12 });
    const o = winterOutlook(s);
    const nights = o.fuelDays === 1 ? '1 night' : `${o.fuelDays} nights`;
    const block = text(outlookBlock(s, en));
    expect(block).toContain(`FOOD 4 of ~${outlookNights(s)} days FALLING SHORT`);
    expect(block).toContain(`FIREWOOD 12 of ~${o.fuelToThaw} (${nights}) FALLING SHORT`);
    expect(block).toContain('WATER 6 · fetched as you go');
    const nightsSv = o.fuelDays === 1 ? '1 natt' : `${o.fuelDays} nätter`;
    expect(text(outlookBlock(s, sv))).toContain(`VED 12 av ~${o.fuelToThaw} (${nightsSv}) RÄCKER INTE`);
  });

  it('Given plenty laid by, Then they read holding', () => {
    const block = text(outlookBlock(camp(20, { rawFood: 0, rations: 80, firewood: 400 }), en));
    expect(block).toMatch(/FOOD 80 of ~\d+ days HOLDING/);
    expect(block).toMatch(/FIREWOOD 400 of ~\d+ \(\d+ nights?\) HOLDING/);
  });

  it('Given a camp that needs no firewood to the thaw (a cave, with the thermal model), Then it says none is needed rather than "of ~0"', () => {
    // A new game's Warden (the page's rules), camped in the cave under a lean-to.
    const sim = newGame().sim;
    const s: Region1State = { ...sim, site: 'cave', day: 20, hoursToday: 0, weatherToday: 'overcast', tier: 1, shelterGrade: 'sound', shelter: { type: 'leanto', walls: null }, stores: { ...sim.stores, firewood: 12 } };
    expect(winterOutlook(s).fuelToThaw).toBe(0);
    expect(text(outlookBlock(s, en))).toContain('FIREWOOD 12 · none needed to the thaw HOLDING');
  });

  it('Given the PROGRESS tab, Then the key rows sit inside the winter outlook, with no separate heading', () => {
    const tab = progressTab(camp(20, {}), [], '', en);
    expect(tab).not.toContain('KEY STORES FOR THE WINTER');
    expect(tab.indexOf('FIREWOOD')).toBeGreaterThan(tab.indexOf('WINTER OUTLOOK'));
    expect(tab.indexOf('FIREWOOD')).toBeLessThan(tab.indexOf('MILESTONES'));
  });
});

describe('the CAMP tab keeps the full stores list (#1891)', () => {
  it('Given the stores, Then every store is listed, materials included', () => {
    const row = text(storesRow(camp(3, {}), en));
    for (const name of ['Food 3', 'Water 6', 'Fuel 12', 'Mat 9', 'Rations 1', 'Stone 2', 'Hides 1']) expect(row).toContain(name);
  });

  it('Given meat among the raw food, Then the food chip says how much of it is meat', () => {
    const s = camp(3, { rawFood: 5 }, { meat: 2, config: { ...camp(3, {}).config, world: { ...STEADY_WORLD, features: { 'camp-scavengers': true } } } });
    expect(text(storesRow(s, en))).toContain('of it, 2 meat');
  });
});
