/**
 * HumanoidNPC — a wandering NPC built on a PixelLab/Aseprite spritesheet.
 *
 * ## Setup (in your scene)
 *
 *   // preload():
 *   this.load.aseprite('npc-wanderer',
 *     'assets/sprites/characters/earth/npcs/npc-wanderer/npc-wanderer.png',
 *     'assets/sprites/characters/earth/npcs/npc-wanderer/npc-wanderer.json');
 *
 *   // create():
 *   this.anims.createFromAseprite('npc-wanderer');
 *   const npc = new HumanoidNPC(this, x, y, { textureKey: 'npc-wanderer', ... });
 *
 * ## Animation keys expected
 *
 * The Aseprite JSON (assembled by `npm run sprites:assemble`) must contain tags
 * named with the `{textureKey}_{state}_{dir}` convention used throughout the
 * project. For a `textureKey` of `'npc-wanderer'` the NPC needs:
 *
 *   npc-wanderer_idle_south, npc-wanderer_idle_east, … (×5 dirs)
 *   npc-wanderer_walk_south, npc-wanderer_walk_east, … (×5 dirs)
 *
 * West-side directions (south-west, west, north-west) are mirrored via
 * `setFlipX(true)` — no extra animation tags needed.
 *
 * ## Interaction
 *
 * When the player walks within `interactRadius` pixels a "[T] Talk" hint fades
 * in above the NPC.  Pressing T (keyboard) or tapping the sprite fires the
 * `'npc-interact'` scene event:
 *
 *   scene.events.on('npc-interact', ({ name, line }) => { … });
 *
 * Dialog cycles through `dialogLines` round-robin.
 */

import * as Phaser from 'phaser';
import type { WorldBlackboard, WorldCombatEvent, WorldSoundEvent } from '../ai/WorldBlackboard';

// ── Direction helpers ─────────────────────────────────────────────────────────
// Same 8-sector mapping used by CombatEntity — left-side dirs mirror right-side.
type CanonDir = 'south' | 'south-east' | 'east' | 'north-east' | 'north';
type NpcPersonality = 'friendly' | 'fearful' | 'suspicious' | 'brave';
type NpcState = 'wander' | 'flee' | 'investigate';

const DIR_MAP: Record<number, [CanonDir, boolean]> = {
   0: ['east',       false],
   1: ['south-east', false],
   2: ['south',      false],
   3: ['south-east', true ],   // SW → flip SE
   4: ['east',       true ],   // W  → flip E
  '-4': ['east',    true ],
  '-3': ['north-east', true ], // NW → flip NE
  '-2': ['north',   false],
  '-1': ['north-east', false],
};

function resolveDir(vx: number, vy: number): [CanonDir, boolean] {
  const angle  = Math.atan2(vy, vx);
  const sector = Math.round(angle / (Math.PI / 4));
  return DIR_MAP[sector] ?? ['south', false];
}

const PERSONALITY_HEARING_RADIUS: Record<NpcPersonality, number> = {
  friendly: 250,
  fearful: 400,
  suspicious: 180,
  brave: 300,
};

const PERSONALITY_PANIC_MULTIPLIER: Record<NpcPersonality, number> = {
  friendly: 1,
  fearful: 1.6,
  suspicious: 0.7,
  brave: 0,
};

const SOUND_PANIC_DURATION_MS: Record<WorldSoundEvent['type'], number> = {
  gunshot: 5000,
  explosion: 10000,
  death: 4000,
  scream: 6000,
  combat: 5000,
};

const INVESTIGATE_DURATION_MS = 8000;
const INVESTIGATE_ARRIVAL_RADIUS = 60;
const FLEE_SPEED_MULTIPLIER = 1.4;
const RECENTLY_PANICKED_MS = 30000;

// ── Config ────────────────────────────────────────────────────────────────────

export interface HumanoidNPCConfig {
  /**
   * Phaser texture key — must be loaded as Aseprite in preload() and
   * registered via `scene.anims.createFromAseprite(key)` before creating this NPC.
   */
  textureKey: string;
  /** Display name shown in dialog events. */
  name: string;
  /** Lines shown in order; cycles on repeat. */
  dialogLines: string[];
  /** Lines used briefly after the NPC has fled from danger. Defaults to dialogLines. */
  frightenedDialogLines?: string[];
  /** Personality controls hearing distance and flee/investigate response. Default: friendly. */
  personality?: NpcPersonality;
  /** Walk speed in px/s. Default: 48. */
  walkSpeed?: number;
  /** Player must be within this many px to trigger interaction. Default: 80. */
  interactRadius?: number;
  /** How long (ms) the NPC walks in one direction before picking a new one. */
  wanderIntervalMin?: number;
  wanderIntervalMax?: number;
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class HumanoidNPC extends Phaser.Physics.Arcade.Sprite {
  private readonly npcName: string;
  private readonly dialogLines: string[];
  private readonly frightenedDialogLines: string[];
  private readonly personality: NpcPersonality;
  private readonly hearingRadius: number;
  private readonly walkSpeed: number;
  private readonly interactRadius: number;
  private readonly wanderIntervalMin: number;
  private readonly wanderIntervalMax: number;

  // Wander state
  private wanderVx = 0;
  private wanderVy = 0;
  private wanderTimer = 0;
  private npcState: NpcState = 'wander';
  private blackboard: WorldBlackboard | null = null;
  private threatOrigin: { x: number; y: number } | null = null;
  private threatMemoryMs = 0;
  private investigateTarget: { x: number; y: number } | null = null;
  private investigateTimerMs = 0;
  private recentlyPanickedMs = 0;

  // Animation state — persisted to avoid restarting the same anim every frame
  private facingDir: CanonDir = 'south';
  private facingFlip = false;
  private currentAnimKey = '';

  // Interaction
  private dialogIndex = 0;
  private promptText: Phaser.GameObjects.Text | null = null;
  private tKey: Phaser.Input.Keyboard.Key | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: HumanoidNPCConfig,
  ) {
    super(scene, x, y, config.textureKey, 0);

    // Register in Phaser's display + physics lists
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.npcName           = config.name;
    this.dialogLines       = config.dialogLines;
    this.frightenedDialogLines = config.frightenedDialogLines ?? config.dialogLines;
    this.personality       = config.personality ?? 'friendly';
    this.hearingRadius     = PERSONALITY_HEARING_RADIUS[this.personality];
    this.walkSpeed         = config.walkSpeed         ?? 48;
    this.interactRadius    = config.interactRadius    ?? 80;
    this.wanderIntervalMin = config.wanderIntervalMin ?? 1200;
    this.wanderIntervalMax = config.wanderIntervalMax ?? 3200;

    // Anchor at feet for natural y-sorting with the hero
    this.setOrigin(0.5, 1);
    this.setDepth(y);

    // Physics body: narrow foot hitbox so the NPC doesn't block paths
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(12, 10);
    body.setOffset(10, 22);   // centred on feet in a ~32px canvas
    body.setCollideWorldBounds(true);

    // Keyboard interact key — T for Talk (avoids conflicts with WASD/Space/E/F/G)
    this.tKey = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.T) ?? null;

    // Tap-to-interact (mobile + mouse)
    this.setInteractive({ useHandCursor: true });
    this.on('pointerup', () => this.triggerDialog());

    // "[T] Talk" prompt — fades in when player is close
    this.promptText = scene.add.text(x, y - 40, '[T] Talk', {
      fontSize: '9px',
      color: '#ffe066',
      fontFamily: 'monospace',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setAlpha(0).setDepth(9999);

    // Start moving immediately
    this.pickNewWanderDir();
  }

  // ── Main update — call from scene.update() ────────────────────────────────

  /**
   * @param delta    Frame delta from scene.update() (ms)
   * @param playerX  Current player world-x
   * @param playerY  Current player world-y
   */
  tick(delta: number, playerX: number, playerY: number): void {
    this.recentlyPanickedMs = Math.max(0, this.recentlyPanickedMs - delta);
    this.checkHearing();

    const body = this.body as Phaser.Physics.Arcade.Body;
    this.updateMovementState(delta, body);

    // ── Depth — refresh so y-sorting with the hero works ────────────────────
    this.setDepth(this.y);
    if (this.promptText) this.promptText.setDepth(this.y + 1);

    // ── Proximity check ───────────────────────────────────────────────────────
    const dx   = playerX - this.x;
    const dy   = playerY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const inRange = dist <= this.interactRadius;

    if (this.promptText) {
      this.promptText.setAlpha(
        Phaser.Math.Linear(this.promptText.alpha, inRange ? 1 : 0, 0.12),
      );
      this.promptText.setPosition(this.x, this.y - 40);
    }

    if (inRange && this.tKey && Phaser.Input.Keyboard.JustDown(this.tKey)) {
      this.triggerDialog();
    }

    // ── Animation ─────────────────────────────────────────────────────────────
    this.updateAnimation();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  setBlackboard(blackboard: WorldBlackboard): void {
    this.blackboard = blackboard;
  }

  private checkHearing(): void {
    if (!this.blackboard) return;

    for (const event of this.blackboard.soundEvents) {
      const effectiveRadius = Math.min(event.radius, this.hearingRadius);
      const distance = Phaser.Math.Distance.Between(
        this.x,
        this.y,
        event.origin.x,
        event.origin.y,
      );

      if (distance <= effectiveRadius) {
        this.onHearSound(event);
        break;
      }
    }
  }

  private onHearSound(event: WorldSoundEvent): void {
    if (this.personality === 'brave') {
      this.transitionToInvestigate(event.origin);
      return;
    }

    const durationMs =
      SOUND_PANIC_DURATION_MS[event.type] *
      event.intensity *
      PERSONALITY_PANIC_MULTIPLIER[this.personality];

    if (durationMs <= 0) return;
    this.transitionToFlee(event.origin, durationMs);
  }

  private updateMovementState(delta: number, body: Phaser.Physics.Arcade.Body): void {
    if (this.npcState === 'flee') {
      this.tickFlee(delta, body);
      return;
    }

    if (this.npcState === 'investigate') {
      this.tickInvestigate(delta, body);
      return;
    }

    this.wanderTimer -= delta;
    if (this.wanderTimer <= 0) this.pickNewWanderDir();
    body.setVelocity(this.wanderVx, this.wanderVy);
  }

  private transitionToFlee(origin: { x: number; y: number }, durationMs: number): void {
    const wasFleeing = this.npcState === 'flee';
    this.npcState = 'flee';
    this.threatOrigin = { x: origin.x, y: origin.y };
    this.threatMemoryMs = Math.max(this.threatMemoryMs, durationMs);
    this.investigateTarget = null;
    this.investigateTimerMs = 0;

    if (!wasFleeing) {
      // Herd panic: one fleeing NPC becomes a small social signal to nearby NPCs.
      this.blackboard?.broadcastSound(this.x, this.y, 120, 'scream', 0.4);
    }
  }

  private transitionToInvestigate(origin: { x: number; y: number }): void {
    if (this.npcState === 'flee') return;
    this.npcState = 'investigate';
    this.investigateTarget = { x: origin.x, y: origin.y };
    this.investigateTimerMs = INVESTIGATE_DURATION_MS;
    this.threatOrigin = null;
    this.threatMemoryMs = 0;
  }

  private tickFlee(delta: number, body: Phaser.Physics.Arcade.Body): void {
    if (!this.threatOrigin) {
      this.transitionToWander();
      body.setVelocity(this.wanderVx, this.wanderVy);
      return;
    }

    this.refreshThreatMemoryFromCombatEvents();
    this.threatMemoryMs -= delta;

    if (this.threatMemoryMs <= 0) {
      this.recentlyPanickedMs = RECENTLY_PANICKED_MS;
      this.transitionToWander();
      body.setVelocity(this.wanderVx, this.wanderVy);
      return;
    }

    const dx = this.x - this.threatOrigin.x;
    const dy = this.y - this.threatOrigin.y;
    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const speed = this.walkSpeed * FLEE_SPEED_MULTIPLIER;
    this.wanderVx = (dx / distance) * speed;
    this.wanderVy = (dy / distance) * speed;
    body.setVelocity(this.wanderVx, this.wanderVy);
  }

  private tickInvestigate(delta: number, body: Phaser.Physics.Arcade.Body): void {
    if (!this.investigateTarget) {
      this.transitionToWander();
      body.setVelocity(this.wanderVx, this.wanderVy);
      return;
    }

    this.investigateTimerMs -= delta;
    const dx = this.investigateTarget.x - this.x;
    const dy = this.investigateTarget.y - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= INVESTIGATE_ARRIVAL_RADIUS || this.investigateTimerMs <= 0) {
      this.transitionToWander();
      body.setVelocity(this.wanderVx, this.wanderVy);
      return;
    }

    const safeDistance = Math.max(1, distance);
    this.wanderVx = (dx / safeDistance) * this.walkSpeed;
    this.wanderVy = (dy / safeDistance) * this.walkSpeed;
    body.setVelocity(this.wanderVx, this.wanderVy);
  }

  private refreshThreatMemoryFromCombatEvents(): void {
    if (!this.blackboard) return;

    for (const event of this.blackboard.combatEvents) {
      if (this.isCombatEventThreatening(event)) {
        this.threatMemoryMs = Math.max(this.threatMemoryMs, 1000);
        return;
      }
    }
  }

  private isCombatEventThreatening(event: WorldCombatEvent): boolean {
    const dx = this.x - event.origin.x;
    const dy = this.y - event.origin.y;
    return Math.sqrt(dx * dx + dy * dy) <= Math.min(event.radius, this.hearingRadius);
  }

  private transitionToWander(): void {
    this.npcState = 'wander';
    this.threatOrigin = null;
    this.threatMemoryMs = 0;
    this.investigateTarget = null;
    this.investigateTimerMs = 0;
    this.pickNewWanderDir();
  }

  private pickNewWanderDir(): void {
    const pause = Math.random() < 0.2;
    if (pause) {
      this.wanderVx = 0;
      this.wanderVy = 0;
    } else {
      const angle   = Math.random() * Math.PI * 2;
      this.wanderVx = Math.cos(angle) * this.walkSpeed;
      this.wanderVy = Math.sin(angle) * this.walkSpeed;
    }

    this.wanderTimer =
      this.wanderIntervalMin +
      Math.random() * (this.wanderIntervalMax - this.wanderIntervalMin);
  }

  private updateAnimation(): void {
    const spd = Math.sqrt(this.wanderVx * this.wanderVx + this.wanderVy * this.wanderVy);

    if (spd > 5) {
      const [dir, flip] = resolveDir(this.wanderVx, this.wanderVy);
      this.facingDir  = dir;
      this.facingFlip = flip;
    }

    const state   = spd > 5 ? 'walk' : 'idle';
    const animKey = `${this.texture.key}_${state}_${this.facingDir}`;

    if (animKey !== this.currentAnimKey) {
      this.play(animKey, true);
      this.currentAnimKey = animKey;
    }

    this.setFlipX(this.facingFlip);
  }

  private triggerDialog(): void {
    const activeLines = this.recentlyPanickedMs > 0 ? this.frightenedDialogLines : this.dialogLines;
    if (activeLines.length === 0) return;
    const line = activeLines[this.dialogIndex % activeLines.length];
    this.dialogIndex++;
    this.scene.events.emit('npc-interact', { name: this.npcName, line });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  override destroy(fromScene?: boolean): void {
    this.promptText?.destroy();
    this.promptText = null;
    super.destroy(fromScene);
  }
}
