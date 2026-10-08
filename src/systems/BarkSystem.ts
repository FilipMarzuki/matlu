/**
 * BarkSystem — ambient NPC one-liners triggered by player proximity.
 *
 * Unlike the E-key dialog system (NpcDialogScene), barks need no keypress and
 * carry no UI panel: they're a floating text line above the NPC's head, shown
 * automatically when the player walks close. A per-NPC cooldown stops the same
 * line from popping up every frame while the player lingers nearby.
 *
 * This module is pure (no Phaser dependency) so the trigger/cooldown/selection
 * logic can be unit tested without a browser. The scene is responsible for
 * measuring distance each frame and spawning the floating text when a bark
 * line comes back.
 *
 * Issue: #948
 */

export interface NpcBarkEntry {
  npcId: string;
  barks: string[];
}

/** Default proximity radius (px) within which a bark can trigger. */
export const BARK_RADIUS_PX = 100;

/** Default per-NPC cooldown between barks (ms). */
export const BARK_COOLDOWN_MS = 30_000;

export class BarkSystem {
  private readonly barksByNpc = new Map<string, string[]>();
  private readonly lastBarkAt = new Map<string, number>();

  constructor(
    entries: NpcBarkEntry[],
    private readonly radiusPx = BARK_RADIUS_PX,
    private readonly cooldownMs = BARK_COOLDOWN_MS,
  ) {
    for (const entry of entries) this.barksByNpc.set(entry.npcId, entry.barks);
  }

  /**
   * Attempt to trigger a bark for `npcId` given its current distance from the
   * player. Returns the chosen line, or null if out of range, on cooldown, or
   * the NPC has no bark lines registered.
   */
  tryBark(npcId: string, distance: number, now: number, rng: () => number = Math.random): string | null {
    if (distance > this.radiusPx) return null;

    const lines = this.barksByNpc.get(npcId);
    if (!lines || lines.length === 0) return null;

    const last = this.lastBarkAt.get(npcId);
    if (last !== undefined && now - last < this.cooldownMs) return null;

    this.lastBarkAt.set(npcId, now);
    return lines[Math.floor(rng() * lines.length)];
  }
}
