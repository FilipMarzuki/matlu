// specs/lost-peoples-events.ts — 12 "displaced peoples" specs.
//
// Groups from pre-medieval to medieval Earth history arrive in Matlu with no
// memory of their origin — they know their training, their tongue, their
// gods, but not the world they came from. Each event spawns a fresh dynasty
// with a themed founder, a small retinue of adults, and appropriate classes
// and drives. The dynasty joins the sim as a first-class house.
//
// Historical note: kept to pre-Columbian Old World (Roman → Norman era, with
// classical antiquity and Iron Age represented). No 15th-century-and-later
// groups (no Aztec, no Zulu, no Ottoman).
//
// Each event fires ONCE per world (`once: "world"`). Very low per-tick
// probability — these are hinge moments, not weekly weather. Year gate keeps
// them out of the world's founding decades.

import type { EventSpec } from "../event-spec.js";
import { createCharacter, createDynasty } from "../people.js";
import type { CharClass, Drives, Province, Sex } from "../types.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "an unknown place";
}
function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}

// ---------------------------------------------------------------------------
// Spawning helper — used by every LOST_X event to actually plant the group.
// ---------------------------------------------------------------------------

interface LostPeopleSpawn {
  eventType: string;
  dynastyName: string;
  culture: string;   // matches an existing world culture id or "" for none
  race: string;      // matches an existing world race id or "" for none
  faith: string;     // matches an existing world faith id or "" for none
  namesMale: string[];
  namesFemale: string[];
  founderClass: CharClass;
  retinueClass: CharClass;
  retinueSize: number;   // total adults spawned, including founder
  founderLevel: number;
  retinueLevel: number;
  founderDrives: Drives;
  retinueDrives: Drives;
  eligibleTerrain: (t: string) => boolean;
  minYear: number;
  // Set true for seafaring groups (Viking, Carthaginian) — restricts pickProvince
  // to provinces with coastal=true, so we don't create a dynasty on a landlocked
  // tile only to bail out post-hoc and leak orphan characters into the world.
  coastalRequired?: boolean;
}

// Pick a fitting province: surface, no active blight-lock, matches terrain
// predicate (and coastal if required), and PREFER an unclaimed one (no
// title-holder). Falls back to any eligible province if all are claimed.
function pickProvince(w: World, spec: LostPeopleSpawn): Province | null {
  const eligible = [...w.provinces.values()].filter(
    (p) => !p.subsurface && !p.zoneFlags.includes("dead_zone")
        && spec.eligibleTerrain(p.terrain)
        && (!spec.coastalRequired || p.coastal),
  );
  if (eligible.length === 0) return null;
  // Prefer provinces whose title has no holder (a vacuum for the newcomers).
  const withTitles = new Map<string, boolean>();
  for (const t of w.titles.values()) {
    withTitles.set(t.provinceId, !!t.holderId);
  }
  const vacant = eligible.filter((p) => !withTitles.get(p.id));
  const pool = vacant.length > 0 ? vacant : eligible;
  return w.rng.pick(pool);
}

function spawnLostPeople(w: World, spec: LostPeopleSpawn): { founderId: string; provinceId: string } | null {
  const prov = pickProvince(w, spec);
  if (!prov) return null;

  // Create the dynasty with a temporary placeholder for founder.
  const dyn = createDynasty(w, spec.dynastyName, "", {
    culture: spec.culture || undefined,
    race:    spec.race    || undefined,
    faith:   spec.faith   || undefined,
  });

  // The founder — always the first character, male by default (adjust drives
  // if you want more variety, but historically these were male-led groups).
  const founderName = w.rng.pick(spec.namesMale);
  const founder = createCharacter(w, {
    name:       founderName,
    sex:        "male",
    dynastyId:  dyn.id,
    birthYear:  w.year - w.rng.int(30, 45),
    provinceId: prov.id,
    drives:     spec.founderDrives,
  });
  dyn.founderId = founder.id;
  founder.charClass = spec.founderClass;
  founder.level = spec.founderLevel;

  // The retinue — spawn `retinueSize - 1` more adults.
  for (let i = 1; i < spec.retinueSize; i++) {
    const sex: Sex = w.rng.chance(0.75) ? "male" : "female";
    const pool = sex === "male" ? spec.namesMale : spec.namesFemale;
    const c = createCharacter(w, {
      name:       w.rng.pick(pool),
      sex,
      dynastyId:  dyn.id,
      birthYear:  w.year - w.rng.int(22, 40),
      provinceId: prov.id,
      drives:     spec.retinueDrives,
    });
    c.charClass = spec.retinueClass;
    c.level = spec.retinueLevel;
  }

  return { founderId: founder.id, provinceId: prov.id };
}

// Drives helper — [ambition, greed, vengeance, piety, lust, fear] to match
// the standard order used elsewhere in the codebase.
function D(a: number, g: number, v: number, p: number, l: number, f: number): Drives {
  return { ambition: a, greed: g, vengeance: v, piety: p, lust: l, fear: f };
}

// ---------------------------------------------------------------------------
// LOST_ROMAN_LEGION — disciplined soldiers, Latin names
// ---------------------------------------------------------------------------
const ROMAN_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_ROMAN_LEGION",
  dynastyName: "Aquilifer",
  culture: "", race: "", faith: "",
  namesMale:   ["Marcus", "Gaius", "Titus", "Lucius", "Quintus", "Vibius", "Cassius", "Sextus", "Aulus", "Publius"],
  namesFemale: ["Livia", "Cornelia", "Julia", "Octavia", "Valeria", "Aurelia", "Antonia", "Claudia"],
  founderClass: "knight",  retinueClass: "soldier",
  retinueSize: 6, founderLevel: 12, retinueLevel: 8,
  founderDrives: D(0.65, 0.35, 0.45, 0.4, 0.4, 0.2),   // ambitious, iron-willed
  retinueDrives: D(0.55, 0.4, 0.4, 0.35, 0.4, 0.25),   // disciplined
  eligibleTerrain: (t) => t === "plains" || t === "hills" || t === "meadow",
  minYear: 80,
};

const LOST_ROMAN_LEGION: EventSpec = {
  type: "LOST_ROMAN_LEGION",
  base: 10,
  render: (ev, w) => {
    const founder = charName(w, ev.actorId);
    return `A Roman legion, standards and eagles intact, marched out of a strange wood near ${provName(w, ev.provinceId)}. ${founder} led them; they knew no world past the ides of a year they could not name.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => w.year > ROMAN_SPAWN.minYear,
    prob: () => 0.0008,
    fire: (w) => {
      const res = spawnLostPeople(w, ROMAN_SPAWN);
      if (!res) return;
      w.log("LOST_ROMAN_LEGION", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// LOST_VIKING_EXPEDITION — longship raiders on the coast
// ---------------------------------------------------------------------------
const VIKING_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_VIKING_EXPEDITION",
  dynastyName: "Bjornsson",
  culture: "", race: "", faith: "",
  namesMale:   ["Bjorn", "Erik", "Ragnar", "Ivar", "Sten", "Ulf", "Harald", "Sigurd", "Ketil", "Rurik"],
  namesFemale: ["Astrid", "Sigrid", "Freya", "Gudrun", "Runa", "Ylva", "Solveig", "Ingrid"],
  founderClass: "knight",  retinueClass: "soldier",
  retinueSize: 5, founderLevel: 11, retinueLevel: 7,
  founderDrives: D(0.75, 0.7, 0.5, 0.35, 0.5, 0.15),   // hungry, fearless
  retinueDrives: D(0.6, 0.65, 0.45, 0.3, 0.5, 0.2),
  eligibleTerrain: (t) => t === "coast" || t === "plains" || t === "meadow",
  minYear: 90,
  coastalRequired: true, // ensure pickProvince returns a coastal tile
};

const LOST_VIKING_EXPEDITION: EventSpec = {
  type: "LOST_VIKING_EXPEDITION",
  base: 10,
  render: (ev, w) => {
    const founder = charName(w, ev.actorId);
    return `A longship put in at ${provName(w, ev.provinceId)} bearing men from a north no map remembered. ${founder} stepped ashore with axe and dragon-brooch; they had rowed too long, and forgotten where.`;
  },
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => {
      if (w.year <= VIKING_SPAWN.minYear) return false;
      // Require at least one coastal province exists (pickProvince enforces it too).
      return [...w.provinces.values()].some((p) => p.coastal && !p.subsurface);
    },
    prob: () => 0.0008,
    fire: (w) => {
      const res = spawnLostPeople(w, VIKING_SPAWN);
      if (!res) return;
      w.log("LOST_VIKING_EXPEDITION", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// LOST_MONGOL_TUMEN — horse archers on the steppe
// ---------------------------------------------------------------------------
const MONGOL_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_MONGOL_TUMEN",
  dynastyName: "Temujin",
  culture: "", race: "", faith: "",
  namesMale:   ["Temur", "Ghazan", "Batu", "Kublai", "Orhan", "Bahadur", "Altan", "Berke", "Kaan", "Ogedei"],
  namesFemale: ["Sabah", "Nur", "Roxana", "Yildiz", "Zara", "Gul", "Aynur", "Perizad"],
  founderClass: "knight",  retinueClass: "hunter",
  retinueSize: 6, founderLevel: 12, retinueLevel: 8,
  founderDrives: D(0.85, 0.7, 0.6, 0.2, 0.55, 0.1),    // conquering
  retinueDrives: D(0.7, 0.6, 0.5, 0.15, 0.5, 0.15),
  eligibleTerrain: (t) => t === "steppe" || t === "plains" || t === "hills",
  minYear: 100,
};

const LOST_MONGOL_TUMEN: EventSpec = {
  type: "LOST_MONGOL_TUMEN",
  base: 10,
  render: (ev, w) => `A tumen of horse-archers rode out of the deep steppe near ${provName(w, ev.provinceId)}. ${charName(w, ev.actorId)} was their khan; the herds had wandered so far that even the stars looked unfamiliar.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => w.year > MONGOL_SPAWN.minYear,
    prob: () => 0.0007,
    fire: (w) => {
      const res = spawnLostPeople(w, MONGOL_SPAWN);
      if (!res) return;
      w.log("LOST_MONGOL_TUMEN", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// LOST_GREEK_HOPLITES — phalanx of city-state warriors
// ---------------------------------------------------------------------------
const GREEK_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_GREEK_HOPLITES",
  dynastyName: "Aristides",
  culture: "", race: "", faith: "",
  namesMale:   ["Leonidas", "Aristides", "Themistocles", "Alcibiades", "Xenophon", "Kleon", "Perikles", "Nikias", "Demetrios", "Alexios"],
  namesFemale: ["Aspasia", "Hipparete", "Xanthippe", "Kleoboule", "Timandra", "Diotima"],
  founderClass: "knight",  retinueClass: "soldier",
  retinueSize: 7, founderLevel: 11, retinueLevel: 7,
  founderDrives: D(0.55, 0.3, 0.5, 0.45, 0.4, 0.2),
  retinueDrives: D(0.5, 0.3, 0.45, 0.4, 0.4, 0.2),
  eligibleTerrain: (t) => t === "hills" || t === "meadow" || t === "plains" || t === "coast",
  minYear: 80,
};

const LOST_GREEK_HOPLITES: EventSpec = {
  type: "LOST_GREEK_HOPLITES",
  base: 10,
  render: (ev, w) => `A phalanx of hoplites stood upon the ridge above ${provName(w, ev.provinceId)}, bronze aspis raised. ${charName(w, ev.actorId)} spoke of their polis but could not name a single street of it.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => w.year > GREEK_SPAWN.minYear,
    prob: () => 0.0007,
    fire: (w) => {
      const res = spawnLostPeople(w, GREEK_SPAWN);
      if (!res) return;
      w.log("LOST_GREEK_HOPLITES", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// LOST_EGYPTIAN_PRIESTHOOD — a priest-caste from the Nile
// ---------------------------------------------------------------------------
const EGYPTIAN_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_EGYPTIAN_PRIESTHOOD",
  dynastyName: "Amonhotep",
  culture: "", race: "", faith: "",
  namesMale:   ["Amonhotep", "Ptahhotep", "Merenptah", "Thutmose", "Setnakht", "Neferhotep", "Khaemwaset", "Rahotep"],
  namesFemale: ["Nefertiti", "Meritaten", "Sitre", "Ahhotep", "Kiya", "Tuya", "Neithhotep"],
  founderClass: "scholar", retinueClass: "scholar",
  retinueSize: 4, founderLevel: 10, retinueLevel: 6,
  founderDrives: D(0.4, 0.35, 0.3, 0.85, 0.4, 0.3),    // priestly, mystical
  retinueDrives: D(0.35, 0.3, 0.3, 0.8, 0.35, 0.3),
  eligibleTerrain: (t) => t === "desert" || t === "plains",
  minYear: 80,
};

const LOST_EGYPTIAN_PRIESTHOOD: EventSpec = {
  type: "LOST_EGYPTIAN_PRIESTHOOD",
  base: 10,
  render: (ev, w) => `A priest-caste bearing the linen and lapis of an unknown Nile arrived at ${provName(w, ev.provinceId)}. ${charName(w, ev.actorId)} led them; the rites they carried had no altars anywhere in this world.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => w.year > EGYPTIAN_SPAWN.minYear,
    prob: () => 0.0006,
    fire: (w) => {
      const res = spawnLostPeople(w, EGYPTIAN_SPAWN);
      if (!res) return;
      w.log("LOST_EGYPTIAN_PRIESTHOOD", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// LOST_CELTIC_WARBAND — Iron Age warriors from the forest
// ---------------------------------------------------------------------------
const CELTIC_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_CELTIC_WARBAND",
  dynastyName: "Vercingetorix",
  culture: "", race: "", faith: "",
  namesMale:   ["Vercingetorix", "Ambiorix", "Brennus", "Caswallon", "Dumnorix", "Caractacus", "Cunobelinus", "Bran", "Owain", "Rhydderch"],
  namesFemale: ["Boudicca", "Cartimandua", "Blodwen", "Aoife", "Deirdre", "Fionnuala", "Rhiannon"],
  founderClass: "knight",  retinueClass: "hunter",
  retinueSize: 5, founderLevel: 10, retinueLevel: 6,
  founderDrives: D(0.6, 0.4, 0.7, 0.5, 0.5, 0.2),      // vengeful, honourable
  retinueDrives: D(0.55, 0.4, 0.65, 0.45, 0.5, 0.2),
  eligibleTerrain: (t) => t === "forest" || t === "hills" || t === "jungle",
  minYear: 80,
};

const LOST_CELTIC_WARBAND: EventSpec = {
  type: "LOST_CELTIC_WARBAND",
  base: 10,
  render: (ev, w) => `A warband, blue-woaded and tattooed, stepped out of the mists near ${provName(w, ev.provinceId)}. ${charName(w, ev.actorId)} spoke of oaths and druids and a green isle no ship had ever found.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => w.year > CELTIC_SPAWN.minYear,
    prob: () => 0.0006,
    fire: (w) => {
      const res = spawnLostPeople(w, CELTIC_SPAWN);
      if (!res) return;
      w.log("LOST_CELTIC_WARBAND", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// LOST_SAMURAI_RETINUE — feudal knights bound by an ancient code
// ---------------------------------------------------------------------------
const SAMURAI_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_SAMURAI_RETINUE",
  dynastyName: "Yamato",
  culture: "", race: "", faith: "",
  namesMale:   ["Takeda", "Sanada", "Oda", "Mori", "Uesugi", "Date", "Yamamoto", "Miyamoto", "Ishida", "Tokugawa"],
  namesFemale: ["Nene", "Chacha", "Kaede", "Aoi", "Sakura", "Yuki", "Rin", "Hana"],
  founderClass: "knight",  retinueClass: "knight",
  retinueSize: 4, founderLevel: 13, retinueLevel: 9,
  founderDrives: D(0.55, 0.25, 0.55, 0.55, 0.4, 0.15),  // honor-bound
  retinueDrives: D(0.5, 0.25, 0.5, 0.5, 0.4, 0.15),
  eligibleTerrain: (t) => t === "hills" || t === "forest" || t === "meadow" || t === "mountain",
  minYear: 120,
};

const LOST_SAMURAI_RETINUE: EventSpec = {
  type: "LOST_SAMURAI_RETINUE",
  base: 10,
  render: (ev, w) => `A retinue bearing katana and daisho appeared upon the road to ${provName(w, ev.provinceId)}. ${charName(w, ev.actorId)} spoke of an emperor, and bowed once at nothing, and would not say why.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => w.year > SAMURAI_SPAWN.minYear,
    prob: () => 0.0005,
    fire: (w) => {
      const res = spawnLostPeople(w, SAMURAI_SPAWN);
      if (!res) return;
      w.log("LOST_SAMURAI_RETINUE", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// LOST_BYZANTINE_CATAPHRACTS — heavy cavalry from the Eastern Rome
// ---------------------------------------------------------------------------
const BYZANTINE_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_BYZANTINE_CATAPHRACTS",
  dynastyName: "Komnenos",
  culture: "", race: "", faith: "",
  namesMale:   ["Alexios", "Manuel", "Isaakios", "Ioannes", "Konstantinos", "Basileios", "Nikephoros", "Georgios", "Theodoros", "Michael"],
  namesFemale: ["Anna", "Eirene", "Zoe", "Maria", "Theodora", "Sophia", "Eudokia"],
  founderClass: "knight",  retinueClass: "knight",
  retinueSize: 5, founderLevel: 12, retinueLevel: 9,
  founderDrives: D(0.6, 0.4, 0.5, 0.6, 0.4, 0.25),
  retinueDrives: D(0.55, 0.4, 0.45, 0.55, 0.4, 0.25),
  eligibleTerrain: (t) => t === "plains" || t === "hills" || t === "meadow" || t === "coast",
  minYear: 120,
};

const LOST_BYZANTINE_CATAPHRACTS: EventSpec = {
  type: "LOST_BYZANTINE_CATAPHRACTS",
  base: 10,
  render: (ev, w) => `Riders in scaled armour, with icons of a purple-clad emperor upon their shields, appeared at ${provName(w, ev.provinceId)}. ${charName(w, ev.actorId)} sought a City that had never been found on any map here.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => w.year > BYZANTINE_SPAWN.minYear,
    prob: () => 0.0005,
    fire: (w) => {
      const res = spawnLostPeople(w, BYZANTINE_SPAWN);
      if (!res) return;
      w.log("LOST_BYZANTINE_CATAPHRACTS", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// LOST_PERSIAN_IMMORTALS — Achaemenid elite guard
// ---------------------------------------------------------------------------
const PERSIAN_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_PERSIAN_IMMORTALS",
  dynastyName: "Achaemenid",
  culture: "", race: "", faith: "",
  namesMale:   ["Darius", "Xerxes", "Cyrus", "Cambyses", "Artaxerxes", "Bardiya", "Hydarnes", "Mardonius", "Datis", "Otanes"],
  namesFemale: ["Atossa", "Roxana", "Parysatis", "Amestris", "Stateira", "Sisygambis"],
  founderClass: "knight",  retinueClass: "soldier",
  retinueSize: 6, founderLevel: 12, retinueLevel: 8,
  founderDrives: D(0.55, 0.4, 0.5, 0.5, 0.4, 0.15),
  retinueDrives: D(0.5, 0.35, 0.45, 0.45, 0.4, 0.15),
  eligibleTerrain: (t) => t === "plains" || t === "desert" || t === "hills",
  minYear: 90,
};

const LOST_PERSIAN_IMMORTALS: EventSpec = {
  type: "LOST_PERSIAN_IMMORTALS",
  base: 10,
  render: (ev, w) => `A company that called itself Immortal made camp near ${provName(w, ev.provinceId)}. ${charName(w, ev.actorId)} led them, and the ten thousand did not include a single face they could remember from home.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => w.year > PERSIAN_SPAWN.minYear,
    prob: () => 0.0006,
    fire: (w) => {
      const res = spawnLostPeople(w, PERSIAN_SPAWN);
      if (!res) return;
      w.log("LOST_PERSIAN_IMMORTALS", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// LOST_CARTHAGINIAN_FLEET — Phoenician merchants on the coast
// ---------------------------------------------------------------------------
const CARTHAGE_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_CARTHAGINIAN_FLEET",
  dynastyName: "Barcid",
  culture: "", race: "", faith: "",
  namesMale:   ["Hannibal", "Hasdrubal", "Hamilcar", "Mago", "Bomilcar", "Gisco", "Hanno", "Himilco", "Adherbal", "Mathos"],
  namesFemale: ["Sophonisba", "Salammbo", "Elissa", "Dido"],
  founderClass: "merchant", retinueClass: "merchant",
  retinueSize: 5, founderLevel: 10, retinueLevel: 6,
  founderDrives: D(0.6, 0.75, 0.4, 0.45, 0.4, 0.3),    // trader, sharp
  retinueDrives: D(0.5, 0.7, 0.4, 0.4, 0.4, 0.3),
  eligibleTerrain: (t) => t === "coast" || t === "plains",
  minYear: 90,
  coastalRequired: true, // ensure pickProvince returns a coastal tile
};

const LOST_CARTHAGINIAN_FLEET: EventSpec = {
  type: "LOST_CARTHAGINIAN_FLEET",
  base: 10,
  render: (ev, w) => `A fleet of purple-sailed traders anchored at ${provName(w, ev.provinceId)}, laden with silver, dyes, and rites for a horned god the shore had never heard named. ${charName(w, ev.actorId)} led their council.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => {
      if (w.year <= CARTHAGE_SPAWN.minYear) return false;
      return [...w.provinces.values()].some((p) => p.coastal && !p.subsurface);
    },
    prob: () => 0.0006,
    fire: (w) => {
      const res = spawnLostPeople(w, CARTHAGE_SPAWN);
      if (!res) return;
      w.log("LOST_CARTHAGINIAN_FLEET", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// LOST_NORMAN_KNIGHTS — feudal cavalry
// ---------------------------------------------------------------------------
const NORMAN_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_NORMAN_KNIGHTS",
  dynastyName: "Guiscard",
  culture: "", race: "", faith: "",
  namesMale:   ["Robert", "Guillaume", "Roger", "Bohemond", "Tancred", "Fulk", "Baldwin", "Godefroy", "Renaud", "Hugues"],
  namesFemale: ["Adela", "Adeliza", "Isabelle", "Alix", "Constance", "Emma", "Mathilde"],
  founderClass: "knight",  retinueClass: "knight",
  retinueSize: 4, founderLevel: 12, retinueLevel: 9,
  founderDrives: D(0.75, 0.55, 0.5, 0.5, 0.4, 0.2),    // ambitious
  retinueDrives: D(0.65, 0.5, 0.45, 0.5, 0.4, 0.2),
  eligibleTerrain: (t) => t === "meadow" || t === "plains" || t === "hills" || t === "coast",
  minYear: 120,
};

const LOST_NORMAN_KNIGHTS: EventSpec = {
  type: "LOST_NORMAN_KNIGHTS",
  base: 10,
  render: (ev, w) => `Mounted knights bearing kite-shields and long lances rode down upon ${provName(w, ev.provinceId)}. ${charName(w, ev.actorId)} spoke of a duke and a channel and a coronation they could not date.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => w.year > NORMAN_SPAWN.minYear,
    prob: () => 0.0006,
    fire: (w) => {
      const res = spawnLostPeople(w, NORMAN_SPAWN);
      if (!res) return;
      w.log("LOST_NORMAN_KNIGHTS", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// LOST_HAN_EXPEDITION — classical Chinese diplomatic/martial party
// ---------------------------------------------------------------------------
const HAN_SPAWN: LostPeopleSpawn = {
  eventType: "LOST_HAN_EXPEDITION",
  dynastyName: "Liu",
  culture: "", race: "", faith: "",
  namesMale:   ["Liu", "Wei", "Ban", "Zhang", "Cao", "Sun", "Zhuge", "Guan", "Zhao", "Ma"],
  namesFemale: ["Ban Zhao", "Wu Zetian", "Cai Yan", "Diao Chan", "Xi Shi", "Wang Zhaojun"],
  founderClass: "scholar", retinueClass: "soldier",
  retinueSize: 5, founderLevel: 11, retinueLevel: 7,
  founderDrives: D(0.5, 0.35, 0.4, 0.55, 0.4, 0.25),    // scholarly diplomatic
  retinueDrives: D(0.45, 0.35, 0.4, 0.5, 0.4, 0.25),
  eligibleTerrain: (t) => t === "plains" || t === "meadow" || t === "hills",
  minYear: 90,
};

const LOST_HAN_EXPEDITION: EventSpec = {
  type: "LOST_HAN_EXPEDITION",
  base: 10,
  render: (ev, w) => `A silk-clad embassy carrying a bronze seal and quivers of iron-tipped arrows arrived at ${provName(w, ev.provinceId)}. ${charName(w, ev.actorId)} bore a scroll addressed to an Emperor whose name had never been recorded here.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => w.year > HAN_SPAWN.minYear,
    prob: () => 0.0006,
    fire: (w) => {
      const res = spawnLostPeople(w, HAN_SPAWN);
      if (!res) return;
      w.log("LOST_HAN_EXPEDITION", { actorId: res.founderId, provinceId: res.provinceId });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
export const LOST_PEOPLES_SPECS: EventSpec[] = [
  LOST_ROMAN_LEGION,
  LOST_VIKING_EXPEDITION,
  LOST_MONGOL_TUMEN,
  LOST_GREEK_HOPLITES,
  LOST_EGYPTIAN_PRIESTHOOD,
  LOST_CELTIC_WARBAND,
  LOST_SAMURAI_RETINUE,
  LOST_BYZANTINE_CATAPHRACTS,
  LOST_PERSIAN_IMMORTALS,
  LOST_CARTHAGINIAN_FLEET,
  LOST_NORMAN_KNIGHTS,
  LOST_HAN_EXPEDITION,
];
