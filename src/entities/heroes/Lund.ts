import * as Phaser from 'phaser';
import { LivingEntity } from '../LivingEntity';
import { HeroEntity } from '../HeroEntity';
import { CombatEntity } from '../CombatEntity';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
} from '../../ai/BehaviorTree';

/**
 * Lund — Tier 1 Naturalist Scout.
 *
 * Lowest HP of any hero, compensated by the highest movement speed. Lund's
 * role is pure support: she stays at range and uses Pacify frequently to buy
 * time for heavier allies (isSupportUnit = true is the AI hint for this).
 *
 * Signature ability: usePacify(target) — stuns the target for 3 s.
 * Cooldown: 10 s.
 *
 * AI persona (auto-play):
 *   - Flee critically low HP (< 25%) away from the nearest threat
 *   - Use Pacify on the nearest enemy within 220 px when cooldown allows
 *   - Stay within 150 px of the most wounded ally (guard/support positioning)
 *   - Wander when no allies and no threats
 */
export class Lund extends HeroEntity {
  /** Tells AI behaviour trees that this hero should keep distance and spam Pacify. */
  readonly isSupportUnit = true;

  private cooldownRemaining = 0;
  private static readonly PACIFY_COOLDOWN_MS  = 10_000;
  private static readonly PACIFY_DURATION_MS  = 3_000;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    // 60 HP — lowest of any hero; pure support, never meant to tank hits.
    super(scene, x, y, {
      maxHp:            60,
      speed:            120, // fastest hero; compensates for fragility
      aggroRadius:      300,
      attackDamage:     8,   // barely fights; Pacify is the real weapon
      meleeRange:       35,
      attackCooldownMs: 1_000,
      color:            0x88dd88, // soft nature green
      sightMemoryMs:    5_000,
      hearingRadius:    350,  // perceptive — she hears everything
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
   * Stun one target enemy for 3 s. No-op while the cooldown is active.
   * @returns true if the ability fired, false if it was on cooldown.
   */
  usePacify(target: LivingEntity): boolean {
    if (this.cooldownRemaining > 0) return false;
    target.stun(Lund.PACIFY_DURATION_MS);
    this.cooldownRemaining = Lund.PACIFY_COOLDOWN_MS;
    return true;
  }

  /** 0–1 fraction — useful for rendering a cooldown indicator. */
  get pacifyCooldownFraction(): number {
    return this.cooldownRemaining / Lund.PACIFY_COOLDOWN_MS;
  }

  // ── AI behaviour ────────────────────────────────────────────────────────────

  /**
   * Lund's AI tree — support/pacifier persona.
   *
   * Priority order:
   *   1. Flee — sprint away from threat when HP < 25%
   *   2. Pacify — stun nearest enemy within 220 px (cooldown is ability-internal)
   *   3. Guard — position near the most wounded ally
   *   4. Wander
   */
  protected buildTree(): BtNode {
    const PACIFY_RANGE  = 220;
    const GUARD_RANGE   = 150;
    const FLEE_HP_FRAC  = 0.25;

    return new BtSelector([

      // 1. Flee — Lund is too fragile to fight at low HP
      new BtSequence([
        new BtCondition(ctx => this.hpFraction < FLEE_HP_FRAC && !!ctx.opponent),
        new BtAction(ctx => {
          ctx.steerAway(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 2. Pacify — stun the nearest threatening enemy
      // usePacify() guards its own internal cooldown; the BT just attempts it.
      new BtSequence([
        new BtCondition(ctx => {
          if (!ctx.opponent) return false;
          return Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < PACIFY_RANGE;
        }),
        new BtAction(() => {
          // Re-find nearest living opponent from the roster — ctx.opponent is a
          // plain snapshot (no reference to the entity), so we need the actual object.
          const target = (this.opponents as CombatEntity[])
            .filter(o => o.isAlive)
            .sort((a, b) =>
              Phaser.Math.Distance.Between(this.x, this.y, a.x, a.y) -
              Phaser.Math.Distance.Between(this.x, this.y, b.x, b.y),
            )[0] as LivingEntity | undefined;
          if (target) this.usePacify(target);
          return 'success';
        }),
      ]),

      // 3. Guard — stay close to the most wounded ally
      new BtSequence([
        new BtCondition(() => this.allies.some(a => a.isAlive)),
        new BtAction(ctx => {
          const wounded = [...this.allies]
            .filter(a => a.isAlive)
            .sort((a, b) => a.hpFraction - b.hpFraction)[0];

          const d = Phaser.Math.Distance.Between(this.x, this.y, wounded.x, wounded.y);
          if (d > GUARD_RANGE) {
            ctx.moveToward(wounded.x, wounded.y);
          } else {
            ctx.stop();
          }
          return 'running';
        }),
      ]),

      // 4. Wander
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),

    ]);
  }
}
