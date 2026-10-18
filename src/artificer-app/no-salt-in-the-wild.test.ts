/**
 * Acceptance test for #1860 — the Warden has no salt in the wild.
 *
 * Nothing in the kit or the land gives salt, so preserving food at camp is smoked (meat or fish) or
 * air-dried, never salted, in English and in Swedish. Salt still belongs to the places that have it:
 * Saltmere rakes it, its market sells "salted rations", and its people talk about salt fish. Those
 * lines must keep saying so. Wording only: the same run, the same RNG (no rules switch).
 */

import { describe, expect, it } from 'vitest';
import { makeT, CATALOGS } from '../artificer/i18n';
import { ACTIONS, chooseSite, createRegion1, runAction, type Region1State } from '../artificer/region1';
import { VILLAGE_ECONOMY, economyLine, marketLine } from '../artificer/economy';
import { QUESTS } from '../artificer/quests';
import { simLine } from './sim-words';

const sv = makeT('sv');
const en = makeT('en');

function camp(rawFood: number): Region1State {
  const s = chooseSite(runAction(createRegion1(), 'scout'), 'cave');
  return { ...s, stores: { ...s.stores, materials: 20, rawFood, water: 5 } };
}

/** The journal lines one preserve session adds, in English as the sim wrote them. */
function preserveLines(method: 'smoke' | 'dry', rawFood: number): string[] {
  const before = camp(rawFood);
  const after = runAction(before, { q: 'preserve', opts: { method } });
  return after.log.slice(before.log.length).map(l => l.text).filter(t => /winter ration/.test(t));
}

describe('No salt in the wild (#1860)', () => {
  it('preserving in the wild never mentions salt, in en or sv', () => {
    for (const method of ['smoke', 'dry'] as const) {
      // One ration and three: the singular and the plural line.
      for (const rawFood of [2, 6]) {
        const lines = preserveLines(method, rawFood);
        expect(lines).toHaveLength(1);
        for (const line of lines) {
          expect(line).not.toMatch(/salt/i);
          const swedish = simLine(line, sv);
          // It is read back into Swedish, not left in English.
          expect(swedish).not.toBe(line);
          expect(swedish).toMatch(method === 'smoke' ? /^Rökte \d+ mat till \d+ vinterranson/ : /^Lufttorkade /);
          expect(swedish).not.toMatch(/salt/i);
        }
      }
    }
    expect(preserveLines('smoke', 2)[0]).toBe('Smoked 2 food into 1 winter ration.');
    expect(preserveLines('smoke', 6)[0]).toBe('Smoked 6 food into 3 winter rations.');
    // The catalogs' preserve lines, every one of them, in both languages.
    for (const cat of Object.values(CATALOGS)) {
      for (const [k, v] of Object.entries(cat ?? {})) if (k.startsWith('log.preserve.')) expect(v).not.toMatch(/salt/i);
    }
  });

  it('the smoking method says it works for meat and fish', () => {
    const groups = ACTIONS.preserve.options?.(camp(6), {}) ?? [];
    const smoke = groups.flatMap(g => g.choices).find(c => c.value === 'smoke');
    expect(smoke?.note).toMatch(/meat or fish/);
    expect(smoke?.note).toBe(en('opt.smokeNote'));
    expect(simLine(smoke?.note ?? '', sv)).toMatch(/kött eller fisk/);
    for (const c of groups.flatMap(g => g.choices)) expect(`${c.label} ${c.note ?? ''}`).not.toMatch(/salt/i);
  });

  it('Saltmere and the trade still have their salt', () => {
    expect(economyLine('Saltmere', VILLAGE_ECONOMY.saltmere)).toMatch(/lives on salt, and on the fish it salts/);
    expect(marketLine(VILLAGE_ECONOMY.saltmere)).toMatch(/^Salted rations/);
    expect(en('goodword.rations')).toBe('salted rations');
    expect(sv('goodword.rations')).toBe('saltade ransoner');
    // Hedda's quest at Saltmere pays in salt fish; her lore is all salt.
    expect(QUESTS.find(q => q.id === 'sm-smoke-racks')?.offer).toMatch(/salt fish/);
    const svCat: Readonly<Record<string, string>> = CATALOGS.sv ?? {};
    expect(svCat['quest.sm-smoke-racks.offer']).toMatch(/saltfisk/);
    expect(svCat['person.sm-hedda.lore.0']).toMatch(/Saltfisk/);
  });
});
