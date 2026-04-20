export type WorldSoundType = 'gunshot' | 'explosion' | 'scream' | 'combat' | 'death';
export type WorldPlayerEventType = 'killed-enemy' | 'entered-zone' | 'used-item';

export interface WorldSoundEvent {
  origin: { x: number; y: number };
  /** Maximum distance (px) this sound can propagate. */
  radius: number;
  /** Semantic tag used by NPC logic to map panic/response behavior. */
  type: WorldSoundType;
  /** 0..1 multiplier for panic intensity/duration. */
  intensity: number;
}

export interface WorldCombatEvent {
  origin: { x: number; y: number };
  /** Radius (px) of the active combat hotspot. */
  radius: number;
  /** Remaining lifetime in milliseconds. */
  ttl: number;
}

export interface WorldPlayerEvent {
  origin: { x: number; y: number };
  type: WorldPlayerEventType;
}

/**
 * WorldBlackboard — lightweight world-scoped event bus for NPC awareness.
 *
 * - soundEvents are one-frame broadcasts (cleared every tick).
 * - combatEvents persist with a TTL so ongoing fights remain discoverable.
 * - playerEvents are one-frame semantic signals for optional narrative hooks.
 */
export class WorldBlackboard {
  readonly soundEvents: WorldSoundEvent[] = [];
  readonly combatEvents: WorldCombatEvent[] = [];
  readonly playerEvents: WorldPlayerEvent[] = [];

  broadcastSound(
    x: number,
    y: number,
    radius: number,
    type: WorldSoundType,
    intensity = 1,
  ): void {
    this.soundEvents.push({
      origin: { x, y },
      radius: Math.max(0, radius),
      type,
      intensity: Math.min(1, Math.max(0, intensity)),
    });
  }

  /**
   * Upserts a combat hotspot near (x, y) so repeated calls refresh one event
   * instead of appending an unbounded list each frame.
   */
  broadcastCombat(
    x: number,
    y: number,
    radius: number,
    ttlMs = 5000,
  ): void {
    const mergeDistance = 96;
    const existing = this.combatEvents.find((event: WorldCombatEvent) =>
      Math.hypot(event.origin.x - x, event.origin.y - y) <= mergeDistance
    );

    if (existing) {
      existing.origin.x = x;
      existing.origin.y = y;
      existing.radius = Math.max(existing.radius, Math.max(0, radius));
      existing.ttl = Math.max(existing.ttl, Math.max(0, ttlMs));
      return;
    }

    this.combatEvents.push({
      origin: { x, y },
      radius: Math.max(0, radius),
      ttl: Math.max(0, ttlMs),
    });
  }

  broadcastPlayerEvent(x: number, y: number, type: WorldPlayerEventType): void {
    this.playerEvents.push({
      origin: { x, y },
      type,
    });
  }

  tick(delta: number): void {
    this.soundEvents.length = 0;
    this.playerEvents.length = 0;

    for (let i = this.combatEvents.length - 1; i >= 0; i--) {
      this.combatEvents[i].ttl -= delta;
      if (this.combatEvents[i].ttl <= 0) {
        this.combatEvents.splice(i, 1);
      }
    }
  }
}
