/**
 * Arena bot — runs 5 realistic sessions in CombatArenaScene and logs results.
 *
 * Usage:
 *   npm run arena-bot        (requires the Vite dev server to be running: npm run dev)
 *
 * Output:
 *   logs/arena-bot/YYYY-MM-DD.json  — session log (one file per calendar day)
 *
 * What this script does:
 *   1. Launches a headless Chromium browser via Playwright.
 *   2. For each of 5 sessions, navigates to the dev server, boots the game,
 *      starts CombatArenaScene, and drives the Tinkerer with semi-random
 *      WASD + F (ranged) + Space (melee) inputs.
 *   3. Each session ends after 3 minutes or when the hero's HP drops to 0.
 *   4. Metrics are sampled every ~500 ms and written to the JSON log.
 *
 * Why play "realistically" rather than optimally?
 *   A perfectly optimal bot (always kite, always shoot) would not reflect how
 *   a real player moves through the arena. Introducing standstills, diagonal
 *   movement, and mixed combat style produces session data that better
 *   represents actual player behaviour for balance-testing purposes.
 */

import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { BotController, type BotMetrics } from './bot-controller.js';

// ── Configuration ─────────────────────────────────────────────────────────────

const DEV_SERVER_URL  = 'http://localhost:3000';
const SESSIONS        = 5;
const SESSION_MS      = 3 * 60 * 1_000;  // 3 minutes in milliseconds
const GAME_BOOT_MS    = 15_000;          // timeout waiting for __game to appear
const ARENA_READY_MS  = 10_000;          // timeout waiting for arena scene to activate
const METRICS_POLL_MS = 500;             // how often to sample arena state

// ── Types ─────────────────────────────────────────────────────────────────────

type EndReason = 'timeout' | 'died';

interface SessionSnapshot extends BotMetrics {
  elapsedMs: number;
}

interface SessionResult {
  sessionIndex: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  endReason: EndReason;
  finalMetrics: BotMetrics;
  snapshots: SessionSnapshot[];
}

interface BotLog {
  generatedAt: string;
  devServer: string;
  sessions: SessionResult[];
}

// ── Minimal game-access types used inside page.evaluate() ─────────────────────
// Defined here so they can be referenced in evaluate callbacks below.
// (TypeScript types are stripped at runtime — these only exist at compile time.)

type GameAccess = {
  scene: {
    getScene: (key: string) => unknown;
    stop: (key: string) => void;
    start: (key: string, data?: Record<string, unknown>) => void;
  };
};

type ArenaSceneAccess = {
  sys: { settings: { active: boolean } };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Navigate to the dev server and wait until window.__game is available.
 *
 * The game is a Vite SPA; `__game` is set synchronously after `new Phaser.Game()`
 * in src/main.ts, so waiting for it is the reliable signal that Phaser has
 * initialised and the first scene's preload() has started.
 */
async function bootGame(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(DEV_SERVER_URL);
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__game'],
    { timeout: GAME_BOOT_MS },
  );
}

/**
 * Stop any running scenes and start CombatArenaScene from scratch.
 *
 * Passing `{}` explicitly prevents Phaser from reusing stale init data
 * (e.g. `{ background: true }` from a previous background launch).
 * We stop the other scenes first so the arena gets the full render budget.
 */
async function startArena(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as unknown as Record<string, GameAccess>)['__game'];
    game.scene.stop('MainMenuScene');
    game.scene.stop('WilderviewScene');
    game.scene.stop('CombatArenaScene');
    game.scene.start('CombatArenaScene', {});
  });

  // Wait until the arena scene reports itself as active (create() has run).
  await page.waitForFunction(
    () => {
      const g = (window as unknown as Record<string, GameAccess>)['__game'];
      const scene = g?.scene?.getScene('CombatArenaScene') as ArenaSceneAccess | null;
      return scene?.sys?.settings?.active === true;
    },
    { timeout: ARENA_READY_MS },
  );

  // Short settle — give Phaser a moment to finish create() before we patch the scene.
  await page.waitForTimeout(500);
}

/**
 * Run one 3-minute bot session.
 *
 * Bot action weights (approximate):
 *   15% — standstill (think time: 200–500 ms)
 *   30% — ranged shot (F key)
 *    5% — melee strike (Space)
 *   50% — random WASD movement (300–1000 ms)
 *
 * The bot checks metrics after every action. If `heroAlive` is false the
 * session ends immediately (before the arena auto-respawns the hero).
 */
async function runSession(
  page: import('@playwright/test').Page,
  sessionIndex: number,
): Promise<SessionResult> {
  const bot       = new BotController(page);
  const startMs   = Date.now();
  const startedAt = new Date().toISOString();
  const snapshots: SessionSnapshot[] = [];

  await bot.enablePlayerMode();

  let endReason: EndReason = 'timeout';
  let finalMetrics: BotMetrics = {
    wave: 0, kills: 0, heroAlive: true,
    enemiesAlive: 0, heroHp: 0, heroMaxHp: 0,
  };

  // ── Action loop ─────────────────────────────────────────────────────────────
  while (true) {
    const elapsedMs = Date.now() - startMs;

    // 3-minute wall-clock limit.
    if (elapsedMs >= SESSION_MS) {
      endReason = 'timeout';
      break;
    }

    // Sample current arena state.
    const metrics = await bot.getMetrics();
    finalMetrics  = metrics;
    snapshots.push({ elapsedMs, ...metrics });

    // Hero just died — end the session before the respawn timer fires.
    if (!metrics.heroAlive) {
      endReason = 'died';
      break;
    }

    // ── Pick an action ──────────────────────────────────────────────────────
    const r = Math.random();

    if (r < 0.15) {
      // Standstill — the bot pauses as if reading the battlefield.
      await bot.wait(200 + Math.random() * 300);
    } else if (r < 0.45) {
      // Ranged attack — shoot the nearest enemy (game handles targeting).
      await bot.shoot();
      // Short pause between shots to avoid hammering the key.
      await bot.wait(METRICS_POLL_MS);
    } else if (r < 0.50) {
      // Melee — effective only at close range; occasional close-quarters risk.
      await bot.melee();
      await bot.wait(METRICS_POLL_MS);
    } else {
      // Movement — the most frequent action, matching real player behaviour.
      await bot.moveRandom();
    }
  }

  const endedAt   = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  console.log(
    `  Session ${sessionIndex + 1}: ${endReason} ` +
    `| ${Math.round(durationMs / 1000)}s ` +
    `| wave ${finalMetrics.wave} ` +
    `| kills ${finalMetrics.kills} ` +
    `| hp ${finalMetrics.heroHp}/${finalMetrics.heroMaxHp}`,
  );

  return {
    sessionIndex,
    startedAt,
    endedAt,
    durationMs,
    endReason,
    finalMetrics,
    snapshots,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const logDir  = path.resolve('logs/arena-bot');
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const logPath = path.join(logDir, `${dateStr}.json`);

  fs.mkdirSync(logDir, { recursive: true });

  console.log('\n── Arena bot starting ───────────────────────────────────────');
  console.log(`  Dev server : ${DEV_SERVER_URL}`);
  console.log(`  Sessions   : ${SESSIONS}`);
  console.log(`  Log file   : ${logPath}\n`);

  const browser = await chromium.launch({ headless: true });

  const log: BotLog = {
    generatedAt: new Date().toISOString(),
    devServer:   DEV_SERVER_URL,
    sessions:    [],
  };

  try {
    for (let i = 0; i < SESSIONS; i++) {
      console.log(`  → Session ${i + 1} / ${SESSIONS}`);

      // Each session gets a fresh page so browser state doesn't carry over.
      const page = await browser.newPage();

      try {
        await bootGame(page);
        await startArena(page);

        const result = await runSession(page, i);
        log.sessions.push(result);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log('\n── Arena bot complete ───────────────────────────────────────');
  console.log(`  Sessions run : ${log.sessions.length}`);

  const died    = log.sessions.filter(s => s.endReason === 'died').length;
  const timeout = log.sessions.filter(s => s.endReason === 'timeout').length;
  console.log(`  Timed out    : ${timeout}`);
  console.log(`  Died early   : ${died}`);
  console.log(`  Log written  : ${logPath}`);
}

main().catch((err: unknown) => {
  console.error('arena-bot failed:', err);
  process.exit(1);
});
