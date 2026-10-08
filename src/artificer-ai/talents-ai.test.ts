/**
 * AI parity for talents (#1267): AI players play exactly like people — a
 * character id, a seeded offer of 4 to pick 2 from, and a hidden talent.
 */

import { describe, it, expect } from 'vitest';
import { playRun } from './runner';
import { scriptedPlayer } from './players/scripted';
import { observe } from './observe';
import { TALENTS, talentOffer, seedOf, chooseFromOffer, pickRandomFromOffer, hiddenTalent } from '../artificer/talents';
import { legacyOf } from '../artificer/legacy';

describe('AI talent parity (#1267)', () => {
  // An AI run is a real Warden: an id, two talents from its offer, one hidden.
  it('gives every AI run an id, an offer and a hidden talent', async () => {
    const r = await playRun(scriptedPlayer(), { characterId: 'ai-test-1' });
    const c = r.final.character;
    expect(c.id).toBe('ai-test-1');
    const offer = talentOffer(seedOf('ai-test-1'));
    const known = c.talents.filter(t => t.known).map(t => t.id);
    expect(known).toEqual(offer.slice(0, 2));
    const hidden = c.talents.filter(t => !t.known);
    expect(hidden).toHaveLength(1);
    expect(hidden[0].id).toBe(hiddenTalent(seedOf('ai-test-1'), known));
    // With no id given, the runner still makes one — never an id-less Warden.
    const anon = await playRun(scriptedPlayer());
    expect(anon.final.character.id).not.toBe('');
    expect(anon.final.character.talents).toHaveLength(3);
  });

  // Requested talents only count if they were offered.
  it('picks requested talents only from the offer', async () => {
    const offer = talentOffer(seedOf('ai-test-2'));
    expect(chooseFromOffer(offer, [offer[3], offer[1]])).toEqual([offer[3], offer[1]]);
    const outside = Object.keys(TALENTS).find(id => !offer.includes(id as never)) as never;
    expect(chooseFromOffer(offer, [offer[0], outside])).toEqual(offer.slice(0, 2));
    expect(chooseFromOffer(offer, [])).toEqual(offer.slice(0, 2));
    const r = await playRun(scriptedPlayer(), { characterId: 'ai-test-2', talents: [offer[2], offer[3]] });
    // The chosen ones (a hidden talent may have been discovered along the way, #1265 — it carries signs).
    expect(r.final.character.talents.filter(t => t.known && t.signs === undefined).map(t => t.id)).toEqual([offer[2], offer[3]]);
  });

  // The random baseline picks a random pair from its offer — seeded, so it repeats.
  it('lets the random baseline pick a seeded random pair from its offer', () => {
    const offer = talentOffer(seedOf('ai-random-1'));
    const a = pickRandomFromOffer(offer, 7);
    expect(a).toEqual(pickRandomFromOffer(offer, 7));
    expect(new Set(a).size).toBe(2);
    expect(a.every(id => offer.includes(id))).toBe(true);
    const picks = new Set(Array.from({ length: 12 }, (_, i) => pickRandomFromOffer(offer, i).join()));
    expect(picks.size).toBeGreaterThan(1);
  });

  // The AI sees what a person sees: known talents, and that something is hidden — never which.
  it('never shows the AI its hidden talent', async () => {
    const r = await playRun(scriptedPlayer(), { characterId: 'ai-test-3' });
    const hidden = r.final.character.talents.find(t => !t.known)!;
    const text = observe(r.final);
    expect(text).toMatch(/1 hidden talent, not yet discovered/);
    expect(text).not.toContain(TALENTS[hidden.id].name);
  });

  // Carrying on (--carry) continues the same character, talents and all.
  it('continues the same character when a run carries on', async () => {
    const first = await playRun(scriptedPlayer(), { characterId: 'ai-test-4' });
    const next = await playRun(scriptedPlayer(), { characterId: 'ai-test-4', legacy: legacyOf(first.final) });
    expect(next.final.character.id).toBe('ai-test-4');
    expect(next.final.character.talents.map(t => t.id)).toEqual(first.final.character.talents.map(t => t.id));
  });
});
