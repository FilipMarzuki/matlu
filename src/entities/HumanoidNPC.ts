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

export interface WorldPoint {
  x: number;
  y: number;
}

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

// ── Config ────────────────────────────────────────────────────────────────────

export type NpcPersonality = 'friendly' | 'fearful' | 'suspicious' | 'brave';

export interface NpcAnchorTask {
  type: 'anchor';
  x: number;
  y: number;
  radius: number;
}

export interface NpcPatrolTask {
  type: 'patrol';
  waypoints: WorldPoint[];
}

export interface NpcSitTask {
  type: 'sit';
  x: number;
  y: number;
}

export type NpcTask = NpcAnchorTask | NpcPatrolTask | NpcSitTask;

export interface NpcScheduleEntry {
  fromHour: number;
  toHour: number;
  task: NpcTask;
}

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
  /** Optional purposeful behavior. When set, this replaces aimless wandering. */
  task?: NpcTask;
  /**
   * Future clock-driven task list. Until the clock is wired in, the first entry
   * acts as an always-on task so scene config can use the final shape today.
   */
  schedule?: NpcScheduleEntry[];
  /** Personality hook for the future awareness state machine. */
  personality?: NpcPersonality;
  /** Wander radius around spawn when no task is configured. Default: 120px. */
  homeRadius?: number;
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class HumanoidNPC extends Phaser.Physics.Arcade.Sprite {
  private readonly npcName: string;
  private readonly dialogLines: string[];
  private readonly walkSpeed: number;
  private readonly interactRadius: number;
  private readonly wanderIntervalMin: number;
  private readonly wanderIntervalMax: number;
  private readonly task: NpcTask | null;
  private readonly schedule: NpcScheduleEntry[];
  private readonly homePoint: WorldPoint;
  private readonly homeRadius: number;

  // Wander state
  private wanderVx = 0;
  private wanderVy = 0;
  private wanderTimer = 0;
  private patrolIndex = 0;
  private patrolPauseTimer = 0;

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
    this.task              = config.task              ?? null;
    this.schedule          = config.schedule          ?? [];
    this.homePoint         = { x, y };
    this.homeRadius        = config.homeRadius        ?? 120;

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

    // Start moving immediately. Task movement may override this each frame.
    this.pickNewWanderDir();
  }

  // ── Main update — call from scene.update() ────────────────────────────────

  /**
   * @param delta    Frame delta from scene.update() (ms)
   * @param playerX  Current player world-x
   * @param playerY  Current player world-y
   */
  tick(delta: number, playerX: number, playerY: number): void {
    // ── Movement ──────────────────────────────────────────────────────────────
    const activeTask = this.getActiveTask();
    if (activeTask) {
      this.tickTask(activeTask, delta);
    } else {
      this.tickWander(delta, this.homePoint, this.homeRadius);
    }

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

  private getActiveTask(): NpcTask | null {
    // FIL-416 only asks for a schedule stub: use the first configured entry as
    // always-on until the world clock can select entries by time-of-day.
    return this.schedule[0]?.task ?? this.task;
  }

  private tickWander(delta: number, center: WorldPoint, radius: number): void {
    const distToCenter = Phaser.Math.Distance.Between(this.x, this.y, center.x, center.y);
    if (distToCenter > radius) {
      this.moveToward(center, 0);
      this.wanderTimer = 0;
      return;
    }

    this.wanderTimer -= delta;
    if (this.wanderTimer <= 0) this.pickNewWanderDir();
  }

  private tickTask(task: NpcTask, delta: number): void {
    switch (task.type) {
      case 'anchor':
        this.tickAnchorTask(task, delta);
        return;
      case 'patrol':
        this.tickPatrolTask(task, delta);
        return;
      case 'sit':
        this.tickSitTask(task);
        return;
    }
  }

  private tickAnchorTask(task: NpcAnchorTask, delta: number): void {
    this.tickWander(delta, task, task.radius);
  }

  private tickPatrolTask(task: NpcPatrolTask, delta: number): void {
    if (task.waypoints.length === 0) {
      this.stopMoving();
      return;
    }

    if (this.patrolPauseTimer > 0) {
      this.patrolPauseTimer -= delta;
      this.stopMoving();
      return;
    }

    const target = task.waypoints[this.patrolIndex % task.waypoints.length];
    const arrived = this.moveToward(target, 8);
    if (!arrived) return;

    this.patrolIndex = (this.patrolIndex + 1) % task.waypoints.length;
    this.patrolPauseTimer = 1000 + Math.random() * 1000;
  }

  private tickSitTask(task: NpcSitTask): void {
    this.moveToward(task, 4);
  }

  private moveToward(target: WorldPoint, stopDistance: number): boolean {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= stopDistance || dist === 0) {
      this.stopMoving();
      return true;
    }

    this.wanderVx = (dx / dist) * this.walkSpeed;
    this.wanderVy = (dy / dist) * this.walkSpeed;
    return false;
  }

  private stopMoving(): void {
    this.wanderVx = 0;
    this.wanderVy = 0;
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
