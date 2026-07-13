// sifter.ts — story sifting (after Ryan / Kreminski): the log is full of facts;
// most are noise. The sifter scores every event for dramatic significance and
// also recognises multi-event SHAPES — revenge fulfilled, a throne taken by
// murder, a house extinguished — that no single event reveals on its own.
//
// Output: every event gets a `significance`, interesting ones get `data` tags
// the renderer can lean on, and the chronicle is the events above a threshold.
// This is where "which of the thousand things that happened are worth telling"
// lives — deliberately separate from rendering, so judgment and prose decouple.

import type { CharId, EventType, WorldEvent } from "./types.js";
import type { World } from "./world.js";

// Baseline drama by type before context adjustments.
const BASE: Record<EventType, number> = {
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
};

export interface SiftResult {
  chronicle: WorldEvent[]; // events worth telling, chronological
}

export function sift(w: World, threshold = 4): SiftResult {
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
    let s = BASE[ev.type];
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
      default:
        break;
    }

    if (tags.length) ev.data["_tags"] = tags.join(",");
    ev.significance = s;
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
