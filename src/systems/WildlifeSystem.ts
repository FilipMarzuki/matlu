/**
 * WildlifeSystem — standalone, scene-agnostic wildlife AI system.
 *
 * Architecture: **world-space physics** with iso projection for rendering.
 * Each ground animal has two objects:
 * - Invisible physics body in world space (in the physics group)
 * - Visible sprite in iso space (projected from physics body each frame)
 *
 * This matches the player pattern in HomesteadScene and enables:
 * - Natural physics world bounds
 * - WalkGrid collision (world-space tile checks)
 * - Uniform distance calculations (no iso distortion)
 * - Simple boundary clamping
 *
 * Usage:
 *   const wildlife = new WildlifeSystem(config);
 *   wildlife.init();
 *   wildlife.spawnGroundAnimals();
 *   wildlife.spawnBirds();
 *   // in update() — pass world-space player position:
 *   wildlife.update(time, delta, player.x, player.y);
 *   wildlife.destroy();
 */

import * as Phaser from 'phaser';
import { mulberry32, poissonDisk } from '../lib/rng';
import {
  type FaunaRegistryData, type AnimalDef, type HuntStrategy, type ForagingDef,
  type LifeStage, type AnimalSex, DEFAULT_STAGES,
  buildAnimalDefs, buildClusterConfig, buildPredatorMap, buildPreySet,
  buildArchetypeMap, buildActivityMap,
} from '../world/FaunaRegistry';
import { SwarmBrain, BASE_WEIGHTS, type BoidsNeighbour } from '../entities/SwarmBrain';
import type { DayPhase } from '../world/WorldClock';

// ── Types ──────────────────────────────────────────────────────────────────────

export type AnimalState =
  | 'roaming' | 'fleeing' | 'chasing' | 'alert' | 'grazing'
  | 'stalking' | 'resting' | 'frozen' | 'sleeping'
  | 'ambush-waiting' | 'ambush-strike'
  | 'pack-flushing' | 'pack-intercepting'
  | 'circling' | 'diving' | 'climbing'
  | 'foraging'
  | 'dying' | 'injured'
  | 'investigating';

export interface BirdObject {
  body:            Phaser.GameObjects.Sprite;
  shadow:          Phaser.GameObjects.Ellipse;
  vx:              number;
  vy:              number;
  nextDirChange:   number;
  worldX:          number;
  worldY:          number;
  playerControlled?: boolean;
  huntState?:       'flying' | 'circling' | 'diving' | 'climbing';
  huntTarget?:      Phaser.GameObjects.Sprite | null;
  huntStartTime?:   number;
  circleAngle?:     number;
  huntCooldown?:    number;
  landState?:       'flying' | 'landing' | 'grounded' | 'taking-off';
  landTimer?:       number;
  groundedUntil?:   number;
}

interface NoiseEvent {
  x: number;
  y: number;
  radius: number;
  time: number;
}

export interface WildlifeEnvContext {
  isRaining: boolean;
  season: string;
  phase: DayPhase;
}

// ── Config ─────────────────────────────────────────────────────────────────────

export interface WildlifeSystemConfig {
  scene: Phaser.Scene;
  faunaRegistry: FaunaRegistryData;

  worldW: number;
  worldH: number;
  spawnClearCenter?: { x: number; y: number };
  spawnClearRadius?: number;

  /** World → iso projection (for rendering). */
  worldToIso: (wx: number, wy: number) => { x: number; y: number };
  /** Iso → world (used by birds only). */
  isoToWorld: (ix: number, iy: number) => { x: number; y: number };
  /** Depth from world coords. */
  isoDepth:   (wx: number, wy: number) => number;

  /** Spawn bias in world space. Return 0 to reject, 1 to accept. */
  spawnBias?:        (wx: number, wy: number, type: string) => number;
  hasAdjacentWater?: (tx: number, ty: number) => boolean;
  getBiomeAtTile?:   (tx: number, ty: number) => number;
  /** Path affinity score — receives world-space coordinates. */
  pathAffinityScore?: (wx: number, wy: number) => number;
  tileSize?: number;

  walkGrid?: Uint8Array | number[];
  gridW?: number;
  gridH?: number;

  getEnvContext?: () => WildlifeEnvContext;
  getDayCount?: () => number;

  audio?: {
    available: boolean;
    sfxVol: number;
    stereoPan: (screenX: number) => number;
    playSound: (key: string, config: { volume: number; rate?: number; pan?: number }) => void;
  };

  seed?: number;
  birdCount?: number;
  birdSpriteKey?: string;
  birdShadowDx?: number;
  birdShadowDy?: number;

  speciesFilter?: string[] | null;
  scaleOverride?: number;
}

// ── System ─────────────────────────────────────────────────────────────────────

export class WildlifeSystem {
  readonly scene: Phaser.Scene;
  /** Physics group of invisible world-space bodies. */
  readonly groundAnimals: Phaser.Physics.Arcade.Group;
  readonly birds: BirdObject[] = [];

  private config: WildlifeSystemConfig;
  private noiseEvents: NoiseEvent[] = [];
  /** Maps world-space physics body → visible iso sprite. */
  private bodyToSprite = new Map<Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite>();

  private animalDefs!:    Record<string, AnimalDef>;
  private predatorMap!:   Map<string, { prey: string[]; range: number; strategy: HuntStrategy }>;
  private preySet!:       Set<string>;
  private archetypes!:    Record<string, string>;
  private activities!:    Record<string, string>;
  private foragingMap!:   Record<string, ForagingDef | null>;
  private stageWeights!:  Record<string, { young: number; adult: number; elder: number }>;

  constructor(config: WildlifeSystemConfig) {
    this.config = config;
    this.scene = config.scene;
    this.groundAnimals = this.scene.physics.add.group();
  }

  /** Convert world velocity → screen direction for animation picking + flipX. */
  private worldVelToScreenDir(wvx: number, wvy: number): { svx: number; svy: number } {
    return { svx: wvx - wvy, svy: (wvx + wvy) * 0.5 };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(): void {
    const reg = this.config.faunaRegistry;
    this.animalDefs  = buildAnimalDefs(reg);
    this.predatorMap = buildPredatorMap(reg);
    this.preySet     = buildPreySet(reg);
    this.archetypes  = buildArchetypeMap(reg);
    this.activities  = buildActivityMap(reg);

    const foragingMap: Record<string, ForagingDef | null> = {};
    for (const f of reg.fauna) {
      foragingMap[f.id] = (f as unknown as { foraging?: ForagingDef }).foraging ?? null;
    }
    this.foragingMap = foragingMap;

    const stageWeightMap: Record<string, { young: number; adult: number; elder: number }> = {};
    for (const f of reg.fauna) {
      stageWeightMap[f.id] = f.stageWeights ?? { young: 0.25, adult: 0.60, elder: 0.15 };
    }
    this.stageWeights = stageWeightMap;

    if (this.config.speciesFilter) {
      const keep = new Set(this.config.speciesFilter);
      for (const id of Object.keys(this.animalDefs)) {
        if (!keep.has(id)) delete this.animalDefs[id];
      }
    }

    // Create blank texture for invisible physics bodies
    if (!this.scene.textures.exists('__wildlife_phys')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0xffffff, 0);
      g.fillRect(0, 0, 1, 1);
      g.generateTexture('__wildlife_phys', 1, 1);
      g.destroy();
    }

    this.scene.physics.add.collider(this.groundAnimals, this.groundAnimals);
  }

  destroy(): void {
    for (const [, spr] of this.bodyToSprite) spr.destroy();
    this.bodyToSprite.clear();
    this.groundAnimals.destroy(true, true);
    for (const bird of this.birds) {
      bird.body.destroy();
      bird.shadow.destroy();
    }
    this.birds.length = 0;
    this.noiseEvents.length = 0;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Emit a noise at world-space coordinates. */
  emitNoise(x: number, y: number, radius: number): void {
    this.noiseEvents.push({ x, y, radius, time: this.scene.time.now });
  }

  /** Kill an animal. Pass the physics body (from groundAnimals group). */
  killAnimal(physBody: Phaser.GameObjects.GameObject): void {
    const pb = physBody as Phaser.GameObjects.Sprite;
    const spr = this.bodyToSprite.get(pb);
    const type = pb.getData('animalType') as string;
    pb.setData('animalState', 'dying' satisfies AnimalState);
    const b = pb.body as Phaser.Physics.Arcade.Body;
    b.setVelocity(0, 0);
    b.enable = false;

    if (spr) {
      this.playAnimalAnim(spr, type, 'death', pb);
      const hasDeathAnim = this.scene.anims.exists(`${type}-death-anim`);
      const duration = hasDeathAnim ? 800 : 400;

      this.scene.tweens.add({
        targets: spr,
        alpha: 0,
        duration,
        delay: hasDeathAnim ? 200 : 0,
        onComplete: () => {
          if (spr.active) spr.destroy();
          if (pb.active) pb.destroy();
          this.bodyToSprite.delete(pb);
        },
      });
    }

    if (this.config.audio?.available) {
      const isoX = spr?.x ?? 0;
      this.config.audio.playSound('sfx-enemy-death', {
        volume: 0.25 * this.config.audio.sfxVol,
        pan: this.config.audio.stereoPan(isoX),
      });
    }

    this.scene.events.emit('wildlife:kill', { type, x: pb.x, y: pb.y });
  }

  /** Injure an animal. Pass the physics body. */
  injureAnimal(physBody: Phaser.GameObjects.GameObject, severity: number = 0.5): void {
    const pb = physBody as Phaser.GameObjects.Sprite;
    const spr = this.bodyToSprite.get(pb);
    pb.setData('animalState', 'injured' satisfies AnimalState);
    pb.setData('injurySeverity', severity);
    pb.setData('injuryTime', this.scene.time.now);
    if (spr) {
      const r = 0xff;
      const g = Math.round(0xff * (1 - severity * 0.4));
      const bl = Math.round(0xff * (1 - severity * 0.4));
      spr.setTint(Phaser.Display.Color.GetColor(r, g, bl));
    }
    this.scene.events.emit('wildlife:injury', { type: pb.getData('animalType'), severity });
  }

  setVisible(visible: boolean): void {
    for (const [, spr] of this.bodyToSprite) spr.setAlpha(visible ? 1 : 0);
    for (const bird of this.birds) {
      bird.body.setAlpha(visible ? 1 : 0);
      bird.shadow.setAlpha(visible ? 0.2 : 0);
    }
  }

  // ── Spawning ───────────────────────────────────────────────────────────────

  spawnGroundAnimals(): void {
    const seed = this.config.seed ?? 42;
    const rng = mulberry32(seed ^ 0xa1b2c3d4);
    const rndBetween = (lo: number, hi: number): number =>
      Math.floor(rng() * (hi - lo + 1)) + lo;

    const CLUSTER_CONFIG = buildClusterConfig(this.config.faunaRegistry);
    const WORLD_W = this.config.worldW;
    const WORLD_H = this.config.worldH;
    const clearX = this.config.spawnClearCenter?.x ?? WORLD_W / 2;
    const clearY = this.config.spawnClearCenter?.y ?? WORLD_H / 2;
    const clearR = this.config.spawnClearRadius ?? 200;
    const spawnBias = this.config.spawnBias ?? (() => 1);

    for (const [type, def] of Object.entries(this.animalDefs)) {
      const cfg = CLUSTER_CONFIG[type];
      if (!cfg) continue;

      const numClusters = rndBetween(cfg.clusters[0], cfg.clusters[1]);

      if (type === 'fox') {
        const totalFoxes = def.count;
        const foxPoints = poissonDisk(rng, WORLD_W - 160, WORLD_H - 160, cfg.clusterR, totalFoxes * 3);
        let placed = 0;
        for (const pt of foxPoints) {
          if (placed >= totalFoxes) break;
          const x = pt.x + 80;
          const y = pt.y + 80;
          if (Phaser.Math.Distance.Between(x, y, clearX, clearY) < clearR) continue;
          if (rng() >= spawnBias(x, y, type)) continue;
          this.placeGroundAnimal(type, def, x, y);
          placed++;
        }
      } else {
        const clusterCentres = poissonDisk(rng, WORLD_W - 400, WORLD_H - 400, cfg.clusterMinDist, numClusters * 4);
        let clustersPlaced = 0;

        for (const centre of clusterCentres) {
          if (clustersPlaced >= numClusters) break;
          const cx = centre.x + 200;
          const cy = centre.y + 200;
          if (Phaser.Math.Distance.Between(cx, cy, clearX, clearY) < clearR + 100) continue;
          if (spawnBias(cx, cy, type) < 0.5) continue;

          const clusterSize = rndBetween(cfg.perCluster[0], cfg.perCluster[1]);
          const clusterArea = cfg.clusterR * 4;
          const localPoints = poissonDisk(rng, clusterArea, clusterArea, cfg.clusterR, clusterSize * 3);

          let animalCount = 0;
          for (const lp of localPoints) {
            if (animalCount >= clusterSize) break;
            const x = cx + lp.x - clusterArea / 2;
            const y = cy + lp.y - clusterArea / 2;
            if (x < 80 || x > WORLD_W - 80 || y < 80 || y > WORLD_H - 80) continue;
            this.placeGroundAnimal(type, def, x, y);
            animalCount++;
          }
          clustersPlaced++;
        }
      }
    }
  }

  spawnBirds(): void {
    const count = this.config.birdCount ?? 0;
    if (count === 0) return;
    const WORLD_W = this.config.worldW;
    const WORLD_H = this.config.worldH;
    const spriteKey = this.config.birdSpriteKey ?? 'grouse-fly';
    const SHADOW_DX = this.config.birdShadowDx ?? 7;
    const SHADOW_DY = this.config.birdShadowDy ?? 5;

    for (let i = 0; i < count; i++) {
      const wx = Phaser.Math.Between(50, WORLD_W - 50);
      const wy = Phaser.Math.Between(50, WORLD_H - 50);
      const { x, y } = this.config.worldToIso(wx, wy);
      const isCrow = i < 4;
      const w = isCrow ? 10 : 6;
      const h = isCrow ?  5 : 3;
      const shadow = this.scene.add.ellipse(x + SHADOW_DX, y + SHADOW_DY, w, h, 0x000000, 0.2).setDepth(1);
      const scale = isCrow ? 0.7 : 0.45;
      const body  = this.scene.add.sprite(x, y, spriteKey, 0).setScale(scale).setDepth(7);
      body.setData('animalType', isCrow ? 'crow' : 'songbird');
      body.setData('animalState', 'flying');
      if (this.scene.anims.exists(`${spriteKey}-anim`)) body.play(`${spriteKey}-anim`);
      const speed = Phaser.Math.Between(55, 95);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      this.birds.push({
        body, shadow,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        nextDirChange: this.scene.time.now + Phaser.Math.Between(6000, 14000),
        worldX: wx, worldY: wy,
      });
    }
  }

  // ── Frame update ───────────────────────────────────────────────────────────

  update(time: number, delta: number, playerX: number, playerY: number): void {
    this.updateGroundAnimals(time, playerX, playerY);
    this.updateBirds(time, delta, playerX, playerY);
  }

  // ── Private: spawning ──────────────────────────────────────────────────────

  private pickLifeStage(type: string): LifeStage {
    const w = this.stageWeights[type] ?? { young: 0.25, adult: 0.60, elder: 0.15 };
    const total = w.young + w.adult + w.elder;
    const r = Math.random() * total;
    if (r < w.young) return 'young';
    if (r < w.young + w.adult) return 'adult';
    return 'elder';
  }

  /**
   * Place a ground animal at world-space (x, y).
   * Creates an invisible physics body at (x, y) and a visible iso sprite projected from it.
   */
  private placeGroundAnimal(type: string, def: AnimalDef, x: number, y: number): void {
    const stage = this.pickLifeStage(type);
    const stageDef = DEFAULT_STAGES[stage];
    const baseScale = this.config.scaleOverride ?? def.scale;
    const effectiveScale = baseScale * stageDef.scaleMult;

    // ── Invisible physics body in world space ──
    const pb = this.scene.physics.add.image(x, y, '__wildlife_phys') as unknown as Phaser.GameObjects.Sprite;
    pb.setVisible(false);
    (pb as unknown as Phaser.Physics.Arcade.Image).setCollideWorldBounds(true);
    const b = pb.body as Phaser.Physics.Arcade.Body;
    b.setDrag(60, 60);
    b.setSize(Math.round(def.w * stageDef.scaleMult), Math.round(def.h * stageDef.scaleMult));
    this.groundAnimals.add(pb);

    // All game data lives on the physics body
    pb.setData('animalType', type);
    pb.setData('archetype', this.archetypes[type] ?? 'grazer');
    pb.setData('activity', this.activities[type] ?? 'diurnal');
    pb.setData('lifeStage', stage);
    const speciesDef = this.config.faunaRegistry.fauna.find(f => f.id === type);
    const numVariants = speciesDef?.variants ?? 1;
    pb.setData('variantId', numVariants > 1 ? Math.floor(Math.random() * numVariants) : 0);
    const sex: AnimalSex = Math.random() < 0.5 ? 'male' : 'female';
    pb.setData('sex', sex);
    pb.setData('birthDay', this.config.getDayCount?.() ?? 0);
    pb.setData('animalState', 'roaming' satisfies AnimalState);
    pb.setData('roamNext', this.scene.time.now + Phaser.Math.Between(2000, 6000));
    pb.setData('ambientSoundTimer', this.scene.time.now + Phaser.Math.Between(5000, 20000));
    pb.setData('worldX', x);
    pb.setData('worldY', y);

    // ── Visible iso sprite ──
    const { x: isoX, y: isoY } = this.config.worldToIso(x, y);
    const idleTexKey = this.scene.textures.exists(`${type}-idle`)
      ? `${type}-idle`
      : this.scene.textures.exists(`${type}-idle-se`) ? `${type}-idle-se` : `${type}-idle`;
    const spr = this.scene.add.sprite(isoX, isoY, idleTexKey, 0);
    spr.setScale(effectiveScale);
    spr.setDepth(this.config.isoDepth(x, y));
    if (stageDef.tint !== 0xffffff) spr.setTint(stageDef.tint);
    const dimorphism = speciesDef?.sexDimorphism;
    if (dimorphism?.maleScaleMult && sex === 'male' && stage !== 'young') {
      spr.setScale(effectiveScale * dimorphism.maleScaleMult);
    }
    const idleAnimKey = this.scene.anims.exists(`${type}-idle-se-anim`)
      ? `${type}-idle-se-anim` : `${type}-idle-anim`;
    if (this.scene.anims.exists(idleAnimKey)) spr.play(idleAnimKey);

    this.bodyToSprite.set(pb, spr);
  }

  // ── Private: animation ─────────────────────────────────────────────────────

  /**
   * Play the best available animation. Tries directional, variant+stage, sex,
   * variant, stage, base, then fallback chain.
   * @param spr      Visible iso sprite (receives the animation)
   * @param type     Species id
   * @param action   Animation action (idle, walk, run, eat, sleep, etc.)
   * @param dataSrc  Physics body that owns the entity data (lifeStage, sex, variantId)
   * @param worldVel World-space velocity for directional animation picking
   */
  private playAnimalAnim(
    spr: Phaser.GameObjects.Sprite,
    type: string,
    action: string,
    dataSrc?: Phaser.GameObjects.GameObject,
    worldVel?: Phaser.Math.Vector2,
  ): void {
    const src = dataSrc ?? spr;
    const stage = src.getData('lifeStage') as string | undefined;
    const variantId = src.getData('variantId') as number | undefined;
    const hasVariant = variantId != null && variantId > 0;

    // Directional animation from world-space velocity (projected to screen direction)
    if (worldVel && (Math.abs(worldVel.x) > 2 || Math.abs(worldVel.y) > 2)) {
      const { svx, svy } = this.worldVelToScreenDir(worldVel.x, worldVel.y);
      const angle = Math.atan2(svy, svx);
      const sector = Math.round(angle / (Math.PI / 4));
      const DIR_MAP: Record<number, string> = {
        0: 'e', 1: 'se', 2: 's', 3: 'sw', 4: 'w', '-4': 'w', '-3': 'nw', '-2': 'n', '-1': 'ne',
      };
      const dir = DIR_MAP[sector] ?? 'se';
      const dirKey = `${type}-${action}-${dir}-anim`;
      if (this.scene.anims.exists(dirKey)) {
        spr.setFlipX(false);
        if (!spr.anims.isPlaying || spr.anims.currentAnim?.key !== dirKey) spr.play(dirKey);
        return;
      }
    }

    const sex = src.getData('sex') as string | undefined;
    if (sex === 'male') {
      const k = `${type}-${action}-male-anim`;
      if (this.scene.anims.exists(k)) {
        if (!spr.anims.isPlaying || spr.anims.currentAnim?.key !== k) spr.play(k);
        return;
      }
    }
    if (hasVariant && stage && stage !== 'adult') {
      const k = `${type}-${action}-v${variantId}-${stage}-anim`;
      if (this.scene.anims.exists(k)) {
        if (!spr.anims.isPlaying || spr.anims.currentAnim?.key !== k) spr.play(k);
        return;
      }
    }
    if (hasVariant) {
      const k = `${type}-${action}-v${variantId}-anim`;
      if (this.scene.anims.exists(k)) {
        if (!spr.anims.isPlaying || spr.anims.currentAnim?.key !== k) spr.play(k);
        return;
      }
    }
    if (stage && stage !== 'adult') {
      const k = `${type}-${action}-${stage}-anim`;
      if (this.scene.anims.exists(k)) {
        if (!spr.anims.isPlaying || spr.anims.currentAnim?.key !== k) spr.play(k);
        return;
      }
    }
    const key = `${type}-${action}-anim`;
    if (this.scene.anims.exists(key)) {
      if (!spr.anims.isPlaying || spr.anims.currentAnim?.key !== key) spr.play(key);
      return;
    }
    const fallbacks: Record<string, string> = {
      run: 'walk', eat: 'idle', sleep: 'idle', sneak: 'walk',
      alert: 'idle', death: 'idle', forage: 'idle', drink: 'eat',
    };
    const fb = fallbacks[action];
    if (fb) {
      this.playAnimalAnim(spr, type, fb, dataSrc, worldVel);
    } else if (this.scene.anims.exists(`${type}-idle-anim`)) {
      spr.play(`${type}-idle-anim`);
    }
  }

  private playFleeVocal(spr: Phaser.GameObjects.Sprite, def: AnimalDef): void {
    if (!this.config.audio?.available) return;
    if (!def.fleeVocal?.key) return;
    this.config.audio.playSound(def.fleeVocal.key, {
      volume: def.fleeVocal.volume * this.config.audio.sfxVol,
      rate: def.fleeVocal.rate,
      pan: this.config.audio.stereoPan(spr.x),
    });
  }

  // ── Private: ground animal FSM ─────────────────────────────────────────────
  // pb = physics body (world space), spr = iso sprite (visual only)
  // All distances, angles, velocities operate in world space.
  // Iso projection happens once at the end of each entity tick.

  private updateGroundAnimals(time: number, playerX: number, playerY: number): void {
    const px = playerX;  // world-space player position
    const py = playerY;
    const now = time;

    const env = this.config.getEnvContext?.() ?? { isRaining: false, season: 'summer', phase: 'morning' as DayPhase };
    const phase = env.phase;
    const isNight = phase === 'night';
    const isDawnOrDusk = phase === 'dawn' || phase === 'dusk';

    this.noiseEvents = this.noiseEvents.filter(n => now - n.time < 10000);

    const allBodies = this.groundAnimals.getChildren() as Phaser.GameObjects.Sprite[];
    const bodiesByType = new Map<string, Phaser.GameObjects.Sprite[]>();
    for (const a of allBodies) {
      if (a.getData('playerControlled') as boolean) continue;
      const t = a.getData('animalType') as string;
      const arr = bodiesByType.get(t);
      if (arr) arr.push(a); else bodiesByType.set(t, [a]);
    }

    for (const child of allBodies) {
      const pb = child;
      const spr = this.bodyToSprite.get(pb);
      if (!spr) continue;
      const b = pb.body as Phaser.Physics.Arcade.Body;
      const type = pb.getData('animalType') as string;
      const def = this.animalDefs[type];
      if (!def) continue;
      if (pb.getData('playerControlled') as boolean) continue;
      const archetype = pb.getData('archetype') as string;
      const activity = pb.getData('activity') as string;

      // ── Aging ──
      const birthDay = (pb.getData('birthDay') as number) ?? 0;
      const currentDay = this.config.getDayCount?.() ?? 0;
      const age = currentDay - birthDay;
      const speciesDef = this.config.faunaRegistry.fauna.find(f => f.id === type);
      const agingDef = speciesDef?.aging;
      if (agingDef) {
        let expectedStage: LifeStage = 'young';
        if (age >= agingDef.youngDuration + agingDef.adultDuration) expectedStage = 'elder';
        else if (age >= agingDef.youngDuration) expectedStage = 'adult';
        const currentStage = pb.getData('lifeStage') as LifeStage;
        if (currentStage !== expectedStage) {
          pb.setData('lifeStage', expectedStage);
          const newStageMod = DEFAULT_STAGES[expectedStage];
          spr.setScale((this.config.scaleOverride ?? def.scale) * newStageMod.scaleMult);
          if (newStageMod.tint !== 0xffffff) spr.setTint(newStageMod.tint); else spr.clearTint();
          b.setSize(Math.round(def.w * newStageMod.scaleMult), Math.round(def.h * newStageMod.scaleMult));
        }
      }

      const stage = (pb.getData('lifeStage') as LifeStage) ?? 'adult';
      const stageMod = DEFAULT_STAGES[stage];

      // ── Effective values ──
      const rainFleeBoost = env.isRaining && archetype !== 'predator' ? 1.3 : 1.0;
      const coldSpeedMod = env.season === 'winter' ? 0.85 : 1.0;
      const injurySeverity = (pb.getData('injurySeverity') as number) ?? 0;
      const injurySpeedMod = 1 - injurySeverity * 0.5;
      const sex = (pb.getData('sex') as string) ?? 'female';
      const dimorphism = speciesDef?.sexDimorphism;
      const sexFleeMult = sex === 'male' && dimorphism?.maleFleeRangeMult ? dimorphism.maleFleeRangeMult : 1.0;
      const sexRoamMult = sex === 'male' && (dimorphism as Record<string, number> | undefined)?.maleRoamMult ? (dimorphism as Record<string, number>).maleRoamMult : 1.0;
      const isPregnant = (pb.getData('pregnant') as boolean) ?? false;
      const pregnancySpeedMod = isPregnant ? 0.75 : 1.0;

      const effFleeRange = def.fleeRange * stageMod.fleeRangeMult * rainFleeBoost * sexFleeMult;
      const effFleeSpeed = def.fleeSpeed * stageMod.fleeSpeedMult * coldSpeedMod * injurySpeedMod * pregnancySpeedMod;
      const effRoamSpeed = def.roamSpeed * stageMod.roamSpeedMult * coldSpeedMod * injurySpeedMod * pregnancySpeedMod * sexRoamMult;
      const dist = Phaser.Math.Distance.Between(pb.x, pb.y, px, py);
      let state = pb.getData('animalState') as AnimalState;
      const prevState = state;

      // ── Sleep/wake ──
      const shouldSleep =
        (activity === 'diurnal' && isNight) ||
        (activity === 'nocturnal' && !isNight && !isDawnOrDusk) ||
        (activity === 'crepuscular' && (isNight || phase === 'midday'));

      if (shouldSleep && state !== 'sleeping' && state !== 'fleeing' && state !== 'frozen') {
        state = 'sleeping'; pb.setData('animalState', state);
        b.setVelocity(0, 0);
        this.playAnimalAnim(spr, type, 'sleep', pb);
        spr.setAlpha(0.6);
      } else if (!shouldSleep && state === 'sleeping') {
        state = 'roaming'; pb.setData('animalState', state);
        pb.setData('roamNext', now + Phaser.Math.Between(1000, 3000));
        spr.setAlpha(1);
      }

      if (state === 'sleeping') {
        b.setVelocity(0, 0);
        if (dist < effFleeRange * 0.5) {
          state = 'fleeing'; pb.setData('animalState', state);
          pb.setData('fleeStartTime', now); spr.setAlpha(1);
          this.playAnimalAnim(spr, type, 'run', pb, b.velocity);
          this.playFleeVocal(spr, def);
        }
        // Project to iso even when sleeping (for initial placement)
        const { x: ix, y: iy } = this.config.worldToIso(pb.x, pb.y);
        spr.setPosition(ix, iy);
        spr.setDepth(this.config.isoDepth(pb.x, pb.y));
        continue;
      }

      // ── Noise propagation ──
      if (state !== 'fleeing' && state !== 'frozen') {
        for (const noise of this.noiseEvents) {
          if (now - noise.time > 500) continue;
          const noiseDist = Phaser.Math.Distance.Between(pb.x, pb.y, noise.x, noise.y);
          if (noiseDist >= noise.radius) continue;
          if (archetype === 'critter') {
            state = 'fleeing'; pb.setData('animalState', state);
            pb.setData('fleeStartTime', now);
            this.playAnimalAnim(spr, type, 'run', pb, b.velocity);
          } else if (archetype === 'grazer' && state !== 'alert') {
            state = 'alert'; pb.setData('animalState', state);
            pb.setData('alertStart', now); b.setVelocity(0, 0);
            this.playAnimalAnim(spr, type, 'alert', pb);
          }
          break;
        }
      }

      // ── Threat detection ──
      if (archetype === 'grazer' && state !== 'fleeing' && state !== 'alert'
          && dist < effFleeRange * 1.5 && dist >= effFleeRange) {
        state = 'alert'; pb.setData('animalState', state);
        pb.setData('alertStart', now); b.setVelocity(0, 0);
        this.playAnimalAnim(spr, type, 'alert', pb);
      }
      if (state === 'alert' && dist < effFleeRange) {
        state = 'fleeing'; pb.setData('animalState', state); pb.setData('alertStart', null);
      }
      if (state === 'alert' && dist >= effFleeRange * 1.5) {
        state = 'roaming'; pb.setData('animalState', state); pb.setData('alertStart', null);
        pb.setData('roamNext', now + Phaser.Math.Between(1000, 3000));
      }

      // Critter freeze
      if (dist < effFleeRange && archetype === 'critter'
          && prevState !== 'fleeing' && prevState !== 'frozen' && state !== 'frozen'
          && Math.random() < 0.2) {
        state = 'frozen'; pb.setData('animalState', state);
        pb.setData('freezeEnd', now + Phaser.Math.Between(500, 1000));
        b.setVelocity(0, 0);
      }

      // Standard flee trigger
      if (dist < effFleeRange && state !== 'fleeing' && state !== 'frozen') {
        state = 'fleeing'; pb.setData('animalState', state);
        if (prevState !== 'fleeing') {
          pb.setData('fleeStartTime', now);
          this.playFleeVocal(spr, def);
          this.playAnimalAnim(spr, type, 'run', pb, b.velocity);
          // Group flee
          const herdMates = bodiesByType.get(type);
          if (herdMates) {
            for (const mate of herdMates) {
              if (mate === pb) continue;
              const ms = mate.getData('animalState') as AnimalState;
              if (ms === 'fleeing' || ms === 'frozen') continue;
              if (Phaser.Math.Distance.Between(pb.x, pb.y, mate.x, mate.y) < 150) {
                mate.setData('animalState', 'fleeing' satisfies AnimalState);
                mate.setData('fleeStartTime', now + Phaser.Math.Between(50, 200));
                const mateSpr = this.bodyToSprite.get(mate);
                if (mateSpr) this.playAnimalAnim(mateSpr, type, 'run', mate);
              }
            }
          }
        }
      } else if (state === 'fleeing' && dist > effFleeRange + 80) {
        state = 'roaming'; pb.setData('animalState', state);
        pb.setData('roamNext', now + Phaser.Math.Between(2000, 5000));
        this.playAnimalAnim(spr, type, 'idle', pb);
      }

      // ── Predator/prey ──
      let chaseTarget: Phaser.GameObjects.Sprite | null = null;
      let fleeFromX = px;
      let fleeFromY = py;

      const predInfo = this.predatorMap.get(type);
      if (predInfo && stage !== 'young' && state !== 'fleeing' && state !== 'frozen') {
        const strategy = predInfo.strategy;
        let nearestPrey: Phaser.GameObjects.Sprite | null = null;
        let nearestDist = predInfo.range;
        let distantPrey: Phaser.GameObjects.Sprite | null = null;
        let distantDist = strategy === 'pursuit' ? predInfo.range * 2 : 0;

        for (const preyId of predInfo.prey) {
          for (const prey of bodiesByType.get(preyId) ?? []) {
            const d = Phaser.Math.Distance.Between(pb.x, pb.y, prey.x, prey.y);
            if (d < nearestDist) { nearestDist = d; nearestPrey = prey; }
            if (strategy === 'pursuit' && d > predInfo.range && d < distantDist) {
              distantDist = d; distantPrey = prey;
            }
          }
        }

        if (strategy === 'pursuit') {
          if (nearestPrey) {
            chaseTarget = nearestPrey;
            if (state !== 'chasing') {
              state = 'chasing'; pb.setData('animalState', state);
              pb.setData('chaseStart', now);
              this.playAnimalAnim(spr, type, 'run', pb, b.velocity);
            }
            if (state === 'chasing') {
              const cs = (pb.getData('chaseStart') as number | null) ?? now;
              if (now - cs > 4000) {
                if (nearestDist < 25 && Math.random() < 0.15) {
                  this.killAnimal(nearestPrey); chaseTarget = null;
                  state = 'resting'; pb.setData('animalState', state);
                  pb.setData('restEnd', now + Phaser.Math.Between(10000, 18000));
                } else {
                  state = 'resting'; pb.setData('animalState', state);
                  pb.setData('restEnd', now + Phaser.Math.Between(6000, 12000)); chaseTarget = null;
                }
                b.setVelocity(0, 0); this.playAnimalAnim(spr, type, 'idle', pb);
              }
            }
          } else if (state === 'chasing') {
            state = 'resting'; pb.setData('animalState', state);
            pb.setData('restEnd', now + Phaser.Math.Between(5000, 10000));
            b.setVelocity(0, 0); this.playAnimalAnim(spr, type, 'idle', pb);
          } else if (distantPrey && state === 'roaming') {
            state = 'stalking'; pb.setData('animalState', state);
            pb.setData('stalkTarget', distantPrey);
            this.playAnimalAnim(spr, type, 'sneak', pb);
          }
        } else if (strategy === 'ambush') {
          const pathAff = this.config.pathAffinityScore ?? (() => 0);
          if (state === 'roaming') {
            let bsx = pb.x, bsy = pb.y, bestAff = -Infinity;
            for (let s = 0; s < 6; s++) {
              const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
              const sx = pb.x + Math.cos(a) * 120;
              const sy = pb.y + Math.sin(a) * 120;
              const aff = pathAff(sx, sy);
              if (aff > bestAff) { bestAff = aff; bsx = sx; bsy = sy; }
            }
            if (bestAff > 0.3) {
              pb.setData('ambushSpotX', bsx); pb.setData('ambushSpotY', bsy);
              if (Phaser.Math.Distance.Between(pb.x, pb.y, bsx, bsy) < 10) {
                state = 'ambush-waiting'; pb.setData('animalState', state);
                pb.setData('ambushSettleTime', now); b.setVelocity(0, 0);
                spr.setAlpha(0.3); this.playAnimalAnim(spr, type, 'sneak', pb);
              }
            }
          } else if (state === 'ambush-waiting') {
            b.setVelocity(0, 0); spr.setAlpha(0.3);
            if (nearestPrey && nearestDist < predInfo.range) {
              state = 'ambush-strike'; pb.setData('animalState', state);
              pb.setData('ambushStrikeTarget', nearestPrey);
              pb.setData('ambushStrikeEnd', now + 600); spr.setAlpha(1);
              this.playAnimalAnim(spr, type, 'run', pb, b.velocity);
            }
            if (now - (pb.getData('ambushSettleTime') as number) > 18000) {
              state = 'roaming'; pb.setData('animalState', state);
              pb.setData('roamNext', now + Phaser.Math.Between(2000, 5000)); spr.setAlpha(1);
            }
          } else if (state === 'ambush-strike') {
            const st = pb.getData('ambushStrikeTarget') as Phaser.GameObjects.Sprite | null;
            if (now > (pb.getData('ambushStrikeEnd') as number)) {
              const dp = st?.active ? Phaser.Math.Distance.Between(pb.x, pb.y, st.x, st.y) : 999;
              if (dp < 25 && Math.random() < 0.40) {
                this.killAnimal(st!); pb.setData('restEnd', now + Phaser.Math.Between(12000, 20000));
              } else { pb.setData('restEnd', now + Phaser.Math.Between(8000, 14000)); }
              state = 'resting'; pb.setData('animalState', state);
              b.setVelocity(0, 0); this.playAnimalAnim(spr, type, 'idle', pb);
            } else if (st?.active) {
              const pd = this.animalDefs[st.getData('animalType') as string];
              const burst = pd ? pd.fleeSpeed * 2 : def.fleeSpeed * 2;
              const tw = Phaser.Math.Angle.Between(pb.x, pb.y, st.x, st.y);
              this.scene.physics.velocityFromRotation(tw, burst, b.velocity);
            }
          }
        } else if (strategy === 'pack') {
          const packRole = pb.getData('packRole') as string | null;
          if (!packRole && state === 'roaming' && nearestPrey) {
            const mates = (bodiesByType.get(type) ?? []).filter(m => m !== pb
              && Phaser.Math.Distance.Between(pb.x, pb.y, m.x, m.y) < 200
              && !(m.getData('packRole') as string));
            if (mates.length >= 1) {
              pb.setData('packRole', 'flusher'); pb.setData('packTarget', nearestPrey);
              pb.setData('packHuntStart', now);
              state = 'pack-flushing'; pb.setData('animalState', state);
              this.playAnimalAnim(spr, type, 'run', pb, b.velocity);
              for (const mate of mates) {
                mate.setData('packRole', 'interceptor'); mate.setData('packTarget', nearestPrey);
                mate.setData('packHuntStart', now);
                mate.setData('animalState', 'pack-intercepting' satisfies AnimalState);
                const ms = this.bodyToSprite.get(mate);
                if (ms) this.playAnimalAnim(ms, type, 'run', mate);
              }
            }
          }
        }
      }

      // Prey: flee from nearest predator
      if (this.preySet.has(type)) {
        let nearestPred: Phaser.GameObjects.Sprite | null = null;
        let nearestPredDist = effFleeRange;
        for (const [predId, info] of this.predatorMap) {
          if (!info.prey.includes(type)) continue;
          for (const pred of bodiesByType.get(predId) ?? []) {
            const d = Phaser.Math.Distance.Between(pb.x, pb.y, pred.x, pred.y);
            if (d < nearestPredDist) { nearestPredDist = d; nearestPred = pred; }
          }
        }
        if (nearestPred) {
          fleeFromX = nearestPred.x; fleeFromY = nearestPred.y;
          if (state !== 'fleeing') {
            state = 'fleeing'; pb.setData('animalState', state);
            pb.setData('fleeStartTime', now);
            this.playAnimalAnim(spr, type, 'run', pb, b.velocity);
          }
        }
      }

      // ── Movement per state ──
      if (state === 'dying') {
        b.setVelocity(0, 0);
        const { x: ix, y: iy } = this.config.worldToIso(pb.x, pb.y);
        spr.setPosition(ix, iy); spr.setDepth(this.config.isoDepth(pb.x, pb.y));
        continue;
      }

      if (state === 'injured') {
        const it = (pb.getData('injuryTime') as number) ?? now;
        const elapsed = now - it;
        if (elapsed > 30000 && injurySeverity < 0.3) {
          pb.setData('injurySeverity', 0);
          pb.setData('animalState', 'roaming' satisfies AnimalState);
          pb.setData('roamNext', now + Phaser.Math.Between(1000, 3000));
          const stMod = DEFAULT_STAGES[(pb.getData('lifeStage') as LifeStage) ?? 'adult'];
          if (stMod.tint !== 0xffffff) spr.setTint(stMod.tint); else spr.clearTint();
        } else if (elapsed > 60000 && injurySeverity >= 0.7) {
          this.killAnimal(pb); continue;
        } else {
          if (dist < effFleeRange) {
            state = 'fleeing'; pb.setData('animalState', state);
            pb.setData('fleeStartTime', now);
          } else if (now > (pb.getData('roamNext') as number ?? 0)) {
            const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
            this.scene.physics.velocityFromRotation(a, effRoamSpeed * 0.4, b.velocity);
            pb.setData('roamNext', now + Phaser.Math.Between(4000, 8000));
          }
        }
      } else if (state === 'frozen') {
        b.setVelocity(0, 0);
        if (now > (pb.getData('freezeEnd') as number)) {
          state = 'fleeing'; pb.setData('animalState', state);
          pb.setData('fleeStartTime', now);
          this.playFleeVocal(spr, def);
        }
      } else if (state === 'fleeing') {
        const away = Phaser.Math.Angle.Between(fleeFromX, fleeFromY, pb.x, pb.y);
        const fs = (pb.getData('fleeStartTime') as number | null) ?? now;
        const el = now - fs;
        const ramp = Math.min(el / 100, 1);
        let speed = effFleeSpeed;
        if (archetype === 'critter' && el < 500) speed = effFleeSpeed * 1.5;
        this.scene.physics.velocityFromRotation(away, ramp * speed, b.velocity);
      } else if (state === 'chasing') {
        if (chaseTarget?.active) {
          const tw = Phaser.Math.Angle.Between(pb.x, pb.y, chaseTarget.x, chaseTarget.y);
          this.scene.physics.velocityFromRotation(tw, effFleeSpeed, b.velocity);
        }
      } else if (state === 'stalking') {
        const target = pb.getData('stalkTarget') as Phaser.GameObjects.Sprite | null;
        if (target?.active && predInfo) {
          const d = Phaser.Math.Distance.Between(pb.x, pb.y, target.x, target.y);
          if (d <= predInfo.range) {
            state = 'chasing'; pb.setData('animalState', state); pb.setData('chaseStart', now);
            chaseTarget = target;
          } else {
            const tw = Phaser.Math.Angle.Between(pb.x, pb.y, target.x, target.y);
            this.scene.physics.velocityFromRotation(tw, effRoamSpeed * 0.5, b.velocity);
          }
        } else {
          state = 'roaming'; pb.setData('animalState', state);
          pb.setData('roamNext', now + Phaser.Math.Between(2000, 5000));
        }
      } else if (state === 'alert') {
        b.setVelocity(0, 0);
      } else if (state === 'grazing') {
        b.setVelocity(0, 0);
        if (now > (pb.getData('grazeEnd') as number)) {
          state = 'roaming'; pb.setData('animalState', state);
          pb.setData('roamNext', now + Phaser.Math.Between(3000, 8000));
        }
      } else if (state === 'resting') {
        b.setVelocity(0, 0);
        if (now > (pb.getData('restEnd') as number)) {
          pb.setData('packRole', null); pb.setData('packTarget', null);
          state = 'roaming'; pb.setData('animalState', state);
          pb.setData('roamNext', now + Phaser.Math.Between(2000, 5000));
        }
      } else if (state === 'pack-flushing') {
        const pt = pb.getData('packTarget') as Phaser.GameObjects.Sprite | null;
        const hs = pb.getData('packHuntStart') as number;
        if (!pt?.active || now - hs > 6000) {
          const caught = pt?.active && Phaser.Math.Distance.Between(pb.x, pb.y, pt.x, pt.y) < 25
            && now - hs > 3000 && Math.random() < 0.10;
          if (caught) this.killAnimal(pt!);
          state = 'resting'; pb.setData('animalState', state);
          pb.setData('restEnd', now + Phaser.Math.Between(caught ? 10000 : 5000, caught ? 16000 : 10000));
          pb.setData('packRole', null); pb.setData('packTarget', null);
          b.setVelocity(0, 0); this.playAnimalAnim(spr, type, 'idle', pb);
        } else {
          const tw = Phaser.Math.Angle.Between(pb.x, pb.y, pt.x, pt.y);
          this.scene.physics.velocityFromRotation(tw, effFleeSpeed, b.velocity);
        }
      } else if (state === 'pack-intercepting') {
        const pt = pb.getData('packTarget') as Phaser.GameObjects.Sprite | null;
        const hs = pb.getData('packHuntStart') as number;
        if (!pt?.active || now - hs > 8000) {
          state = 'resting'; pb.setData('animalState', state);
          pb.setData('restEnd', now + Phaser.Math.Between(5000, 10000));
          pb.setData('packRole', null); pb.setData('packTarget', null);
          b.setVelocity(0, 0); this.playAnimalAnim(spr, type, 'idle', pb);
        } else {
          const flusher = (bodiesByType.get(type) ?? []).find(m => m.getData('packRole') === 'flusher');
          if (flusher) {
            const fa = Phaser.Math.Angle.Between(flusher.x, flusher.y, pt.x, pt.y);
            const ix = pt.x + Math.cos(fa) * 150;
            const iy = pt.y + Math.sin(fa) * 150;
            const tw = Phaser.Math.Angle.Between(pb.x, pb.y, ix, iy);
            this.scene.physics.velocityFromRotation(tw, effFleeSpeed, b.velocity);
          }
          if (Phaser.Math.Distance.Between(pb.x, pb.y, pt.x, pt.y) < 40 && now - hs > 2000 && Math.random() < 0.003) {
            this.killAnimal(pt);
            state = 'resting'; pb.setData('animalState', state);
            pb.setData('restEnd', now + Phaser.Math.Between(10000, 18000));
            pb.setData('packRole', null); pb.setData('packTarget', null);
            b.setVelocity(0, 0); this.playAnimalAnim(spr, type, 'idle', pb);
            for (const mate of (bodiesByType.get(type) ?? [])) {
              if (mate === pb) continue;
              if (mate.getData('packTarget') === pt) {
                mate.setData('packRole', null); mate.setData('packTarget', null);
                mate.setData('animalState', 'resting' satisfies AnimalState);
                mate.setData('restEnd', now + Phaser.Math.Between(8000, 14000));
                (mate.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
              }
            }
          }
        }
      } else if (state === 'foraging') {
        b.setVelocity(0, 0);
        if (now > (pb.getData('forageEnd') as number)) {
          state = 'roaming'; pb.setData('animalState', state);
          pb.setData('roamNext', now + Phaser.Math.Between(2000, 5000));
        }
      } else if (state === 'investigating') {
        const invX = (pb.getData('investigateX') as number) ?? pb.x;
        const invY = (pb.getData('investigateY') as number) ?? pb.y;
        const invT = (pb.getData('investigateTimeout') as number) ?? 0;
        if (Phaser.Math.Distance.Between(pb.x, pb.y, invX, invY) < 20 || now > invT) {
          state = 'roaming'; pb.setData('animalState', state);
          pb.setData('roamNext', now + Phaser.Math.Between(2000, 5000));
          this.playAnimalAnim(spr, type, 'idle', pb);
        } else {
          const tw = Phaser.Math.Angle.Between(pb.x, pb.y, invX, invY);
          this.scene.physics.velocityFromRotation(tw, effRoamSpeed * 0.7, b.velocity);
        }
      } else if (state === 'roaming' && now > (pb.getData('roamNext') as number)) {
        const tileSize = this.config.tileSize ?? 32;
        const dtx = Math.floor(pb.x / tileSize);
        const dty = Math.floor(pb.y / tileSize);

        // Drinking near water
        if (this.config.hasAdjacentWater?.(dtx, dty) && now > ((pb.getData('forageCooldown') as number) ?? 0)
            && Math.random() < 0.15) {
          state = 'foraging'; pb.setData('animalState', state); b.setVelocity(0, 0);
          this.playAnimalAnim(spr, type, 'drink', pb);
          pb.setData('forageEnd', now + Phaser.Math.Between(2000, 5000));
          pb.setData('forageCooldown', now + Phaser.Math.Between(15000, 30000));
        }
        // Curiosity
        else if (archetype === 'predator' && Math.random() < 0.05 && this.noiseEvents.length > 0) {
          const rn = this.noiseEvents.find(n => now - n.time < 10000);
          if (rn) {
            state = 'investigating'; pb.setData('animalState', state);
            pb.setData('investigateX', rn.x); pb.setData('investigateY', rn.y);
            pb.setData('investigateTimeout', now + 8000);
          }
        }
        // Grazing
        else if (archetype === 'grazer' && Math.random() < 0.25) {
          state = 'grazing'; pb.setData('animalState', state); b.setVelocity(0, 0);
          this.playAnimalAnim(spr, type, 'eat', pb);
          pb.setData('grazeEnd', now + Phaser.Math.Between(4000, 8000));
        }
        // Foraging
        else if (this.foragingMap[type] && now > (pb.getData('forageCooldown') as number ?? 0) && Math.random() < 0.20) {
          const fd = this.foragingMap[type]!;
          const biomeIdx = this.config.getBiomeAtTile?.(dtx, dty) ?? -1;
          let canForage = fd.biomes.includes(biomeIdx);
          if (canForage && fd.type === 'fishing') canForage = this.config.hasAdjacentWater?.(dtx, dty) ?? false;
          if (!canForage && fd.type === 'scavenging') canForage = (this.config.pathAffinityScore?.(pb.x, pb.y) ?? 0) > 0;
          if (canForage) {
            state = 'foraging'; pb.setData('animalState', state); b.setVelocity(0, 0);
            this.playAnimalAnim(spr, type, 'eat', pb);
            pb.setData('forageEnd', now + Phaser.Math.Between(fd.duration[0], fd.duration[1]));
            pb.setData('forageCooldown', now + Phaser.Math.Between(fd.cooldown[0], fd.cooldown[1]));
          } else { pb.setData('roamNext', now + Phaser.Math.Between(3000, 8000)); }
        } else {
          // Pick roaming direction with archetype biases
          let bestAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          let bestScore = -Infinity;
          let biasAngle = 0, biasStrength = 0;
          const pathAff = this.config.pathAffinityScore ?? (() => Math.random() * 0.5);

          if (stage === 'young') {
            const hm = bodiesByType.get(type);
            if (hm) {
              let na: Phaser.GameObjects.Sprite | null = null, nd = 200;
              for (const m of hm) {
                if (m === pb) continue;
                if ((m.getData('lifeStage') as LifeStage) === 'young') continue;
                const d = Phaser.Math.Distance.Between(pb.x, pb.y, m.x, m.y);
                if (d < nd) { nd = d; na = m; }
              }
              if (na) { biasAngle = Phaser.Math.Angle.Between(pb.x, pb.y, na.x, na.y); biasStrength = Math.min(nd / 40, 3.0); }
            }
          } else if (archetype === 'grazer') {
            const hm = bodiesByType.get(type);
            if (hm && hm.length > 1) {
              let nm: Phaser.GameObjects.Sprite | null = null, nd = 300;
              for (const m of hm) {
                if (m === pb) continue;
                const d = Phaser.Math.Distance.Between(pb.x, pb.y, m.x, m.y);
                if (d < nd) { nd = d; nm = m; }
              }
              if (nm) { biasAngle = Phaser.Math.Angle.Between(pb.x, pb.y, nm.x, nm.y); biasStrength = 0.8; }
            }
          } else if (archetype === 'predator') {
            const hx = pb.getData('worldX') as number;
            const hy = pb.getData('worldY') as number;
            const dh = Phaser.Math.Distance.Between(pb.x, pb.y, hx, hy);
            if (dh > 200) { biasAngle = Phaser.Math.Angle.Between(pb.x, pb.y, hx, hy); biasStrength = Math.min((dh - 200) / 200, 1.5); }
          } else if (archetype === 'critter') {
            const hx = pb.getData('worldX') as number;
            const hy = pb.getData('worldY') as number;
            const dh = Phaser.Math.Distance.Between(pb.x, pb.y, hx, hy);
            if (dh > 60) { biasAngle = Phaser.Math.Angle.Between(pb.x, pb.y, hx, hy); biasStrength = (dh / 100) * 1.5; }
          }

          for (let c = 0; c < 4; c++) {
            const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
            const tx = pb.x + Math.cos(a) * 80;
            const ty = pb.y + Math.sin(a) * 80;
            let score = pathAff(tx, ty) + Math.random() * 0.4;
            if (biasStrength > 0) score += Math.cos(a - biasAngle) * biasStrength;
            if (score > bestScore) { bestScore = score; bestAngle = a; }
          }
          this.scene.physics.velocityFromRotation(bestAngle, effRoamSpeed, b.velocity);

          // Pack cohesion
          const pri = this.predatorMap.get(type);
          if (pri?.strategy === 'pack') {
            const neighbours: BoidsNeighbour[] = [];
            for (const m of bodiesByType.get(type) ?? []) {
              if (m === pb) continue;
              const mb = m.body as Phaser.Physics.Arcade.Body;
              neighbours.push({ x: m.x, y: m.y, vx: mb.velocity.x, vy: mb.velocity.y });
            }
            if (neighbours.length > 0) {
              const steer = SwarmBrain.steer(pb.x, pb.y, effRoamSpeed, neighbours, BASE_WEIGHTS);
              b.setVelocity(b.velocity.x * 0.8 + steer.vx * 0.2, b.velocity.y * 0.8 + steer.vy * 0.2);
            }
          }
          pb.setData('roamNext', now + Phaser.Math.Between(3000, 8000));
        }
      }

      // ── WalkGrid collision: prevent animals from entering blocked tiles ──
      // Check the tile under the physics body. If blocked, revert position and bounce.
      const tileSize = this.config.tileSize ?? 32;
      const wg = this.config.walkGrid;
      const gW = this.config.gridW ?? 0;
      if (wg && gW > 0) {
        const ttx = Math.floor(pb.x / tileSize);
        const tty = Math.floor(pb.y / tileSize);
        if (ttx >= 0 && tty >= 0 && ttx < gW && tty < (this.config.gridH ?? 0)) {
          if (wg[tty * gW + ttx] === 1) {
            // Blocked — revert to last safe position (worldX/worldY) and bounce
            const safeX = pb.getData('worldX') as number;
            const safeY = pb.getData('worldY') as number;
            pb.setPosition(safeX, safeY);
            b.setVelocity(-b.velocity.x * 0.5, -b.velocity.y * 0.5);
            if (state === 'roaming') pb.setData('roamNext', 0);
          } else {
            // Update last safe position
            pb.setData('worldX', pb.x);
            pb.setData('worldY', pb.y);
          }
        }
      }

      // ── Boundary clamping (world space — simple) ──
      const MARGIN = 40;
      const wW = this.config.worldW;
      const wH = this.config.worldH;
      let clamped = false;
      if (pb.x < MARGIN) { pb.x = MARGIN; clamped = true; }
      if (pb.x > wW - MARGIN) { pb.x = wW - MARGIN; clamped = true; }
      if (pb.y < MARGIN) { pb.y = MARGIN; clamped = true; }
      if (pb.y > wH - MARGIN) { pb.y = wH - MARGIN; clamped = true; }
      if (this.config.spawnBias && this.config.spawnBias(pb.x, pb.y, type) <= 0) {
        pb.x = Phaser.Math.Clamp(pb.x, MARGIN, wW * 0.45);
        pb.y = Phaser.Math.Clamp(pb.y, MARGIN, wH - MARGIN);
        clamped = true;
      }
      if (clamped) {
        b.setVelocity(-b.velocity.x * 0.5, -b.velocity.y * 0.5);
        if (state === 'roaming') pb.setData('roamNext', 0);
      }

      // ── FlipX + directional animation refresh ──
      const { svx } = this.worldVelToScreenDir(b.velocity.x, b.velocity.y);
      if (Math.abs(svx) > 5) spr.setFlipX(svx < 0);

      if (state === 'fleeing' || state === 'chasing' || state === 'pack-flushing' || state === 'pack-intercepting') {
        this.playAnimalAnim(spr, type, 'run', pb, b.velocity);
      } else if (state === 'roaming' && (Math.abs(b.velocity.x) > 2 || Math.abs(b.velocity.y) > 2)) {
        this.playAnimalAnim(spr, type, 'walk', pb, b.velocity);
      } else if (state === 'stalking' || state === 'investigating') {
        this.playAnimalAnim(spr, type, 'walk', pb, b.velocity);
      }

      // ── Obstacle avoidance ──
      if (state === 'roaming' || state === 'fleeing' || state === 'chasing' || state === 'investigating') {
        const speed = Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y);
        const expected = state === 'fleeing' ? effFleeSpeed * 0.3 : effRoamSpeed * 0.3;
        if (speed < expected && speed > 0.1) {
          const ca = Math.atan2(b.velocity.y, b.velocity.x);
          const deflect = ca + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
          this.scene.physics.velocityFromRotation(deflect, state === 'fleeing' ? effFleeSpeed : effRoamSpeed, b.velocity);
        }
      }

      // ── Vocalizations ──
      const VOCAL_SILENT = new Set<string>(['sleeping', 'fleeing', 'dying', 'injured', 'frozen', 'chasing', 'ambush-strike', 'pack-flushing']);
      if (!VOCAL_SILENT.has(state) && this.config.audio?.available) {
        const nc = (pb.getData('ambientSoundTimer') as number) ?? 0;
        if (now > nc) {
          const SA: Record<string, string> = {
            deer: 'animal-deer', stag: 'animal-deer', hare: 'animal-hare',
            fox: 'animal-fox', badger: 'animal-fox', boar: 'animal-fox', grouse: 'animal-bird',
          };
          const ak = SA[type];
          if (ak) {
            const vd = Phaser.Math.Distance.Between(pb.x, pb.y, px, py);
            if (vd < 400) {
              const vol = Math.max(0, (400 - vd) / 400) * 0.25 * this.config.audio.sfxVol;
              this.config.audio.playSound(ak, { volume: vol, rate: Phaser.Math.FloatBetween(0.9, 1.1), pan: this.config.audio.stereoPan(spr.x) });
            }
          }
          pb.setData('ambientSoundTimer', now + (archetype === 'predator' ? Phaser.Math.Between(5000, 15000) : Phaser.Math.Between(8000, 25000)));
        }
      }

      // ── Project physics body → iso sprite ──
      const { x: ix, y: iy } = this.config.worldToIso(pb.x, pb.y);
      spr.setPosition(ix, iy);
      spr.setDepth(this.config.isoDepth(pb.x, pb.y));
    }
  }

  // ── Private: birds ─────────────────────────────────────────────────────────
  // Birds already use world-space (worldX/worldY) with iso projection — no changes needed.

  private updateBirds(time: number, delta: number, playerX: number, playerY: number): void {
    if (this.birds.length === 0) return;
    const dt = delta / 1000;
    const WORLD_W = this.config.worldW;
    const WORLD_H = this.config.worldH;
    const SHADOW_DX = this.config.birdShadowDx ?? 7;
    const SHADOW_DY = this.config.birdShadowDy ?? 5;

    // Boid flocking
    const FLOCK_RADIUS = 100;
    const SEPARATION_DIST = 30;
    for (let i = 0; i < this.birds.length; i++) {
      const bird = this.birds[i];
      if (bird.playerControlled) continue;
      if (bird.huntState && bird.huntState !== 'flying') continue;
      if (bird.landState && bird.landState !== 'flying') continue;
      let alignVx = 0, alignVy = 0, alignCount = 0, sepX = 0, sepY = 0;
      for (let j = 0; j < this.birds.length; j++) {
        if (i === j) continue;
        const o = this.birds[j];
        const dx = bird.worldX - o.worldX, dy = bird.worldY - o.worldY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < FLOCK_RADIUS) {
          alignVx += o.vx; alignVy += o.vy; alignCount++;
          if (d < SEPARATION_DIST && d > 0) { sepX += (dx / d) * (SEPARATION_DIST - d); sepY += (dy / d) * (SEPARATION_DIST - d); }
        }
      }
      if (alignCount > 0) {
        alignVx /= alignCount; alignVy /= alignCount;
        const sp = Math.sqrt(bird.vx * bird.vx + bird.vy * bird.vy);
        bird.vx = bird.vx * 0.85 + alignVx * 0.10 + sepX * 0.05;
        bird.vy = bird.vy * 0.85 + alignVy * 0.10 + sepY * 0.05;
        const ns = Math.sqrt(bird.vx * bird.vx + bird.vy * bird.vy);
        if (ns > 0) { bird.vx = (bird.vx / ns) * sp; bird.vy = (bird.vy / ns) * sp; }
      }
    }

    // Landing
    for (const bird of this.birds) {
      if (bird.playerControlled) continue;
      if (bird.huntState && bird.huntState !== 'flying') continue;
      const ls = bird.landState ?? 'flying';
      if (ls === 'flying') {
        if (Math.random() < 0.0003) { bird.landState = 'landing'; bird.landTimer = time; bird.vx = 0; bird.vy = 0; }
      } else if (ls === 'landing') {
        const t = Math.min((time - (bird.landTimer ?? time)) / 800, 1);
        bird.shadow.setPosition(bird.body.x + SHADOW_DX * (1 - t), bird.body.y + SHADOW_DY * (1 - t));
        bird.body.setDepth(7 - 5 * t); bird.vx = 0; bird.vy = 0;
        if (t >= 1) { bird.landState = 'grounded'; bird.groundedUntil = time + Phaser.Math.Between(4000, 12000); bird.body.stop(); }
      } else if (ls === 'grounded') {
        bird.vx = 0; bird.vy = 0;
        // playerX/playerY are world-space; compare to bird world position
        if (time > (bird.groundedUntil ?? 0) || Phaser.Math.Distance.Between(bird.worldX, bird.worldY, playerX, playerY) < 120) {
          bird.landState = 'taking-off'; bird.landTimer = time;
          const fa = `${this.config.birdSpriteKey ?? 'grouse-fly'}-anim`;
          if (this.scene.anims.exists(fa)) bird.body.play(fa);
        }
      } else if (ls === 'taking-off') {
        const t = Math.min((time - (bird.landTimer ?? time)) / 600, 1);
        bird.shadow.setPosition(bird.body.x + SHADOW_DX * t, bird.body.y + SHADOW_DY * t);
        bird.body.setDepth(2 + 5 * t); bird.vx = 0; bird.vy = 0;
        if (t >= 1) {
          bird.landState = 'flying'; bird.body.setDepth(7);
          const sp = Phaser.Math.Between(55, 95), a = Phaser.Math.FloatBetween(0, Math.PI * 2);
          bird.vx = Math.cos(a) * sp; bird.vy = Math.sin(a) * sp;
        }
      }
    }

    // Dive hunting — ground animals are now in world space, so distances are world-space
    const DIVE_SPEED = 200, DIVE_DURATION = 800, CLIMB_DURATION = 1200, CIRCLE_RADIUS = 60;
    for (const bird of this.birds) {
      const bt = bird.body.getData('animalType') as string;
      const pi = this.predatorMap.get(bt);
      if (!pi || pi.strategy !== 'dive') continue;
      const hs = bird.huntState ?? 'flying';
      const hst = bird.huntStartTime ?? 0;

      if (hs === 'flying') {
        if (bird.huntCooldown && time < bird.huntCooldown) continue;
        const gsBodies = this.groundAnimals.getChildren() as Phaser.GameObjects.Sprite[];
        for (const prey of gsBodies) {
          if (!prey.active) continue;
          const pt = prey.getData('animalType') as string;
          if (!pi.prey.includes(pt)) continue;
          // Both bird.worldX/Y and prey.x/y are world space
          const d = Phaser.Math.Distance.Between(bird.worldX, bird.worldY, prey.x, prey.y);
          if (d < pi.range && Math.random() < 0.005) {
            bird.huntState = 'circling'; bird.huntTarget = prey;
            bird.huntStartTime = time; bird.circleAngle = 0; break;
          }
        }
      } else if (hs === 'circling') {
        const t = bird.huntTarget;
        if (!t?.active) { bird.huntState = 'flying'; bird.huntTarget = null; continue; }
        // Target x/y is now world space
        bird.circleAngle = (bird.circleAngle ?? 0) + 2.0 * dt;
        bird.worldX = t.x + Math.cos(bird.circleAngle) * CIRCLE_RADIUS;
        bird.worldY = t.y + Math.sin(bird.circleAngle) * CIRCLE_RADIUS;
        bird.vx = 0; bird.vy = 0;
        if (time - hst > Phaser.Math.Between(2000, 4000)) {
          bird.huntState = 'diving'; bird.huntStartTime = time; bird.body.setDepth(3);
        }
      } else if (hs === 'diving') {
        const t = bird.huntTarget;
        if (!t?.active) { bird.huntState = 'climbing'; bird.huntStartTime = time; bird.body.setDepth(7); continue; }
        const ang = Math.atan2(t.y - bird.worldY, t.x - bird.worldX);
        bird.worldX += Math.cos(ang) * DIVE_SPEED * dt;
        bird.worldY += Math.sin(ang) * DIVE_SPEED * dt;
        bird.vx = 0; bird.vy = 0; bird.shadow.setScale(0.5);
        if (time - hst > DIVE_DURATION) {
          const dp = Phaser.Math.Distance.Between(bird.worldX, bird.worldY, t.x, t.y);
          if (dp < 30 && Math.random() < 0.30) this.killAnimal(t);
          bird.huntState = 'climbing'; bird.huntStartTime = time;
          bird.body.setDepth(7); bird.shadow.setScale(1);
        }
      } else if (hs === 'climbing') {
        bird.vx = 0; bird.vy = 0;
        if (time - hst > CLIMB_DURATION) {
          bird.huntState = 'flying'; bird.huntTarget = null; bird.huntCooldown = time + 15000;
          const sp = Phaser.Math.Between(55, 95), a = Phaser.Math.FloatBetween(0, Math.PI * 2);
          bird.vx = Math.cos(a) * sp; bird.vy = Math.sin(a) * sp;
        }
      }
    }

    // Position update
    for (const bird of this.birds) {
      if (bird.landState && bird.landState !== 'flying') continue;
      if (!bird.playerControlled && time > bird.nextDirChange) {
        const sp = Math.sqrt(bird.vx * bird.vx + bird.vy * bird.vy);
        const na = Math.atan2(bird.vy, bird.vx) + Phaser.Math.FloatBetween(-0.5, 0.5);
        bird.vx = Math.cos(na) * sp; bird.vy = Math.sin(na) * sp;
        bird.nextDirChange = time + Phaser.Math.Between(6000, 14000);
      }
      let nx = bird.worldX + bird.vx * dt;
      let ny = bird.worldY + bird.vy * dt;
      if (nx < 40 || nx > WORLD_W - 40) { bird.vx = -bird.vx; nx = Phaser.Math.Clamp(nx, 40, WORLD_W - 40); }
      if (ny < 40 || ny > WORLD_H - 40) { bird.vy = -bird.vy; ny = Phaser.Math.Clamp(ny, 40, WORLD_H - 40); }
      bird.worldX = nx; bird.worldY = ny;
      const { x: isoX, y: isoY } = this.config.worldToIso(nx, ny);
      bird.body.setPosition(isoX, isoY);
      bird.shadow.setPosition(isoX + SHADOW_DX, isoY + SHADOW_DY);
      if (bird.vx !== 0) bird.body.setFlipX(bird.vx < 0);
    }
  }
}
