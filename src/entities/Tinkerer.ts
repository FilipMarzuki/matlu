import * as Phaser from 'phaser';
import { CombatEntity, AcidLancer, ParasiteFlyer } from './CombatEntity';
import { Projectile, Damageable } from './Projectile';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
} from '../ai/BehaviorTree';
import { EarthHero } from './EarthHero';
import { aStarPath, TilePoint } from '../ai/AStarGrid';
import { ExplorationMap } from '../ai/ExplorationMap';
import { worldToArenaIso, ISO_TILE_W, ISO_TILE_H } from '../lib/IsoTransform';

// ── Magazine constants ─────────────────────────────────────────────────────────

/** Total shots per magazine. */
const MAG_SIZE = 12;

/**
 * First N shots in a magazine fire as a rapid burst.
 * Shots beyond this index switch to irregular semi-auto.
 */
const BURST_SIZE = 3;

/** Cooldown between shots inside the burst (ms). Halved when standing still. */
const BURST_CD = 130;

/** Semi-auto shot cooldown range (ms). Randomised per shot for irregular feel. */
const SLOW_CD_MIN = 480;
const SLOW_CD_MAX = 780;

/** Full reload duration after emptying the magazine (ms). */
const RELOAD_MS = 1400;

/**
 * Body speed (px/s) below which the hero is considered "planted".
 * While planted: fire rate doubled, damage +50%.
 */
const STILL_THRESHOLD   = 15;
const STILL_DAMAGE_MULT = 1.5;

// ── Proximity Mine ─────────────────────────────────────────────────────────────

/** ms before the mine arms and becomes triggerable. */
const MINE_ARM_MS = 600;

/** px — enemy within this radius triggers detonation. */
const MINE_TRIGGER_R = 28;

/** px — AoE damage radius on detonation. */
const MINE_AOE_R = 64;

/** Flat damage dealt to each enemy inside the AoE. */
const MINE_DAMAGE = 45;

/** ms between consecutive mine deploys. */
const MINE_COOLDOWN_MS = 4000;

/** Maximum mines active simultaneously. */
const MINE_MAX = 3;

/**
 * ProximityMine — a deployable gadget placed by the Tinkerer.
 *
 * Arms after MINE_ARM_MS (gray → pulsing orange). Once armed it checks for
 * enemies within MINE_TRIGGER_R each frame; on contact it detonates, dealing
 * MINE_DAMAGE to all enemies within MINE_AOE_R with an expanding flash as VFX.
 *
 * This is a plain class (not a Phaser.GameObjects child) because it doesn't
 * need physics — the Tinkerer owner ticks it manually in updateBehaviour().
 */
class ProximityMine {
  readonly x: number;
  readonly y: number;

  private armTimer = MINE_ARM_MS;

  /** True once the arming delay has elapsed. */
  armed = false;

  /** True after detonation — prevents double-firing. */
  detonated = false;

  private readonly circle: Phaser.GameObjects.Arc;
  private pulseTween?: Phaser.Tweens.Tween;

  constructor(private readonly scene: Phaser.Scene, x: number, y: number) {
    this.x      = x;
    this.y      = y;
    // Gray while arming so the player can distinguish live from placed
    this.circle = scene.add.arc(x, y, 6, 0, 360, false, 0x888888);
    this.circle.setDepth(7).setStrokeStyle(1.5, 0xcccccc);
  }

  tick(delta: number): void {
    if (this.detonated || this.armed) return;
    this.armTimer -= delta;
    if (this.armTimer <= 0) this.arm();
  }

  private arm(): void {
    this.armed = true;
    this.circle.setFillStyle(0xff5500);
    // Pulse communicates "armed and dangerous" without any text
    this.pulseTween = this.scene.tweens.add({
      targets:  this.circle,
      scaleX:   1.5,
      scaleY:   1.5,
      alpha:    0.55,
      yoyo:     true,
      repeat:   -1,
      duration: 380,
      ease:     'Sine.easeInOut',
    });
  }

  /** Returns true when an alive enemy is within trigger radius. */
  checkTrigger(opponents: CombatEntity[]): boolean {
    if (!this.armed || this.detonated) return false;
    for (const e of opponents) {
      if (e.isAlive && Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y) < MINE_TRIGGER_R) {
        return true;
      }
    }
    return false;
  }

  /**
   * Damage all enemies in the AoE and play an expanding-ring flash.
   *
   * Emits `'mine-detonated'` on the scene event bus so the arena can add
   * camera shake without the mine coupling directly to the scene hierarchy.
   */
  detonate(opponents: CombatEntity[]): void {
    if (this.detonated) return;
    this.detonated = true;
    this.pulseTween?.stop();

    for (const e of opponents) {
      if (e.isAlive && Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y) < MINE_AOE_R) {
        e.takeDamage(MINE_DAMAGE);
      }
    }

    // Expanding flash: starts at radius 10, expands to ~AOE_R then fades out
    const flash = this.scene.add.arc(this.x, this.y, 10, 0, 360, false, 0xff7700);
    flash.setDepth(10).setAlpha(0.9);
    this.scene.tweens.add({
      targets:  flash,
      scaleX:   MINE_AOE_R / 5,
      scaleY:   MINE_AOE_R / 5,
      alpha:    0,
      duration: 200,
      ease:     'Cubic.easeOut',
      onComplete: () => { if (flash.active) flash.destroy(); },
    });

    this.scene.events.emit('mine-detonated', this.x, this.y);
    if (this.circle.active) this.circle.destroy();
  }

  /** Remove visuals without detonating (used on hero death / scene reset). */
  dispose(): void {
    this.pulseTween?.stop();
    if (this.circle.active) this.circle.destroy();
  }
}

/**
 * Tinkerer — post-apocalyptic mechanic hero. Melee bash + pistol + dash.
 *
 * ## Magazine system
 * Shots 1–3 are a rapid burst (130 ms apart); shots 4–12 are irregular
 * semi-auto (480–780 ms). Standing still doubles fire rate and adds +50%
 * damage. After the 12th shot a 1.4 s reload begins — melee and dash still
 * work during reload. The same magazine state applies in both player-controlled
 * and AI-controlled modes via the canShoot / onShotFired hooks on CombatEntity.
 *
 * ## Dash
 * Peak speed 5× with linear velocity decay over 350 ms (slide/roll feel).
 *
 * ## Melee
 * 120° arc swipe via CombatEntity.tryMelee() — hits all targets in the cone
 * and applies strong knockback (onHitByMelee).
 */
export class Tinkerer extends EarthHero {
  readonly name = 'Tinkerer';
  readonly signatureCooldownMs = 8000;

  // ── Magazine state ───────────────────────────────────────────────────────────
  private magShots    = MAG_SIZE;
  private isReloading = false;
  private reloadTimer = 0;
  private shotInBurst = 0; // shots fired this magazine

  // ── Gadget: Proximity Mine ────────────────────────────────────────────────────
  private activeMines: ProximityMine[] = [];
  /** Counts down from MINE_COOLDOWN_MS after each deploy; 0 = ready. */
  private gadgetTimer = 0;

  // ── Exploration state (dungeon AI) ──────────────────────────────────────────
  private explorationMap: ExplorationMap | null = null;
  private dungeonGrid: ArrayLike<number> | null = null;
  private dungeonCols = 0;
  private dungeonRows = 0;
  private cellSize = 16;
  private exitTile: { x: number; y: number } | null = null;
  private exitFound = false;
  private currentPath: TilePoint[] | null = null;
  private pathIdx = 0;
  /** Sight radius in tiles — how far the hero "sees" for exploration purposes. */
  private readonly SIGHT_R = 5;
  /** Current exploration target tile — hero commits to this until it's explored. */
  private exploreTarget: { x: number; y: number } | null = null;
  /** Which BT node owns the current path — prevents cross-node path confusion. */
  private pathOwner: 'explore' | 'exit' | 'hole' | null = null;
  /** Debug: golden diamond marker showing the hero's current target tile. */
  private targetMarker: Phaser.GameObjects.Graphics | null = null;
  /** Debug: purple diamond marker showing the hero's current combat target. */
  private combatMarker: Phaser.GameObjects.Graphics | null = null;

  /** Expose exploration state for debug visualization. */
  getExplorationMap(): ExplorationMap | null { return this.explorationMap; }

  /** Update the floating gold diamond over the hero's current target tile. */
  private updateTargetMarker(): void {
    // Determine target tile based on which BT node owns the path.
    let targetTile: { x: number; y: number } | null = null;
    if (this.pathOwner === 'explore' && this.exploreTarget) {
      targetTile = this.exploreTarget;
    } else if (this.pathOwner === 'exit' && this.exitTile) {
      targetTile = this.exitTile;
    } else if (this.pathOwner === 'hole' && this.currentPath && this.currentPath.length > 0) {
      targetTile = this.currentPath[this.currentPath.length - 1];
    }

    if (!targetTile) {
      if (this.targetMarker) { this.targetMarker.setVisible(false); }
      return;
    }

    const { x: isoX, y: isoY } = worldToArenaIso(
      (targetTile.x + 0.5) * this.cellSize,
      (targetTile.y + 0.5) * this.cellSize,
    );
    const hw = ISO_TILE_W / 2;
    const hh = ISO_TILE_H / 2;

    if (!this.targetMarker) {
      this.targetMarker = this.scene.add.graphics().setDepth(250);
    }
    this.targetMarker.setVisible(true);
    this.targetMarker.clear();
    this.targetMarker.fillStyle(0xffdd00, 0.5);
    this.targetMarker.lineStyle(2, 0xffdd00, 1);
    // Float 6px above the tile.
    const floatY = isoY - 6 + Math.sin(this.scene.time.now / 300) * 3;
    this.targetMarker.beginPath();
    this.targetMarker.moveTo(isoX,      floatY);
    this.targetMarker.lineTo(isoX + hw, floatY + hh);
    this.targetMarker.lineTo(isoX,      floatY + ISO_TILE_H);
    this.targetMarker.lineTo(isoX - hw, floatY + hh);
    this.targetMarker.closePath();
    this.targetMarker.fillPath();
    this.targetMarker.strokePath();

    // ── Purple diamond on current combat target (enemy or BurrowHole) ──────
    const combatTarget = this.findTargetOpponent();
    if (combatTarget && this.canSeeTarget) {
      const cIso = worldToArenaIso(combatTarget._wx, combatTarget._wy);
      if (!this.combatMarker) {
        this.combatMarker = this.scene.add.graphics().setDepth(251);
      }
      this.combatMarker.setVisible(true);
      this.combatMarker.clear();
      this.combatMarker.fillStyle(0xaa44ff, 0.5);
      this.combatMarker.lineStyle(2, 0xaa44ff, 1);
      const cFloatY = cIso.y - 6 + Math.sin(this.scene.time.now / 250) * 3;
      this.combatMarker.beginPath();
      this.combatMarker.moveTo(cIso.x,      cFloatY);
      this.combatMarker.lineTo(cIso.x + hw, cFloatY + hh);
      this.combatMarker.lineTo(cIso.x,      cFloatY + ISO_TILE_H);
      this.combatMarker.lineTo(cIso.x - hw, cFloatY + hh);
      this.combatMarker.closePath();
      this.combatMarker.fillPath();
      this.combatMarker.strokePath();
    } else if (this.combatMarker) {
      this.combatMarker.setVisible(false);
    }
  }

  /** Total cooldown duration — read by the arena HUD to display remaining time. */
  readonly gadgetCooldownMs = MINE_COOLDOWN_MS;

  get isGadgetReady(): boolean { return this.gadgetTimer <= 0; }
  get gadgetCooldownRemaining(): number { return this.gadgetTimer; }

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:               100,
      speed:               45,
      aggroRadius:         400,
      proximityRadius:     250,  // detect enemies in adjacent rooms; projectiles pass through walls (wallRects=[])
      darkvision:          1,    // hero always targets at full aggroRadius — lighting should not impair player targeting
      attackDamage:        15,
      color:               0x996633,
      meleeRange:          36,
      attackCooldownMs:    700,
      projectileDamage:    18,
      projectileSpeed:     420,
      projectileColor:     0xfff8b0,
      dashSpeedMultiplier: 5,    // higher peak; linear ease-out averages ~2.5×
      dashDurationMs:      350,  // longer window = slide/roll feel
      spriteKey:           'tinkerer',
    });
  }

  // ── CombatEntity hooks ────────────────────────────────────────────────────────

  protected override canShoot(): boolean {
    return !this.isReloading && this.magShots > 0;
  }

  /**
   * Walk toward the next waypoint in currentPath using world-space coords.
   * Sets velocity directly on the physics body to avoid the iso-space
   * mismatch in ctx.moveToward().
   */
  /** Frames the hero has been near-stationary while following a path. */
  private stuckFrames = 0;

  private followPath(): 'running' | 'success' {
    if (!this.currentPath || this.pathIdx >= this.currentPath.length) return 'success';
    const wp = this.currentPath[this.pathIdx];
    const wpx = (wp.x + 0.5) * this.cellSize;
    const wpy = (wp.y + 0.5) * this.cellSize;
    const dx = wpx - this._wx;
    const dy = wpy - this._wy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Generous arrival threshold — wall collisions can push the hero
    // slightly off the exact waypoint center.
    if (dist < 14) {
      this.pathIdx++;
      this.stuckFrames = 0;
      if (this.pathIdx >= this.currentPath.length) return 'success';
      return this.followPath();
    }

    // Stuck detection — if velocity is near zero for 15+ frames, abandon
    // the path and mark the target tile as explored so BFS picks a different
    // destination next time (prevents stuck loops on unreachable tiles).
    const body = this.getPhysicsBody();
    if (body) {
      const speed = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
      if (speed < 8) {
        this.stuckFrames++;
        if (this.stuckFrames > 15) {
          // Mark the target tile as explored to avoid retargeting it.
          if (this.exploreTarget && this.explorationMap) {
            this.explorationMap.markExplored(this.exploreTarget.x, this.exploreTarget.y);
          }
          this.exploreTarget = null;
          this.currentPath = null;
          this.stuckFrames = 0;
          return 'success';
        }
      } else {
        this.stuckFrames = 0;
      }
      body.setVelocity((dx / dist) * this.speed, (dy / dist) * this.speed);
    }
    return 'running';
  }

  /** Advance magazine when the AI fires via ctx.shootAt. */
  protected override onShotFired(): void {
    this.advanceMag();
  }

  // ── Exploration API (called by CombatArenaScene after spawn) ────────────────

  /**
   * Give the hero the dungeon grid and exit location so it can explore
   * autonomously when not player-controlled.
   */
  initExploration(
    grid: ArrayLike<number>, cols: number, rows: number,
    cellSize: number, exitTileX: number, exitTileY: number,
  ): void {
    this.dungeonGrid = grid;
    this.dungeonCols = cols;
    this.dungeonRows = rows;
    this.cellSize = cellSize;
    this.explorationMap = new ExplorationMap(cols, rows);
    this.exitTile = { x: exitTileX, y: exitTileY };
    this.exitFound = false;
    this.currentPath = null;
  }

  // ── Magazine helpers ──────────────────────────────────────────────────────────

  private advanceMag(): void {
    this.magShots--;
    this.shotInBurst++;
    if (this.magShots <= 0) {
      this.isReloading = true;
      this.reloadTimer = RELOAD_MS;
      this.shotInBurst = 0;
      // Notify the scene to play the reload SFX — audio stays scene-side.
      this.scene.events.emit('hero-reload');
    }
  }

  /** Returns the cooldown (ms) for the next shot based on burst position + stance. */
  private nextCooldown(isStill: boolean): number {
    const base = this.shotInBurst < BURST_SIZE
      ? BURST_CD
      : SLOW_CD_MIN + Math.random() * (SLOW_CD_MAX - SLOW_CD_MIN);
    return isStill ? base * 0.5 : base;
  }

  // ── Frame tick ────────────────────────────────────────────────────────────────

  override updateBehaviour(delta: number): void {
    if (this.isReloading) {
      this.reloadTimer = Math.max(0, this.reloadTimer - delta);
      if (this.reloadTimer === 0) {
        this.isReloading = false;
        this.magShots    = MAG_SIZE;
        this.shotInBurst = 0;
      }
    }

    // ── Gadget cooldown ───────────────────────────────────────────────────────
    if (this.gadgetTimer > 0) this.gadgetTimer = Math.max(0, this.gadgetTimer - delta);

    // ── Tick mines and detonate those that triggered ──────────────────────────
    // Two-pass: tick first (arm transitions), then check triggers so a mine
    // that just armed this frame can still fire in the same tick.
    const toDetonate: ProximityMine[] = [];
    for (const mine of this.activeMines) {
      mine.tick(delta);
      if (mine.checkTrigger(this.opponents)) toDetonate.push(mine);
    }
    for (const mine of toDetonate) mine.detonate(this.opponents);
    if (toDetonate.length > 0) {
      this.activeMines = this.activeMines.filter(m => !toDetonate.includes(m));
    }

    // Reveal tiles around the hero each tick for exploration AI.
    if (this.explorationMap && this.dungeonGrid) {
      const tx = Math.floor(this._wx / this.cellSize);
      const ty = Math.floor(this._wy / this.cellSize);
      this.explorationMap.reveal(tx, ty, this.SIGHT_R, this.dungeonGrid);
      if (this.exitTile && this.explorationMap.isExplored(this.exitTile.x, this.exitTile.y)) {
        this.exitFound = true;
      }
    }

    // Debug: update target marker diamond.
    this.updateTargetMarker();

    // Invalidate exploration path only when the hero can actually SEE an enemy
    // (canSeeTarget is set by updateSightLine). This prevents constant replanning
    // when enemies are nearby but behind walls.
    if (this.canSeeTarget && this.currentPath) {
      this.currentPath = null;
      this.stuckFrames = 0;
    }

    super.updateBehaviour(delta);
  }

  // ── Player ranged ─────────────────────────────────────────────────────────────

  /**
   * Magazine-aware ranged shot for player-controlled mode.
   *
   * Replaces the base attackCooldownMs with a per-shot delay that varies by
   * position in the burst. When planted (near-zero velocity) the cooldown is
   * halved and damage increases by 50%.
   */
  override tryRanged(): void {
    if (this.attackTimer > 0 || !this.projectileDamage || !this.canShoot()) return;

    const target = this.findNearestLivingOpponent();
    if (!target) return;

    const body    = this.getPhysicsBody();
    const isStill = body
      ? Math.hypot(body.velocity.x, body.velocity.y) < STILL_THRESHOLD
      : false;
    const damage  = isStill
      ? Math.round(this.projectileDamage * STILL_DAMAGE_MULT)
      : this.projectileDamage;

    const angle = Math.atan2(target.y - this.y, target.x - this.x);
    const p = new Projectile(
      this.scene, this.x, this.y, angle,
      this.projectileSpeed, damage,
      this.projectileColor,
      (this.opponents as unknown as Damageable[]).concat(this.extraDamageables),
    );
    this.scene.events.emit('projectile-spawned', p);
    this.attackAnimId    = 'attack_ranged';
    this.attackAnimTimer = this.attackAnimDuration;
    this.scene.events.emit('hero-shot', this.x, this.y, angle);

    this.attackTimer = this.nextCooldown(isStill);
    this.advanceMag();
  }

  // ── Signature ─────────────────────────────────────────────────────────────────

  useSignature(): void {
    const target = this.findNearestLivingOpponent();
    if (!target) return;
    this.tryDash(target.x - this.x, target.y - this.y);
  }

  // ── Gadget ────────────────────────────────────────────────────────────────────

  /**
   * Deploy a proximity mine at the hero's current position.
   *
   * No-ops if on cooldown or MINE_MAX mines are already active — safe to call
   * every frame from player-input code without additional guards at the call site.
   */
  deployMine(): void {
    if (this.gadgetTimer > 0 || this.activeMines.length >= MINE_MAX) return;
    this.activeMines.push(new ProximityMine(this.scene, this.x, this.y));
    this.gadgetTimer = MINE_COOLDOWN_MS;
  }

  /** Dispose all active mine visuals without detonating (called on hero death reset). */
  destroyMines(): void {
    for (const m of this.activeMines) m.dispose();
    this.activeMines = [];
  }

  protected override findTargetOpponent(): CombatEntity | null {
    const rangedThreats = this.opponents.filter(
      o => o.isAlive && (o instanceof AcidLancer || o instanceof ParasiteFlyer),
    );
    if (rangedThreats.length > 0) {
      return rangedThreats.reduce((best, o) =>
        Phaser.Math.Distance.Between(this._wx, this._wy, o._wx, o._wy) <
        Phaser.Math.Distance.Between(this._wx, this._wy, best._wx, best._wy) ? o : best,
      );
    }
    return this.findNearestLivingOpponent();
  }

  // ── Behavior tree ─────────────────────────────────────────────────────────────

  protected buildTree(): BtNode {
    const MELEE_R    = this.meleeRange;
    const DASH_MIN   = MELEE_R;
    const DASH_MAX   = 300;
    const RANGED_MIN = 60;
    const RANGED_MAX = 230;
    const SWARM_R    = 130;
    const SWARM_CAP  = 4;

    const swarmPressure = (cx: number, cy: number): number =>
      this.opponents.filter(
        o => o.isAlive && Phaser.Math.Distance.Between(cx, cy, o._wx, o._wy) < SWARM_R,
      ).length;

    return new BtSelector([

      // 1. Escape dash when overwhelmed + low HP
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            return swarmPressure(ctx.x, ctx.y) >= SWARM_CAP && ctx.hp < ctx.maxHp * 0.75;
          }),
          new BtAction(ctx => {
            const near = this.opponents.filter(
              o => o.isAlive && Phaser.Math.Distance.Between(ctx.x, ctx.y, o._wx, o._wy) < SWARM_R,
            );
            const avgX = near.reduce((s, o) => s + o._wx, 0) / near.length;
            const avgY = near.reduce((s, o) => s + o._wy, 0) / near.length;
            ctx.dash(ctx.x + (ctx.x - avgX) * 3, ctx.y + (ctx.y - avgY) * 3);
            return 'success';
          }),
        ]),
        4000,
      ),

      // 2. Melee bash (suppressed when swarmed)
      new BtSequence([
        new BtCondition(ctx => {
          if (!ctx.opponent) return false;
          const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
          return d < MELEE_R && swarmPressure(ctx.x, ctx.y) < 3;
        }),
        new BtAction(ctx => {
          this.attackAnimId = 'attack_melee';
          ctx.attack();
          ctx.stop();
          return 'success';
        }),
      ]),

      // 2b. Destroy visible BurrowHoles — cut off reinforcements.
      // Skipped if any enemy is within melee range (self-defence takes priority).
      new BtSequence([
        new BtCondition(ctx => {
          // Don't hunt holes while enemies are in melee range.
          if (ctx.opponent) {
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            if (d < MELEE_R * 2) return false;
          }
          return this.extraDamageables.some(dd => {
            if (!dd.isAlive) return false;
            const go = dd as unknown as Phaser.GameObjects.GameObject;
            const wx = (go.getData?.('worldX') as number | undefined) ?? dd.x;
            const wy = (go.getData?.('worldY') as number | undefined) ?? dd.y;
            return this.hasLineOfSight(
              new Phaser.Math.Vector2(this._wx, this._wy),
              new Phaser.Math.Vector2(wx, wy),
            );
          });
        }),
        new BtAction(ctx => {
          let nearest: Damageable | null = null;
          let nearestDist = Infinity;
          let holeWx = 0, holeWy = 0;
          for (const d of this.extraDamageables) {
            if (!d.isAlive) continue;
            const go = d as unknown as Phaser.GameObjects.GameObject;
            const wx = (go.getData?.('worldX') as number | undefined) ?? d.x;
            const wy = (go.getData?.('worldY') as number | undefined) ?? d.y;
            if (!this.hasLineOfSight(
              new Phaser.Math.Vector2(this._wx, this._wy),
              new Phaser.Math.Vector2(wx, wy),
            )) continue;
            const dist = Phaser.Math.Distance.Between(this._wx, this._wy, wx, wy);
            if (dist < nearestDist) { nearestDist = dist; nearest = d; holeWx = wx; holeWy = wy; }
          }
          if (!nearest) return 'failure';

          // In ranged distance — shoot it.
          if (nearestDist >= RANGED_MIN && nearestDist <= RANGED_MAX) {
            ctx.shootAt(holeWx, holeWy);
            ctx.stop();
            return 'running';
          }

          // Walk toward it using A*.
          if (this.pathOwner !== 'hole') { this.currentPath = null; this.pathOwner = 'hole'; }
          if (!this.currentPath || this.pathIdx >= this.currentPath.length) {
            const tx = Math.floor(this._wx / this.cellSize);
            const ty = Math.floor(this._wy / this.cellSize);
            this.currentPath = aStarPath(
              this.dungeonGrid!, this.dungeonCols, this.dungeonRows,
              tx, ty, Math.floor(holeWx / this.cellSize), Math.floor(holeWy / this.cellSize),
            );
            this.pathIdx = 0;
            if (!this.currentPath) return 'failure';
          }
          return this.followPath();
        }),
      ]),

      // 3. Pistol — magazine-aware via canShoot / onShotFired hooks
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            if (d < RANGED_MIN || d > RANGED_MAX) return false;
            // Only shoot if we have clear LOS — don't waste ammo on walls.
            return this.hasLineOfSight(
              new Phaser.Math.Vector2(this._wx, this._wy),
              new Phaser.Math.Vector2(ctx.opponent.x, ctx.opponent.y),
            );
          }),
          new BtAction(ctx => {
            this.attackAnimId = 'attack_ranged';
            const shotAngle = Math.atan2(ctx.opponent!.y - ctx.y, ctx.opponent!.x - ctx.x);
            ctx.shootAt(ctx.opponent!.x, ctx.opponent!.y);
            this.scene.events.emit('hero-shot', ctx.x, ctx.y, shotAngle);
            return 'success';
          }),
        ]),
        750,
      ),

      // 4. Path to exit — once discovered, prioritise escaping over chasing.
      // Melee (2) and pistol (3) still fire if enemies are in range/LOS,
      // but the hero won't chase enemies away from the exit path.
      new BtSequence([
        new BtCondition(() => this.exitFound && this.exitTile !== null && this.dungeonGrid !== null),
        new BtAction(() => {
          const tx = Math.floor(this._wx / this.cellSize);
          const ty = Math.floor(this._wy / this.cellSize);
          // Check if hero has arrived at the exit tile.
          if (this.exitTile && tx === this.exitTile.x && ty === this.exitTile.y) {
            this.scene.events.emit('hero-reached-exit');
            return 'success';
          }
          if (this.pathOwner !== 'exit') { this.currentPath = null; this.pathOwner = 'exit'; }
          if (!this.currentPath || this.pathIdx >= this.currentPath.length) {
            this.currentPath = aStarPath(
              this.dungeonGrid!, this.dungeonCols, this.dungeonRows,
              tx, ty, this.exitTile!.x, this.exitTile!.y,
            );
            this.pathIdx = 0;
            if (!this.currentPath) return 'failure';
          }
          return this.followPath();
        }),
      ]),

      // 5. Gap-close dash (only when exit not yet found)
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent || this.exitFound) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d > DASH_MIN && d < DASH_MAX;
          }),
          new BtAction(ctx => {
            ctx.dash(ctx.opponent!.x, ctx.opponent!.y);
            return 'success';
          }),
        ]),
        3000,
      ),

      // 6. Chase (only when exit not yet found)
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null && !this.exitFound),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 7. Explore — walk toward nearest unexplored floor tile
      new BtSequence([
        new BtCondition(() => this.explorationMap !== null && !this.exitFound && this.dungeonGrid !== null),
        new BtAction(() => {
          const tx = Math.floor(this._wx / this.cellSize);
          const ty = Math.floor(this._wy / this.cellSize);

          // Clear stale path from other BT nodes.
          if (this.pathOwner !== 'explore') { this.currentPath = null; this.pathOwner = 'explore'; }

          // Commit to a target tile until it's explored — prevents zigzagging.
          if (this.exploreTarget && this.explorationMap!.isExplored(
            this.exploreTarget.x, this.exploreTarget.y)) {
            this.exploreTarget = null;
            this.currentPath = null;
          }

          if (!this.currentPath || this.pathIdx >= this.currentPath.length) {
            if (!this.exploreTarget) {
              this.exploreTarget = this.explorationMap!.nearestUnexplored(tx, ty, this.dungeonGrid!);
            }
            if (!this.exploreTarget) return 'failure';
            this.currentPath = aStarPath(
              this.dungeonGrid!, this.dungeonCols, this.dungeonRows,
              tx, ty, this.exploreTarget.x, this.exploreTarget.y,
            );
            this.pathIdx = 0;
            if (!this.currentPath) {
              // Can't reach this target — mark it and try another next tick.
              this.explorationMap!.markExplored(this.exploreTarget.x, this.exploreTarget.y);
              this.exploreTarget = null;
              return 'failure';
            }
          }
          return this.followPath();
        }),
      ]),

      // 8. Wander (fallback)
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
