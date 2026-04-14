import Phaser from 'phaser';
import { CombatEntity, Skald, Spider, Skag, Crow } from '../entities/CombatEntity';
import { Projectile } from '../entities/Projectile';
import { WorldState } from '../world/WorldState';
import { ArenaBlackboard } from '../ai/ArenaBlackboard';
import { SoundEventSystem } from '../world/SoundEventSystem';

// ── Wave & hero type definitions ──────────────────────────────────────────────

/**
 * Describes one round of combat: what enemies spawn.
 * The arena handles positioning and physics — WaveConfig only defines *what*.
 *
 * To add a new wave, push an entry to WAVE_SEQUENCE below.
 */
interface WaveConfig {
  label: string;
  /** Constructor list — one entry per enemy to spawn. Order doesn't matter. */
  enemies: (new (scene: Phaser.Scene, x: number, y: number) => CombatEntity)[];
}

/**
 * A hero that takes a turn in the arena.
 * Add new heroes to HERO_ROSTER as they are implemented.
 */
interface HeroConfig {
  name: string;
  build(scene: Phaser.Scene, x: number, y: number): CombatEntity;
}

// ── Rosters ───────────────────────────────────────────────────────────────────

/**
 * Heroes cycle through in order. When a hero finishes all waves, the next
 * hero takes over from Wave 1. Extend as new hero classes are implemented.
 */
const HERO_ROSTER: HeroConfig[] = [
  { name: 'Skald',  build: (s, x, y) => new Skald(s, x, y) },
  // { name: 'Valkyrie', build: (s, x, y) => new Valkyrie(s, x, y) },
];

/**
 * Ordered wave sequence. Each hero runs through every wave before handing
 * off to the next hero.
 *
 * Design intent (to fill in as roster grows):
 *   - Waves 1–N:   one hero vs escalating groups of low-level minions
 *   - Waves N+1–M: hero vs level-1 heroes 1v1
 *   - Waves M+1–K: hero vs higher-tier minions in groups
 *   - Waves K+1–Z: hero vs higher-tier heroes 1v1
 *
 * For now we have Draugr as the only minion, so the sequence is three
 * escalating Draugr waves. Hero-vs-hero rounds are added once more
 * hero classes exist.
 */
const WAVE_SEQUENCE: WaveConfig[] = [
  { label: 'Spider Den',      enemies: [Spider, Spider] },
  { label: 'Spider + Skag',   enemies: [Spider, Skag] },
  { label: 'Skag Pack',       enemies: [Skag, Skag] },
  { label: 'Crow Dive',       enemies: [Crow, Crow] },
  { label: 'Horde',           enemies: [Spider, Spider, Skag, Crow] },
];

// ── Scene ─────────────────────────────────────────────────────────────────────

/**
 * CombatArenaScene — structured combat simulation used as the main-menu backdrop.
 *
 * One hero fights through a fixed wave sequence. When all waves are done the
 * next hero begins, cycling indefinitely. Each wave ends when:
 *   - the hero dies, OR
 *   - all enemies are defeated.
 *
 * Both outcomes are treated the same — the next wave starts after 1.5 s.
 * The hero always spawns fresh (full HP) at the start of each wave.
 */
export class CombatArenaScene extends Phaser.Scene {
  static readonly KEY = 'CombatArenaScene';

  private hero!:   CombatEntity;
  private enemies: CombatEntity[] = [];

  private heroIndex = 0;
  private waveIndex = 0;

  /**
   * 'active'    — wave is running, update() ticks all combatants.
   * 'resolving' — wave just ended, waiting for the inter-wave delay.
   */
  private waveState: 'active' | 'resolving' = 'resolving';

  /** In-flight projectiles — ticked each frame, pruned when expired. */
  private projectiles: Projectile[] = [];

  private labelText!:   Phaser.GameObjects.Text;

  /** WorldState instance — tracks conviction for this arena session. */
  private worldState!:   WorldState;
  /** Conviction bar fill rectangle — scaleX mapped to 0–1 conviction fraction. */
  private convBarFill!:  Phaser.GameObjects.Rectangle;
  /**
   * ArenaBlackboard — shared inter-entity state (panic origin, etc.).
   * Updated once per frame; enemies read it to decide swarm reactions.
   */
  private blackboard!:   ArenaBlackboard;
  /**
   * SoundEventSystem — translates loud in-game events (gunshots, deaths)
   * into enemy alertTo() calls so enemies react to noise without LOS.
   */
  private soundSystem!:  SoundEventSystem;

  constructor() {
    super({ key: CombatArenaScene.KEY });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  preload(): void {
    this.load.aseprite(
      'skald',
      'assets/sprites/characters/earth/heroes/skald/skald.png',
      'assets/sprites/characters/earth/heroes/skald/skald.json',
    );
    this.load.aseprite(
      'spider',
      'assets/sprites/characters/earth/enemies/spider/spider.png',
      'assets/sprites/characters/earth/enemies/spider/spider.json',
    );
    this.load.aseprite(
      'skag',
      'assets/sprites/characters/earth/enemies/skag/skag.png',
      'assets/sprites/characters/earth/enemies/skag/skag.json',
    );
    this.load.aseprite(
      'crow',
      'assets/sprites/characters/earth/enemies/crow/crow.png',
      'assets/sprites/characters/earth/enemies/crow/crow.json',
    );
  }

  create(): void {
    this.heroIndex   = 0;
    this.waveIndex   = 0;
    this.enemies     = [];
    this.projectiles = [];

    // WorldState tracks conviction for this arena session (0–100, starts at 50).
    this.worldState = new WorldState(this);
    // ArenaBlackboard shares swarm-coordination state (panic events) between enemies.
    this.blackboard = new ArenaBlackboard();
    // SoundEventSystem listens for scene sound events and alerts nearby enemies.
    // Registered with WorldState so it's torn down cleanly when the scene shuts down.
    this.soundSystem = new SoundEventSystem(this);
    this.worldState.registerSystem(this.soundSystem);

    this.buildArena();

    // Keep the conviction bar in sync whenever the value changes.
    this.events.on('ws:conviction-updated', ({ conviction }: { conviction: number }) => {
      // scaleX 0→1 maps to 0→100% conviction. Origin is at the left edge so
      // the bar grows/shrinks from the left rather than the center.
      this.convBarFill.scaleX = conviction / 100;
    });

    // Register Aseprite animation tags so sprite.play('walk_south') works.
    this.anims.createFromAseprite('skald');
    this.anims.createFromAseprite('spider');
    this.anims.createFromAseprite('skag');
    this.anims.createFromAseprite('crow');
    this.startWave();
  }

  override update(_time: number, delta: number): void {
    if (this.waveState !== 'active') return;

    // Expire stale panic events (they live for ~200 ms).
    this.blackboard.update(delta);

    this.hero.update(delta);
    for (const e of this.enemies) e.update(delta);

    // ── Boids swarm update ─────────────────────────────────────────────────
    // Build a flat cell grid (cellSize = 80 px) from alive enemies so each
    // entity can query its spatial neighbours without O(n²) distance checks.
    // Cells are keyed as "cx,cy" strings — fast enough for ≤20 enemies.
    const CELL = 80;
    const cellMap = new Map<string, CombatEntity[]>();
    for (const e of this.enemies) {
      if (!e.isAlive) continue;
      const key = `${Math.floor(e.x / CELL)},${Math.floor(e.y / CELL)}`;
      if (!cellMap.has(key)) cellMap.set(key, []);
      cellMap.get(key)!.push(e);
    }
    for (const e of this.enemies) {
      if (!e.isAlive) continue;
      const cx = Math.floor(e.x / CELL);
      const cy = Math.floor(e.y / CELL);
      // Query 3×3 neighbourhood (covers ≈240 px radius), capped at 7 entries.
      const neighbours: CombatEntity[] = [];
      outer: for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cell = cellMap.get(`${cx + dx},${cy + dy}`);
          if (!cell) continue;
          for (const n of cell) {
            if (n !== e) {
              neighbours.push(n);
              if (neighbours.length >= 7) break outer;
            }
          }
        }
      }
      e.tickSwarm(neighbours, delta);
    }

    // Tick all in-flight projectiles, then prune ones that have expired.
    for (const p of this.projectiles) p.tick(delta);
    this.projectiles = this.projectiles.filter(p => !p.isExpired);

    // Resolve when the hero falls OR the last enemy is defeated.
    const heroDead     = !this.hero.isAlive;
    const allEnemyDead = this.enemies.length > 0 && this.enemies.every(e => !e.isAlive);

    if (heroDead || allEnemyDead) {
      this.waveState = 'resolving';
      // Short pause so the viewer can see the outcome before the next wave.
      this.time.delayedCall(1500, () => this.advanceWave());
    }
  }

  // ── Arena setup ──────────────────────────────────────────────────────────────

  private buildArena(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const margin = 60;

    const arenaX = margin;
    const arenaY = margin;
    const arenaW = W - margin * 2;
    const arenaH = H - margin * 2;
    const cx     = arenaX + arenaW / 2;
    const cy     = arenaY + arenaH / 2;

    // Dark stone floor.
    this.add.rectangle(cx, cy, arenaW, arenaH, 0x1a1a2a);

    // Grey border + corner accents.
    const gfx = this.add.graphics();
    gfx.lineStyle(3, 0x666677, 1);
    gfx.strokeRect(arenaX, arenaY, arenaW, arenaH);

    const cornerLen = 16;
    gfx.lineStyle(2, 0x9999aa, 0.7);
    for (const [cx2, cy2] of [
      [arenaX, arenaY], [arenaX + arenaW, arenaY],
      [arenaX, arenaY + arenaH], [arenaX + arenaW, arenaY + arenaH],
    ] as [number, number][]) {
      const sx = cx2 === arenaX ? 1 : -1;
      const sy = cy2 === arenaY ? 1 : -1;
      gfx.lineBetween(cx2, cy2, cx2 + sx * cornerLen, cy2);
      gfx.lineBetween(cx2, cy2, cx2, cy2 + sy * cornerLen);
    }

    this.physics.world.setBounds(arenaX + 10, arenaY + 10, arenaW - 20, arenaH - 20);
    this.cameras.main.setBackgroundColor(0x0d0d18);
    this.cameras.main.centerOn(cx, cy);

    // Label: "HeroName • Wave label" — updated at the start of each wave.
    this.labelText = this.add
      .text(cx, arenaY + 16, '', {
        fontSize: '12px',
        color: '#9999bb',
        backgroundColor: '#00000055',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(2);

    // Conviction bar — bottom center of the arena.
    // Shows how decisive the hero's performance is: fills on kills, drains on damage.
    const convW = 120;
    const convH = 8;
    const convX = cx;
    const convY = arenaY + arenaH - 20;

    this.add.text(convX, convY - 12, 'CONVICTION', {
      fontSize: '9px',
      color:    '#9999bb',
    }).setOrigin(0.5, 0.5).setDepth(2);

    // Background track (full width).
    this.add.rectangle(convX, convY, convW, convH, 0x222233).setDepth(2);

    // Fill rectangle — origin at left edge so scaleX grows rightward.
    // Initial scaleX of 0.5 matches WorldState's starting conviction of 50.
    this.convBarFill = this.add
      .rectangle(convX - convW / 2, convY, convW, convH, 0x8844ff)
      .setOrigin(0, 0.5)
      .setDepth(3);
    this.convBarFill.scaleX = 0.5;
  }

  // ── Wave lifecycle ────────────────────────────────────────────────────────────

  /** Spawn fresh hero + enemies for the current heroIndex / waveIndex. */
  private startWave(): void {
    const heroConfig = HERO_ROSTER[this.heroIndex];
    const waveConfig = WAVE_SEQUENCE[this.waveIndex];

    this.labelText.setText(`${heroConfig.name}  •  ${waveConfig.label}`);

    const W = this.scale.width;
    const H = this.scale.height;

    // Hero always on the left; enemies spread across the right side.
    this.hero = heroConfig.build(this, W * 0.2, H * 0.5);
    this.addPhysics(this.hero);

    const enemyX    = W * 0.72;
    const enemyYs   = this.spreadY(waveConfig.enemies.length, H);

    this.enemies = waveConfig.enemies.map((EnemyClass, i) => {
      const e = new EnemyClass(this, enemyX, enemyYs[i]);
      this.addPhysics(e);
      // Each enemy targets the hero exclusively.
      e.setOpponent(this.hero);
      return e;
    });

    // Hero targets all enemies; BT picks the nearest living one each frame.
    this.hero.setOpponents(this.enemies);

    // Register the current enemy roster with the sound system so it knows
    // which entities to alert when gunshots or deaths are heard.
    this.soundSystem.setEnemies(this.enemies);

    // Collect projectiles spawned by any combatant's shootAt() closure.
    // Entities emit 'projectile-spawned' on the scene event bus; we own the
    // list and tick each projectile manually in update().
    this.events.on('projectile-spawned', (p: Projectile) => {
      this.projectiles.push(p);
      // A gunshot is audible to enemies within 300 px — alert anyone in range.
      // This lets enemies react to Skald's arrows even before they have LOS.
      this.events.emit('sound:gunshot', { x: p.x, y: p.y, radius: 300 });
    });

    // Camera shake on hit — stronger shake when the hero is struck, subtle on enemy death.
    // Screen shake on the PLAYER is the most important feedback signal in combat.
    this.events.on('combatant-damaged', (entity: CombatEntity, _amount: number) => {
      if (entity === this.hero) {
        // Hero was hit: punchy shake + conviction drain.
        this.cameras.main.shake(80, 0.005);
        this.worldState.adjustConviction(-12);
      }
    });

    // Camera shake on death + conviction gain for enemy kills.
    // intensity 0.004 ≈ 4 px at the default zoom; duration 150 ms.
    this.events.on('combatant-died', (entity: CombatEntity) => {
      this.cameras.main.shake(150, 0.004);
      // Only reward conviction for killing enemies, not for the hero dying.
      if (entity !== this.hero) {
        this.worldState.adjustConviction(+8);
      }
      // A death is a loud event — alert enemies within 200 px via the sound system.
      // This uses alertTo() which bypasses LOS, so enemies around corners hear it too.
      this.events.emit('sound:death', { x: entity.x, y: entity.y, radius: 200 });
      // Also publish a panic origin so the swarm boids scatter visually.
      this.blackboard.setPanic(entity.x, entity.y);
      const PANIC_RADIUS = 150;
      for (const e of this.enemies) {
        if (!e.isAlive || e === entity) continue;
        const d = Phaser.Math.Distance.Between(entity.x, entity.y, e.x, e.y);
        if (d < PANIC_RADIUS) {
          e.enterPanic(entity.x, entity.y);
        }
      }
    });

    this.waveState = 'active';
  }

  /**
   * Tear down current wave and advance the counters.
   * Wave index increments first; when exhausted the next hero begins from Wave 1.
   */
  private advanceWave(): void {
    // Destroy projectiles BEFORE entities so no in-flight projectile ticks
    // against an entity that has just been destroyed.
    for (const p of this.projectiles) { if (!p.isExpired) p.destroy(); }
    this.projectiles = [];
    this.events.off('projectile-spawned');
    this.events.off('combatant-damaged');
    this.events.off('combatant-died');

    // Clear the sound system's enemy roster so dead entities from this wave
    // aren't alerted by events that fire during the next wave's startup.
    this.soundSystem.setEnemies([]);

    this.hero.destroy();
    for (const e of this.enemies) e.destroy();
    this.enemies = [];

    this.waveIndex++;
    if (this.waveIndex >= WAVE_SEQUENCE.length) {
      this.waveIndex = 0;
      this.heroIndex = (this.heroIndex + 1) % HERO_ROSTER.length;
    }

    this.startWave();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /** Attach arcade physics to a CombatEntity and keep it inside the arena bounds. */
  private addPhysics(entity: CombatEntity): void {
    this.physics.add.existing(entity);
    (entity.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);
  }

  /**
   * Distribute `count` Y positions evenly across the usable arena height.
   * A single combatant is placed at vertical center.
   * Multiple combatants are spread with equal spacing and a top/bottom margin.
   */
  private spreadY(count: number, H: number): number[] {
    if (count === 1) return [H * 0.5];
    const margin = H * 0.2;
    const step   = (H - margin * 2) / (count - 1);
    return Array.from({ length: count }, (_, i) => margin + i * step);
  }
}
