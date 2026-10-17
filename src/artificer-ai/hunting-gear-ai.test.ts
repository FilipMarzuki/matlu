/**
 * The scripted baseline with `hunting-gear` (#1821): traps and a sling bring small game, small game
 * brings sinew, and the sinew (with the Hunting it practised) makes the bow. It still reaches the
 * bow, and survives the winter as it does with the switch off.
 */

import { describe, it, expect } from 'vitest';
import { playRun } from './runner';
import { scriptedPlayer } from './players/scripted';
import { BOW_SINEW } from '../artificer/hunting-gear';

describe('the scripted baseline with hunting gear (#1821)', () => {
  it('gets sinew from small game, makes a bow with it, and survives the winter', async () => {
    const r = await playRun(scriptedPlayer(), { characterId: 'p-1', features: { 'hunting-gear': true, 'action-visibility': true } });
    const f = r.final;
    expect(f.outcome?.kind).toBe('survived');
    // The sinew came before the bow did: the bow's day is after enough catches to string it.
    const bow = f.log.find(e => /^Crafted an? \w+ bow/.test(e.text));
    expect(bow).toBeDefined();
    const kept = f.log.filter(e => e.day <= bow!.day).reduce((n, e) => n + Number(e.text.match(/Kept (\d+) sinew/)?.[1] ?? 0), 0);
    expect(kept).toBeGreaterThanOrEqual(BOW_SINEW);
    expect(f.tools.some(t => t.item === 'bow')).toBe(true);
  }, 120000);
});
