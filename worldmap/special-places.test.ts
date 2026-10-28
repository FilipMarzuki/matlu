import { describe, it, expect } from 'vitest';
import { SPECIAL_PLACES, BLEND_TILES, specialPlaceAt, blendBandAt, blendsToPlace } from './special-places';

const level1 = SPECIAL_PLACES[0];

describe('worldmap/special-places (#1909)', () => {
  it('given Level1\'s rectangle, specialPlaceAt finds it at the origin, the far corner, and nowhere outside', () => {
    expect(specialPlaceAt(level1.at.tx, level1.at.ty)?.id).toBe('level1');
    expect(specialPlaceAt(level1.at.tx + level1.w - 1, level1.at.ty + level1.h - 1)?.id).toBe('level1');
    expect(specialPlaceAt(level1.at.tx + level1.w, level1.at.ty)).toBeNull();
    expect(specialPlaceAt(level1.at.tx - 1, level1.at.ty)).toBeNull();
    expect(specialPlaceAt(level1.at.tx, level1.at.ty - 1)).toBeNull();
  });

  it('given a tile far from every place, blendBandAt and specialPlaceAt both return null', () => {
    expect(specialPlaceAt(0, 0)).toBeNull();
    expect(blendBandAt(0, 0)).toBeNull();
  });

  it('given a tile one step outside Level1\'s east edge, blendBandAt reports dist 1 and the nearest in-place edge tile', () => {
    const band = blendBandAt(level1.at.tx + level1.w, level1.at.ty + 10);
    expect(band?.place.id).toBe('level1');
    expect(band?.dist).toBe(1);
    expect(band?.edge).toEqual({ tx: level1.w - 1, ty: 10 });
  });

  it('given a tile at the corner beyond Level1\'s rectangle, dist is the Chebyshev distance to the corner, and the edge clamps to the corner tile', () => {
    const band = blendBandAt(level1.at.tx + level1.w + 3, level1.at.ty + level1.h + 5);
    expect(band?.dist).toBe(6);
    expect(band?.edge).toEqual({ tx: level1.w - 1, ty: level1.h - 1 });
  });

  it('given a tile exactly BLEND_TILES out, blendBandAt still returns a band; one further out returns null', () => {
    const justIn = blendBandAt(level1.at.tx - BLEND_TILES, level1.at.ty);
    expect(justIn?.dist).toBe(BLEND_TILES);
    const justOut = blendBandAt(level1.at.tx - BLEND_TILES - 1, level1.at.ty);
    expect(justOut).toBeNull();
  });

  it('given dist 1, blendsToPlace is true for at least half of a 1,000-tile band row (nearly every hash clears a bar of 1)', () => {
    let trueCount = 0;
    for (let tx = 0; tx < 1000; tx++) if (blendsToPlace(tx, 0, 1)) trueCount++;
    expect(trueCount).toBeGreaterThan(400);
  });

  it('given dist BLEND_TILES, blendsToPlace is always false (hash % BLEND_TILES can never reach BLEND_TILES)', () => {
    for (let tx = 0; tx < 200; tx++) expect(blendsToPlace(tx, tx * 7, BLEND_TILES)).toBe(false);
  });

  it('given the same (tx, ty, dist), blendsToPlace is deterministic across calls', () => {
    expect(blendsToPlace(12345, -6789, 4)).toBe(blendsToPlace(12345, -6789, 4));
  });

  it('given today\'s one entry, SPECIAL_PLACES holds only Level1 at 141 × 94 tiles', () => {
    expect(SPECIAL_PLACES).toHaveLength(1);
    expect(level1).toEqual({ id: 'level1', at: { tx: 20 * 2048, ty: 21 * 2048 }, w: 141, h: 94, source: 'level1' });
  });
});
