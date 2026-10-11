/**
 * Acceptance tests for #1345 — finds: things come across while working, some useful, some a trap,
 * some a story. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, chooseOption, endDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD } from './world';
import { encounterById, optionsFor, chanceOf, rollOutcome, oddsWord, encounterFor } from './encounters';
import { MANUALS } from './techniques';
import { seedOf } from './talents';

/** A Warden facing `id`, calm, with no talents or quirks, and some stores to work with. */
function facing(id: string, extra: Partial<Region1State> = {}, who = 'w-finds'): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: true } }, undefined, { id: who });
  return {
    ...s, character: { ...s.character, talents: [], quirks: [] }, hoursToday: 4,
    stores: { ...s.stores, rawFood: 5, water: 3, firewood: 3 },
    pending: { id, day: s.day, hour: 12, ring: 2, action: 'gather', state: 'calm', margin: 0 }, encounterDay: s.day, ...extra,
  };
}
const read = (s: Region1State, id: string, opt: string) => optionsFor(s, encounterById(id)!).find(o => o.option.id === opt)!;
const option = (id: string, opt: string) => encounterById(id)!.options.find(o => o.id === opt)!;

/** A Warden for whom option `opt` of `id` rolls `tier`. */
function rolling(id: string, opt: string, tier: 'success' | 'mixed' | 'fail', extra: Partial<Region1State> = {}): Region1State {
  for (let i = 0; i < 300; i++) {
    const c = facing(id, extra, `w-find-${tier}-${i}`);
    if (rollOutcome(seedOf(c.character.id), c.pending!, option(id, opt), chanceOf(c, option(id, opt))).tier === tier) return c;
  }
  throw new Error(`no Warden rolls ${tier} on ${id}/${opt}`);
}

describe('Finds (#1345)', () => {
  // 1. "Search it" at the abandoned camp: 2 hours pass and materials rise; a tool found is crude.
  it('searches an abandoned camp: two hours, materials, and maybe a crude tool', () => {
    for (const tier of ['success', 'mixed', 'fail'] as const) {
      const s = rolling('abandoned-camp', 'search', tier);
      const after = chooseOption(s, 'search');
      expect(after.hoursToday).toBe(s.hoursToday + 2);
      expect(after.stores.materials).toBeGreaterThan(s.stores.materials);
      const found = after.tools.slice(s.tools.length);
      for (const t of found) expect(t.grade).toBe('crude');
      expect(found.length).toBe(tier === 'success' ? 1 : 0);
    }
    // Keen Eye finds more.
    const plain = facing('abandoned-camp');
    const keen = { ...plain, character: { ...plain.character, talents: [{ id: 'keenEye' as const, tier: 1, known: true }] } };
    expect(chanceOf(keen, option('abandoned-camp', 'search'))).toBeGreaterThan(chanceOf(plain, option('abandoned-camp', 'search')));
  });

  // 2. "Open it" on the pack: a manual (added to manuals), rations, or a lore line, by the seeded roll.
  it('opens a buried pack to a manual, rations, or a story', () => {
    const manual = chooseOption(rolling('buried-pack', 'open', 'success'), 'open');
    expect(manual.manuals).toEqual([MANUALS[0].id]);
    expect(manual.log.some(l => l.text.startsWith(MANUALS[0].found))).toBe(true);
    // With the first manual already in hand, it's the next one.
    expect(chooseOption(rolling('buried-pack', 'open', 'success', { manuals: [MANUALS[0].id] }), 'open').manuals).toEqual([MANUALS[0].id, MANUALS[1].id]);
    const fed = rolling('buried-pack', 'open', 'mixed');
    expect(chooseOption(fed, 'open').stores.rations).toBe(fed.stores.rations + 3);
    const story = chooseOption(rolling('buried-pack', 'open', 'fail'), 'open');
    expect(story.log.at(-1)!.text).toMatch(/Waited for the caravan/);
    expect(story.manuals).toEqual([]);
    // The same Warden, the same pack, the same outcome.
    const s = rolling('buried-pack', 'open', 'mixed');
    expect(chooseOption(s, 'open')).toEqual(chooseOption(s, 'open'));
  });

  // 3. "Touch it" at the standing stone with Clarity under 30: its odds read desperate.
  it('makes touching the standing stone desperate for a tired mind', () => {
    expect(read(facing('standing-stone', { vitals: createVitals({ clarity: 25 }) }), 'standing-stone', 'touch').odds).toBe('desperate');
    expect(read(facing('standing-stone'), 'standing-stone', 'touch').odds).toBe('risky');
    // Studying it costs Clarity and gives insight.
    const s = facing('standing-stone');
    const after = chooseOption(s, 'study');
    expect(after.vitals.clarity.current).toBe(s.vitals.clarity.current - 10);
    expect(after.concepts.sealing?.insight ?? 0).toBeGreaterThan(s.concepts.sealing?.insight ?? 0);
    // INT shapes study.
    const sharp = { ...s, character: { ...s.character, stats: { ...s.character.stats, int: 14 } } };
    expect(chanceOf(sharp, option('standing-stone', 'study'))).toBeGreaterThan(chanceOf(s, option('standing-stone', 'study')));
  });

  // 4. "Lower a rope" without materials for a rope: unavailable, with the reason.
  it('needs the makings of a rope to lower one', () => {
    const bare = facing('glinting-sinkhole');
    expect(read({ ...bare, stores: { ...bare.stores, materials: 1 } }, 'glinting-sinkhole', 'rope').unmet).toBe('needs 2 materials');
    expect(read({ ...bare, stores: { ...bare.stores, materials: 2 } }, 'glinting-sinkhole', 'rope').unmet).toBeNull();
    // On the rope it's likelier than climbing straight down, and what's down there is fine work.
    expect(chanceOf(bare, option('glinting-sinkhole', 'rope'))).toBeGreaterThan(chanceOf(bare, option('glinting-sinkhole', 'climb-down')));
    const got = chooseOption(rolling('glinting-sinkhole', 'rope', 'success', { stores: { ...bare.stores, materials: 2 } }), 'rope');
    expect(got.tools.at(-1)).toEqual({ item: 'stone-knife', grade: 'fine' });
  });

  // 5. Corrupted ground and "go around": 1 hour passes, with no Condition cost.
  it('goes around corrupted ground for an hour and nothing more', () => {
    const s = facing('corrupted-ground', { pending: { id: 'corrupted-ground', day: 1, hour: 12, ring: 3, action: 'scout', state: 'calm', margin: 0 } });
    const after = chooseOption(s, 'go-around');
    expect(after.hoursToday).toBe(s.hoursToday + 1);
    expect(after.vitals.condition).toBe(s.vitals.condition);
    expect(oddsWord(chanceOf(s, option('corrupted-ground', 'go-around')))).toBe('safe');
  });

  it('takes the snares, or resets them for food by morning', () => {
    const took = chooseOption(facing('old-snare-line'), 'take');
    expect(took.tools.at(-1)).toEqual({ item: 'trap-snare', grade: 'crude' });
    const s = facing('old-snare-line');
    const reset = chooseOption(s, 'reset');
    expect(reset.skills.hunting ?? 0).toBeGreaterThan(s.skills.hunting ?? 0);
    expect(reset.stores.rawFood).toBe(s.stores.rawFood);
    const morning = endDay(reset);
    expect(morning.log.some(l => /old snare line you reset caught two hares/.test(l.text))).toBe(true);
    expect(morning.overnight).toBeUndefined();
    // Only once: the next night brings nothing from it.
    expect(endDay(morning).log.filter(l => /old snare line you reset/.test(l.text))).toHaveLength(1);
  });

  it('puts each find where and when it belongs', () => {
    const met = (season: 'autumn' | 'winter', ring: 1 | 2 | 3) => {
      const seen = new Set<string>();
      for (let d = 1; d <= 600; d++) for (const h of [8, 12, 16]) { const t = encounterFor(seedOf('w-finds-where'), d, h, ring, season, false); if (t) seen.add(t.id); }
      return seen;
    };
    expect(met('winter', 2)).toContain('buried-pack');
    expect(met('autumn', 2)).not.toContain('buried-pack');
    expect(met('autumn', 3)).toContain('corrupted-ground');
    expect(met('autumn', 1)).not.toContain('corrupted-ground');
    expect(met('autumn', 1)).toContain('old-snare-line');
  });
});
