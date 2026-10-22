// ether-state.ts — the bookkeeping the Ether layer keeps on the World.
//
// Kept in its own tiny module (not ether.ts) so world.ts can hold it without a
// circular import: ether.ts imports World, World imports only this.

import type { CharId, ProvinceId } from "./types.js";

// A death noted by markDead while --ether is on. Recorded at the moment of
// death (before succession reassigns titles), processed once a year by
// runEther at the end of the tick.
export interface PendingDeath {
  charId: CharId;
  wasRuler: boolean; // held a title when they died
}

export interface EtherState {
  convergedYear: number | null;  // year of ETHER_CONVERGENCE, or null before it
  firstYear: number | null;      // first year runEther saw (convergence can't fire right away)
  pendingDeaths: PendingDeath[]; // deaths since the last runEther pass
  deathCounts: Map<ProvinceId, number>;     // all deaths so far — picks where convergence is felt
  lastViolentYear: Map<ProvinceId, number>; // most recent violent death per province
  seatHeld: Map<ProvinceId, { dynastyId: string; since: number }>; // unbroken dynastic hold
  thinPlaces: Set<ProvinceId>;   // provinces already recognised as thin (logged once)
  lingering: CharId[];           // dead characters whose spirits have not moved on
}

export function newEtherState(): EtherState {
  return {
    convergedYear: null,
    firstYear: null,
    pendingDeaths: [],
    deathCounts: new Map(),
    lastViolentYear: new Map(),
    seatHeld: new Map(),
    thinPlaces: new Set(),
    lingering: [],
  };
}
