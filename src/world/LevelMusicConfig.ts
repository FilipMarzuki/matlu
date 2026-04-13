/**
 * LevelMusicConfig — per-level music and audio design for the five-level arc.
 *
 * ## Why this file exists
 *
 * The game's audio shifts dramatically across the five levels — from the cozy
 * Nordic warmth of Höga Kusten to near-silence at the Source. This file
 * captures that design as typed data so:
 *
 *   1. GameScene (or a future LevelScene) can call `loadLevelMusic(scene, n)` in
 *      preload() to load exactly the tracks needed for that level.
 *   2. The Level 4 layered-track architecture is designed and documented before
 *      the Level 4 map is built — the code is ready, it just needs to be called.
 *   3. Corruption SFX intensity per level is a single number, not scattered magic
 *      constants across the codebase.
 *
 * ## How to use
 *
 * In preload():
 * ```ts
 * const cfg = getLevelMusicConfig(1);      // or whatever level is loading
 * for (const t of cfg.tracks) {
 *   this.load.audio(t.key, t.urls);
 * }
 * if (cfg.ambienceUrl) {
 *   this.load.audio('level-ambience', cfg.ambienceUrl);
 * }
 * ```
 *
 * In create():
 * ```ts
 * this.startLevelMusic(cfg, this.currentPhase);
 * ```
 *
 * In update():
 * ```ts
 * this.maybePlayCorruptionSfx(delta, cfg.corruptionSfxMultiplier);
 * ```
 *
 * ## Audio asset inventory
 *
 * Level 1 uses Cozy Tunes (Pro) v1.4 — already loaded and wired.
 * Levels 2–5 use the 2026 Q1 Music Loop Bundle (`music-loop-bundle-2026-q1/`).
 * The bundle files have descriptive names that map well to the FIL-143 arc tones.
 */

/** Base path for the 2026 Q1 music loop bundle — shorter paths in track configs. */
const MB = 'assets/audio/music-loop-bundle-2026-q1';

// ─── Track descriptor ─────────────────────────────────────────────────────────

/**
 * A single audio asset to load in preload().
 * `urls` is an array so Phaser can pick the first format the browser supports
 * (same pattern as the existing music-dawn/day/dusk/night loads).
 */
export interface TrackDef {
  /** Phaser audio cache key — used in sound.add(key, ...) calls */
  key: string;
  /** One or more file paths, tried in order by Phaser */
  urls: string[];
}

// ─── Music cycle types ────────────────────────────────────────────────────────

/**
 * How music progresses within a level:
 *
 * - `day-night`          Level 1. Four tracks: dawn/day/dusk/night. Already implemented.
 * - `spore-bloom`        Level 2. Two tracks: bloom (wonder) / spore (danger).
 *                        Alternates on a biological rhythm, not a solar one.
 * - `zone-proximity`     Level 3. Two tracks: far from dry zones (ethereal) /
 *                        near dry zones (melancholic). Crossfades based on zone.
 * - `layered`            Level 4. Three simultaneous tracks, one per world.
 *                        Volumes shift based on which world's terrain the player
 *                        is standing in — creating clash or resolve moments.
 * - `progressive-silence` Level 5. Starts heavy, strips to near-silence at the
 *                        Source. Post-choice: a resolution theme.
 */
export type MusicCycle =
  | 'day-night'
  | 'spore-bloom'
  | 'zone-proximity'
  | 'layered'
  | 'progressive-silence';

// ─── Layered track (Level 4 only) ─────────────────────────────────────────────

/**
 * One layer in the Level 4 three-world clash system.
 *
 * All three layers play simultaneously. Their volumes are adjusted
 * independently based on which world's terrain the player is in:
 *
 *   - In Earth-dominant patches: earth layer at full, others at low
 *   - In Spinolandet-dominant patches: spino layer leads
 *   - In Vattenpandalandet-dominant patches: vatten layer leads
 *   - In unstable/flickering patches: all three equal → dissonance
 *   - Brief alignment moments: all three fade in together → resolve
 *
 * This models the FIL-143 Level 4 narrative: the Seam has no stable tone.
 */
export interface LayeredTrackDef extends TrackDef {
  /** Which world this layer belongs to — used by the volume-mixing logic */
  world: 'earth' | 'spino' | 'vatten';
  /** Volume when this world is dominant (0–1) */
  dominantVolume: number;
  /** Volume when another world is dominant (0–1) */
  backgroundVolume: number;
}

// ─── Per-level music config ───────────────────────────────────────────────────

export interface LevelMusicConfig {
  /** 1-based level number */
  level: number;
  /** Which cycle model drives music progression in this level */
  cycle: MusicCycle;

  /**
   * All tracks to load in preload() for this level.
   * For the layered cycle this includes all three world layers plus
   * any transition stings.
   */
  tracks: TrackDef[];

  /**
   * For day-night and spore-bloom cycles:
   * maps phase name to the track key to play in that phase.
   *
   * Day-night phases: 'dawn' | 'morning' | 'midday' | 'afternoon' | 'dusk' | 'night'
   * Spore-bloom phases: 'bloom' | 'spore'
   * Zone-proximity phases: 'far' | 'near'
   */
  phaseToTrack?: Readonly<Record<string, string>>;

  /**
   * For day-night and spore-bloom cycles:
   * target playback volume for each named phase (0–1).
   */
  phaseVolume?: Readonly<Record<string, number>>;

  /**
   * For the layered cycle (Level 4):
   * three simultaneous tracks with per-world volume mixing.
   * Load these via `tracks`, then start them all in create().
   */
  layers?: LayeredTrackDef[];

  /**
   * For the progressive-silence cycle (Level 5):
   * - `approach` — played in the outer wound (Yttersåret)
   * - `wound`    — played deeper into the Source zone
   * - `silence`  — plays at near-zero volume near the Source itself
   * - `resolve`  — post-choice resolution theme (one of three possible endings)
   */
  progressionTrackKeys?: {
    approach: string;
    wound: string;
    silence: string;
    resolve: string;
  };

  /**
   * URL for the ambient sound loop (background drone/nature/hum).
   * Null = level has no ambient loop (Level 5: "no birdsong, no wind").
   */
  ambienceUrl: string[] | null;

  /**
   * How dense and intense corruption SFX are in this level, relative to
   * Level 1 baseline (1.0). Scales both play frequency and volume.
   *
   * Level 1: 1.0  — subtle and rare, out of place against the warmth
   * Level 2: 1.6  — more frequent, bioluminescence masks but doesn't silence it
   * Level 3: 2.2  — the Dry makes the wrongness audible
   * Level 4: 3.5  — three corruption strains at full strength
   * Level 5: 5.0  — the wound itself, SFX is near-constant near the Source
   */
  corruptionSfxMultiplier: number;

  /**
   * Proximity to the portal/tear at which music begins shifting.
   * For `day-night`: the daytime track fades slightly and a dissonant undertone
   *   creeps in (implementation: raise sfx-corruption volume, lower music volume).
   * For other cycles: the current phase track fades toward the next phase.
   *
   * Set to 0 for Level 5 — the whole level IS the source, no portal gradient.
   */
  portalShiftRadius: number;
}

// ─── Per-level configs ────────────────────────────────────────────────────────

const COZY_BASE = 'assets/audio/Cozy Tunes (Pro) v1.4/Cozy Tunes (Pro)/Audio/ogg/Tracks';

/** Level 1 — Höga Kusten Varnad: Cozy → Uneasy */
const LEVEL1_MUSIC: LevelMusicConfig = {
  level: 1,
  cycle: 'day-night',
  tracks: [
    // These match the existing preload() calls in GameScene exactly.
    // Cozy Tunes (Pro) — one track per day phase, Nordic/cozy feel.
    { key: 'music-dawn',  urls: [`${COZY_BASE}/Sunlight Through Leaves.ogg`] },
    { key: 'music-day',   urls: [`${COZY_BASE}/Whispering Woods.ogg`]       },
    { key: 'music-dusk',  urls: [`${COZY_BASE}/Evening Harmony.ogg`]        },
    { key: 'music-night', urls: [`${COZY_BASE}/Polar Lights.ogg`]           },
  ],
  phaseToTrack: {
    // Multiple day phases share the same track (morning/midday/afternoon = 'day').
    // This deduplication is intentional — 'Whispering Woods' covers the whole
    // bright part of the day without an awkward mid-afternoon crossfade.
    dawn:      'music-dawn',
    morning:   'music-day',
    midday:    'music-day',
    afternoon: 'music-day',
    dusk:      'music-dusk',
    night:     'music-night',
  },
  phaseVolume: {
    dawn:      0.20,
    morning:   0.30,
    midday:    0.28,
    afternoon: 0.25,
    dusk:      0.18,
    night:     0.15,
  },
  ambienceUrl: ['assets/audio/forest-ambience.ogg'],
  corruptionSfxMultiplier: 1.0,  // baseline — rare, out of place against the warmth
  portalShiftRadius: 500,
};

/**
 * Level 2 — The Spine Reaches: Wonder → Danger
 *
 * Earth's solar day/night is replaced by a biological spore/bloom cycle —
 * the world's own rhythm, not Earth's. "Bloom" is the world opening up
 * (wonder); "spore" is the moment the world exhales and everything moves.
 *
 * Audio: driving, organic, percussion-forward. Woodwinds, sounds that feel
 * biological. The two Ruined Lands tracks work perfectly:
 *   - HOPE = awe, distance, something enormous but not yet threatening
 *   - WASTELAND = the danger that was always underneath the wonder
 */
const LEVEL2_MUSIC: LevelMusicConfig = {
  level: 2,
  cycle: 'spore-bloom',
  tracks: [
    { key: 'music-l2-bloom',     urls: [`${MB}/Week 2 - Ruined Lands HOPE.ogg`]      },
    { key: 'music-l2-spore',     urls: [`${MB}/Week 2 - Ruined Lands WASTELAND.ogg`] },
  ],
  phaseToTrack: {
    bloom: 'music-l2-bloom',
    spore: 'music-l2-spore',
  },
  phaseVolume: {
    bloom: 0.28,  // wonder phase — full but not overwhelming
    spore: 0.22,  // danger phase — slightly quieter, more unease than volume
  },
  // No forest ambience — biological hum TBD (different asset, different world).
  // The bioluminescence replaces birdsong; a deep biological drone would go here.
  ambienceUrl: null,
  corruptionSfxMultiplier: 1.6,
  portalShiftRadius: 600,
};

/**
 * Level 3 — Vattenpandalandet Mist: Ethereal → Melancholic
 *
 * No day/night equivalent in Vattenpandalandet Mist — time is measured by
 * mist density, not sunlight. Music shifts based on how close the player is
 * to dry corruption patches: far = ethereal, near = melancholic.
 *
 * Audio: sparse orchestral. Piano, water instruments (singing bowls, zither).
 * Long silences. Music that feels like it is remembering something.
 *   - Graceful Descent FLOATING = the world before the Dry reached it
 *   - Waiting Room Ennui = something ancient that is slowly ending
 */
const LEVEL3_MUSIC: LevelMusicConfig = {
  level: 3,
  cycle: 'zone-proximity',
  tracks: [
    { key: 'music-l3-ethereal',    urls: [`${MB}/Week 9 - Graceful Descent FLOATING.ogg`] },
    { key: 'music-l3-melancholic', urls: [`${MB}/Week 3 - Waiting Room Ennui.ogg`]        },
  ],
  phaseToTrack: {
    // 'far' = player is not near any dry corruption patch (ethereal tone)
    // 'near' = player is within dry corruption zone radius (melancholic tone)
    far:  'music-l3-ethereal',
    near: 'music-l3-melancholic',
  },
  phaseVolume: {
    far:  0.22,
    near: 0.20,  // melancholic is slightly quieter — the absence of sound
  },
  ambienceUrl: null,  // mist ambience TBD — different from forest ambience
  corruptionSfxMultiplier: 2.2,
  portalShiftRadius: 800,  // larger radius — the tear is visible from further away
};

/**
 * Level 4 — The Seam: Surreal → Tense
 *
 * Three simultaneous music tracks, one per world, playing at independent volumes.
 * Volume mixing is driven by which world's terrain the player is standing in.
 * The resting state is dissonance (all three equal); relief comes from rare
 * moments where the terrain briefly stabilises into one world's aesthetic.
 *
 * Tracks chosen for their compatibility as layers:
 *   - Earth  (Cloak of Darkness STAGE 1): structured, mechanical, tense
 *   - Spino  (Ruined Lands WASTELAND): organic, driving, threatening
 *   - Vatten (Graceful Descent FLOATING): ethereal, drifting, out of place
 *
 * Transition stings play between dominant phases — brief, one-shot tracks
 * that signal the terrain is shifting.
 *
 * ## Implementation notes for when Level 4 map is built
 *
 * In Level 4's create():
 *   1. Load all tracks in preload() using `cfg.tracks`
 *   2. `this.sound.add(layer.key, { loop: true, volume: layer.backgroundVolume })`
 *      for each layer in `cfg.layers`
 *   3. Call `.play()` on all three simultaneously
 *   4. In update(): sample the world blend at player position, crossfade volumes
 *      so the dominant world's layer rises to `layer.dominantVolume`
 *   5. When transitioning between dominant zones, play the appropriate sting once
 */
const LEVEL4_MUSIC: LevelMusicConfig = {
  level: 4,
  cycle: 'layered',
  tracks: [
    // Three simultaneous world-layers
    { key: 'music-l4-earth', urls: [`${MB}/Week 4 - Cloak of Darkness STAGE 1.ogg`]      },
    { key: 'music-l4-spino', urls: [`${MB}/Week 2 - Ruined Lands WASTELAND.ogg`]         },
    { key: 'music-l4-vatten',urls: [`${MB}/Week 9 - Graceful Descent FLOATING.ogg`]      },
    // One-shot transition stings (play on world-dominant shift, not looped)
    { key: 'music-l4-trans-a', urls: [`${MB}/Week 4 - Cloak of Darkness STAGE 2 TRANS.ogg`] },
    { key: 'music-l4-trans-b', urls: [`${MB}/Week 4 - Cloak of Darkness STAGE 3 TRANS.ogg`] },
  ],
  layers: [
    {
      key: 'music-l4-earth',
      urls: [`${MB}/Week 4 - Cloak of Darkness STAGE 1.ogg`],
      world: 'earth',
      dominantVolume: 0.28,   // leads when Earth-dominant terrain is stable
      backgroundVolume: 0.08, // recedes when Spino or Vatten terrain dominates
    },
    {
      key: 'music-l4-spino',
      urls: [`${MB}/Week 2 - Ruined Lands WASTELAND.ogg`],
      world: 'spino',
      dominantVolume: 0.28,
      backgroundVolume: 0.08,
    },
    {
      key: 'music-l4-vatten',
      urls: [`${MB}/Week 9 - Graceful Descent FLOATING.ogg`],
      world: 'vatten',
      dominantVolume: 0.26,   // slightly softer — Vatten is always slightly distant
      backgroundVolume: 0.07,
    },
  ],
  ambienceUrl: null,  // no stable ambience — the Seam has no consistent soundscape
  corruptionSfxMultiplier: 3.5,
  portalShiftRadius: 1000,  // The Source approach has a long musical shadow
};

/**
 * Level 5 — The Source: Epic → Primal → Quiet
 *
 * Music progressively strips back as the player moves toward the Source.
 * By the final confrontation, almost nothing is playing. The silence is the climax.
 *
 * Implementation: three looping tracks at different volume floors, crossfading
 * based on player distance to MEETING_POINT:
 *   - Far (> 2000px):   approach track at full volume
 *   - Mid (1000–2000):  wound track fades in, approach fades out
 *   - Near (< 1000):    both fade to near-zero, silence track plays at 0.06
 *
 * Post-choice: the silence track fades out entirely, resolve track fades in.
 * This is the only new theme the player hears — something that sounds like all
 * three worlds at peace, or trying to be.
 */
const LEVEL5_MUSIC: LevelMusicConfig = {
  level: 5,
  cycle: 'progressive-silence',
  tracks: [
    // Outer wound — heavy, dark, impending
    { key: 'music-l5-approach', urls: [`${MB}/Week 4 - Cloak of Darkness STAGE 2.ogg`] },
    // Deeper wound — primal, stripped back, ominous
    { key: 'music-l5-wound',    urls: [`${MB}/Week 4 - Cloak of Darkness STAGE 3.ogg`] },
    // Near-Source — minimal drone, almost nothing, the silence underneath
    { key: 'music-l5-silence',  urls: [`${MB}/Week 7 - Life Is Hard BASE.ogg`]          },
    // Post-choice resolution — heard only once, never before
    { key: 'music-l5-resolve',  urls: [`${MB}/Week 9 - Graceful Descent LANDING.ogg`]   },
  ],
  progressionTrackKeys: {
    approach: 'music-l5-approach',
    wound:    'music-l5-wound',
    silence:  'music-l5-silence',
    resolve:  'music-l5-resolve',
  },
  // "No birdsong. No wind." — Level 5 has no ambient loop.
  // The absence of ambience is itself part of the soundscape.
  ambienceUrl: null,
  corruptionSfxMultiplier: 5.0,
  // No portal gradient — the whole level is the Source.
  portalShiftRadius: 0,
};

// ─── Registry ─────────────────────────────────────────────────────────────────

/** All five level music configs in arc order (index 0 = Level 1). */
const LEVEL_MUSIC_CONFIGS: ReadonlyArray<LevelMusicConfig> = [
  LEVEL1_MUSIC,
  LEVEL2_MUSIC,
  LEVEL3_MUSIC,
  LEVEL4_MUSIC,
  LEVEL5_MUSIC,
];

/**
 * Returns the music config for a given 1-based level number.
 * Throws a `RangeError` if the level is out of range.
 */
export function getLevelMusicConfig(level: number): LevelMusicConfig {
  const cfg = LEVEL_MUSIC_CONFIGS[level - 1];
  if (cfg === undefined) {
    throw new RangeError(
      `getLevelMusicConfig: level ${level} is out of range (1–${LEVEL_MUSIC_CONFIGS.length})`
    );
  }
  return cfg;
}

/**
 * Load all audio tracks for a level into Phaser's asset cache.
 *
 * Call this from a scene's `preload()` method:
 * ```ts
 * const musicCfg = getLevelMusicConfig(levelNumber);
 * loadLevelMusicAssets(this, musicCfg);
 * ```
 *
 * The ambience URL (if present) is loaded under the key `'level-ambience'` so
 * scenes can reference it consistently regardless of level.
 */
export function loadLevelMusicAssets(scene: Phaser.Scene, cfg: LevelMusicConfig): void {
  for (const track of cfg.tracks) {
    scene.load.audio(track.key, track.urls);
  }
  if (cfg.ambienceUrl !== null) {
    scene.load.audio('level-ambience', cfg.ambienceUrl);
  }
}
