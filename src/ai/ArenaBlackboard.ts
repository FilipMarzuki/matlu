/**
 * A loud in-world event (melee hit, death, ability) that can alert nearby enemies.
 * Enemies within hearingRadius of origin.x/y enter the alerted-investigate state.
 * Events live for one tick only — broadcastSound() adds them, tick() clears them.
 */
export interface SoundEvent {
  x: number;
  y: number;
  /** Maximum distance (px) at which this event can be heard. */
  radius: number;
}

/**
 * ArenaBlackboard — lightweight shared state for arena-level AI coordination.
 *
 * Enemies read from (and write to) this object to coordinate without talking
 * to each other directly. No entity holds a reference to another enemy —
 * they only read the shared counters/cooldowns here.
 *
 * Currently tracks:
 *   flyerDiveCooldown — prevents multiple ParasiteFlyers diving simultaneously.
 *   packStalkerFrontAttacking — per-pack flag set by the PackStalker frontrunner.
 *   soundEvents — loud in-world events that alert nearby hearing enemies.
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

  /**
   * Loud in-world events this tick — melee hits, deaths, ability activations.
   * Enemies with hearingRadius > 0 scan this list in updateBehaviour() and
   * enter the alerted-investigate state if an event is within range.
   * Cleared at the start of each tick so events only fire once.
   */
  readonly soundEvents: SoundEvent[] = [];

  /**
   * Broadcast a loud sound event at the given world position.
   * Any enemy within its own hearingRadius of (x, y) will investigate.
   * radius controls the maximum propagation distance of this specific event —
   * a gunshot carries further than a fist hitting armour.
   */
  broadcastSound(x: number, y: number, radius: number): void {
    this.soundEvents.push({ x, y, radius });
  }

  /** Called once per frame by the arena scene. Decrements all timers. */
  tick(delta: number): void {
    this.flyerDiveCooldown      = Math.max(0, this.flyerDiveCooldown      - delta);
    this.velcridScoutsOrbiting  = Math.max(0, this.velcridScoutsOrbiting  - delta);
    this.velcridSoldierChargeCd = Math.max(0, this.velcridSoldierChargeCd - delta);
    // Clear one-frame state — the arena scene / entities re-set these each event.
    this.panicOrigin = null;
    this.soundEvents.length = 0;
    // Clear per-pack front-attacking flags — each frontrunner re-sets per frame while in range.
    this.packStalkerFrontAttacking.clear();
  }
}
