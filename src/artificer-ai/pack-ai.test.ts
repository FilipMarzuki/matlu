/**
 * Tests for #1401 — packing for the hike: repacking on the first morning, the AI's packing turn
 * (shown the list, its reply checked, a bad reply explained once), and the intro's packing beat.
 * The screen itself is checked by screenshot.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, repack, runAction } from '../artificer/region1';
import { SUGGESTED_PACK, KIT, PACK_CAPACITY, PACK_LITRES, PACK_VOLUME, STRAP_PLACES, PACK_FEEL_LINE, validPack, packWeight, autoOutside, type KitId } from '../artificer/kit';
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
    // Today's rules: a 9 kg pack, the pack's volume (#1871) off.
    const msg = observePack(newGame(undefined, { [PACK_VOLUME]: false }).sim);
    expect(msg).toMatch(/^PACKING — Friday afternoon/);
    for (const k of KIT) expect(msg).toContain(`- ${k.id} (${k.weight} kg): ${k.name} — ${k.does}`);
    expect(msg).toContain(`Your pack holds ${PACK_CAPACITY} kg`);
    expect(msg).toMatch(/"pack": \["<item id>", \.\.\.\]/);
    expect(parsePackDecision('{"thoughts":"light","pack":["tarp","kasa"]}')).toEqual({ ok: true, decision: { thoughts: 'light', pack: ['tarp', 'kasa'] } });
    expect(parsePackDecision('{"pack":["chainsaw"]}')).toMatchObject({ ok: false, errors: ['your pack won\'t do: there\'s no "chainsaw" on the list'] });
    expect(parsePackDecision('{"pack":"tarp"}')).toMatchObject({ ok: false, errors: ['"pack" must be a list of item ids'] });
    expect(parsePackDecision('not json')).toMatchObject({ ok: false });
  });

  it('with the pack\'s volume on (#1871), shows the litres, the straps and the soft weight, and checks the reply by them', () => {
    const s = newGame().sim;
    const msg = observePack(s);
    for (const k of KIT) expect(msg).toContain(`- ${k.id} (${k.weight} kg, ${k.litres} L${k.outside ? ', can strap outside' : ''}): ${k.name} — ${k.does}`);
    expect(msg).toContain(`Your pack holds ${PACK_LITRES} L inside`);
    expect(msg).toContain(`${STRAP_PLACES} strap places`);
    expect(msg).toMatch(/Weight is not a limit: about [\d.]+ kg is comfortable for you/);
    // The Warden's words for what's packed now, as the screen says them.
    expect(Object.values(PACK_FEEL_LINE).some(l => msg.includes(`"${l}"`))).toBe(true);
    expect(msg).toMatch(/"outside": \["<item id strapped on>", \.\.\.\]/);
    const rules = { volume: true };
    // Heavy is fine; too much inside won't close; a strap for a thing that can't be strapped is refused.
    const heavy = [...SUGGESTED_PACK, 'dumbbells', 'smooth-stones', 'garden-gnome'];
    expect(parsePackDecision(JSON.stringify({ thoughts: '', pack: heavy }), rules)).toMatchObject({ ok: true });
    expect(parsePackDecision(JSON.stringify({ thoughts: '', pack: heavy }))).toMatchObject({ ok: false, errors: [expect.stringMatching(/too heavy/)] });
    expect(parsePackDecision(JSON.stringify({ pack: [...SUGGESTED_PACK, 'home-pillow', 'accordion'], outside: [] }), rules)).toMatchObject({ ok: false, errors: [expect.stringMatching(/won't close/)] });
    expect(parsePackDecision(JSON.stringify({ pack: ['accordion'], outside: ['accordion'] }), rules)).toMatchObject({ ok: false, errors: [expect.stringMatching(/can't be strapped/)] });
    expect(parsePackDecision(JSON.stringify({ thoughts: 'x', pack: ['tarp', 'kasa'], outside: ['tarp'] }), rules)).toEqual({ ok: true, decision: { thoughts: 'x', pack: ['tarp', 'kasa'], outside: ['tarp'] } });
    // In the run, what's strapped on is kept (the API's view and the AI's PACK line read the same kit).
    const r = repack(s, ['tarp', 'kasa'], ['tarp']);
    expect(r.kit?.outside).toEqual(['tarp']);
    // The random baseline still packs within 9 kg, and its packs close.
    for (let seed = 1; seed <= 50; seed++) {
      const p = randomPack(rng(seed), true);
      expect(validPack(p, { volume: true, outside: autoOutside(p) })).toBe(true);
      expect(packWeight(p)).toBeLessThanOrEqual(PACK_CAPACITY);
    }
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

  it('packs in the intro before creation, and each Warden packs afresh', () => {
    const fresh = introBeats(createRegion1());
    const at = fresh.findIndex(b => b.kind === 'pack');
    // Packing for the hike comes first now, before the portal and creation (#1666).
    expect(at).toBeLessThan(fresh.findIndex(b => b.kind === 'create'));
    expect(fresh[at].lines.join(' ')).toMatch(/What will you pack\?/);
    // The knowledge legacy remembers the pack; but the game's next run is a new Warden (#1455), who packs the suggested kit again.
    const g = newGame().sim;
    const light = repack(g, ['tarp', 'kasa']);
    const done = { ...light, outcome: { choice: 'thaw' as const, kind: 'survived' as const, grade: 'hale' as const, vitals: createVitals() } };
    expect(legacyOf(done).pack).toEqual(['tarp', 'kasa']);
    expect(newRun(done).sim.kit?.items).toEqual([...SUGGESTED_PACK]);
  });
});
