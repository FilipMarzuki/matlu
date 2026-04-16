import { test, expect } from '@playwright/test';

const GAME_BOOT_MS = 8_000;   // time to wait for Phaser to boot and first scene to render
const SCENE_READY_MS = 45_000; // extra time for GameScene.create() to finish (heavy work)

// ─── Smoke test ───────────────────────────────────────────────────────────────

test('game canvas renders without crashing', async ({ page }) => {
  await page.goto('/');

  // Phaser creates a <canvas> element inside #game-container
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible({ timeout: GAME_BOOT_MS });

  // No uncaught errors should have occurred
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.waitForTimeout(1_000);
  expect(errors).toHaveLength(0);
});

// ─── Bot test: keyboard input moves the player ───────────────────────────────

test('pressing W key moves the player upward', async ({ page }) => {
  await page.goto('/');

  // Wait for canvas to appear (MainMenuScene is running)
  await expect(page.locator('#game-container canvas')).toBeVisible({ timeout: GAME_BOOT_MS });

  // Wait until the Phaser game object is available on window
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown | null>)['__game'],
    { timeout: GAME_BOOT_MS },
  );

  // Stop all background scenes before starting GameScene.
  //
  // WHY: Two reasons:
  //   1. Running multiple heavy scenes simultaneously in CI (SwiftShader software WebGL)
  //      can push GameScene.create() (terrain, chunks, animals) past the ready timeout.
  //   2. MainMenuScene registers a `keydown-ENTER` handler that calls scene.start('GameScene').
  //      If we dispatch Enter to exit attract mode while MainMenuScene is still active,
  //      it queues a GameScene restart on the next tick — resetting attractMode to true
  //      and undoing the attract-mode exit before the W key test can run.
  await page.evaluate(() => {
    const game = (window as unknown as Record<string, { scene?: { stop?: (k: string) => void; start?: (k: string) => void } }>)['__game'];
    game?.scene?.stop?.('CombatArenaScene');
    game?.scene?.stop?.('WilderviewScene');
    game?.scene?.stop?.('MainMenuScene');
    game?.scene?.start?.('GameScene');
  });

  // GameScene.create() does heavy work (terrain, chunks, animals).
  // Poll until the player object exists before interacting with keyboard.
  await page.waitForFunction(
    () => !!((window as unknown as Record<string, { scene?: { getScene?: (k: string) => { player?: unknown } | null } }>)['__game']?.scene?.getScene?.('GameScene')?.player),
    { timeout: SCENE_READY_MS },
  );

  // ── Attract-mode exit ──────────────────────────────────────────────────────
  //
  // Dispatch 'a' (adds a character to attractName) then 'Enter' (calls
  // exitAttractMode → attractMode = false). Phaser processes these via
  // MANAGER_PROCESS which fires synchronously on each window.dispatchEvent call.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup',   { key: 'a', code: 'KeyA', keyCode: 65, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  });

  // Poll until attract mode has exited
  await page.waitForFunction(
    () => {
      const g = (window as unknown as Record<string, unknown>)['__game'] as
        { scene?: { getScene?: (k: string) => Record<string, unknown> | null } } | undefined;
      return g?.scene?.getScene?.('GameScene')?.['attractMode'] === false;
    },
    { timeout: 10_000 },
  );

  // ── Player movement ────────────────────────────────────────────────────────
  //
  // WHY scene.sys.step() instead of waitForTimeout:
  //   In CI headless Chrome, requestAnimationFrame is throttled to near-zero FPS
  //   (background tabs in Chrome 88+ receive very infrequent rAF callbacks).
  //   Waiting 300 ms or even 60 s is not enough because the game loop never
  //   advances. game.loop.tick() would also re-run the rendering pipeline which
  //   can fail in headless WebGL. scene.sys.step() runs only the scene update
  //   (physics + scene logic) without rendering — safe and deterministic.
  //
  // WHY TWO TICKS:
  //   Tick N   — Phaser Input (MANAGER_PROCESS) processed W keydown → wasd.up.isDown = true
  //              ArcadePhysics.World.update fires (via UPDATE event, BEFORE sceneUpdate)
  //                → moves body by current velocity (still 0)
  //              GameScene.update (sceneUpdate) runs AFTER World.update
  //                → updatePlayerMovement() sets body velocity to -speed
  //              World.postUpdate syncs body position back to player.y (no change yet)
  //   Tick N+1 — World.update fires → now applies -speed → body.y decreases
  //              World.postUpdate → player.y decreases
  const { initialY, afterY } = await page.evaluate(() => {
    const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
    const scene = game?.scene?.getScene('GameScene') as
      | (Phaser.Scene & { player?: { y?: number }; sys: { step: (t: number, d: number) => void } })
      | null;

    const initialY: number | null = scene?.player?.y ?? null;
    const now = performance.now();
    const delta = 16.67; // one frame at ~60 fps

    // Dispatch W, then force two scene-update ticks synchronously so physics
    // runs regardless of rAF frequency in CI. sys.step() runs PRE_UPDATE →
    // UPDATE (physics World.update) → sceneUpdate → POST_UPDATE (World.postUpdate)
    // but skips the rendering pipeline, avoiding WebGL issues in headless Chrome.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', keyCode: 87, bubbles: true }));
    scene?.sys.step(now, delta);           // Tick N:   sets velocity
    scene?.sys.step(now + delta, delta);   // Tick N+1: physics moves player
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', keyCode: 87, bubbles: true }));

    const afterY: number | null = scene?.player?.y ?? null;
    return { initialY, afterY };
  });

  expect(initialY).not.toBeNull();
  expect(afterY).not.toBeNull();
  // Player should have moved upward (Y decreases in Phaser's coordinate system)
  expect(afterY as number).toBeLessThan(initialY as number);
});

// ─── Combat arena: hero walk animation loops ──────────────────────────────────
//
// WHY this test exists:
//   Phaser's createFromAseprite() defaults repeat=0 (play once and stop).
//   Without explicitly setting repeat=-1 on walk/idle animations, the sprite
//   freezes on the last frame after one cycle because updateSpriteAnimation()
//   only calls play() when the key CHANGES — so a finished same-key animation
//   is never restarted.
//
// WHAT it checks:
//   After player-controlling the hero southward for 50 frames (~833ms, which
//   exceeds the 720ms walk_south cycle), the animation should still be playing.
//   If repeat was 0 the animation would have stopped and isPlaying would be false.

const ARENA_BOOT_MS = 12_000;

test('hero walk animation loops after completing one cycle', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__game'],
    { timeout: GAME_BOOT_MS },
  );

  // Start the combat arena scene in isolation.
  await page.evaluate(() => {
    const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
    game?.scene?.stop('CombatArenaScene');
    game?.scene?.stop('WilderviewScene');
    game?.scene?.stop('MainMenuScene');
    game?.scene?.start('CombatArenaScene', {});
  });

  await page.waitForFunction(
    () => {
      const g = (window as unknown as Record<string, Phaser.Game>)['__game'];
      return !!g?.scene?.getScene('CombatArenaScene')?.sys?.settings?.active;
    },
    { timeout: ARENA_BOOT_MS },
  );

  // Short settle so create() finishes before we drive input.
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    type ArenaParts = Phaser.Scene & {
      hero: Record<string, unknown>;
      toggleHeroPlayerMode(): void;
      // Private in TS, accessible at runtime:
      moveKeys: Record<string, { isDown: boolean }>;
      sys: { step: (t: number, d: number) => void };
    };

    const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
    const scene = game.scene.getScene('CombatArenaScene') as ArenaParts;

    // Enable player control so we drive movement deterministically.
    scene.toggleHeroPlayerMode();
    // Walk south — 'down' key maps to the S key binding in the scene.
    scene.moveKeys['down'].isDown = true;

    const delta = 16.67; // ~60 fps
    const now   = performance.now();

    // 50 ticks ≈ 833 ms — comfortably past one 720 ms walk_south cycle.
    for (let i = 0; i < 50; i++) {
      scene.sys.step(now + i * delta, delta);
    }

    type AnimState = { currentAnim?: { key: string } | null; isPlaying: boolean };
    type HeroSprite = { spriteObj?: { anims?: AnimState } };

    const hero = scene.hero as HeroSprite;
    return {
      animKey:   hero.spriteObj?.anims?.currentAnim?.key ?? null,
      isPlaying: hero.spriteObj?.anims?.isPlaying         ?? false,
    };
  });

  // Hero should be playing a directional tinkerer walk animation.
  expect(result.animKey).toMatch(/^tinkerer_walk_/);
  // Animation must still be playing (looping) after the first cycle completes.
  expect(result.isPlaying).toBe(true);
});
