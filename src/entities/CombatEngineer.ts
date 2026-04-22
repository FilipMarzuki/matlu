/**
 * CombatEngineer — Loke at Tier 3, post-promotion.
 *
 * ## Narrative context
 *
 * The same Loke who scouted as Tinkerer (T2) has graduated to the Combat
 * Engineer role: field operator, gadget specialist, forward-deployed builder.
 * Older, harder, and carrying a lot more kit. His pistol is gone; the M12
 * Carbine and a full deployable kit replace it. The exo-frame makes him slower
 * but significantly harder to put down.
 *
 * ## What's implemented here (Child C — deployable kit)
 *
 * - All 4 deployable types: SentryTurret (Q), ScoutDrone (E), ProximityMine (R),
 *   BarrierShield (F)
 * - Per-kind cooldown timers and active-cap enforcement
 * - DeployableManager integration (ticked in updateBehaviour)
 * - useSignature() — Deployable Overcharge: resets all deploy cooldowns,
 *   overclocks the Sentry Turret for 4 s (scanInterval halved)
 *
 * ## What is NOT here yet
 *
 * - M12 Carbine burst-fire mechanic (Child D)
 * - Deployable HUD slot panel (Child D)
 * - Real sprite and animations (PixelLab generation via sprite-credit-burn)
 *
 * ## Stats rationale
 *
 * Tinkerer (T2): HP 100, speed 80 — fast glass-cannon pistol-fighter.
 * CombatEngineer (T3): HP 130, speed 68, damageReduction 0.88 — tanky operator.
 * The exo-frame trades agility for survivability and loadout capacity.
 */

import * as Phaser from 'phaser';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
} from '../ai/BehaviorTree';
import { EarthHero } from './EarthHero';
import { Deployable } from './Deployable';
import { DeployableManager } from '../systems/DeployableManager';
import { SentryTurret } from './deployables/SentryTurret';
import { ScoutDrone } from './deployables/ScoutDrone';
import { ProximityMine } from './deployables/ProximityMine';
import { BarrierShield } from './deployables/BarrierShield';
import { TURRET, DRONE, MINE, SHIELD } from '../data/deployableConfigs';

// ── Tier stats ────────────────────────────────────────────────────────────────

/** Hit-points — exo-frame raises baseline vs Tinkerer's 100. */
const MAX_HP       = 130;
/** px/s — slower than Tinkerer (80) due to heavier kit. */
const SPEED        = 68;
/** Incoming damage multiplier. 0.88 = 12% flat reduction from exo-frame padding. */
const DMG_REDUCE   = 0.88;

// ── Carbine placeholder stats (Child D will refine to burst-fire) ─────────────

/** Damage per shot (placeholder; Carbine burst mechanic comes in Child D). */
const PROJ_DAMAGE  = 6;
/** Projectile speed px/s — slightly slower than Tinkerer's 420 (heavier round). */
const PROJ_SPEED   = 380;
/** Tracer colour — warm amber to distinguish from Tinkerer's pale yellow. */
const PROJ_COLOR   = 0xff9944;

// ── Behaviour tree tuning ─────────────────────────────────────────────────────

const MELEE_R    = 32;   // px — matches meleeRange below
const DASH_MIN   = MELEE_R;
const DASH_MAX   = 280;
const RANGED_MIN = 60;
const RANGED_MAX = 210;  // slightly shorter than Tinkerer's 230 (Carbine is close-mid)
const SWARM_R    = 120;
const SWARM_CAP  = 4;

/**
 * CombatEngineer — Loke at Tier 3. EarthHero subclass with a full deployable kit.
 *
 * Sprite: 'combat-engineer' (not yet generated — missing-anim warnings expected).
 *
 * designNotes (for sprite-credit-burn agent):
 *   "Loke as T3 Combat Engineer. Same facial features and ash-blond hair as
 *    Tinkerer-Loke, now older and harder. Milspec operator kit: olive-drab
 *    webbing vest, exo-frame reinforcement at shoulders and knees, M12 carbine
 *    held low-ready, utility pouches on belt, flip-up HUD visor on helmet.
 *    32×32 top-down pixel art. Matches the Tinkerer-Loke colour palette —
 *    swap canvas jacket for exo-frame plating, keep face and hair identical."
 */
export class CombatEngineer extends EarthHero {
  /** Human-readable name used in HUD labels and log output. */
  readonly name = 'CombatEngineer';

  /**
   * Signature ability cooldown.
   * Longer than Tinkerer (8 s) — Deployable Overcharge resets all deploy cooldowns
   * and overclocks the Sentry Turret for 4 s.
   */
  readonly signatureCooldownMs = 12_000;

  // ── Deployable system ─────────────────────────────────────────────────────

  private readonly deployMgr = new DeployableManager();

  /** Per-kind cooldown timers (count down to 0, then deploy is available). */
  private turretCd  = 0;
  private droneCd   = 0;
  private mineCd    = 0;
  private shieldCd  = 0;

  /** Per-kind active-instance counters (enforces cap). */
  private turretCount = 0;
  private droneCount  = 0;
  private mineCount   = 0;
  private shieldCount = 0;

  /** Whether the signature Overcharge is active. */
  private overchargeActive  = false;
  private overchargeTimer   = 0;
  private readonly OVERCHARGE_DURATION_MS = 4_000;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:              MAX_HP,
      speed:              SPEED,
      aggroRadius:        380,
      proximityRadius:    220,
      attackDamage:       14,     // melee punch — decent but not the primary tool
      color:              0x556b2f,  // olive-drab placeholder rect
      meleeRange:         MELEE_R,
      attackCooldownMs:   800,
      projectileDamage:   PROJ_DAMAGE,
      projectileSpeed:    PROJ_SPEED,
      projectileColor:    PROJ_COLOR,
      dashSpeedMultiplier: 4.0,    // shorter dash than Tinkerer's 5× (heavier kit)
      dashDurationMs:     220,
      // No sprite yet — the entity will render as an olive-drab rectangle.
      // Once 'combat-engineer' is generated by PixelLab and assembled, set this:
      //   spriteKey: 'combat-engineer',
    });

    // Tier tag — used by tier-aware UI (arena select, HUD tier badge).
    this.setData('tier', 3);

    // Exo-frame passive: 12% flat incoming damage reduction.
    // Applied before any other multipliers via LivingEntity.damageReduction.
    this.damageReduction = DMG_REDUCE;
  }

  // ── Deploy actions (called by CombatArenaScene key handlers) ─────────────────

  /** Returns true if a turret can be placed right now. */
  get turretReady(): boolean {
    return this.turretCd <= 0 && this.turretCount < TURRET.cap;
  }
  get droneReady(): boolean {
    return this.droneCd <= 0 && this.droneCount < DRONE.cap;
  }
  get mineReady(): boolean {
    return this.mineCd <= 0 && this.mineCount < MINE.cap;
  }
  get shieldReady(): boolean {
    return this.shieldCd <= 0 && this.shieldCount < SHIELD.cap;
  }

  /** Remaining cooldown in ms for each deploy slot (0 = ready). */
  get turretCooldownMs(): number  { return this.turretCd; }
  get droneCooldownMs():  number  { return this.droneCd; }
  get mineCooldownMs():   number  { return this.mineCd; }
  get shieldCooldownMs(): number  { return this.shieldCd; }

  /** Place a Sentry Turret at the engineer's feet (if ready). */
  deployTurret(): void {
    if (!this.turretReady) return;
    const t = new SentryTurret(this.scene, this.x, this.y, this, () => this.opponents);
    this.deployMgr.add(t);
    this.turretCount++;
    this.turretCd = TURRET.cooldownMs;
    // Decrement counter when the turret is removed.
    t.once('destroy', () => { this.turretCount = Math.max(0, this.turretCount - 1); });
  }

  /** Spawn a Scout Drone that orbits the engineer. */
  deployDrone(): void {
    if (!this.droneReady) return;
    const d = new ScoutDrone(this.scene, this.x, this.y, this, () => this.opponents);
    this.deployMgr.add(d);
    this.droneCount++;
    this.droneCd = DRONE.cooldownMs;
    d.once('destroy', () => { this.droneCount = Math.max(0, this.droneCount - 1); });
  }

  /** Plant a Proximity Mine at the engineer's feet. */
  deployMine(): void {
    if (!this.mineReady) return;
    const m = new ProximityMine(this.scene, this.x, this.y, this, () => this.opponents);
    this.deployMgr.add(m);
    this.mineCount++;
    this.mineCd = MINE.cooldownMs;
    m.once('destroy', () => { this.mineCount = Math.max(0, this.mineCount - 1); });
  }

  /**
   * Erect a Barrier Shield oriented perpendicular to the engineer's current
   * movement direction. Falls back to facing right when standing still.
   */
  deployShield(facingAngle = 0): void {
    if (!this.shieldReady) return;
    const s = new BarrierShield(this.scene, this.x, this.y, this, facingAngle);
    this.deployMgr.add(s);
    this.shieldCount++;
    this.shieldCd = SHIELD.cooldownMs;
    s.once('destroy', () => { this.shieldCount = Math.max(0, this.shieldCount - 1); });
  }

  // ── Signature ability: Deployable Overcharge ──────────────────────────────────

  /**
   * Deployable Overcharge — resets all four deploy cooldowns to 0 and overclocks
   * the Sentry Turret's scan rate for 4 s. Let the hero be aggressive about
   * immediately re-placing kit after popping the overcharge.
   */
  useSignature(): void {
    this.turretCd = 0;
    this.droneCd  = 0;
    this.mineCd   = 0;
    this.shieldCd = 0;

    this.overchargeActive = true;
    this.overchargeTimer  = this.OVERCHARGE_DURATION_MS;
    // Visual cue: brief green flash on the camera (Container entities don't support setTint).
    this.scene.cameras.main.flash(200, 0, 180, 0, true);
  }

  // ── Per-frame tick ────────────────────────────────────────────────────────────

  override updateBehaviour(delta: number): void {
    super.updateBehaviour(delta);  // runs the BT

    // Tick all active deployables.
    this.deployMgr.update(delta);

    // Count-down per-kind cooldown timers.
    if (this.turretCd > 0) this.turretCd = Math.max(0, this.turretCd - delta);
    if (this.droneCd  > 0) this.droneCd  = Math.max(0, this.droneCd  - delta);
    if (this.mineCd   > 0) this.mineCd   = Math.max(0, this.mineCd   - delta);
    if (this.shieldCd > 0) this.shieldCd = Math.max(0, this.shieldCd - delta);

    // Overcharge timer.
    if (this.overchargeActive) {
      this.overchargeTimer -= delta;
      if (this.overchargeTimer <= 0) {
        this.overchargeActive = false;
      }
    }
  }

  /** Clean up all active deployables when the engineer dies or the scene shuts down. */
  destroyDeployables(): void {
    this.deployMgr.destroyAll();
    this.turretCount = 0;
    this.droneCount = 0;
    this.mineCount = 0;
    this.shieldCount = 0;
  }

  /** Snapshot of currently active deployables (used by scene-side projectile targeting). */
  getActiveDeployables(): readonly Deployable[] {
    return this.deployMgr.getActive();
  }

  // ── Behaviour tree ────────────────────────────────────────────────────────────

  /**
   * AI behaviour tree for uncontrolled-hero mode.
   *
   * Mirrors the Tinkerer tree (escape dash → ranged → melee → gap-close → chase
   * → wander). Child D will extend this with Carbine burst-fire and AI deploy
   * triggers (e.g. auto-drop mine when swarmed).
   */
  protected buildTree(): BtNode {
    const swarmPressure = (cx: number, cy: number): number =>
      this.opponents.filter(
        o => o.isAlive &&
          Phaser.Math.Distance.Between(cx, cy, o.x, o.y) < SWARM_R,
      ).length;

    return new BtSelector([

      // 1. Escape dash when swarmed at low HP — back away from the crowd centroid.
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx =>
            swarmPressure(ctx.x, ctx.y) >= SWARM_CAP &&
            ctx.hp < ctx.maxHp * 0.7,    // slightly lower threshold than Tinkerer
          ),
          new BtAction(ctx => {
            const near = this.opponents.filter(
              o => o.isAlive &&
                Phaser.Math.Distance.Between(ctx.x, ctx.y, o.x, o.y) < SWARM_R,
            );
            const avgX = near.reduce((s, o) => s + o.x, 0) / near.length;
            const avgY = near.reduce((s, o) => s + o.y, 0) / near.length;
            ctx.dash(ctx.x + (ctx.x - avgX) * 3, ctx.y + (ctx.y - avgY) * 3);
            return 'success';
          }),
        ]),
        4000,
      ),

      // 2. Melee bash — only at close range and when not overwhelmed.
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

      // 3. Carbine (placeholder pistol-style until Child D burst-fire lands).
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= RANGED_MIN && d <= RANGED_MAX;
          }),
          new BtAction(ctx => {
            this.attackAnimId = 'attack_ranged';
            const shotAngle = Math.atan2(
              ctx.opponent!.y - ctx.y,
              ctx.opponent!.x - ctx.x,
            );
            ctx.shootAt(ctx.opponent!.x, ctx.opponent!.y);
            this.scene.events.emit('hero-shot', ctx.x, ctx.y, shotAngle);
            return 'success';
          }),
        ]),
        820,  // ms — slightly slower than Tinkerer burst to reflect single-shot placeholder
      ),

      // 4. Gap-close dash toward target.
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
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

      // 5. Chase target.
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 6. Wander when no opponents visible.
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
