import * as Phaser from 'phaser';
import { CombatEntity, CombatEntityConfig } from './CombatEntity';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
} from '../ai/BehaviorTree';

// ── Config ──────────────────────────────────────────────────────────────────

/** px — hero must enter this radius to trigger the reveal. */
const REVEAL_RADIUS = 80;

/** Damage multiplier applied to the first attack after reveal. */
const AMBUSH_MULT = 1.5;

/** px — melee reach for normal attacks. */
const MELEE_R = 32;

/** Color of the terrain-prop disguise (muted rock brown). */
const COLOR_PROP     = 0x8b7355;
/** Color after reveal (darker chitinous body). */
const COLOR_CRAWLER  = 0x3d2b1f;
/** Accent dot shown while disguised so it blends with prop sprites. */
const COLOR_HIGHLIGHT = 0xb09878;

/**
 * MimicCrawler — stealth ambush enemy that sits disguised as a terrain prop.
 *
 * ## Disguise phase
 * On construction `isTargetable = false` so aggro scans and HP bars skip it.
 * The visual is a rock-colored rectangle — indistinguishable from real prop
 * objects placed at the same coordinates. The crawler stands completely still.
 *
 * ## Reveal
 * When any opponent (hero) walks within REVEAL_RADIUS px, `isTargetable` is
 * set to `true` **before** the colour swap, avoiding a 1-frame window where
 * the crawler is visible but untargetable. `ambushPending` is set at the same
 * time and remains true until the first melee hit lands.
 *
 * ## Ambush bonus
 * The first attack after reveal uses `attackDamage × AMBUSH_MULT`. Subsequent
 * attacks use the base value. If the MimicCrawler is killed by AoE while still
 * disguised, the ambush flag never fires — the bonus only applies after reveal.
 *
 * ## Why CombatEntity, not Enemy?
 * CombatEntity provides the behavior tree, `isTargetable`, HP bar, and the
 * `findNearestLivingOpponent()` helper. Enemy doesn't track opponents so the
 * reveal distance check would require its own static getter. CombatEntity is
 * the natural base for any enemy that needs BT-driven attacking.
 */
export class MimicCrawler extends CombatEntity {
  private disguised    = true;
  private ambushPending = false;

  private readonly propRect:    Phaser.GameObjects.Rectangle;
  private readonly crawlerRect: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const config: CombatEntityConfig = {
      maxHp:            55,
      speed:            65,
      aggroRadius:      REVEAL_RADIUS,  // used only after reveal
      attackDamage:     20,
      color:            COLOR_CRAWLER,  // CombatEntity rect; hidden while disguised
      meleeRange:       MELEE_R,
      attackCooldownMs: 900,
    };
    super(scene, x, y, config);

    // Start untargetable — heroes cannot aggro or HP-bar this while it's a prop
    this.isTargetable = false;

    // Prop disguise: a rock-ish square with a small lighter spot
    this.propRect = scene.add.rectangle(0, 0, 18, 16, COLOR_PROP);
    const highlight = scene.add.rectangle(4, -3, 6, 5, COLOR_HIGHLIGHT);
    this.add(this.propRect);
    this.add(highlight);

    // Crawler body (hidden until reveal)
    this.crawlerRect = scene.add.rectangle(0, 0, 22, 14, COLOR_CRAWLER);
    this.crawlerRect.setVisible(false);
    this.add(this.crawlerRect);

    // Hide the CombatEntity placeholder rect while disguised — it would
    // give the game away. The bodyRect field on CombatEntity is protected;
    // alpha-out via setAlpha on the container instead.
    this.setAlpha(0.97); // near-opaque — almost identical to real prop alpha
  }

  // ── Behaviour ──────────────────────────────────────────────────────────────

  override updateBehaviour(delta: number): void {
    if (this.disguised) {
      // Stay completely still while disguised — movement would reveal the trick.
      const physBody = this.getPhysicsBody();
      physBody?.setVelocity(0, 0);

      // Check reveal condition against every tracked opponent (heroes).
      const nearest = this.findNearestLivingOpponent();
      if (nearest) {
        const d = Phaser.Math.Distance.Between(this.x, this.y, nearest.x, nearest.y);
        if (d <= REVEAL_RADIUS) this.reveal();
      }
      return;
    }

    super.updateBehaviour(delta);
  }

  // ── Reveal ─────────────────────────────────────────────────────────────────

  private reveal(): void {
    // isTargetable = true BEFORE the visual swap so there is never a frame
    // where the crawler is visible but still untargetable.
    this.isTargetable  = true;
    this.disguised     = false;
    this.ambushPending = true;

    this.propRect.setVisible(false);
    this.crawlerRect.setVisible(true);
    this.setAlpha(1);
  }

  // ── Behavior tree ─────────────────────────────────────────────────────────

  protected override buildTree(): BtNode {
    return new BtSelector([

      // 1. Melee attack — with ambush damage bonus on the first hit.
      //
      // `ctx.attack()` always uses `this.attackDamage` (readonly), so we
      // bypass it when the ambush bonus is pending and call takeDamage directly.
      // `this.attackTimer` is protected on CombatEntity, readable here.
      new BtSequence([
        new BtCondition(_ctx => {
          if (this.attackTimer > 0) return false;
          const opp = this.findNearestLivingOpponent();
          if (!opp) return false;
          return Phaser.Math.Distance.Between(this.x, this.y, opp.x, opp.y) < MELEE_R;
        }),
        new BtAction(ctx => {
          const opp = this.findNearestLivingOpponent();
          if (!opp) return 'failure';

          const dmg = this.ambushPending
            ? Math.round(this.attackDamage * AMBUSH_MULT)
            : this.attackDamage;
          this.ambushPending = false;  // consumed on first landed hit

          opp.takeDamage(dmg);
          opp.onHitBy(this.x, this.y);  // flash + knockback feedback
          this.attackTimer = this.attackCooldownMs;
          ctx.stop();
          return 'success';
        }),
      ]),

      // 2. Chase the opponent
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 3. Wander (idle)
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
