// scripts/generate-story-chronicles.ts — run several canonical world configs
// and dump each as a JSON the Matlu Codex reads at build time. Each config is
// a distinctive world-shape so the wiki has more than one story to tell.
//
// Usage:
//   npm run story:chronicles
// Writes:
//   wiki/src/data/chronicles/<slug>.json         (per-chronicle)
//   wiki/src/data/chronicles/index.json          (manifest)

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractArcs } from "../storytelling/arcs.js";
import { magicInit } from "../storytelling/magic.js";
import { generatePrehistory } from "../storytelling/prehistory.js";
import { renderEvent } from "../storytelling/render.js";
import { loadWorld } from "../storytelling/seed.js";
import { sift } from "../storytelling/sifter.js";
import { tick } from "../storytelling/tick.js";
import { DEFAULT_SPEC, type WorldSpec } from "../storytelling/world-spec.js";
import { FRONTIER_SPEC } from "../storytelling/worlds/frontier.js";
import "../storytelling/specs/index.js";

// Config for a single canonical run. slug + label + subtitle appear in the
// index; everything else drives the simulation.
interface ChronicleConfig {
  slug: string;
  label: string;
  labelSv: string;
  subtitle: string;
  subtitleSv: string;
  world: WorldSpec;
  worldName: string;
  seed: number;
  years: number;
  magic: boolean;
  catastrophes: boolean;
  prehistory: boolean;
  prehistorySpan: number;
  threshold: number;
}

// Three distinctive world-shapes. Add more here as the wiki wants them.
const CHRONICLES: ChronicleConfig[] = [
  {
    slug: "the-frontier",
    label: "The Frontier",
    labelSv: "Gränslandet",
    subtitle: "A tangible-god age closes; the world learns to live without.",
    subtitleSv: "En tid av påtagliga gudar tar slut; världen lär sig att leva utan.",
    world: FRONTIER_SPEC,
    worldName: "frontier",
    seed: 5,
    years: 300,
    magic: true,
    catastrophes: true,
    prehistory: true,
    prehistorySpan: 800,
    threshold: 5,
  },
  {
    slug: "the-long-shadow",
    label: "The Long Shadow",
    labelSv: "Den långa skuggan",
    subtitle: "Five centuries of demigods, sieges, plagues and dying tongues.",
    subtitleSv: "Fem sekel av halvgudar, belägringar, farsoter och döende språk.",
    world: FRONTIER_SPEC,
    worldName: "frontier",
    seed: 13,
    years: 500,
    magic: true,
    catastrophes: true,
    prehistory: true,
    prehistorySpan: 800,
    threshold: 5,
  },
  {
    slug: "the-mundane-frontier",
    label: "The Mundane Frontier",
    labelSv: "Det jordnära gränslandet",
    subtitle: "A world without magic — only kings, houses, and their claims.",
    subtitleSv: "En värld utan magi — bara kungar, ätter och deras anspråk.",
    world: FRONTIER_SPEC,
    worldName: "frontier",
    seed: 7,
    years: 300,
    magic: false,
    catastrophes: false,
    prehistory: false,
    prehistorySpan: 0,
    threshold: 4,
  },
];

// Sanity: the default-world spec is imported so we can add it later without
// tripping the linter; touch it here.
void DEFAULT_SPEC;

const OUT_DIR = join("wiki", "src", "data", "chronicles");

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

function runOne(cfg: ChronicleConfig): { path: string; summary: string } {
  const w = loadWorld(cfg.world, cfg.seed);
  if (cfg.magic) {
    w.magicEnabled = true;
    magicInit(w);
  }
  if (cfg.catastrophes) {
    w.catastrophesEnabled = true;
  }
  if (cfg.prehistory) {
    generatePrehistory(w, cfg.prehistorySpan);
  }
  for (let y = 0; y < cfg.years; y++) tick(w);

  const { chronicle } = sift(w, cfg.threshold);
  const arcs = extractArcs(w, chronicle);

  const eventById = new Map<number, ChronicleEvent>();
  for (const ev of chronicle) {
    eventById.set(ev.id, { year: ev.year, type: ev.type, text: renderEvent(w, ev) });
  }

  const arcsOut: ArcOut[] = arcs
    .slice(0, 24)
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

  // Living deities snapshot (magic-only worlds populate this).
  const livingDeities = [...w.deities.values()]
    .filter((d) => d.mood !== "dead")
    .map((d) => ({
      name: d.name,
      domain: d.domain,
      tier: d.tier,
      mood: d.mood,
      power: Math.round(d.power * 100) / 100,
      peakPower: Math.round(d.peakPower * 100) / 100,
    }))
    .slice(0, 6);

  // Living languages snapshot (culture-having worlds populate this).
  const livingLanguages = [...w.languages.values()]
    .filter((lg) => lg.diedYear === null)
    .map((lg) => ({
      name: lg.name,
      driftScore: Math.round(lg.driftScore * 100) / 100,
      writtenCorpus: Math.round(lg.writtenCorpus * 100) / 100,
      linguaFrancaRoutes: lg.linguaFrancaRoutes.length,
      speakerCultures: lg.speakerCultures.length,
    }))
    .slice(0, 12);

  // Notable disease strains (catastrophes-only).
  const notableDiseases = [...w.diseases.values()]
    .sort((a, b) => b.totalDeaths - a.totalDeaths)
    .slice(0, 6)
    .map((d) => ({
      name: d.name,
      family: d.family,
      category: d.category,
      emergedYear: d.emergedYear,
      burnedOutYear: d.burnedOutYear,
      strikeCount: d.strikeCount,
      totalDeaths: d.totalDeaths,
    }));

  const climate = {
    phase: w.climate.phase,
    severity: Math.round(w.climate.severity * 100) / 100,
    phaseStartYear: w.climate.phaseStartYear,
    phaseDurationYears: w.climate.phaseDurationYears,
  };

  const eventCounts = new Map<string, number>();
  for (const ev of w.events) eventCounts.set(ev.type, (eventCounts.get(ev.type) ?? 0) + 1);
  const eventTally: { type: string; count: number }[] = [...eventCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([type, count]) => ({ type, count }));

  const chronicleJson = {
    meta: {
      generatedAt: new Date().toISOString(),
      slug: cfg.slug,
      label: cfg.label,
      labelSv: cfg.labelSv,
      subtitle: cfg.subtitle,
      subtitleSv: cfg.subtitleSv,
      seed: cfg.seed,
      world: cfg.worldName,
      years: cfg.years,
      prehistorySpan: cfg.prehistorySpan,
      magic: cfg.magic,
      catastrophes: cfg.catastrophes,
      threshold: cfg.threshold,
      startYear: chronicle[0]?.year ?? 0,
      endYear: w.year,
      totalEvents: w.events.length,
      chronicledEvents: chronicle.length,
    },
    climate,
    kingdoms,
    survivingHouses,
    livingDeities,
    livingLanguages,
    notableDiseases,
    arcs: arcsOut,
    tradeRoutes: activeTradeRoutes,
    academies: activeAcademies,
    guilds: activeGuilds,
    eventTally,
  };

  const path = join(OUT_DIR, `${cfg.slug}.json`);
  writeFileSync(path, JSON.stringify(chronicleJson, null, 2) + "\n");

  const summary = `${arcsOut.length} arcs · ${chronicle.length} chronicled events · ${w.events.length} total events`;
  return { path, summary };
}

mkdirSync(OUT_DIR, { recursive: true });

// Manifest — the index of all chronicles the wiki can browse.
const manifest: {
  chronicles: {
    slug: string;
    label: string;
    labelSv: string;
    subtitle: string;
    subtitleSv: string;
    seed: number;
    world: string;
    years: number;
    magic: boolean;
    catastrophes: boolean;
    prehistorySpan: number;
  }[];
} = { chronicles: [] };

for (const cfg of CHRONICLES) {
  const { path, summary } = runOne(cfg);
  manifest.chronicles.push({
    slug: cfg.slug,
    label: cfg.label,
    labelSv: cfg.labelSv,
    subtitle: cfg.subtitle,
    subtitleSv: cfg.subtitleSv,
    seed: cfg.seed,
    world: cfg.worldName,
    years: cfg.years,
    magic: cfg.magic,
    catastrophes: cfg.catastrophes,
    prehistorySpan: cfg.prehistorySpan,
  });
  console.log(`Wrote ${path}: ${summary}`);
}

const manifestPath = join(OUT_DIR, "index.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${manifestPath}: ${manifest.chronicles.length} chronicles`);
