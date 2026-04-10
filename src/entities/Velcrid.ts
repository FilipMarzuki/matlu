import Phaser from 'phaser';
import { CombatEntity } from './CombatEntity';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
} from '../ai/BehaviorTree';

// ── Velcrid family — Tunnel Reavers ───────────────────────────────────────────
//
// Two life stages, not two specialised castes. A Velcrid hatchling is fast and
// surface-active; a fully grown adult is slower, heavier, and prefers to move
// underground. Both can burrow. Both attack with a short jump on the surface
// rather than a long-range dash.
//
// Blackboard coordination:
//   velcridScoutsOrbiting  — juveniles write this while circling, adults read it
//                            to trigger faster burrow cycles.
//   velcridSoldierChargeCd — adults write this after emerging, staggering
//                            simultaneous eruptions.

/** Emit dirt-burst arcs at a world position — used for burrow / surface. */
function emitDigBurst(scene: Phaser.Scene, x: number, y: number): void {
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
    const dist  = 8 + Math.random() * 8;
    const dot   = scene.add.arc(x, y, 2, 0, 360, false, 0x6a5038);
    dot.setDepth(10);
    scene.tweens.add({
      targets:  dot,
      x:        x + Math.cos(angle) * dist,
      y:        y + Math.sin(angle) * dist,
      alpha:    { from: 0.9, to: 0 },
      duration: 220,
      ease:     'Cubic.easeOut',
      onComplete: () => dot.destroy(),
    });
  }
}

/**
 * VelcridJuvenile — young Velcrid, surface-active.
 *
 * Fast, small, circles the player to hold attention ("It circled. Short
 * movements. Stop. Shift."). Attacks with a short hop rather than a long lunge.
 * Can burrow but prefers surface movement. Broadcasts velcridScoutsOrbiting
 * while circling so adults below ground know the player is occupied.
 */
export class VelcridJuvenile extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp: 22, speed: 118, aggroRadius: 480, attackDamage: 7,
      color: 0x2e3a18, meleeRange: 22, attackCooldownMs: 680,
      // Short hop — 2.5× speed for 80 ms ≈ ~24 px of travel
      dashSpeedMultiplier: 2.5, dashDurationMs: 80,
    });
  }

  protected buildTree(): BtNode {
    const MELEE_R  = this.meleeRange;
    const ORBIT_R  = 120;   // px — circling radius
    const ORBIT_MS = 900;   // ms orbiting before hopping in

    type Phase = 'orbit' | 'hop' | 'recover';
    let phase: Phase = 'orbit';
    // Stagger so multiple juveniles don't all hop at the same instant
    let orbitTimer  = Phaser.Math.Between(0, 500);
    let phaseTimer  = 0;
    let orbitCw     = Math.random() < 0.5;
    let hopTargetX  = 0;
    let hopTargetY  = 0;

    return new BtSelector([
      // 1. Melee if adjacent — can interrupt any orbit phase
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < MELEE_R,
        ),
        new BtAction(ctx => { ctx.attack(); ctx.stop(); return 'success'; }),
      ]),

      // 2. Orbit → short hop → recover
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction((ctx, delta) => {
          const opp = ctx.opponent!;
          phaseTimer = Math.max(0, phaseTimer - delta);

          if (phase === 'orbit') {
            // Keep the "juveniles circling" signal hot — adults underground
            // read this to know the player is held in place.
            if (this.blackboard) this.blackboard.velcridScoutsOrbiting = 200;

            orbitTimer += delta;
            ctx.orbitAround(opp.x, opp.y, ORBIT_R, orbitCw);

            if (orbitTimer >= ORBIT_MS) {
              // Commit hop position at last orbit moment
              hopTargetX = opp.x;
              hopTargetY = opp.y;
              phase      = 'hop';
              phaseTimer = 80; // matches dashDurationMs
              orbitTimer = 0;
            }

          } else if (phase === 'hop') {
            // Short burst — very brief, surprises without crossing the whole arena
            ctx.dash(hopTargetX, hopTargetY);
            if (phaseTimer <= 0) {
              phase   = 'recover';
              phaseTimer = 400;
              orbitCw = !orbitCw; // approach from opposite arc next cycle
            }

          } else {
            // Recover: stand still briefly, then resume circling
            ctx.stop();
            if (phaseTimer <= 0) phase = 'orbit';
          }

          return 'running';
        }),
      ]),

      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}

/**
 * VelcridAdult — mature Velcrid, primarily subterranean.
 *
 * Heavier and slower on the surface, but uses burrow as its main movement
 * tool: submerges, advances underground at reduced speed (low alpha = hard
 * to see coming), then surfaces near the player with a short jump-charge.
 *
 * Reads velcridScoutsOrbiting — if juveniles are active, burrow cycle
 * triggers 60 % sooner (player is occupied = ideal time to close in).
 * Writes velcridSoldierChargeCd after emerging to stagger simultaneous
 * eruptions from multiple adults.
 */
export class VelcridAdult extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp: 95, speed: 45, aggroRadius: 420, attackDamage: 20,
      color: 0x0e1a08, meleeRange: 36, attackCooldownMs: 1150,
      // Short jump on emerge — 2.8× speed for 100 ms ≈ ~36 px
      dashSpeedMultiplier: 2.8, dashDurationMs: 100,
    });
  }

  protected buildTree(): BtNode {
    const MELEE_R      = this.meleeRange;
    const HOLD_R       = 160;   // px — surface standoff distance
    const BURROW_CD    = 3200;  // ms between burrow cycles
    const BURROW_MS    = 2000;  // ms spent underground
    const BURROW_SPEED = 0.28;  // fraction of speed while underground
    const SURFACE_MS   = 260;   // ms of emerge animation before jump
    const RECOVERY_MS  = 580;   // ms stunned after jump
    const BB_STAGGER   = 2200;  // ms placed on blackboard after emerging

    type Phase = 'hold' | 'burrowing' | 'emerging' | 'jump' | 'recover';
    let phase: Phase  = 'hold';
    // Random offset prevents all adults burrowing at the same time
    let burrowCd      = BURROW_CD * Math.random();
    let phaseTimer    = 0;
    let jumpTargetX   = 0;
    let jumpTargetY   = 0;

    return new BtSelector([
      // 1. Melee if adjacent
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < MELEE_R,
        ),
        new BtAction(ctx => { ctx.attack(); ctx.stop(); return 'success'; }),
      ]),

      // 2. Hold / burrow / emerge / jump state machine
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction((ctx, delta) => {
          const opp      = ctx.opponent!;
          const dist     = Phaser.Math.Distance.Between(ctx.x, ctx.y, opp.x, opp.y);
          const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;

          burrowCd   = Math.max(0, burrowCd   - delta);
          phaseTimer = Math.max(0, phaseTimer - delta);

          // ── Recover (brief stun after jump) ───────────────────────────────
          if (phase === 'recover') {
            ctx.stop();
            if (phaseTimer <= 0) { phase = 'hold'; burrowCd = BURROW_CD; }
            return 'running';
          }

          // ── Jump: short burst at locked surface target ─────────────────────
          if (phase === 'jump') {
            ctx.dash(jumpTargetX, jumpTargetY);
            if (phaseTimer <= 0) { phase = 'recover'; phaseTimer = RECOVERY_MS; }
            return 'running';
          }

          // ── Emerging: surface animation, then immediately jump ─────────────
          if (phase === 'emerging') {
            ctx.stop();
            if (phaseTimer <= 0) {
              jumpTargetX = opp.x;
              jumpTargetY = opp.y;
              phase       = 'jump';
              phaseTimer  = 100; // matches dashDurationMs
              if (this.blackboard) this.blackboard.velcridSoldierChargeCd = BB_STAGGER;
            }
            return 'running';
          }

          // ── Burrowing: slow underground advance ────────────────────────────
          if (phase === 'burrowing') {
            if (physBody) {
              const angle = Phaser.Math.Angle.Between(ctx.x, ctx.y, opp.x, opp.y);
              physBody.setVelocity(
                Math.cos(angle) * this.speed * BURROW_SPEED,
                Math.sin(angle) * this.speed * BURROW_SPEED,
              );
            }
            if (phaseTimer <= 0) {
              // Check blackboard: if another adult just surfaced, wait longer
              const bbClear = (this.blackboard?.velcridSoldierChargeCd ?? 0) <= 0;
              if (!bbClear) {
                phaseTimer = 700; // stay underground a bit longer
                return 'running';
              }
              // Surface
              phase      = 'emerging';
              phaseTimer = SURFACE_MS;
              emitDigBurst(this.scene, this.x, this.y);
              this.scene.tweens.add({
                targets:  this,
                alpha:    { from: 0.18, to: 1 },
                duration: SURFACE_MS,
                ease:     'Cubic.easeOut',
              });
              this.scene.tweens.add({
                targets:  this,
                scaleX:   { from: 0.8, to: 1 },
                scaleY:   { from: 0.8, to: 1 },
                duration: SURFACE_MS,
                ease:     'Back.easeOut',
              });
            }
            return 'running';
          }

          // ── Hold: pace at surface standoff distance ────────────────────────
          if (dist > HOLD_R + 25)      ctx.moveToward(opp.x, opp.y);
          else if (dist < HOLD_R - 25) ctx.steerAway(opp.x, opp.y);
          else                         ctx.stop();

          // Begin burrow when cooldown ready. If juveniles are circling (player
          // is occupied), trigger 60 % sooner — ideal moment to close in.
          const juvenile = (this.blackboard?.velcridScoutsOrbiting ?? 0) > 0;
          const timeReady = burrowCd <= 0 || (juvenile && burrowCd < BURROW_CD * 0.4);

          if (timeReady) {
            phase      = 'burrowing';
            phaseTimer = BURROW_MS;
            emitDigBurst(this.scene, this.x, this.y);
            this.scene.tweens.add({
              targets:  this,
              alpha:    { from: 1, to: 0.18 },
              duration: 320,
              ease:     'Cubic.easeIn',
            });
          }

          return 'running';
        }),
      ]),

      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
