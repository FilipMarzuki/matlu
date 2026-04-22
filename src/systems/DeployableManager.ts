/**
 * DeployableManager — tick-based lifecycle manager for Deployable instances.
 *
 * One manager per CombatArenaScene. The scene should:
 *   1. Construct a manager in `create()`.
 *   2. Call `manager.add(deployable)` whenever the hero places something.
 *   3. Call `manager.update(delta)` in the scene's `update()` method.
 *   4. Call `manager.destroyAll()` in the scene's `shutdown` event handler.
 *
 * No call sites yet — wired in by CombatEngineer Children B/C.
 */

import { Deployable } from '../entities/Deployable';

export class DeployableManager {
  private readonly active: Set<Deployable> = new Set();

  /**
   * Register a deployable to be ticked each frame.
   * The manager takes ownership — do NOT call `destroy()` manually after adding.
   */
  add(d: Deployable): void {
    this.active.add(d);
  }

  /**
   * Tick all active deployables. Any that return `false` from `tick()` are
   * immediately cleaned up and removed.
   *
   * Call this from the scene's `update(time, delta)` on every frame.
   *
   * @param delta - Time elapsed since the last frame in milliseconds (Phaser's `delta` arg).
   */
  update(delta: number): void {
    for (const d of this.active) {
      const alive = d.tick(delta);
      if (!alive) {
        d.cleanup();
        this.active.delete(d);
      }
    }
  }

  /** Current number of active deployables — useful for HUD display and spawn caps. */
  get count(): number {
    return this.active.size;
  }

  /**
   * Tear down all active deployables.
   * Call this in the scene's shutdown handler to prevent dangling game objects
   * after the scene is stopped.
   */
  getActive(): readonly Deployable[] {
    return Array.from(this.active);
  }

  /**
   * Tear down all active deployables.
   * Call this in the scene's shutdown handler to prevent dangling game objects
   * after the scene is stopped.
   */
  destroyAll(): void {
    for (const d of this.active) d.cleanup();
    this.active.clear();
  }
}
