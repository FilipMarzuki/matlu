// specs/dynasty-specialization-events.ts — the house acquires an identity.
//
// Seven events for the "house of specialists" arc: HOUSE_SPECIALIZES marks
// the moment a dynasty crystallizes around a class (the House of the Hammer,
// the House of the Ledger); MASTER_LINEAGE_FORMS chronicles three generations
// of same-class masters; RARE_LINEAGE_EXPONENTIAL is the catastrophic
// three-necromancers moment. Plus persistent Guild founding + dissolution.
//
// The state-mutating events (HOUSE_SPECIALIZES, GUILD_FOUNDED) initialize
// dynasty/guild fields inside fire(). The others are chronicle-only, driven
// by state that innovation.ts maintains each tick.

import type { EventSpec } from "../event-spec.js";
import type { Character, CharClass, Dynasty, Guild, GuildCraft } from "../types.js";
import type { World } from "../world.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function charName(w: World, id: string | null): string {
  return w.char(id)?.name ?? "an unknown figure";
}

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the workshop";
}

// Human-readable class-noun for chronicle prose.
const CLASS_NOUN: Record<CharClass, string> = {
  commoner: "commoners",
  soldier: "soldiers",
  hunter: "hunters",
  knight: "knights",
  scholar: "scholars",
  merchant: "merchants",
  warden: "wardens",
  stormcaller: "stormcallers",
  necromancer: "necromancers",
};

// Human-readable class → guild-tradition flavor. Assigned at HOUSE_SPECIALIZES.
const TRADITION_TEMPLATES: Record<CharClass, string[]> = {
  commoner:    ["House of the Common Craft"],
  soldier:     ["House of the Standard", "The Ironblood Legion", "The Warhouse of the Grey"],
  hunter:      ["The Longhunt House", "House of the Snare", "The Wolfline"],
  knight:      ["The Silver Knights", "House of the Broken Lance", "The Sworn House"],
  scholar:     ["The Vellum House", "The Ink-and-Iron House", "House of the Star-Reader"],
  merchant:    ["The Golden Ledger", "House of the Weighed Scale", "The Amber Factors"],
  warden:      ["The Warden's Keep", "House of the Watchful Eye"],
  stormcaller: ["The Storm-House", "The Thunder-Line"],
  necromancer: ["The Grave House", "The Silent Line", "House of the Cold Lantern"],
};

// Rare classes get special treatment — smaller thresholds, more dramatic prose.
const RARE_CLASSES = new Set<CharClass>(["warden", "stormcaller", "necromancer"]);

// Map craftsman class → guild craft. Multiple classes can share a craft.
function craftForClass(cls: CharClass): GuildCraft | null {
  switch (cls) {
    case "merchant":    return "trade";
    case "scholar":     return "letters";
    case "soldier":     return "arms";
    case "knight":      return "arms";
    case "warden":      return "arcana";
    case "stormcaller": return "arcana";
    case "necromancer": return "arcana";
    default:            return null; // no guild for commoner/hunter
  }
}

// Generations = distinct ancestral chains. We approximate "three generations"
// as: a level-15+ master AT LEAST 3 hops up the family tree from another
// level-15+ master of the same class in the same dynasty.
function generationsDeepInClass(w: World, dyn: Dynasty, cls: CharClass): number {
  const masters = w.dynastyMastersOfClass(dyn.id, cls, 15);
  if (masters.length === 0) return 0;
  // For each master, count how many ancestors of theirs (via father chain)
  // were also level-15+ in this class. This is a rough proxy for lineage
  // depth.
  let maxDepth = 0;
  for (const m of masters) {
    let depth = 1;
    let cur: Character | undefined = m;
    let hops = 0;
    while (cur && hops < 8) {
      const parent = w.char(cur.fatherId);
      if (parent && parent.dynastyId === dyn.id
          && parent.charClass === cls && parent.level >= 15) depth++;
      cur = parent;
      hops++;
    }
    if (depth > maxDepth) maxDepth = depth;
  }
  return maxDepth;
}

// ---------------------------------------------------------------------------
// HOUSE_SPECIALIZES — a dynasty crystallises around a class. Fires once per
// dynasty per class-shift (when dominantClass becomes non-null and depth is
// high). Assigns guildTradition flavor string. Chronicle event, no direct
// mechanical effect (the mechanical effect flows from specializationDepth
// being non-zero, which is set by innovation.ts).
// ---------------------------------------------------------------------------
const HOUSE_SPECIALIZES: EventSpec = {
  type: "HOUSE_SPECIALIZES",
  base: 8,
  render: (ev) => {
    const houseName = String(ev.data["house"] ?? "the house");
    const tradition = String(ev.data["tradition"] ?? "");
    const cls = String(ev.data["class"] ?? "artisans");
    return `${houseName} became ${tradition ? `${tradition} — ` : ""}known thereafter as a house of ${cls}.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "dynasties",
    gate: (w, item) => {
      const dyn = item as Dynasty;
      if (dyn.extinctYear !== null) return false;
      if (dyn.guildTradition !== null) return false; // already specialized
      if (!dyn.dominantClass) return false;
      if (dyn.dominantClass === "commoner") return false;
      if (dyn.specializationDepth < 0.35) return false;
      // Require at least 2 level-10+ members of the dominant class.
      return w.dynastyMastersOfClass(dyn.id, dyn.dominantClass, 10).length >= 2;
    },
    prob: () => 0.5,
    fire: (w, item) => {
      const dyn = item as Dynasty;
      if (!dyn.dominantClass) return;
      const templates = TRADITION_TEMPLATES[dyn.dominantClass];
      const tradition = templates[w.rng.int(0, templates.length - 1)];
      dyn.guildTradition = tradition;
      const master = w.dynastyMastersOfClass(dyn.id, dyn.dominantClass, 10)[0];
      w.log("HOUSE_SPECIALIZES", {
        actorId: master?.id ?? null,
        provinceId: master?.provinceId ?? null,
        data: { house: dyn.name, tradition, class: CLASS_NOUN[dyn.dominantClass] },
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// MASTER_LINEAGE_FORMS — three generations of level-15+ same-class in same
// dynasty. Historical: Bernoulli mathematicians, Curie physicists, Bach
// musicians. Once per dynasty-class combination.
// ---------------------------------------------------------------------------
const MASTER_LINEAGE_FORMS: EventSpec = {
  type: "MASTER_LINEAGE_FORMS",
  base: 9,
  render: (ev) => {
    const houseName = String(ev.data["house"] ?? "the house");
    const cls = String(ev.data["class"] ?? "masters");
    return `${houseName} produced its third generation of master ${cls} — the lineage was now a byword for the craft.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "dynasties",
    gate: (w, item) => {
      const dyn = item as Dynasty;
      if (dyn.extinctYear !== null) return false;
      if (!dyn.dominantClass) return false;
      if (dyn.dominantClass === "commoner") return false;
      const depth = generationsDeepInClass(w, dyn, dyn.dominantClass);
      if (depth < 3) return false;
      // Once per dynasty. Won't refire even if lineage extends further.
      return !w.events.some(
        (e) => e.type === "MASTER_LINEAGE_FORMS" && e.data["dynasty"] === dyn.id,
      );
    },
    prob: () => 0.4,
    fire: (w, item) => {
      const dyn = item as Dynasty;
      if (!dyn.dominantClass) return;
      const master = w.dynastyMastersOfClass(dyn.id, dyn.dominantClass, 15)[0];
      w.log("MASTER_LINEAGE_FORMS", {
        actorId: master?.id ?? null,
        provinceId: master?.provinceId ?? null,
        data: { house: dyn.name, class: CLASS_NOUN[dyn.dominantClass], dynasty: dyn.id },
      });
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
// RARE_LINEAGE_EXPONENTIAL — 3+ rare-class bearers alive in the same dynasty.
// Because rare-class synergy is 0.6× per extra bearer, this house is now
// EXTREMELY dangerous. Chronicle event marking the moment other realms take
// notice.
// ---------------------------------------------------------------------------
const RARE_LINEAGE_EXPONENTIAL: EventSpec = {
  type: "RARE_LINEAGE_EXPONENTIAL",
  base: 10,
  render: (ev) => {
    const houseName = String(ev.data["house"] ?? "the house");
    const cls = String(ev.data["class"] ?? "arcanists");
    return `${houseName} bore three living masters of the ${cls} — the great realms whispered of intervention and dread.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "dynasties",
    gate: (w, item) => {
      const dyn = item as Dynasty;
      if (dyn.extinctYear !== null) return false;
      if (!dyn.rite) return false;
      const bearers = w.dynastyMastersOfClass(dyn.id, dyn.rite, 1);
      if (bearers.length < 3) return false;
      return !w.events.some(
        (e) => e.type === "RARE_LINEAGE_EXPONENTIAL" && e.data["dynasty"] === dyn.id,
      );
    },
    prob: () => 0.8,
    fire: (w, item) => {
      const dyn = item as Dynasty;
      if (!dyn.rite) return;
      const master = w.dynastyMastersOfClass(dyn.id, dyn.rite, 1)[0];
      w.log("RARE_LINEAGE_EXPONENTIAL", {
        actorId: master?.id ?? null,
        provinceId: master?.provinceId ?? null,
        data: { house: dyn.name, class: CLASS_NOUN[dyn.rite], dynasty: dyn.id },
      });
    },
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// HOUSE_LOSES_TRADITION — the specialized house's masters have died out
// without qualified successors. Decline event. Clears dominantClass and
// guildTradition. Only fires once per dynasty life-cycle.
// ---------------------------------------------------------------------------
const HOUSE_LOSES_TRADITION: EventSpec = {
  type: "HOUSE_LOSES_TRADITION",
  base: 8,
  render: (ev) => {
    const houseName = String(ev.data["house"] ?? "the house");
    const tradition = String(ev.data["tradition"] ?? "the tradition");
    return `${houseName} lost the tradition of ${tradition} — no living heir held the craft, and rivals bought up the workshops.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "dynasties",
    gate: (_w, item) => {
      const dyn = item as Dynasty;
      if (dyn.extinctYear !== null) return false;
      if (!dyn.guildTradition) return false;
      // The dominantClass has cleared (recomputeDynastySpecialization set it null),
      // but the tradition string is still there — that's the decline signal.
      return dyn.dominantClass === null;
    },
    prob: () => 0.6,
    fire: (w, item) => {
      const dyn = item as Dynasty;
      w.log("HOUSE_LOSES_TRADITION", {
        provinceId: null,
        data: { house: dyn.name, tradition: dyn.guildTradition ?? "the tradition", dynasty: dyn.id },
      });
      dyn.guildTradition = null; // reset — a diversified house can respecialize
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
// GUILD_FOUNDED — persistent guild entity is chartered. Fires when 2+ same-
// craft masters exist in a province with no active guild there. Creates the
// Guild in w.guilds and moves those masters into it as members.
// ---------------------------------------------------------------------------
const GUILD_FOUNDED: EventSpec = {
  type: "GUILD_FOUNDED",
  base: 8,
  render: (ev, w) => {
    const gname = String(ev.data["guild"] ?? "a guild");
    return `${gname} was chartered at ${provName(w, ev.provinceId)} — masters and journeymen swore the oath in one common hall.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as { id: string; population: number };
      if (p.population < 200) return false;
      // Any craft with 2+ level-8+ masters in this province, no active guild.
      for (const cls of ["merchant", "scholar", "soldier", "knight"] as CharClass[]) {
        const craft = craftForClass(cls);
        if (!craft) continue;
        if (w.guildAt(p.id, craft)) continue;
        const masters = w.living().filter(
          (c) => c.provinceId === p.id && c.charClass === cls && c.level >= 8,
        );
        if (masters.length >= 2) return true;
      }
      return false;
    },
    prob: () => 0.06,
    fire: (w, item) => {
      const p = item as { id: string; population: number };
      // Find the first craft that satisfies the gate again — deterministic.
      for (const cls of ["merchant", "scholar", "soldier", "knight"] as CharClass[]) {
        const craft = craftForClass(cls);
        if (!craft) continue;
        if (w.guildAt(p.id, craft)) continue;
        const masters = w.living().filter(
          (c) => c.provinceId === p.id && c.charClass === cls && c.level >= 8,
        );
        if (masters.length < 2) continue;
        const provinceName = w.province(p.id)?.name ?? "the province";
        const craftLabel = craft === "letters" ? "Scholars" : craft === "trade" ? "Merchants" : craft === "arms" ? "Blades" : "Craftsmen";
        const gname = `Guild of ${provinceName} ${craftLabel}`;
        const guildId = w.freshId("g");
        const master = masters.reduce((a, b) => (b.level > a.level ? b : a));
        const guild: Guild = {
          id: guildId,
          name: gname,
          craft,
          provinceId: p.id,
          foundedYear: w.year,
          disbandedYear: null,
          masterId: master.id,
          memberIds: masters.map((m) => m.id),
          wealth: 0,
          monopolyInventionId: null,
        };
        w.guilds.set(guildId, guild);
        for (const m of masters) m.guildId = guildId;
        w.log("GUILD_FOUNDED", {
          actorId: master.id, provinceId: p.id,
          data: { guild: gname, craft, guildId, members: masters.length },
        });
        return;
      }
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
// GUILD_DISSOLVED — fired directly from innovation.ts maintainGuilds when a
// guild's active membership drops below 2. Render + arc only.
// ---------------------------------------------------------------------------
const GUILD_DISSOLVED: EventSpec = {
  type: "GUILD_DISSOLVED",
  base: 6,
  render: (ev, w) =>
    `${String(ev.data["guild"] ?? "the guild")} dissolved at ${provName(w, ev.provinceId)} — the last masters were dead or gone, and the guildhall stood empty.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

// ---------------------------------------------------------------------------
// RIVAL_HOUSES_CLASH — two same-specialization houses go to war. Chronicle
// event reactive to WAR when both attacker and defender have matching
// dominantClass. Historical: two merchant houses clashing (Venice vs Genoa),
// two mage lineages contending, etc.
// ---------------------------------------------------------------------------
const RIVAL_HOUSES_CLASH: EventSpec = {
  type: "RIVAL_HOUSES_CLASH",
  base: 8,
  render: (ev, w) => {
    const cls = String(ev.data["class"] ?? "specialists");
    return `The rival houses of ${charName(w, ev.actorId)} and ${charName(w, ev.targetId)} clashed — a war of ${cls} pitched against ${cls}, and the chroniclers noted the rarity of the match.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "WAR",
    prob: (w, e) => {
      const atk = w.char(e.actorId);
      const def = w.char(e.targetId);
      if (!atk || !def) return 0;
      const atkDyn = w.dynasty(atk.dynastyId);
      const defDyn = w.dynasty(def.dynastyId);
      if (!atkDyn?.dominantClass || !defDyn?.dominantClass) return 0;
      if (atkDyn.dominantClass !== defDyn.dominantClass) return 0;
      if (atkDyn.dominantClass === "commoner") return 0;
      // Both houses must have crossed the HOUSE_SPECIALIZES threshold (guild
      // tradition set) — otherwise this fires every war between two soldier-
      // heavy houses, which is most wars. Also demand real depth on both sides.
      if (!atkDyn.guildTradition || !defDyn.guildTradition) return 0;
      if (atkDyn.specializationDepth < 0.5 || defDyn.specializationDepth < 0.5) return 0;
      return 0.35;
    },
    fire: (w, e) => {
      const atk = w.char(e.actorId);
      if (!atk) return;
      const dyn = w.dynasty(atk.dynastyId);
      if (!dyn?.dominantClass) return;
      w.log("RIVAL_HOUSES_CLASH", {
        actorId: e.actorId, targetId: e.targetId, provinceId: e.provinceId,
        data: { class: CLASS_NOUN[dyn.dominantClass] },
      });
    },
  },
};

// unused-vars suppression for narrow type imports
void RARE_CLASSES;

// ---------------------------------------------------------------------------
export const DYNASTY_SPECIALIZATION_SPECS: EventSpec[] = [
  HOUSE_SPECIALIZES,
  MASTER_LINEAGE_FORMS,
  RARE_LINEAGE_EXPONENTIAL,
  HOUSE_LOSES_TRADITION,
  GUILD_FOUNDED,
  GUILD_DISSOLVED,
  RIVAL_HOUSES_CLASH,
];
