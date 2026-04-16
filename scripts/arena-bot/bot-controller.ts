/**
 * BotController — drives the Tinkerer hero in CombatArenaScene via
 * Playwright's keyboard/mouse API and page.evaluate() for state reads.
 *
 * How player input works in the arena:
 *   CombatArenaScene has a `heroPlayerMode` boolean (private, default false).
 *   When true, `updatePlayerHeroInput()` reads Phaser's keyboard state each
 *   frame to drive the hero, instead of the AI behaviour tree.
 *
 *   Calling page.keyboard.down('w') fires a real browser KeyboardEvent, which
 *   Phaser's input system picks up and sets `moveKeys['up'].isDown = true`.
 *   That means keyboard presses from Playwright work exactly like a human
 *   pressing the key in the browser.
 *
 * Usage:
 *   const bot = new BotController(page);
 *   await bot.enablePlayerMode();  // call once after scene is ready
 *   // then drive with moveRandom(), shoot(), wait(), getMetrics()
 */
import type { Page } from '@playwright/test';

// ── Internal type aliases ─────────────────────────────────────────────────────

// Minimal shape of the Phaser game object for the properties we access.
// Using a bespoke type instead of importing Phaser avoids adding it to the
// Node.js script's dependency graph (it's a browser-only library at runtime).
type GameAccess = {
  scene: {
    getScene: (key: string) => unknown;
    stop: (key: string) => void;
    start: (key: string, data?: Record<string, unknown>) => void;
  };
};

// Subset of CombatArenaScene fields needed for bot reads and hero-mode toggle.
// TypeScript's `private` keyword is compile-time only — all fields are
// accessible in JavaScript at runtime, which is why this works.
type ArenaAccess = {
  waveNumber: number;
  killCount: number;
  heroAlive: boolean;
  aliveEnemies: unknown[];
  heroPlayerMode: boolean;
  hero: { hp: number; maxHp: number };
};

// ── Public types ──────────────────────────────────────────────────────────────

/** Snapshot of arena state returned by getMetrics(). */
export interface BotMetrics {
  wave: number;
  kills: number;
  heroAlive: boolean;
  enemiesAlive: number;
  heroHp: number;
  heroMaxHp: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// All movement keys the bot can press.
const MOVE_KEYS = ['w', 'a', 's', 'd'] as const;
type MoveKey = (typeof MOVE_KEYS)[number];

// ── BotController ─────────────────────────────────────────────────────────────

/**
 * BotController wraps a Playwright Page and exposes high-level bot actions.
 *
 * Key design decisions:
 * - `releaseAll()` is called before every action so keys never get "stuck"
 *   if an action is interrupted.
 * - Actions intentionally introduce jitter (random durations, random
 *   direction selection) to mimic a human player rather than an optimal bot.
 */
export class BotController {
  /** Tracks which movement keys are currently held so we can release them. */
  private readonly heldKeys = new Set<MoveKey>();

  constructor(private readonly page: Page) {}

  /**
   * Enable player-keyboard mode on the arena scene.
   *
   * By default the Tinkerer is controlled by its AI behaviour tree.
   * Setting `heroPlayerMode = true` switches it to keyboard-driven input,
   * so our Playwright keyboard events actually move the hero.
   * Call this once after the scene has fully initialised.
   */
  async enablePlayerMode(): Promise<void> {
    await this.page.evaluate(() => {
      const game = (window as unknown as Record<string, GameAccess>)['__game'];
      const scene = game.scene.getScene('CombatArenaScene') as ArenaAccess;
      scene.heroPlayerMode = true;
    });
  }

  /**
   * Press a random combination of WASD keys for 300–1000 ms, then release.
   *
   * 30% of the time two keys are pressed (diagonal movement), otherwise one.
   * This produces the unsteady, imprecise movement of a real human player
   * rather than the perfectly cardinal movement of an optimal bot.
   */
  async moveRandom(): Promise<void> {
    await this.releaseAll();

    // Shuffle the key list and take the first 1 or 2 entries.
    const shuffled = [...MOVE_KEYS].sort(() => Math.random() - 0.5);
    const count = Math.random() < 0.3 ? 2 : 1;
    const chosen = shuffled.slice(0, count) as MoveKey[];

    for (const key of chosen) {
      await this.page.keyboard.down(key);
      this.heldKeys.add(key);
    }

    // Hold for a random duration — longer holds feel less robotic.
    const holdMs = 300 + Math.random() * 700;
    await this.page.waitForTimeout(holdMs);

    await this.releaseAll();
  }

  /**
   * Fire the Tinkerer's ranged weapon (F key, just-pressed).
   *
   * Targets the nearest enemy automatically (the game handles targeting).
   * Uses `keyboard.press()` which sends keydown then keyup in quick succession
   * — Phaser's `JustDown` check fires on the keydown half.
   */
  async shoot(): Promise<void> {
    await this.page.keyboard.press('f');
  }

  /**
   * Trigger a melee attack (Space key, just-pressed).
   *
   * Melee is only effective at close range; the bot uses it occasionally
   * to mix up combat style rather than purely sniping from range.
   */
  async melee(): Promise<void> {
    await this.page.keyboard.press('Space');
  }

  /**
   * Release all held keys and pause for `ms` milliseconds.
   *
   * Simulates a player pausing to read the battlefield before deciding
   * on their next move — adds organic "think time" to the bot's rhythm.
   */
  async wait(ms: number): Promise<void> {
    await this.releaseAll();
    await this.page.waitForTimeout(ms);
  }

  /**
   * Read the current arena state from the live scene via page.evaluate().
   *
   * `page.evaluate()` serialises the callback as a string, sends it to the
   * browser for execution, then returns the JSON-serialised result. Only
   * plain JSON-compatible values (numbers, booleans, strings, arrays, plain
   * objects) can be returned — Phaser game objects cannot cross this boundary.
   */
  async getMetrics(): Promise<BotMetrics> {
    return this.page.evaluate(() => {
      const game = (window as unknown as Record<string, GameAccess>)['__game'];
      const scene = game.scene.getScene('CombatArenaScene') as ArenaAccess;
      return {
        wave:         scene.waveNumber,
        kills:        scene.killCount,
        heroAlive:    scene.heroAlive,
        enemiesAlive: scene.aliveEnemies.length,
        heroHp:       scene.hero.hp,
        heroMaxHp:    scene.hero.maxHp,
      };
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Release every movement key that is currently held by this controller. */
  private async releaseAll(): Promise<void> {
    for (const key of this.heldKeys) {
      await this.page.keyboard.up(key);
    }
    this.heldKeys.clear();
  }
}
