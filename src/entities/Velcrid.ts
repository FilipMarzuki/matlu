import Phaser from 'phaser';
import { CombatEntity } from './CombatEntity';
import { BtNode, BtSelector, BtSequence, BtCondition, BtAction } from '../ai/BehaviorTree';

/**
 * BabyVelcrid — the first enemy type in Matlu.
 *
 * Design intent: "Easy to kill. Hard to not get overwhelmed by."
 * Individually weak (8 HP, low damage) but spawns in floods of six.
 * Behavior is deliberately simple: charge straight at the nearest opponent
 * with no orbit or dodge phase — all the swarm complexity comes from numbers,
 * not from individual intelligence.
 *
 * Velcrids are native to Spinolandet. Full lore in the Notion Creatures database.
 */
export class BabyVelcrid extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            8,
      speed:            155,
      aggroRadius:      380,
      attackDamage:     5,
      // Dark chitinous green — visible fallback when spritesheet is absent.
      color:            0x1a2a08,
      meleeRange:       18,
      attackCooldownMs: 320,
      spriteKey:        'baby-velcrid',
    });
  }

  /**
   * Minimal behavior tree: rush the opponent and attack when close.
   * No orbit or positioning logic — the swarm chaos comes from quantity.
   */
  protected buildTree(): BtNode {
    const MELEE_R = this.meleeRange;
    return new BtSelector([
      // 1. Attack: stop and strike when within melee range.
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < MELEE_R,
        ),
        new BtAction(ctx => {
          ctx.attack();
          ctx.stop();
          return 'success';
        }),
      ]),
      // 2. Chase: sprint directly at the nearest opponent — no orbit.
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),
      // 3. Wander: idle movement when no opponent is in aggro range.
      new BtAction((ctx, d) => {
        ctx.wander(d);
        return 'running';
      }),
    ]);
  }
}
