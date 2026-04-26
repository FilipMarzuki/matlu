export type WorldSoundType = 'gunshot' | 'explosion' | 'scream' | 'combat' | 'death';

export interface WorldSoundEvent {
  readonly origin: { x: number; y: number };
  readonly radius: number;
  readonly type: WorldSoundType;
  readonly intensity: number;
}

export interface WorldCombatEvent {
  readonly origin: { x: number; y: number };
  readonly radius: number;
  ttlMs: number;
}

export type WorldPlayerEventType = 'killed-enemy' | 'entered-zone' | 'used-item';

export interface WorldPlayerEvent {
  readonly type: WorldPlayerEventType;
  readonly origin: { x: number; y: number };
}

/**
 * WorldBlackboard is a tiny scene-level event bus for open-world NPC awareness.
 * Producers broadcast facts once; NPCs decide locally whether those facts matter.
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
      radius,
      type,
      intensity: Math.max(0, Math.min(1, intensity)),
    });
  }

  broadcastCombat(x: number, y: number, radius: number, ttlMs = 5000): void {
    const existing = this.combatEvents.find((event) => {
      const dx = x - event.origin.x;
      const dy = y - event.origin.y;
      return Math.sqrt(dx * dx + dy * dy) <= Math.min(radius, event.radius);
    });

    if (existing) {
      this.combatEvents.splice(this.combatEvents.indexOf(existing), 1, {
        origin: { x, y },
        radius: Math.max(existing.radius, radius),
        ttlMs: Math.max(existing.ttlMs, ttlMs),
      });
      return;
    }

    this.combatEvents.push({ origin: { x, y }, radius, ttlMs });
  }

  broadcastPlayerEvent(type: WorldPlayerEventType, x: number, y: number): void {
    this.playerEvents.push({ type, origin: { x, y } });
  }

  tick(delta: number): void {
    this.soundEvents.length = 0;
    this.playerEvents.length = 0;

    for (let i = this.combatEvents.length - 1; i >= 0; i--) {
      const event = this.combatEvents[i];
      event.ttlMs -= delta;
      if (event.ttlMs <= 0) {
        this.combatEvents.splice(i, 1);
      }
    }
  }
}
