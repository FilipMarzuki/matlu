// specs/culture-events.ts — 15 culture-driven event specs.
//
// These fire when a culture's mechanical traits (slavery, caste_rigid,
// meritocracy, mercantile, literacy_valued, warrior_culture, zealous_faith)
// meet other world conditions. Every spec here uses the EventSpec catalog
// pattern — no changes needed to sifter/render/arcs/tick.
//
// All specs are magic-gated indirectly: they read culture-drift state which
// exists whether magic is on or not, but their fire() bodies only touch the
// event log. In the base default world (no cultures), no spec ever gates true.
//
// Reuses:
//   - cultureHasTraitState() — declared here, mirrors emergence.ts helper
//   - w.province(), w.dynasty(), w.living(), w.rng.chance()
//   - EventSpec.render/arc format from event-spec.ts

import type { EventSpec } from "../event-spec.js";
import type { Character } from "../types.js";
import type { World } from "../world.js";

// Check trait via CultureState (elite or folk tier) with spec fallback.
// Kept local so this file has no dep on emergence.ts internals.
function cultureHasTrait(w: World, cultureId: string, trait: string): boolean {
  if (!cultureId) return false;
  const state = w.cultureState(cultureId);
  if (state.eliteTraits.has(trait) || state.folkTraits.has(trait)) return true;
  return (w.cultures.get(cultureId)?.startingTraits ?? []).includes(trait);
}

function charCulture(w: World, c: Character): string | null {
  return w.dynasty(c.dynastyId)?.cultureId ?? null;
}

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the land";
}

function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}

// ---------------------------------------------------------------------------
// SLAVE_REVOLT — a slavery-culture province blights or sees lowborn rise
// ---------------------------------------------------------------------------
const SLAVE_REVOLT: EventSpec = {
  type: "SLAVE_REVOLT",
  base: 8,
  render: (ev, w) => {
    const p = provName(w, ev.provinceId);
    const deaths = Number(ev.data["deaths"] ?? 0);
    return `A slave uprising in ${p} shook the ruling houses. ${deaths} perished before it was put down.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as { id: string; blightLevel: number; population: number; titleId: string };
      if (p.population < 100) return false;
      const title = w.title(p.titleId);
      const holder = w.char(title?.holderId ?? null);
      if (!holder) return false;
      const culture = charCulture(w, holder);
      if (!culture || !cultureHasTrait(w, culture, "slavery")) return false;
      // Trigger condition: recent LOWBORN_RISE at this province OR high blight.
      const recentRise = w.events.some(
        (e) => e.type === "LOWBORN_RISE" && e.provinceId === p.id && w.year - e.year < 5,
      );
      return recentRise || p.blightLevel > 0.4;
    },
    prob: (_w, _item) => 0.08,
    fire: (w, item) => {
      const p = w.province((item as { id: string }).id)!;
      const loss = Math.round(p.population * 0.06);
      p.population = Math.max(50, p.population - loss);
      w.log("SLAVE_REVOLT", { provinceId: p.id, data: { deaths: loss } });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// CASTE_UPRISING — caste_rigid culture, long peace, high pop
// ---------------------------------------------------------------------------
const CASTE_UPRISING: EventSpec = {
  type: "CASTE_UPRISING",
  base: 7,
  render: (ev, w) => `The lower castes of ${provName(w, ev.provinceId)} rose against their betters — the great order cracked.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as { id: string; population: number; titleId: string };
      if (p.population < 150) return false;
      const title = w.title(p.titleId);
      const holder = w.char(title?.holderId ?? null);
      const culture = holder ? charCulture(w, holder) : null;
      if (!culture || !cultureHasTrait(w, culture, "caste_rigid")) return false;
      // No war in this province for 40+ years.
      const recentWar = w.events.some(
        (e) => e.type === "WAR" && e.provinceId === p.id && w.year - e.year < 40,
      );
      return !recentWar && w.year > 60;
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const p = w.province((item as { id: string }).id)!;
      const loss = Math.round(p.population * 0.04);
      p.population = Math.max(50, p.population - loss);
      w.log("CASTE_UPRISING", { provinceId: p.id, data: { deaths: loss } });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// MERITOCRATIC_REFORM — meritocracy trait + recent REFORM event
// ---------------------------------------------------------------------------
const MERITOCRATIC_REFORM: EventSpec = {
  type: "MERITOCRATIC_REFORM",
  base: 7,
  render: (ev, w) => `Under the merit-code of ${provName(w, ev.provinceId)}, birth ceased to be destiny — the old ranks were quietly reordered.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "REFORM",
    prob: (w, e) => {
      const t = w.title(e.titleId);
      const holder = w.char(t?.holderId ?? null);
      const culture = holder ? charCulture(w, holder) : null;
      if (!culture || !cultureHasTrait(w, culture, "meritocracy")) return 0;
      return 0.35;
    },
    fire: (w, e) => {
      w.log("MERITOCRATIC_REFORM", {
        actorId: e.actorId,
        titleId: e.titleId,
        provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// PRINTING_PRESS — literacy_valued + SCHOLAR_FLOURISH + year > 100
// Fires once per world — the invention of print is singular.
// ---------------------------------------------------------------------------
const PRINTING_PRESS: EventSpec = {
  type: "PRINTING_PRESS",
  base: 10,
  render: (ev, w) => `In ${provName(w, ev.provinceId)}, the pressed letter was invented — the written word could now be copied a thousand times over.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "SCHOLAR_FLOURISH",
    prob: (w, e) => {
      if (w.year < 100) return 0;
      const scholar = w.living().find((c) => c.provinceId === e.provinceId && c.charClass === "scholar");
      if (!scholar) return 0;
      const culture = charCulture(w, scholar);
      if (!culture || !cultureHasTrait(w, culture, "literacy_valued")) return 0;
      return 0.25;
    },
    fire: (w, e) => {
      w.log("PRINTING_PRESS", { provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// TREATISE_PUBLISHED — a level-8+ scholar dies in a literacy_valued culture
// ---------------------------------------------------------------------------
const TREATISE_PUBLISHED: EventSpec = {
  type: "TREATISE_PUBLISHED",
  base: 7,
  render: (ev, w) => `A treatise by ${charName(w, ev.actorId)} was set down in writing — the wisdom of ${provName(w, ev.provinceId)} would outlast its author.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "DEATH",
    prob: (w, e) => {
      const c = w.char(e.actorId);
      if (!c) return 0;
      if (c.charClass !== "scholar") return 0;
      if (c.level < 8) return 0;
      const culture = charCulture(w, c);
      if (!culture || !cultureHasTrait(w, culture, "literacy_valued")) return 0;
      return 0.4;
    },
    fire: (w, e) => {
      w.log("TREATISE_PUBLISHED", { actorId: e.actorId, provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// CRUSADE_CALLED — zealous_faith culture ruler, different-faith neighbour
// ---------------------------------------------------------------------------
const CRUSADE_CALLED: EventSpec = {
  type: "CRUSADE_CALLED",
  base: 9,
  render: (ev, w) => `A crusade was called from ${provName(w, ev.provinceId)} against the unbelievers beyond the marches — the faithful took up arms.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const title = item as { id: string; provinceId: string; holderId: string | null; tier: string };
      if (title.tier !== "kingdom") return false;
      const holder = w.char(title.holderId);
      if (!holder) return false;
      if (holder.drives.piety < 0.6) return false;
      const culture = charCulture(w, holder);
      if (!culture || !cultureHasTrait(w, culture, "zealous_faith")) return false;
      // Need a different-faith neighbour.
      const myFaith = w.faithIdOf(holder);
      const prov = w.province(title.provinceId);
      if (!prov || !myFaith) return false;
      for (const nId of prov.neighbors) {
        const nProv = w.province(nId);
        const nTitle = [...w.titles.values()].find((t) => t.provinceId === nId);
        const nHolder = w.char(nTitle?.holderId ?? null);
        if (!nHolder) continue;
        if (nProv?.subsurface !== prov.subsurface) continue;
        const nFaith = w.faithIdOf(nHolder);
        if (nFaith && nFaith !== myFaith) return true;
      }
      return false;
    },
    prob: () => 0.04,
    fire: (w, item) => {
      const title = item as { id: string; provinceId: string; holderId: string | null };
      w.log("CRUSADE_CALLED", {
        actorId: title.holderId,
        titleId: title.id,
        provinceId: title.provinceId,
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// HERESY_TRIAL — zealous_faith culture in contested state against zealous_faith
// ---------------------------------------------------------------------------
const HERESY_TRIAL: EventSpec = {
  type: "HERESY_TRIAL",
  base: 8,
  render: (ev, w) => `A heresy trial was held in ${provName(w, ev.provinceId)} — the old orthodoxy tightened its grip.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as { id: string; titleId: string };
      const title = w.title(p.titleId);
      const holder = w.char(title?.holderId ?? null);
      const culture = holder ? charCulture(w, holder) : null;
      if (!culture || !cultureHasTrait(w, culture, "zealous_faith")) return false;
      // Check contested state — zealous_faith under pressure (any tier).
      const state = w.cultureState(culture);
      return "elite:zealous_faith" in state.contested
          || "folk:zealous_faith" in state.contested
          || "elite:abandon:zealous_faith" in state.contested
          || "folk:abandon:zealous_faith" in state.contested;
    },
    prob: () => 0.06,
    fire: (w, item) => {
      const p = w.province((item as { id: string }).id)!;
      w.log("HERESY_TRIAL", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// GUILD_CHARTERED — mercantile + MERCANTILE_ASCENDANT already fired + wealth
// ---------------------------------------------------------------------------
const GUILD_CHARTERED: EventSpec = {
  type: "GUILD_CHARTERED",
  base: 7,
  render: (ev, w) => `A merchants' guild was chartered in ${provName(w, ev.provinceId)} — trade would answer to its own laws now.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "MERCANTILE_ASCENDANT",
    prob: (w, e) => {
      const title = [...w.titles.values()].find((t) => t.provinceId === e.provinceId);
      const holder = w.char(title?.holderId ?? null);
      const dyn = w.dynasty(holder?.dynastyId ?? "");
      if (!dyn || dyn.wealth < 400) return 0;
      const culture = holder ? charCulture(w, holder) : null;
      if (!culture || !cultureHasTrait(w, culture, "mercantile")) return 0;
      return 0.4;
    },
    fire: (w, e) => {
      w.log("GUILD_CHARTERED", { provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// MERCHANT_PRINCE_RISES — mercantile culture + level-12+ merchant character
// ---------------------------------------------------------------------------
const MERCHANT_PRINCE_RISES: EventSpec = {
  type: "MERCHANT_PRINCE_RISES",
  base: 8,
  render: (ev, w) => `${charName(w, ev.actorId)} became a merchant prince — silver bought what the sword could not take in ${provName(w, ev.provinceId)}.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (c.charClass !== "merchant") return false;
      if (c.level < 12) return false;
      const culture = charCulture(w, c);
      if (!culture || !cultureHasTrait(w, culture, "mercantile")) return false;
      return true;
    },
    prob: () => 0.1,
    fire: (w, item) => {
      const c = item as Character;
      w.log("MERCHANT_PRINCE_RISES", { actorId: c.id, provinceId: c.provinceId });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// CULTURE_SCHISM — CULTURAL_RIFT persisted for 30+ years
// ---------------------------------------------------------------------------
const CULTURE_SCHISM: EventSpec = {
  type: "CULTURE_SCHISM",
  base: 10,
  render: (ev, _w) => {
    const c = String(ev.data["culture"] ?? "a people");
    return `The people of ${c} formally split — elite and folk went their separate ways, and one culture became two.`;
  },
  arc: (ev) => {
    const c = String(ev.data["culture"] ?? "");
    return c ? { key: `C:${c}`, kind: "culture" } : null;
  },
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as { titleId: string };
      const holder = w.char(w.title(p.titleId)?.holderId ?? null);
      const culture = holder ? charCulture(w, holder) : null;
      if (!culture) return false;
      // Find a CULTURAL_RIFT for this culture that's 30+ years old and not
      // yet answered by a CULTURE_SCHISM.
      const rift = [...w.events].reverse().find(
        (e) => e.type === "CULTURAL_RIFT" && e.data["culture"] === culture && w.year - e.year >= 30,
      );
      if (!rift) return false;
      const alreadySchismed = w.events.some(
        (e) => e.type === "CULTURE_SCHISM" && e.data["culture"] === culture,
      );
      return !alreadySchismed;
    },
    prob: () => 0.05,
    fire: (w, item) => {
      const holder = w.char(w.title((item as { titleId: string }).titleId)?.holderId ?? null);
      const culture = holder ? charCulture(w, holder) : null;
      if (!culture) return;
      w.log("CULTURE_SCHISM", { data: { culture } });
    },
    once: "world",
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// CULTURE_MERGED — sustained contact + trait overlap between two cultures
// ---------------------------------------------------------------------------
const CULTURE_MERGED: EventSpec = {
  type: "CULTURE_MERGED",
  base: 9,
  render: (ev, _w) => {
    const a = String(ev.data["cultureA"] ?? "one people");
    const b = String(ev.data["cultureB"] ?? "another");
    return `The peoples of ${a} and ${b} had drawn so close, over so many years, that no meaningful line remained between them.`;
  },
  arc: (ev) => {
    const a = String(ev.data["cultureA"] ?? "");
    return a ? { key: `C:${a}`, kind: "culture" } : null;
  },
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as { titleId: string };
      const holder = w.char(w.title(p.titleId)?.holderId ?? null);
      const culture = holder ? charCulture(w, holder) : null;
      if (!culture) return false;
      const state = w.cultureState(culture);
      for (const [otherId, years] of Object.entries(state.contactYears)) {
        if (years < 40) continue;
        // Already merged?
        const already = w.events.some(
          (e) => e.type === "CULTURE_MERGED" &&
                 ((e.data["cultureA"] === culture && e.data["cultureB"] === otherId) ||
                  (e.data["cultureA"] === otherId && e.data["cultureB"] === culture)),
        );
        if (already) continue;
        // Trait overlap check.
        const otherState = w.cultureState(otherId);
        const myTraits = new Set([...state.eliteTraits, ...state.folkTraits]);
        const theirTraits = new Set([...otherState.eliteTraits, ...otherState.folkTraits]);
        if (myTraits.size === 0 || theirTraits.size === 0) continue;
        const overlap = [...myTraits].filter((t) => theirTraits.has(t)).length;
        const overlapRatio = overlap / Math.max(myTraits.size, theirTraits.size);
        if (overlapRatio < 0.7) continue;
        return true;
      }
      return false;
    },
    prob: () => 0.03,
    fire: (w, item) => {
      const holder = w.char(w.title((item as { titleId: string }).titleId)?.holderId ?? null);
      const culture = holder ? charCulture(w, holder) : null;
      if (!culture) return;
      const state = w.cultureState(culture);
      for (const [otherId, years] of Object.entries(state.contactYears)) {
        if (years < 40) continue;
        w.log("CULTURE_MERGED", { data: { cultureA: culture, cultureB: otherId } });
        return;
      }
    },
    once: "world",
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// SYNCRETIC_FAITH_BORN — two zealous_faith cultures merge
// ---------------------------------------------------------------------------
const SYNCRETIC_FAITH_BORN: EventSpec = {
  type: "SYNCRETIC_FAITH_BORN",
  base: 10,
  render: (ev, _w) => {
    const a = String(ev.data["cultureA"] ?? "");
    const b = String(ev.data["cultureB"] ?? "");
    return `A new syncretic faith rose from the meeting of ${a} and ${b} — the old altars kept their names but not their meanings.`;
  },
  arc: (ev) => {
    const a = String(ev.data["cultureA"] ?? "");
    return a ? { key: `C:${a}`, kind: "culture" } : null;
  },
  onEvent: {
    source: "CULTURE_MERGED",
    prob: (w, e) => {
      const a = String(e.data["cultureA"] ?? "");
      const b = String(e.data["cultureB"] ?? "");
      if (!a || !b) return 0;
      if (!cultureHasTrait(w, a, "zealous_faith")) return 0;
      if (!cultureHasTrait(w, b, "zealous_faith")) return 0;
      return 0.7;
    },
    fire: (w, e) => {
      w.log("SYNCRETIC_FAITH_BORN", { data: { cultureA: e.data["cultureA"], cultureB: e.data["cultureB"] } });
    },
  },
};

// ---------------------------------------------------------------------------
// CASTE_FLUIDITY_LOST — stratification > 0.7 in some culture, sustained
// ---------------------------------------------------------------------------
const CASTE_FLUIDITY_LOST: EventSpec = {
  type: "CASTE_FLUIDITY_LOST",
  base: 8,
  render: (ev, _w) => {
    const c = String(ev.data["culture"] ?? "the people");
    return `The tiers of ${c} closed against each other — no lowborn would rise, no lord would fall, without breaking the world.`;
  },
  arc: (ev) => {
    const c = String(ev.data["culture"] ?? "");
    return c ? { key: `C:${c}`, kind: "culture" } : null;
  },
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as { titleId: string };
      const holder = w.char(w.title(p.titleId)?.holderId ?? null);
      const culture = holder ? charCulture(w, holder) : null;
      if (!culture) return false;
      const state = w.cultureState(culture);
      if (state.stratification < 0.7) return false;
      // Already fired for this culture?
      const already = w.events.some(
        (e) => e.type === "CASTE_FLUIDITY_LOST" && e.data["culture"] === culture,
      );
      return !already;
    },
    prob: () => 0.05,
    fire: (w, item) => {
      const holder = w.char(w.title((item as { titleId: string }).titleId)?.holderId ?? null);
      const culture = holder ? charCulture(w, holder) : null;
      if (!culture) return;
      w.log("CASTE_FLUIDITY_LOST", { data: { culture } });
    },
    once: "world",
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// SLAVE_LIBERATION — CULTURAL_SHIFT with trait=slavery + adopted=false
// ---------------------------------------------------------------------------
const SLAVE_LIBERATION: EventSpec = {
  type: "SLAVE_LIBERATION",
  base: 10,
  render: (ev, _w) => {
    const c = String(ev.data["culture"] ?? "the people");
    return `Slavery was abolished among ${c} — the chains fell where they had lain for generations.`;
  },
  arc: (ev) => {
    const c = String(ev.data["culture"] ?? "");
    return c ? { key: `C:${c}`, kind: "culture" } : null;
  },
  onEvent: {
    source: "CULTURAL_SHIFT",
    prob: (_w, e) => {
      if (e.data["trait"] !== "slavery") return 0;
      if (e.data["adopted"] !== false) return 0;
      return 1.0;
    },
    fire: (w, e) => {
      w.log("SLAVE_LIBERATION", { data: { culture: e.data["culture"] } });
    },
  },
};

// ---------------------------------------------------------------------------
// POLYMATH_EMERGES — meritocracy + literacy_valued + character with 2+ trial skills
// ---------------------------------------------------------------------------
const POLYMATH_EMERGES: EventSpec = {
  type: "POLYMATH_EMERGES",
  base: 8,
  render: (ev, w) => `${charName(w, ev.actorId)} became a polymath — an all-arts figure of the merit-and-learning tradition of ${provName(w, ev.provinceId)}.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (!c.skills || c.skills.length < 2) return false;
      const culture = charCulture(w, c);
      if (!culture) return false;
      if (!cultureHasTrait(w, culture, "meritocracy")) return false;
      if (!cultureHasTrait(w, culture, "literacy_valued")) return false;
      return true;
    },
    prob: () => 0.2,
    fire: (w, item) => {
      const c = item as Character;
      w.log("POLYMATH_EMERGES", {
        actorId: c.id,
        provinceId: c.provinceId,
        data: { skills: c.skills?.length ?? 0, level: c.level },
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
export const CULTURE_SPECS: EventSpec[] = [
  SLAVE_REVOLT,
  CASTE_UPRISING,
  MERITOCRATIC_REFORM,
  PRINTING_PRESS,
  TREATISE_PUBLISHED,
  CRUSADE_CALLED,
  HERESY_TRIAL,
  GUILD_CHARTERED,
  MERCHANT_PRINCE_RISES,
  CULTURE_SCHISM,
  CULTURE_MERGED,
  SYNCRETIC_FAITH_BORN,
  CASTE_FLUIDITY_LOST,
  SLAVE_LIBERATION,
  POLYMATH_EMERGES,
];
