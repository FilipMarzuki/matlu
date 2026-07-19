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
  { name: "default·s42·200y", world: "default", seed: 42, years: 200, hash: "7f582fbe" },
  { name: "default·magic·s42·200y", world: "default", seed: 42, years: 200, magic: true, hash: "4b13928d" },
  { name: "frontier·s5·200y", world: "frontier", seed: 5, years: 200, hash: "47987fa8" },
  {
    name: "frontier·magic·prehistory·s5·250y",
    world: "frontier",
    seed: 5,
    years: 250,
    magic: true,
    prehistory: true,
    hash: "ea8ecdf4",
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

  // Academy invariants.
  for (const a of w.academies.values()) {
    if (a.prestige < 0 || a.prestige > 1)
      v.push(`academy ${a.id} prestige ${a.prestige} out of [0,1]`);
    if (a.closedYear !== null && a.closedYear < a.foundedYear)
      v.push(`academy ${a.id} closed before founded`);
    if (a.peakPrestige < a.prestige)
      v.push(`academy ${a.id} peakPrestige < current prestige`);
  }

  // Company invariants — bounded metrics, captain resolves, disbanded ordering.
  for (const co of w.companies.values()) {
    if (co.wealth < 0 || co.wealth > 1)
      v.push(`company ${co.id} wealth ${co.wealth} out of [0,1]`);
    if (co.prestige < 0 || co.prestige > 1)
      v.push(`company ${co.id} prestige ${co.prestige} out of [0,1]`);
    if (co.memberCount < 0)
      v.push(`company ${co.id} memberCount ${co.memberCount} negative`);
    if (co.disbandedYear !== null && co.disbandedYear < co.formedYear)
      v.push(`company ${co.id} disbandedYear ${co.disbandedYear} < formedYear ${co.formedYear}`);
    if (!w.char(co.captainId))
      v.push(`company ${co.id} captain ${co.captainId} missing`);
  }

  // Disease invariants — bounded lethality, parent resolves, burn-out ordering.
  for (const d of w.diseases.values()) {
    if (d.lethality < 0 || d.lethality > 1)
      v.push(`disease ${d.id} lethality ${d.lethality} out of [0,1]`);
    if (d.burnedOutYear !== null && d.burnedOutYear < d.emergedYear)
      v.push(`disease ${d.id} burnedOutYear ${d.burnedOutYear} < emergedYear ${d.emergedYear}`);
    if (d.parentStrainId && !w.diseases.get(d.parentStrainId))
      v.push(`disease ${d.id} references missing parent ${d.parentStrainId}`);
    if (d.strikeCount < 0)
      v.push(`disease ${d.id} negative strikeCount ${d.strikeCount}`);
    if (d.totalDeaths < 0)
      v.push(`disease ${d.id} negative totalDeaths ${d.totalDeaths}`);
  }

  // Union invariants — strength bounds, dissolvedYear ordering, dynasties resolve.
  for (const u of w.unions.values()) {
    if (u.strength < 0 || u.strength > 1)
      v.push(`union ${u.id} strength ${u.strength} out of [0,1]`);
    if (u.dissolvedYear !== null && u.dissolvedYear < u.formedYear)
      v.push(`union ${u.id} dissolvedYear ${u.dissolvedYear} < formedYear ${u.formedYear}`);
    if (!w.dynasty(u.dynastyAId))
      v.push(`union ${u.id} references missing dynastyA ${u.dynastyAId}`);
    if (!w.dynasty(u.dynastyBId))
      v.push(`union ${u.id} references missing dynastyB ${u.dynastyBId}`);
    if (u.dynastyAId === u.dynastyBId)
      v.push(`union ${u.id} pairs a dynasty with itself`);
  }

  // Named heroes / artefacts invariants.
  for (const h of w.namedHeroes.values()) {
    if (h.fame < 0 || h.fame > 1)
      v.push(`hero ${h.id} fame ${h.fame} out of [0,1]`);
    if (h.died && h.diedYear === null)
      v.push(`hero ${h.id} died but diedYear null`);
    if (!w.char(h.characterId))
      v.push(`hero ${h.id} references missing character ${h.characterId}`);
  }
  for (const a of w.artefacts.values()) {
    if (a.fame < 0 || a.fame > 1)
      v.push(`artefact ${a.id} fame ${a.fame} out of [0,1]`);
    if (a.lostYear !== null && a.lostYear < a.forgedYear)
      v.push(`artefact ${a.id} lost before forged`);
    if (a.bearerId && !w.char(a.bearerId))
      v.push(`artefact ${a.id} bearer ${a.bearerId} missing`);
    if (a.lostYear !== null && a.bearerId !== null)
      v.push(`artefact ${a.id} is lost but still has a bearer`);
  }

  // Language invariants — bounded scores, parent resolves, death consistency.
  for (const lg of w.languages.values()) {
    if (lg.driftScore < 0 || lg.driftScore > 1)
      v.push(`language ${lg.id} driftScore ${lg.driftScore} out of [0,1]`);
    if (lg.writtenCorpus < 0 || lg.writtenCorpus > 1)
      v.push(`language ${lg.id} writtenCorpus ${lg.writtenCorpus} out of [0,1]`);
    if (lg.parentId && !w.languages.get(lg.parentId))
      v.push(`language ${lg.id} references missing parent ${lg.parentId}`);
    if (lg.diedYear !== null && lg.diedYear < lg.bornYear)
      v.push(`language ${lg.id} died before it was born`);
    if (lg.revivedYear !== null && lg.diedYear === null)
      v.push(`language ${lg.id} has revivedYear but never died`);
  }

  // Religion invariants — power/prestige/drift in bounds, church-deity link
  // resolves, dead gods have diedYear, church.disbandedYear >= foundedYear.
  for (const d of w.deities.values()) {
    if (d.power < 0 || d.power > 1)
      v.push(`deity ${d.id} power ${d.power} out of [0,1]`);
    if (d.peakPower < d.power)
      v.push(`deity ${d.id} peakPower ${d.peakPower} < current power ${d.power}`);
    if (d.mood === "dead" && d.diedYear === null)
      v.push(`deity ${d.id} is dead but diedYear is null`);
  }
  for (const ch of w.churches.values()) {
    if (ch.prestige < 0 || ch.prestige > 1)
      v.push(`church ${ch.id} prestige ${ch.prestige} out of [0,1]`);
    if (ch.peakPrestige < ch.prestige)
      v.push(`church ${ch.id} peakPrestige < current prestige`);
    if (ch.doctrineDrift < 0 || ch.doctrineDrift > 1)
      v.push(`church ${ch.id} doctrineDrift ${ch.doctrineDrift} out of [0,1]`);
    if (ch.disbandedYear !== null && ch.disbandedYear < ch.foundedYear)
      v.push(`church ${ch.id} disbanded before founded`);
    if (!w.deities.get(ch.deityId))
      v.push(`church ${ch.id} references missing deity ${ch.deityId}`);
  }

  // Wildlife invariants — health in [0,1], extinct chronology, province refs
  // resolve, active species must have at least one province.
  for (const s of w.wildlife.values()) {
    if (s.populationHealth < 0 || s.populationHealth > 1)
      v.push(`species ${s.id} populationHealth ${s.populationHealth} out of [0,1]`);
    if (s.extinctYear !== null && s.extinctYear < s.firstDocumentedYear)
      v.push(`species ${s.id} extinct before it was documented`);
    if (s.huntTrophyCount < 0)
      v.push(`species ${s.id} negative huntTrophyCount ${s.huntTrophyCount}`);
    for (const pid of s.provinces) {
      if (!w.province(pid))
        v.push(`species ${s.id} references missing province ${pid}`);
    }
    if (s.extinctYear === null && s.provinces.length === 0)
      v.push(`species ${s.id} is active but has no provinces`);
  }

  // Expedition invariants — chronology + status/resolved coherence + refs
  // resolve. resolvedYear !== null iff status !== "launched".
  for (const ex of w.expeditions.values()) {
    if (ex.yearsAtSea < 0)
      v.push(`expedition ${ex.id} yearsAtSea ${ex.yearsAtSea} negative`);
    if (ex.resolvedYear !== null && ex.resolvedYear < ex.launchedYear)
      v.push(`expedition ${ex.id} resolved before it launched`);
    if ((ex.status === "launched") !== (ex.resolvedYear === null))
      v.push(`expedition ${ex.id} status/resolvedYear inconsistent`);
    if (!w.province(ex.launchedFromProvinceId))
      v.push(`expedition ${ex.id} references missing port ${ex.launchedFromProvinceId}`);
    if (ex.sponsorDynastyId !== null && !w.dynasty(ex.sponsorDynastyId))
      v.push(`expedition ${ex.id} references missing sponsor ${ex.sponsorDynastyId}`);
  }

  // Migration invariants — chronology, refs resolve, non-negative size.
  for (const wv of w.migrations.values()) {
    if (wv.sizeInSouls < 0)
      v.push(`migration ${wv.id} sizeInSouls ${wv.sizeInSouls} negative`);
    if (wv.resolvedYear !== null && wv.resolvedYear < wv.triggeredYear)
      v.push(`migration ${wv.id} resolved before it triggered`);
    if ((wv.status === "traveling") !== (wv.resolvedYear === null))
      v.push(`migration ${wv.id} status/resolvedYear inconsistent`);
    if (!w.province(wv.fromProvinceId))
      v.push(`migration ${wv.id} references missing origin ${wv.fromProvinceId}`);
    if (wv.destinationProvinceId !== null && !w.province(wv.destinationProvinceId))
      v.push(`migration ${wv.id} references missing destination ${wv.destinationProvinceId}`);
  }

  return v;
}
