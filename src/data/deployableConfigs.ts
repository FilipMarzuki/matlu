/**
 * Centralised numeric tuning for all CombatEngineer deployables.
 *
 * Keep all balance numbers here so Child D (HUD) and future passes can read
 * them without importing from individual entity files.
 *
 * Spec reference: #519 [CombatEngineer C]
 */

// ── Sentry Turret ─────────────────────────────────────────────────────────────
export const TURRET = {
  /** Max HP before enemies destroy it. */
  maxHp:          40,
  /** Lifetime in ms. */
  lifetimeMs:     25_000,
  /** Scan radius in px — how far it looks for targets. */
  scanRadius:     180,
  /** How often (ms) the turret re-acquires its target. */
  scanIntervalMs: 400,
  /** Damage per shot. */
  shotDamage:     8,
  /** ms between shots. */
  fireIntervalMs: 600,
  /** Shot travel speed px/s. */
  shotSpeed:      300,
  /** Shot colour. */
  shotColor:      0x00ff88,
  /** Max shots per turret per placement (concurrent active cap). */
  cap:            1,
  /** Hero-side cooldown in ms before the player can place another. */
  cooldownMs:     5_000,
};

// ── Scout Drone ───────────────────────────────────────────────────────────────
export const DRONE = {
  maxHp:           20,
  lifetimeMs:      20_000,
  /** Orbit radius around the owner in px. */
  orbitRadius:     120,
  /** Orbit angular speed in radians/s. */
  orbitSpeedRad:   1.2,
  /** Fire range — how close an enemy must be for the drone to shoot. */
  fireRadius:      100,
  /** ms between drone shots. */
  fireIntervalMs:  1_200,
  shotDamage:      3,
  shotSpeed:       260,
  shotColor:       0x44aaff,
  cap:             1,
  cooldownMs:      4_000,
};

// ── Proximity Mine ────────────────────────────────────────────────────────────
export const MINE = {
  /** Armed HP — mine is one-shot (dies on detonation). */
  maxHp:          1,
  /** Mines stay on the field a long time for strategic placement. */
  lifetimeMs:     90_000,
  /** ms after placement before the mine arms. */
  armDelayMs:     800,
  /** Radius within which an enemy triggers detonation. */
  triggerRadius:  32,
  /** Full damage at the epicentre. */
  blastDamage:    30,
  /** Outer blast radius. Damage halves at the edge (linear falloff). */
  blastRadius:    40,
  /** Max mines active at once. */
  cap:            3,
  cooldownMs:     2_000,
};

// ── Barrier Shield ────────────────────────────────────────────────────────────
export const SHIELD = {
  maxHp:       80,
  lifetimeMs:  12_000,
  /** World-unit width of the barrier rectangle (long side). */
  width:       48,
  /** World-unit height of the barrier rectangle (thin side). */
  height:      16,
  cap:         1,
  cooldownMs:  6_000,
};
