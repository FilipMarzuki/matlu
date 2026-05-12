import { FbmNoise } from './noise';

export interface MagicNode {
  id: string;
  /** World-space X position in pixels. */
  wx: number;
  /** World-space Y position in pixels. */
  wy: number;
  /** Positive values source magic; negative values drain it. */
  strength: number;
  /** Gaussian influence radius in world pixels. */
  radius: number;
}

export interface MagicSample {
  /** Local magic density, clamped to [0, 1]. */
  density: number;
  /** Normalised flow vector X component. */
  dx: number;
  /** Normalised flow vector Y component. */
  dy: number;
}

const MAGIC_FIELD_SEED = 0xb1a5e1d;
const AMBIENT_FREQ = 0.00025;
const DRIFT_X_PER_SECOND = 0.002;
const DRIFT_Y_PER_SECOND = 0.0013;
const GRADIENT_STEP_PX = 64;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampNodeInfluence(value: number): number {
  return Math.max(-0.5, Math.min(0.5, value));
}

/**
 * Ambient magic-current field sampled in world space.
 *
 * The fixed noise seed keeps the broad ley-current shape stable across reloads
 * while `update()` slowly drifts the sample coordinates so the field breathes.
 */
export class MagicField {
  private readonly noise = new FbmNoise(MAGIC_FIELD_SEED);
  private timeSeconds = 0;
  private nodes: MagicNode[] = [];
  private nextId = 0;

  /** Advance the ambient drift. Call from GameScene.update() every frame. */
  update(delta: number): void {
    this.timeSeconds += delta * 0.001;
  }

  addNode(node: Omit<MagicNode, 'id'>): string {
    const id = String(this.nextId++);
    this.nodes.push({ ...node, id });
    return id;
  }

  removeNode(id: string): void {
    this.nodes = this.nodes.filter((node) => node.id !== id);
  }

  /** All current nodes — used by later overlay work to draw ley lines. */
  getNodes(): readonly MagicNode[] {
    return this.nodes;
  }

  /** Current field time in seconds — useful for overlay animation phase. */
  getTime(): number {
    return this.timeSeconds;
  }

  /** Full sample: scalar density plus flow direction down the density gradient. */
  sample(wx: number, wy: number): MagicSample {
    const density = this.sampleDensity(wx, wy);
    const ddx = this.sampleDensity(wx + GRADIENT_STEP_PX, wy)
      - this.sampleDensity(wx - GRADIENT_STEP_PX, wy);
    const ddy = this.sampleDensity(wx, wy + GRADIENT_STEP_PX)
      - this.sampleDensity(wx, wy - GRADIENT_STEP_PX);
    const length = Math.sqrt(ddx * ddx + ddy * ddy) || 1;

    return {
      density,
      dx: -ddx / length,
      dy: -ddy / length,
    };
  }

  /** Cheap scalar path for gameplay hooks that only need local magic strength. */
  sampleDensity(wx: number, wy: number): number {
    const ambient = this.ambient(wx, wy);
    const nodes = this.nodeInfluence(wx, wy);

    return clamp01(ambient * 0.6 + nodes * 0.4 + 0.5);
  }

  private ambient(wx: number, wy: number): number {
    const raw = this.noise.fbm(
      wx * AMBIENT_FREQ + this.timeSeconds * DRIFT_X_PER_SECOND,
      wy * AMBIENT_FREQ + this.timeSeconds * DRIFT_Y_PER_SECOND,
      3,
      0.5,
    );

    return (raw - 0.5) * 1.4;
  }

  private nodeInfluence(wx: number, wy: number): number {
    let sum = 0;

    for (const node of this.nodes) {
      const dx = wx - node.wx;
      const dy = wy - node.wy;
      const distanceSquared = dx * dx + dy * dy;
      sum += node.strength * Math.exp(
        -distanceSquared / (2 * node.radius * node.radius),
      );
    }

    return clampNodeInfluence(sum);
  }
}
