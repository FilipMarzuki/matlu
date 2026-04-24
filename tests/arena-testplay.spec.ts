/**
 * Arena testplay — automated balance simulation for agents.
 *
 * Boots CombatArenaScene and fast-forwards the game loop using sys.step() —
 * the same technique used in game.spec.ts for deterministic headless testing.
 * No rendering pipeline is touched, so this works in headless Chrome (CI).
 *
 * Run with: npm run arena:testplay
 *
 * Output:
 *   screenshots/arena-testplay-report.json  — balance metrics over 90 sim-s
 *   screenshots/arena-testplay-{15,30,…}s.png — periodic snapshots
 *
 * Reading the report:
 *   snapshots[].simTime      — sim-seconds elapsed when this snapshot was taken
 *   snapshots[].wave         — wave group index (how many wave groups have spawned)
 *   snapshots[].kills        — cumulative enemies killed
 *   snapshots[].heroDeaths   — cumulative hero deaths
 *   snapshots[].enemiesAlive — enemies on the field at this moment
 *
 * Balance signals:
 *   - heroDeaths rising fast early  → enemies too strong
 *   - kills plateau while enemiesAlive grows → hero AI struggling
 *   - wave index outpaces kills by 2× → accumulation pressure is too high
 */

import { test } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// ── Timing constants ──────────────────────────────────────────────────────────

const BOOT_MS        = 12_000;
const ARENA_READY_MS = 8_000;
const OUT_DIR        = path.resolve('screenshots');

// Simulation parameters — adjust to taste.
// 300 sim-seconds at 60fps = 18 000 ticks total.
const SIM_SECONDS      = 300;
const BATCH_SECONDS    = 5;            // sim-seconds per evaluate() call
const DELTA            = 16.67;        // ms per tick (~60fps)
const TICKS_PER_BATCH  = Math.round(BATCH_SECONDS * 1_000 / DELTA);
const TOTAL_BATCHES    = SIM_SECONDS / BATCH_SECONDS;

// ── Type helpers ──────────────────────────────────────────────────────────────

// Minimal type that overlays the private fields we read from CombatArenaScene.
// TypeScript's `private` is compile-time only; in JS all fields are accessible.
type ArenaAccess = Phaser.Scene & {
  /** sys.step() advances the scene one frame without touching the renderer. */
  sys: { step: (time: number, delta: number) => void };
  // Private scene counters:
  waveNumber:   number;
  killCount:    number;
  heroAlive:    boolean;
  aliveEnemies: unknown[];
  respawnHero:  () => void;
  // Injected by this spec for tracking:
  __simT:       number;
  __heroDeaths: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function bootGame(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__game'],
    { timeout: BOOT_MS },
  );
}

async function startArena(page: import('@playwright/test').Page) {
  // Stop all other scenes so the arena gets full GPU budget.
  await page.evaluate(() => {
    const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
    game?.scene?.stop('CombatArenaScene');
    game?.scene?.stop('WilderviewScene');
    game?.scene?.stop('MainMenuScene');
    // Pass {} explicitly so Phaser doesn't reuse stale { background: true } init data.
    game?.scene?.start('CombatArenaScene', {});
  });

  // Wait until the arena scene is active (hero spawned, wave timer running).
  await page.waitForFunction(
    () => {
      const g = (window as unknown as Record<string, Phaser.Game>)['__game'];
      return !!g?.scene?.getScene('CombatArenaScene')?.sys?.settings?.active;
    },
    { timeout: ARENA_READY_MS },
  );

  // Short settle — lets Phaser finish create() before we patch the scene.
  await page.waitForTimeout(500);
}

async function injectSimState(page: import('@playwright/test').Page) {
  // Attach a monotonic sim-clock and a death counter to the scene instance.
  // Patch respawnHero so we can count hero deaths without modifying game code.
  await page.evaluate(() => {
    const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
    const scene = game.scene.getScene('CombatArenaScene') as unknown as ArenaAccess;

    scene.__simT = performance.now();
    scene.__heroDeaths = 0;

    const orig = scene.respawnHero.bind(scene);
    scene.respawnHero = function (this: ArenaAccess) {
      this.__heroDeaths++;
      orig();
    };
  });
}

// ── Testplay spec ─────────────────────────────────────────────────────────────

test('arena testplay — 300 sim-seconds balance report', async ({ page }) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await bootGame(page);
  await startArena(page);
  await injectSimState(page);

  // ── Simulation loop ───────────────────────────────────────────────────────

  const snapshots: Array<{
    simTime:      number;
    wave:         number;
    kills:        number;
    heroDeaths:   number;
    heroAlive:    boolean;
    enemiesAlive: number;
  }> = [];

  for (let b = 0; b < TOTAL_BATCHES; b++) {
    // Advance the game loop TICKS_PER_BATCH frames without rendering.
    // sys.step(time, delta) runs PRE_UPDATE → physics → sceneUpdate → POST_UPDATE,
    // advances Phaser's time clock (so delayedCalls fire at the right moment),
    // but skips the WebGL render pipeline — safe in headless Chrome.
    const snap = await page.evaluate(
      ({ ticks, delta }: { ticks: number; delta: number }) => {
        const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
        const scene = game.scene.getScene('CombatArenaScene') as unknown as ArenaAccess;

        let t = scene.__simT;
        for (let i = 0; i < ticks; i++) {
          scene.sys.step(t, delta);
          t += delta;
        }
        scene.__simT = t;

        return {
          wave:         scene.waveNumber,
          kills:        scene.killCount,
          heroDeaths:   scene.__heroDeaths,
          heroAlive:    scene.heroAlive,
          enemiesAlive: scene.aliveEnemies.length,
        };
      },
      { ticks: TICKS_PER_BATCH, delta: DELTA },
    );

    const simTime = (b + 1) * BATCH_SECONDS;
    snapshots.push({ simTime, ...snap });

    // Screenshot every 15 sim-seconds.
    // NOTE: In headless Chrome, WebGL sprite rendering is handled by SwiftShader
    // (software renderer) — screenshots capture shape/colour but lack GPU fidelity.
    // Run npm run arena:testplay:headed for GPU-accurate screenshots.
    if (simTime % 15 === 0) {
      await page.screenshot({
        path: path.join(OUT_DIR, `arena-testplay-${simTime}s.png`),
      });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────

  const last = snapshots[snapshots.length - 1]!;

  const report = {
    generatedAt: new Date().toISOString(),
    simSeconds:  SIM_SECONDS,
    summary: {
      finalWave:   last.wave,
      totalKills:  last.kills,
      heroDeaths:  last.heroDeaths,
    },
    // Healthy 90-second targets (rough; adjust as the game evolves):
    //   finalWave  5–9     (one group every ~10–18 s)
    //   totalKills 15–40   (hero kills 1 enemy per ~2–6 s on average)
    //   heroDeaths 0–2     (hero should be competitive, not a punching bag)
    balanceHints: [
      last.heroDeaths >= 5
        ? 'WARN: hero died frequently — enemies may be too strong'
        : null,
      last.kills < 10
        ? 'WARN: very few kills — hero AI may be struggling (check targeting / weapon range)'
        : null,
      last.wave > 0 && last.kills / last.wave < 2
        ? 'WARN: kill/wave ratio is low — enemies may be accumulating faster than the hero can clear'
        : null,
    ].filter(Boolean),
    snapshots,
  };

  const reportPath = path.join(OUT_DIR, 'arena-testplay-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n── Arena testplay complete ──────────────────────────────────');
  console.log(`  Waves reached : ${last.wave}`);
  console.log(`  Total kills   : ${last.kills}`);
  console.log(`  Hero deaths   : ${last.heroDeaths}`);
  if (report.balanceHints.length > 0) {
    console.log('\n  Balance hints:');
    for (const h of report.balanceHints) console.log(`    ${h}`);
  }
  console.log(`\n  Report → ${reportPath}`);
});
