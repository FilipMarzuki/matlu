/**
 * HumanoidNPC — a state-driven NPC built on a PixelLab/Aseprite spritesheet.
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
 * in above the NPC. Pressing T (keyboard) or tapping the sprite fires the
 * `'npc-interact'` scene event:
 *
 *   scene.events.on('npc-interact', ({ name, line }) => { … });
 *
 * Dialog cycles through `dialogLines` round-robin.
 */

import * as Phaser from 'phaser';

export type NpcPersonality = 'friendly' | 'fearful' | 'suspicious' | 'brave';
export type NpcState = 'idle' | 'wander' | 'task' | 'interact' | 'flee' | 'investigate';

interface Vec2 {
  x: number;
  y: number;
}

type RoutineState = 'idle' | 'task';

interface PersonalityTuning {
  hearingRadius: number;
  threatMemoryMs: number;
  fleeSpeedMultiplier: number;
}

const PERSONALITY_TUNING: Record<NpcPersonality, PersonalityTuning> = {
  friendly: {
    hearingRadius: 250,
    threatMemoryMs: 5000,
    fleeSpeedMultiplier: 1.4,
  },
  fearful: {
    hearingRadius: 400,
    threatMemoryMs: 8000,
    fleeSpeedMultiplier: 1.55,
  },
  suspicious: {
    hearingRadius: 180,
    threatMemoryMs: 3000,
    fleeSpeedMultiplier: 1.35,
  },
  brave: {
    hearingRadius: 300,
    threatMemoryMs: 5000,
    fleeSpeedMultiplier: 1.4,
  },
};

const INVESTIGATE_TIMEOUT_MS = 8000;
const INVESTIGATE_REACH_DISTANCE = 60;
const ARRIVAL_DISTANCE = 6;
const MIN_SPEED_FOR_WALK_ANIM = 5;

const IS_DEV: boolean = import.meta.env.DEV;

// ── Direction helpers ─────────────────────────────────────────────────────────
// Same 8-sector mapping used by CombatEntity — left-side dirs mirror right-side.
type CanonDir = 'south' | 'south-east' | 'east' | 'north-east' | 'north';

const DIR_MAP: Record<number, [CanonDir, boolean]> = {
  0: ['east', false],
  1: ['south-east', false],
  2: ['south', false],
  3: ['south-east', true], // SW → flip SE
  4: ['east', true], // W  → flip E
  '-4': ['east', true],
  '-3': ['north-east', true], // NW → flip NE
  '-2': ['north', false],
  '-1': ['north-east', false],
};

function resolveDir(vx: number, vy: number): [CanonDir, boolean] {
  const angle = Math.atan2(vy, vx);
  const sector = Math.round(angle / (Math.PI / 4));
  return DIR_MAP[sector] ?? ['south', false];
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
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
  /** How long (ms) the NPC may remain in wander before pausing again. */
  wanderIntervalMin?: number;
  wanderIntervalMax?: number;
  /** Personality controls hearing radius and flee profile. Default: friendly. */
  personality?: NpcPersonality;
  /** Optional explicit hearing radius override. */
  hearingRadius?: number;
  /** Home radius for random wandering around spawn point. Default: 96. */
  homeRadius?: number;
  /** Optional task anchor for TASK state. */
  taskAnchor?: Vec2;
}

export interface HumanoidNPCTickOptions {
  /** Optional sound-event origin from a world blackboard update this frame. */
  soundEventOrigin?: Vec2;
  /** Whether an active threat is still near this NPC this frame. */
  hasLiveThreatNearby?: boolean;
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class HumanoidNPC extends Phaser.Physics.Arcade.Sprite {
  private readonly npcName: string;
  private readonly dialogLines: string[];
  private readonly walkSpeed: number;
  private readonly interactRadius: number;
  private readonly wanderIntervalMin: number;
  private readonly wanderIntervalMax: number;
  private readonly homeRadius: number;
  private readonly personality: NpcPersonality;
  private readonly hearingRadius: number;

  // Home + routine anchors
  private readonly homeX: number;
  private readonly homeY: number;
  private taskAnchor: Vec2 | null;

  // State machine
  private npcState: NpcState = 'idle';
  private stateTimer = 0;
  private resumeStateAfterInterrupt: RoutineState = 'idle';
  private wanderTarget: Vec2 | null = null;
  private threatOrigin: Vec2 | null = null;
  private threatMemoryMs = 0;
  private investigateTarget: Vec2 | null = null;

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

    this.npcName = config.name;
    this.dialogLines = config.dialogLines;
    this.walkSpeed = config.walkSpeed ?? 48;
    this.interactRadius = config.interactRadius ?? 80;
    this.wanderIntervalMin = config.wanderIntervalMin ?? 1200;
    this.wanderIntervalMax = config.wanderIntervalMax ?? 3200;
    this.homeRadius = config.homeRadius ?? 96;

    this.personality = config.personality ?? 'friendly';
    this.hearingRadius = config.hearingRadius ?? PERSONALITY_TUNING[this.personality].hearingRadius;

    this.homeX = x;
    this.homeY = y;
    this.taskAnchor = config.taskAnchor ?? null;

    // Anchor at feet for natural y-sorting with the hero
    this.setOrigin(0.5, 1);
    this.setDepth(y);

    // Physics body: narrow foot hitbox so the NPC doesn't block paths
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(12, 10);
    body.setOffset(10, 22); // centred on feet in a ~32px canvas
    body.setCollideWorldBounds(true);

    // Keyboard interact key — T for Talk (avoids conflicts with WASD/Space/E/F/G)
    this.tKey = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.T) ?? null;

    // Tap-to-interact (mobile + mouse)
    this.setInteractive({ useHandCursor: true });
    this.on('pointerup', () => this.tryTriggerDialog());

    // "[T] Talk" prompt — fades in when player is close
    this.promptText = scene
      .add.text(x, y - 40, '[T] Talk', {
        fontSize: '9px',
        color: '#ffe066',
        fontFamily: 'monospace',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setAlpha(0)
      .setDepth(9999);

    this.transition(this.taskAnchor ? 'task' : 'idle');
  }

  // ── Main update — call from scene.update() ────────────────────────────────

  /**
   * @param delta    Frame delta from scene.update() (ms)
   * @param playerX  Current player world-x
   * @param playerY  Current player world-y
   * @param options  Optional awareness inputs from world systems
   */
  tick(
    delta: number,
    playerX: number,
    playerY: number,
    options: HumanoidNPCTickOptions = {},
  ): void {
    if (options.soundEventOrigin) {
      this.notifySoundEvent(options.soundEventOrigin);
    }

    if (options.hasLiveThreatNearby && this.npcState === 'flee') {
      this.threatMemoryMs = this.getThreatMemoryMs();
    }

    const inRange = this.updateInteractionState(playerX, playerY);

    this.stateTimer = Math.max(0, this.stateTimer - delta);
    this.tickCurrentState(delta);

    this.updatePrompt(inRange);

    // Depth refresh keeps y-sort stable with the player and other entities.
    this.setDepth(this.y);
    if (this.promptText) {
      this.promptText.setDepth(this.y + 1);
      this.promptText.setPosition(this.x, this.y - 40);
    }

    this.updateAnimation();
  }

  /** Public API used by world-awareness systems to broadcast threat sounds. */
  notifySoundEvent(origin: Vec2): void {
    if (!this.canHear(origin)) {
      return;
    }

    this.cacheRoutineStateForInterrupt();

    const shouldForceFlee = this.npcState === 'interact';
    if (this.personality === 'brave' && !shouldForceFlee) {
      this.investigateTarget = { x: origin.x, y: origin.y };
      this.transition('investigate');
      return;
    }

    this.threatOrigin = { x: origin.x, y: origin.y };
    this.threatMemoryMs = this.getThreatMemoryMs();
    this.transition('flee');
  }

  /** Current hearing radius in px after personality/override resolution. */
  getHearingRadius(): number {
    return this.hearingRadius;
  }

  /** Updates (or clears) the TASK anchor. */
  setTaskAnchor(anchor: Vec2 | null): void {
    this.taskAnchor = anchor ? { x: anchor.x, y: anchor.y } : null;

    if (this.npcState === 'task' && !this.taskAnchor) {
      this.transition('idle');
    }
  }

  // ── State machine core ─────────────────────────────────────────────────────

  private transition(next: NpcState): void {
    if (this.npcState === next) {
      return;
    }

    const prev = this.npcState;
    this.npcState = next;

    if (IS_DEV) {
      console.debug(`[HumanoidNPC:${this.npcName}] ${prev} -> ${next}`);
    }

    switch (next) {
      case 'idle': {
        this.clearVelocity();
        this.wanderTarget = null;
        this.stateTimer = randomBetween(320, 950);
        break;
      }
      case 'wander': {
        this.wanderTarget = this.pickRandomWanderTarget();
        this.stateTimer = randomBetween(this.wanderIntervalMin, this.wanderIntervalMax);
        break;
      }
      case 'task': {
        this.stateTimer = randomBetween(900, 1800);
        break;
      }
      case 'interact': {
        this.clearVelocity();
        this.stateTimer = 0;
        break;
      }
      case 'flee': {
        this.investigateTarget = null;
        this.wanderTarget = null;
        this.threatMemoryMs = this.getThreatMemoryMs();
        this.stateTimer = 0;
        break;
      }
      case 'investigate': {
        this.wanderTarget = null;
        this.stateTimer = INVESTIGATE_TIMEOUT_MS;
        break;
      }
      default: {
        const exhaustiveCheck: never = next;
        throw new Error(`Unhandled NPC state transition: ${String(exhaustiveCheck)}`);
      }
    }
  }

  private tickCurrentState(delta: number): void {
    switch (this.npcState) {
      case 'idle':
        this.tickIdle();
        break;
      case 'wander':
        this.tickWander();
        break;
      case 'task':
        this.tickTask();
        break;
      case 'interact':
        this.tickInteract();
        break;
      case 'flee':
        this.tickFlee(delta);
        break;
      case 'investigate':
        this.tickInvestigate();
        break;
      default: {
        const exhaustiveCheck: never = this.npcState;
        throw new Error(`Unhandled NPC tick state: ${String(exhaustiveCheck)}`);
      }
    }
  }

  private tickIdle(): void {
    this.clearVelocity();
    if (this.stateTimer <= 0) {
      this.transition('wander');
    }
  }

  private tickWander(): void {
    if (!this.wanderTarget) {
      this.wanderTarget = this.pickRandomWanderTarget();
    }

    if (!this.wanderTarget) {
      this.transition('idle');
      return;
    }

    const reachedTarget = this.moveTowards(this.wanderTarget, this.walkSpeed, ARRIVAL_DISTANCE);
    if (reachedTarget || this.stateTimer <= 0) {
      this.transition('idle');
    }
  }

  private tickTask(): void {
    if (!this.taskAnchor) {
      this.transition('idle');
      return;
    }

    const atAnchor = this.moveTowards(this.taskAnchor, this.walkSpeed * 0.8, ARRIVAL_DISTANCE);
    if (atAnchor) {
      this.clearVelocity();
      if (this.stateTimer <= 0) {
        this.stateTimer = randomBetween(900, 1800);
      }
    }
  }

  private tickInteract(): void {
    this.clearVelocity();
  }

  private tickFlee(delta: number): void {
    if (!this.threatOrigin) {
      this.transition('idle');
      return;
    }

    const fleeVector = {
      x: this.x - this.threatOrigin.x,
      y: this.y - this.threatOrigin.y,
    };

    // If the source and NPC overlap exactly, pick a random push direction to avoid
    // zero-length normalization that would trap the NPC in-place.
    if (fleeVector.x === 0 && fleeVector.y === 0) {
      const angle = Math.random() * Math.PI * 2;
      fleeVector.x = Math.cos(angle);
      fleeVector.y = Math.sin(angle);
    }

    const tuning = PERSONALITY_TUNING[this.personality];
    const speed = this.walkSpeed * tuning.fleeSpeedMultiplier;
    this.applyVelocityFromVector(fleeVector, speed);

    this.threatMemoryMs = Math.max(0, this.threatMemoryMs - delta);
    if (this.threatMemoryMs <= 0) {
      this.threatOrigin = null;
      this.transition('idle');
    }
  }

  private tickInvestigate(): void {
    if (!this.investigateTarget) {
      this.transition(this.getRoutineReturnState());
      return;
    }

    const reached = this.moveTowards(
      this.investigateTarget,
      this.walkSpeed,
      INVESTIGATE_REACH_DISTANCE,
    );

    if (reached || this.stateTimer <= 0) {
      this.investigateTarget = null;
      this.transition(this.getRoutineReturnState());
    }
  }

  // ── Interaction + awareness helpers ────────────────────────────────────────

  private updateInteractionState(playerX: number, playerY: number): boolean {
    const playerDistance = Phaser.Math.Distance.Between(playerX, playerY, this.x, this.y);
    const canInteractNow = this.canInteract();
    const inRange = canInteractNow && playerDistance <= this.interactRadius;

    if (inRange && this.npcState !== 'interact' && this.canEnterInteractFromCurrentState()) {
      this.resumeStateAfterInterrupt = this.npcState === 'task' ? 'task' : 'idle';
      this.transition('interact');
    } else if (!inRange && this.npcState === 'interact') {
      this.transition(this.resumeStateAfterInterrupt);
    }

    if (inRange && this.npcState === 'interact' && this.tKey && Phaser.Input.Keyboard.JustDown(this.tKey)) {
      this.triggerDialog();
    }

    return inRange;
  }

  private canInteract(): boolean {
    return this.npcState !== 'flee' && this.npcState !== 'investigate';
  }

  private canEnterInteractFromCurrentState(): boolean {
    return this.npcState === 'idle' || this.npcState === 'wander' || this.npcState === 'task';
  }

  private canHear(origin: Vec2): boolean {
    const distance = Phaser.Math.Distance.Between(this.x, this.y, origin.x, origin.y);
    return distance <= this.hearingRadius;
  }

  private cacheRoutineStateForInterrupt(): void {
    this.resumeStateAfterInterrupt = this.npcState === 'task' ? 'task' : 'idle';
  }

  private getRoutineReturnState(): RoutineState {
    if (this.resumeStateAfterInterrupt === 'task' && this.taskAnchor) {
      return 'task';
    }

    return 'idle';
  }

  private getThreatMemoryMs(): number {
    return PERSONALITY_TUNING[this.personality].threatMemoryMs;
  }

  private tryTriggerDialog(): void {
    if (!this.canInteract()) {
      return;
    }

    this.triggerDialog();
  }

  private updatePrompt(inRange: boolean): void {
    if (!this.promptText) {
      return;
    }

    const targetAlpha = inRange ? 1 : 0;
    this.promptText.setAlpha(Phaser.Math.Linear(this.promptText.alpha, targetAlpha, 0.12));
  }

  // ── Movement + animation helpers ───────────────────────────────────────────

  private moveTowards(target: Vec2, speed: number, arrivalDistance: number): boolean {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= arrivalDistance) {
      this.clearVelocity();
      return true;
    }

    this.applyVelocityFromVector({ x: dx, y: dy }, speed);
    return false;
  }

  private applyVelocityFromVector(direction: Vec2, speed: number): void {
    const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y) || 1;
    const vx = (direction.x / length) * speed;
    const vy = (direction.y / length) * speed;

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(vx, vy);
  }

  private clearVelocity(): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
  }

  private pickRandomWanderTarget(): Vec2 {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * this.homeRadius;

    return {
      x: this.homeX + Math.cos(angle) * radius,
      y: this.homeY + Math.sin(angle) * radius,
    };
  }

  private updateAnimation(): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    const vx = body.velocity.x;
    const vy = body.velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);

    if (speed > MIN_SPEED_FOR_WALK_ANIM) {
      const [dir, flip] = resolveDir(vx, vy);
      this.facingDir = dir;
      this.facingFlip = flip;
    }

    const animState = speed > MIN_SPEED_FOR_WALK_ANIM ? 'walk' : 'idle';
    const animKey = `${this.texture.key}_${animState}_${this.facingDir}`;

    if (animKey !== this.currentAnimKey) {
      this.play(animKey, true);
      this.currentAnimKey = animKey;
    }

    this.setFlipX(this.facingFlip);
  }

  private triggerDialog(): void {
    if (this.dialogLines.length === 0) {
      return;
    }

    const line = this.dialogLines[this.dialogIndex % this.dialogLines.length];
    this.dialogIndex += 1;
    this.scene.events.emit('npc-interact', { name: this.npcName, line });
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  override destroy(fromScene?: boolean): void {
    this.promptText?.destroy();
    this.promptText = null;
    super.destroy(fromScene);
  }
}
