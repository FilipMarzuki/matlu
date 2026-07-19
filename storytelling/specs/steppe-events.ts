// specs/steppe-events.ts — 12 events for the two steppe cultures.
//
// Two nomad cultures share the Ashen Steppe: the Orctongue Horde (Mongol +
// Sassanid warlord flavour, clan-tribal, khan-elected) and the Ikibeki tribes
// (beastkin animists, ancestor-guided, spirit-bound).
//
// The catalog is culture-gated: every spec that touches these dynamics returns
// prob 0 for characters/provinces/titles outside these two cultures, keeping
// the RNG stream byte-identical for worlds without them (default·s42 stays put,
// only frontier hashes move).
//
// Cross-culture events (BLOOD_DEBT_DECLARED, PEACE_CIRCLE_HELD, STEPPE_STORM
// _OMEN) are the story-glue between the two, letting Horde raids and Ikibeki
// ancestor-councils drive each other over the generations.

import type { EventSpec } from "../event-spec.js";
import type { Character, Dynasty, Province, Title, WorldEvent } from "../types.js";
import type { World } from "../world.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ORCTONGUE = "orctongue";
const IKIBEKI   = "ikibeki";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the steppe";
}
function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} ${house}` : c.name;
}
function cultureIdOfChar(w: World, c: Character | null | undefined): string | null {
  if (!c) return null;
  return w.dynasty(c.dynastyId)?.cultureId ?? null;
}
function cultureIdOfDynasty(_w: World, d: Dynasty | null | undefined): string | null {
  return d?.cultureId ?? null;
}
function provinceHolderCulture(w: World, provinceId: string): string | null {
  const title = [...w.titles.values()].find((t) => t.provinceId === provinceId);
  const holder = w.char(title?.holderId ?? null);
  return holder ? (w.dynasty(holder.dynastyId)?.cultureId ?? null) : null;
}
function pickClan(w: World, cultureId: string): string {
  const clans = w.cultures.get(cultureId)?.clans ?? [];
  if (clans.length === 0) return "the clan";
  return w.rng.pick(clans);
}
function countRecentEvents(w: World, type: string, filter: (e: WorldEvent) => boolean, window: number): number {
  let n = 0;
  for (const e of w.events) {
    if (e.type !== type) continue;
    if (w.year - e.year > window) continue;
    if (!filter(e)) continue;
    n++;
  }
  return n;
}

// ===========================================================================
// ORCTONGUE-SPECIFIC (5)
// ===========================================================================

// ---------------------------------------------------------------------------
// KURULTAI_CONVENED — clan-assembly meets to elect (or re-affirm) the khan.
// Ambient on Orctongue kingdom-tier titles. Fires periodically (~3-4%/y) or
// when the holder is old/weak, giving the succession-legitimacy layer a
// culture-flavoured hook.
// ---------------------------------------------------------------------------
const KURULTAI_CONVENED: EventSpec = {
  type: "KURULTAI_CONVENED",
  base: 8,
  render: (ev, w) => {
    const clan = String(ev.data["clan"] ?? "the great clan");
    const held = ev.data["confirmed"] === true;
    const where = provName(w, ev.provinceId);
    return held
      ? `Beneath the Eternal Sky at ${where}, the kurultai of the ${clan}-lords confirmed the Khagan; the horse-tails were carried three times around the black-felt tent.`
      : `Beneath the Eternal Sky at ${where}, the kurultai of the ${clan}-lords convened to weigh the Khagan's strength. Not all who rode home carried the same silence.`;
  },
  arc: (ev) => ev.titleId ? { key: `KUR:${ev.titleId}`, kind: "feud" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      if (t.tier !== "kingdom") return false;
      if (t.law !== "elective") return false;
      if (t.holderId === null) return false;
      const holder = w.char(t.holderId);
      if (!holder) return false;
      return cultureIdOfChar(w, holder) === ORCTONGUE;
    },
    prob: (w, item) => {
      const t = item as Title;
      const holder = w.char(t.holderId);
      if (!holder) return 0;
      const age = w.age(holder);
      // Base 3%/y; +2% if holder is aging; +2% if their martial is thin.
      let p = 0.03;
      if (age > 55) p += 0.02;
      if ((holder.level ?? 1) < 5) p += 0.02;
      return p;
    },
    fire: (w, item) => {
      const t = item as Title;
      const holder = w.char(t.holderId);
      if (!holder) return;
      const confirmed = w.rng.chance(0.65);
      w.log("KURULTAI_CONVENED", {
        titleId: t.id,
        provinceId: t.provinceId,
        actorId: holder.id,
        data: { clan: pickClan(w, ORCTONGUE), confirmed },
      });
    },
    // No dedupe — this can recur across the decades.
  },
};

// ---------------------------------------------------------------------------
// CATTLE_RAID — annual raid on a non-Orctongue neighbour. Depopulates the
// target slightly and enriches the raider. Rate-limited by pop floor so we
// don't push provinces below the invariant threshold.
// ---------------------------------------------------------------------------
const CATTLE_RAID: EventSpec = {
  type: "CATTLE_RAID",
  base: 5,
  render: (ev, w) => {
    const from = String(ev.data["fromName"] ?? "the horde");
    const to = provName(w, ev.provinceId);
    const clan = String(ev.data["clan"] ?? "");
    const raiders = String(ev.data["raiders"] ?? "raiders");
    const suffix = clan ? ` — the ${clan}-riders were seen among them` : "";
    return `${from} sent ${raiders} against ${to}; the herds were driven off before the moon turned${suffix}.`;
  },
  arc: (ev) => ev.provinceId ? { key: `RAID:${ev.provinceId}`, kind: "feud" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      // Target must NOT be Orctongue (they don't raid their own).
      if (provinceHolderCulture(w, p.id) === ORCTONGUE) return false;
      // And the target must have an Orctongue neighbour.
      for (const nid of p.neighbors) {
        if (provinceHolderCulture(w, nid) === ORCTONGUE) return true;
      }
      return false;
    },
    prob: (w, item) => {
      const p = item as Province;
      // Weight by the raider's ambition (find any Orctongue neighbour holder).
      let ambition = 0.5;
      for (const nid of p.neighbors) {
        if (provinceHolderCulture(w, nid) === ORCTONGUE) {
          const title = [...w.titles.values()].find((t) => t.provinceId === nid);
          const holder = w.char(title?.holderId ?? null);
          if (holder) ambition = Math.max(ambition, holder.drives.ambition);
        }
      }
      return 0.04 + 0.05 * ambition;
    },
    fire: (w, item) => {
      const p = item as Province;
      // Refuse if target would drop below floor.
      if (p.population < 90) return;
      const loss = Math.floor(p.population * (0.05 + w.rng.next() * 0.03));
      p.population = Math.max(70, p.population - loss);
      // Pick raider dynasty.
      let raiderProv: string | null = null;
      for (const nid of p.neighbors) {
        if (provinceHolderCulture(w, nid) === ORCTONGUE) { raiderProv = nid; break; }
      }
      const raiderTitle = raiderProv ? [...w.titles.values()].find((t) => t.provinceId === raiderProv) : undefined;
      const raiderHolder = w.char(raiderTitle?.holderId ?? null);
      const from = raiderHolder ? `${w.dynasty(raiderHolder.dynastyId)?.name ?? "the horde"}` : "the horde";
      w.log("CATTLE_RAID", {
        provinceId: p.id,
        actorId: raiderHolder?.id ?? null,
        data: {
          fromName: from,
          clan: pickClan(w, ORCTONGUE),
          raiders: `${100 + w.rng.int(0, 400)} riders`,
          popLoss: loss,
        },
      });
    },
    maxPerTick: 3,
  },
};

// ---------------------------------------------------------------------------
// HORDE_TRIBUTE_DEMANDED — after ≥3 CATTLE_RAIDs on the same province in 30y,
// the local khan formalises tribute. Refusal path is implicit (existing war
// AI reads the war-declared claim state).
// ---------------------------------------------------------------------------
const HORDE_TRIBUTE_DEMANDED: EventSpec = {
  type: "HORDE_TRIBUTE_DEMANDED",
  base: 9,
  render: (ev, w) => {
    const target = provName(w, ev.provinceId);
    const paid = ev.data["paid"] === true;
    return paid
      ? `A khan of the Horde rode to ${target} and demanded tribute; the wagons were counted and the peace held for a season.`
      : `A khan of the Horde rode to ${target} and demanded tribute; the wagons did not come, and the horns began to sound in the east.`;
  },
  arc: (ev) => ev.provinceId ? { key: `TRIB:${ev.provinceId}`, kind: "feud" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (provinceHolderCulture(w, p.id) === ORCTONGUE) return false;
      const raidCount = countRecentEvents(w, "CATTLE_RAID", (e) => e.provinceId === p.id, 30);
      return raidCount >= 3;
    },
    prob: () => 0.10,
    fire: (w, item) => {
      const p = item as Province;
      const paid = w.rng.chance(0.55);
      w.log("HORDE_TRIBUTE_DEMANDED", {
        provinceId: p.id,
        data: { paid, raidsBehind: countRecentEvents(w, "CATTLE_RAID", (e) => e.provinceId === p.id, 30) },
      });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// HORDE_SPLINTERS — a weak khaganate loses a clan-tier defection. Spawns a
// migration wave toward a random non-Orctongue neighbour (barbarian invasion
// pathway — composes with migration.ts).
// ---------------------------------------------------------------------------
const HORDE_SPLINTERS: EventSpec = {
  type: "HORDE_SPLINTERS",
  base: 10,
  render: (ev, w) => {
    const clan = String(ev.data["clan"] ?? "a great clan");
    const seat = provName(w, ev.provinceId);
    return `The ${clan}-riders broke from the Khaganate at ${seat}; before the season turned they were riding westward, seeking their own grazing.`;
  },
  arc: (ev) => ev.titleId ? { key: `SPL:${ev.titleId}`, kind: "feud" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      if (t.tier !== "kingdom" || t.law !== "elective") return false;
      const holder = w.char(t.holderId);
      if (!holder) return false;
      if (cultureIdOfChar(w, holder) !== ORCTONGUE) return false;
      // Count subordinate elective clanholds.
      const subs = [...w.titles.values()].filter((sub) => sub.liegeId === t.id).length;
      if (subs < 2) return false;
      // Weak khan trigger: low level or aged.
      const age = w.age(holder);
      return (holder.level ?? 1) < 6 || age > 55;
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const t = item as Title;
      w.log("HORDE_SPLINTERS", {
        titleId: t.id,
        provinceId: t.provinceId,
        data: { clan: pickClan(w, ORCTONGUE) },
      });
    },
    // Recurring — a khaganate can splinter multiple times over centuries.
  },
};

// ---------------------------------------------------------------------------
// SLAVE_UPRISING_CRUSHED — Horde slave-economy maintenance. Provinces held by
// Orctongue dynasties with a slavery trait and populous slave-labour see
// periodic uprisings.
// ---------------------------------------------------------------------------
const SLAVE_UPRISING_CRUSHED: EventSpec = {
  type: "SLAVE_UPRISING_CRUSHED",
  base: 7,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    return `Slaves at ${where} rose against their masters; before the season closed, the tents were quiet again, but the smoke lingered for weeks.`;
  },
  arc: (ev) => ev.provinceId ? { key: `SUP:${ev.provinceId}`, kind: "feud" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (provinceHolderCulture(w, p.id) !== ORCTONGUE) return false;
      if (p.population < 250) return false;
      const cultureId = provinceHolderCulture(w, p.id) ?? "";
      const starting = w.cultures.get(cultureId)?.startingTraits ?? [];
      return starting.includes("slavery");
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const p = item as Province;
      const loss = Math.floor(p.population * 0.03);
      p.population = Math.max(80, p.population - loss);
      w.log("SLAVE_UPRISING_CRUSHED", {
        provinceId: p.id,
        data: { popLoss: loss },
      });
    },
  },
};

// ===========================================================================
// IKIBEKI-SPECIFIC (4)
// ===========================================================================

// ---------------------------------------------------------------------------
// SPIRIT_WALK_UNDERTAKEN — an Ikibeki figure fasts alone for a season, returns
// with a spirit-name suffix and a level bump. Frequent precursor to
// NAMED_HERO_RISES via the sage/wanderer epithet paths.
// ---------------------------------------------------------------------------
const SPIRIT_WALK_UNDERTAKEN: EventSpec = {
  type: "SPIRIT_WALK_UNDERTAKEN",
  base: 6,
  render: (ev, w) => {
    const actor = charName(w, ev.actorId);
    const suffix = String(ev.data["spiritName"] ?? "the wind");
    const where = provName(w, ev.provinceId);
    return `${actor} fasted alone by ${where} for a full turning of moons; when they returned, they were called ${suffix} — and only the wind had spoken it.`;
  },
  arc: (ev) => ev.actorId ? { key: `SW:${ev.actorId}`, kind: "dynasty" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (!c.alive) return false;
      if (cultureIdOfChar(w, c) !== IKIBEKI) return false;
      if ((c.level ?? 1) < 4) return false;
      return true;
    },
    prob: () => 0.03,
    fire: (w, item) => {
      const c = item as Character;
      c.level = Math.min(40, (c.level ?? 1) + 2);
      // Nudge biases toward the Ikibeki spiritual shape.
      c.psyche.biases["fatalist"]   = Math.min(1, (c.psyche.biases["fatalist"]   ?? 0) + 0.10);
      c.psyche.biases["honor_bound"] = Math.min(1, (c.psyche.biases["honor_bound"] ?? 0) + 0.08);
      const pool = ["White-Feather", "Cedar-Voice", "Wind-Listener", "Standing-Elk", "Deep-Water", "Salmon-Runner"];
      const suffix = w.rng.pick(pool);
      w.log("SPIRIT_WALK_UNDERTAKEN", {
        actorId: c.id,
        provinceId: c.provinceId,
        data: { spiritName: suffix },
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// ANCESTOR_COUNCIL_SPOKE — on the death of an Ikibeki title-holder, the elder
// shaman channels ancestor voices to pick or affirm the successor. Composes
// with succession-legitimacy: a chosen successor gets a small legitimacy edge
// (the ancestors watch).
// ---------------------------------------------------------------------------
const ANCESTOR_COUNCIL_SPOKE: EventSpec = {
  type: "ANCESTOR_COUNCIL_SPOKE",
  base: 8,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    const chosen = String(ev.data["chosen"] ?? "a war-chief");
    return `At ${where}, the elder-shaman drew the smoke around them and listened; the ancestors spoke, and ${chosen} was named to sit on the Circle.`;
  },
  arc: (ev) => ev.titleId ? { key: `AC:${ev.titleId}`, kind: "title" } : null,
  onEvent: {
    source: "DEATH",
    prob: (w, e) => {
      const c = w.char(e.actorId);
      if (!c) return 0;
      if (cultureIdOfChar(w, c) !== IKIBEKI) return 0;
      // Only if they held a title.
      const heldSomething = [...w.titles.values()].some((t) => t.holderId === c.id);
      if (!heldSomething) return 0;
      return 0.55;
    },
    fire: (w, e) => {
      const c = w.char(e.actorId);
      if (!c) return;
      const heldTitle = [...w.titles.values()].find((t) => t.holderId === c.id);
      const chosen = c.childrenIds?.[0]
        ? charName(w, c.childrenIds[0])
        : "an elder of the Circle";
      w.log("ANCESTOR_COUNCIL_SPOKE", {
        titleId: heldTitle?.id ?? null,
        provinceId: c.provinceId,
        data: { chosen },
      });
    },
  },
};

// ---------------------------------------------------------------------------
// TOTEM_BEAST_CHOSEN — a new Ikibeki dynasty bonds with a wildlife species
// active in their home province. Composes with wildlife.ts (reads
// speciesAt); if the totem later goes extinct, SPIRITUAL_CRISIS fires.
// ---------------------------------------------------------------------------
const TOTEM_BEAST_CHOSEN: EventSpec = {
  type: "TOTEM_BEAST_CHOSEN",
  base: 6,
  render: (ev, w) => {
    const dyn = String(ev.data["dynasty"] ?? "the clan");
    const species = String(ev.data["species"] ?? "the beast of the ridge");
    const where = provName(w, ev.provinceId);
    return `The ${dyn} bound their fate to the ${species} of ${where}; henceforth their fortunes moved with the beast's own.`;
  },
  arc: (ev) => ev.data["dynastyId"] ? { key: `TOT:${ev.data["dynastyId"]}`, kind: "dynasty" } : null,
  ambient: {
    scan: "dynasties",
    gate: (w, item) => {
      const d = item as Dynasty;
      if (cultureIdOfDynasty(w, d) !== IKIBEKI) return false;
      // Already has a totem? (Encoded as a data field on a previous event.)
      const already = w.events.some(
        (e) => e.type === "TOTEM_BEAST_CHOSEN" && e.data["dynastyId"] === d.id
      );
      if (already) return false;
      // Need a living founder / member to anchor the province.
      const anyMember = [...w.characters.values()].find((c) => c.alive && c.dynastyId === d.id);
      if (!anyMember) return false;
      // And an active wildlife species in that province.
      const species = w.speciesAt(anyMember.provinceId);
      return species.length > 0;
    },
    prob: () => 0.05,
    fire: (w, item) => {
      const d = item as Dynasty;
      const anyMember = [...w.characters.values()].find((c) => c.alive && c.dynastyId === d.id);
      if (!anyMember) return;
      const species = w.speciesAt(anyMember.provinceId);
      if (species.length === 0) return;
      const chosen = w.rng.pick(species);
      w.log("TOTEM_BEAST_CHOSEN", {
        provinceId: anyMember.provinceId,
        data: {
          dynasty: d.name,
          dynastyId: d.id,
          species: chosen.name,
          speciesId: chosen.id,
        },
      });
    },
    once: "per-actor", // per-actor here works on dynasty.id
  },
};

// ---------------------------------------------------------------------------
// SPIRITUAL_CRISIS — when a totem-bonded species goes extinct, the bonded
// dynasty suffers a legitimacy shock. Fires as onEvent SPECIES_EXTINCT.
// ---------------------------------------------------------------------------
const SPIRITUAL_CRISIS: EventSpec = {
  type: "SPIRITUAL_CRISIS",
  base: 10,
  render: (ev, w) => {
    const dyn = String(ev.data["dynasty"] ?? "the clan");
    const species = String(ev.data["species"] ?? "their totem");
    const where = provName(w, ev.provinceId);
    return `The ${dyn} keened at ${where}: the ${species} was gone, and with it their voice at the Council of Ancestors. The Circle would not be the same.`;
  },
  arc: (ev) => ev.data["dynastyId"] ? { key: `TOT:${ev.data["dynastyId"]}`, kind: "dynasty" } : null,
  onEvent: {
    source: "SPECIES_EXTINCT",
    prob: (w, e) => {
      const speciesId = String(e.data["speciesId"] ?? "");
      if (!speciesId) return 0;
      // Any bonded dynasty for this species?
      const bonded = w.events.some(
        (ev2) => ev2.type === "TOTEM_BEAST_CHOSEN" && ev2.data["speciesId"] === speciesId
      );
      return bonded ? 1.0 : 0;
    },
    fire: (w, e) => {
      const speciesId = String(e.data["speciesId"] ?? "");
      const bondEv = [...w.events]
        .reverse()
        .find((ev2) => ev2.type === "TOTEM_BEAST_CHOSEN" && ev2.data["speciesId"] === speciesId);
      if (!bondEv) return;
      w.log("SPIRITUAL_CRISIS", {
        provinceId: bondEv.provinceId,
        data: {
          dynasty: bondEv.data["dynasty"] ?? "the clan",
          dynastyId: bondEv.data["dynastyId"] ?? "",
          species: bondEv.data["species"] ?? "the totem",
          speciesId,
        },
      });
    },
  },
};

// ===========================================================================
// CROSS-CULTURE (3) — the story-glue
// ===========================================================================

// ---------------------------------------------------------------------------
// BLOOD_DEBT_DECLARED — an enduring vengeance-arc between houses across the
// two cultures. Recorded on the killer's dynasty; descendants inherit the
// debt for at least three generations.
// ---------------------------------------------------------------------------
const BLOOD_DEBT_DECLARED: EventSpec = {
  type: "BLOOD_DEBT_DECLARED",
  base: 8,
  render: (ev) => {
    const victim = String(ev.data["victim"] ?? "a fallen chief");
    const killerHouse = String(ev.data["killerHouse"] ?? "an enemy house");
    return `In the death of ${victim}, a blood-debt fell upon the house of ${killerHouse}. The steppe forgets nothing.`;
  },
  arc: (ev) => ev.data["killerDynastyId"]
    ? { key: `BD:${ev.data["killerDynastyId"]}`, kind: "dynasty" } : null,
  onEvent: {
    source: "MURDER",
    prob: (w, e) => {
      const victim = w.char(e.targetId);
      const killer = w.char(e.actorId);
      if (!victim || !killer) return 0;
      const vc = cultureIdOfChar(w, victim);
      const kc = cultureIdOfChar(w, killer);
      // Only fires when both are in {orctongue, ikibeki} and cultures differ,
      // OR when a level-4+ figure of these cultures is slain by anyone.
      if (vc !== ORCTONGUE && vc !== IKIBEKI) return 0;
      if ((victim.level ?? 1) < 4) return 0;
      const crossCulture = kc && kc !== vc && (kc === ORCTONGUE || kc === IKIBEKI);
      return crossCulture ? 0.55 : 0.15;
    },
    fire: (w, e) => {
      const victim = w.char(e.targetId);
      const killer = w.char(e.actorId);
      if (!victim || !killer) return;
      w.log("BLOOD_DEBT_DECLARED", {
        actorId: killer.id,
        targetId: victim.id,
        provinceId: victim.provinceId,
        data: {
          victim: charName(w, victim.id),
          killerHouse: w.dynasty(killer.dynastyId)?.name ?? "the killers",
          killerDynastyId: killer.dynastyId,
          victimDynastyId: victim.dynastyId,
        },
      });
    },
  },
};

// ---------------------------------------------------------------------------
// PEACE_CIRCLE_HELD — Ikibeki-invited summit between Ikibeki chiefs and
// Orctongue khans. Roll: 30% mintTruce (30y), 55% war-declared (the summit
// ends badly), 15% doctrinal_parley (long-shot cross-faith outcome).
// ---------------------------------------------------------------------------
const PEACE_CIRCLE_HELD: EventSpec = {
  type: "PEACE_CIRCLE_HELD",
  base: 9,
  render: (ev, w) => {
    const outcome = String(ev.data["outcome"] ?? "silent");
    const where = provName(w, ev.provinceId);
    if (outcome === "truce")
      return `In the season of the long light, the horns of the Ikibeki called at ${where}, and the khans of the Horde answered. They shared the same fire, if not the same sky.`;
    if (outcome === "war")
      return `The Circle at ${where} broke before the second dawn; the war-drums answered the ancestor-drums, and the season turned cold with steel.`;
    return `At ${where}, the shamans and the khans sat late into the night; they parted having spoken of gods, though none had changed their own.`;
  },
  arc: (ev) => ev.provinceId ? { key: `PC:${ev.provinceId}`, kind: "feud" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      if (t.tier !== "kingdom") return false;
      const holder = w.char(t.holderId);
      if (!holder) return false;
      if (cultureIdOfChar(w, holder) !== IKIBEKI) return false;
      // Some Orctongue-held province adjacent to this seat.
      const seat = t.provinceId ? w.province(t.provinceId) : undefined;
      if (!seat) return false;
      const hasOrcNeighbour = seat.neighbors.some((nid) => provinceHolderCulture(w, nid) === ORCTONGUE);
      if (!hasOrcNeighbour) return false;
      // Recent blood-debts (across cultures) ≥ 2.
      const debtCount = countRecentEvents(w, "BLOOD_DEBT_DECLARED", () => true, 40);
      return debtCount >= 2;
    },
    prob: () => 0.03,
    fire: (w, item) => {
      const t = item as Title;
      const roll = w.rng.next();
      const outcome = roll < 0.30 ? "truce" : roll < 0.85 ? "war" : "doctrinal_parley";
      w.log("PEACE_CIRCLE_HELD", {
        titleId: t.id,
        provinceId: t.provinceId,
        data: { outcome },
      });
    },
  },
};

// ---------------------------------------------------------------------------
// STEPPE_STORM_OMEN — a mana-storm passes through a steppe/desert province in
// magic worlds. Reading differs by culture: Orctongue read favour of the Sky
// Father; Ikibeki read ancestor warnings.
// ---------------------------------------------------------------------------
const STEPPE_STORM_OMEN: EventSpec = {
  type: "STEPPE_STORM_OMEN",
  base: 5,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    const read = String(ev.data["reading"] ?? "silent");
    if (read === "sky-favour")
      return `A mana-storm crossed ${where}; the riders reined and lifted their spears — the Sky Father had spoken. There would be a hunt before the season closed.`;
    if (read === "ancestor-warning")
      return `A mana-storm crossed ${where}; the shamans lowered their heads — the ancestors had spoken. No horns would sound this moon.`;
    return `A mana-storm crossed ${where}; those who watched it did not agree on what they had seen.`;
  },
  arc: (ev) => ev.provinceId ? { key: `STO:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (!w.magicEnabled) return false;
      if (p.terrain !== "steppe" && p.terrain !== "desert") return false;
      if (p.manaDensity < 0.4) return false;
      const c = provinceHolderCulture(w, p.id);
      return c === ORCTONGUE || c === IKIBEKI;
    },
    prob: () => 0.04,
    fire: (w, item) => {
      const p = item as Province;
      const c = provinceHolderCulture(w, p.id);
      const reading =
        c === ORCTONGUE ? "sky-favour" :
        c === IKIBEKI   ? "ancestor-warning" :
        "silent";
      w.log("STEPPE_STORM_OMEN", {
        provinceId: p.id,
        data: { reading },
      });
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
export const STEPPE_SPECS: EventSpec[] = [
  KURULTAI_CONVENED,
  CATTLE_RAID,
  HORDE_TRIBUTE_DEMANDED,
  HORDE_SPLINTERS,
  SLAVE_UPRISING_CRUSHED,
  SPIRIT_WALK_UNDERTAKEN,
  ANCESTOR_COUNCIL_SPOKE,
  TOTEM_BEAST_CHOSEN,
  SPIRITUAL_CRISIS,
  BLOOD_DEBT_DECLARED,
  PEACE_CIRCLE_HELD,
  STEPPE_STORM_OMEN,
];
