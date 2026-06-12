// render.ts — the STUB renderer. Turns canonical events into chronicle prose
// with deterministic templates. No LLM: this runs offline, free, and instant,
// so we can iterate on whether the SIMULATION has the right texture before
// spending a token. When Claude is wired in later, it replaces this file and
// nothing else — the event log it reads is identical.
//
// Design note: the renderer is a pure function of canonical state. It invents
// no facts (that would corrupt canon); it only phrases facts the sim recorded.

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

    default:
      return `[${ev.type}]`;
  }
}

// Render the whole selected chronicle as dated lines, grouped by year.
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
  lines.push(`Total recorded events: ${w.events.length}.`);
  return lines.join("\n");
}
