/**
 * The "where you stand" line (#1926, ui feature `standing-line`; roadmap item 4 of #1914, F4).
 *
 * The issue is ui-hud, so its acceptance is screenshots; these check the one thing a screenshot
 * can't prove for every state: the line never says ready (or holding) while the winter outlook
 * falls short, and says so when the run is ready. Then what it says at each step, the night, the
 * lock and a focus of your own, what PROGRESS says beside it, and that with the switch off nothing
 * changes. In English and Swedish.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { en as EN } from '../artificer/i18n/en';
import { sv as SV } from '../artificer/i18n/sv';
import { createRegion1, winterReady, type Region1State } from '../artificer/region1';
import { createExploration, type Domain, type Exploration } from '../artificer/exploration';
import { FULL_WORLD } from '../artificer/world';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { knownSpots } from '../artificer/camp-sites';
import { SKILL_IDS } from '../artificer/skills';
import { createVitals } from '../artificer/vitality';
import { survivalPath } from './survival-path';
import { focusPopover, FOCUS_POP_ID } from './focus-popover';
import { nightChip, tonight } from './key-box';
import { milesBlock, outlookBlock, outlookShortfalls, outlookWarnings, progressTab } from './progress-view';
import { STANDING_FEATURE, nextOf, standing, standingLine, standingNote } from './standing-line';

const en = makeT('en');
const sv = makeT('sv');
const text = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const line = (s: Region1State, t = en): string => text(standingLine(s, t, { open: false }));

const stats = (int: number) => ({ str: 10, con: 10, agi: 10, int, wil: 10, cha: 10 });
/** The game's own rules (every rule feature at its default), no encounters to get in the way. */
const run = (): Region1State =>
  createRegion1({ world: { ...FULL_WORLD, encounters: false, features: ruleFeatures() } }, undefined, { id: 'w-astrid', name: 'Vega', stats: stats(13) });
function observedOnly(...domains: Domain[]): Exploration {
  const e = createExploration();
  for (const r of [1, 2, 3] as const) for (const d of domains) e.known[r][d] = 2;
  return e;
}

// The Survival path, step by step, as survival-path.test.ts walks it.
const s1 = (): Region1State => run();
const s2 = (): Region1State => ({ ...s1(), explore: observedOnly('water') });
const s3 = (): Region1State => ({ ...s2(), site: 'river', campSpot: { at: knownSpots(s2()).find(p => p.kind === 'river')!.id, camped: [] } });
const s4 = (): Region1State => { const s = s3(); return { ...s, tier: 1, shelterGrade: 'sound', shelter: { ...s.shelter, type: 'leanto' } }; };
const s5 = (): Region1State => { const s = s4(); return { ...s, stores: { ...s.stores, rawFood: 4, rations: 3 } }; };
/** Winter-ready by the four pillars (20 rations, 40 firewood, a warm hut, a sound body), but 24 nights of food against ~30: the day-14 trap. */
const pillarsReady = (): Region1State => {
  const s = s5();
  return { ...s, tier: 2, shelterGrade: 'fine', shelter: { ...s.shelter, type: 'hut', walls: 'stone', sited: true },
    stores: { ...s.stores, rations: 20, firewood: 40 }, tools: [...s.tools, { item: 'bedroll', grade: 'fine' } as Region1State['tools'][number]] };
};
/** Ready: the pillars and the outlook both hold. */
const ready = (): Region1State => { const s = pillarsReady(); return { ...s, stores: { ...s.stores, rations: 40, firewood: 200 } }; };
const withStores = (s: Region1State, stores: Partial<Region1State['stores']>): Region1State => ({ ...s, stores: { ...s.stores, ...stores } });
const READY_WORDS = /Ready for winter|Holding to the thaw|Redo för vintern|räcker till tövädret|ready|holding/i;

describe('the standing-line ui feature (#1926)', () => {
  it('is a ui feature, experimental, on by default, registered after readable type, and no run saves it', () => {
    expect(featureById(STANDING_FEATURE)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue: 1926 });
    expect(uiFeatureOn({}, STANDING_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [STANDING_FEATURE]: false }, STANDING_FEATURE)).toBe(false);
    expect(FEATURES.findIndex(f => f.id === STANDING_FEATURE)).toBeGreaterThan(FEATURES.findIndex(f => f.id === 'readable-type'));
    expect(STANDING_FEATURE in ruleFeatures()).toBe(false);
    expect(ruleFeatures({ [STANDING_FEATURE]: false })).toEqual(ruleFeatures());
  });

  it('has every string in English and Swedish, with the same {vars}', () => {
    const keys = Object.keys(EN).filter(k => k.startsWith('stand.'));
    expect(keys.length).toBeGreaterThan(20);
    const vars = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for (const k of keys) {
      const s = (SV as Record<string, string>)[k];
      expect(s, k).toBeTruthy();
      expect(vars(s), k).toEqual(vars((EN as Record<string, string>)[k]));
    }
  });
});

describe('the line never reads as ready while the outlook falls short (#1926)', () => {
  it('Given winter-ready by the pillars but food for 24 of ~30 nights, When the line is drawn, Then it says what is short, not ready', () => {
    const s = pillarsReady();
    expect(winterReady(s)).toBe(true);
    expect(outlookShortfalls(s)).toEqual([{ what: 'food', have: 24, need: 30 }]);
    expect(line(s)).toBe('Next: lay in food — 24 of ~30 nights. Tonight: warm.');
    expect(line(s, sv)).toBe('Nästa: lägg undan mat — 24 av ~30 nätter. I natt: varmt.');
    expect(line(s)).not.toMatch(READY_WORDS);
    expect(line(s, sv)).not.toMatch(READY_WORDS);
  });

  it('Given that state, When the path is read for the line, Then step 5 is the current one, and without the line the path is as before (done)', () => {
    const s = pillarsReady();
    expect(survivalPath(s, { outlook: true }).current).toBe(4);
    expect(survivalPath(s).current).toBeNull();
  });

  it('Given any mix of stores, days and shelters, When the outlook falls short, Then the line never says ready or holding, in either language', () => {
    let short = 0, readyOnes = 0;
    // Each state walks the nights to the thaw, so the grid is kept small: an open camp, a lean-to,
    // a warm hut; the autumn, its last days, the winter; little and plenty of food and wood.
    for (const base of [s3(), s4(), pillarsReady()]) {
      for (const day of [14, 28, 45]) {
        for (const rations of [10, 35]) {
          for (const firewood of [0, 200]) {
            const s = { ...withStores(base, { rations, firewood, rawFood: 0 }), day };
            const st = standing(s);
            if (outlookShortfalls(s).length) {
              short++;
              expect(st.next.kind).not.toBe('ready');
              expect(line(s)).not.toMatch(READY_WORDS);
              expect(line(s, sv)).not.toMatch(READY_WORDS);
            }
            if (st.next.kind === 'ready') {
              readyOnes++;
              expect(outlookShortfalls(s)).toEqual([]);
              expect(winterReady(s) || day >= s.config.calendar.winterDay).toBe(true);
            }
          }
        }
      }
    }
    // Both kinds were met, so the check above checked something.
    expect(short).toBeGreaterThan(15);
    expect(readyOnes).toBeGreaterThan(2);
  }, 30_000);

  it('Given a ready run (the pillars and the outlook both hold), When the line is drawn, Then it says ready for winter', () => {
    const s = ready();
    expect(outlookShortfalls(s)).toEqual([]);
    expect(nextOf(s)).toEqual({ kind: 'ready', season: 'autumn' });
    expect(line(s)).toBe('Ready for winter. Tonight: warm.');
    expect(line(s, sv)).toBe('Redo för vintern. I natt: varmt.');
    expect(standingLine(s, en, { open: false })).toContain('class="sl-next ready"');
  });

  it('Given a ready run in winter, Then it says holding to the thaw, as the old tag did', () => {
    const s = { ...ready(), day: 40 };
    expect(line(s)).toBe('Holding to the thaw. Tonight: warm.');
    expect(line(s, sv)).toBe('Det räcker till tövädret. I natt: varmt.');
  });

  it('Given the outlook short on firewood or warmth alone, Then the line names that', () => {
    // No wood: the mild early nights in a warm hut need no fire, so it "lasts" 14 nights, then runs out.
    expect(nextOf(withStores(ready(), { firewood: 0 }))).toEqual({ kind: 'short', short: { what: 'fuel', have: 14, need: 30, more: 52 } });
    expect(line(withStores(ready(), { firewood: 0 }))).toMatch(/^Next: lay in firewood — 14 of ~30 nights\./);
    expect(line(withStores(ready(), { firewood: 0 }), sv)).toMatch(/^Nästa: lägg undan ved — 14 av ~30 nätter\./);
    expect(outlookWarnings(withStores(ready(), { firewood: 0 }), en)[0]).toMatch(/^Firewood lasts 14 nights/);
    // 20 firewood lasts the autumn's mild nights in a warm hut, so the outlook holds; the pillar's woodpile of 40 is what's left.
    expect(line(withStores(ready(), { firewood: 20 }))).toMatch(/^Next: a woodpile — 20 of 40 firewood\./);
    // A lean-to, with wood and food enough: only the warmth falls short.
    const r = withStores(ready(), { firewood: 400 });
    const cold: Region1State = { ...r, tier: 1, shelterGrade: 'sound', shelter: { ...r.shelter, type: 'leanto', walls: null } };
    expect(outlookShortfalls(cold)).toEqual([{ what: 'cold' }]);
    expect(line(cold)).toMatch(/^Next: a shelter warm enough for midwinter\./);
    expect(line(cold, sv)).toMatch(/^Nästa: ett skydd varmt nog för midvintern\./);
  });
});

describe('what the line says at each step (#1926)', () => {
  it('Given a new run, Then "Next: find a camp site.", and no night before camp on a calm night', () => {
    expect(line(s1())).toBe('Next: find a camp site.');
    expect(line(s1(), sv)).toBe('Nästa: hitta en lägerplats.');
  });

  it('Given steps 2 to 4, Then make camp, build a shelter, a week\'s food in nights', () => {
    expect(line(s2())).toBe('Next: make camp.');
    expect(line(s3())).toMatch(/^Next: build a shelter\. Tonight: /);
    expect(line(s4())).toMatch(/^Next: a week's food — 2 of 7 nights\. Tonight: /);
    expect(line(s4(), sv)).toMatch(/^Nästa: mat för en vecka — 2 av 7 nätter\. I natt: /);
  });

  it('Given the outlook holding but a readiness pillar short, Then it names the pillar, and PROGRESS says not ready yet beside "enough"', () => {
    const larder = withStores(ready(), { rations: 5, rawFood: 40 });
    expect(outlookShortfalls(larder)).toEqual([]);
    expect(line(larder)).toMatch(/^Next: smoke or dry food — 5 of 20 rations\./);
    const block = text(outlookBlock(larder, en, standingNote(larder, en)));
    expect(block).toContain('Enough laid by to reach the thaw');
    expect(block).toContain('Not ready for winter yet. Next: smoke or dry food — 5 of 20 rations.');
    const tired = { ...ready(), vitals: { ...ready().vitals, condition: 65 } };
    expect(line(tired)).toMatch(/^Next: get your strength back\./);
    expect(line(tired, sv)).toMatch(/^Nästa: samla krafter\./);
  });
});

describe('tonight, the lock and a focus of your own (#1926)', () => {
  it('Given a camp, Then tonight is the night chip\'s own warmth in a word, with its tooltip', () => {
    const s = ready();
    const n = tonight(s, en)!;
    expect(n.warmth?.quality).toBe('warm');
    expect(nightChip(s, en)).toContain('WARM NIGHT');
    const html = standingLine(s, en, { open: false });
    expect(html).toContain('<span class="sl-night q-warm">Tonight: warm.</span>');
    expect(html).toContain(n.tip.replace(/'/g, '&#39;'));
  });

  it('Given night: false (the guide hasn\'t shown the night yet), Then the line leaves it out', () => {
    expect(text(standingLine(ready(), en, { open: false, night: false }))).toBe('Ready for winter.');
  });

  it('Given the survival lock, Then it says survival first instead of next, as the FOCUS chip did', () => {
    const s = { ...s3(), deprivation: { hungry: 0, thirsty: 1 } };
    expect(line(s)).toMatch(/^Survival first: thirsty\. Tonight: /);
    expect(line(s, sv)).toMatch(/^Överlevnad först: törstig\./);
    expect(line(s)).not.toContain('Next');
    expect(standingLine(s, en, { open: false })).toContain('class="standline locked"');
  });

  it('Given a skill focus, Then it keeps its name at the end; a goal focus is the path\'s', () => {
    const skill = { ...s1(), focus: { kind: 'skill' as const, id: SKILL_IDS[0] } };
    expect(line(skill)).toMatch(/^Next: find a camp site\. Focus: .+\.$/);
    const goal = { ...s1(), focus: { kind: 'goal' as const, id: 'larder' as const } };
    expect(line(goal)).toBe('Next: find a camp site.');
    const frayed = { ...skill, vitals: { ...createVitals(), clarity: { current: 5, cap: 100 } } };
    expect(line(frayed)).toMatch(/\(frayed\)\.$/);
  });

  it('is the button that opens the focus picker, with the FOCUS chip\'s ARIA, and is empty once the run is over', () => {
    const html = standingLine(s1(), en, { open: true });
    expect(html).toMatch(/^<button class="standline" data-cmd="focuspop" aria-haspopup="dialog" aria-expanded="true" aria-controls="focuspop"/);
    expect(FOCUS_POP_ID).toBe('focuspop');
    const over = { ...ready(), outcome: { kind: 'survived', day: 60, text: '' } as unknown as Region1State['outcome'] };
    expect(standingLine(over, en, { open: false })).toBe('');
  });

  it('opens a picker that agrees with it: step 5 current while the outlook is short, suggesting Larder', () => {
    const pop = focusPopover(pillarsReady(), en, { guide: true, standing: true });
    expect(pop).toContain('SURVIVE 5/5');
    expect(pop).toContain('data-focus="goal:larder"');
    // Without the line the picker is as before: the path done, no checklist.
    expect(focusPopover(pillarsReady(), en, { guide: true })).not.toContain('fppath');
  });
});

describe('PROGRESS agrees with the line (#1926)', () => {
  it('Given Winter-ready reached but the line not ready now, Then the milestone says "(not now)"; ready, it does not', () => {
    const s = { ...pillarsReady(), milestones: ['ready'] };
    expect(text(milesBlock(s, en, standingNote(s, en)))).toContain('WINTER-READY (not now)');
    expect(text(milesBlock(s, sv, standingNote(s, sv)))).toContain('(inte nu)');
    const r = { ...ready(), milestones: ['ready'] };
    expect(milesBlock(r, en, standingNote(r, en))).not.toContain('mnow');
  });

  it('Given the run over, Then there is no note: the line is empty, and PROGRESS is as before', () => {
    const over = { ...pillarsReady(), milestones: ['ready'], outcome: { kind: 'survived', day: 60, text: '' } as unknown as Region1State['outcome'] };
    expect(standingNote(over, en)).toBeUndefined();
  });

  it('Given the switch off (no note), Then PROGRESS is drawn exactly as before', () => {
    for (const s of [s1(), pillarsReady(), { ...pillarsReady(), milestones: ['ready'] }, withStores(ready(), { rations: 5, rawFood: 40 })]) {
      const tab = progressTab(s, [], '', en);
      expect(tab).toBe(progressTab(s, [], '', en, undefined, undefined));
      expect(tab).not.toContain('standnote');
      expect(tab).not.toContain('mnow');
    }
  });

  it('the warnings read the same shortfalls as the line', () => {
    const s = pillarsReady();
    expect(outlookWarnings(s, en)).toEqual(['Food lasts 24 nights — 6 short of the thaw.']);
    expect(outlookShortfalls(s1()).map(f => f.what)).toEqual(['food', 'fuel', 'cold']);
    expect(outlookWarnings(s1(), en)).toHaveLength(3);
  });
});

describe('with the switch off, the chips are as before (#1926)', () => {
  it('the picker and the path read step 5 by the pillars alone', () => {
    for (const s of [s1(), s3(), s5(), pillarsReady(), ready()]) {
      expect(focusPopover(s, en, { guide: true, standing: false })).toBe(focusPopover(s, en, { guide: true }));
      expect(survivalPath(s, { outlook: false })).toEqual(survivalPath(s));
    }
  });

  it('the night chip draws as it did', () => {
    expect(nightChip(ready(), en)).toBe(`<span class="tag nightq q-warm" title="${tonight(ready(), en)!.tip.replace(/'/g, '&#39;')}">🌑 SHELTER 2/2 · WARM NIGHT</span>`);
    expect(nightChip(s1(), en)).toBe('');
  });
});
