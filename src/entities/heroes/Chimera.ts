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

const MULTI_STRIKE_COOLDOWN_MS = 8_000;
/** Delay between successive arm strikes in ms — simulates rapid sequential blows. */
const STRIKE_DELAY_MS = 100;
const STRIKE_COUNT = 4;

/**
 * Chimera — Tier 3 large-creature hero.
 *
 * Bear-sized with four arms. Signature ability (useMultiStrike) fires up to
 * 4 sequential single-target attacks staggered ~100 ms apart, each targeting a
 * different nearest living enemy — one blow per limb.
 *
 * AI persona (auto-play):
 *   - Multi-Strike when adjacent to enemy(ies) — highest damage burst
 *   - Basic melee fallback between Multi-Strike cooldowns
 *   - Relentless charge toward nearest target
 *   - Wander when no enemies visible
 */
export class Chimera extends HeroEntity {
  /**
   * Physics collision radius in pixels. ~24 px vs ~10 px for humanoids —
   * the Chimera occupies roughly 2 tiles. Pass to body.setCircle(this.bodyRadius)
   * in the scene after physics.add.existing(chimera).
   */
  readonly bodyRadius = 24;

  private multiStrikeCooldown = 0;

  /**
   * Handles for in-flight delayedCall strike timers.
   * Stored so onDeath() can cancel them if the Chimera dies mid-sequence.
   */
  private strikeHandles: Phaser.Time.TimerEvent[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            160,
      speed:            70,  // slow but hits like a truck
      aggroRadius:      280,
      attackDamage:     20,
      meleeRange:       55,  // wide melee reach — four-armed
      attackCooldownMs: 550,
      color:            0xcc6622, // heavy amber
      sightMemoryMs:    2_500,
      hearingRadius:    180,
    });
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  override update(delta: number): void {
    super.update(delta);
    if (!this.isAlive) return;
    this.multiStrikeCooldown = Math.max(0, this.multiStrikeCooldown - delta);
  }

  // ── Player-mode API ─────────────────────────────────────────────────────────

  /**
   * Multi-Strike — fire up to 4 sequential single-target attacks.
   *
   * Targets the nearest distinct living enemies sorted by ascending distance.
   * Each hit is staggered ~100 ms via delayedCall so the four blows feel like
   * rapid successive strikes rather than an instant AOE burst.
   *
   * No-op while the 8 000 ms cooldown is active or while dead.
   */
  useMultiStrike(): void {
    if (!this.isAlive || this.multiStrikeCooldown > 0) return;

    const targets = this.opponents
      .filter(e => e.isAlive)
      .sort((a, b) =>
        Phaser.Math.Distance.Between(this.x, this.y, a.x, a.y) -
        Phaser.Math.Distance.Between(this.x, this.y, b.x, b.y),
      )
      .slice(0, STRIKE_COUNT);

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const handle = this.scene.time.delayedCall(i * STRIKE_DELAY_MS, () => {
        if (target.isAlive) {
          target.takeDamage(this.attackDamage);
        }
        const idx = this.strikeHandles.indexOf(handle);
        if (idx !== -1) this.strikeHandles.splice(idx, 1);
      });
      this.strikeHandles.push(handle);
    }

    this.multiStrikeCooldown = MULTI_STRIKE_COOLDOWN_MS;
  }

  /** 0–1 fraction — HUD cooldown indicator. */
  get multiStrikeCooldownFraction(): number {
    return this.multiStrikeCooldown / MULTI_STRIKE_COOLDOWN_MS;
  }

  // ── AI behaviour ────────────────────────────────────────────────────────────

  /**
   * Chimera's AI tree — aggressive brawler persona.
   *
   * Priority order:
   *   1. Multi-Strike — burst damage when in engage range and cooldown ready
   *   2. Melee — basic attacks between Multi-Strike windows
   *   3. Charge — close the gap at full speed
   *   4. Wander
   */
  protected buildTree(): BtNode {
    const ENGAGE_RANGE = 60;

    const inRange = (ctx: { x: number; y: number }, opp: { x: number; y: number }) =>
      Phaser.Math.Distance.Between(ctx.x, ctx.y, opp.x, opp.y) < ENGAGE_RANGE;

    return new BtSelector([

      // 1. Multi-Strike — heavy burst when close; ability manages its own cooldown
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => !!ctx.opponent && inRange(ctx, ctx.opponent)),
          new BtAction(() => {
            this.useMultiStrike();
            return 'success';
          }),
        ]),
        MULTI_STRIKE_COOLDOWN_MS,
      ),

      // 2. Melee — keep hitting between Multi-Strike cooldowns
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => !!ctx.opponent && inRange(ctx, ctx.opponent)),
          new BtAction(ctx => {
            ctx.attack();
            return 'success';
          }),
        ]),
        550,
      ),

      // 3. Charge — Chimera never stops moving toward its target
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

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Cancel all pending strike timers before the entity is cleaned up. */
  protected override onDeath(): void {
    for (const h of this.strikeHandles) {
      this.scene.time.removeEvent(h);
    }
    this.strikeHandles = [];
    super.onDeath();
  }
}
