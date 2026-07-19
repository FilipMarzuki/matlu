// wiki/src/lib/chronicles.ts — helper for loading chronicle JSON at build.
//
// The 3 chronicles live in wiki/src/data/chronicles/<slug>.json. Each carries
// the same shape (produced by scripts/generate-story-chronicles.ts). This file
// centralises the loading so pages don't need to duplicate the type dance.

import theFrontier from '../data/chronicles/the-frontier.json';
import theLongShadow from '../data/chronicles/the-long-shadow.json';
import theMundaneFrontier from '../data/chronicles/the-mundane-frontier.json';

export interface ChronicleKingdom { name: string; seat: string; holder: string | null }
export interface ChronicleHouse {
  name: string;
  foundedYear: number;
  members: number;
  specialization: string | null;
  specializationDepth: number;
}
export interface ChronicleArcEvent { year: number; type: string; text: string }
export interface ChronicleArc {
  id: string;
  title: string;
  kind: string;
  startYear: number;
  endYear: number;
  eventCount: number;
  significance: number;
  events: ChronicleArcEvent[];
}
export interface ChronicleTradeRoute {
  from: string;
  to: string;
  conduit: string;
  foundedYear: number;
  wealth: number;
  peakWealth: number;
}
export interface ChronicleAcademy {
  name: string;
  province: string;
  foundedYear: number;
  prestige: number;
  peakPrestige: number;
  scholars: number;
}
export interface ChronicleGuild {
  name: string;
  craft: string;
  foundedYear: number;
  members: number;
}
export interface ChronicleDeity {
  name: string;
  domain: string;
  tier: string;
  mood: string;
  power: number;
  peakPower: number;
}
export interface ChronicleLanguage {
  name: string;
  driftScore: number;
  writtenCorpus: number;
  linguaFrancaRoutes: number;
  speakerCultures: number;
}
export interface ChronicleDisease {
  name: string;
  family: string;
  category: string;
  emergedYear: number;
  burnedOutYear: number | null;
  strikeCount: number;
  totalDeaths: number;
}
export interface Chronicle {
  meta: {
    generatedAt: string;
    slug: string;
    label: string;
    labelSv: string;
    subtitle: string;
    subtitleSv: string;
    seed: number;
    world: string;
    years: number;
    prehistorySpan: number;
    magic: boolean;
    catastrophes: boolean;
    threshold: number;
    startYear: number;
    endYear: number;
    totalEvents: number;
    chronicledEvents: number;
  };
  climate: { phase: string; severity: number; phaseStartYear: number; phaseDurationYears: number };
  kingdoms: ChronicleKingdom[];
  survivingHouses: ChronicleHouse[];
  livingDeities: ChronicleDeity[];
  livingLanguages: ChronicleLanguage[];
  notableDiseases: ChronicleDisease[];
  arcs: ChronicleArc[];
  tradeRoutes: ChronicleTradeRoute[];
  academies: ChronicleAcademy[];
  guilds: ChronicleGuild[];
  eventTally: { type: string; count: number }[];
}

// Static import table — Astro can only tree-shake JSON that's imported by
// name, so we can't dynamically new-Function it at build time. Each slug maps
// to the imported blob.
const CHRONICLES: Record<string, unknown> = {
  'the-frontier':          theFrontier,
  'the-long-shadow':       theLongShadow,
  'the-mundane-frontier':  theMundaneFrontier,
};

// Full chronicle for the detail page.
export function loadChronicle(slug: string): Chronicle | null {
  const c = CHRONICLES[slug];
  return c ? (c as unknown as Chronicle) : null;
}

// Compact meta for the index cards — just the counts.
export function loadChronicleMeta(slug: string): {
  arcs: number;
  houses: number;
  kingdoms: number;
  tradeRoutes: number;
  diseases: number;
  deities: number;
  languages: number;
  startYear: number;
  endYear: number;
  chronicledEvents: number;
} {
  const c = loadChronicle(slug);
  if (!c) {
    return { arcs: 0, houses: 0, kingdoms: 0, tradeRoutes: 0, diseases: 0, deities: 0, languages: 0, startYear: 0, endYear: 0, chronicledEvents: 0 };
  }
  return {
    arcs: c.arcs.length,
    houses: c.survivingHouses.length,
    kingdoms: c.kingdoms.length,
    tradeRoutes: c.tradeRoutes.length,
    diseases: c.notableDiseases.length,
    deities: c.livingDeities.length,
    languages: c.livingLanguages.length,
    startYear: c.meta.startYear,
    endYear: c.meta.endYear,
    chronicledEvents: c.meta.chronicledEvents,
  };
}

export function allChronicleSlugs(): string[] {
  return Object.keys(CHRONICLES);
}
