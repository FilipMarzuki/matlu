/**
 * The Progenitor — Spinolandet final boss that absorbs the signature abilities
 * of fallen enemies and adds them to its own combat repertoire.
 *
 * ## Absorption mechanics
 * The Progenitor listens to the scene-level `'enemy-died'` event emitted by
 * `DungeonForgeScene`'s prune-dead loop. Each event carries the dead enemy's
 * constructor name (e.g. `'Spineling'`, `'Blightfrog'`). When a new type is
 * seen and the absorb cap (5) hasn't been hit, it is absorbed:
 *   1. `absorbedAbilities` array is updated (guards against duplicates + cap).
 *   2. A brief glow flash signals the absorption visually.
 *   3. The corresponding ability is immediately active in the BT on the next tick.
 *
 * ## Absorbed abilities (five Spinolandet enemy types)
 *
 *   Spineling    — "Swarm Frenzy":   +60% melee damage multiplier applied via
 *                  `damageMultiplier`; hits harder to represent swarm numbers.
 *
 *   Blightfrog   — "Acid Spit":      gains a ranged attack branch in the BT
 *                  (CombatEntity.tryRanged / ctx.rangedAttack) at 1.8 s cooldown.
 *
 *   PackStalker  — "Pack Speed":     +40 px/s to movement speed (modifies the
 *                  speed used by ctx.moveToward via a multiplier override flag).
 *
 *   SporeDrifter — "Spore Aura":     every 3 s deals 15 AoE damage to all
 *                  living opponents within 80 px. Runs as a separate timer.
 *
 *   Venomantis   — "Phase Shift":    every 6 s (after a 1 s invisible window)
 *                  the Progenitor snaps to within 30 px of the nearest opponent.
 *                  Simplified vanish: alpha 0 for 1 s, then repositions + reappears.
 *
 * ## Why CombatEntity
 * CombatEntity provides the BT infrastructure, `findNearestLivingOpponent()`,
 * `isTargetable`, and HP bar — all needed for a final boss. The five ability
 * branches are wired as conditional closures in `buildTree()` that check
 * `absorbedAbilities` at runtime, so the same tree handles all absorption states.
 */

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

const BASE_SPEED       = 50;   // px/s; boosted by PackStalker absorption
const PACK_SPEED_BONUS = 40;   // px/s added when PackStalker absorbed
const MELEE_R          = 45;
const BASE_DAMAGE      = 22;
const MELEE_CD_MS      = 1000;
const RANGED_CD_MS     = 1800; // Blightfrog: acid spit cooldown
const SPORE_AoE_R      = 80;   // px radius for SporeDrifter aura
const SPORE_DAMAGE     = 15;
const SPORE_INTERVAL   = 3000; // ms
const PHASE_CD_MS      = 6000; // ms between Venomantis vanishes
const PHASE_DUR_MS     = 1000; // ms invisible during phase shift
const PHASE_DIST       = 30;   // px — snap to within 30 px of target
const MAX_ABSORB       = 5;

/** Names of the five absorbable enemy types. */
const ABSORB_TYPES = new Set([
  'Spineling', 'Blightfrog', 'PackStalker', 'SporeDrifter', 'Venomantis',
]);

const COLOR_BASE   = 0x1a0a2e;  // deep void purple

// ── Progenitor ────────────────────────────────────────────────────────────────

export class Progenitor extends CombatEntity {
  /** Ordered list of absorbed enemy types — max MAX_ABSORB entries. */
  readonly absorbedAbilities: string[] = [];

  // ── Per-ability state ────────────────────────────────────────────────────────

  private rangedTimer      = 0;
  private sporeTimer: Phaser.Time.TimerEvent | null = null;

  // Phase-shift (Venomantis) state
  private phaseTimer       = PHASE_CD_MS;
  private phaseDuration    = 0;
  private isPhasing        = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const config: CombatEntityConfig = {
      maxHp:            500,
      speed:            BASE_SPEED,
      aggroRadius:      220,
      attackDamage:     BASE_DAMAGE,
      color:            COLOR_BASE,
      meleeRange:       MELEE_R,
      attackCooldownMs: MELEE_CD_MS,
    };
    super(scene, x, y, config);

    // Subscribe to enemy deaths for the whole scene lifetime.
    scene.events.on('enemy-died', this.onEnemyDied, this);
  }

  // ── Absorption ──────────────────────────────────────────────────────────────

  /**
   * Called when any enemy dies (via the `'enemy-died'` scene event).
   * Checks whether the type is absorbable, not yet absorbed, and under the cap.
   */
  private onEnemyDied(enemyType: string): void {
    if (!this.isAlive) return;
    if (!ABSORB_TYPES.has(enemyType)) return;
    if (this.absorbedAbilities.includes(enemyType)) return;
    if (this.absorbedAbilities.length >= MAX_ABSORB) return;

    this.absorbedAbilities.push(enemyType);
    this.applyAbility(enemyType);
    this.playAbsorbFlash();
  }

  /** Immediately activate the mechanical effect of the absorbed ability. */
  private applyAbility(type: string): void {
    switch (type) {
      case 'Spineling':
        // Swarm Frenzy: increase damage multiplier so hits land harder.
        this.damageMultiplier = (this.damageMultiplier ?? 1) * 1.6;
        break;

      case 'PackStalker':
        // Pack Speed: boost movement speed via the config (read by ctx.moveToward).
        // CombatEntity stores speed on `this.speed` (readonly from Enemy) — override
        // by using a wrapper approach: boost attackDamage read is fine but speed is
        // readonly. We track the boost in the BT via a flag checked in move logic.
        // (Speed override is handled in updateBehaviour instead.)
        break;

      case 'Blightfrog':
        // Acid Spit: BT ranged branch activates automatically via absorbedAbilities check.
        break;

      case 'SporeDrifter':
        // Spore Aura: start periodic AoE damage timer.
        this.sporeTimer = this.scene.time.addEvent({
          delay:         SPORE_INTERVAL,
          callback:      this.doSporeAoe,
          callbackScope: this,
          loop:          true,
        });
        break;

      case 'Venomantis':
        // Phase Shift: BT vanish branch activates; timer reset to start immediately.
        this.phaseTimer = 0;
        break;
    }
  }

  /** Brief white glow flash to signal absorption. */
  private playAbsorbFlash(): void {
    this.scene.tweens.chain({
      targets: this,
      tweens: [
        { alpha: 0.3, duration: 80, ease: 'Cubic.easeIn'  },
        { alpha: 2.0, duration: 80, ease: 'Cubic.easeOut' }, // over-bright flash
        { alpha: 1.0, duration: 160, ease: 'Cubic.easeIn' },
      ],
    });
  }

  // ── SporeDrifter ability ────────────────────────────────────────────────────

  private doSporeAoe(): void {
    if (!this.isAlive) return;
    for (const opp of this.opponents) {
      if (!opp.isAlive) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, opp.x, opp.y);
      if (d <= SPORE_AoE_R) {
        opp.takeDamage(SPORE_DAMAGE);
      }
    }
  }

  // ── Behaviour ───────────────────────────────────────────────────────────────

  override updateBehaviour(delta: number): void {
    // Phase shift tick (Venomantis absorption).
    if (this.absorbedAbilities.includes('Venomantis')) {
      if (this.isPhasing) {
        this.phaseDuration -= delta;
        if (this.phaseDuration <= 0) this.endPhase();
        return;  // skip all other behaviour while phasing
      }
      this.phaseTimer -= delta;
      if (this.phaseTimer <= 0) {
        this.beginPhase();
        return;
      }
    }

    // Tick ranged cooldown (used by Blightfrog branch in BT).
    if (this.rangedTimer > 0) this.rangedTimer -= delta;

    super.updateBehaviour(delta);
  }

  private beginPhase(): void {
    this.isPhasing     = true;
    this.phaseDuration = PHASE_DUR_MS;
    this.isTargetable  = false;
    this.setAlpha(0);
    const body = this.getPhysicsBody();
    if (body) { body.setVelocity(0, 0); body.enable = false; }

    // Snap to within PHASE_DIST px of the nearest opponent.
    const opp = this.findNearestLivingOpponent();
    if (opp) {
      const angle = Phaser.Math.Angle.Between(opp.x, opp.y, this.x, this.y);
      this.setPosition(
        opp.x + Math.cos(angle) * PHASE_DIST,
        opp.y + Math.sin(angle) * PHASE_DIST,
      );
    }
  }

  private endPhase(): void {
    this.isPhasing   = false;
    this.isTargetable = true;
    this.phaseTimer  = PHASE_CD_MS;

    const body = this.getPhysicsBody();
    if (body) body.enable = true;

    // Reappear with a flash.
    this.scene.tweens.chain({
      targets: this,
      tweens: [
        { alpha: 1.8, duration: 120, ease: 'Cubic.easeOut' },
        { alpha: 1.0, duration: 120, ease: 'Cubic.easeIn'  },
      ],
    });
  }

  // ── Behavior tree ─────────────────────────────────────────────────────────

  protected override buildTree(): BtNode {
    // Effective speed: base + PackStalker bonus when absorbed.
    const effectiveSpeed = (): number =>
      this.speed + (this.absorbedAbilities.includes('PackStalker') ? PACK_SPEED_BONUS : 0);

    return new BtSelector([

      // 1. Acid Spit (Blightfrog) — ranged attack when in a mid-range window.
      new BtSequence([
        new BtCondition(_ctx => {
          if (!this.absorbedAbilities.includes('Blightfrog')) return false;
          if (this.rangedTimer > 0) return false;
          const opp = this.findNearestLivingOpponent();
          if (!opp) return false;
          const d = Phaser.Math.Distance.Between(this.x, this.y, opp.x, opp.y);
          return d > MELEE_R && d < 200;
        }),
        new BtAction(_ctx => {
          this.tryRanged();
          this.rangedTimer = RANGED_CD_MS;
          return 'success';
        }),
      ]),

      // 2. Melee smash — damage boosted if Spineling absorbed.
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
          // damageMultiplier already set by applyAbility('Spineling');
          // takeDamage respects it via the entity's own multiplier.
          opp.takeDamage(this.attackDamage);
          opp.onHitBy(this.x, this.y);
          this.attackTimer = this.attackCooldownMs;
          ctx.stop();
          return 'success';
        }),
      ]),

      // 3. Chase with PackStalker speed boost.
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          const opp = ctx.opponent!;
          const spd = effectiveSpeed();
          const dx  = opp.x - this.x;
          const dy  = opp.y - this.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const body = this.getPhysicsBody();
          body?.setVelocity((dx / len) * spd, (dy / len) * spd);
          return 'running';
        }),
      ]),

      // 4. Wander when no target.
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }

  // ── Death ───────────────────────────────────────────────────────────────────

  protected override onDeath(): void {
    // Unsubscribe from enemy-died before destroy() to prevent ghost callbacks.
    this.scene.events.off('enemy-died', this.onEnemyDied, this);
    // Stop spore aura timer.
    if (this.sporeTimer) {
      this.sporeTimer.remove();
      this.sporeTimer = null;
    }
    super.onDeath();
  }
}
