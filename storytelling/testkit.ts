// testkit.ts — reusable helpers for the engine tests. Kept OUT of any *.test.ts
// so it stays node-free (no `vitest`/`node:*` imports) and is covered by the
// standalone `tsc -p storytelling/tsconfig.json` typecheck.
//
// The engine is deterministic, so testing leans on two pillars:
//   • GOLDEN-MASTER — hash the canonical event log for a matrix of configs; any
//     change to the SIMULATION flips the hash. (We hash the event log, not the
//     rendered chronicle, so render/tuning tweaks don't trip these.)
//   • INVARIANTS — run many seeds and assert structural truths that must hold
//     regardless of seed (a held title's holder is alive, the family graph is
//     consistent, bounds are respected, …). These catch logic bugs a single
//     golden hash can't.

import { generatePrehistory } from "./prehistory.js";
import { loadWorld } from "./seed.js";
import { tick } from "./tick.js";
import type { World } from "./world.js";
import { DEFAULT_SPEC, type WorldSpec } from "./world-spec.js";
import { FRONTIER_SPEC } from "./worlds/frontier.js";
// magicInit is imported lazily-by-value to keep the surface small.
import { magicInit } from "./magic.js";

export interface SimConfig {
  name: string;
  world?: "default" | "frontier";
  seed: number;
  years: number;
  magic?: boolean;
  prehistory?: boolean;
  prehistorySpan?: number;
}

const SPECS: Record<string, WorldSpec> = { default: DEFAULT_SPEC, frontier: FRONTIER_SPEC };

// Build and run a world exactly as main.ts does, minus rendering.
export function runSim(cfg: SimConfig): World {
  const w = loadWorld(SPECS[cfg.world ?? "default"], cfg.seed);
  if (cfg.magic) {
    w.magicEnabled = true;
    magicInit(w);
  }
  if (cfg.prehistory) generatePrehistory(w, cfg.prehistorySpan ?? 800);
  for (let y = 0; y < cfg.years; y++) tick(w);
  return w;
}

// A stable hash of the CANONICAL event log — the sim's source of truth. Excludes
// `significance` (a render-time annotation) so tuning the sifter doesn't change
// it. Pure JS (djb2-xor), no deps, so it runs anywhere the engine does.
export function canonHash(w: World): string {
  let h = 5381 >>> 0;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  };
  for (const e of w.events) {
    feed(
      `${e.id}|${e.year}|${e.type}|${e.actorId}|${e.targetId}|${e.titleId}|${e.provinceId}|${JSON.stringify(e.data)}\n`,
    );
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// The golden-master matrix. Hashes are filled in from an actual run (see the
// note at the bottom); a mismatch means the simulation changed.
export const GOLDEN: (SimConfig & { hash: string })[] = [
  { name: "default·s42·200y", world: "default", seed: 42, years: 200, hash: "8afd30e6" },
  { name: "default·magic·s42·200y", world: "default", seed: 42, years: 200, magic: true, hash: "bde8f129" },
  { name: "frontier·s5·200y", world: "frontier", seed: 5, years: 200, hash: "eea4b60d" },
  {
    name: "frontier·magic·prehistory·s5·250y",
    world: "frontier",
    seed: 5,
    years: 250,
    magic: true,
    prehistory: true,
    hash: "eca0094f",
  },
];

// ── Invariants ───────────────────────────────────────────────────────────────
// Each returns a human-readable violation string, or nothing when it holds.
// checkInvariants runs them all and returns every violation found.
export function checkInvariants(w: World): string[] {
  const v: string[] = [];

  // A held title's holder must exist and be alive.
  for (const t of w.titles.values()) {
    if (t.holderId === null) continue;
    const h = w.char(t.holderId);
    if (!h) v.push(`title ${t.id} held by missing char ${t.holderId}`);
    else if (!h.alive) v.push(`title ${t.id} held by dead char ${h.id}`);
  }

  // Family graph is consistent both ways, and no one is their own ancestor.
  for (const c of w.characters.values()) {
    for (const kidId of c.childrenIds) {
      const kid = w.char(kidId);
      if (!kid) v.push(`char ${c.id} lists missing child ${kidId}`);
      else if (kid.fatherId !== c.id && kid.motherId !== c.id)
        v.push(`child ${kidId} does not point back to parent ${c.id}`);
    }
    for (const pid of [c.fatherId, c.motherId]) {
      if (pid && !w.char(pid)) v.push(`char ${c.id} has missing parent ${pid}`);
    }
    // ancestor cycle check
    const seen = new Set<string>([c.id]);
    let cur: typeof c | undefined = c;
    let guard = 0;
    while (cur && guard++ < 1000) {
      const fid: string | null = cur.fatherId;
      if (!fid) break;
      if (seen.has(fid)) {
        v.push(`ancestor cycle at ${c.id}`);
        break;
      }
      seen.add(fid);
      cur = w.char(fid);
    }
  }

  // Claims must reference real titles.
  for (const c of w.characters.values()) {
    for (const cl of c.claims) {
      if (!w.title(cl.titleId)) v.push(`char ${c.id} claims missing title ${cl.titleId}`);
    }
  }

  // A dynasty with living members must not be marked extinct.
  for (const dy of w.dynasties.values()) {
    if (dy.extinctYear !== null && w.dynastyMembers(dy.id).length > 0)
      v.push(`dynasty ${dy.id} is extinct but has living members`);
  }

  // Province population never drops below the hard floor.
  for (const p of w.provinces.values()) {
    if (p.population < 50) v.push(`province ${p.id} population ${p.population} < 50`);
  }

  // Psyche bounds.
  const validDistortions = new Set(["none", "paranoid", "megalomaniac", "zealot"]);
  for (const c of w.characters.values()) {
    if (!validDistortions.has(c.psyche.distortion))
      v.push(`char ${c.id} has invalid distortion "${c.psyche.distortion}"`);
    if (c.psyche.distortion !== "none" && c.psyche.distortionOnsetYear === null)
      v.push(`char ${c.id} has distortion but null distortionOnsetYear`);
    if (c.psyche.inbreedingCoeff < 0 || c.psyche.inbreedingCoeff > 1)
      v.push(`char ${c.id} inbreedingCoeff ${c.psyche.inbreedingCoeff} out of [0,1]`);
    for (const [bias, val] of Object.entries(c.psyche.biases)) {
      if (val < 0 || val > 1) v.push(`char ${c.id} bias ${bias}=${val} out of [0,1]`);
    }
  }

  // Magic bounds.
  if (w.magicEnabled) {
    for (const c of w.characters.values()) {
      if (c.level < 1 || c.level > 40) v.push(`char ${c.id} level ${c.level} out of [1,40]`);
      if (c.comfort < 0 || c.comfort > 1) v.push(`char ${c.id} comfort ${c.comfort} out of [0,1]`);
    }
  }

  // Event log ids strictly increase and years never go backwards.
  let lastId = -1;
  let lastYear = -Infinity;
  for (const e of w.events) {
    if (e.id <= lastId) v.push(`event id ${e.id} not increasing (prev ${lastId})`);
    if (e.year < lastYear) v.push(`event year ${e.year} < previous ${lastYear}`);
    lastId = e.id;
    lastYear = e.year;
  }

  // Innovation invariants — personal wealth non-negative, mentor/apprentice
  // consistency, invention state coherent.
  for (const c of w.characters.values()) {
    if (c.personalWealth < 0) v.push(`char ${c.id} personalWealth ${c.personalWealth} < 0`);
    if (c.alive && c.mentorId) {
      const m = w.char(c.mentorId);
      if (!m) v.push(`living char ${c.id} points to missing mentor ${c.mentorId}`);
      else if (!m.alive) v.push(`living char ${c.id} points to dead mentor ${m.id}`);
      else if (!m.apprenticeIds.includes(c.id))
        v.push(`char ${c.id} lists mentor ${m.id} but master doesn't list them back`);
    }
  }
  for (const inv of w.inventions.values()) {
    if (inv.leakProbBase < 0 || inv.leakProbBase > 1)
      v.push(`invention ${inv.id} leakProbBase ${inv.leakProbBase} out of [0,1]`);
    if (inv.tier < 1 || inv.tier > 3)
      v.push(`invention ${inv.id} tier ${inv.tier} out of [1,3]`);
    if (inv.lost && inv.lostYear === null)
      v.push(`invention ${inv.id} lost but lostYear null`);
  }

  // Dynasty specialization + guild invariants.
  for (const dyn of w.dynasties.values()) {
    if (dyn.specializationDepth < 0 || dyn.specializationDepth > 1)
      v.push(`dynasty ${dyn.id} specializationDepth ${dyn.specializationDepth} out of [0,1]`);
  }
  for (const g of w.guilds.values()) {
    if (g.disbandedYear === null && g.memberIds.length < 1)
      v.push(`active guild ${g.id} has no members`);
    for (const mid of g.memberIds) {
      const m = w.char(mid);
      if (m && m.alive && m.guildId !== g.id)
        v.push(`guild ${g.id} lists member ${mid} but char points to guildId ${m.guildId}`);
    }
  }

  // Siege invariants.
  for (const s of w.siegeQueue) {
    if (s.provisions < 0 || s.provisions > 1)
      v.push(`siege ${s.id} provisions ${s.provisions} out of [0,1]`);
    if (s.attackerMorale < 0 || s.attackerMorale > 1)
      v.push(`siege ${s.id} attackerMorale ${s.attackerMorale} out of [0,1]`);
    if (s.defenderMorale < 0 || s.defenderMorale > 1)
      v.push(`siege ${s.id} defenderMorale ${s.defenderMorale} out of [0,1]`);
    if (s.yearsElapsed < 0)
      v.push(`siege ${s.id} yearsElapsed ${s.yearsElapsed} negative`);
  }

  // Climate invariants.
  const cl = w.climate;
  if (cl.severity < 0 || cl.severity > 1)
    v.push(`climate severity ${cl.severity} out of [0,1]`);
  if (cl.phaseDurationYears < 1)
    v.push(`climate phaseDurationYears ${cl.phaseDurationYears} < 1`);
  if (cl.phase === "neutral" && cl.severity !== 0)
    v.push(`neutral climate should have severity 0, got ${cl.severity}`);

  // Trade route invariants.
  for (const r of w.tradeRoutes.values()) {
    if (r.wealth < 0 || r.wealth > 1)
      v.push(`trade route ${r.id} wealth ${r.wealth} out of [0,1]`);
    if (r.closedYear !== null && r.closedYear < r.foundedYear)
      v.push(`trade route ${r.id} closed before founded`);
    if (r.peakWealth < r.wealth)
      v.push(`trade route ${r.id} peakWealth ${r.peakWealth} < current wealth ${r.wealth}`);
  }

  return v;
}
