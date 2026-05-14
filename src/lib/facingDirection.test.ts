import { describe, expect, it } from 'vitest';
import {
  resolveMirroredFacingFromVelocity,
  resolveWestAnimationFacingFromIsoVelocity,
  resolveWestAnimationFacingFromVelocity,
} from './facingDirection';

describe('facing direction helpers', () => {
  it('snaps cartesian velocity into mirrored 8-way facing sectors', (): void => {
    expect(resolveMirroredFacingFromVelocity(1, 0)).toEqual({ dir: 'east', flip: false });
    expect(resolveMirroredFacingFromVelocity(1, 1)).toEqual({ dir: 'south-east', flip: false });
    expect(resolveMirroredFacingFromVelocity(0, 1)).toEqual({ dir: 'south', flip: false });
    expect(resolveMirroredFacingFromVelocity(-1, 1)).toEqual({ dir: 'south-east', flip: true });
    expect(resolveMirroredFacingFromVelocity(-1, 0)).toEqual({ dir: 'east', flip: true });
    expect(resolveMirroredFacingFromVelocity(-1, -1)).toEqual({ dir: 'north-east', flip: true });
    expect(resolveMirroredFacingFromVelocity(0, -1)).toEqual({ dir: 'north', flip: false });
    expect(resolveMirroredFacingFromVelocity(1, -1)).toEqual({ dir: 'north-east', flip: false });
  });

  it('uses real west animations when the spritesheet provides them', (): void => {
    expect(resolveWestAnimationFacingFromVelocity(-1, 0)).toEqual({ dir: 'west', flip: false });
    expect(resolveWestAnimationFacingFromVelocity(-1, 1)).toEqual({ dir: 'south-east', flip: true });
    expect(resolveWestAnimationFacingFromVelocity(-1, -1)).toEqual({ dir: 'north-east', flip: true });
  });

  it('snaps Homestead world movement by its isometric screen projection', (): void => {
    const diagonal = Math.SQRT1_2;

    expect(resolveWestAnimationFacingFromIsoVelocity(-diagonal, -diagonal)).toEqual({
      dir: 'north',
      flip: false,
    });
    expect(resolveWestAnimationFacingFromIsoVelocity(diagonal, -diagonal)).toEqual({
      dir: 'east',
      flip: false,
    });
    expect(resolveWestAnimationFacingFromIsoVelocity(diagonal, diagonal)).toEqual({
      dir: 'south',
      flip: false,
    });
    expect(resolveWestAnimationFacingFromIsoVelocity(-diagonal, diagonal)).toEqual({
      dir: 'west',
      flip: false,
    });
  });

  it('returns null for a stopped actor so callers can preserve idle facing', (): void => {
    expect(resolveMirroredFacingFromVelocity(0, 0)).toBeNull();
    expect(resolveWestAnimationFacingFromIsoVelocity(0, 0)).toBeNull();
  });
});
