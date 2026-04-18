import * as Phaser from 'phaser';
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
export function emitDigBurst(scene: Phaser.Scene, x: number, y: number): void {
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
 *
 * Movement feel improvements:
 *   - Per-instance orbit radius (95–145 px) so grouped juveniles don't stack
 *     on an identical ring.
 *   - Recover phase drifts backward rather than stopping dead — continuous
 *     motion removes the mechanical start-stop rhythm.
 *   - Wider initial stagger (0–800 ms) prevents synchronised hops.
 */
export class VelcridJuvenile extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp: 22, speed: 118, aggroRadius: 480, attackDamage: 7,
      color: 0x2e3a18, meleeRange: 22, attackCooldownMs: 680,
      // Short hop — 2.5× speed for 80 ms ≈ ~24 px of travel
      dashSpeedMultiplier: 2.5, dashDurationMs: 80,
      spriteKey: 'mini-velcrid', spriteTint: 0x88cc44, spriteScale: 0.28,
      // Short memory — juveniles are dumb swarm creatures. 1 s lets them close in
      // if the player ducks behind cover briefly, but they lose the trail quickly.
      sightMemoryMs: 1000,
      // Insect swarm hearing — sensitive to nearby impacts. 220 px lets them
      // react to a fight in the same room without triggering from across the arena.
      hearingRadius: 220,
      // Surface-adapted night vision — juveniles forage in low-light conditions
      // but aren't true underground predators. 0.3 = they spot a lit hero at
      // full range, a dark-corner hero at ~40% range.
      darkvision: 0.3,
      // Insect chirp vocalisations — 3 variants, random pitch shift in the 1.2–1.55
      // range makes each one feel slightly different. 2–8 s interval is irregular
      // enough to feel organic rather than mechanical. Volume is low so a swarm of
      // 6+ juveniles doesn't become overwhelming (distance attenuation in scene).
      // Audio files: public/assets/audio/creatures/mini-velcrid-chirp-{0,1,2}.ogg
      // (source from freesound.org — search "insect click short CC0")
      ambientSounds: {
        keys:          ['sfx-velcrid-chirp-0', 'sfx-velcrid-chirp-1', 'sfx-velcrid-chirp-2'],
        intervalMinMs: 2000,
        intervalMaxMs: 8000,
        volume:        0.22,
        pitchMin:      1.20,
        pitchMax:      1.55,
      },
      // Combat sounds — pitch-shifted high (1.1–1.4×) to emphasise the creature's
      // small size. Aggro is the sharpest/most distinct since it signals "I see you".
      // Placeholder files from CC0 libraries; replace with creature-specific recordings.
      combatSounds: {
        aggro:   'sfx-velcrid-aggro',
        attack:  'sfx-velcrid-attack',
        hurt:    'sfx-velcrid-hurt',
        death:   'sfx-velcrid-death',
        volume:  0.55,
        pitchMin: 1.10,
        pitchMax: 1.40,
      },
    });
  }

  protected buildTree(): BtNode {
    const MELEE_R  = this.meleeRange;
    // Per-instance radius: 95–145 px so groups don't orbit on a perfect ring.
    const ORBIT_R  = Phaser.Math.Between(95, 145);
    const ORBIT_MS = 900;   // ms orbiting before hopping in

    type Phase = 'orbit' | 'hop' | 'recover';
    let phase: Phase = 'orbit';
    // Wider stagger — three spawned juveniles are unlikely to hop simultaneously.
    let orbitTimer  = Phaser.Math.Between(0, 800);
    let phaseTimer  = 0;
    let orbitCw     = Math.random() < 0.5;
    let hopTargetX  = 0;
    let hopTargetY  = 0;

    return new BtSelector([
      // 1. Melee if adjacent AND in sight — can interrupt any orbit phase.
      //    Requires canSeeTarget so the juvenile can't attack through walls.
      new BtSequence([
        new BtCondition(ctx =>
          this.canSeeTarget &&
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < MELEE_R,
        ),
        new BtAction(ctx => { ctx.attack(); ctx.stop(); return 'success'; }),
      ]),

      // 2. Full orbit → short hop → recover — only when target is in sight.
      //    Special movement patterns are reserved for active visual contact.
      new BtSequence([
        new BtCondition(ctx => this.canSeeTarget && ctx.opponent !== null),
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
              phase      = 'recover';
              phaseTimer = 200; // shortened from 400 ms
              orbitCw    = !orbitCw; // approach from opposite arc next cycle
            }

          } else {
            // Recover: drift backward away from the hop target at low speed so
            // the juvenile keeps moving rather than freezing dead in place.
            const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
            if (physBody) {
              const awayX = this.x - hopTargetX;
              const awayY = this.y - hopTargetY;
              const len   = Math.sqrt(awayX * awayX + awayY * awayY) || 1;
              physBody.setVelocity((awayX / len) * 40, (awayY / len) * 40);
            }
            if (phaseTimer <= 0) phase = 'orbit';
          }

          return 'running';
        }),
      ]),

      // 3. Move toward last-known position during the sight-memory window.
      //    ctx.opponent is set to lastKnownPosition by CombatEntity when
      //    !canSeeTarget but the memory window hasn't expired yet.
      //    This gives the juvenile a natural "searching" behaviour — it walks
      //    to the spot where it lost sight, then falls through to wander.
      new BtSequence([
        new BtCondition(ctx => !this.canSeeTarget && ctx.opponent !== null),
        new BtAction(ctx => { ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y); return 'running'; }),
      ]),

      // 4. Unaware activity: wander → dig-pause → wander.
      //    When no target is visible the juvenile pokes at the ground for a
      //    moment before moving on — makes idle groups feel occupied rather
      //    than endlessly drifting. The dig-burst at transition is the same
      //    VFX used by adults so the family reads as one creature type.
      (() => {
        type UAPhase = 'wander' | 'dig';
        let uaPhase: UAPhase = 'wander';
        let uaTimer = Phaser.Math.Between(2000, 4500);
        return new BtAction((ctx, d) => {
          uaTimer = Math.max(0, uaTimer - d);
          if (uaPhase === 'wander') {
            ctx.wander(d);
            if (uaTimer <= 0) {
              uaPhase = 'dig';
              uaTimer = Phaser.Math.Between(1200, 2400);
              ctx.stop();
              emitDigBurst(this.scene, this.x, this.y);
            }
          } else {
            // Idle animation plays automatically when velocity is zero.
            ctx.stop();
            if (uaTimer <= 0) {
              uaPhase = 'wander';
              uaTimer = Phaser.Math.Between(2000, 4500);
            }
          }
          return 'running';
        });
      })(),
    ]);
  }
}

/**
 * BabyVelcrid — hatchling, the simplest enemy in m1.
 *
 * Very small, fast direct rusher. No dash, no special behaviour — just finds
 * the nearest target and charges straight at it. Comes in large groups.
 * Small scale + light pink tint distinguishes it from VelcridJuvenile.
 */
export class BabyVelcrid extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp: 12, speed: 130, aggroRadius: 500, attackDamage: 5,
      color: 0x8a1a1a, meleeRange: 20, attackCooldownMs: 600,
      spriteKey: 'mini-velcrid', spriteTint: 0xff9999, spriteScale: 0.22,
      sightMemoryMs: 800,
      // Hatchlings are less individually alert but still react to nearby impacts.
      hearingRadius: 160,
      // Hatchlings are newly hatched and have minimal light adaptation.
      // Very short darkvision — they rely on numbers, not individual senses.
      darkvision: 0.1,
    });
  }

  protected buildTree(): BtNode {
    const R = this.meleeRange;

    // Unaware activity: wander → huddle-still → wander.
    // Hatchlings cluster and twitch rather than digging — too small to burrow.
    // A brief freeze every few seconds breaks the mechanical drift rhythm.
    let uaTimer = Phaser.Math.Between(1000, 2500);
    let uaHuddle = false;

    return new BtSelector([
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < R,
        ),
        new BtAction(ctx => { ctx.attack(); ctx.stop(); return 'success'; }),
      ]),
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => { ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y); return 'running'; }),
      ]),
      new BtAction((ctx, d) => {
        uaTimer = Math.max(0, uaTimer - d);
        if (uaHuddle) {
          ctx.stop();
          if (uaTimer <= 0) { uaHuddle = false; uaTimer = Phaser.Math.Between(1500, 3000); }
        } else {
          ctx.wander(d);
          if (uaTimer <= 0) { uaHuddle = true; uaTimer = Phaser.Math.Between(500, 1200); }
        }
        return 'running';
      }),
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
 * triggers 60% sooner (player is occupied = ideal time to close in).
 * Writes velcridSoldierChargeCd after emerging to stagger simultaneous
 * eruptions from multiple adults.
 *
 * Movement feel improvements:
 *   - Randomised surface target: each adult picks a random point 35–55 px
 *     from the player at burrow-start so multiple adults surface from
 *     different angles rather than clustering.
 *   - Separation force suppressed while underground (suppressSeparation flag)
 *     so ally-push can't deflect the slow burrow approach.
 *   - Micro-shuffle in hold phase: small periodic velocity noise makes the
 *     adult shift its weight rather than standing frozen at the standoff ring.
 */
export class VelcridAdult extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp: 95, speed: 45, aggroRadius: 420, attackDamage: 20,
      color: 0x0e1a08, meleeRange: 36, attackCooldownMs: 1150,
      // Short jump on emerge — 2.8× speed for 100 ms ≈ ~36 px
      dashSpeedMultiplier: 2.8, dashDurationMs: 100,
      spriteKey: 'mini-velcrid', spriteTint: 0x446622, spriteScale: 0.48,
      // Long memory — adults are smarter apex predators. 3 s gives them time to
      // circle behind cover looking for a re-engagement angle.
      sightMemoryMs: 3000,
      // Apex predator — best hearing in the velcrid family. Reacts to any
      // loud impact within 300 px; will surface to investigate.
      hearingRadius: 300,
      // Near-true darkvision — adults live underground and hunt in total darkness.
      // 0.8 means they lose only ~20% of sight range even in pitch black.
      darkvision: 0.8,
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
    // Random offset prevents all adults burrowing at the same time.
    let burrowCd      = BURROW_CD * Math.random();
    let phaseTimer    = 0;
    let jumpTargetX   = 0;
    let jumpTargetY   = 0;
    // Fixed intercept point set at burrow-start — randomised angle so adults
    // don't all surface from the same spot.
    let burrowTargetX = 0;
    let burrowTargetY = 0;
    // Micro-shuffle state for hold phase.
    let shuffleVx     = 0;
    let shuffleVy     = 0;
    let shuffleTimer  = 0;

    // ── Unaware patrol-burrow state ────────────────────────────────────────────
    // Adults occasionally submerge and reposition even without a target —
    // they surface at a new spot, which makes them feel restless and predatory
    // rather than just standing around. Burrow distances are short (50–130 px)
    // since this is repositioning, not an attack run.
    const UB_BURROW_MS    = 1600;  // ms spent underground
    const UB_SURFACE_MS   = 220;   // ms of emerge before idle
    const UB_BURROW_SPEED = 0.20;  // fraction of speed underground
    type UBPhase = 'idle' | 'burrowing' | 'emerging';
    let ubPhase: UBPhase  = 'idle';
    // Stagger so multiple adults don't patrol-burrow simultaneously.
    let ubTimer = Phaser.Math.Between(5000, 10000);
    let ubTargetX = 0;
    let ubTargetY = 0;

    return new BtSelector([
      // 1. Melee if adjacent AND in sight.
      //    Requires canSeeTarget — the adult can't attack through walls.
      new BtSequence([
        new BtCondition(ctx =>
          this.canSeeTarget &&
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < MELEE_R,
        ),
        new BtAction(ctx => { ctx.attack(); ctx.stop(); return 'success'; }),
      ]),

      // 2. Hold / burrow / emerge / jump state machine — only when in sight.
      //    The adult's burrow is its main weapon; initiating it without visual
      //    contact on the target would result in surfacing at a stale position.
      new BtSequence([
        new BtCondition(ctx => this.canSeeTarget && ctx.opponent !== null),
        new BtAction((ctx, delta) => {
          const opp      = ctx.opponent!;
          const dist     = Phaser.Math.Distance.Between(ctx.x, ctx.y, opp.x, opp.y);
          const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;

          burrowCd   = Math.max(0, burrowCd   - delta);
          phaseTimer = Math.max(0, phaseTimer - delta);

          // ── Recover (brief stun after jump) ───────────────────────────────
          if (phase === 'recover') {
            ctx.stop();
            if (phaseTimer <= 0) {
              phase = 'hold';
              burrowCd = BURROW_CD;
              this.suppressSeparation = false; // re-enable ally separation on surface
            }
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

          // ── Burrowing: slow underground advance toward randomised intercept ─
          if (phase === 'burrowing') {
            if (physBody) {
              const angle = Phaser.Math.Angle.Between(
                ctx.x, ctx.y, burrowTargetX, burrowTargetY,
              );
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

          // Micro-shuffle: small periodic velocity noise so the adult shifts
          // its weight rather than standing frozen at the standoff ring.
          shuffleTimer = Math.max(0, shuffleTimer - delta);
          if (shuffleTimer <= 0) {
            shuffleVx    = (Math.random() - 0.5) * 28;
            shuffleVy    = (Math.random() - 0.5) * 28;
            shuffleTimer = 160 + Math.random() * 240;
          }
          if (physBody) {
            physBody.velocity.x += shuffleVx;
            physBody.velocity.y += shuffleVy;
          }

          // Begin burrow when cooldown ready. If juveniles are circling (player
          // is occupied), trigger 60 % sooner — ideal moment to close in.
          const juvenile  = (this.blackboard?.velcridScoutsOrbiting ?? 0) > 0;
          const timeReady = burrowCd <= 0 || (juvenile && burrowCd < BURROW_CD * 0.4);

          if (timeReady) {
            // Randomise the surface intercept point — offset from the opponent
            // by a random angle so multiple adults surface from different spots.
            const surfaceAngle = Math.random() * Math.PI * 2;
            const surfaceDist  = 35 + Math.random() * 20;
            burrowTargetX = opp.x + Math.cos(surfaceAngle) * surfaceDist;
            burrowTargetY = opp.y + Math.sin(surfaceAngle) * surfaceDist;

            phase      = 'burrowing';
            phaseTimer = BURROW_MS;
            // Suppress separation force so ally-push can't deflect the slow
            // underground approach.
            this.suppressSeparation = true;
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

      // 3. Move toward last-known position during the sight-memory window.
      //    ctx.opponent is set to lastKnownPosition by CombatEntity when
      //    !canSeeTarget but the memory window (3 s for adults) hasn't expired.
      //    The adult walks to where it last saw the target, creating a menacing
      //    "stalking" behaviour before giving up and wandering.
      new BtSequence([
        new BtCondition(ctx => !this.canSeeTarget && ctx.opponent !== null),
        new BtAction(ctx => { ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y); return 'running'; }),
      ]),

      // 4. Unaware patrol-burrow: idle → submerge → drift to nearby pos → surface.
      //    Adults are subterranean apex predators; even at rest they don't stay
      //    in one spot. The patrol burrow repositions them ~50–130 px every
      //    5–10 s, making the arena feel inhabited even before combat starts.
      //    Re-uses the same fade/burst VFX as the combat burrow for consistency.
      new BtAction((ctx, d) => {
        const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
        ubTimer = Math.max(0, ubTimer - d);

        if (ubPhase === 'idle') {
          ctx.wander(d);
          if (ubTimer <= 0) {
            // Pick a random nearby point to surface at.
            const angle = Math.random() * Math.PI * 2;
            const dist  = 50 + Math.random() * 80;
            ubTargetX = this.x + Math.cos(angle) * dist;
            ubTargetY = this.y + Math.sin(angle) * dist;
            ubPhase   = 'burrowing';
            ubTimer   = UB_BURROW_MS;
            this.suppressSeparation = true;
            emitDigBurst(this.scene, this.x, this.y);
            this.scene.tweens.add({
              targets: this, alpha: { from: 1, to: 0.18 },
              duration: 300, ease: 'Cubic.easeIn',
            });
          }
        } else if (ubPhase === 'burrowing') {
          // Slow underground drift toward the target point.
          if (physBody) {
            const angle = Phaser.Math.Angle.Between(this.x, this.y, ubTargetX, ubTargetY);
            physBody.setVelocity(
              Math.cos(angle) * this.speed * UB_BURROW_SPEED,
              Math.sin(angle) * this.speed * UB_BURROW_SPEED,
            );
          }
          if (ubTimer <= 0) {
            ubPhase = 'emerging';
            ubTimer = UB_SURFACE_MS;
            this.suppressSeparation = false;
            emitDigBurst(this.scene, this.x, this.y);
            this.scene.tweens.add({
              targets: this, alpha: { from: 0.18, to: 1 },
              duration: UB_SURFACE_MS, ease: 'Cubic.easeOut',
            });
          }
        } else {
          // Emerging: brief pause while surfacing, then back to idle wander.
          ctx.stop();
          if (ubTimer <= 0) {
            ubPhase = 'idle';
            ubTimer = Phaser.Math.Between(5000, 10000);
          }
        }
        return 'running';
      }),
    ]);
  }
}
