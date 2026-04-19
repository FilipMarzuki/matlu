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
import {
  compareToBaseline,
  detectRegressions,
  loadRollingAverage,
  type ArenaRegression,
  type BaselineComparison,
  type SessionMetrics,
} from './metrics.js';

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

interface SessionMetricsSummary extends SessionMetrics {
  jsErrorTypes: string[];
}

interface SessionResult {
  sessionIndex: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  endReason: EndReason;
  finalMetrics: BotMetrics;
  snapshots: SessionSnapshot[];
  metrics: SessionMetricsSummary;
  baseline: BaselineComparison | null;
  regressions: ArenaRegression[];
}

interface BotLog {
  generatedAt: string;
  devServer: string;
  sessions: SessionResult[];
  baselineWindow: {
    startDate: string;
    endDate: string;
    sampleDays: number;
    sampleSessions: number;
  };
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

interface ArenaBotTelemetry {
  shotsFired: number;
  shotsHit: number;
  projectilePeak: number;
}

function normalizeErrorType(message: string): string {
  const firstLine = message.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return 'UnknownError';

  const explicitError = firstLine.match(/^([A-Za-z]+Error)\b/);
  if (explicitError) return explicitError[1];

  const colonIndex = firstLine.indexOf(':');
  if (colonIndex > 0) return firstLine.slice(0, colonIndex).trim();

  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

function setupJsErrorCollection(page: import('@playwright/test').Page): () => string[] {
  const errorTypes = new Set<string>();

  page.on('pageerror', (error) => {
    errorTypes.add(normalizeErrorType(`${error.name}: ${error.message}`));
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    errorTypes.add(normalizeErrorType(msg.text()));
  });

  return (): string[] => [...errorTypes].sort();
}

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
 * Install lightweight runtime telemetry hooks inside the arena scene.
 *
 * We count:
 * - shotsFired via the existing `hero-shot` event
 * - shotsHit by wrapping the hero projectile's `onHitCb`
 * - projectilePeak from the largest observed in-flight projectile count
 */
async function installArenaTelemetry(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as unknown as Record<string, GameAccess>)['__game'];
    const scene = game.scene.getScene('CombatArenaScene') as ArenaSceneAccess & Record<string, unknown>;

    const telemetry: ArenaBotTelemetry = {
      shotsFired: 0,
      shotsHit: 0,
      projectilePeak: 0,
    };
    scene['__arenaBotTelemetry'] = telemetry;

    (scene as {
      events?: {
        on: (event: string, cb: (...args: unknown[]) => void) => void;
      };
      hero?: { x: number; y: number };
      projectiles?: unknown[];
    }).events?.on('hero-shot', () => {
      telemetry.shotsFired += 1;
    });

    (scene as {
      events?: {
        on: (event: string, cb: (...args: unknown[]) => void) => void;
      };
      hero?: { x: number; y: number };
      projectiles?: unknown[];
    }).events?.on('projectile-spawned', (projectile: unknown) => {
      const activeProjectiles = Array.isArray((scene as { projectiles?: unknown[] }).projectiles)
        ? (scene as { projectiles?: unknown[] }).projectiles!.length
        : 0;
      telemetry.projectilePeak = Math.max(telemetry.projectilePeak, activeProjectiles);

      const hero = (scene as { hero?: { x: number; y: number } }).hero;
      if (
        !hero ||
        typeof (projectile as { x?: unknown }).x !== 'number' ||
        typeof (projectile as { y?: unknown }).y !== 'number'
      ) {
        return;
      }

      const dx = (projectile as { x: number }).x - hero.x;
      const dy = (projectile as { y: number }).y - hero.y;
      const isLikelyHeroProjectile = Math.hypot(dx, dy) <= 28;
      if (!isLikelyHeroProjectile) return;

      const rawProjectile = projectile as {
        onHitCb?: ((target: unknown) => void) | undefined;
        __arenaBotWrappedHitCb?: boolean;
      };
      if (rawProjectile.__arenaBotWrappedHitCb) return;

      const originalOnHit = rawProjectile.onHitCb;
      rawProjectile.onHitCb = (target: unknown) => {
        telemetry.shotsHit += 1;
        if (typeof originalOnHit === 'function') originalOnHit(target);
      };
      rawProjectile.__arenaBotWrappedHitCb = true;
    });
  });
}

async function readArenaTelemetry(page: import('@playwright/test').Page): Promise<ArenaBotTelemetry> {
  return page.evaluate(() => {
    const game = (window as unknown as Record<string, GameAccess>)['__game'];
    const scene = game.scene.getScene('CombatArenaScene') as Record<string, unknown>;
    const telemetry = scene['__arenaBotTelemetry'] as ArenaBotTelemetry | undefined;
    return telemetry ?? { shotsFired: 0, shotsHit: 0, projectilePeak: 0 };
  });
}

function countStuckStates(snapshots: SessionSnapshot[]): number {
  const STUCK_WINDOW_MS = 5_000;
  const SPEED_EPSILON = 8;
  const DRIFT_EPSILON = 12;

  let stuckStates = 0;
  let segmentStartMs: number | null = null;
  let segmentStartX = 0;
  let segmentStartY = 0;
  let alreadyCounted = false;

  for (const snap of snapshots) {
    const lowSpeed = snap.heroSpeed <= SPEED_EPSILON;
    if (!lowSpeed) {
      segmentStartMs = null;
      alreadyCounted = false;
      continue;
    }

    if (segmentStartMs === null) {
      segmentStartMs = snap.elapsedMs;
      segmentStartX = snap.heroX;
      segmentStartY = snap.heroY;
      alreadyCounted = false;
      continue;
    }

    const drift = Math.hypot(snap.heroX - segmentStartX, snap.heroY - segmentStartY);
    if (drift > DRIFT_EPSILON) {
      segmentStartMs = snap.elapsedMs;
      segmentStartX = snap.heroX;
      segmentStartY = snap.heroY;
      alreadyCounted = false;
      continue;
    }

    if (!alreadyCounted && snap.elapsedMs - segmentStartMs >= STUCK_WINDOW_MS) {
      stuckStates += 1;
      alreadyCounted = true;
    }
  }

  return stuckStates;
}

function summarizeSessionMetrics(
  session: Pick<SessionResult, 'durationMs' | 'endReason' | 'finalMetrics' | 'snapshots'>,
  telemetry: ArenaBotTelemetry,
  jsErrorTypes: string[],
): SessionMetricsSummary {
  const fpsSamples = session.snapshots
    .map((snap) => snap.fps)
    .filter((fps) => Number.isFinite(fps) && fps > 0);
  const fpsAverage = fpsSamples.length > 0
    ? fpsSamples.reduce((sum, fps) => sum + fps, 0) / fpsSamples.length
    : 0;
  const fpsMinimum = fpsSamples.length > 0
    ? Math.min(...fpsSamples)
    : 0;
  const snapshotProjectilePeak = session.snapshots.reduce(
    (peak, snap) => Math.max(peak, snap.projectileCount),
    0,
  );

  return {
    survivalTimeSeconds: Number((session.durationMs / 1000).toFixed(2)),
    enemiesKilled: session.finalMetrics.kills,
    shotsFired: telemetry.shotsFired,
    shotsHit: telemetry.shotsHit,
    deaths: session.endReason === 'died' ? 1 : 0,
    fpsAverage: Number(fpsAverage.toFixed(2)),
    fpsMinimum: Number(fpsMinimum.toFixed(2)),
    projectileCountPeak: Math.max(snapshotProjectilePeak, telemetry.projectilePeak),
    stuckStates: countStuckStates(session.snapshots),
    jsErrorTypes,
  };
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
  baseline: ReturnType<typeof loadRollingAverage>,
  getJsErrorTypes: () => string[],
): Promise<SessionResult> {
  const bot       = new BotController(page);
  const startMs   = Date.now();
  const startedAt = new Date().toISOString();
  const snapshots: SessionSnapshot[] = [];

  await installArenaTelemetry(page);
  await bot.enablePlayerMode();

  let endReason: EndReason = 'timeout';
  let finalMetrics: BotMetrics = {
    wave: 0, kills: 0, heroAlive: true,
    enemiesAlive: 0, heroHp: 0, heroMaxHp: 0,
    heroX: 0, heroY: 0, heroSpeed: 0,
    fps: 0, projectileCount: 0,
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

  const telemetry = await readArenaTelemetry(page);
  const sessionMetrics = summarizeSessionMetrics(
    { durationMs, endReason, finalMetrics, snapshots },
    telemetry,
    getJsErrorTypes(),
  );
  const baselineComparison = compareToBaseline(sessionMetrics, baseline);
  const regressions = detectRegressions(sessionMetrics, baselineComparison);

  return {
    sessionIndex,
    startedAt,
    endedAt,
    durationMs,
    endReason,
    finalMetrics,
    snapshots,
    metrics: sessionMetrics,
    baseline: baselineComparison,
    regressions,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const logDir  = path.resolve('logs/arena-bot');
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const logPath = path.join(logDir, `${dateStr}.json`);
  const referenceDate = new Date(`${dateStr}T00:00:00.000Z`);
  const rollingAverage = loadRollingAverage(referenceDate);
  const fallbackStartDate = new Date(referenceDate);
  fallbackStartDate.setUTCDate(fallbackStartDate.getUTCDate() - 7);
  const fallbackEndDate = new Date(referenceDate);
  fallbackEndDate.setUTCDate(fallbackEndDate.getUTCDate() - 1);

  fs.mkdirSync(logDir, { recursive: true });

  console.log('\n── Arena bot starting ───────────────────────────────────────');
  console.log(`  Dev server : ${DEV_SERVER_URL}`);
  console.log(`  Sessions   : ${SESSIONS}`);
  console.log(`  Log file   : ${logPath}\n`);
  if (rollingAverage) {
    console.log(
      `  Baseline   : ${rollingAverage.startDate} → ${rollingAverage.endDate} ` +
      `(${rollingAverage.sampleSessions} sessions)\n`,
    );
  } else {
    console.log('  Baseline   : none (no logs found in previous 7 days)\n');
  }

  const browser = await chromium.launch({ headless: true });

  const log: BotLog = {
    generatedAt: new Date().toISOString(),
    devServer:   DEV_SERVER_URL,
    sessions:    [],
    baselineWindow: rollingAverage
      ? {
        startDate: rollingAverage.startDate,
        endDate: rollingAverage.endDate,
        sampleDays: rollingAverage.sampleDays,
        sampleSessions: rollingAverage.sampleSessions,
      }
      : {
        startDate: fallbackStartDate.toISOString().slice(0, 10),
        endDate: fallbackEndDate.toISOString().slice(0, 10),
        sampleDays: 0,
        sampleSessions: 0,
      },
  };

  try {
    for (let i = 0; i < SESSIONS; i++) {
      console.log(`  → Session ${i + 1} / ${SESSIONS}`);

      // Each session gets a fresh page so browser state doesn't carry over.
      const page = await browser.newPage();

      try {
        const getJsErrorTypes = setupJsErrorCollection(page);
        await bootGame(page);
        await startArena(page);

        const result = await runSession(page, i, rollingAverage, getJsErrorTypes);
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
  const regressions = log.sessions.flatMap((s) => s.regressions);
  console.log(`  Timed out    : ${timeout}`);
  console.log(`  Died early   : ${died}`);
  console.log(`  Regressions  : ${regressions.length}`);
  console.log(`  Log written  : ${logPath}`);
}

main().catch((err: unknown) => {
  console.error('arena-bot failed:', err);
  process.exit(1);
});
