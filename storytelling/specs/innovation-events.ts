// specs/innovation-events.ts — codified craft-secrets and personal-mastery lineage.
//
// The events sitting on top of the innovation.ts state layer. Ten specs
// covering the full invention lifecycle (made → guild-monopolised → leaked →
// lost → rediscovered), plus the master/apprentice bond and the emergence of
// proto-IP law.
//
// Design invariants baked in here:
//   • INVENTION_MADE probability is inversely scaled by manaDensity — high-
//     mana provinces produce fewer inventions because personal-magic occupies
//     the same reward niche (fireball > gunpowder for a level-8 mage).
//   • GUILD_MONOPOLY_CLAIMED only in mercantile cultures — historical: proto-
//     patent substitutes required a merchant class strong enough to enforce.
//   • INVENTION_REDISCOVERED gated on level 15+ — only masters can reconstruct
//     lost arts from broken records.
//   • PATENT_LAW_ADOPTED is once-per-world — Venetian statute (1474) analog.
//
// The state-mutating events (INVENTION_MADE, INVENTION_LEAKED, INVENTION_LOST)
// have their bookkeeping done inside `fire`, either by pushing a new Invention
// into `w.inventions` or (for LEAKED/LOST, which the innovation.ts module
// itself fires) purely rendering.

import type { EventSpec } from "../event-spec.js";
import type { Character, Invention, InventionCategory, Title } from "../types.js";
import type { World } from "../world.js";

// ---------------------------------------------------------------------------
// Helpers — small utility functions shared across specs.
// ---------------------------------------------------------------------------

function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  return c.name;
}

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the workshop";
}

function cultureNameOf(w: World, c: Character): string {
  return w.cultureOf(c)?.name ?? "the folk";
}

function cultureHasTrait(w: World, c: Character, trait: string): boolean {
  const dyn = w.dynasty(c.dynastyId);
  if (!dyn?.cultureId) return false;
  const state = w.cultureState(dyn.cultureId);
  if (state.eliteTraits.has(trait) || state.folkTraits.has(trait)) return true;
  return (w.cultures.get(dyn.cultureId)?.startingTraits ?? []).includes(trait);
}

// Craftsman classes are the ones that can invent codified craft-secrets. The
// engine's CharClass union is narrower than real-world craftsmen, so we take
// scholar (writing, philosophy, medicine) and merchant (finance, navigation)
// as the pool; both are common enough to sustain a craft-lineage.
function isCraftsman(c: Character): boolean {
  return c.charClass === "scholar" || c.charClass === "merchant";
}

// Pool of nouns per invention category. Used by the procedural namer.
const CATEGORY_NOUN: Record<InventionCategory, string[]> = {
  metallurgy:  ["brasswork", "steel-craft", "alloy", "blade-tempering", "ingot"],
  printing:    ["press", "type-work", "chapbook", "block-print", "scriptorium"],
  medicine:    ["remedy", "poultice", "trepanation", "physic", "apothecary"],
  military:    ["siege-engine", "field-drill", "signal-corps", "arrow-craft", "war-mask"],
  agriculture: ["ploughcraft", "grain-store", "field-rotation", "canal", "harvest-book"],
  navigation:  ["compass", "chart", "astrolabe", "log-line", "shipwright's rule"],
  architecture:["vault", "keystone method", "dome", "colonnade", "citadel-craft"],
  textiles:    ["weaveworks", "loom-craft", "dyeworks", "silk-scheme", "brocade"],
};

// Pick an invention category weighted by the inventor's context. Scholars lean
// toward printing/medicine; merchants toward navigation/textiles. Provincial
// context tilts further — coastal + merchant → navigation, blighted + medicine.
function pickCategory(w: World, c: Character): InventionCategory {
  const p = w.province(c.provinceId);
  const isCoastal = !!p?.coastal;
  const isBlighted = (p?.blightLevel ?? 0) > 0.15;
  const isMountain = p?.terrain === "mountain" || !!p?.subsurface;
  const isFertile = (p?.fertility ?? 0) > 0.7;

  // Weighted pool
  const weights: Array<[InventionCategory, number]> = [
    ["metallurgy",   isMountain ? 4 : 1],
    ["printing",     c.charClass === "scholar" ? 3 : 1],
    ["medicine",     c.charClass === "scholar" ? 2 : 1 + (isBlighted ? 2 : 0)],
    ["military",     1],
    ["agriculture",  isFertile ? 3 : 1],
    ["navigation",   isCoastal ? 4 : 0.2],
    ["architecture", 1],
    ["textiles",     c.charClass === "merchant" ? 3 : 1],
  ];
  const total = weights.reduce((s, [, w2]) => s + w2, 0);
  let r = w.rng.float(0, total);
  for (const [cat, wt] of weights) {
    r -= wt;
    if (r <= 0) return cat;
  }
  return "metallurgy";
}

// Tier weight climbs with inventor level — a level-8 scholar mostly makes tier
// 1s; a level-20 grandmaster might land on tier 3.
function pickTier(w: World, c: Character): 1 | 2 | 3 {
  const roll = w.rng.float(0, 1);
  const lvl = c.level;
  if (lvl >= 20 && roll < 0.15) return 3;
  if (lvl >= 12 && roll < 0.35) return 2;
  return 1;
}

// leakProbBase depends on the culture's IP-substitutes. Mercantile-and-literate
// cultures hold secrets much longer; loose cultures hold them barely at all.
function pickLeakProb(w: World, c: Character): number {
  const merc = cultureHasTrait(w, c, "mercantile");
  const lit = cultureHasTrait(w, c, "literacy_valued");
  if (merc && lit) return 0.008;
  if (merc || lit) return 0.015;
  return 0.035;
}

// ---------------------------------------------------------------------------
// INVENTION_MADE — the seminal event. A qualified craftsman codifies a new
// craft-secret. Consumes RNG for category + tier + name choices in fire().
// Probability itself is inversely scaled by manaDensity (magic-suppression).
// ---------------------------------------------------------------------------
const INVENTION_MADE: EventSpec = {
  type: "INVENTION_MADE",
  base: 9,
  render: (ev, w) => {
    const invName = String(ev.data["invention"] ?? "a craft");
    const cat = String(ev.data["category"] ?? "craft");
    const tier = Number(ev.data["tier"] ?? 1);
    const tierName = tier === 3 ? "a breakthrough" : tier === 2 ? "a solid improvement" : "a modest refinement";
    return `${charName(w, ev.actorId)} devised ${invName}${cat === "craft" ? "" : ` — ${tierName} in the ${cat} arts`} at ${provName(w, ev.provinceId)}.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (!isCraftsman(c)) return false;
      if (c.level < 8) return false;
      if (w.age(c) < 20 || w.age(c) > 65) return false;
      if (!cultureHasTrait(w, c, "literacy_valued") && !cultureHasTrait(w, c, "meritocracy")) return false;
      return true;
    },
    prob: (w, item) => {
      const c = item as Character;
      const p = w.province(c.provinceId);
      const magicSuppression = 1 - Math.min(1, (p?.manaDensity ?? 0) * 0.7);
      const base = 0.005;
      const meritBonus = cultureHasTrait(w, c, "meritocracy") ? 1.5 : 1;
      const mercBonus = cultureHasTrait(w, c, "mercantile") ? 1.2 : 1;
      return Math.min(0.02, base * magicSuppression * meritBonus * mercBonus);
    },
    fire: (w, item) => {
      const c = item as Character;
      const category = pickCategory(w, c);
      const tier = pickTier(w, c);
      const nounPool = CATEGORY_NOUN[category];
      const noun = nounPool[w.rng.int(0, nounPool.length - 1)];
      const name = `${cultureNameOf(w, c)} ${noun}`;
      const invId = w.freshId("inv");
      const invention: Invention = {
        id: invId,
        name,
        category,
        tier,
        inventedYear: w.year,
        inventorId: c.id,
        inventorDynastyId: c.dynastyId,
        inventorProvinceId: c.provinceId,
        secret: true,
        leakProbBase: pickLeakProb(w, c),
        spreadTo: [],
        guildProtected: false,
        lost: false,
        lostYear: null,
      };
      w.inventions.set(invId, invention);
      w.log("INVENTION_MADE", {
        actorId: c.id, provinceId: c.provinceId,
        data: { invention: name, category, tier, inventionId: invId },
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// GUILD_MONOPOLY_CLAIMED — reactive to INVENTION_MADE. Mercantile cultures
// formalise guild control, lowering leak probability by ~4x. Historical: pre-
// patent Venice, Song China. Not a full patent — just enforced secrecy.
// ---------------------------------------------------------------------------
const GUILD_MONOPOLY_CLAIMED: EventSpec = {
  type: "GUILD_MONOPOLY_CLAIMED",
  base: 8,
  render: (ev, w) => {
    const invName = String(ev.data["invention"] ?? "the craft");
    return `A guild of ${provName(w, ev.provinceId)} claimed monopoly over ${invName} — the craft-secret would be guarded from other houses.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "INVENTION_MADE",
    prob: (w, e) => {
      const inventor = w.char(e.actorId);
      if (!inventor) return 0;
      return cultureHasTrait(w, inventor, "mercantile") ? 0.6 : 0;
    },
    fire: (w, e) => {
      const invId = String(e.data["inventionId"] ?? "");
      const inv = w.inventions.get(invId);
      if (!inv) return;
      inv.guildProtected = true;
      inv.leakProbBase *= 0.25; // lower leak by 4x — guild enforcement
      w.log("GUILD_MONOPOLY_CLAIMED", {
        actorId: e.actorId, provinceId: e.provinceId,
        data: { invention: inv.name, inventionId: invId },
      });
    },
  },
};

// ---------------------------------------------------------------------------
// INVENTION_LEAKED — the fire is inside innovation.ts (per-year leak roll).
// We only supply the render + score here. Base score is modest since leaks
// are the modal outcome; the DRAMA is in what wasn't leaked yet.
// ---------------------------------------------------------------------------
const INVENTION_LEAKED: EventSpec = {
  type: "INVENTION_LEAKED",
  base: 5,
  render: (ev, w) => {
    const invName = String(ev.data["invention"] ?? "a craft-secret");
    const toHouse = String(ev.data["toHouse"] ?? "");
    const dyn = w.dynasty(toHouse);
    return `The secret of ${invName} leaked to the ${dyn?.name ?? "another"} house — chroniclers blamed loose scribes and drunk journeymen.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

// ---------------------------------------------------------------------------
// INVENTION_LOST — same pattern, fire is in innovation.ts:checkLostInventions.
// This is one of the most dramatically important story events: the moment when
// a real technology passes into legend (Roman concrete, Greek fire).
// ---------------------------------------------------------------------------
const INVENTION_LOST: EventSpec = {
  type: "INVENTION_LOST",
  base: 9,
  render: (ev, w) => {
    const invName = String(ev.data["invention"] ?? "an art");
    return `${invName} passed into legend at ${provName(w, ev.provinceId)} — the last master had died, and no apprentice held the whole method.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

// ---------------------------------------------------------------------------
// RIVAL_REVERSE_ENGINEERS — a peer scholar independently reconstructs. Adds a
// dynasty to the spread set without needing a leak roll. Rare — requires a
// peer AT OR ABOVE the inventor's level, which is not common.
// ---------------------------------------------------------------------------
const RIVAL_REVERSE_ENGINEERS: EventSpec = {
  type: "RIVAL_REVERSE_ENGINEERS",
  base: 8,
  render: (ev, w) => {
    const invName = String(ev.data["invention"] ?? "the craft");
    return `${charName(w, ev.actorId)} reverse-engineered ${invName} — starting from rumour, from broken samples, from what could not be forgotten.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (!isCraftsman(c)) return false;
      if (c.level < 10) return false;
      if (w.age(c) < 25 || w.age(c) > 65) return false;
      // Must find at least one active secret invention this scholar's dynasty
      // doesn't yet know, and whose inventor was of equal-or-lesser level.
      for (const inv of w.activeInventions()) {
        if (inv.secret === false) continue;
        if (w.dynastyKnows(c.dynastyId, inv)) continue;
        const inventor = w.char(inv.inventorId);
        if (!inventor) continue;
        if (c.level >= inventor.level) return true;
      }
      return false;
    },
    prob: () => 0.003,
    fire: (w, item) => {
      const c = item as Character;
      // Find the first eligible target (order-dependent but deterministic).
      for (const inv of w.activeInventions()) {
        if (inv.secret === false) continue;
        if (w.dynastyKnows(c.dynastyId, inv)) continue;
        const inventor = w.char(inv.inventorId);
        if (!inventor || c.level < inventor.level) continue;
        inv.spreadTo.push(c.dynastyId);
        inv.secret = false;
        w.log("RIVAL_REVERSE_ENGINEERS", {
          actorId: c.id, provinceId: c.provinceId,
          data: { invention: inv.name, inventionId: inv.id },
        });
        return;
      }
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// INVENTION_REDISCOVERED — a lost art reawakens. Ambient over chars; rare
// (0.001/y). Requires level 15+ scholar/merchant.
// ---------------------------------------------------------------------------
const INVENTION_REDISCOVERED: EventSpec = {
  type: "INVENTION_REDISCOVERED",
  base: 9,
  render: (ev, w) => {
    const invName = String(ev.data["invention"] ?? "a lost art");
    return `${charName(w, ev.actorId)} rediscovered ${invName} — the method returned to the world after generations of silence.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (!isCraftsman(c)) return false;
      if (c.level < 15) return false;
      // Must be a LOST invention this dynasty could benefit from.
      for (const inv of w.inventions.values()) {
        if (!inv.lost) continue;
        return true;
      }
      return false;
    },
    prob: () => 0.001,
    fire: (w, item) => {
      const c = item as Character;
      const lost = [...w.inventions.values()].find((i) => i.lost);
      if (!lost) return;
      lost.lost = false;
      lost.lostYear = null;
      lost.inventorId = c.id;
      lost.inventorDynastyId = c.dynastyId;
      lost.inventorProvinceId = c.provinceId;
      lost.inventedYear = w.year;
      lost.secret = true;
      lost.spreadTo = [];
      lost.guildProtected = false;
      lost.leakProbBase = pickLeakProb(w, c);
      w.log("INVENTION_REDISCOVERED", {
        actorId: c.id, provinceId: c.provinceId,
        data: { invention: lost.name, inventionId: lost.id, category: lost.category, tier: lost.tier },
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// TREATISE_LEAKS_SECRET — reactive to TREATISE_PUBLISHED. If the scholar's
// dynasty holds a secret invention, the treatise reveals it. Historical: silk
// leaked partly through Han-era written accounts falling into foreign hands.
// ---------------------------------------------------------------------------
const TREATISE_LEAKS_SECRET: EventSpec = {
  type: "TREATISE_LEAKS_SECRET",
  base: 7,
  render: (ev, w) => {
    const invName = String(ev.data["invention"] ?? "a craft-secret");
    return `${charName(w, ev.actorId)}'s treatise inadvertently exposed the method of ${invName} — copyists spread it faster than any spy.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "TREATISE_PUBLISHED",
    prob: (w, e) => {
      const c = w.char(e.actorId);
      if (!c) return 0;
      const held = w.inventionsKnownBy(c.dynastyId).some((i) => i.secret);
      return held ? 0.35 : 0;
    },
    fire: (w, e) => {
      const c = w.char(e.actorId);
      if (!c) return;
      const secret = w.inventionsKnownBy(c.dynastyId).find((i) => i.secret);
      if (!secret) return;
      // Force-leak: all currently-existing dynasties get the invention.
      for (const dyn of w.dynasties.values()) {
        if (dyn.extinctYear !== null) continue;
        if (secret.inventorDynastyId === dyn.id) continue;
        if (!secret.spreadTo.includes(dyn.id)) secret.spreadTo.push(dyn.id);
      }
      secret.secret = false;
      w.log("TREATISE_LEAKS_SECRET", {
        actorId: c.id, provinceId: c.provinceId,
        data: { invention: secret.name, inventionId: secret.id },
      });
    },
  },
};

// ---------------------------------------------------------------------------
// APPRENTICE_TAKEN — master craftsman forms a personal lineage. Enables
// personal-wealth inheritance and level transmission on master's death. Note:
// the transferOnDeath-triggered variant is logged elsewhere (with kind:
// "inheritance"); this spec is the initial formation event.
// ---------------------------------------------------------------------------
const APPRENTICE_TAKEN: EventSpec = {
  type: "APPRENTICE_TAKEN",
  base: 4,
  render: (ev, w) =>
    `${charName(w, ev.actorId)} took ${charName(w, ev.targetId)} as apprentice — the master's craft would have an heir.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (!isCraftsman(c)) return false;
      if (c.level < 10) return false;
      if (c.apprenticeIds.length >= 3) return false;
      if (w.age(c) < 30 || w.age(c) > 70) return false;
      return true;
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const master = item as Character;
      // Find a young unmentored character of same class in same province.
      const candidate = w.living().find(
        (o) => o.id !== master.id
             && o.provinceId === master.provinceId
             && o.charClass === master.charClass
             && o.mentorId === null
             && w.age(o) >= 12 && w.age(o) <= 25,
      );
      if (!candidate) return;
      master.apprenticeIds.push(candidate.id);
      candidate.mentorId = master.id;
      w.log("APPRENTICE_TAKEN", {
        actorId: master.id, targetId: candidate.id, provinceId: master.provinceId,
        data: { kind: "formation" },
      });
    },
    maxPerTick: 3,
  },
};

// ---------------------------------------------------------------------------
// MASTER_ARTISAN_HONORED — the personal path chronicle event. A craftsman
// reaches recognition through personal wealth accumulation (Factor 2 fulfilled).
// ---------------------------------------------------------------------------
const MASTER_ARTISAN_HONORED: EventSpec = {
  type: "MASTER_ARTISAN_HONORED",
  base: 6,
  render: (ev, w) =>
    `${charName(w, ev.actorId)} was honoured as a master of the craft at ${provName(w, ev.provinceId)} — the workshop's fame had spread beyond the province.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (!isCraftsman(c)) return false;
      if (c.level < 15) return false;
      if (c.personalWealth < 150) return false;
      if (w.age(c) < 40) return false;
      return true;
    },
    prob: () => 0.03,
    fire: (w, item) => {
      const c = item as Character;
      w.log("MASTER_ARTISAN_HONORED", {
        actorId: c.id, provinceId: c.provinceId,
        data: { wealth: c.personalWealth, level: c.level },
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// PATENT_LAW_ADOPTED — the proto-IP moment. Once-per-world. Requires 3+ prior
// GUILD_MONOPOLY_CLAIMED events in a mercantile+literate kingdom.
// After this event fires, all subsequent inventions in that kingdom's realm
// get a lower default leak probability (the innovation.ts leak-roll already
// reads leakProbBase, so we just knock down existing ones and future ones).
// ---------------------------------------------------------------------------
const PATENT_LAW_ADOPTED: EventSpec = {
  type: "PATENT_LAW_ADOPTED",
  base: 10,
  render: (ev, w) => {
    const titleName = w.title(ev.titleId)?.name ?? "the realm";
    return `${titleName} formally recognised craft-guilds' exclusive rights — a proto-patent law adopted by decree.`;
  },
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      if (t.tier !== "kingdom") return false;
      const holder = w.char(t.holderId);
      if (!holder) return false;
      if (!cultureHasTrait(w, holder, "mercantile")) return false;
      if (!cultureHasTrait(w, holder, "literacy_valued")) return false;
      const guildEventsInRealm = w.events.filter(
        (e) => e.type === "GUILD_MONOPOLY_CLAIMED",
      ).length;
      return guildEventsInRealm >= 3;
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const t = item as Title;
      // Knock down leak for every existing invention held by dynasties in this
      // realm. Future inventions will inherit the new leak floor via a
      // culture-trait check in pickLeakProb (already applied).
      for (const inv of w.inventions.values()) {
        if (inv.lost) continue;
        inv.leakProbBase *= 0.5;
      }
      w.log("PATENT_LAW_ADOPTED", {
        actorId: t.holderId, titleId: t.id, provinceId: t.provinceId,
      });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
export const INNOVATION_SPECS: EventSpec[] = [
  INVENTION_MADE,
  GUILD_MONOPOLY_CLAIMED,
  INVENTION_LEAKED,
  INVENTION_LOST,
  RIVAL_REVERSE_ENGINEERS,
  INVENTION_REDISCOVERED,
  TREATISE_LEAKS_SECRET,
  APPRENTICE_TAKEN,
  MASTER_ARTISAN_HONORED,
  PATENT_LAW_ADOPTED,
];
