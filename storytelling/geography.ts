// geography.ts — carrying capacity and scarcity.
//
// Layer 1 of the causal stack. Geography is the persistent grain of history:
// a province can only feed so many people. When population presses against
// that ceiling, scarcity rises, and scarcity is the pressure that later turns
// ordinary ambition into war. Nothing here is random — it's pure structure.

import type { Province, Terrain } from "./types.js";
import type { World } from "./world.js";

// Terrain modifies how much food a unit of fertility actually yields. Plains
// feed armies; mountains starve them. These multipliers are the whole reason
// a kingdom's heartland sits where it does.
const TERRAIN_YIELD: Record<Terrain, number> = {
  meadow: 1.05, // the lush heartland — the richest land there is
  plains: 1.0,
  hills: 0.7,
  forest: 0.6,
  coast: 0.85, // fishing supplements the land
  mountain: 0.4,
  steppe: 0.5, // grazing land — feeds herds and raiders, not cities
  desert: 0.2, // oasis-thin; scarcity here is the engine of the raids
  swamp: 0.45,
  jungle: 0.6, // lush but hard to clear
};

// The maximum population a province can sustain. Capacity caps population,
// population caps levy & wealth (see World.power), so this single number
// ripples all the way up into politics.
export function carryingCapacity(p: Province): number {
  const base = 1000; // a fully fertile plains county
  const blight = p.blightLevel ?? 0;
  const raw = base * p.fertility * TERRAIN_YIELD[p.terrain] * (1 - blight * 0.8);
  // Only floor at 50 when blighted — a fully blighted province can still feed
  // a minimal remnant, but an untouched desert is allowed its natural scarcity.
  // Without the guard, the floor would alter pop dynamics in naturally-thin
  // provinces and break the golden-master hashes.
  return blight > 0 ? Math.max(50, Math.round(raw)) : Math.round(raw);
}

// Scarcity in [0, ~1.5]: population relative to capacity. Below ~0.8 there's
// slack; above 1.0 the land is overdrawn and people are hungry. The goals
// layer reads this to decide when ambition curdles into expansion/war.
export function scarcity(p: Province): number {
  const cap = carryingCapacity(p);
  if (cap <= 0) return 2;
  return p.population / cap;
}

// Natural population drift toward carrying capacity. Below capacity, pops grow;
// above it, they shrink (starvation pressure even before an outright famine).
// Logistic-ish: growth slows as you approach the ceiling. This runs every tick
// and is what makes overpopulation a slow-building structural pressure rather
// than a coin flip.
export function regrowPopulation(w: World): void {
  for (const p of w.provinces.values()) {
    const cap = carryingCapacity(p);
    const s = scarcity(p);
    let rate: number;
    if (s < 1) {
      rate = 0.03 * (1 - s); // healthy growth, tapering near the cap
    } else {
      rate = -0.04 * (s - 1); // overdrawn land bleeds people
    }
    p.population = Math.max(50, Math.round(p.population * (1 + rate)));
    // Never let a province balloon far past what it can feed.
    p.population = Math.min(p.population, Math.round(cap * 1.25));
  }
}

// Mean scarcity across the realm — handy for the chronicle's mood and for
// deciding how hungry/desperate the world is at a glance.
export function realmScarcity(w: World): number {
  const provs = [...w.provinces.values()];
  if (provs.length === 0) return 0;
  return provs.reduce((a, p) => a + scarcity(p), 0) / provs.length;
}
