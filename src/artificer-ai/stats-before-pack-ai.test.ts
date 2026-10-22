/**
 * Who you are, then what you pack (#1872, acceptance 4): the AI's packing turn comes after its
 * Warden is made, so it sees their stats and the list ticked for them, and its pack is checked
 * against what that Warden can carry. Off, the turn reads as before.
 */

import { describe, it, expect } from 'vitest';
import { ruleFeatures } from '../artificer/features';
import { createRegion1 } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { DEFAULT_STATS, type Stats } from '../artificer/stats';
import { SUGGESTED_PACK, suggestedPack, suggestedPackOf, packWorldOf, validPack, packWeight, type KitId } from '../artificer/kit';
import { grownStats, DEFAULT_AGE } from '../artificer/growing';
import { chooseFromOffer, talentOffer, seedOf } from '../artificer/talents';
import { SHORT_YEAR } from '../artificer/test-helpers';
import { observePack } from './observe';
import { parsePackDecision } from './decision';
import { playRun, type Player } from './runner';
import { scriptedPlayer } from './players/scripted';
import { randomPack, rng } from './players/random';

// The weight-only rules: `pack-volume` (#1871) off, where the carry weight is the pack's limit.
const ON = ruleFeatures({ 'pack-volume': false });
/** Chosen at creation; at 12 (growing.ts) that's STR 9, INT 10 now, and the carry weight reads STR now: 12 kg. */
const STRONG: Stats = { ...DEFAULT_STATS, str: 13, int: 12, cha: 9 };
const STRONG_NOW = grownStats(STRONG, DEFAULT_AGE);
const HEAVY: KitId[] = [...SUGGESTED_PACK, 'tarp', 'trangia', 'spare-socks', 'thermos'];

/** A player that packs with these replies, in turn, and ends every day at once. */
function packer(...replies: string[]): Player & { asked: string[] } {
  const asked: string[] = [];
  return {
    name: 'packer', asked,
    async decide() { return { text: JSON.stringify({ thoughts: '', site: null, queue: [] }) }; },
    async decidePack(message) { asked.push(message); return { text: replies.shift() ?? '' }; },
  };
}

describe('the AI packs as the Warden it is (#1872, acceptance 4)', () => {
  it('sees the stats, the carry weight and the list ticked for it', () => {
    const s = createRegion1({ world: { ...FULL_WORLD, features: ON } }, undefined, { id: 'ai-1872', stats: STRONG, age: DEFAULT_AGE, chosen: ['hunter'], pack: suggestedPack(ON, STRONG_NOW, ['hunter']) });
    const msg = observePack(s);
    // The stats now (the young body's), since that's what carries the pack.
    expect(msg).toMatch(/YOU: STR 9 · CON 7 · AGI 9 · INT 10 · WIL 8 · CHA 8/);
    expect(msg).toMatch(/TALENTS: Hunter's Patience/);
    expect(msg).toMatch(/Your pack holds 12 kg: what you carry comfortably with Strength 9/);
    const ticked = suggestedPackOf(s);
    expect(ticked).toEqual(expect.arrayContaining(['hand-axe', 'tarp', 'trangia', 'notebook', 'fishing-kit']));
    expect(msg).toContain(`THE LIST TICKED FOR YOU (`);
    expect(msg).toContain(ticked.join(', '));
    // The hidden talent never shows.
    expect(s.character.talents.some(x => !x.known)).toBe(true);
    const hidden = s.character.talents.find(x => !x.known)!.id;
    if (hidden !== 'hunter') expect(msg.split('TALENTS:')[1].split('\n')[0]).not.toMatch(new RegExp(hidden, 'i'));
  });

  it('its reply is checked against what this Warden can carry', () => {
    const strong = createRegion1({ world: { ...FULL_WORLD, features: ON } }, undefined, { id: 'ai-1872-c', stats: STRONG, age: DEFAULT_AGE, pack: [...SUGGESTED_PACK] });
    const average = createRegion1({ world: { ...FULL_WORLD, features: ON } }, undefined, { id: 'ai-1872-d', age: DEFAULT_AGE, pack: [...SUGGESTED_PACK] });
    const reply = JSON.stringify({ thoughts: 'the patrol gear', pack: HEAVY });
    expect(parsePackDecision(reply, packWorldOf(strong)).ok).toBe(true);
    expect(parsePackDecision(reply, packWorldOf(average))).toMatchObject({ ok: false, errors: [expect.stringMatching(/too heavy: 9.12 kg, and the pack holds 9/)] });
  });

  it('a whole run: the packing turn sees the stats first, and a heavier pack goes in', async () => {
    const p = packer(JSON.stringify({ thoughts: 'heavy', pack: HEAVY }));
    const r = await playRun(p, { characterId: 'ai-1872-run', features: ON, stats: STRONG, calendar: SHORT_YEAR });
    expect(p.asked[0]).toMatch(/YOU: STR 9 /);
    expect(r.packed).toEqual({ pack: HEAVY, thoughts: 'heavy' });
  });

  it('the scripted player takes the list ticked for it; the random one fits its own limit', async () => {
    const r = await playRun(scriptedPlayer(), { characterId: 'ai-1872-scripted', features: ON, stats: STRONG, calendar: SHORT_YEAR });
    // The talents the runner picks for this id: the same two from the seeded offer.
    const chosen = chooseFromOffer(talentOffer(seedOf('ai-1872-scripted')), []);
    expect(r.packed?.pack).toEqual(suggestedPack(ON, STRONG_NOW, chosen));
    expect(r.packed?.pack).toContain('hand-axe');
    for (let seed = 1; seed <= 20; seed++) {
      const big = randomPack(rng(seed), ON, 12);
      expect(validPack(big, { features: ON, limit: 12 })).toBe(true);
      expect(packWeight(randomPack(rng(seed), ON, 9))).toBeLessThanOrEqual(9);
    }
  });

  it('off, the turn reads as it did', () => {
    const s = createRegion1({ world: { ...FULL_WORLD, features: ruleFeatures({ 'stats-before-pack': false, 'pack-volume': false }) } }, undefined, { id: 'ai-1872-off', stats: STRONG, pack: [...SUGGESTED_PACK] });
    const msg = observePack(s);
    expect(msg).toContain('Your pack holds 9 kg.');
    expect(msg).toContain("THE LEADER'S PACKING LIST");
    expect(msg).not.toMatch(/YOU: STR|TICKED FOR YOU/);
  });
});
