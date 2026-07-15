// sifter.ts — story sifting (after Ryan / Kreminski): the log is full of facts;
// most are noise. The sifter scores every event for dramatic significance and
// also recognises multi-event SHAPES — revenge fulfilled, a throne taken by
// murder, a house extinguished — that no single event reveals on its own.
//
// Output: every event gets a `significance`, interesting ones get `data` tags
// the renderer can lean on, and the chronicle is the events above a threshold.
// This is where "which of the thousand things that happened are worth telling"
// lives — deliberately separate from rendering, so judgment and prose decouple.

import { SPEC_REGISTRY } from "./event-spec.js";
import type { CharId, EventType, WorldEvent } from "./types.js";
import type { World } from "./world.js";

// ---------------------------------------------------------------------------
// Frame-relative focus — the spatial/relational axis of LOD.
// When a focus is set, events are re-scored relative to how close they are to
// the chosen entity, so the same history reads differently from each perspective.
// ---------------------------------------------------------------------------
export type FocusScale = "individual" | "dynasty" | "province" | "realm";

export interface FocusContext {
  scale: FocusScale;
  id: string; // CharId | DynastyId | ProvinceId | TitleId depending on scale
  label: string; // human-readable, e.g. "House Aeryn (dynasty)"
}

type ProximityTier = "SPOTLIGHT" | "NAMED" | "ABSTRACT" | "STATISTICAL";

// Additive bonuses applied on top of the global significance pass.
const PROXIMITY_BONUS: Record<ProximityTier, number> = {
  SPOTLIGHT: 8,   // directly involves the focus — always chronicle-worthy
  NAMED: 4,       // close relation (family / ally / neighbor)
  ABSTRACT: 0,    // same theater, no change
  STATISTICAL: -4, // unrelated background — suppresses below threshold
};

function proximity(ev: WorldEvent, w: World, focus: FocusContext): ProximityTier {
  const { scale, id } = focus;

  switch (scale) {
    case "individual": {
      const c = w.char(id);
      if (!c) return "STATISTICAL";
      if (ev.actorId === id || ev.targetId === id) return "SPOTLIGHT";
      const dynId = c.dynastyId;
      const isDynMate = (cid: string | null) => !!w.char(cid) && w.char(cid)!.dynastyId === dynId;
      if (isDynMate(ev.actorId) || isDynMate(ev.targetId)) return "NAMED";
      if (ev.actorId === c.spouseId || ev.targetId === c.spouseId) return "NAMED";
      if (ev.actorId === c.fatherId || ev.targetId === c.fatherId) return "NAMED";
      if (ev.actorId === c.motherId || ev.targetId === c.motherId) return "NAMED";
      if (c.childrenIds.includes(ev.actorId ?? "") || c.childrenIds.includes(ev.targetId ?? "")) return "NAMED";
      const evTitle = w.title(ev.titleId);
      if (evTitle && evTitle.holderId === id) return "NAMED";
      const kingdomId = seatKingdom(w, id);
      if (kingdomId) {
        if (seatKingdom(w, ev.actorId) === kingdomId || seatKingdom(w, ev.targetId) === kingdomId)
          return "ABSTRACT";
      }
      return "STATISTICAL";
    }

    case "dynasty": {
      const members = w.dynastyMembers(id);
      const memberSet = new Set(members.map((m) => m.id));
      const isDynMember = (cid: string | null): boolean => !!cid && memberSet.has(cid);
      if (isDynMember(ev.actorId) || isDynMember(ev.targetId)) return "SPOTLIGHT";
      const evTitle = w.title(ev.titleId);
      if (evTitle && isDynMember(evTitle.holderId)) return "SPOTLIGHT";
      // NAMED: the other party has an active treaty with any dynasty member.
      const hasTreatyWithDyn = (cid: string | null): boolean => {
        if (!cid) return false;
        return w.treaties.some(
          (t) =>
            (t.partyA === cid && memberSet.has(t.partyB)) ||
            (t.partyB === cid && memberSet.has(t.partyA)),
        );
      };
      if (hasTreatyWithDyn(ev.actorId) || hasTreatyWithDyn(ev.targetId)) return "NAMED";
      const dynSeatKingdom = members.length ? seatKingdom(w, members[0].id) : null;
      if (dynSeatKingdom) {
        if (
          seatKingdom(w, ev.actorId) === dynSeatKingdom ||
          seatKingdom(w, ev.targetId) === dynSeatKingdom
        )
          return "ABSTRACT";
      }
      return "STATISTICAL";
    }

    case "province": {
      const prov = w.province(id);
      if (!prov) return "STATISTICAL";
      const provTitle = w.title(prov.titleId);
      if (ev.provinceId === id) return "SPOTLIGHT";
      if (ev.titleId === prov.titleId) return "SPOTLIGHT";
      if (provTitle && (ev.actorId === provTitle.holderId || ev.targetId === provTitle.holderId))
        return "SPOTLIGHT";
      if (ev.provinceId && prov.neighbors.includes(ev.provinceId)) return "NAMED";
      const provKingdom = provTitle ? liegeKingdom(w, provTitle.id) : null;
      if (provKingdom) {
        if (seatKingdom(w, ev.actorId) === provKingdom || seatKingdom(w, ev.targetId) === provKingdom)
          return "ABSTRACT";
      }
      return "STATISTICAL";
    }

    case "realm": {
      const kingdom = w.title(id);
      if (!kingdom) return "STATISTICAL";
      if (ev.titleId === id) return "SPOTLIGHT";
      const holdsKingdomOrVassal = (cid: string | null): boolean => {
        if (!cid) return false;
        return w.titlesHeldBy(cid).some((t) => t.id === id || t.liegeId === id);
      };
      if (holdsKingdomOrVassal(ev.actorId) || holdsKingdomOrVassal(ev.targetId)) return "SPOTLIGHT";
      // NAMED: any character holding a title whose liegeId chain reaches this kingdom.
      const isVassal = (cid: string | null): boolean => {
        if (!cid) return false;
        return w.titlesHeldBy(cid).some((t) => liegeKingdom(w, t.id) === id);
      };
      if (isVassal(ev.actorId) || isVassal(ev.targetId)) return "NAMED";
      // ABSTRACT: kingdoms that share a province-neighbor.
      const kingdomProv = w.province(kingdom.provinceId);
      if (kingdomProv) {
        const neighborKingdoms = new Set(
          kingdomProv.neighbors
            .map((nid) => w.province(nid))
            .filter(Boolean)
            .map((np) => liegeKingdom(w, np!.titleId))
            .filter((k): k is string => k !== null),
        );
        const ak = seatKingdom(w, ev.actorId);
        const tk = seatKingdom(w, ev.targetId);
        if ((ak && neighborKingdoms.has(ak)) || (tk && neighborKingdoms.has(tk)))
          return "ABSTRACT";
      }
      return "STATISTICAL";
    }
  }
}

// Walk liegeId chain to the top-level kingdom title for a given title.
function liegeKingdom(w: World, titleId: string | null): string | null {
  let t = w.title(titleId);
  while (t) {
    if (t.tier === "kingdom") return t.id;
    t = w.title(t.liegeId);
  }
  return null;
}

// The kingdom a character is seated in (via their held titles or province).
function seatKingdom(w: World, charId: string | null): string | null {
  if (!charId) return null;
  for (const t of w.titlesHeldBy(charId)) {
    const k = liegeKingdom(w, t.id);
    if (k) return k;
  }
  const c = w.char(charId);
  if (c) {
    const prov = w.province(c.provinceId);
    if (prov) return liegeKingdom(w, prov.titleId);
  }
  return null;
}

// Baseline drama by type before context adjustments. Partial because events
// registered via the EventSpec catalog (event-spec.ts) get their base score
// from the spec instead — they don't need a BASE entry here.
const BASE: Partial<Record<EventType, number>> = {
  BIRTH: 1,
  DEATH: 2,
  MARRIAGE: 2,
  SUCCESSION: 4,
  SUCCESSION_CRISIS: 8,
  WAR: 6,
  SCHEME_HATCHED: 1, // mostly invisible until it resolves
  SCHEME_DISCOVERED: 6,
  MURDER: 8,
  USURP: 7,
  REFORM: 6,
  FAMINE: 5,
  PLAGUE: 7,
  HARVEST_FAILURE: 1,
  DYNASTY_EXTINCT: 9,
  LOWBORN_RISE: 8,
  GRUDGE_FORMED: 1,
  LEGEND: 10, // mythic-past events are, by definition, the memorable ones
  // Magic / leveling layer.
  CLASS_GAINED: 2, // routine generational handover of a rite — logged, rarely chronicled
  LEVELED: 4, // milestone (12+) — bumped by how high in the per-event pass
  HEIR_TEMPERED: 2, // a house forged its heir; bumped if it reached the heroic tier
  ART_LOST: 9, // an art lost to history
  HERO_RISEN: 8, // a low-born breakthrough
  // World catastrophe layer.
  BLIGHT_SPREADS: 6,
  BLIGHT_DEEPENS: 8,
  BLIGHT_LOCKED: 10,
  PORTAL_OPENS: 9,
  MASS_DEATH: 10,
  DEAD_ZONE_FORMS: 10,
  UNDEAD_RAID: 6,
  RITUAL_GONE_WRONG: 7,
  MANA_RUPTURE: 8,
  CORRUPTION_SPREADS: 7,
  // Underground / dwarf layer.
  DELVED_TOO_DEEP: 10,
  // Perception / madness layer.
  MADNESS_ONSET: 7, // a named character breaks from reality — high drama
  // Diplomacy layer.
  TRUCE: 2,            // routine post-war ceasefire — background, not foreground
  ALLIANCE_FORMED: 3,  // pacts form quietly; usually only notable when the alliance is tested
  TRUCE_BROKEN: 7,     // breaking sworn peace is a character moment
  ALLIANCE_BETRAYED: 9, // attacking your own ally is close to kinslaying in shock value
  // Cultural evolution layer.
  CULTURAL_CONTESTED: 3, // a trait crossed the pressure threshold — contest begins
  CULTURAL_RIFT: 8,      // elite and folk hold opposed traits — fracture visible
  CULTURAL_SHIFT: 6,     // a trait established/abandoned in a tier, or aesthetic drift
  // Natural disaster layer.
  ERUPTION:     10,
  ASH_SUMMER:    4,  // fires globally (many events); low per-event, high in aggregate
  DROUGHT:       6,
  LOCUST_SWARM:  5,
  // Emergent hero / faction layer.
  ARCHMAGE_EMERGES:       9,
  DARK_PROPHET_RISES:     8,
  WARLORD_ASCENDANT:      7,
  LONE_GENIUS_EMERGES:    7,
  PARIAH_TURNS_CHAMPION:  8,
  FALLEN_NOBLE_RISES:     7,
  // Class / art layer.
  ART_REDISCOVERED:        9,
  LOST_CLASS_RESURFACES:   8,
  FORBIDDEN_ART_PRACTICED: 8,
  LEGENDARY_SKILL_MANIFESTS: 10,
  CLASS_LINEAGE_BROKEN:    7,
  RITE_STOLEN:             9,
  // Trade & asymmetric relations layer.
  TRADE_ROUTE_ESTABLISHED: 3, // background — becomes interesting in aggregate
  TRADE_ROUTE_DISRUPTED:   5,
  TRIBUTE_IMPOSED:         6,
  TRIBUTE_REVOKED:         6,
  VASSAL_REBELS:           8,
  MARKET_MONOPOLY:         7,
  // Class-composition driven layer.
  SCHOLAR_FLOURISH:        5,
  LIBRARY_FOUNDED:         7,
  LIBRARY_BURNED:          9,
  MARTIAL_DECADENCE:       6,
  MERCANTILE_ASCENDANT:    6,
  KNOWLEDGE_LOST:          7,
  // Challenges layer — trial-driven growth.
  CHALLENGE_SPAWNED:            5,  // background — worth telling once, not narrated forever
  CHALLENGE_ATTEMPTED:          4,
  CHALLENGE_VANQUISHED:         9,  // hero moment
  CHALLENGE_SLAYS_CHALLENGER:   7,  // the challenge stands, and someone brave is dead
  SKILL_LEARNED_FROM_TRIAL:     8,
  CLASS_UNLOCKED_BY_TRIAL:      8,
  // Fate / doom / legend layer — the events that make a chronicle epic.
  PROPHECY_UTTERED:             7,  // a prophet speaks: a hinge for the reader
  PROPHECY_FULFILLED:           10, // dramatic irony: the darkest peak
  PROPHECY_DEFIED:              8,  // subverting the prophet is also great story
  DOOM_LAID:                    7,
  DOOM_FULFILLED:               10,
  LEGEND_INSCRIBED:             9,  // a figure passes into cultural memory
  LEGEND_INVOKED:               6,  // a later character calls the old name
};

export interface SiftResult {
  chronicle: WorldEvent[]; // events worth telling, chronological
}

export function sift(w: World, threshold = 4, focus?: FocusContext): SiftResult {
  // Pre-index relationships the per-event pass needs to recognise shapes.
  const ruledTitle = new Set<CharId>(); // characters who ever held a throne
  const wasRulerAtDeath = new Set<CharId>(); // died holding a title
  for (const ev of w.events) {
    if (ev.type === "SUCCESSION") {
      if (ev.actorId) ruledTitle.add(ev.actorId);
      if (ev.targetId) wasRulerAtDeath.add(ev.targetId); // the predecessor
    }
    if (ev.type === "SUCCESSION_CRISIS" && ev.targetId) wasRulerAtDeath.add(ev.targetId);
    if (ev.type === "LOWBORN_RISE" && ev.actorId) ruledTitle.add(ev.actorId);
    if (ev.type === "WAR" && ev.data["attacker_won"] && ev.actorId) ruledTitle.add(ev.actorId);
  }

  for (const ev of w.events) {
    // EventSpec catalog takes precedence — new events register a base score
    // and optional scoreBoost via SPEC_REGISTRY. Hand-written events fall
    // through to the BASE table + switch below unchanged.
    const spec = SPEC_REGISTRY.get(ev.type);
    let s: number = spec ? spec.base + (spec.scoreBoost?.(ev, w) ?? 0) : (BASE[ev.type] ?? 0);
    const tags: string[] = [];

    switch (ev.type) {
      case "DEATH": {
        const cause = String(ev.data["cause"] ?? "");
        // Deaths by murder or in battle are already told, with more colour, by
        // the MURDER / WAR events themselves — suppress the bare death notice so
        // the chronicle doesn't report the same corpse twice.
        if (cause === "murder" || cause === "killed in war") {
          s = -100;
          break;
        }
        // A commoner's death is noise; a ruler's death moves history.
        if (ev.actorId && wasRulerAtDeath.has(ev.actorId)) {
          s += 5;
          tags.push("ruler");
        }
        break;
      }
      case "MURDER": {
        const killer = w.char(ev.actorId);
        const victim = w.char(ev.targetId);
        // Kinslaying — murder within one's own house — is the darkest note.
        if (killer && victim && killer.dynastyId === victim.dynastyId) {
          s += 4;
          tags.push("kinslaying");
        }
        // Revenge fulfilled: the killer held a grudge against the victim.
        if (killer && killer.grudges.some((g) => g.targetId === ev.targetId)) {
          s += 3;
          tags.push("revenge");
        }
        // Did the murder clear a path to a throne? Look for a same-year or
        // next-year succession of the victim's title.
        if (ev.titleId) tags.push("for-the-throne");
        break;
      }
      case "SUCCESSION": {
        // A throne passing OUT of the late ruler's dynasty is a usurpation —
        // far more dramatic than an orderly father-to-son handover.
        if (ev.data["same_dynasty"] === false) {
          s += 4;
          tags.push("usurpation");
        }
        // A child ruler invites regency intrigue.
        const heirAge = Number(ev.data["heir_age"] ?? 99);
        if (heirAge < 12) {
          s += 2;
          tags.push("child-ruler");
        }
        // Kingdoms outrank counties in the telling.
        if (isKingTitle(w, ev.titleId)) s += 2;
        break;
      }
      case "SUCCESSION_CRISIS": {
        if (isKingTitle(w, ev.titleId)) s += 3;
        break;
      }
      case "WAR": {
        if (isKingTitle(w, ev.titleId)) s += 2;
        // An underdog victory (weaker power winning) is a better story.
        const ap = Number(ev.data["attacker_power"] ?? 0);
        const dp = Number(ev.data["defender_power"] ?? 0);
        if (ev.data["attacker_won"] && ap < dp) {
          s += 3;
          tags.push("underdog");
        }
        if (ev.data["vacant"]) tags.push("contested-throne");
        if (String(ev.data["casualty"] ?? "") !== "") s += 2;
        break;
      }
      case "PLAGUE": {
        const named = Number(ev.data["named_dead"] ?? 0);
        s += Math.min(4, named * 2); // a plague that takes the named is history
        if (named > 0) tags.push("named-dead");
        break;
      }
      case "SCHEME_DISCOVERED": {
        const n = Number(ev.data["conspirators"] ?? 0);
        s += Math.min(3, n); // a wide conspiracy unravelling is juicier
        break;
      }
      case "MARRIAGE": {
        // A marriage joining two ruling houses is a political event.
        const a = w.char(ev.actorId);
        const b = w.char(ev.targetId);
        if (a && b && ruledTitle.has(a.id) && ruledTitle.has(b.id)) {
          s += 3;
          tags.push("alliance");
        }
        break;
      }
      case "LEVELED": {
        // Logged only at milestones above the plateau (12+), so every LEVELED
        // event is already noteworthy; the higher the tier, the bigger the news.
        const lvl = Number(ev.data["level"] ?? 0);
        if (lvl >= 30) s += 7;
        else if (lvl >= 20) s += 4;
        else if (lvl >= 16) s += 2;
        if (lvl >= 16) tags.push("titan");
        if (ev.data["ascendant"]) {
          s += 3; // a new mightiest-of-the-age is always worth telling
          tags.push("ascendant");
        }
        break;
      }
      case "HEIR_TEMPERED": {
        const lvl = Number(ev.data["level"] ?? 0);
        s += lvl >= 16 ? 4 : lvl >= 14 ? 2 : 0; // forging a formidable heir is notable
        break;
      }
      case "HERO_RISEN":
        tags.push("breakout");
        break;
      case "CULTURAL_CONTESTED": {
        // Surface traits (mercantile, literacy_valued) enter contest quietly.
        const traitC = String(ev.data["trait"] ?? "");
        const coreTraits = new Set(["slavery", "warrior_culture", "zealous_faith", "caste_rigid"]);
        if (!coreTraits.has(traitC)) s = 1;
        break;
      }
      case "CULTURAL_RIFT":
        tags.push("cultural-fracture");
        break;
      case "CULTURAL_SHIFT": {
        // Aesthetic drift is a softer story beat; mechanical trait changes are
        // heavier, especially slavery (acquisition or abolition) and reversals.
        if (ev.data["trait"] === "aesthetic") s = 5;
        if (ev.data["trait"] === "slavery") s += 2;
        if (ev.data["adopted"] === false) s += 1; // abandonment is harder to tell
        if (ev.data["tier"] === "both") s += 1;   // cross-tier establishment
        break;
      }
      case "ASH_SUMMER": {
        // Wave 1 is the most dramatic — the skies darken for the first time.
        if (Number(ev.data["wave"] ?? 1) === 1) s += 2;
        break;
      }
      case "DROUGHT": {
        // First year of drought is the revelation; later years are grinding repetition.
        if (Number(ev.data["wave"] ?? 1) === 1) s += 2;
        break;
      }
      default:
        break;
    }

    if (tags.length) ev.data["_tags"] = tags.join(",");
    ev.significance = s;
  }

  // Frame-relative rescoring: if a focus is set, apply proximity bonuses so
  // events close to the focus surface and distant noise recedes.
  if (focus) {
    for (const ev of w.events) {
      const tier = proximity(ev, w, focus);
      ev.significance += PROXIMITY_BONUS[tier];
    }
  }

  const chronicle = w.events
    .filter((ev) => ev.significance >= threshold)
    .sort((a, b) => a.year - b.year || a.id - b.id);

  return { chronicle };
}

function isKingTitle(w: World, titleId: string | null): boolean {
  const t = w.title(titleId);
  return !!t && t.tier === "kingdom";
}
