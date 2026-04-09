import Phaser from 'phaser';
import { CombatEntity, Skald, Draugr } from '../entities/CombatEntity';
import { Projectile } from '../entities/Projectile';

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
  { label: 'Earth Minion',     enemies: [Draugr] },
  { label: 'Earth Minions ×2', enemies: [Draugr, Draugr] },
  { label: 'Earth Minions ×3', enemies: [Draugr, Draugr, Draugr] },
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

  private labelText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: CombatArenaScene.KEY });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  create(): void {
    this.heroIndex  = 0;
    this.waveIndex  = 0;
    this.enemies    = [];
    this.projectiles = [];

    this.buildArena();
    this.startWave();
  }

  override update(_time: number, delta: number): void {
    if (this.waveState !== 'active') return;

    this.hero.update(delta);
    for (const e of this.enemies) e.update(delta);

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

    // Collect projectiles spawned by any combatant's shootAt() closure.
    // Entities emit 'projectile-spawned' on the scene event bus; we own the
    // list and tick each projectile manually in update().
    this.events.on('projectile-spawned', (p: Projectile) => {
      this.projectiles.push(p);
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
