import * as Phaser from 'phaser';
import { HeroEntity } from '../HeroEntity';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
} from '../../ai/BehaviorTree';

/**
 * Apex — Tier 4 large-creature hero.
 *
 * Elephant-scaled (four-legged), oversized collision footprint.
 * Signature ability: Primal Roar — panics all nearby enemies for 5 000 ms,
 * sending each fleeing in a unique random direction. 12 000 ms cooldown.
 *
 * AI persona (auto-play):
 *   - Primal Roar when 3+ enemies are within 220 px — area crowd-control
 *   - Melee when adjacent — raw damage
 *   - Charge nearest target — simple and relentless
 *   - Wander when no enemy visible
 */
export class Apex extends HeroEntity {
  /**
   * Collision/camera radius in px. ~40 px reflects the elephant scale relative
   * to the standard 20 px entities.
   */
  readonly bodyRadius = 40;

  private cooldownRemaining = 0;
  private static readonly PRIMAL_ROAR_COOLDOWN_MS = 12_000;
  private static readonly ROAR_PANIC_MS            = 5_000;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            220,
      speed:            65,  // slow — compensated by massive HP and AoE
      aggroRadius:      300,
      attackDamage:     28,  // heaviest melee hit of any hero
      meleeRange:       60,  // wide reach — elephant-sized
      attackCooldownMs: 700,
      color:            0x997755, // warm ochre / elephant hide
      sightMemoryMs:    2_000,
      hearingRadius:    240,
    });
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  override update(delta: number): void {
    super.update(delta);
    if (!this.isAlive) return;
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - delta);
  }

  // ── Player-mode API ─────────────────────────────────────────────────────────

  /**
   * Primal Roar — panic all living enemies within `radius` px.
   *
   * Each affected enemy is yanked out of AI control and given a unique random
   * flee velocity for 5 000 ms. setPlayerControlled(true) suspends their BT
   * so the scatter velocity isn't immediately overwritten by chase logic.
   *
   * No-op while the 12 000 ms cooldown is active.
   */
  usePrimalRoar(radius: number): void {
    if (this.cooldownRemaining > 0) return;
    this.cooldownRemaining = Apex.PRIMAL_ROAR_COOLDOWN_MS;

    // opponents is inherited from HeroEntity → CombatEntity
    for (const enemy of this.opponents) {
      if (!enemy.isAlive) continue;
      const dist = Phaser.Math.Distance.Between(this.x, this.y, enemy.x, enemy.y);
      if (dist > radius) continue;

      // Each enemy gets its own random angle so they scatter rather than
      // all fleeing in the same direction away from the Apex.
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const vx    = Math.cos(angle) * enemy.speed;
      const vy    = Math.sin(angle) * enemy.speed;

      enemy.setPlayerControlled(true);
      enemy.setMoveVelocity(vx, vy);

      this.scene.time.delayedCall(Apex.ROAR_PANIC_MS, () => {
        if (enemy.isAlive) enemy.setPlayerControlled(false);
      });
    }
  }

  /** 0–1 fraction — HUD cooldown indicator. */
  get primalRoarCooldownFraction(): number {
    return this.cooldownRemaining / Apex.PRIMAL_ROAR_COOLDOWN_MS;
  }

  // ── AI behaviour ────────────────────────────────────────────────────────────

  /**
   * Apex's AI tree — immovable tank / crowd controller persona.
   *
   * Priority order:
   *   1. Primal Roar — AoE panic when 3+ enemies cluster within 220 px
   *   2. Melee — heavy single-target strike when adjacent
   *   3. Charge — lumbering but unstoppable pursuit
   *   4. Wander
   */
  protected buildTree(): BtNode {
    const ROAR_RADIUS    = 220;
    const ROAR_THRESHOLD = 3;
    const MELEE_RANGE    = 65;

    return new BtSelector([

      // 1. Primal Roar — use when enemies cluster
      new BtCooldown(
        new BtSequence([
          new BtCondition(() => {
            const nearby = this.opponents.filter(o =>
              o.isAlive &&
              Phaser.Math.Distance.Between(this.x, this.y, o.x, o.y) < ROAR_RADIUS,
            );
            return nearby.length >= ROAR_THRESHOLD;
          }),
          new BtAction(() => {
            this.usePrimalRoar(ROAR_RADIUS);
            return 'success';
          }),
        ]),
        Apex.PRIMAL_ROAR_COOLDOWN_MS,
      ),

      // 2. Melee — strike when within reach
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx =>
            !!ctx.opponent &&
            Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < MELEE_RANGE),
          new BtAction(ctx => {
            ctx.attack();
            return 'success';
          }),
        ]),
        700,
      ),

      // 3. Charge — Apex never hesitates, just walks into them
      new BtSequence([
        new BtCondition(ctx => !!ctx.opponent),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 4. Wander
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),

    ]);
  }
}
