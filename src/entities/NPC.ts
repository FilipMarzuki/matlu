/**
 * NPC — non-player character for Matlu's world (FIL-38).
 *
 * Three tiers defined in the issue:
 *   background  — passive residents with day/night routines and speech bubbles
 *   displaced   — lost in the wrong world; mostly stationary, hints at lore
 *   important   — named story characters with full JRPG dialog trees
 *
 * ## Usage
 * ```ts
 * const npc = new NPC(scene, x, y, {
 *   type: 'background',
 *   name: 'Grannen',
 *   color: 0xbb8855,
 *   schedule: NEIGHBOR_SCHEDULE,
 *   speech: NEIGHBOR_SPEECH,
 *   wanderRadius: 120,
 * });
 * scene.add.existing(npc);
 * // In update():
 * npc.tick(delta, playerX, playerY, clockPhase, zoneCorruption);
 * ```
 */

import { Entity } from './Entity';
import type { DayPhase } from '../world/WorldClock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NPCState = 'working' | 'resting' | 'sleeping' | 'fleeing' | 'wandering';
export type NPCType  = 'background' | 'displaced' | 'important';

/**
 * Maps each DayPhase to the NPC's preferred state during that phase.
 * Corruption can override this (see tick()).
 */
export type NPCSchedule = Record<DayPhase, NPCState>;

/** Speech lines selected by context priority (high → low). */
export interface NPCSpeechLines {
  /** Shown when zone corruption exceeds CORRUPTION_FLEE_THRESHOLD */
  corruption?: string;
  /** Shown once after the player cleanses something nearby */
  afterCleanse?: string;
  /** Shown from the second interaction onwards */
  secondVisit?: string;
  /** Phase-specific overrides */
  dawn?: string;
  morning?: string;
  midday?: string;
  afternoon?: string;
  dusk?: string;
  night?: string;
  /** Fallback — always defined */
  default: string;
}

export interface NPCConfig {
  type: NPCType;
  /** Display name shown in dialog box and above speech bubble */
  name: string;
  /** Body color — placeholder until real sprites are added */
  color: number;
  /** Day/night schedule. Omit for fully stationary NPCs. */
  schedule?: NPCSchedule;
  speech: NPCSpeechLines;
  /** Radius within which the player triggers the speech bubble (default 80) */
  bubbleRadius?: number;
  /** Radius within which E-key launches dialog (default 60) */
  interactRadius?: number;
  /** Max wander distance from home position (default 0 = stationary) */
  wanderRadius?: number;
  /** Portrait color for the JRPG dialog box (default = color) */
  portraitColor?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Corruption 0–1 above which an NPC flees indoors */
const CORRUPTION_FLEE_THRESHOLD  = 0.5;
/** Corruption 0–1 above which an NPC is hidden entirely */
const CORRUPTION_HIDE_THRESHOLD  = 0.8;
/** How long the NPC holds a wander direction before picking a new one (ms) */
const WANDER_HOLD_MS = 3200;
/** Speed when wandering (px/s) */
const WANDER_SPEED   = 22;

// ─── NPC class ────────────────────────────────────────────────────────────────

export class NPC extends Entity {
  readonly npcName:  string;
  readonly npcType:  NPCType;
  readonly config:   NPCConfig;

  private npcState: NPCState = 'wandering';
  private prevPhase: DayPhase | null = null;

  // Visual components
  private npcBody: Phaser.GameObjects.Rectangle;
  private bubble: Phaser.GameObjects.Text;
  private label:  Phaser.GameObjects.Text;

  // Wander state
  private readonly homeX: number;
  private readonly homeY: number;
  private wanderVx = 0;
  private wanderVy = 0;
  private wanderNextAt = 0;

  // Dialog state
  private visitCount = 0;
  private recentCleanse = false;

  /** Emitted when the player interacts with an important NPC. */
  static readonly EVENT_INTERACT = 'npc-interact';

  constructor(scene: Phaser.Scene, x: number, y: number, config: NPCConfig) {
    super(scene, x, y);
    this.config    = config;
    this.npcName   = config.name;
    this.npcType   = config.type;
    this.homeX     = x;
    this.homeY     = y;

    // ── Visual body ───────────────────────────────────────────────────────────
    // Width/height sized to look like a humanoid at the current pixel scale
    this.npcBody = scene.add.rectangle(0, 0, 14, 22, config.color);
    this.npcBody.setStrokeStyle(1, 0x000000, 0.5);
    this.add(this.npcBody);

    // ── Name label (small, above head) ────────────────────────────────────────
    this.label = scene.add.text(0, -24, config.name, {
      fontSize: '10px',
      color: '#ffffff',
      backgroundColor: '#00000066',
      padding: { x: 3, y: 1 },
    }).setOrigin(0.5, 1);
    this.label.setVisible(false);
    this.add(this.label);

    // ── Speech bubble ─────────────────────────────────────────────────────────
    this.bubble = scene.add.text(0, -46, '', {
      fontSize: '11px',
      color: '#f0f0e0',
      backgroundColor: '#1a1a2ecc',
      padding: { x: 6, y: 4 },
      wordWrap: { width: 180 },
      align: 'center',
    }).setOrigin(0.5, 1);
    this.bubble.setVisible(false);
    this.add(this.bubble);

    this.setDepth(10);

    // Listen for nearby cleanse events to update speech context
    scene.events.on('cleanse-updated', () => {
      this.recentCleanse = true;
      // Reset after 90 seconds of game-time to let the special line show once
      scene.time.delayedCall(90_000, () => { this.recentCleanse = false; });
    });
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Called every frame by GameScene.
   * @param delta        Frame delta in ms
   * @param px           Player world X
   * @param py           Player world Y
   * @param phase        Current DayPhase from WorldClock
   * @param corruption   Zone corruption 0–1 (from WorldState)
   */
  tick(
    delta: number,
    px: number,
    py: number,
    phase: DayPhase,
    corruption: number,
  ): void {
    if (!this.active) return;

    // ── State transitions ─────────────────────────────────────────────────────
    this.updateState(phase, corruption);

    // ── Hide / show based on state ────────────────────────────────────────────
    const hidden = corruption >= CORRUPTION_HIDE_THRESHOLD && this.npcType !== 'important';
    this.setVisible(!hidden && this.npcState !== 'sleeping');

    // ── Movement ──────────────────────────────────────────────────────────────
    if (this.npcState === 'wandering' || this.npcState === 'working') {
      this.updateWander(delta, this.scene.time.now);
    } else {
      this.wanderVx = 0;
      this.wanderVy = 0;
    }

    this.x += this.wanderVx * (delta / 1000);
    this.y += this.wanderVy * (delta / 1000);

    // ── Proximity interactions ────────────────────────────────────────────────
    const dist = Phaser.Math.Distance.Between(this.x, this.y, px, py);
    const bubbleR   = this.config.bubbleRadius   ?? 80;
    const interactR = this.config.interactRadius ?? 60;

    // Show name label + bubble when player is nearby
    const nearEnough = dist < bubbleR && this.visible;
    this.label.setVisible(nearEnough);
    if (nearEnough) {
      this.bubble.setText(this.pickLine(phase, corruption));
      this.bubble.setVisible(true);
    } else {
      this.bubble.setVisible(false);
    }

    // Phase transition — fire events for scene listeners
    if (phase !== this.prevPhase) {
      this.prevPhase = phase;
      this.onPhaseChange(phase);
    }

    // Store current dist so GameScene can trigger E-key interaction
    this.setData('distToPlayer', dist);
    this.setData('canInteract',  dist < interactR && this.visible);
  }

  /**
   * Called by GameScene when the player presses E near this NPC.
   * Background/displaced NPCs increment visitCount; important NPCs emit
   * NPC.EVENT_INTERACT with the dialog tree for NpcDialogScene.
   */
  interact(callerKey: string): void {
    this.visitCount++;

    if (this.npcType === 'important') {
      this.scene.events.emit(NPC.EVENT_INTERACT, {
        npc:       this,
        callerKey,
      });
    }
    // Background/displaced: speech bubble already shown via proximity — no action needed
  }

  /** Called by GameScene when a nearby cleanse just happened. */
  notifyCleanse(): void {
    this.recentCleanse = true;
  }

  get interactable(): boolean {
    return (this.getData('canInteract') as boolean | undefined) ?? false;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private updateState(phase: DayPhase, corruption: number): void {
    // Corruption overrides schedule
    if (corruption >= CORRUPTION_FLEE_THRESHOLD && this.npcType !== 'important') {
      this.npcState = corruption >= CORRUPTION_HIDE_THRESHOLD ? 'sleeping' : 'fleeing';
      return;
    }
    // No schedule = always wandering
    if (!this.config.schedule) {
      this.npcState = 'wandering';
      return;
    }
    this.npcState = this.config.schedule[phase];
  }

  private updateWander(delta: number, now: number): void {
    const radius = this.config.wanderRadius ?? 0;
    if (radius === 0) {
      this.wanderVx = 0;
      this.wanderVy = 0;
      return;
    }

    if (now >= this.wanderNextAt) {
      // 30% chance to stand still each interval
      if (Math.random() < 0.3) {
        this.wanderVx = 0;
        this.wanderVy = 0;
      } else {
        const angle = Math.random() * Math.PI * 2;
        this.wanderVx = Math.cos(angle) * WANDER_SPEED;
        this.wanderVy = Math.sin(angle) * WANDER_SPEED;
      }
      this.wanderNextAt = now + WANDER_HOLD_MS + Math.random() * 2000;
    }

    // Clamp to wander radius around home position
    const nx = this.x + this.wanderVx * (delta / 1000);
    const ny = this.y + this.wanderVy * (delta / 1000);
    const distHome = Phaser.Math.Distance.Between(nx, ny, this.homeX, this.homeY);
    if (distHome > radius) {
      // Point back toward home
      const ang = Phaser.Math.Angle.Between(this.x, this.y, this.homeX, this.homeY);
      this.wanderVx = Math.cos(ang) * WANDER_SPEED;
      this.wanderVy = Math.sin(ang) * WANDER_SPEED;
    }
  }

  /** Pick the most contextually relevant speech line. */
  private pickLine(phase: DayPhase, corruption: number): string {
    const s = this.config.speech;
    if (corruption >= CORRUPTION_FLEE_THRESHOLD && s.corruption) return s.corruption;
    if (this.recentCleanse && s.afterCleanse)                     return s.afterCleanse;
    if (this.visitCount > 1 && s.secondVisit)                     return s.secondVisit;
    if (s[phase])                                                  return s[phase]!;
    return s.default;
  }

  private onPhaseChange(_phase: DayPhase): void {
    // Bounce the NPC's body color slightly when state changes — cheap visual cue
    this.scene.tweens.add({
      targets: this.npcBody,
      scaleX: 1.1, scaleY: 1.1,
      yoyo: true,
      duration: 120,
    });
  }

  // Entity requires update() — delegates to tick() called by GameScene
  update(): void { /* intentionally empty — GameScene calls tick() */ }
}

// ─── Built-in schedules ───────────────────────────────────────────────────────

/** A worker who is active morning + afternoon, resting at midday, home at night. */
export const WORKER_SCHEDULE: NPCSchedule = {
  dawn:      'wandering',
  morning:   'working',
  midday:    'resting',
  afternoon: 'working',
  dusk:      'wandering',
  night:     'sleeping',
};

/** Someone displaced: mostly stationary, occasionally tries to find a way home. */
export const DISPLACED_SCHEDULE: NPCSchedule = {
  dawn:      'wandering',
  morning:   'resting',
  midday:    'wandering',
  afternoon: 'resting',
  dusk:      'wandering',
  night:     'sleeping',
};
