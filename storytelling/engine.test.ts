// engine.test.ts — the storytelling engine's safety net. Excluded from
// storytelling/tsconfig (it imports `vitest`); run by `vitest run storytelling`.
//
// Three pillars, all leaning on the fact that the sim is deterministic and fast:
//   1. GOLDEN-MASTER — the canonical event log hashes to a pinned value; any
//      change to the simulation flips it (re-baseline deliberately, after
//      diffing the event log, when the change is intentional).
//   2. DETERMINISM — the same config run twice is byte-identical.
//   3. INVARIANTS — structural truths hold across many seeds/worlds/flags.

import { describe, expect, test } from "vitest";
import { GOLDEN, canonHash, checkInvariants, runSim, type SimConfig } from "./testkit.js";

describe("golden master — the event log is stable", () => {
  test.each(GOLDEN)("$name", (c) => {
    // If this fails on an INTENTIONAL change: run the sim, diff the event log
    // (`--save` two versions, diff the ndjson), then update the hash in testkit.
    expect(canonHash(runSim(c))).toBe(c.hash);
  });
});

describe("determinism — same config, same history", () => {
  // 15s timeout: reproducibility runs the sim TWICE back-to-back, so a 250y
  // frontier + magic + prehistory run can easily cross the default 5s.
  test.each([GOLDEN[1], GOLDEN[3]])("$name is reproducible", (c) => {
    expect(canonHash(runSim(c))).toBe(canonHash(runSim(c)));
  }, 15000);
});

describe("regional level (#1598, #1608) — deterministic", () => {
  // The level keeps its own log and draws only from its own stream, but since
  // #1608 it pushes back into provinces and people, so the golden hashes above
  // include its consequences. These pin that its own output is reproducible
  // too, and that it has something to say.
  test.each([GOLDEN[0], GOLDEN[2]])("$name tells the same regional history twice", (c) => {
    const key = (w: ReturnType<typeof runSim>) =>
      JSON.stringify([[...w.regions.values()], w.regionalEvents]);
    const a = runSim(c);
    expect(key(a)).toBe(key(runSim(c)));
    expect(a.regions.size).toBeGreaterThan(0);
    const categories = new Set(a.regionalEvents.map((e) => e.category));
    expect([...categories].sort()).toEqual(["economy", "event", "politics"]);
  }, 15000);
});

describe("invariants — hold across seeds, worlds and flags", () => {
  const cases: SimConfig[] = [];
  for (let seed = 1; seed <= 16; seed++) {
    cases.push({ name: `default·s${seed}`, world: "default", seed, years: 120, magic: seed % 2 === 0 });
    cases.push({
      name: `frontier·s${seed}`,
      world: "frontier",
      seed,
      years: 120,
      magic: seed % 2 === 1,
      prehistory: seed % 3 === 0,
    });
  }
  test.each(cases)("$name never violates a structural invariant", (c) => {
    // No crash + every invariant (holder alive, family graph, bounds, …) holds.
    expect(checkInvariants(runSim(c))).toEqual([]);
  });
});
