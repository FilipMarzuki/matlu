// arcs.ts — group the flat significant-event log into STORY ARCS (threads).
//
// The sifter answers "which events matter?"; the arc extractor answers "which
// events belong to the same STORY?" An arc is a connected thread of significant
// events that share a focus — a contested title (a multi-generation claim war),
// a pair of people (a feud), a house (its rise or fall), or a single figure (a
// saga). Arcs are the natural unit to persist as "a story" and, later, to hand
// the LLM ("render THIS thread as a chapter") instead of a flat list.
//
// Derived, never canonical: arcs are recomputed from the event log, exactly like
// the chronicle. Nothing here invents facts.

import type { WorldEvent } from "./types.js";
import type { World } from "./world.js";

export type ArcKind = "title" | "feud" | "dynasty" | "figure" | "calamity" | "culture";

export interface Arc {
  id: string;
  title: string; // human-readable label
  kind: ArcKind;
  startYear: number;
  endYear: number;
  eventIds: number[];
  significance: number; // sum of member-event significance
}

// Events more than this many years apart on the same focus are treated as
// separate arcs (the "wars of the 1050s" vs the "wars of the 1180s"), so a
// single long-lived title doesn't collapse into one 200-year blob.
const GAP_YEARS = 40;

export function extractArcs(w: World, chronicle: WorldEvent[]): Arc[] {
  // 1. Assign each significant event a focus key + kind.
  const buckets = new Map<string, { kind: ArcKind; events: WorldEvent[] }>();
  const put = (key: string, kind: ArcKind, ev: WorldEvent) => {
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { kind, events: [] }));
    b.events.push(ev);
  };

  for (const ev of chronicle) {
    const f = focusOf(ev);
    if (f) put(f.key, f.kind, ev);
  }

  // 2. Within each focus, split into arcs on long gaps; build the Arc objects.
  const arcs: Arc[] = [];
  for (const [, b] of buckets) {
    const sorted = [...b.events].sort((a, c) => a.year - c.year || a.id - c.id);
    let run: WorldEvent[] = [];
    const flush = () => {
      if (run.length === 0) return;
      // Keep threads, or singletons that are individually momentous (a fall, a
      // lost art). Skip lone minor events — they're already in the chronicle.
      const sig = run.reduce((s, e) => s + e.significance, 0);
      if (run.length >= 2 || sig >= 9) {
        arcs.push(buildArc(w, b.kind, run));
      }
      run = [];
    };
    for (const ev of sorted) {
      if (run.length > 0 && ev.year - run[run.length - 1].year > GAP_YEARS) flush();
      run.push(ev);
    }
    flush();
  }

  // 3. Biggest stories first.
  arcs.sort((a, c) => c.significance - a.significance || a.startYear - c.startYear);
  return arcs;
}

// What story does this event belong to?
function focusOf(ev: WorldEvent): { key: string; kind: ArcKind } | null {
  switch (ev.type) {
    case "WAR":
    case "SUCCESSION":
    case "SUCCESSION_CRISIS":
    case "USURP":
    case "REFORM":
    case "LOWBORN_RISE":
      return ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null;
    case "MURDER":
    case "SCHEME_DISCOVERED":
    case "GRUDGE_FORMED":
      if (ev.actorId && ev.targetId) {
        const pair = [ev.actorId, ev.targetId].sort().join("~");
        return { key: `F:${pair}`, kind: "feud" };
      }
      return ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null;
    case "DYNASTY_EXTINCT":
    case "ART_LOST":
      return { key: `D:${ev.data["house"] ?? "?"}`, kind: "dynasty" };
    case "HERO_RISEN":
    case "LEVELED":
    case "HEIR_TEMPERED":
      return ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null;
    case "MADNESS_ONSET":
      return ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null;
    // Emergent hero events cluster under the figure they name — the
    // hallmark event of a saga arc.
    case "ARCHMAGE_EMERGES":
    case "DARK_PROPHET_RISES":
    case "WARLORD_ASCENDANT":
    case "LONE_GENIUS_EMERGES":
    case "PARIAH_TURNS_CHAMPION":
    case "FALLEN_NOBLE_RISES":
    case "LOST_CLASS_RESURFACES":
    case "LEGENDARY_SKILL_MANIFESTS":
      return ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null;
    // Rite events cluster under the losing house — the tragedy of a lineage.
    case "ART_REDISCOVERED":
    case "CLASS_LINEAGE_BROKEN":
    case "RITE_STOLEN":
      return { key: `D:${ev.data["house"] ?? ev.data["fromHouse"] ?? "?"}`, kind: "dynasty" };
    case "FORBIDDEN_ART_PRACTICED":
      return ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null;
    // Trade & class-composition events — group by province.
    case "TRADE_ROUTE_ESTABLISHED":
    case "TRADE_ROUTE_DISRUPTED":
    case "TRIBUTE_IMPOSED":
    case "TRIBUTE_REVOKED":
    case "VASSAL_REBELS":
    case "MARKET_MONOPOLY":
    case "SCHOLAR_FLOURISH":
    case "LIBRARY_FOUNDED":
    case "LIBRARY_BURNED":
    case "MARTIAL_DECADENCE":
    case "MERCANTILE_ASCENDANT":
    case "KNOWLEDGE_LOST":
      return ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null;
    // Challenge events: SPAWNED/SLAYS-CHALLENGER cluster under the province
    // (the challenge is a persistent feature of the place). ATTEMPTED /
    // VANQUISHED / SKILL / CLASS cluster under the challenger — it's their story.
    case "CHALLENGE_SPAWNED":
      return ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null;
    case "CHALLENGE_SLAYS_CHALLENGER":
      return ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null;
    case "CHALLENGE_ATTEMPTED":
    case "CHALLENGE_VANQUISHED":
    case "SKILL_LEARNED_FROM_TRIAL":
    case "CLASS_UNLOCKED_BY_TRIAL":
      return ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null;
    // Fate / doom / legend events cluster under the target — the doomed
    // character IS the story arc, not the prophet or the curser.
    case "PROPHECY_UTTERED":
    case "PROPHECY_FULFILLED":
    case "PROPHECY_DEFIED":
    case "DOOM_LAID":
    case "DOOM_FULFILLED":
      return ev.targetId ? { key: `P:${ev.targetId}`, kind: "figure" } : null;
    case "LEGEND_INSCRIBED":
      return ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null;
    case "LEGEND_INVOKED":
      // Invocations cluster under the INVOKER, not the old legend — they're
      // the current character's psyche moment.
      return ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null;
    case "PLAGUE":
    case "FAMINE":
    case "BLIGHT_SPREADS":
    case "BLIGHT_DEEPENS":
    case "BLIGHT_LOCKED":
    case "PORTAL_OPENS":
    case "MASS_DEATH":
    case "DEAD_ZONE_FORMS":
    case "UNDEAD_RAID":
    case "RITUAL_GONE_WRONG":
    case "MANA_RUPTURE":
    case "CORRUPTION_SPREADS":
    case "DELVED_TOO_DEEP":
      return ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null;
    case "ERUPTION":
      return ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null;
    case "ASH_SUMMER":
    case "DROUGHT":
    case "LOCUST_SWARM": {
      // Group all events from a regional/global disaster under the source province arc.
      const src = String(ev.data["sourceProvinceId"] ?? ev.provinceId ?? "");
      return src ? { key: `E:${src}`, kind: "calamity" } : null;
    }
    case "TRUCE_BROKEN":
    case "ALLIANCE_BETRAYED":
      if (ev.actorId && ev.targetId) {
        const pair = [ev.actorId, ev.targetId].sort().join("~");
        return { key: `F:${pair}`, kind: "feud" };
      }
      return null;
    case "CULTURAL_RIFT":
    case "CULTURAL_SHIFT": {
      const cname = String(ev.data["culture"] ?? "");
      return cname ? { key: `C:${cname}`, kind: "culture" } : null;
    }
    default:
      return null; // births, marriages, harvest failures, minor cultural contests — not arc spines
  }
}

function buildArc(w: World, kind: ArcKind, events: WorldEvent[]): Arc {
  const startYear = events[0].year;
  const endYear = events[events.length - 1].year;
  const significance = events.reduce((s, e) => s + e.significance, 0);
  return {
    id: `arc-${kind}-${events[0].id}`,
    title: nameArc(w, kind, events),
    kind,
    startYear,
    endYear,
    eventIds: events.map((e) => e.id),
    significance,
  };
}

// Heuristic, evocative titles. The aim is a chapter heading a reader would
// recognise, drawn entirely from what's in the events.
function nameArc(w: World, kind: ArcKind, events: WorldEvent[]): string {
  const span = `${events[0].year}–${events[events.length - 1].year}`;
  const has = (t: string) => events.some((e) => e.type === t);

  switch (kind) {
    case "title": {
      const title = w.title(events[0].titleId)?.name ?? "a contested seat";
      if (has("WAR")) return `The Wars for ${title} (${span})`;
      if (has("SUCCESSION_CRISIS") || has("USURP")) return `The Disputed ${title} (${span})`;
      return `The Lords of ${title} (${span})`;
    }
    case "feud": {
      const a = events.find((e) => e.actorId)?.actorId ?? null;
      const b = events.find((e) => e.targetId)?.targetId ?? null;
      return `The Feud of ${shortName(w, a)} and ${shortName(w, b)} (${span})`;
    }
    case "dynasty": {
      const house = events[0].data["house"] ?? events[0].data["fromHouse"] ?? "?";
      if (has("RITE_STOLEN"))         return `The Stolen Rite of House ${house} (${span})`;
      if (has("ART_REDISCOVERED"))    return `The Reclamation of House ${house} (${span})`;
      if (has("CLASS_LINEAGE_BROKEN")) return `The Broken Lineage of House ${house} (${span})`;
      if (has("ART_LOST")) return `The Lost Art of House ${house} (${span})`;
      return `The Fall of House ${house} (${span})`;
    }
    case "figure": {
      const who = events.find((e) => e.actorId)?.actorId ?? null;
      if (has("PROPHECY_FULFILLED"))       return `The Fulfilled Doom of ${shortName(w, who)} (${span})`;
      if (has("PROPHECY_DEFIED"))          return `The Defied Prophecy of ${shortName(w, who)} (${span})`;
      if (has("DOOM_FULFILLED"))           return `The Answered Doom of ${shortName(w, who)} (${span})`;
      if (has("PROPHECY_UTTERED"))         return `The Prophecy Over ${shortName(w, who)} (${span})`;
      if (has("DOOM_LAID"))                return `The Doom Laid on ${shortName(w, who)} (${span})`;
      if (has("LEGEND_INSCRIBED"))         return `The Legend of ${shortName(w, who)} (${span})`;
      if (has("CHALLENGE_VANQUISHED"))     return `The Trials of ${shortName(w, who)} (${span})`;
      if (has("SKILL_LEARNED_FROM_TRIAL")) return `The Testing of ${shortName(w, who)} (${span})`;
      if (has("CLASS_UNLOCKED_BY_TRIAL"))  return `The Awakening of ${shortName(w, who)} (${span})`;
      if (has("ARCHMAGE_EMERGES"))         return `The Ascendancy of ${shortName(w, who)} (${span})`;
      if (has("LEGENDARY_SKILL_MANIFESTS")) return `The Legend of ${shortName(w, who)} (${span})`;
      if (has("DARK_PROPHET_RISES"))       return `The Prophet ${shortName(w, who)} (${span})`;
      if (has("WARLORD_ASCENDANT"))        return `The Wars of Warlord ${shortName(w, who)} (${span})`;
      if (has("LONE_GENIUS_EMERGES"))      return `The Solitary Genius ${shortName(w, who)} (${span})`;
      if (has("PARIAH_TURNS_CHAMPION"))    return `The Vindication of ${shortName(w, who)} (${span})`;
      if (has("FALLEN_NOBLE_RISES"))       return `The Return of ${shortName(w, who)} (${span})`;
      if (has("LOST_CLASS_RESURFACES"))    return `The Reawakening of ${shortName(w, who)} (${span})`;
      if (has("HERO_RISEN"))    return `The Rise of ${shortName(w, who)} (${span})`;
      if (has("MADNESS_ONSET")) return `The Madness of ${shortName(w, who)} (${span})`;
      return `The Saga of ${shortName(w, who)} (${span})`;
    }
    case "calamity": {
      const prov = w.province(events[0].provinceId ?? "")?.name ?? "the land";
      if (has("DEAD_ZONE_FORMS")) return `The Dead Zone of ${prov} (${span})`;
      if (has("DELVED_TOO_DEEP")) return `The Breach of ${prov} (${span})`;
      if (has("MANA_RUPTURE"))    return `The Void-Scar of ${prov} (${span})`;
      if (has("BLIGHT_LOCKED"))   return `The Withering of ${prov} (${span})`;
      if (has("UNDEAD_RAID"))     return `The Raids from ${prov} (${span})`;
      if (has("ERUPTION") || has("ASH_SUMMER")) return `The Ashen Years of ${prov} (${span})`;
      if (has("DROUGHT"))                        return `The Great Drought of ${prov} (${span})`;
      if (has("LOCUST_SWARM"))                   return `The Locust Plague of ${prov} (${span})`;
      if (has("LIBRARY_BURNED"))                 return `The Burning of the Library of ${prov} (${span})`;
      if (has("VASSAL_REBELS"))                  return `The Revolt of ${prov} (${span})`;
      if (has("MARKET_MONOPOLY"))                return `The Great Market of ${prov} (${span})`;
      if (has("MERCANTILE_ASCENDANT"))           return `The Merchants' ${prov} (${span})`;
      if (has("MARTIAL_DECADENCE"))              return `The Softening of ${prov} (${span})`;
      if (has("LIBRARY_FOUNDED") || has("SCHOLAR_FLOURISH")) return `The Learning of ${prov} (${span})`;
      if (has("KNOWLEDGE_LOST"))                 return `The Silence of ${prov} (${span})`;
      if (has("TRIBUTE_IMPOSED") || has("TRIBUTE_REVOKED")) return `The Tributes of ${prov} (${span})`;
      if (has("TRADE_ROUTE_ESTABLISHED") || has("TRADE_ROUTE_DISRUPTED")) return `The Trade of ${prov} (${span})`;
      return `The Calamities of ${prov} (${span})`;
    }
    case "culture": {
      const cname = String(events[0].data["culture"] ?? "the people");
      if (has("CULTURAL_RIFT")) return `The Rift of ${cname} (${span})`;
      return `The Transformation of ${cname} (${span})`;
    }
  }
}

function shortName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}
