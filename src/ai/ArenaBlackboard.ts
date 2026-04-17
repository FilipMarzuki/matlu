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
 *   packStalkerFrontAttacking — per-pack flag set by the PackStalker frontrunner
 *     each frame it is in melee range. Flankers gate their attacks on this flag.
 *     Keyed by packId so multiple simultaneous packs don't share state.
 *     Cleared each tick; the frontrunner re-sets it while in melee range.
 */
export class ArenaBlackboard {
  /** ms until the next ParasiteFlyer may begin a dive. */
  flyerDiveCooldown = 0;

  /** ms remaining while Velcrid juveniles are orbiting — adults read this before emerging. */
  velcridScoutsOrbiting = 0;

  /** ms cooldown staggering simultaneous Velcrid soldier charge sequences. */
  velcridSoldierChargeCd = 0;

  /**
   * Origin of the most recent panic event (gunshot or nearby death).
   * Enemies within panicRadius read this to trigger their own scatter.
   * Cleared after one frame so each event only fires once.
   */
  panicOrigin: { x: number; y: number } | null = null;
  panicRadius  = 0;

  /**
   * Per-pack flag indicating the PackStalker frontrunner is in melee range.
   * Keyed by packId — supports multiple packs active simultaneously.
   * Cleared each tick; the frontrunner re-writes it every frame while engaged.
   */
  packStalkerFrontAttacking = new Map<string, boolean>();

  /** Called once per frame by the arena scene. Decrements all timers. */
  tick(delta: number): void {
    this.flyerDiveCooldown      = Math.max(0, this.flyerDiveCooldown      - delta);
    this.velcridScoutsOrbiting  = Math.max(0, this.velcridScoutsOrbiting  - delta);
    this.velcridSoldierChargeCd = Math.max(0, this.velcridSoldierChargeCd - delta);
    // Clear panic origin after one frame — the arena scene re-sets it each event.
    this.panicOrigin = null;
    // Clear per-pack front-attacking flags — each frontrunner re-sets per frame while in range.
    this.packStalkerFrontAttacking.clear();
  }
}
