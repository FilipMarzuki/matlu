/**
 * The pack screen's folding sections (#1727): every section folds, the viewer's choice is kept
 * (main.ts stores it per browser), and until they choose, a section holding something packed is
 * open and the others are folded. Drawn without a browser, as the other opening tests are.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { KIT, KIT_GROUPS, SUGGESTED_PACK, type KitGroup } from '../artificer/kit';
import { packForm, sectionOpen, readPackOpen } from './opening-view';

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
    expect(e).toContain('PERSONAL <span>1 packed</span>');
    const s = packForm([...SUGGESTED_PACK, 'toy-duck'], sv);
    expect(s).toContain('PERSONLIGT <span>1 packade</span>');
    expect(s).toContain('Leksaksanka');
    expect(s).toContain('Följer med överallt.');
  });
});
