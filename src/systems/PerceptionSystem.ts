/**
 * PerceptionSystem — active perception driven by the Tinker Tray.
 *
 * What's in your tray (slots 0-1) affects what you notice in the world.
 * When the player interacts with an NPC, inspects an object, or finishes
 * combat, the system checks for tag overlap between tray contents and the
 * target's perception entries. Matches yield bonus dialogue, environmental
 * hints, or discovery progress.
 *
 * ## Usage
 *
 *   const perception = new PerceptionSystem(scene);
 *
 *   // Check for bonus content when interacting with an NPC:
 *   const insight = perception.check(npcPerceptionEntries);
 *   if (insight) {
 *     // Show insight.text as extra dialogue, apply insight.reward
 *   }
 *
 * ## Data model
 *
 * Perceivable objects carry a `perceptionEntries` array:
 *   { tags: string[], text: string, reward?: PerceptionReward }
 *
 * Tags use namespaced IDs matching tray contents:
 *   "concept:heat-treatment", "lore:corruption-origin", "material:iron-ore"
 *
 * Issue: #824
 */

import * as Phaser from 'phaser';
import type { TinkerTraySystem } from './TinkerTraySystem';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PerceptionReward {
  /** Bonus progress (0-1) toward the current tray discovery. */
  discoveryBonus?: number;
  /** A concept or lore ID to unlock/advance. */
  unlockId?: string;
}

export interface PerceptionEntry {
  /** Tags that must overlap with tray slots 0-1 to trigger. */
  tags: string[];
  /** Insight text shown to the player — should feel like a personal observation. */
  text: string;
  /** Optional reward for noticing this. */
  reward?: PerceptionReward;
}

export interface PerceptionMatch {
  entry: PerceptionEntry;
  /** Which tray slot IDs matched (for UI highlighting). */
  matchedTags: string[];
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Only the top 2 tray slots trigger perception (slots 3-5 are too noisy). */
const ACTIVE_SLOT_COUNT = 2;

/** Event emitted on scene.events when a perception triggers. */
export const PERCEPTION_TRIGGERED = 'perception-triggered';

// ── System ───────────────────────────────────────────────────────────────────

export class PerceptionSystem {
  private readonly game: Phaser.Game;

  constructor(scene: Phaser.Scene) {
    this.game = scene.game;
  }

  /**
   * Check perception entries against the player's active tray slots.
   *
   * Returns the first matching entry (highest priority = first in array),
   * or null if nothing matches.
   */
  check(entries: PerceptionEntry[]): PerceptionMatch | null {
    const tray = this.game.registry.get('tinkerTraySystem') as TinkerTraySystem | undefined;
    if (!tray) return null;

    // Collect non-null IDs from slots 0 and 1 only
    const activeIds = new Set<string>();
    for (let i = 0; i < ACTIVE_SLOT_COUNT; i++) {
      const id = tray.slots[i];
      if (id) activeIds.add(id);
    }
    if (activeIds.size === 0) return null;

    // Find the first entry where at least one tag overlaps with active tray slots
    for (const entry of entries) {
      const matchedTags: string[] = [];
      for (const tag of entry.tags) {
        if (activeIds.has(tag)) matchedTags.push(tag);
      }
      if (matchedTags.length > 0) {
        return { entry, matchedTags };
      }
    }

    return null;
  }

  /**
   * Check and apply a perception match — returns the match if found,
   * and applies any discovery bonus to the tray progress.
   */
  checkAndApply(entries: PerceptionEntry[], scene: Phaser.Scene): PerceptionMatch | null {
    const match = this.check(entries);
    if (!match) return null;

    // Apply discovery bonus if specified
    if (match.entry.reward?.discoveryBonus) {
      const tray = this.game.registry.get('tinkerTraySystem') as TinkerTraySystem | undefined;
      if (tray) {
        tray.progress = Math.min(1, tray.progress + match.entry.reward.discoveryBonus);
      }
    }

    // Emit event so other systems (HUD, etc.) can react
    scene.events.emit(PERCEPTION_TRIGGERED, match);

    return match;
  }
}
