/**
 * ArenaBlackboard — lightweight shared state for arena-level AI coordination.
 *
 * Enemies read from (and write to) this object to coordinate without talking
 * to each other directly. No entity holds a reference to another enemy —
 * they only read the shared counters/cooldowns here.
 *
 * Currently tracks:
 *   flyerDiveCooldown — prevents multiple ParasiteFlyers diving simultaneously.
 *     When one flyer dives it sets this to DIVE_STAGGER_MS; others wait until
 *     it ticks back to 0 before starting their own dive.
 */
export class ArenaBlackboard {
  /** ms until the next ParasiteFlyer may begin a dive. */
  flyerDiveCooldown = 0;

  /** Called once per frame by the arena scene. Decrements all timers. */
  tick(delta: number): void {
    this.flyerDiveCooldown = Math.max(0, this.flyerDiveCooldown - delta);
  }
}
