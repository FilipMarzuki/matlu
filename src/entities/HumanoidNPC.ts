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

// ── Direction helpers ─────────────────────────────────────────────────────────
// Same 8-sector mapping used by CombatEntity — left-side dirs mirror right-side.
type CanonDir = 'south' | 'south-east' | 'east' | 'north-east' | 'north';
export type HumanoidNPCLodTier = 0 | 1 | 2;

export const HUMANOID_NPC_LOD_ACTIVE_DISTANCE = 400;
export const HUMANOID_NPC_LOD_REDUCED_DISTANCE = 900;

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

export function getHumanoidNpcLodTier(distancePx: number): HumanoidNPCLodTier {
  if (distancePx < HUMANOID_NPC_LOD_ACTIVE_DISTANCE) return 0;
  if (distancePx < HUMANOID_NPC_LOD_REDUCED_DISTANCE) return 1;
  return 2;
}

function getLodInterval(tier: HumanoidNPCLodTier): number {
  if (tier === 0) return 0;
  if (tier === 1) return 200;
  return 1000;
}

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
  private readonly walkSpeed: number;
  private readonly interactRadius: number;
  private readonly wanderIntervalMin: number;
  private readonly wanderIntervalMax: number;

  // Wander state
  private wanderVx = 0;
  private wanderVy = 0;
  private wanderTimer = 0;

  // LOD state — scenes assign tiers on a coarse cadence to avoid per-frame
  // distance checks for every NPC on mobile hardware.
  private lodTier: HumanoidNPCLodTier = 0;
  private lodAccumulator = 0;
  private lodInterval = 0;
  private pausedForSleepingLod = false;

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
    const lodDelta = this.consumeLodDelta(delta);
    if (lodDelta === null) return;

    if (this.lodTier === 2) {
      this.tickSleepingLod(lodDelta);
      return;
    }

    this.tickActiveLod(lodDelta, playerX, playerY);
  }

  /**
   * Assigns the AI tick tier directly. Hosting scenes should call this only on a
   * coarse timer (for example every 200ms), not inside every frame's NPC loop.
   */
  setLodTier(tier: HumanoidNPCLodTier): void {
    if (tier === this.lodTier) return;

    const wasSleeping = this.lodTier === 2;
    this.lodTier = tier;
    this.lodInterval = getLodInterval(tier);
    this.lodAccumulator = 0;

    if (tier === 2) {
      const body = this.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0, 0);
      this.promptText?.setAlpha(0);

      if (this.anims.isPlaying) {
        this.anims.pause();
        this.pausedForSleepingLod = true;
      }
      return;
    }

    if (wasSleeping && this.pausedForSleepingLod) {
      this.anims.resume();
      this.pausedForSleepingLod = false;
    }
  }

  /**
   * Convenience helper for scene-level LOD assignment:
   *
   *   lodTimer -= delta;
   *   if (lodTimer <= 0) {
   *     lodTimer = 200;
   *     for (const npc of npcs) npc.setLodTierFromPlayer(player.x, player.y);
   *   }
   */
  setLodTierFromPlayer(playerX: number, playerY: number): void {
    const distance = Phaser.Math.Distance.Between(playerX, playerY, this.x, this.y);
    this.setLodTier(getHumanoidNpcLodTier(distance));
  }

  getLodTier(): HumanoidNPCLodTier {
    return this.lodTier;
  }

  private consumeLodDelta(delta: number): number | null {
    if (this.lodInterval === 0) return delta;

    this.lodAccumulator += delta;
    if (this.lodAccumulator < this.lodInterval) return null;

    const elapsed = this.lodAccumulator;
    this.lodAccumulator = 0;
    return elapsed;
  }

  private tickSleepingLod(delta: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    this.wanderTimer = Math.max(0, this.wanderTimer - delta);
    this.setDepth(this.y);
    this.promptText?.setPosition(this.x, this.y - 40);
  }

  private tickActiveLod(delta: number, playerX: number, playerY: number): void {
    // ── Wander ────────────────────────────────────────────────────────────────
    this.wanderTimer -= delta;
    if (this.wanderTimer <= 0) this.pickNewWanderDir();

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(this.wanderVx, this.wanderVy);

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
    if (this.dialogLines.length === 0) return;
    const line = this.dialogLines[this.dialogIndex % this.dialogLines.length];
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
