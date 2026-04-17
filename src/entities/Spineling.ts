import * as Phaser from 'phaser';
import { CombatEntity } from './CombatEntity';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
} from '../ai/BehaviorTree';

/**
 * Spineling — fast spider-crab swarmer. 1 HP; dies in one hit from any source.
 *
 * Danger comes from density, not individual strength. A single Spineling is
 * trivial; twenty of them scuttling in formation is overwhelming. AoE weapons
 * (grenades, sweep attacks) clear clusters efficiently; single-target weapons
 * must pick them off one at a time through the swarm.
 *
 * Boids coordination (separation, alignment, cohesion) is handled by the
 * CombatEntity base class — the scene passes the full alive-enemy list as
 * swarm neighbours so the group stays loosely bundled while steering toward
 * the player.
 *
 * On death the Spineling writes a panicOrigin to the shared ArenaBlackboard.
 * Surviving swarm-mates within the panic radius read this each frame and call
 * enterPanic(), causing them to scatter briefly before reforming. This makes
 * killing individual Spinelings feel consequential — each death ripples outward.
 */
export class Spineling extends CombatEntity {
  /** Radius (px) within which a Spineling death triggers swarm panic. */
  private static readonly DEATH_PANIC_RADIUS = 100;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      // One hit from any source kills a Spineling — their threat is numbers.
      maxHp:            1,
      speed:            150,
      aggroRadius:      500,
      attackDamage:     3,
      color:            0x442200,
      meleeRange:       20,
      attackCooldownMs: 580,
      // Spider-crab colouring: sandy rust, smaller than a BabyVelcrid.
      spriteKey:   'mini-velcrid',
      spriteTint:  0xcc6622,
      spriteScale: 0.20,
      // Short memory — Spinelings lose interest quickly when line of sight breaks.
      sightMemoryMs: 600,
    });
  }

  /**
   * Simple rush-and-melee tree. The boids steering in the base class keeps the
   * swarm spread without requiring per-Spineling logic — this tree only handles
   * "attack if adjacent, chase if target visible, wander otherwise".
   */
  protected buildTree(): BtNode {
    const R = this.meleeRange;
    return new BtSelector([
      // Attack branch — only fires if the target is within melee range.
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < R,
        ),
        new BtAction(ctx => { ctx.attack(); ctx.stop(); return 'success'; }),
      ]),
      // Chase branch — move directly toward the target.
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => { ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y); return 'running'; }),
      ]),
      // Fallback — wander until a target enters aggro range.
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }

  /**
   * Override death to write a panic event to the shared blackboard.
   * Surviving Spinelings within DEATH_PANIC_RADIUS will read this on their
   * next frame and call enterPanic(), causing the cluster to scatter briefly.
   * This is the key mechanic that makes AoE weapons feel more effective than
   * single-target weapons against swarms.
   */
  protected override onDeath(): void {
    super.onDeath();

    // Broadcast to the blackboard so swarm-mates can react.
    // The arena scene's blackboard.tick() clears panicOrigin after one frame,
    // so each Spineling death generates exactly one scatter event.
    if (this.blackboard) {
      this.blackboard.panicOrigin = { x: this.x, y: this.y };
      this.blackboard.panicRadius = Spineling.DEATH_PANIC_RADIUS;
    }
  }
}
