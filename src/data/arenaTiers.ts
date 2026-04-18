/**
 * Arena tier configuration — one entry per tier, passed to CombatArenaScene
 * via Phaser's init(data) mechanism so the same scene class handles all tiers.
 *
 * ## How it works
 *
 * `scene.start('CombatArenaScene', TIER_CONFIGS[i])` passes the chosen config
 * as the `data` argument.  CombatArenaScene.init() stores it and falls back to
 * TIER_CONFIGS[0] when no data is passed (e.g. CI screenshots).
 *
 * ## Adding a new tier
 *
 * 1. Append an entry to TIER_CONFIGS.
 * 2. Make sure every `EnemyCtor` in `waveGroups` is a class that extends
 *    CombatEntity with a `(scene, x, y)` constructor — Enemy-subclasses and
 *    constructors with extra required params are NOT compatible.
 * 3. Add the hero key to the `HeroKey` union if it is new.
 */

import * as Phaser from 'phaser';
import { CombatEntity } from '../entities/CombatEntity';
import { BabyVelcrid, VelcridJuvenile, VelcridAdult } from '../entities/Velcrid';
import { Blightfrog } from '../entities/Blightfrog';
import { Spineling } from '../entities/Spineling';
import { SporeDrifter } from '../entities/SporeDrifter';
import { MimicCrawler } from '../entities/MimicCrawler';
import { Thornvine } from '../entities/Thornvine';
import { Venomantis } from '../entities/Venomantis';
import { BroodMother, EggSac } from '../entities/BroodMother';
import { Progenitor } from '../entities/Progenitor';
import {
  GlitchDrone,
  StaticCrawler,
  RustBerserker,
  TrackerUnit,
  StaticGhost,
  SwarmMatrix,
  ScrapGolem,
  InfectedAPC,
  TitanPrototype,
  TitanHalf,
} from '../entities/EarthEnemies';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Constructor signature shared by all arena-compatible enemies.
 * Classes that extend Enemy (not CombatEntity) or have extra required
 * constructor params (e.g. PackStalker) do NOT satisfy this type.
 */
export type EnemyCtor = new (scene: Phaser.Scene, x: number, y: number) => CombatEntity;

/**
 * Hero keys recognised by CombatArenaScene.spawnHero().
 * Spinolandet heroes (lund, symbiont-karin, chimera, apex, overmind) extend
 * LivingEntity rather than CombatEntity — supporting them in the arena requires
 * a separate refactor and is tracked separately.
 */
export type HeroKey =
  | 'tinkerer'
  | 'maja-lind'
  | 'torsten-kraft'
  | 'ironwing'
  | 'rampart'
  | 'kronos';

/** One spawn group: the name shown in the HUD and the enemies to create. */
export interface WaveGroup {
  label:   string;
  enemies: EnemyCtor[];
}

/**
 * Full configuration for one arena tier session.
 * Passed to CombatArenaScene via `scene.start(key, config)`.
 */
export interface ArenaTierConfig {
  /** Tier number, 1–5. Shown in the ArenaSelectScene list. */
  tier: number;
  /** Short display name for the HUD and tier selector. */
  label: string;
  /** Which hero to spawn. */
  heroKey: HeroKey;
  /** Wave groups that cycle repeatedly, with escalation pressure each cycle. */
  waveGroups: WaveGroup[];
}

// ── Tier configs ──────────────────────────────────────────────────────────────

export const TIER_CONFIGS: ArenaTierConfig[] = [

  // ── Tier 1 — MajaLind ──────────────────────────────────────────────────────
  // Simple rushers; pressure comes from numbers not individual danger.
  // The T1 config is also the default when no config is passed (CI / screenshots).
  {
    tier:    1,
    label:   'Tier 1 — MajaLind',
    heroKey: 'maja-lind',
    waveGroups: [
      { label: 'Hatchling Rush',  enemies: [BabyVelcrid, BabyVelcrid, BabyVelcrid] },
      { label: 'Scout Pair',      enemies: [VelcridJuvenile, VelcridJuvenile] },
      { label: 'Mixed Swarm',     enemies: [VelcridJuvenile, BabyVelcrid, BabyVelcrid] },
      { label: 'Baby Horde',      enemies: [BabyVelcrid, BabyVelcrid, BabyVelcrid, BabyVelcrid] },
      { label: 'Reaver Scout',    enemies: [VelcridJuvenile, VelcridJuvenile, BabyVelcrid] },
    ],
  },

  // ── Tier 2 — TorstenKraft ──────────────────────────────────────────────────
  // Enemies start demanding movement — Blightfrog roots, Spineling flanks.
  // Earth drones mixed in to test the assault-rifle kit against varied targets.
  {
    tier:    2,
    label:   'Tier 2 — TorstenKraft',
    heroKey: 'torsten-kraft',
    waveGroups: [
      { label: 'Blightfrog Pair',   enemies: [Blightfrog, Blightfrog] },
      { label: 'Spineling Sprint',  enemies: [Spineling, Spineling, Spineling] },
      { label: 'Drone Escort',      enemies: [GlitchDrone, GlitchDrone, GlitchDrone] },
      { label: 'Crawler Screen',    enemies: [StaticCrawler, StaticCrawler, Blightfrog] },
      { label: 'Mixed Threat',      enemies: [Blightfrog, Spineling, Spineling] },
      { label: 'Tracker Hunt',      enemies: [TrackerUnit, TrackerUnit] },
      { label: 'Spineling Horde',   enemies: [Spineling, Spineling, Spineling, Spineling] },
    ],
  },

  // ── Tier 3 — Ironwing ──────────────────────────────────────────────────────
  // First power spike: Ironwing's AoE stomp clears groups.  Enemies create
  // positioning puzzles — Spore zones, VelcridAdult burrow surprises, Mimics
  // baiting the player.  Earth StaticGhost + SwarmMatrix add attrition.
  {
    tier:    3,
    label:   'Tier 3 — Ironwing',
    heroKey: 'ironwing',
    waveGroups: [
      { label: 'Spore Drift',      enemies: [SporeDrifter, SporeDrifter, SporeDrifter] },
      { label: 'Adult Hunt',       enemies: [VelcridAdult, VelcridJuvenile, VelcridJuvenile] },
      { label: 'Mimic Crawl',      enemies: [MimicCrawler, MimicCrawler, MimicCrawler] },
      { label: 'Ghost Patrol',     enemies: [StaticGhost, StaticGhost, StaticGhost] },
      { label: 'Swarm Matrix',     enemies: [SwarmMatrix] },
      { label: 'Berserker Rush',   enemies: [RustBerserker, RustBerserker] },
      { label: 'Spore + Mimic',    enemies: [SporeDrifter, MimicCrawler, MimicCrawler] },
      { label: 'Adult + Ghost',    enemies: [VelcridAdult, StaticGhost, StaticGhost] },
    ],
  },

  // ── Tier 4 — Rampart ───────────────────────────────────────────────────────
  // Siege mech against late-game horrors.  BroodMother creates secondary spawn
  // pressure.  Thornvine and Venomantis punish standing still.  ScrapGolem and
  // InfectedAPC test the heavy-cannon at close range.
  {
    tier:    4,
    label:   'Tier 4 — Rampart',
    heroKey: 'rampart',
    waveGroups: [
      { label: 'Brood Eruption',    enemies: [BroodMother, EggSac, EggSac, EggSac] },
      { label: 'Thornvine Wall',    enemies: [Thornvine, Thornvine, Thornvine] },
      { label: 'Venom Strike',      enemies: [Venomantis, Venomantis] },
      { label: 'Scrap Assault',     enemies: [ScrapGolem, ScrapGolem] },
      { label: 'APC Advance',       enemies: [InfectedAPC, InfectedAPC] },
      { label: 'Brood + Thornvine', enemies: [BroodMother, Thornvine, Thornvine] },
      { label: 'Venom + Brood',     enemies: [Venomantis, BroodMother, EggSac, EggSac] },
    ],
  },

  // ── Tier 5 — Kronos ────────────────────────────────────────────────────────
  // End-game: the hero IS a disaster.  Regular waves use enemies that were apex
  // threats at T3/T4.  Boss encounters (Progenitor, TitanPrototype) are the
  // real test.
  //
  // Note: TitanPrototype emits a 'titan-split' event when it reaches low HP —
  // CombatArenaScene must listen for this and spawn two TitanHalf instances.
  // That wiring is tracked under FIL-397.
  {
    tier:    5,
    label:   'Tier 5 — Kronos',
    heroKey: 'kronos',
    waveGroups: [
      { label: 'Horror Pack',    enemies: [Venomantis, Thornvine, SporeDrifter] },
      { label: 'Brood Surge',    enemies: [BroodMother, EggSac, EggSac, EggSac, EggSac] },
      { label: 'Mimic Horde',    enemies: [MimicCrawler, MimicCrawler, MimicCrawler, MimicCrawler] },
      { label: 'Titan Vanguard', enemies: [TitanHalf, TitanHalf] },
      { label: 'APC + Golem',    enemies: [InfectedAPC, ScrapGolem, ScrapGolem] },
      { label: 'Progenitor',     enemies: [Progenitor] },
      { label: 'TITAN',          enemies: [TitanPrototype] },
    ],
  },
];
