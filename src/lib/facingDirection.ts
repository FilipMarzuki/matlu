export type MirroredFacing = 'south' | 'south-east' | 'east' | 'north-east' | 'north';
export type WestAnimationFacing = MirroredFacing | 'west';

export interface FacingResult<TDirection extends string> {
  dir: TDirection;
  flip: boolean;
}

const MIRRORED_DIR_BY_SECTOR: Record<number, FacingResult<MirroredFacing>> = {
  0: { dir: 'east', flip: false },
  1: { dir: 'south-east', flip: false },
  2: { dir: 'south', flip: false },
  3: { dir: 'south-east', flip: true },
  4: { dir: 'east', flip: true },
  '-4': { dir: 'east', flip: true },
  '-3': { dir: 'north-east', flip: true },
  '-2': { dir: 'north', flip: false },
  '-1': { dir: 'north-east', flip: false },
};

const WEST_ANIMATION_DIR_BY_SECTOR: Record<number, FacingResult<WestAnimationFacing>> = {
  0: { dir: 'east', flip: false },
  1: { dir: 'south-east', flip: false },
  2: { dir: 'south', flip: false },
  3: { dir: 'south-east', flip: true },
  4: { dir: 'west', flip: false },
  '-4': { dir: 'west', flip: false },
  '-3': { dir: 'north-east', flip: true },
  '-2': { dir: 'north', flip: false },
  '-1': { dir: 'north-east', flip: false },
};

function velocitySector(vx: number, vy: number): number | null {
  if (vx === 0 && vy === 0) return null;
  return Math.round(Math.atan2(vy, vx) / (Math.PI / 4));
}

function isoProjectedVelocity(vx: number, vy: number): { x: number; y: number } {
  return {
    x: vx - vy,
    y: (vx + vy) / 2,
  };
}

export function resolveMirroredFacingFromVelocity(
  vx: number,
  vy: number,
): FacingResult<MirroredFacing> | null {
  const sector = velocitySector(vx, vy);
  if (sector === null) return null;
  return MIRRORED_DIR_BY_SECTOR[sector] ?? { dir: 'south', flip: false };
}

export function resolveWestAnimationFacingFromVelocity(
  vx: number,
  vy: number,
): FacingResult<WestAnimationFacing> | null {
  const sector = velocitySector(vx, vy);
  if (sector === null) return null;
  return WEST_ANIMATION_DIR_BY_SECTOR[sector] ?? { dir: 'south', flip: false };
}

export function resolveWestAnimationFacingFromIsoVelocity(
  vx: number,
  vy: number,
): FacingResult<WestAnimationFacing> | null {
  const projected = isoProjectedVelocity(vx, vy);
  return resolveWestAnimationFacingFromVelocity(projected.x, projected.y);
}
