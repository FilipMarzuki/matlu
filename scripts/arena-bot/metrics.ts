import fs from 'node:fs';
import path from 'node:path';

const LOG_DIR = path.resolve('logs/arena-bot');
const BASELINE_DAYS = 7;

export interface SessionMetrics {
  survivalTimeSeconds: number;
  enemiesKilled: number;
  shotsFired: number;
  shotsHit: number;
  deaths: number;
  fpsAverage: number;
  fpsMinimum: number;
  projectileCountPeak: number;
  stuckStates: number;
  jsErrorTypes: string[];
}

interface SessionLike {
  durationMs?: number;
  endReason?: string;
  metrics?: Partial<SessionMetrics> & { jsErrorTypes?: string[] };
  finalMetrics?: { kills?: number };
}

interface BotLogLike {
  sessions?: SessionLike[];
}

export interface RollingAverage {
  startDate: string;
  endDate: string;
  sampleDays: number;
  sampleSessions: number;
  metrics: {
    survivalTimeSeconds: number;
    enemiesKilled: number;
    shotsFired: number;
    shotsHit: number;
    deaths: number;
    fpsAverage: number;
    fpsMinimum: number;
    projectileCountPeak: number;
    stuckStates: number;
    shotAccuracy: number;
  };
  jsErrorTypes: string[];
}

export interface NumericDelta {
  current: number;
  baseline: number;
  absoluteChange: number;
  percentChange: number | null;
}

export interface BaselineComparison {
  survivalTimeSeconds: NumericDelta;
  enemiesKilled: NumericDelta;
  shotsFired: NumericDelta;
  shotsHit: NumericDelta;
  shotAccuracy: NumericDelta;
  deaths: NumericDelta;
  fpsAverage: NumericDelta;
  fpsMinimum: NumericDelta;
  projectileCountPeak: NumericDelta;
  stuckStates: NumericDelta;
  newJsErrorTypes: string[];
}

export interface ArenaRegression {
  code: 'survival_drop' | 'fps_drop' | 'new_js_error' | 'stuck_state';
  detail: string;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDate(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

function safeDivide(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function normalizeSessionMetrics(session: SessionLike): SessionMetrics {
  const metrics = session.metrics;
  if (metrics) {
    return {
      survivalTimeSeconds: Number(metrics.survivalTimeSeconds ?? 0),
      enemiesKilled: Number(metrics.enemiesKilled ?? 0),
      shotsFired: Number(metrics.shotsFired ?? 0),
      shotsHit: Number(metrics.shotsHit ?? 0),
      deaths: Number(metrics.deaths ?? (session.endReason === 'died' ? 1 : 0)),
      fpsAverage: Number(metrics.fpsAverage ?? 0),
      fpsMinimum: Number(metrics.fpsMinimum ?? 0),
      projectileCountPeak: Number(metrics.projectileCountPeak ?? 0),
      stuckStates: Number(metrics.stuckStates ?? 0),
      jsErrorTypes: Array.isArray(metrics.jsErrorTypes)
        ? metrics.jsErrorTypes.filter((type) => typeof type === 'string')
        : [],
    };
  }

  return {
    survivalTimeSeconds: Number((session.durationMs ?? 0) / 1000),
    enemiesKilled: Number(session.finalMetrics?.kills ?? 0),
    shotsFired: 0,
    shotsHit: 0,
    deaths: session.endReason === 'died' ? 1 : 0,
    fpsAverage: 0,
    fpsMinimum: 0,
    projectileCountPeak: 0,
    stuckStates: 0,
    jsErrorTypes: [],
  };
}

function metricDelta(current: number, baseline: number): NumericDelta {
  const absoluteChange = current - baseline;
  const percentChange = baseline !== 0
    ? (absoluteChange / baseline) * 100
    : null;
  return {
    current: round2(current),
    baseline: round2(baseline),
    absoluteChange: round2(absoluteChange),
    percentChange: percentChange === null ? null : round2(percentChange),
  };
}

export function loadRollingAverage(referenceDate: Date): RollingAverage | null {
  const sessions: SessionMetrics[] = [];
  const baselineErrorTypes = new Set<string>();
  let sampleDays = 0;

  for (let offset = BASELINE_DAYS; offset >= 1; offset--) {
    const day = shiftDate(referenceDate, -offset);
    const dayPath = path.join(LOG_DIR, `${toIsoDate(day)}.json`);
    if (!fs.existsSync(dayPath)) continue;

    const raw = fs.readFileSync(dayPath, 'utf8');
    const parsed = JSON.parse(raw) as BotLogLike;
    const daySessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    if (daySessions.length === 0) continue;

    sampleDays += 1;
    for (const session of daySessions) {
      const normalized = normalizeSessionMetrics(session);
      sessions.push(normalized);
      for (const errorType of normalized.jsErrorTypes) {
        baselineErrorTypes.add(errorType);
      }
    }
  }

  if (sessions.length === 0) return null;

  const totals = sessions.reduce((acc, session) => {
    acc.survivalTimeSeconds += session.survivalTimeSeconds;
    acc.enemiesKilled += session.enemiesKilled;
    acc.shotsFired += session.shotsFired;
    acc.shotsHit += session.shotsHit;
    acc.deaths += session.deaths;
    acc.fpsAverage += session.fpsAverage;
    acc.fpsMinimum += session.fpsMinimum;
    acc.projectileCountPeak += session.projectileCountPeak;
    acc.stuckStates += session.stuckStates;
    return acc;
  }, {
    survivalTimeSeconds: 0,
    enemiesKilled: 0,
    shotsFired: 0,
    shotsHit: 0,
    deaths: 0,
    fpsAverage: 0,
    fpsMinimum: 0,
    projectileCountPeak: 0,
    stuckStates: 0,
  });

  const sampleSessions = sessions.length;
  const avgShotsFired = safeDivide(totals.shotsFired, sampleSessions);
  const avgShotsHit = safeDivide(totals.shotsHit, sampleSessions);

  return {
    startDate: toIsoDate(shiftDate(referenceDate, -BASELINE_DAYS)),
    endDate: toIsoDate(shiftDate(referenceDate, -1)),
    sampleDays,
    sampleSessions,
    metrics: {
      survivalTimeSeconds: round2(safeDivide(totals.survivalTimeSeconds, sampleSessions)),
      enemiesKilled: round2(safeDivide(totals.enemiesKilled, sampleSessions)),
      shotsFired: round2(avgShotsFired),
      shotsHit: round2(avgShotsHit),
      shotAccuracy: round2(safeDivide(avgShotsHit, avgShotsFired)),
      deaths: round2(safeDivide(totals.deaths, sampleSessions)),
      fpsAverage: round2(safeDivide(totals.fpsAverage, sampleSessions)),
      fpsMinimum: round2(safeDivide(totals.fpsMinimum, sampleSessions)),
      projectileCountPeak: round2(safeDivide(totals.projectileCountPeak, sampleSessions)),
      stuckStates: round2(safeDivide(totals.stuckStates, sampleSessions)),
    },
    jsErrorTypes: [...baselineErrorTypes].sort(),
  };
}

export function compareToBaseline(
  current: SessionMetrics,
  baseline: RollingAverage | null,
): BaselineComparison | null {
  if (!baseline) return null;

  const currentShotAccuracy = safeDivide(current.shotsHit, current.shotsFired);
  const baselineErrorTypeSet = new Set(baseline.jsErrorTypes);
  const newJsErrorTypes = current.jsErrorTypes
    .filter((errorType) => !baselineErrorTypeSet.has(errorType))
    .sort();

  return {
    survivalTimeSeconds: metricDelta(current.survivalTimeSeconds, baseline.metrics.survivalTimeSeconds),
    enemiesKilled: metricDelta(current.enemiesKilled, baseline.metrics.enemiesKilled),
    shotsFired: metricDelta(current.shotsFired, baseline.metrics.shotsFired),
    shotsHit: metricDelta(current.shotsHit, baseline.metrics.shotsHit),
    shotAccuracy: metricDelta(currentShotAccuracy, baseline.metrics.shotAccuracy),
    deaths: metricDelta(current.deaths, baseline.metrics.deaths),
    fpsAverage: metricDelta(current.fpsAverage, baseline.metrics.fpsAverage),
    fpsMinimum: metricDelta(current.fpsMinimum, baseline.metrics.fpsMinimum),
    projectileCountPeak: metricDelta(current.projectileCountPeak, baseline.metrics.projectileCountPeak),
    stuckStates: metricDelta(current.stuckStates, baseline.metrics.stuckStates),
    newJsErrorTypes,
  };
}

export function detectRegressions(
  current: SessionMetrics,
  comparison: BaselineComparison | null,
): ArenaRegression[] {
  const regressions: ArenaRegression[] = [];
  const baseline = comparison;

  if (
    baseline &&
    baseline.survivalTimeSeconds.percentChange !== null &&
    baseline.survivalTimeSeconds.percentChange < -20
  ) {
    regressions.push({
      code: 'survival_drop',
      detail: `Survival time dropped ${Math.abs(baseline.survivalTimeSeconds.percentChange)}% vs 7-day baseline`,
    });
  }

  const fpsDropAverage = baseline
    ? baseline.fpsAverage.percentChange !== null && baseline.fpsAverage.percentChange < -15
    : false;
  const fpsDropMinimum = baseline
    ? baseline.fpsMinimum.percentChange !== null && baseline.fpsMinimum.percentChange < -15
    : false;
  if (fpsDropAverage || fpsDropMinimum) {
    regressions.push({
      code: 'fps_drop',
      detail: `FPS regression detected (avg: ${baseline?.fpsAverage.percentChange ?? 0}%, min: ${baseline?.fpsMinimum.percentChange ?? 0}%)`,
    });
  }

  if ((baseline?.newJsErrorTypes.length ?? 0) > 0) {
    regressions.push({
      code: 'new_js_error',
      detail: `New JS error type(s): ${baseline?.newJsErrorTypes.join(', ')}`,
    });
  }

  if (current.stuckStates >= 3) {
    regressions.push({
      code: 'stuck_state',
      detail: `Detected ${current.stuckStates} stuck states (>5s no movement)`,
    });
  }

  return regressions;
}
