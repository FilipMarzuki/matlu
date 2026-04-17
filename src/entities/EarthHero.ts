import * as Phaser from 'phaser';
import { CombatEntity, CombatEntityConfig } from './CombatEntity';

/**
 * EarthHero — abstract base class for all five Earth faction hero characters.
 *
 * Sits one level above CombatEntity in the hierarchy:
 *
 *   Entity → LivingEntity → Enemy → CombatEntity → EarthHero → Tinkerer / ...
 *
 * CombatEntity already handles HP, death visuals, behavior trees, physics,
 * and sprite animation. EarthHero adds the typed signature-ability interface
 * so every Earth hero exposes a consistent hook that player-control code and
 * the arena scene can call without knowing the concrete subclass.
 *
 * The constructor signature is identical to CombatEntity so subclasses can
 * forward their own CombatEntityConfig without adding mandatory arguments —
 * the arena scene can swap heroes by changing spawnHero() without touching
 * call sites elsewhere.
 *
 * Usage (concrete subclass example):
 *
 *   export class Tinkerer extends EarthHero {
 *     readonly name = 'Tinkerer';
 *     readonly signatureCooldownMs = 8000;
 *     useSignature(): void { ... }
 *     protected buildTree(): BtNode { ... }
 *   }
 */
export abstract class EarthHero extends CombatEntity {
  /**
   * Human-readable hero name — displayed in HUD labels and written to log
   * output. Declared as a readonly class-field literal in each subclass so
   * the string is part of the concrete type (e.g. `'Tinkerer'`), which lets
   * callers narrow on `hero.name` with a simple string comparison if needed.
   */
  abstract readonly name: string;

  /**
   * Minimum milliseconds that must pass between successive useSignature()
   * activations. The subclass owns the cooldown timer — EarthHero only
   * declares the value so player-control and UI code can read it without
   * coupling to the concrete hero type.
   *
   * Rule of thumb: powerful abilities (AOE, movement-cancel) → 7–10 s;
   * moderate abilities (targeted dash, single-target burst) → 4–6 s.
   */
  abstract readonly signatureCooldownMs: number;

  constructor(scene: Phaser.Scene, x: number, y: number, config: CombatEntityConfig) {
    super(scene, x, y, config);
  }

  /**
   * Activate this hero's signature ability.
   *
   * The concrete subclass should guard against signatureCooldownMs before
   * executing the ability — this method is called directly from player-input
   * handlers and does not perform any cooldown check itself.
   *
   * CombatEntity exposes everything the ability typically needs:
   *   - this.opponents / findNearestLivingOpponent() — target selection
   *   - this.tryDash(dx, dy)                          — movement burst
   *   - this.scene.events.emit(...)                   — VFX / SFX hooks
   *   - this.body as Phaser.Physics.Arcade.Body        — direct physics
   */
  abstract useSignature(): void;
}
