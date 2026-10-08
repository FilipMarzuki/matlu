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
import { randomPlayer } from './players/random';
import { giftSummaryOf, type Transcript } from './report';
import { MIN_TIER, MAX_TIER } from '../artificer/talents';

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

  // 3. A finished run records its talents, their true tiers, and when the hidden one came to light.
  it('records the talents, true tiers and the reveal day', async () => {
    // A Warden whose hidden talent shows itself during the season (Surge, scripted) — and one whose doesn't.
    const found = await playRun(scriptedPlayer(), { characterId: 'pace-3' });
    const never = await playRun(scriptedPlayer(), { characterId: 'pace-0' });
    const g = found.gifts!;
    expect(g.talents).toHaveLength(3);
    expect(g.talents.filter(t => t.chosen).map(t => t.id)).toEqual(talentOffer(seedOf('pace-3')).slice(0, 2));
    const hidden = g.talents.find(t => !t.chosen)!;
    expect(hidden.revealedDay).toBeGreaterThan(0);
    expect(hidden.signs).toBeGreaterThanOrEqual(6);
    // The true tier, as the sim has it.
    expect(hidden.tier).toBe(found.final.character.talents.find(t => t.id === hidden.id)!.tier);
    expect(never.gifts!.talents.find(t => !t.chosen)!.revealedDay).toBeNull();
    // The quirk, and whether it showed itself.
    expect(g.quirks.length).toBeGreaterThan(0);
    // The report: picks, the hidden one found in 1 of 2 runs, on its day.
    const summary = giftSummaryOf([found, never] as unknown as Transcript[])!;
    expect(summary.runs).toBe(2);
    expect(summary.revealed).toBe(1);
    expect(summary.revealDay).toBe(hidden.revealedDay);
  });

  // 4. 50 random runs: tiers stay within 1–4, and never more than one hidden talent.
  it('keeps every talent invariant across 50 random runs', async () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = await playRun(randomPlayer({ mode: 'legal', seed }), { characterId: `rand-gift-${seed}` });
      const ts = r.final.character.talents;
      expect(ts.every(t => t.tier >= MIN_TIER && t.tier <= MAX_TIER)).toBe(true);
      expect(ts.filter(t => !t.known).length).toBeLessThanOrEqual(1);
      expect(new Set(ts.map(t => t.id)).size).toBe(ts.length);
      // A revealed talent has its six signs; a hidden one has fewer.
      for (const t of ts) if (t.signs !== undefined) expect(t.known ? t.signs >= 6 : t.signs < 6).toBe(true);
    }
  }, 60_000);
});
