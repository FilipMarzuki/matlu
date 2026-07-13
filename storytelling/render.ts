// render.ts — the STUB renderer. Turns canonical events into chronicle prose
// with deterministic templates. No LLM: this runs offline, free, and instant,
// so we can iterate on whether the SIMULATION has the right texture before
// spending a token. When Claude is wired in later, it replaces this file and
// nothing else — the event log it reads is identical.
//
// Design note: the renderer is a pure function of canonical state. It invents
// no facts (that would corrupt canon); it only phrases facts the sim recorded.

import type { Arc } from "./arcs.js";
import { topHeroes } from "./magic.js";
import type { FocusContext } from "./sifter.js";
import type { Character, WorldEvent } from "./types.js";
import type { World } from "./world.js";

// Regnal numbering: across two centuries a house reuses given names, so an
// undisambiguated chronicle has three "Brigid of Corvane"s and reads as a
// muddle. We append a roman numeral when a name recurs within a house, ordered
// by birth — "Brigid II of Corvane". Cached per world since it never changes.
const regnalCache = new WeakMap<World, Map<string, string>>();

function roman(n: number): string {
  const table: [number, string][] = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}

function displayName(w: World, c: Character): string {
  let cache = regnalCache.get(w);
  if (!cache) {
    cache = new Map();
    regnalCache.set(w, cache);
  }
  const cached = cache.get(c.id);
  if (cached) return cached;

  const peers = [...w.characters.values()]
    .filter((p) => p.dynastyId === c.dynastyId && p.name === c.name)
    .sort((a, b) => a.birthYear - b.birthYear || (a.id < b.id ? -1 : 1));
  let label = c.name;
  if (peers.length > 1) {
    const idx = peers.findIndex((p) => p.id === c.id);
    label = `${c.name} ${roman(idx + 1)}`;
  }
  cache.set(c.id, label);
  return label;
}

// "Aldric of Aldermark". Foreign minor houses just read as their surname.
function who(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name ?? "no house";
  return `${displayName(w, c)} of ${house}`;
}

// Bare given name, for second references in the same sentence.
function name(w: World, id: string | null): string {
  return w.char(id)?.name ?? "someone";
}

function titleName(w: World, id: string | null): string {
  return w.title(id)?.name ?? "a title";
}

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the land";
}

function tagsOf(ev: WorldEvent): string[] {
  const t = ev.data["_tags"];
  return typeof t === "string" && t.length ? t.split(",") : [];
}

// The core: one event -> one chronicle sentence.
export function renderEvent(w: World, ev: WorldEvent): string {
  const tags = tagsOf(ev);
  switch (ev.type) {
    case "BIRTH":
      return `${who(w, ev.actorId)} was born to the house at ${provName(w, ev.provinceId)}.`;

    case "DEATH": {
      const cause = String(ev.data["cause"] ?? "natural causes");
      const age = Number(ev.data["age"] ?? 0);
      const ruler = tags.includes("ruler") ? ", a reigning lord," : "";
      return `${who(w, ev.actorId)}${ruler} died of ${cause} at the age of ${age}.`;
    }

    case "MARRIAGE": {
      const allied = tags.includes("alliance")
        ? " — a union of two ruling houses"
        : "";
      return `${who(w, ev.actorId)} wed ${who(w, ev.targetId)}${allied}.`;
    }

    case "SUCCESSION": {
      const t = titleName(w, ev.titleId);
      if (tags.includes("usurpation")) {
        return `${who(w, ev.actorId)} took ${t}, wresting it from the line of ${who(w, ev.targetId)}.`;
      }
      if (tags.includes("child-ruler")) {
        const age = Number(ev.data["heir_age"] ?? 0);
        return `${who(w, ev.actorId)}, a child of ${age}, inherited ${t} upon the death of ${who(w, ev.targetId)}.`;
      }
      return `${who(w, ev.actorId)} succeeded ${who(w, ev.targetId)} as holder of ${t}.`;
    }

    case "SUCCESSION_CRISIS":
      return `The death of ${who(w, ev.targetId)} left ${titleName(w, ev.titleId)} with no clear heir, and the title fell vacant.`;

    case "WAR": {
      const t = titleName(w, ev.titleId);
      if (ev.data["vacant"]) {
        return `${who(w, ev.actorId)} seized the vacant ${t} amid the disorder.`;
      }
      const won = ev.data["attacker_won"] === true;
      const underdog = tags.includes("underdog") ? ", against the odds," : "";
      const verb = won ? `wrested ${t} from` : `failed to take ${t} from`;
      let line = `${who(w, ev.actorId)}${underdog} ${verb} ${who(w, ev.targetId)}.`;
      const casualty = String(ev.data["casualty"] ?? "");
      if (casualty) line += ` ${name(w, casualty)} fell in the fighting.`;
      return line;
    }

    case "SCHEME_DISCOVERED": {
      const n = Number(ev.data["conspirators"] ?? 0);
      const co = n > 0 ? ` Their ${n} fellow conspirator(s) were exposed with them.` : "";
      return `A plot by ${who(w, ev.actorId)} against ${who(w, ev.targetId)} was uncovered.${co}`;
    }

    case "MURDER": {
      if (tags.includes("kinslaying") && tags.includes("revenge")) {
        return `${who(w, ev.actorId)} murdered their own kinsman ${who(w, ev.targetId)}, an old grudge repaid in blood.`;
      }
      if (tags.includes("kinslaying")) {
        return `${who(w, ev.actorId)} had their own kinsman ${who(w, ev.targetId)} killed.`;
      }
      if (tags.includes("revenge")) {
        return `${who(w, ev.actorId)} at last took revenge, having ${who(w, ev.targetId)} murdered.`;
      }
      return `${who(w, ev.actorId)} had ${who(w, ev.targetId)} quietly murdered.`;
    }

    case "USURP":
      return `${who(w, ev.actorId)} wrested ${titleName(w, ev.titleId)} from ${who(w, ev.targetId)} through court intrigue and subversion.`;

    case "REFORM":
      return `${who(w, ev.actorId)} reformed the succession of ${titleName(w, ev.titleId)} to ${ev.data["law"]}.`;

    case "FAMINE":
      return `Famine struck ${provName(w, ev.provinceId)}; some ${ev.data["deaths"]} souls perished.`;

    case "PLAGUE": {
      const named = Number(ev.data["named_dead"] ?? 0);
      const nb = named > 0 ? ` Among the dead were ${named} of noble blood.` : "";
      return `A pestilence broke out near ${provName(w, ev.provinceId)} and swept ${ev.data["provinces"]} provinces, killing ${ev.data["deaths"]}.${nb}`;
    }

    case "DYNASTY_EXTINCT":
      return `The House of ${ev.data["house"]} died out, its last member gone to the grave.`;

    case "LOWBORN_RISE":
      return `${who(w, ev.actorId)}, risen from common stock, seized ${titleName(w, ev.titleId)} and founded the House of ${ev.data["house"]}.`;

    case "HARVEST_FAILURE":
      return `The harvest failed at ${provName(w, ev.provinceId)}.`;

    case "GRUDGE_FORMED":
      return `${who(w, ev.actorId)} swore a grudge against ${who(w, ev.targetId)}.`;

    case "LEGEND": {
      const L = ev.data;
      switch (String(L["legend"])) {
        case "found":
          return `In the elder days, ${L["figure"]} raised ${L["realm"]} in the green heart of the world.`;
        case "golden":
          return `Under ${L["realm"]}, the art of ${L["art"]} flowered as it never has since.`;
        case "height":
          return `${L["realm"]} spanned from sea to steppe, and lesser kings paid it tribute.`;
        case "war":
          return `${L["realm"]} and ${L["foe"]} fell to war, and the age of gold began to wane.`;
        case "cataclysm":
          return `Then came ${L["cataclysm"]}: ${L["realm"]} was broken, and the art of ${L["art"]} was lost to the world.`;
        case "fall":
          return `The old kingdoms crumbled; their towers still stand as ruins in the wild, mana-haunted places.`;
        case "migration":
          return `The ${L["people"]} came into these lands after the Fall, and made them their own.`;
        case "dawn":
          return `From the ashes of the fallen realms, the houses of the present age slowly rose.`;
        default:
          return `[a legend of the elder days]`;
      }
    }

    // --- Magic / leveling layer ---
    case "LEVELED": {
      const lvl = ev.data["level"];
      const cls = ev.data["class"];
      if (tags.includes("ascendant")) {
        return `${who(w, ev.actorId)} rose to become the mightiest soul of the age — a ${cls} at level ${lvl}.`;
      }
      if (tags.includes("titan")) {
        return `${who(w, ev.actorId)} grew into a ${cls} of fearsome power (level ${lvl}), a name spoken across the realms.`;
      }
      return `${who(w, ev.actorId)} came into their strength as a ${cls} of note (level ${lvl}).`;
    }

    case "HERO_RISEN":
      return `${who(w, ev.actorId)}, born to no house of note, rose by sheer deed to the heroic tier — a ${ev.data["class"]} at level ${ev.data["level"]}.`;

    case "HEIR_TEMPERED":
      return `The House of ${ev.data["house"]} forged ${who(w, ev.actorId)} in real peril, and they came back the stronger (level ${ev.data["level"]}).`;

    case "CLASS_GAINED":
      return `The ${ev.data["class"]} art of House ${ev.data["house"]} passed to ${who(w, ev.actorId)}, its new master.`;

    case "ART_LOST":
      return `The ${ev.data["class"]} art of House ${ev.data["house"]} died with its last master, lost to the age.`;

    // --- World catastrophe layer ---
    case "BLIGHT_SPREADS":
      return `A creeping blight began to wither the land of ${provName(w, ev.provinceId)}, the soil cracking and the grasses dying.`;

    case "BLIGHT_DEEPENS":
      return `The blight of ${provName(w, ev.provinceId)} deepened — ${ev.data["deaths"]} fled or perished as the terrain shifted toward desert.`;

    case "BLIGHT_LOCKED":
      return `${provName(w, ev.provinceId)} was lost to the blight; no crop will ever grow there again.`;

    case "PORTAL_OPENS": {
      const n = Number(ev.data["stranded"] ?? 0);
      return `A rift tore open above ${provName(w, ev.provinceId)} and ${n.toLocaleString()} people fell through from another world — terrified, disoriented, and utterly lost.`;
    }

    case "MASS_DEATH": {
      const died = Number(ev.data["died"] ?? 0);
      const stranded = Number(ev.data["stranded"] ?? 0);
      return `Of the ${stranded.toLocaleString()} displaced souls who appeared at ${provName(w, ev.provinceId)}, ${died.toLocaleString()} died within the year — wrong season, wrong world, no way home.`;
    }

    case "DEAD_ZONE_FORMS":
      return `The dead of ${provName(w, ev.provinceId)} rose. The province became a no-go zone — sealed by undead, mana-saturated, and abandoned to the dark.`;

    case "UNDEAD_RAID": {
      const src = provName(w, String(ev.data["sourceProvinceId"] ?? ""));
      const named = Number(ev.data["named_dead"] ?? 0);
      const nb = named > 0 ? ` ${named} of noble blood were slain.` : "";
      return `An undead host poured out of ${src} and raided ${provName(w, ev.provinceId)}, killing ${ev.data["deaths"]}.${nb}`;
    }

    case "RITUAL_GONE_WRONG":
      return `A mana-working at ${provName(w, ev.provinceId)} spiralled out of control, killing ${who(w, ev.actorId)} and shaking the land.`;

    case "MANA_RUPTURE": {
      const named = Number(ev.data["named_dead"] ?? 0);
      const nb = named > 0 ? ` Among the dead: ${named} of noble blood.` : "";
      return `The ruptured mana at ${provName(w, ev.provinceId)} devastated the province — ${ev.data["deaths"]} perished and the land was left mana-corrupted.${nb}`;
    }

    case "CORRUPTION_SPREADS": {
      const src = provName(w, String(ev.data["sourceProvinceId"] ?? ""));
      return `Mana corruption from ${src} bled into ${provName(w, ev.provinceId)}, tainting soil and sky alike.`;
    }

    case "DELVED_TOO_DEEP": {
      const lord = ev.actorId ? who(w, ev.actorId) : "the hold-lord";
      return `Something stirred in the deeps beneath ${provName(w, ev.provinceId)}. ${lord} was the first to fall. The halls went dark, and those who survived sealed the tunnel and did not speak of what they had found.`;
    }

    // --- Perception / madness layer ---
    case "MADNESS_ONSET":
      return `${who(w, ev.actorId)} broke from reason, consumed by ${ev.data["distortion"] ?? "madness"}.`;

    // --- Diplomacy layer ---
    case "TRUCE":
      return `${who(w, ev.actorId)} and ${who(w, ev.targetId)} sealed a truce — the war between them laid to rest for ${ev.data["years"]} years.`;

    case "ALLIANCE_FORMED":
      return `${who(w, ev.actorId)} and ${who(w, ev.targetId)} swore a pact of mutual defence.`;

    case "TRUCE_BROKEN":
      return `${who(w, ev.actorId)} spurned the peace and broke the truce with ${who(w, ev.targetId)}.`;

    case "ALLIANCE_BETRAYED":
      return `${who(w, ev.actorId)} betrayed the pact, turning blade against ${who(w, ev.targetId)}, their sworn ally.`;

    default:
      return `[${ev.type}]`;
  }
}

// Temporal level-of-detail: history is a cone of detail — the present is sharp,
// the deep past compresses into a few remembered threads and then into myth.
// We render three zones by age from the last simulated year:
//   • LIVING MEMORY (recent)   — individual dated events, full detail
//   • THE CHRONICLE (older)    — one line per story ARC (the thread, not events)
//   • AGES OF LEGEND (ancient) — arcs aggregated into century-eras, terse
// Old threads are also FORGOTTEN unless big or still-relevant: an arc's
// remembered strength decays with age but is kept alive if it still touches a
// surviving house or a title still held (the winners' history endures).
export interface LayeredOpts {
  living?: number; // living-memory window in years (default 70)
  chronicle?: number; // chronicle window in years (default 160)
  arcDecay?: number; // remembered-significance lost per year of age (default 0.2)
  focus?: FocusContext; // when set, prepend a focus banner to the output
}

export function renderLayeredChronicle(
  w: World,
  events: WorldEvent[],
  arcs: Arc[],
  opts: LayeredOpts = {},
): string {
  const now = w.year;
  const W1 = opts.living ?? 70;
  const W2 = opts.chronicle ?? 160;
  const decay = opts.arcDecay ?? 0.2;

  const byId = new Map<number, WorldEvent>(events.map((e) => [e.id, e]));
  const surviving = new Set<string>();
  for (const dy of w.dynasties.values()) {
    if (dy.extinctYear === null && w.dynastyMembers(dy.id).length > 0) surviving.add(dy.id);
  }

  // Does this arc still connect to the present (a surviving house, a held title)?
  const touchesPresent = (arc: Arc): boolean =>
    arc.eventIds.some((id) => {
      const ev = byId.get(id);
      if (!ev) return false;
      for (const cid of [ev.actorId, ev.targetId]) {
        const c = w.char(cid);
        if (c && surviving.has(c.dynastyId)) return true;
      }
      const t = w.title(ev.titleId);
      return !!(t && t.holderId);
    });

  // Remembered strength: significance, decayed by age, kept alive by relevance.
  const remembered = (arc: Arc): number => {
    const mid = (arc.startYear + arc.endYear) / 2;
    return arc.significance - decay * (now - mid) + (touchesPresent(arc) ? 12 : 0);
  };

  const bareTitle = (t: string) => t.replace(/\s*\([0-9–-]+\)\s*$/, "");
  const out: string[] = [];

  // Focus banner — precedes all chronicle sections when a focus is active.
  if (opts.focus) {
    out.push("═".repeat(64), `FOCUS: ${opts.focus.label}`, "═".repeat(64));
  }

  // ── AGES OF LEGEND — the deep past: mythic events + arc-eras by century ──
  // Prehistory LEGEND events form the mythic backbone; ordinary ancient arcs
  // (from the simulated deep past) aggregate into terse century lines beneath.
  const ancientLegends = events
    .filter((e) => now - e.year > W2 && e.type === "LEGEND")
    .sort((a, b) => a.year - b.year || a.id - b.id);
  const ancient = arcs.filter((a) => now - a.endYear > W2 && remembered(a) >= 18);
  if (ancientLegends.length || ancient.length) {
    out.push("─".repeat(64), "AGES OF LEGEND", "─".repeat(64));
    for (const ev of ancientLegends) out.push(`  ${renderEvent(w, ev)}`);
    if (ancient.length) {
      if (ancientLegends.length) out.push("");
      const buckets = new Map<number, Arc[]>();
      for (const a of ancient) {
        const c = Math.floor(a.startYear / 100) * 100;
        let b = buckets.get(c);
        if (!b) buckets.set(c, (b = []));
        b.push(a);
      }
      for (const c of [...buckets.keys()].sort((x, y) => x - y)) {
        const top = buckets
          .get(c)!
          .sort((x, y) => remembered(y) - remembered(x))
          .slice(0, 2);
        out.push(`  the ${c}s — ${top.map((a) => bareTitle(a.title)).join("; ")}.`);
      }
    }
  }

  // ── THE CHRONICLE — arcs in the middle window, one summary line each ─────
  const chronicled = arcs
    .filter((a) => {
      const age = now - a.endYear;
      return age > W1 && age <= W2 && remembered(a) >= 20;
    })
    .sort((x, y) => x.startYear - y.startYear || y.significance - x.significance);
  if (chronicled.length) {
    if (out.length) out.push("");
    out.push("─".repeat(64), "THE CHRONICLE", "─".repeat(64));
    for (const a of chronicled) out.push(`  ${a.title}`);
  }

  // ── LIVING MEMORY — individual events within the recent window ───────────
  const living = events.filter((e) => now - e.year <= W1);
  if (living.length) {
    if (out.length) out.push("");
    out.push("─".repeat(64), `LIVING MEMORY (${living[0].year}–${now})`, "─".repeat(64));
    let lastYear = -Infinity;
    for (const ev of living) {
      if (ev.year !== lastYear) {
        out.push("");
        lastYear = ev.year;
      }
      out.push(`${String(ev.year).padStart(4, " ")}  ${renderEvent(w, ev)}`);
    }
  }

  return out.join("\n");
}

// Render the whole selected chronicle as dated lines, grouped by year (the flat,
// no-LOD view; --flat).
export function renderChronicle(w: World, events: WorldEvent[]): string {
  const lines: string[] = [];
  let lastYear = -Infinity;
  for (const ev of events) {
    if (ev.year !== lastYear) {
      lines.push(""); // blank line between years for readability
      lastYear = ev.year;
    }
    lines.push(`${String(ev.year).padStart(4, " ")}  ${renderEvent(w, ev)}`);
  }
  return lines.join("\n");
}

// A short closing summary so the run ends with a sense of where the world
// landed — surviving houses, who sits the thrones, the mood of the land.
export function renderEpilogue(w: World): string {
  const lines: string[] = ["", "═".repeat(64), `THE WORLD IN ${w.year}`, "─".repeat(64)];

  const livingHouses = [...w.dynasties.values()].filter(
    (dyn) => dyn.extinctYear === null && w.dynastyMembers(dyn.id).length > 0,
  );

  for (const t of w.titles.values()) {
    if (t.tier !== "kingdom") continue;
    const holder = w.char(t.holderId) as Character | undefined;
    const seat = provName(w, t.provinceId);
    lines.push(
      holder
        ? `${t.name} (${seat}) — held by ${who(w, holder.id)}, aged ${w.age(holder)}.`
        : `${t.name} (${seat}) — vacant, its throne contested.`,
    );
  }

  lines.push("─".repeat(64));
  const houseNames = [...new Set(livingHouses.map((h) => h.name))];
  lines.push(
    `Surviving houses of note: ${houseNames.slice(0, 12).join(", ") || "none"}.`,
  );

  // Magic layer: who ended the age as its mightiest, and which arts still live.
  if (w.magicEnabled) {
    lines.push("─".repeat(64));
    const heroes = topHeroes(w, 6);
    if (heroes.length) {
      lines.push("Mightiest of the age:");
      for (const h of heroes) {
        const seat = w.titlesHeldBy(h.id)[0];
        const role = seat ? `holds ${seat.name}` : h.lowborn ? "lowborn" : "landless";
        lines.push(
          `  ${who(w, h.id)} — ${h.charClass} lvl ${h.level}, aged ${w.age(h)} (${role}).`,
        );
      }
    }
    const rites = [...w.dynasties.values()].filter((dy) => dy.rite);
    lines.push(
      `Living arts: ${
        rites.length
          ? rites.map((dy) => `${dy.rite} (House ${dy.name})`).join(", ")
          : "all lost"
      }.`,
    );
  }

  lines.push(`Total recorded events: ${w.events.length}.`);
  return lines.join("\n");
}
