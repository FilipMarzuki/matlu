/**
 * BroodMother — slow, very-high-HP mid-boss that continuously spawns Spinelings
 * via four egg sacs positioned in a diamond around her body.
 *
 * ## Egg sacs
 * Each of the four sacs (EggSac) is a separate CombatEntity with its own 40-HP
 * pool and visible HP bar. Sacs are placed 50 px from the BroodMother at spawn
 * and remain stationary for the entire fight. Heroes can target and destroy
 * individual sacs — each destroyed sac cuts the spawn rate by 25%.
 *
 * Sacs emit `'broodmother-spawn-spineling'` scene events carrying the freshly
 * constructed Spineling. `CombatArenaScene.registerBroodMother()` subscribes
 * to these events and wires each Spineling into the arena system (physics,
 * aliveEnemies, setOpponent) — satisfying the "no direct physics calls" rule.
 *
 * ## BroodMother combat
 * After all sacs are gone she fights directly: slow drift toward the hero +
 * a hard-hitting smash. Her high HP (300) makes her a sustained fight even
 * without the spawns.
 *
 * ## Spawn positions (diamond, 50 px radius)
 *   index 0 — top     (x,     y-50)
 *   index 1 — right   (x+50,  y   )
 *   index 2 — bottom  (x,     y+50)
 *   index 3 — left    (x-50,  y   )
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
import { Spineling } from './Spineling';

// ── Sac constants ────────────────────────────────────────────────────────────

const SAC_MAX_HP    = 40;
const SAC_SPAWN_MS  = 2000;  // ms between Spineling spawns per sac
const SAC_RADIUS    = 50;    // px from BroodMother center
const COLOR_SAC     = 0xb5651d;  // leathery brown

/** Offsets for the four sac positions (diamond pattern). */
const SAC_OFFSETS: [number, number][] = [
  [0,           -SAC_RADIUS],   // top
  [SAC_RADIUS,  0          ],   // right
  [0,            SAC_RADIUS],   // bottom
  [-SAC_RADIUS, 0          ],   // left
];

// ── EggSac ───────────────────────────────────────────────────────────────────

/**
 * EggSac — a stationary, destroyable spawn structure.
 *
 * Extends CombatEntity so it gets:
 *   - HP tracking via `takeDamage()` / `isAlive`
 *   - A visible HP bar (drawn as part of CombatEntity's container)
 *   - Physics body wired in by CombatArenaScene.registerBroodMother()
 *   - Hero targeting (the hero can select sacs as attack targets)
 *
 * `buildTree()` returns a single always-running no-op action because the sac
 * never moves or attacks — it just sits there and absorbs damage.
 *
 * The spawn timer fires `'broodmother-spawn-spineling'` on the scene event bus
 * each cycle. CombatArenaScene's handler is responsible for wiring the Spineling
 * into the arena system; EggSac itself makes no direct `physics.add` calls.
 */
export class EggSac extends CombatEntity {
  private spawnTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const config: CombatEntityConfig = {
      maxHp:            SAC_MAX_HP,
      speed:            0,
      aggroRadius:      0,
      attackDamage:     0,
      color:            COLOR_SAC,
      meleeRange:       0,
      attackCooldownMs: 99999,
    };
    super(scene, x, y, config);
  }

  /** Begin firing the Spineling spawn timer. Call after physics is wired up. */
  startSpawning(): void {
    this.stopSpawning();
    this.spawnTimer = this.scene.time.addEvent({
      delay:         SAC_SPAWN_MS,
      callback:      this.doSpawn,
      callbackScope: this,
      loop:          true,
    });
  }

  stopSpawning(): void {
    if (this.spawnTimer) {
      this.spawnTimer.remove();
      this.spawnTimer = null;
    }
  }

  private doSpawn(): void {
    if (!this.isAlive) return;
    const spineling = new Spineling(this.scene, this.x, this.y);
    // CombatArenaScene listens for this event and wires the enemy in.
    this.scene.events.emit('broodmother-spawn-spineling', spineling);
  }

  protected override buildTree(): BtNode {
    // Sac never moves or attacks — the BT is a no-op placeholder.
    return new BtAction(_ctx => 'running');
  }

  protected override onDeath(): void {
    // Stop spawning BEFORE super.onDeath() calls destroy() — timer must
    // not fire on a dead sac.
    this.stopSpawning();
    this.scene.events.emit('sac-destroyed');
    super.onDeath();
  }
}

// ── BroodMother constants ─────────────────────────────────────────────────────

const BM_MAX_HP         = 300;
const BM_SPEED          = 35;
const BM_ATTACK_DAMAGE  = 30;
const BM_MELEE_RANGE    = 50;
const BM_ATTACK_CD_MS   = 1500;
const COLOR_BM          = 0x5c3317;  // dark reddish-brown carapace

// ── BroodMother ───────────────────────────────────────────────────────────────

export class BroodMother extends CombatEntity {
  /** Live references to the four egg sacs. Null entries = destroyed sac. */
  private readonly sacs: Array<EggSac | null> = [null, null, null, null];

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const config: CombatEntityConfig = {
      maxHp:            BM_MAX_HP,
      speed:            BM_SPEED,
      aggroRadius:      200,
      attackDamage:     BM_ATTACK_DAMAGE,
      color:            COLOR_BM,
      meleeRange:       BM_MELEE_RANGE,
      attackCooldownMs: BM_ATTACK_CD_MS,
    };
    super(scene, x, y, config);

    // Create four egg sacs at fixed offsets. They are separate scene entities —
    // not container children — so each can have its own physics body.
    for (let i = 0; i < 4; i++) {
      const [ox, oy] = SAC_OFFSETS[i];
      this.sacs[i] = new EggSac(scene, x + ox, y + oy);
    }

    // Track sac destructions to null out our references.
    scene.events.on('sac-destroyed', () => {
      for (let i = 0; i < 4; i++) {
        if (this.sacs[i] !== null && !this.sacs[i]!.isAlive) {
          this.sacs[i] = null;
        }
      }
    });
  }

  /** Read-only view of the four sac slots (null = destroyed). */
  getSacs(): ReadonlyArray<EggSac | null> {
    return this.sacs;
  }

  /**
   * Returns the number of sacs currently alive (0–4).
   * Used to decide spawn rate in the UI / debug HUD if needed.
   */
  get liveSacCount(): number {
    return this.sacs.filter(s => s !== null).length;
  }

  // ── Behaviour tree ─────────────────────────────────────────────────────────

  protected override buildTree(): BtNode {
    return new BtSelector([

      // 1. Melee smash when the hero is in range.
      new BtSequence([
        new BtCondition(_ctx => {
          if (this.attackTimer > 0) return false;
          const opp = this.findNearestLivingOpponent();
          if (!opp) return false;
          return Phaser.Math.Distance.Between(this.x, this.y, opp.x, opp.y) < BM_MELEE_RANGE;
        }),
        new BtAction(ctx => {
          const opp = this.findNearestLivingOpponent();
          if (!opp) return 'failure';
          opp.takeDamage(this.attackDamage);
          opp.onHitBy(this.x, this.y);
          this.attackTimer = this.attackCooldownMs;
          ctx.stop();
          return 'success';
        }),
      ]),

      // 2. Slow drift toward the hero.
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 3. Wander if no hero visible.
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }

  protected override onDeath(): void {
    // Destroy any sacs that survived the fight.
    for (const sac of this.sacs) {
      if (sac && sac.isAlive) {
        sac.stopSpawning();
        if (sac.active) sac.destroy();
      }
    }
    super.onDeath();
  }
}
