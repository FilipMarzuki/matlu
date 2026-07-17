// trade.ts — multi-year lifecycle for persistent trade routes.
//
// Emergence still MINTS TradeRoutes via TRADE_ROUTE_ESTABLISHED, and shocks
// still hit them via TRADE_ROUTE_DISRUPTED (both in emergence.ts). This module
// AGES them each tick: passive growth in peaceful years, decay if long-shocked,
// FLOURISHES when wealth crosses a peak threshold, dormancy when wealth = 0,
// ABANDONED after 15 years of dormancy, REVIVED when a dormant route recovers
// via a fresh TRADE_ROUTE_ESTABLISHED event, and GREAT_MARKET_FAIR each year
// at hub provinces (highest total connected route wealth).
//
// Routes compose with:
//   • Sieges: SIEGE_LAID at an endpoint counts as a shock (via emergence's
//     recentShocks pass — sieges already fire an event this tick).
//   • Climate: cold phases dampen route growth, warm phases accelerate.
//   • Guilds: mercantile guild at an endpoint boosts route wealth.
//
// Guarded on `catastrophesEnabled` for the same reason as climate — the base
// sim without catastrophes stays byte-identical.

import { climateHarvestMultiplier } from "./climate.js";
import type { ProvinceId } from "./types.js";
import type { World } from "./world.js";

const ABANDON_DORMANT_YEARS = 15;
const FLOURISH_THRESHOLD = 0.8;
const MARKET_FAIR_WEALTH_THRESHOLD = 1.2; // sum of wealth on routes touching a hub

// Called from tick.ts once per year, after emergence.ts:runEmergence.
export function runTradeRoutes(w: World): void {
  if (!w.catastrophesEnabled) return;
  if (w.tradeRoutes.size === 0) return;
  agentRoutes(w);
  checkGreatMarketFair(w);
}

function agentRoutes(w: World): void {
  // Climate acts as a multi-decade multiplier on trade growth. Warm = 1.15,
  // cold = 0.85, neutral = 1.0. Same shape as harvest multiplier for symmetry.
  const climateMult = climateHarvestMultiplier(w);
  for (const r of w.tradeRoutes.values()) {
    if (r.closedYear !== null) continue;
    // Growth: routes that survived the year without a fresh shock grow slowly
    // toward 1.0. Passive decay if the route was recently shocked.
    const shockedRecently = w.events.some(
      (e) => e.type === "TRADE_ROUTE_DISRUPTED" && e.data["routeId"] === r.id
           && w.year - e.year <= 2,
    );
    if (shockedRecently) {
      // Decay continues after the initial hit.
      r.wealth = Math.max(0, r.wealth - 0.05);
    } else {
      // Peaceful year — slow growth toward saturation. Climate modulates it.
      r.wealth = Math.min(1, r.wealth + 0.03 * climateMult);
    }

    // Track peak wealth and fire FLOURISHES on the way up.
    if (r.wealth > r.peakWealth) r.peakWealth = r.wealth;
    if (r.wealth >= FLOURISH_THRESHOLD && r.flourishesLoggedAt === null) {
      r.flourishesLoggedAt = w.year;
      w.log("TRADE_ROUTE_FLOURISHES", {
        provinceId: r.toProvinceId,
        data: {
          routeId: r.id,
          fromProvinceId: r.fromProvinceId,
          toProvinceId: r.toProvinceId,
          conduit: r.conduit,
          peakWealth: r.peakWealth,
        },
      });
    }

    // Dormancy tracking.
    if (r.wealth === 0) {
      if (r.dormantSince === null) r.dormantSince = w.year;
    } else if (r.dormantSince !== null && r.wealth > 0.2) {
      // A dormant route that has recovered above 20% is considered revived.
      const wasDormantFor = w.year - r.dormantSince;
      r.dormantSince = null;
      if (wasDormantFor >= 5) {
        w.log("TRADE_ROUTE_REVIVED", {
          provinceId: r.toProvinceId,
          data: {
            routeId: r.id,
            fromProvinceId: r.fromProvinceId,
            toProvinceId: r.toProvinceId,
            dormantYears: wasDormantFor,
          },
        });
      }
    }

    // Abandonment.
    if (r.dormantSince !== null && w.year - r.dormantSince >= ABANDON_DORMANT_YEARS) {
      r.closedYear = w.year;
      w.log("TRADE_ROUTE_ABANDONED", {
        provinceId: r.toProvinceId,
        data: {
          routeId: r.id,
          fromProvinceId: r.fromProvinceId,
          toProvinceId: r.toProvinceId,
          totalYears: w.year - r.foundedYear,
          shockCount: r.shockCount,
        },
      });
    }
  }
}

// Fire a GREAT_MARKET_FAIR at a province that hubs many routes with high
// combined wealth. Once per province per 10 years.
function checkGreatMarketFair(w: World): void {
  const hubWealth = new Map<ProvinceId, number>();
  for (const r of w.tradeRoutes.values()) {
    if (r.closedYear !== null) continue;
    if (r.wealth < 0.4) continue;
    hubWealth.set(r.toProvinceId, (hubWealth.get(r.toProvinceId) ?? 0) + r.wealth);
    hubWealth.set(r.fromProvinceId, (hubWealth.get(r.fromProvinceId) ?? 0) + r.wealth * 0.6);
  }
  for (const [pid, total] of hubWealth) {
    if (total < MARKET_FAIR_WEALTH_THRESHOLD) continue;
    // Cooldown check — no repeat within 20 years at the same province.
    const recent = w.events.some(
      (e) => e.type === "GREAT_MARKET_FAIR" && e.provinceId === pid && w.year - e.year < 20,
    );
    if (recent) continue;
    if (!w.rng.chance(0.15)) continue;
    w.log("GREAT_MARKET_FAIR", {
      provinceId: pid,
      data: {
        hubWealth: Number(total.toFixed(2)),
        routeCount: [...w.tradeRoutes.values()].filter(
          (r) => r.closedYear === null && (r.fromProvinceId === pid || r.toProvinceId === pid),
        ).length,
      },
    });
  }
}
