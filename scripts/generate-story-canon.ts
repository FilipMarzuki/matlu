// scripts/generate-story-canon.ts — deterministically simulate one canonical
// world and dump the sifted chronicle to a JSON the Matlu Codex wiki reads at
// build time. This is the first "outward wire" from the story engine — a run
// the engine has always been able to produce, now surfaced to readers.
//
// Usage:
//   npm run story:canon
// Writes:
//   wiki/src/data/story-canon.json
//
// The output is committed to the repo, so wiki builds don't have to run the
// engine themselves. Re-run whenever the engine's canonical output should be
// refreshed (typically after a golden-hash rebaseline).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractArcs } from "../storytelling/arcs.js";
import { magicInit } from "../storytelling/magic.js";
import { generatePrehistory } from "../storytelling/prehistory.js";
import { renderEvent } from "../storytelling/render.js";
import { loadWorld } from "../storytelling/seed.js";
import { sift } from "../storytelling/sifter.js";
import { tick } from "../storytelling/tick.js";
import { FRONTIER_SPEC } from "../storytelling/worlds/frontier.js";
import "../storytelling/specs/index.js";

// The one canonical seed for the wiki. Frontier + magic + prehistory + 300y
// gives us dynasties, magic classes, sieges, climate phases, trade routes, and
// academies all firing in the same run.
const CANON = {
  world: "frontier" as const,
  seed: 5,
  years: 300,
  magic: true,
  prehistory: true,
  prehistorySpan: 800,
  catastrophes: true,
  threshold: 5,
};

const OUT_PATH = join("wiki", "src", "data", "story-canon.json");

const w = loadWorld(FRONTIER_SPEC, CANON.seed);
w.magicEnabled = true;
w.catastrophesEnabled = true;
magicInit(w);
generatePrehistory(w, CANON.prehistorySpan);
for (let y = 0; y < CANON.years; y++) tick(w);

const { chronicle } = sift(w, CANON.threshold);
const arcs = extractArcs(w, chronicle);

// Build the JSON shape the wiki will render.
interface ChronicleEvent { year: number; type: string; text: string; }
interface ArcOut {
  id: string;
  title: string;
  kind: string;
  startYear: number;
  endYear: number;
  eventCount: number;
  significance: number;
  events: ChronicleEvent[];
}

const eventById = new Map<number, ChronicleEvent>();
for (const ev of chronicle) {
  eventById.set(ev.id, { year: ev.year, type: ev.type, text: renderEvent(w, ev) });
}

const arcsOut: ArcOut[] = arcs
  .slice(0, 24) // top 24 arcs is plenty; more becomes noise
  .map((a) => ({
    id: a.id,
    title: a.title,
    kind: a.kind,
    startYear: a.startYear,
    endYear: a.endYear,
    eventCount: a.eventIds.length,
    significance: a.significance,
    events: a.eventIds
      .map((id) => eventById.get(id))
      .filter((e): e is ChronicleEvent => !!e),
  }));

// Kingdom rundown at final year.
const kingdoms: { name: string; seat: string; holder: string | null }[] = [];
for (const t of w.titles.values()) {
  if (t.tier !== "kingdom") continue;
  const holder = w.char(t.holderId);
  const seat = w.province(t.provinceId)?.name ?? "unknown seat";
  kingdoms.push({
    name: t.name,
    seat,
    holder: holder ? `${holder.name} of ${w.dynasty(holder.dynastyId)?.name ?? "no house"}` : null,
  });
}

// Surviving dynasties.
const survivingHouses = [...w.dynasties.values()]
  .filter((dy) => dy.extinctYear === null && w.dynastyMembers(dy.id).length > 0)
  .map((dy) => ({
    name: dy.name,
    foundedYear: dy.foundedYear,
    members: w.dynastyMembers(dy.id).length,
    specialization: dy.dominantClass ?? null,
    specializationDepth: dy.specializationDepth,
  }))
  .sort((a, b) => b.members - a.members)
  .slice(0, 12);

// Persistent-entity snapshot — the payoff of the last five layers.
const activeTradeRoutes = [...w.tradeRoutes.values()]
  .filter((r) => r.closedYear === null)
  .map((r) => ({
    from: w.province(r.fromProvinceId)?.name ?? "?",
    to: w.province(r.toProvinceId)?.name ?? "?",
    conduit: r.conduit,
    foundedYear: r.foundedYear,
    wealth: Math.round(r.wealth * 100) / 100,
    peakWealth: Math.round(r.peakWealth * 100) / 100,
  }))
  .sort((a, b) => b.peakWealth - a.peakWealth)
  .slice(0, 8);

const activeAcademies = [...w.academies.values()]
  .filter((a) => a.closedYear === null)
  .map((a) => ({
    name: a.name,
    province: w.province(a.provinceId)?.name ?? "?",
    foundedYear: a.foundedYear,
    prestige: Math.round(a.prestige * 100) / 100,
    peakPrestige: Math.round(a.peakPrestige * 100) / 100,
    scholars: a.memberIds.length,
  }))
  .sort((a, b) => b.peakPrestige - a.peakPrestige)
  .slice(0, 6);

const activeGuilds = [...w.guilds.values()]
  .filter((g) => g.disbandedYear === null)
  .map((g) => ({
    name: g.name,
    craft: g.craft,
    foundedYear: g.foundedYear,
    members: g.memberIds.length,
  }))
  .sort((a, b) => b.members - a.members)
  .slice(0, 8);

// Climate arc.
const climate = {
  phase: w.climate.phase,
  severity: Math.round(w.climate.severity * 100) / 100,
  phaseStartYear: w.climate.phaseStartYear,
  phaseDurationYears: w.climate.phaseDurationYears,
};

// Event tally.
const eventCounts = new Map<string, number>();
for (const ev of w.events) eventCounts.set(ev.type, (eventCounts.get(ev.type) ?? 0) + 1);
const eventTally: { type: string; count: number }[] = [...eventCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25)
  .map(([type, count]) => ({ type, count }));

const canon = {
  meta: {
    generatedAt: new Date().toISOString(),
    seed: CANON.seed,
    world: CANON.world,
    years: CANON.years,
    prehistorySpan: CANON.prehistorySpan,
    magic: CANON.magic,
    catastrophes: CANON.catastrophes,
    threshold: CANON.threshold,
    startYear: chronicle[0]?.year ?? 0,
    endYear: w.year,
    totalEvents: w.events.length,
    chronicledEvents: chronicle.length,
  },
  climate,
  kingdoms,
  survivingHouses,
  arcs: arcsOut,
  tradeRoutes: activeTradeRoutes,
  academies: activeAcademies,
  guilds: activeGuilds,
  eventTally,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(canon, null, 2) + "\n");
console.log(`Wrote ${OUT_PATH}: ${arcsOut.length} arcs · ${chronicle.length} chronicled events · ${w.events.length} total events`);
