import * as Phaser from 'phaser';
import { EarthHero } from './EarthHero';
import { CombatEntity } from './CombatEntity';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
} from '../ai/BehaviorTree';

// ── Mine constants ─────────────────────────────────────────────────────────────

const MINE_ARM_MS      = 500;  // ms before the mine becomes active
const MINE_TRIGGER_R   = 30;   // px — enemy must enter this radius to trigger
const MINE_AOE_R       = 70;   // px — blast radius
const MINE_DAMAGE      = 50;   // per mine detonation
const MINE_SPREAD      = 55;   // px — offset from Torsten when placing mines

// ── Signature constants ────────────────────────────────────────────────────────

const PERIM_MINES      = 3;    // always exactly 3 per signature activation
const PERIM_CD_MS      = 10_000;

// ── PerimeterMine ──────────────────────────────────────────────────────────────

/**
 * PerimeterMine — a small deployable bomb placed by TorstenKraft's signature.
 *
 * Arms after MINE_ARM_MS (purple disc → bright flash on detonation). Once armed
 * it checks every frame whether any living opponent entered MINE_TRIGGER_R. On
 * trigger it damages all opponents within MINE_AOE_R and destroys itself.
 *
 * The mine is a plain Phaser.GameObjects.Arc with no physics body — distance
 * checks replace Arcade overlap to avoid needing a second physics registration
 * path for a gadget that is already very short-lived.
 */
export class PerimeterMine {
  readonly x: number;
  readonly y: number;

  private armTimer: number;
  private readonly disc: Phaser.GameObjects.Arc;
  private detonated = false;

  constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
  ) {
    this.x        = x;
    this.y        = y;
    this.armTimer = MINE_ARM_MS;
    // Small grey disc while arming; turns bright once armed.
    this.disc = scene.add.arc(x, y, 8, 0, 360, false, 0x888888, 1);
    this.disc.setDepth(y + 1);
  }

  /** True once tick() has caused the mine to detonate. */
  get isExpired(): boolean { return this.detonated; }

  /**
   * Advance the arm timer and check for nearby opponents once armed.
   * @param opponents - living combatants that can trigger and be damaged
   */
  tick(delta: number, opponents: CombatEntity[]): void {
    if (this.detonated) return;

    if (this.armTimer > 0) {
      this.armTimer -= delta;
      if (this.armTimer <= 0) {
        // Armed: switch to bright purple to signal danger.
        this.disc.setFillStyle(0xcc44ff, 1);
      }
      return;
    }

    // Check for any enemy entering the trigger radius.
    for (const e of opponents) {
      if (!e.isAlive) continue;
      if (Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y) < MINE_TRIGGER_R) {
        this.detonate(opponents);
        return;
      }
    }
  }

  /** Remove the visual without triggering (called on hero death / arena reset). */
  dispose(): void {
    this.detonated = true;
    if (this.disc.active) this.disc.destroy();
  }

  private detonate(opponents: CombatEntity[]): void {
    this.detonated = true;

    // Deal blast damage to every opponent within MINE_AOE_R.
    for (const e of opponents) {
      if (!e.isAlive) continue;
      if (Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y) < MINE_AOE_R) {
        e.takeDamage(MINE_DAMAGE);
      }
    }

    // Flash: scale up quickly, fade out, then destroy.
    const flash = this.scene.add.arc(this.x, this.y, 5, 0, 360, false, 0xffffff, 0.9);
    flash.setDepth(this.y + 2);
    this.scene.tweens.add({
      targets:  flash,
      scaleX:   MINE_AOE_R / 5,
      scaleY:   MINE_AOE_R / 5,
      alpha:    0,
      duration: 220,
      ease:     'Quad.easeOut',
      onComplete: () => { if (flash.active) flash.destroy(); },
    });

    if (this.disc.active) this.disc.destroy();
  }
}

// ── TorstenKraft ───────────────────────────────────────────────────────────────

/**
 * TorstenKraft — Tier 2 Earth hero. Combat Specialist.
 *
 * Balanced HP and damage: the durable workhorse of the Earth roster.
 * Assault rifle for sustained ranged fire; body armour gives extra HP.
 *
 * Abilities:
 *   Melee  — close-quarters strike (fallback when enemies close in)
 *   Ranged — assault rifle (higher projectile speed than Maja's sidearm)
 *   Signature: Mine Perimeter — instantly places PERIM_MINES proximity mines
 *              spread around Torsten's current position. 10 s cooldown.
 */
export class TorstenKraft extends EarthHero {
  readonly name = 'TorstenKraft';
  readonly signatureCooldownMs = PERIM_CD_MS;

  private sigCooldown  = 0;
  private activePerimMines: PerimeterMine[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            130,  // body armour — survives more punishment
      speed:            75,   // infantry pace
      aggroRadius:      420,
      attackDamage:     18,   // solid melee fallback
      color:            0x4a7c3f, // military green placeholder
      meleeRange:       36,
      attackCooldownMs: 900,
      projectileDamage: 20,   // assault rifle — more than Maja's sidearm
      projectileSpeed:  380,
      projectileColor:  0xfff080,
    });
  }

  override updateBehaviour(delta: number): void {
    if (this.sigCooldown > 0) this.sigCooldown = Math.max(0, this.sigCooldown - delta);

    // Tick mines and prune detonated ones.
    if (this.activePerimMines.length > 0) {
      for (const m of this.activePerimMines) m.tick(delta, this.opponents);
      this.activePerimMines = this.activePerimMines.filter(m => !m.isExpired);
    }

    super.updateBehaviour(delta);
  }

  /**
   * Mine Perimeter — place PERIM_MINES proximity mines around Torsten.
   *
   * Mines are spread evenly on a circle of radius MINE_SPREAD so they form
   * a defensive perimeter rather than overlapping at a single point.
   * No-ops on cooldown or when the hero is dead.
   */
  useSignature(): void {
    if (this.sigCooldown > 0 || !this.isAlive) return;
    this.sigCooldown = PERIM_CD_MS;

    // Evenly space mines around a circle: angleStep = 2π / PERIM_MINES.
    const angleStep = (Math.PI * 2) / PERIM_MINES;
    for (let i = 0; i < PERIM_MINES; i++) {
      const angle = angleStep * i;
      const mx    = this.x + Math.cos(angle) * MINE_SPREAD;
      const my    = this.y + Math.sin(angle) * MINE_SPREAD;
      this.activePerimMines.push(new PerimeterMine(this.scene, mx, my));
    }
  }

  /** Dispose all mines without detonating (called on hero death / arena reset). */
  destroyMines(): void {
    for (const m of this.activePerimMines) m.dispose();
    this.activePerimMines = [];
  }

  // ── Behavior tree ─────────────────────────────────────────────────────────────

  /**
   * Torsten's AI: prefer staying at assault-rifle range and shooting; only
   * melee if the target is already inside melee range.
   *
   * He holds ground rather than rushing — mines reward this play style.
   */
  protected buildTree(): BtNode {
    const MELEE_R    = this.meleeRange;
    const RANGED_MIN = 80;   // keep distance — rifle is better than melee
    const RANGED_MAX = 260;
    const KITE_IN    = 50;   // step back if enemy is closer than this

    return new BtSelector([

      // 1. Melee when the enemy is already in swing range.
      new BtCooldown(
        new BtSequence([
          new BtCondition(_ctx => {
            const t = this.findNearestLivingOpponent();
            if (!t) return false;
            return Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y) <= MELEE_R;
          }),
          new BtAction(ctx => {
            ctx.attack();
            return 'success';
          }),
        ]),
        this.attackCooldownMs,
      ),

      // 2. Back up if the enemy is dangerously close but not yet in melee range.
      new BtSequence([
        new BtCondition(_ctx => {
          const t = this.findNearestLivingOpponent();
          if (!t) return false;
          return Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y) < KITE_IN;
        }),
        new BtAction(ctx => {
          const t = this.findNearestLivingOpponent();
          if (t) ctx.steerAway(t.x, t.y);
          return 'running';
        }),
      ]),

      // 3. Assault rifle when at optimal distance.
      new BtCooldown(
        new BtSequence([
          new BtCondition(_ctx => {
            const t = this.findNearestLivingOpponent();
            if (!t) return false;
            const d = Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y);
            return d >= RANGED_MIN && d <= RANGED_MAX;
          }),
          new BtAction(ctx => {
            const t = this.findNearestLivingOpponent();
            if (t) ctx.shootAt(t.x, t.y);
            return 'success';
          }),
        ]),
        this.attackCooldownMs * 0.6, // rifle fires faster than melee cooldown
      ),

      // 4. Advance toward target to enter rifle range.
      new BtAction(ctx => {
        if (ctx.opponent) ctx.moveToward(ctx.opponent.x, ctx.opponent.y);
        else ctx.wander(0);
        return 'running';
      }),
    ]);
  }
}
