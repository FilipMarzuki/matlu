/**
 * ArenaBlackboard — lightweight shared state for CombatArenaScene.
 *
 * Passed to enemies so they can coordinate swarm-wide reactions (panic,
 * sound events) without holding direct references to each other.
 *
 * CombatArenaScene owns one instance, updates it once per frame, and
 * passes it to enemies when needed. Enemies read `panicOrigin` to decide
 * whether to enter panic state.
 *
 * When FIL-190 (SoundEventSystem) lands, this class will be replaced by or
 * extended with a proper sound-event queue. For now it serves one role:
 * propagating the position of loud events (deaths) so nearby enemies scatter.
 */
export class ArenaBlackboard {
  /**
   * World position of the most recent loud event (death, gunshot).
   * Set by CombatArenaScene when a combatant dies; null when no active event.
   * Enemies sample this each tick — those within their panic radius call enterPanic().
   */
  panicOrigin: { x: number; y: number } | null = null;

  /** Tracks how long the current panicOrigin has been alive (ms). */
  private panicAge = 0;

  /**
   * Publish a panic event at the given world position.
   * The event is automatically cleared after 200 ms so only one wave of
   * panic reactions fires per event rather than triggering every frame.
   */
  setPanic(x: number, y: number): void {
    this.panicOrigin = { x, y };
    this.panicAge = 0;
  }

  /** Call once per frame to expire stale panic events. */
  update(delta: number): void {
    if (!this.panicOrigin) return;
    this.panicAge += delta;
    if (this.panicAge > 200) {
      this.panicOrigin = null;
      this.panicAge = 0;
    }
  }
}
