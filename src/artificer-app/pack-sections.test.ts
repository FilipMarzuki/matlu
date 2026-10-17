/**
 * The pack screen's folding sections (#1727): every section folds, the viewer's choice is kept
 * (main.ts stores it per browser), and until they choose, a section holding something packed is
 * open and the others are folded. Drawn without a browser, as the other opening tests are.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { KIT, KIT_GROUPS, SUGGESTED_PACK, type KitGroup } from '../artificer/kit';
import { packForm, sectionOpen, readPackOpen, groupSummary, allSectionsOpen, openAllLabel, setAllSections } from './opening-view';

const en = makeT('en'), sv = makeT('sv');
const GROUPS = Object.keys(KIT_GROUPS) as KitGroup[];

/** Each section as drawn: whether it's open, and the items inside it. */
function sections(html: string): Record<string, { open: boolean; items: string[] }> {
  const out: Record<string, { open: boolean; items: string[] }> = {};
  for (const m of html.matchAll(/<details class="kgroup" data-group="([a-z-]+)"( open)?>([\s\S]*?)<\/details>/g)) {
    out[m[1]] = { open: !!m[2], items: [...m[3].matchAll(/data-kit="([a-z-]+)"/g)].map(x => x[1]) };
  }
  return out;
}

describe('Pack sections (#1727)', () => {
  it('draws every item once, inside its own section, every section foldable', () => {
    const s = sections(packForm([...SUGGESTED_PACK], en));
    expect(Object.keys(s)).toEqual(GROUPS);
    for (const g of GROUPS) expect(s[g].items.sort(), g).toEqual(KIT.filter(k => k.group === g).map(k => k.id).sort());
    expect(Object.values(s).flatMap(x => x.items)).toHaveLength(KIT.length);
  });

  it('opens the sections holding something packed, and folds the rest, until the viewer chooses', () => {
    const s = sections(packForm([...SUGGESTED_PACK], en));
    // The leader's list has sleep, food, clothes, tools and the toilet paper in Other; nothing Personal.
    expect(GROUPS.filter(g => s[g].open)).toEqual(['sleep', 'fire-food', 'clothes', 'tools', 'other']);
    expect(s.personal.open).toBe(false);
    expect(GROUPS.some(g => sections(packForm([], en))[g].open)).toBe(false);
    // The viewer's choice wins either way.
    const chosen = sections(packForm([...SUGGESTED_PACK], en, false, { personal: true, sleep: false }));
    expect(chosen.personal.open).toBe(true);
    expect(chosen.sleep.open).toBe(false);
    expect(sectionOpen('personal', ['accordion'])).toBe(true);
    expect(sectionOpen('personal', ['accordion'], { personal: false })).toBe(false);
  });

  it('reads a kept choice safely: only known sections and true or false', () => {
    expect(readPackOpen(JSON.stringify({ sleep: false, personal: true }))).toEqual({ sleep: false, personal: true });
    expect(readPackOpen(JSON.stringify({ sleep: 'yes', nonsense: true, constructor: true }))).toEqual({});
    expect(readPackOpen('not json')).toEqual({});
    expect(readPackOpen(null)).toEqual({});
    expect(readPackOpen('[true]')).toEqual({});
  });

  it('names the sections, Personal among them, and how many are packed, in both languages', () => {
    const e = packForm([...SUGGESTED_PACK, 'toy-duck'], en);
    const nPersonal = KIT.filter(k => k.group === 'personal').length;
    expect(e).toContain(`<b class="kname">PERSONAL</b><span class="ksum">1 of ${nPersonal} packed · 0.1 kg</span>`);
    const s = packForm([...SUGGESTED_PACK, 'toy-duck'], sv);
    expect(s).toContain(`<b class="kname">PERSONLIGT</b><span class="ksum">1 av ${nPersonal} packade · 0,1 kg</span>`);
    expect(s).toContain('Leksaksanka');
    expect(s).toContain('Följer med överallt.');
  });
});

describe('Pack section headings, variant C (#1801)', () => {
  const nSleep = KIT.filter(k => k.group === 'sleep').length;

  it('sums a section: how many packed, of how many, and what they weigh, in the viewer\'s numbers', () => {
    // Sleeping bag 1.6 + pad 0.4 + pillow 0.3 = 2.3 kg.
    const pack = ['sleeping-bag', 'sleeping-pad', 'pillow', 'mora-knife'] as const;
    expect(groupSummary('sleep', pack, en)).toBe(`3 of ${nSleep} packed · 2.3 kg`);
    expect(groupSummary('sleep', pack, sv)).toBe(`3 av ${nSleep} packade · 2,3 kg`);
    // Only the section's own things count, and an empty section weighs nothing.
    expect(groupSummary('personal', pack, en)).toMatch(/^0 of \d+ packed · 0 kg$/);
    // Small weights don't pick up float noise (matches 0.05 + 0.05 + 0.1 written as 0.2).
    expect(groupSummary('fire-food', ['fire-steel', 'matches', 'mora-knife'], en)).toMatch(/^3 of \d+ packed · 0\.2 kg$/);
  });

  it('the sections add up to the pack\'s whole weight', () => {
    const total = GROUPS.reduce((n, g) => n + Number(groupSummary(g, SUGGESTED_PACK, en).match(/· ([\d.]+) kg/)![1]), 0);
    expect(Math.round(total * 100) / 100).toBe(Math.round(SUGGESTED_PACK.reduce((n, id) => n + KIT.find(k => k.id === id)!.weight, 0) * 100) / 100);
  });

  it('draws each heading as a band: the shared chevron, the name, the summary', () => {
    const html = packForm([...SUGGESTED_PACK], en);
    for (const g of GROUPS) {
      expect(html).toMatch(new RegExp(`<summary class="clabel foldhead" data-kitgroup="${g}"><svg class="chev"[^]*?</svg><b class="kname">[^<]+</b><span class="ksum">[^<]+</span></summary>`));
    }
    // The old ▸/▾ glyphs are gone.
    expect(html).not.toMatch(/[▸▾]/);
  });

  it('labels the open-all button by the state: "Open all" until every section is open, then "Close all"', () => {
    // The leader's list leaves Personal folded, so not all are open.
    expect(allSectionsOpen(SUGGESTED_PACK)).toBe(false);
    expect(openAllLabel(SUGGESTED_PACK, en)).toBe('Open all');
    expect(openAllLabel(SUGGESTED_PACK, sv)).toBe('Öppna alla');
    const all = setAllSections(true);
    expect(allSectionsOpen(SUGGESTED_PACK, all)).toBe(true);
    expect(openAllLabel(SUGGESTED_PACK, en, all)).toBe('Close all');
    expect(openAllLabel(SUGGESTED_PACK, sv, all)).toBe('Stäng alla');
    // Closing all folds every section, whatever is packed.
    const none = sections(packForm([...SUGGESTED_PACK], en, false, setAllSections(false)));
    expect(GROUPS.some(g => none[g].open)).toBe(false);
    expect(packForm([...SUGGESTED_PACK], en, false, all)).toContain('data-kitfold="all">Close all</button>');
    expect(packForm([...SUGGESTED_PACK], sv)).toContain('data-kitfold="all">Öppna alla</button>');
  });
});
