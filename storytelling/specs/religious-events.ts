// specs/religious-events.ts — 12 religious / miraculous specs.
//
// Faith is already a stat in the engine (dynasty.faithId, culture zealous_faith
// trait). These events give the faith layer narrative weight — miracles,
// saints, temples, holy wars, apostates. Together with the fate layer
// (prophecies, dooms, legends) they produce the Iliad-shape religious arcs.

import type { EventSpec } from "../event-spec.js";
import type { Character, Province } from "../types.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the temple";
}
function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}
function cultureHasTrait(w: World, c: Character, trait: string): boolean {
  const dyn = w.dynasty(c.dynastyId);
  if (!dyn?.cultureId) return false;
  const state = w.cultureState(dyn.cultureId);
  if (state.eliteTraits.has(trait) || state.folkTraits.has(trait)) return true;
  return (w.cultures.get(dyn.cultureId)?.startingTraits ?? []).includes(trait);
}
function provinceHolder(w: World, provinceId: string): Character | null {
  const title = [...w.titles.values()].find((t) => t.provinceId === provinceId);
  return w.char(title?.holderId ?? null) ?? null;
}
function traitAt(w: World, provinceId: string, trait: string): boolean {
  const holder = provinceHolder(w, provinceId);
  return holder ? cultureHasTrait(w, holder, trait) : false;
}
function anyRecentEvent(w: World, type: string, provinceId: string, window: number): boolean {
  return w.events.some(
    (e) => e.type === type && e.provinceId === provinceId && w.year - e.year < window,
  );
}

// ---------------------------------------------------------------------------
// MIRACLE_WITNESSED — high-piety character in zealous_faith culture
// ---------------------------------------------------------------------------
const MIRACLE_WITNESSED: EventSpec = {
  type: "MIRACLE_WITNESSED",
  base: 8,
  render: (ev, w) => `${charName(w, ev.actorId)} witnessed what was said to be a miracle in ${provName(w, ev.provinceId)} — the faithful thronged to hear the tale.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (c.drives.piety < 0.75) return false;
      if (w.age(c) < 20) return false;
      return cultureHasTrait(w, c, "zealous_faith");
    },
    prob: () => 0.008,
    fire: (w, item) => {
      const c = item as Character;
      w.log("MIRACLE_WITNESSED", { actorId: c.id, provinceId: c.provinceId });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// SAINT_CANONIZED — LEGEND_INSCRIBED for a zealous_faith figure aged 30+
// ---------------------------------------------------------------------------
const SAINT_CANONIZED: EventSpec = {
  type: "SAINT_CANONIZED",
  base: 10,
  render: (ev, w) => {
    const fig = String(ev.data["figure"] ?? "");
    return `${fig} of ${provName(w, ev.provinceId)} was canonised as a saint — the altars would remember them.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "LEGEND_INSCRIBED",
    prob: (w, e) => {
      const c = w.char(e.actorId);
      if (!c) return 0;
      if (!cultureHasTrait(w, c, "zealous_faith")) return 0;
      if (Number(e.data["diedAge"] ?? 0) < 30) return 0;
      return 0.5;
    },
    fire: (w, e) => {
      const c = w.char(e.actorId);
      if (!c) return;
      w.log("SAINT_CANONIZED", {
        actorId: e.actorId,
        provinceId: e.provinceId,
        data: { figure: c.name, legendEventId: e.id },
      });
    },
  },
};

// ---------------------------------------------------------------------------
// PILGRIMAGE_ROUTE_OPENED — SAINT_CANONIZED + existing trade route
// ---------------------------------------------------------------------------
const PILGRIMAGE_ROUTE_OPENED: EventSpec = {
  type: "PILGRIMAGE_ROUTE_OPENED",
  base: 8,
  render: (ev, w) => `A pilgrimage route was opened to the saint's shrine at ${provName(w, ev.provinceId)} — the faithful walked in their thousands.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "SAINT_CANONIZED",
    prob: (w, e) => {
      // Any active trade route touches this province?
      const routes = w.events.some(
        (x) => x.type === "TRADE_ROUTE_ESTABLISHED" &&
               (x.data["fromProvinceId"] === e.provinceId || x.data["toProvinceId"] === e.provinceId),
      );
      return routes ? 0.5 : 0.15;
    },
    fire: (w, e) => {
      w.log("PILGRIMAGE_ROUTE_OPENED", { provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// FALSE_PROPHET_UNMASKED — DARK_PROPHET_RISES + ROYAL_INQUISITION active
// ---------------------------------------------------------------------------
const FALSE_PROPHET_UNMASKED: EventSpec = {
  type: "FALSE_PROPHET_UNMASKED",
  base: 8,
  render: (ev, w) => `The prophet of ${provName(w, ev.provinceId)} was unmasked as a fraud — the inquisition had done its work, and the crowd repented (or so was written).`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "DARK_PROPHET_RISES",
    prob: (w, e) => {
      const hasInq = w.events.some(
        (x) => x.type === "ROYAL_INQUISITION" && x.provinceId === e.provinceId,
      );
      return hasInq ? 0.6 : 0;
    },
    fire: (w, e) => {
      w.log("FALSE_PROPHET_UNMASKED", { actorId: e.actorId, provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// RELIC_UNEARTHED — CHALLENGE_VANQUISHED (ancient_tomb) + zealous_faith
// ---------------------------------------------------------------------------
const RELIC_UNEARTHED: EventSpec = {
  type: "RELIC_UNEARTHED",
  base: 8,
  render: (ev, w) => `A holy relic was unearthed from the ancient tomb of ${provName(w, ev.provinceId)} — the temple prospered by its presence.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "CHALLENGE_VANQUISHED",
    prob: (w, e) => {
      if (e.data["kind"] !== "ancient_tomb") return 0;
      return traitAt(w, e.provinceId ?? "", "zealous_faith") ? 0.5 : 0.1;
    },
    fire: (w, e) => {
      w.log("RELIC_UNEARTHED", { actorId: e.actorId, provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// TEMPLE_BUILT — wealth + zealous_faith + long peace
// ---------------------------------------------------------------------------
const TEMPLE_BUILT: EventSpec = {
  type: "TEMPLE_BUILT",
  base: 7,
  render: (ev, w) => `A great temple was raised at ${provName(w, ev.provinceId)} — its bells would sound over the fields for centuries.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (!traitAt(w, p.id, "zealous_faith")) return false;
      const holder = provinceHolder(w, p.id);
      const dyn = w.dynasty(holder?.dynastyId ?? "");
      if (!dyn || dyn.wealth < 400) return false;
      return !anyRecentEvent(w, "WAR", p.id, 15);
    },
    prob: () => 0.06,
    fire: (w, item) => {
      const p = item as Province;
      w.log("TEMPLE_BUILT", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// HOLY_WAR_DECLARED — CRUSADE_CALLED + kingdom-tier + martial composition
// ---------------------------------------------------------------------------
const HOLY_WAR_DECLARED: EventSpec = {
  type: "HOLY_WAR_DECLARED",
  base: 10,
  render: (ev, w) => `A holy war was declared from ${provName(w, ev.provinceId)} — the crusade had grown from summons to army, and hosts marched forth.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "CRUSADE_CALLED",
    prob: (w, e) => {
      // Need multiple knights/soldiers at the province.
      const p = e.provinceId ?? "";
      let martial = 0;
      for (const c of w.living()) {
        if (c.provinceId !== p) continue;
        if (c.charClass === "knight" || c.charClass === "soldier") martial++;
      }
      return martial >= 3 ? 0.6 : 0.1;
    },
    fire: (w, e) => {
      w.log("HOLY_WAR_DECLARED", { actorId: e.actorId, provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// SACRED_GROVE_RECOGNIZED — forest + high mana + no zealous_faith holder
// ---------------------------------------------------------------------------
const SACRED_GROVE_RECOGNIZED: EventSpec = {
  type: "SACRED_GROVE_RECOGNIZED",
  base: 6,
  render: (ev, w) => `The people of ${provName(w, ev.provinceId)} began to treat the old grove as sacred — the priests of no formal faith yet claimed it.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (p.terrain !== "forest" && p.terrain !== "jungle") return false;
      if (p.manaDensity < 0.5) return false;
      return !traitAt(w, p.id, "zealous_faith");
    },
    prob: () => 0.04,
    fire: (w, item) => {
      const p = item as Province;
      w.log("SACRED_GROVE_RECOGNIZED", { provinceId: p.id, data: { mana: p.manaDensity } });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// SCHISM_HEALED — after SYNCRETIC_FAITH_BORN + generations of peace
// ---------------------------------------------------------------------------
const SCHISM_HEALED: EventSpec = {
  type: "SCHISM_HEALED",
  base: 9,
  render: (ev, _w) => {
    const a = String(ev.data["cultureA"] ?? "");
    const b = String(ev.data["cultureB"] ?? "");
    return `The old schism between ${a} and ${b} was formally healed — the syncretic faith held the middle ground now.`;
  },
  arc: (ev) => {
    const a = String(ev.data["cultureA"] ?? "");
    return a ? { key: `C:${a}`, kind: "culture" } : null;
  },
  onEvent: {
    source: "SYNCRETIC_FAITH_BORN",
    prob: (w, e) => {
      // Only if it's been at least 60y since the syncretic event's own year —
      // this reactive spec is a delayed followup, so use a temporal check.
      return w.year - e.year >= 60 ? 0.4 : 0;
    },
    fire: (w, e) => {
      w.log("SCHISM_HEALED", { data: { cultureA: e.data["cultureA"], cultureB: e.data["cultureB"] } });
    },
  },
};

// ---------------------------------------------------------------------------
// APOSTASY_MOMENT — a ruler abandons the faith (very high greed + no piety)
// ---------------------------------------------------------------------------
const APOSTASY_MOMENT: EventSpec = {
  type: "APOSTASY_MOMENT",
  base: 9,
  render: (ev, w) => `${charName(w, ev.actorId)} publicly abandoned the faith — the priests were rattled, the coffers relieved.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as { tier: string; holderId: string | null };
      if (t.tier !== "kingdom" && t.tier !== "duchy") return false;
      const holder = w.char(t.holderId);
      if (!holder) return false;
      if (!cultureHasTrait(w, holder, "zealous_faith")) return false;
      if (holder.drives.piety > 0.3) return false;
      if (holder.drives.greed < 0.7) return false;
      return w.age(holder) >= 30;
    },
    prob: () => 0.015,
    fire: (w, item) => {
      const t = item as { id: string; provinceId: string; holderId: string | null };
      w.log("APOSTASY_MOMENT", { actorId: t.holderId, titleId: t.id, provinceId: t.provinceId });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// MONASTIC_ORDER_FOUNDED — TEMPLE_BUILT + scholar in province
// ---------------------------------------------------------------------------
const MONASTIC_ORDER_FOUNDED: EventSpec = {
  type: "MONASTIC_ORDER_FOUNDED",
  base: 8,
  render: (ev, w) => `A monastic order was founded at ${provName(w, ev.provinceId)} — scholars and pilgrims found common rule.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "TEMPLE_BUILT",
    prob: (w, e) => {
      const scholar = w.living().find((c) => c.provinceId === e.provinceId && c.charClass === "scholar");
      return scholar ? 0.5 : 0.1;
    },
    fire: (w, e) => {
      w.log("MONASTIC_ORDER_FOUNDED", { provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// FAITH_MARTYRED — HOLY_WAR_DECLARED + a scholar/knight of holder's dynasty dies
// ---------------------------------------------------------------------------
const FAITH_MARTYRED: EventSpec = {
  type: "FAITH_MARTYRED",
  base: 8,
  render: (ev, w) => `${charName(w, ev.actorId)} was martyred in the holy war — the faithful raised a chapel in their name.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "DEATH",
    prob: (w, e) => {
      const c = w.char(e.actorId);
      if (!c) return 0;
      if (e.data["cause"] !== "killed in war") return 0;
      if (!cultureHasTrait(w, c, "zealous_faith")) return 0;
      // Holy war was declared recently
      const holy = w.events.some(
        (x) => x.type === "HOLY_WAR_DECLARED" && w.year - x.year < 15,
      );
      return holy ? 0.5 : 0;
    },
    fire: (w, e) => {
      w.log("FAITH_MARTYRED", { actorId: e.actorId, provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
export const RELIGIOUS_SPECS: EventSpec[] = [
  MIRACLE_WITNESSED,
  SAINT_CANONIZED,
  PILGRIMAGE_ROUTE_OPENED,
  FALSE_PROPHET_UNMASKED,
  RELIC_UNEARTHED,
  TEMPLE_BUILT,
  HOLY_WAR_DECLARED,
  SACRED_GROVE_RECOGNIZED,
  SCHISM_HEALED,
  APOSTASY_MOMENT,
  MONASTIC_ORDER_FOUNDED,
  FAITH_MARTYRED,
];
