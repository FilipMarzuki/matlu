/**
 * IsoDepth — unit tests for updateIsoDepths.
 *
 * Uses a minimal fake sprite (duck-typed to satisfy IsoSprite) so no Phaser
 * import is needed — these tests run in plain Node via vitest.
 */

import { describe, it, expect } from 'vitest';
import { updateIsoDepths } from './IsoDepth';
import { isoDepth, WORLD_TILE_SIZE } from '../lib/IsoTransform';

// ── Fake sprite ───────────────────────────────────────────────────────────────

/** Minimal stand-in for a sprite with world-coord data and a trackable depth. */
function makeSprite(data: Record<string, number>) {
  const store = new Map(Object.entries(data));
  let depth = 0;
  return {
    getData: (key: string): number | undefined => store.get(key),
    setDepth: (v: number) => { depth = v; },
    /** Read the depth that was last written by setDepth. */
    get depth() { return depth; },
  };
}

// ── updateIsoDepths ───────────────────────────────────────────────────────────

describe('updateIsoDepths', () => {
  it('sets depth to isoDepth(wx, wy) when wz is absent', () => {
    // Acceptance criteria: { wx: 10, wy: 20 } → depth === isoDepth(10, 20, 0)
    // isoDepth(10, 20, 0) = isoDepth(10, 20) because wz=0 adds nothing.
    const sprite = makeSprite({ wx: 10, wy: 20 });
    updateIsoDepths([sprite]);
    expect(sprite.depth).toBe(isoDepth(10, 20));
  });

  it('adds wz / WORLD_TILE_SIZE when wz is non-zero', () => {
    const sprite = makeSprite({ wx: 10, wy: 20, wz: 16 });
    updateIsoDepths([sprite]);
    expect(sprite.depth).toBe(isoDepth(10, 20) + 16 / WORLD_TILE_SIZE);
  });

  it('defaults wx, wy, wz to 0 when keys are absent from data', () => {
    const sprite = makeSprite({});
    updateIsoDepths([sprite]);
    expect(sprite.depth).toBe(isoDepth(0, 0));
  });

  it('updates every sprite in the iterable', () => {
    const a = makeSprite({ wx: 10, wy: 20 });
    const b = makeSprite({ wx: 30, wy: 40 });
    updateIsoDepths([a, b]);
    expect(a.depth).toBe(isoDepth(10, 20));
    expect(b.depth).toBe(isoDepth(30, 40));
  });

  it('accepts any Iterable — including a Set', () => {
    const sprite = makeSprite({ wx: 5, wy: 5 });
    updateIsoDepths(new Set([sprite]));
    expect(sprite.depth).toBe(isoDepth(5, 5));
  });

  it('does nothing when the iterable is empty', () => {
    // No assertion needed — just must not throw.
    expect(() => updateIsoDepths([])).not.toThrow();
  });
});
