/**
 * Tests for #1401 — packing for the hike: repacking on the first morning, the AI's packing turn
 * (shown the list, its reply checked, a bad reply explained once), and the intro's packing beat.
 * The screen itself is checked by screenshot.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, repack, runAction } from '../artificer/region1';
import { SUGGESTED_PACK, KIT, PACK_CAPACITY, validPack, packWeight, type KitId } from '../artificer/kit';
import { introBeats } from '../artificer-app/intro';
import { newGame, newRun } from '../artificer-app/controller';
import { legacyOf } from '../artificer/legacy';
import { createVitals } from '../artificer/vitality';
import { SHORT_YEAR } from '../artificer/test-helpers';
import { observePack } from './observe';
import { parsePackDecision } from './decision';
import { playRun, type Player } from './runner';
import { scriptedPlayer } from './players/scripted';
import { randomPack, rng } from './players/random';

/** A short year, so the run ends quickly. */
const SHORT = { calendar: SHORT_YEAR } as const;
/** A player that packs with these replies, in turn, and ends every day at once. */
function packer(...replies: string[]): Player & { asked: string[] } {
  const asked: string[] = [];
  return {
    name: 'packer', asked,
    async decide() { return { text: JSON.stringify({ thoughts: '', site: null, queue: [] }) }; },
    async decidePack(message) { asked.push(message); return { text: replies.shift() ?? '' }; },
  };
}

describe('Packing for the hike (#1401)', () => {
  it('swaps the pack on the first morning, and only then', () => {
    const s = newGame().sim;
    const light: KitId[] = ['tarp', 'trangia', 'thermos', 'sweets'];
    const r = repack(s, light);
    expect(r.kit?.items).toEqual(light);
    expect(r.character.pack).toEqual(light);
    expect(r.tools).toEqual([{ item: 'backpack', grade: 'sound' }]);
    expect(r.stores.rations).toBe(s.stores.rations - 4); // no weekend food
    expect(r.stores.materials).toBe(s.stores.materials - 2); // no cord
    expect(r.dressings).toBeUndefined();
    expect(r.kit).toMatchObject({ thermos: 2, stove: 4, sweets: 1 });
    // And back again.
    expect(repack(r, [...SUGGESTED_PACK]).stores).toEqual(s.stores);
    // Once the day has begun, or for a pack that won't do: no change.
    const begun = runAction({ ...s, vitals: createVitals() }, 'rest');
    expect(repack(begun, light)).toBe(begun);
    expect(repack(s, ['kasa', 'kasa'])).toBe(s);
  });

  it('shows the AI the whole list and checks its reply', () => {
    const msg = observePack(newGame().sim);
    expect(msg).toMatch(/^PACKING — Friday afternoon/);
    for (const k of KIT) expect(msg).toContain(`- ${k.id} (${k.weight} kg): ${k.name} — ${k.effect}`);
    expect(msg).toContain(`Your pack holds ${PACK_CAPACITY} kg`);
    expect(msg).toMatch(/"pack": \["<item id>", \.\.\.\]/);
    expect(parsePackDecision('{"thoughts":"light","pack":["tarp","kasa"]}')).toEqual({ ok: true, decision: { thoughts: 'light', pack: ['tarp', 'kasa'] } });
    expect(parsePackDecision('{"pack":["chainsaw"]}')).toMatchObject({ ok: false, errors: ['your pack won\'t do: there\'s no "chainsaw" on the list'] });
    expect(parsePackDecision('{"pack":"tarp"}')).toMatchObject({ ok: false, errors: ['"pack" must be a list of item ids'] });
    expect(parsePackDecision('not json')).toMatchObject({ ok: false });
  });

  it('lets an AI player pack before the run, explaining a bad pack once', async () => {
    const good = packer('{"thoughts":"tarp and food","pack":["tarp","weekend-food","mora-knife"]}');
    const r = await playRun(good, { characterId: 'ai-packer', ...SHORT });
    expect(good.asked).toHaveLength(1);
    expect(r.packed).toEqual({ pack: ['tarp', 'weekend-food', 'mora-knife'], thoughts: 'tarp and food' });
    expect(r.turns[0].progress).toBeDefined();
    // A pack that won't do, then a good one.
    const second = packer('{"pack":["kasa","kasa"]}', '{"thoughts":"fixed","pack":["kasa"]}');
    const r2 = await playRun(second, { characterId: 'ai-packer-2', ...SHORT });
    expect(second.asked[1]).toMatch(/^Your pack was invalid:\n- your pack won't do: kåsa is in there twice/);
    expect(r2.packed).toMatchObject({ pack: ['kasa'], errors: [expect.stringMatching(/twice/)] });
    // Two bad replies: the leader's list stays, and the run is marked.
    const r3 = await playRun(packer('nope', 'still nope'), { characterId: 'ai-packer-3', ...SHORT });
    expect(r3.packed).toMatchObject({ pack: SUGGESTED_PACK, forced: true });
    // The scripted baseline takes the leader's list; the random one a random pack that fits.
    expect((await playRun(scriptedPlayer(), { characterId: 'ai-scripted-pack', ...SHORT })).packed?.pack).toEqual(SUGGESTED_PACK);
    for (let seed = 1; seed <= 50; seed++) {
      const p = randomPack(rng(seed));
      expect(validPack(p)).toBe(true);
      expect(packWeight(p)).toBeLessThanOrEqual(PACK_CAPACITY);
    }
  }, 30_000);

  it('packs in the intro after creation, and each Warden packs afresh', () => {
    const fresh = introBeats(createRegion1());
    const at = fresh.findIndex(b => b.kind === 'pack');
    expect(at).toBeGreaterThan(fresh.findIndex(b => b.kind === 'create'));
    expect(fresh[at].lines.join(' ')).toMatch(/Friday afternoon, before any of this.*What did you pack\?/);
    // The knowledge legacy remembers the pack; but the game's next run is a new Warden (#1455), who packs the suggested kit again.
    const g = newGame().sim;
    const light = repack(g, ['tarp', 'kasa']);
    const done = { ...light, outcome: { choice: 'thaw' as const, kind: 'survived' as const, grade: 'hale' as const, vitals: createVitals() } };
    expect(legacyOf(done).pack).toEqual(['tarp', 'kasa']);
    expect(newRun(done).sim.kit?.items).toEqual([...SUGGESTED_PACK]);
  });
});
