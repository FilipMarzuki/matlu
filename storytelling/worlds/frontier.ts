// worlds/frontier.ts — the Ibiki heartland and its frontier, as data.
//
// The lush green CENTER (meadow + forest) is the Ibiki homeland — the seat of
// most of the story and intrigue. It is ringed by frontier peoples:
//
//                      IRONSPINE (mountains, N) — ridgefolk clans
//                              ▲
//   SALTMERE (ocean, W) ◀──  ★ IBIKI HEARTLAND ★  ──▶ ASHEN STEPPE (E)
//   coastborn                 meadow + forest          orc/human HORDE
//                              (the story)               │
//                              ▼                         ▼  beyond the desert:
//                      MIREWOOD (swamp/jungle, S)    EMPIRE OF ZAFRAN (settled)
//
// Every frontier people has its own CULTURE (names + temperament + law), RACE
// (human, or the Horde's orcs), and FAITH (a holy-war / grudge axis). The Ibiki
// centre holds TWO rival houses — royal Aeryn and the elder-line Doriel, who
// claim the throne — so the densest intrigue is at home. The steppe Horde
// claims both a Zafran border satrapy AND an Ibiki meadow (the raids press on
// the heartland), and its orcs claim the Khaganate from their human Khagan.

import type {
  CharacterSpec,
  CultureSpec,
  DynastySpec,
  FaithSpec,
  ProvinceSpec,
  RaceSpec,
  TitleSpec,
  WorldSpec,
} from "../world-spec.js";
import type { Sex } from "../types.js";

const D = (a: number, g: number, v: number, p: number, l: number, f: number): number[] => [a, g, v, p, l, f];

function ch(
  o: {
    id: string;
    name: string;
    sex: Sex;
    dynasty: string;
    birthYear: number;
    province: string;
    drives: number[];
  } & Partial<CharacterSpec>,
): CharacterSpec {
  return { father: null, mother: null, spouse: null, founds: null, holds: null, claims: [], ...o };
}

// ── Geography: the Ibiki hub (i*) ringed by frontier provinces (p*) ──────────
const provinces: ProvinceSpec[] = [
  // Ibiki heartland — the lush green centre, densest and richest.
  { id: "i0", name: "Ibiki Vale", terrain: "meadow", fertility: 0.9, coastal: false, river: true, neighbors: ["i1", "i2", "i3", "i4"], population: 720, mana: 0.35 },
  { id: "i1", name: "Sunmeadow", terrain: "meadow", fertility: 0.85, coastal: false, river: false, neighbors: ["i0", "i4", "i3", "p6"], population: 640, mana: 0.3 },
  { id: "i2", name: "Elmwood", terrain: "forest", fertility: 0.7, coastal: false, river: false, neighbors: ["i0", "i4", "i3", "p0", "p1"], population: 500, mana: 0.4 },
  { id: "i3", name: "Rivenbrook", terrain: "plains", fertility: 0.8, coastal: false, river: true, neighbors: ["i0", "i2", "i1", "p11"], population: 560, mana: 0.3 },
  { id: "i4", name: "Thornwood", terrain: "forest", fertility: 0.65, coastal: false, river: false, neighbors: ["i0", "i1", "i2", "p4"], population: 420, mana: 0.45 },
  // Saltmere — the ocean coast (west).
  { id: "p0", name: "Saltmere", terrain: "coast", fertility: 0.6, coastal: true, river: true, neighbors: ["p1", "i2"], population: 500, mana: 0.3 },
  { id: "p1", name: "Gullhaven", terrain: "coast", fertility: 0.55, coastal: true, river: false, neighbors: ["p0", "i2"], population: 400, mana: 0.3 },
  // The Ironspine — the mountain wall (north).
  { id: "p4", name: "Ironspine", terrain: "mountain", fertility: 0.35, coastal: false, river: false, neighbors: ["p5", "i4"], population: 130, mana: 0.8 },
  { id: "p5", name: "Highpass", terrain: "mountain", fertility: 0.3, coastal: false, river: false, neighbors: ["p4", "p6"], population: 90, mana: 0.75 },
  // The Ashen Steppe + deserts — the raider frontier (east).
  { id: "p6", name: "Ashen Steppe", terrain: "steppe", fertility: 0.35, coastal: false, river: true, neighbors: ["p5", "p7", "p8", "i1"], population: 300, mana: 0.6 },
  { id: "p7", name: "Sunscour", terrain: "desert", fertility: 0.2, coastal: false, river: false, neighbors: ["p6", "p8", "p9"], population: 130, mana: 0.55 },
  { id: "p8", name: "Dunemarch", terrain: "desert", fertility: 0.25, coastal: false, river: false, neighbors: ["p6", "p7", "p9", "p10", "p12"], population: 160, mana: 0.5 },
  // The Empire of Zafran — settled humans beyond the desert (far east).
  { id: "p9", name: "Zafran", terrain: "plains", fertility: 0.85, coastal: false, river: true, neighbors: ["p7", "p8", "p10"], population: 720, mana: 0.2 },
  { id: "p10", name: "Khoresh", terrain: "hills", fertility: 0.7, coastal: false, river: false, neighbors: ["p8", "p9"], population: 520, mana: 0.25 },
  // Mirewood — swamp + jungle (south).
  { id: "p11", name: "Mirewood", terrain: "swamp", fertility: 0.4, coastal: false, river: true, neighbors: ["i3", "p12"], population: 210, mana: 0.65 },
  { id: "p12", name: "Verdant Fever", terrain: "jungle", fertility: 0.5, coastal: false, river: false, neighbors: ["p11", "p8"], population: 190, mana: 0.7 },
  // The Deepvault — subsurface halls beneath the Ironspine mountains.
  // Tunnel exits connect d0 to p4 (Ironspine) and p5 (Highpass) above.
  // Underground halls are immune to plague and surface catastrophes, but
  // their neighbours list lets undead raids emerge topside if the hold falls.
  { id: "d0", name: "Ironheart Hall", terrain: "mountain", fertility: 0, coastal: false, river: false, neighbors: ["d1", "p4", "p5"], population: 320, mana: 0.65, subsurface: true, mineralWealth: 0.85 },
  { id: "d1", name: "The Deep Ore", terrain: "mountain", fertility: 0, coastal: false, river: false, neighbors: ["d0"], population: 180, mana: 0.9, subsurface: true, mineralWealth: 0.7 },
];

const titles: TitleSpec[] = [
  // Ibiki heartland — two rival houses.
  { id: "t_ki", name: "Kingdom of Ibiki", tier: "kingdom", law: "primogeniture", seat: "i0", liege: null },
  { id: "t_sm", name: "County of Sunmeadow", tier: "county", law: "primogeniture", seat: "i1", liege: "t_ki" },
  { id: "t_ew", name: "County of Elmwood", tier: "county", law: "primogeniture", seat: "i2", liege: "t_ki" },
  { id: "t_rb", name: "Duchy of Rivenbrook", tier: "duchy", law: "primogeniture", seat: "i3", liege: null },
  { id: "t_tw", name: "County of Thornwood", tier: "county", law: "primogeniture", seat: "i4", liege: "t_rb" },
  // Saltmere (coast).
  { id: "t_sa", name: "Duchy of Saltmere", tier: "duchy", law: "primogeniture", seat: "p0", liege: null },
  { id: "t_gh", name: "County of Gullhaven", tier: "county", law: "primogeniture", seat: "p1", liege: "t_sa" },
  // Ironspine (mountains).
  { id: "t_is", name: "Kingdom of the Ironspine", tier: "kingdom", law: "gavelkind", seat: "p4", liege: null },
  { id: "t_hp", name: "County of Highpass", tier: "county", law: "gavelkind", seat: "p5", liege: "t_is" },
  // The Horde (steppe/desert) — elective.
  { id: "t_kh", name: "Khaganate of the Ashen Steppe", tier: "kingdom", law: "elective", seat: "p6", liege: null },
  { id: "t_ss", name: "Clanhold of Sunscour", tier: "county", law: "elective", seat: "p7", liege: "t_kh" },
  { id: "t_dm", name: "Clanhold of Dunemarch", tier: "county", law: "elective", seat: "p8", liege: "t_kh" },
  // Empire of Zafran (settled).
  { id: "t_zf", name: "Empire of Zafran", tier: "kingdom", law: "primogeniture", seat: "p9", liege: null },
  { id: "t_kx", name: "Satrapy of Khoresh", tier: "county", law: "primogeniture", seat: "p10", liege: "t_zf" },
  // Mirewood (swamp).
  { id: "t_mw", name: "Duchy of Mirewood", tier: "duchy", law: "seniority", seat: "p11", liege: null },
  { id: "t_vf", name: "County of the Verdant Fever", tier: "county", law: "seniority", seat: "p12", liege: "t_mw" },
  // The Deepvault — dwarf holds, clan_elder succession (founding bloodline only).
  { id: "t_hh", name: "Hold of Ironheart", tier: "kingdom", law: "clan_elder", seat: "d0", liege: null },
  { id: "t_do", name: "The Deep Ore", tier: "county", law: "clan_elder", seat: "d1", liege: "t_hh" },
];

const dynasties: DynastySpec[] = [
  { id: "aeryn", name: "Aeryn", culture: "ibiki", race: "human", faith: "verdant" }, // royal Ibiki
  { id: "doriel", name: "Doriel", culture: "ibiki", race: "human", faith: "verdant" }, // elder-line Ibiki rival
  { id: "harlow", name: "Harlow", culture: "coastborn", race: "human", faith: "sea" },
  { id: "grimmr", name: "Grimmr", culture: "ridgefolk", race: "human", faith: "stone" },
  { id: "qarash", name: "Qarash", culture: "steppe", race: "human", faith: "skyfather" }, // human Horde
  { id: "gorthak", name: "Gorthak", culture: "orctongue", race: "orc", faith: "skyfather" }, // orc Horde
  { id: "darzan", name: "Darzan", culture: "zafrani", race: "human", faith: "sunlord" },
  { id: "sythe", name: "Sythe", culture: "mire", race: "human", faith: "mire" },
  { id: "deepvault", name: "Deepvault", culture: "deepborn", race: "dwarf", faith: "stone_ancestors" },
];

const races: RaceSpec[] = [
  { id: "human", name: "Human", affinities: { orc: -20 } },
  { id: "orc", name: "Orc", affinities: { human: -20 } },
  // Dwarfs: suspicious of humans, genuinely hostile to orcs who raid the mountain passes.
  // Biology: 280-year lifespan, low fertility (0.35), sun-adverse (0.4), high mana
  // affinity (0.7), plague-resistant (0.5), lithivore (mineral diet), mountain-born.
  {
    id: "dwarf", name: "Dwarf",
    affinities: { human: -15, orc: -40 },
    biology: {
      lifespan: 280,
      sunTolerance: 0.4,
      manaAffinity: 0.7,
      fertilityRate: 0.35,
      plagueResistance: 0.5,
      dietType: "lithivore",
      preferredTerrain: ["mountain", "hills"],
    },
  },
];

const faiths: FaithSpec[] = [
  { id: "verdant", name: "the Verdant Path", hostileTo: ["mire"] }, // Ibiki nature-faith
  { id: "sea", name: "the Tidefather", biasSeed: { fatalist: 0.25, mercantile: 0.2 } },
  { id: "stone", name: "the Stone Below", biasSeed: { sunk_cost: 0.15 } },
  { id: "skyfather", name: "the Sky Father", hostileTo: ["sunlord"], biasSeed: { providential: 0.4, doctrinal: 0.25 } }, // steppe / Horde
  { id: "sunlord", name: "the Sun Lord", hostileTo: ["skyfather"], biasSeed: { providential: 0.45, doctrinal: 0.45 } }, // Zafran imperial cult
  { id: "mire", name: "the Drowned Ones", hostileTo: ["verdant", "sunlord"], biasSeed: { grief_locked: 0.25, betrayal_scarred: 0.2, confirmation: 0.2 } }, // swamp cult
  // Dwarfs wage grudge wars, not holy wars; no hostileTo — but they never forget a slight.
  { id: "stone_ancestors", name: "the Stone Ancestors", biasSeed: { sunk_cost: 0.3, loss_aversion: 0.3 } },
];

const cultures: CultureSpec[] = [
  {
    id: "ibiki",
    name: "Ibiki",
    law: "primogeniture",
    driveBias: D(0.6, 0.45, 0.6, 0.45, 0.5, 0.35), // ambitious, feuding courtiers
    biasSeed: { confirmation: 0.35, wishful: 0.25, sunk_cost: 0.3 },
    startingTraits: ["warrior_culture"],
    namesMale: ["Aeryn", "Caelum", "Doriel", "Elwin", "Faelan", "Ilric", "Kaevo", "Maren", "Orin", "Taviel"],
    namesFemale: ["Aeliss", "Bryn", "Cirel", "Elowen", "Faye", "Lira", "Maeve", "Nira", "Selune", "Wyn"],
    surnames: ["Fairwind", "Greenbourne", "Ashvale", "Meadowlight", "Riverwynd"],
  },
  {
    id: "coastborn",
    name: "Coastborn",
    law: "primogeniture",
    driveBias: D(0.55, 0.5, 0.45, 0.4, 0.5, 0.4),
    biasSeed: { mercantile: 0.4, loss_aversion: 0.35 },
    startingTraits: ["mercantile", "literacy_valued"],
    namesMale: ["Aldous", "Halden", "Bram", "Corwin", "Sten", "Erik", "Rurik", "Osric", "Leif", "Torgan"],
    namesFemale: ["Astrid", "Mira", "Sela", "Inga", "Freya", "Edda", "Ylva", "Runa", "Solveig", "Signy"],
    surnames: ["Harlow", "Tidewell", "Gullhaven", "Saltmere"],
  },
  {
    id: "ridgefolk",
    name: "Ridgefolk",
    law: "gavelkind",
    driveBias: D(0.5, 0.5, 0.55, 0.4, 0.5, 0.2), // hardy, fearless
    biasSeed: { honor_bound: 0.5, fatalist: 0.4 },
    startingTraits: ["warrior_culture", "meritocracy"],
    namesMale: ["Bardin", "Dorin", "Grimm", "Torvald", "Durn", "Brok", "Onar", "Vidar", "Hral", "Konr"],
    namesFemale: ["Torva", "Hilda", "Kaila", "Brenna", "Gudrun", "Signe", "Vela", "Ada", "Sunniva", "Ragna"],
    surnames: ["Grimmr", "Stoneholt", "Ironvein"],
  },
  {
    id: "steppe",
    name: "Steppe",
    law: "elective",
    driveBias: D(0.85, 0.7, 0.75, 0.12, 0.55, 0.15), // hungry raiders
    biasSeed: { honor_bound: 0.45, conqueror_confident: 0.25, loss_aversion: 0.3 },
    startingTraits: ["warrior_culture", "slavery"],
    namesMale: ["Temur", "Ghazan", "Yusuf", "Kadir", "Tariq", "Bahadur", "Orhan", "Kaan", "Altan", "Berke"],
    namesFemale: ["Sabah", "Aisha", "Leyla", "Nur", "Roxana", "Yildiz", "Zara", "Gul", "Aynur", "Perizad"],
    surnames: ["Qarash", "Bloodmoon", "Windrider"],
  },
  {
    id: "orctongue",
    name: "Orctongue",
    law: "elective",
    driveBias: D(0.85, 0.8, 0.85, 0.05, 0.5, 0.1), // fiercest of the Horde
    biasSeed: { honor_bound: 0.65, confirmation: 0.4 },
    startingTraits: ["warrior_culture", "caste_rigid"],
    namesMale: ["Uzruk", "Gruul", "Gharruk", "Morg", "Drak", "Thok", "Grash", "Bolg", "Ozruk", "Karg"],
    namesFemale: ["Ushka", "Grima", "Draka", "Morga", "Thrag", "Ruka", "Grisha", "Nazka", "Ulga", "Braga"],
    surnames: ["Gorthak", "Skullsplit", "Ironfang"],
  },
  {
    id: "zafrani",
    name: "Zafrani",
    law: "primogeniture",
    driveBias: D(0.45, 0.5, 0.3, 0.72, 0.5, 0.42), // pious, settled, soft
    biasSeed: { providential: 0.5, doctrinal: 0.35 },
    startingTraits: ["zealous_faith", "caste_rigid"],
    namesMale: ["Khosru", "Bahram", "Farid", "Darius", "Kaveh", "Rostam", "Cyrus", "Jamshid", "Sohrab", "Kian"],
    namesFemale: ["Roshanak", "Yasmin", "Anahita", "Parisa", "Shirin", "Nastaran", "Soraya", "Farah", "Laleh", "Golnar"],
    surnames: ["Darzan", "Zafrani", "Khoreshi"],
  },
  {
    id: "mire",
    name: "Mire",
    law: "seniority",
    driveBias: D(0.5, 0.4, 0.62, 0.68, 0.45, 0.5), // insular, vengeful, superstitious
    biasSeed: { grief_locked: 0.35, betrayal_scarred: 0.3, sunk_cost: 0.35 },
    startingTraits: ["zealous_faith"],
    namesMale: ["Doran", "Vorm", "Grell", "Mosk", "Eril", "Thane", "Bosk", "Fenn", "Ordo", "Sabb"],
    namesFemale: ["Vessa", "Nessa", "Ligeia", "Sable", "Ondine", "Bryony", "Hazel", "Iria", "Wren", "Maura"],
    surnames: ["Sythe", "Blackfen", "Marshlight"],
  },
  {
    id: "deepborn",
    name: "Deepborn",
    law: "clan_elder",
    // Stubborn, wealth-obsessed, and corrosively vengeful. Low lust (slow to
    // breed) and near-zero fear (they do not flinch from the dark).
    driveBias: D(0.5, 0.8, 0.85, 0.6, 0.3, 0.15),
    biasSeed: { sunk_cost: 0.6, loss_aversion: 0.65, honor_bound: 0.55, betrayal_scarred: 0.4 },
    startingTraits: ["caste_rigid", "meritocracy"],
    namesMale: ["Durm", "Karag", "Balin", "Thorgrim", "Brynn", "Ord", "Durak", "Gimrel", "Stondar", "Vark"],
    namesFemale: ["Hilda", "Brunhilde", "Kara", "Dura", "Mira", "Gorma", "Velda", "Udra", "Brynna", "Astara"],
    surnames: ["Deepvault", "Ironmantle", "Stoneheart", "Oreborn"],
  },
];

const characters: CharacterSpec[] = [
  // ── Ibiki heartland — House Aeryn (royal, Kingdom of Ibiki) ──────────────
  ch({ id: "caelum", name: "Caelum", sex: "male", dynasty: "aeryn", birthYear: 962, province: "i0", drives: D(0.65, 0.45, 0.55, 0.45, 0.5, 0.3), founds: "aeryn", holds: "t_ki" }),
  ch({ id: "elowen", name: "Elowen", sex: "female", dynasty: "aeryn", birthYear: 966, province: "i0", drives: D(0.5, 0.4, 0.55, 0.5, 0.5, 0.4), spouse: "caelum" }),
  ch({ id: "faelan", name: "Faelan", sex: "male", dynasty: "aeryn", birthYear: 988, province: "i0", drives: D(0.7, 0.45, 0.6, 0.35, 0.5, 0.3), father: "caelum", mother: "elowen" }),
  ch({ id: "lira", name: "Lira", sex: "female", dynasty: "aeryn", birthYear: 990, province: "i0", drives: D(0.55, 0.45, 0.6, 0.45, 0.5, 0.4), father: "caelum", mother: "elowen" }),
  ch({ id: "maren", name: "Maren", sex: "male", dynasty: "aeryn", birthYear: 992, province: "i1", drives: D(0.6, 0.5, 0.65, 0.3, 0.5, 0.45), father: "caelum", mother: "elowen", holds: "t_sm" }),
  ch({ id: "ilric", name: "Ilric", sex: "male", dynasty: "aeryn", birthYear: 965, province: "i2", drives: D(0.7, 0.5, 0.6, 0.3, 0.5, 0.4), holds: "t_ew" }),

  // ── Ibiki heartland — House Doriel (elder line, Duchy of Rivenbrook) ──────
  // Taviel claims the Ibiki throne itself: the central intrigue is at home.
  ch({ id: "taviel", name: "Taviel", sex: "male", dynasty: "doriel", birthYear: 960, province: "i3", drives: D(0.8, 0.5, 0.7, 0.3, 0.5, 0.3), founds: "doriel", holds: "t_rb",
       claims: [{ title: "t_ki", strength: "weak", basis: "the elder line, passed over in the old succession", year: 1000 }] }),
  ch({ id: "nira", name: "Nira", sex: "female", dynasty: "doriel", birthYear: 964, province: "i3", drives: D(0.6, 0.45, 0.65, 0.4, 0.5, 0.4), spouse: "taviel" }),
  ch({ id: "elwin", name: "Elwin", sex: "male", dynasty: "doriel", birthYear: 986, province: "i4", drives: D(0.75, 0.5, 0.7, 0.25, 0.5, 0.35), father: "taviel", mother: "nira", holds: "t_tw" }),
  ch({ id: "aeliss", name: "Aeliss", sex: "female", dynasty: "doriel", birthYear: 989, province: "i3", drives: D(0.6, 0.45, 0.65, 0.35, 0.5, 0.4), father: "taviel", mother: "nira" }),

  // ── Saltmere — House Harlow (coastborn) ──────────────────────────────────
  ch({ id: "aldous", name: "Aldous", sex: "male", dynasty: "harlow", birthYear: 961, province: "p0", drives: D(0.55, 0.5, 0.4, 0.4, 0.5, 0.4), founds: "harlow", holds: "t_sa" }),
  ch({ id: "astrid", name: "Astrid", sex: "female", dynasty: "harlow", birthYear: 965, province: "p0", drives: D(0.5, 0.45, 0.4, 0.45, 0.5, 0.4), spouse: "aldous" }),
  ch({ id: "corwin", name: "Corwin", sex: "male", dynasty: "harlow", birthYear: 987, province: "p1", drives: D(0.6, 0.55, 0.45, 0.35, 0.5, 0.4), father: "aldous", mother: "astrid", holds: "t_gh" }),

  // ── Ironspine — House Grimmr (ridgefolk, gavelkind) ──────────────────────
  ch({ id: "bardin", name: "Bardin", sex: "male", dynasty: "grimmr", birthYear: 958, province: "p4", drives: D(0.5, 0.5, 0.55, 0.4, 0.5, 0.2), founds: "grimmr", holds: "t_is" }),
  ch({ id: "torva", name: "Torva", sex: "female", dynasty: "grimmr", birthYear: 962, province: "p4", drives: D(0.55, 0.45, 0.5, 0.4, 0.5, 0.25), spouse: "bardin" }),
  ch({ id: "dorin", name: "Dorin", sex: "male", dynasty: "grimmr", birthYear: 984, province: "p5", drives: D(0.6, 0.5, 0.6, 0.3, 0.5, 0.2), father: "bardin", mother: "torva", holds: "t_hp" }),
  ch({ id: "kaila", name: "Kaila", sex: "female", dynasty: "grimmr", birthYear: 988, province: "p4", drives: D(0.65, 0.5, 0.6, 0.3, 0.5, 0.25), father: "bardin", mother: "torva" }),

  // ── The Horde — House Qarash (human Khagan) ──────────────────────────────
  // Temur claims a Zafran satrapy AND an Ibiki meadow: the raids press both.
  ch({ id: "temur", name: "Temur", sex: "male", dynasty: "qarash", birthYear: 960, province: "p6", drives: D(0.9, 0.75, 0.7, 0.15, 0.6, 0.15), founds: "qarash", holds: "t_kh",
       claims: [
         { title: "t_kx", strength: "weak", basis: "the old grazing lands the settled folk fenced", year: 1000 },
         { title: "t_sm", strength: "weak", basis: "the green meadow the steppe once watered its herds upon", year: 1000 },
       ] }),
  ch({ id: "sabah", name: "Sabah", sex: "female", dynasty: "qarash", birthYear: 968, province: "p6", drives: D(0.7, 0.6, 0.65, 0.2, 0.6, 0.3), spouse: "temur" }),
  ch({ id: "yusuf", name: "Yusuf", sex: "male", dynasty: "qarash", birthYear: 986, province: "p6", drives: D(0.88, 0.7, 0.7, 0.1, 0.5, 0.2), father: "temur", mother: "sabah" }),
  ch({ id: "ghazan", name: "Ghazan", sex: "male", dynasty: "qarash", birthYear: 964, province: "p7", drives: D(0.85, 0.7, 0.8, 0.1, 0.5, 0.2), holds: "t_ss",
       claims: [{ title: "t_kh", strength: "weak", basis: "a war-chief's right to the Khaganate", year: 1000 }] }),

  // ── The Horde — House Gorthak (orcs — the mix) ───────────────────────────
  ch({ id: "uzruk", name: "Uzruk", sex: "male", dynasty: "gorthak", birthYear: 963, province: "p8", drives: D(0.85, 0.8, 0.85, 0.05, 0.5, 0.1), founds: "gorthak", holds: "t_dm",
       claims: [{ title: "t_kh", strength: "weak", basis: "the orcs will not kneel to a Qarash Khagan forever", year: 1000 }] }),
  ch({ id: "gruul", name: "Gruul", sex: "male", dynasty: "gorthak", birthYear: 989, province: "p8", drives: D(0.8, 0.75, 0.85, 0.05, 0.5, 0.15), father: "uzruk" }),

  // ── Empire of Zafran — House Darzan (zafrani, settled, pious) ────────────
  ch({ id: "khosru", name: "Khosru", sex: "male", dynasty: "darzan", birthYear: 955, province: "p9", drives: D(0.45, 0.5, 0.3, 0.75, 0.5, 0.4), founds: "darzan", holds: "t_zf" }),
  ch({ id: "roshanak", name: "Roshanak", sex: "female", dynasty: "darzan", birthYear: 960, province: "p9", drives: D(0.4, 0.5, 0.35, 0.7, 0.5, 0.4), spouse: "khosru" }),
  ch({ id: "bahram", name: "Bahram", sex: "male", dynasty: "darzan", birthYear: 985, province: "p9", drives: D(0.5, 0.55, 0.4, 0.6, 0.5, 0.45), father: "khosru", mother: "roshanak" }),
  ch({ id: "farid", name: "Farid", sex: "male", dynasty: "darzan", birthYear: 959, province: "p10", drives: D(0.6, 0.6, 0.5, 0.4, 0.5, 0.4), holds: "t_kx" }),

  // ── Mirewood — House Sythe (mire, seniority) ─────────────────────────────
  ch({ id: "vessa", name: "Vessa", sex: "female", dynasty: "sythe", birthYear: 961, province: "p11", drives: D(0.5, 0.4, 0.62, 0.68, 0.45, 0.5), founds: "sythe", holds: "t_mw" }),
  ch({ id: "doran", name: "Doran", sex: "male", dynasty: "sythe", birthYear: 964, province: "p12", drives: D(0.5, 0.45, 0.6, 0.6, 0.5, 0.5), holds: "t_vf" }),

  // ── The Deepvault — House Deepvault (dwarfs, clan_elder) ─────────────────
  // Thorgrim is old — the question of succession hangs over the hold from day 1.
  // All three are male; the clan grows only through marriage (a rarity for dwarfs)
  // or not at all — their slow breeding and grudge-driven politics make extinction
  // a genuine possibility, especially if DELVED_TOO_DEEP fires.
  ch({ id: "thorgrim", name: "Thorgrim", sex: "male", dynasty: "deepvault", birthYear: 935, province: "d0", drives: D(0.5, 0.85, 0.9, 0.7, 0.3, 0.1), founds: "deepvault", holds: "t_hh" }),
  ch({ id: "hildra", name: "Hildra", sex: "female", dynasty: "deepvault", birthYear: 940, province: "d0", drives: D(0.4, 0.75, 0.8, 0.65, 0.3, 0.15), spouse: "thorgrim" }),
  // Karag — eldest son, heir apparent under clan_elder. A weak claim at game
  // start lets him marry before Thorgrim dies (otherwise he'd be 50+ and past
  // the marriage window by the time he inherits).
  ch({ id: "karag", name: "Karag", sex: "male", dynasty: "deepvault", birthYear: 966, province: "d0", drives: D(0.6, 0.8, 0.85, 0.6, 0.3, 0.1), father: "thorgrim", mother: "hildra",
       claims: [{ title: "t_hh", strength: "weak", basis: "firstborn of Thorgrim, heir apparent to the Hold", year: 1000 }] }),
  // Durm — younger son, holds The Deep Ore; more martial, drives the mining frontier.
  ch({ id: "durm", name: "Durm", sex: "male", dynasty: "deepvault", birthYear: 970, province: "d1", drives: D(0.65, 0.8, 0.88, 0.55, 0.25, 0.05), father: "thorgrim", mother: "hildra", holds: "t_do" }),
];

export const FRONTIER_SPEC: WorldSpec = {
  startYear: 1000,
  provinces,
  titles,
  dynasties,
  characters,
  cultures,
  races,
  faiths,
};
