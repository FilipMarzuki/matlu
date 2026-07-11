// worlds/frontier.ts — an authored "approximate geography" WorldSpec.
//
// A deliberately-designed regional layout (not a generated Earth map). The
// engine only reads terrain + the neighbor graph, so this encodes the shape:
//
//        OCEAN (west)                                         (east)
//   ┌───────────────┐   ┌──────────┐   ┌───────────────┐   ┌────────────┐
//   │  Saltmere     │   │ Ironspine │   │  Ashen Steppe │   │  Empire of │
//   │  (coast +     │──▶│ (mountain │──▶│  + deserts    │──▶│  Zafran    │
//   │   heartland)  │   │  spine)   │   │  RAIDER HORDE │   │  (settled) │
//   └──────┬────────┘   └──────────┘   └──────┬────────┘   └────────────┘
//          │                                  │
//          ▼                                  ▼
//   ┌───────────────── Mirewood: swamp + jungle (south) ──────────────┐
//
// Culture is expressed through succession law, drive vectors, and (gen-0)
// names: settled empires use primogeniture and lean pious/hierarchical; the
// steppe Horde is ELECTIVE (a warlord meritocracy) and leans ambitious/greedy/
// vengeful; the mountain clans use gavelkind. The desert's brutal carrying
// capacity (fertility 0.2 × yield 0.2) keeps the Horde hungry — scarcity is
// what turns their raids on rich Zafran into war. High mana on the frontier
// (mountains, steppe, swamp, jungle) breeds high-level people; the soft, mana-
// poor empire does not — the Ibn Khaldun frontier-vs-core dynamic, by geography.

import type {
  CharacterSpec,
  ProvinceSpec,
  TitleSpec,
  WorldSpec,
} from "../world-spec.js";
import type { Sex } from "../types.js";

const D = (a: number, g: number, v: number, p: number, l: number, f: number): number[] => [a, g, v, p, l, f];

// Compact character builder — fills the optional fields so entries stay short.
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

const provinces: ProvinceSpec[] = [
  // --- The Sunset Coast + heartland (House Vaeryn) — ocean to the west ---
  { id: "p0", name: "Saltmere", terrain: "coast", fertility: 0.6, coastal: true, river: true, neighbors: ["p1", "p2"], population: 500, mana: 0.3 },
  { id: "p1", name: "Gullhaven", terrain: "coast", fertility: 0.55, coastal: true, river: false, neighbors: ["p0", "p2"], population: 400, mana: 0.3 },
  { id: "p2", name: "Emberhold", terrain: "plains", fertility: 0.8, coastal: false, river: true, neighbors: ["p0", "p1", "p3", "p4"], population: 640, mana: 0.25 },
  { id: "p3", name: "Green Hollow", terrain: "forest", fertility: 0.6, coastal: false, river: false, neighbors: ["p2", "p4", "p11"], population: 360, mana: 0.45 },
  // --- The Ironspine (House Grimmr) — the mountain wall ---
  { id: "p4", name: "Ironspine", terrain: "mountain", fertility: 0.35, coastal: false, river: false, neighbors: ["p2", "p3", "p5", "p6"], population: 130, mana: 0.8 },
  { id: "p5", name: "Highpass", terrain: "mountain", fertility: 0.3, coastal: false, river: false, neighbors: ["p4", "p6"], population: 90, mana: 0.75 },
  // --- The Ashen Steppe + deserts (the Horde) — raider frontier ---
  { id: "p6", name: "Ashen Steppe", terrain: "steppe", fertility: 0.35, coastal: false, river: true, neighbors: ["p4", "p5", "p7", "p8"], population: 300, mana: 0.6 },
  { id: "p7", name: "Sunscour", terrain: "desert", fertility: 0.2, coastal: false, river: false, neighbors: ["p6", "p8", "p9"], population: 130, mana: 0.55 },
  { id: "p8", name: "Dunemarch", terrain: "desert", fertility: 0.25, coastal: false, river: false, neighbors: ["p6", "p7", "p9", "p10", "p12"], population: 160, mana: 0.5 },
  // --- The Empire of Zafran (House Darzan) — settled, beyond the desert ---
  { id: "p9", name: "Zafran", terrain: "plains", fertility: 0.85, coastal: false, river: true, neighbors: ["p7", "p8", "p10"], population: 720, mana: 0.2 },
  { id: "p10", name: "Khoresh", terrain: "hills", fertility: 0.7, coastal: false, river: false, neighbors: ["p8", "p9"], population: 520, mana: 0.25 },
  // --- Mirewood: swamp + jungle (House Sythe) — the fevered south ---
  { id: "p11", name: "Mirewood", terrain: "swamp", fertility: 0.4, coastal: false, river: true, neighbors: ["p3", "p12"], population: 210, mana: 0.65 },
  { id: "p12", name: "Verdant Fever", terrain: "jungle", fertility: 0.5, coastal: false, river: false, neighbors: ["p11", "p8"], population: 190, mana: 0.7 },
];

const titles: TitleSpec[] = [
  // Saltmere — a settled coastal kingdom.
  { id: "t2", name: "Kingdom of Saltmere", tier: "kingdom", law: "primogeniture", seat: "p2", liege: null },
  { id: "t0", name: "County of Saltmere", tier: "county", law: "primogeniture", seat: "p0", liege: "t2" },
  { id: "t1", name: "County of Gullhaven", tier: "county", law: "primogeniture", seat: "p1", liege: "t2" },
  { id: "t3", name: "County of Green Hollow", tier: "county", law: "primogeniture", seat: "p3", liege: "t2" },
  // Ironspine — hardy mountain clans, gavelkind (endless fractious claimants).
  { id: "t4", name: "Kingdom of the Ironspine", tier: "kingdom", law: "gavelkind", seat: "p4", liege: null },
  { id: "t5", name: "County of Highpass", tier: "county", law: "gavelkind", seat: "p5", liege: "t4" },
  // The Horde — elective Khaganate: whoever's strongest leads. Orc + human.
  { id: "t6", name: "Khaganate of the Ashen Steppe", tier: "kingdom", law: "elective", seat: "p6", liege: null },
  { id: "t7", name: "Clanhold of Sunscour", tier: "county", law: "elective", seat: "p7", liege: "t6" },
  { id: "t8", name: "Clanhold of Dunemarch", tier: "county", law: "elective", seat: "p8", liege: "t6" },
  // Zafran — a grand settled empire, primogeniture.
  { id: "t9", name: "Empire of Zafran", tier: "kingdom", law: "primogeniture", seat: "p9", liege: null },
  { id: "t10", name: "Satrapy of Khoresh", tier: "county", law: "primogeniture", seat: "p10", liege: "t9" },
  // Mirewood — insular swamp realm, seniority (the eldest of the coven leads).
  { id: "t11", name: "Duchy of Mirewood", tier: "duchy", law: "seniority", seat: "p11", liege: null },
  { id: "t12", name: "County of the Verdant Fever", tier: "county", law: "seniority", seat: "p12", liege: "t11" },
];

const dynasties = [
  { id: "vaeryn", name: "Vaeryn" }, // Saltmere — coastal humans
  { id: "grimmr", name: "Grimmr" }, // Ironspine — mountain clans
  { id: "qarash", name: "Qarash" }, // Horde — human steppe riders
  { id: "gorthak", name: "Gorthak" }, // Horde — orc tribe (the mix)
  { id: "darzan", name: "Darzan" }, // Zafran — settled empire
  { id: "sythe", name: "Sythe" }, // Mirewood — swamp folk
];

const characters: CharacterSpec[] = [
  // ── House Vaeryn (Saltmere, primogeniture) — balanced, seafaring ──────────
  ch({ id: "aldous", name: "Aldous", sex: "male", dynasty: "vaeryn", birthYear: 962, province: "p2", drives: D(0.55, 0.4, 0.35, 0.5, 0.5, 0.35), founds: "vaeryn", holds: "t2" }),
  ch({ id: "mirelle", name: "Mirelle", sex: "female", dynasty: "grimmr", birthYear: 966, province: "p2", drives: D(0.4, 0.4, 0.4, 0.5, 0.5, 0.4), spouse: "aldous" }),
  ch({ id: "corwin", name: "Corwin", sex: "male", dynasty: "vaeryn", birthYear: 988, province: "p2", drives: D(0.7, 0.45, 0.4, 0.4, 0.5, 0.35), father: "aldous", mother: "mirelle" }),
  ch({ id: "rowan", name: "Rowan", sex: "female", dynasty: "vaeryn", birthYear: 991, province: "p2", drives: D(0.5, 0.4, 0.45, 0.5, 0.5, 0.4), father: "aldous", mother: "mirelle" }),
  ch({ id: "halden", name: "Halden", sex: "male", dynasty: "vaeryn", birthYear: 965, province: "p0", drives: D(0.6, 0.55, 0.5, 0.3, 0.5, 0.4), holds: "t0" }),
  ch({ id: "bram", name: "Bramwell", sex: "male", dynasty: "vaeryn", birthYear: 968, province: "p1", drives: D(0.5, 0.6, 0.45, 0.35, 0.5, 0.45), holds: "t1" }),
  ch({ id: "edda", name: "Edda", sex: "female", dynasty: "vaeryn", birthYear: 970, province: "p3", drives: D(0.55, 0.45, 0.5, 0.45, 0.5, 0.4), holds: "t3" }),

  // ── House Grimmr (Ironspine, gavelkind) — hardy, unafraid ─────────────────
  ch({ id: "bardin", name: "Bardin", sex: "male", dynasty: "grimmr", birthYear: 958, province: "p4", drives: D(0.5, 0.5, 0.5, 0.4, 0.5, 0.2), founds: "grimmr", holds: "t4" }),
  ch({ id: "torva", name: "Torva", sex: "female", dynasty: "grimmr", birthYear: 962, province: "p4", drives: D(0.55, 0.45, 0.5, 0.4, 0.5, 0.25), spouse: "bardin" }),
  ch({ id: "dorin", name: "Dorin", sex: "male", dynasty: "grimmr", birthYear: 984, province: "p5", drives: D(0.6, 0.5, 0.6, 0.3, 0.5, 0.2), father: "bardin", mother: "torva", holds: "t5" }),
  ch({ id: "kaila", name: "Kaila", sex: "female", dynasty: "grimmr", birthYear: 988, province: "p4", drives: D(0.65, 0.5, 0.6, 0.3, 0.5, 0.25), father: "bardin", mother: "torva" }),

  // ── House Qarash (the Horde, elective) — human steppe riders, hungry ──────
  ch({ id: "temur", name: "Temur", sex: "male", dynasty: "qarash", birthYear: 960, province: "p6", drives: D(0.9, 0.75, 0.7, 0.15, 0.6, 0.15), founds: "qarash", holds: "t6",
       claims: [{ title: "t10", strength: "weak", basis: "the old grazing lands, seized by the settled folk", year: 1000 }] }),
  ch({ id: "sabah", name: "Sabah", sex: "female", dynasty: "qarash", birthYear: 968, province: "p6", drives: D(0.7, 0.6, 0.65, 0.2, 0.6, 0.3), spouse: "temur" }),
  ch({ id: "yusuf", name: "Yusuf", sex: "male", dynasty: "qarash", birthYear: 986, province: "p6", drives: D(0.88, 0.7, 0.7, 0.1, 0.5, 0.2), father: "temur", mother: "sabah" }),
  ch({ id: "kadir", name: "Kadir", sex: "male", dynasty: "qarash", birthYear: 990, province: "p6", drives: D(0.82, 0.7, 0.75, 0.1, 0.5, 0.25), father: "temur", mother: "sabah" }),
  ch({ id: "ghazan", name: "Ghazan", sex: "male", dynasty: "qarash", birthYear: 964, province: "p7", drives: D(0.85, 0.7, 0.8, 0.1, 0.5, 0.2), holds: "t7",
       claims: [{ title: "t6", strength: "weak", basis: "a war-chief's right to the Khaganate", year: 1000 }] }),

  // ── House Gorthak (the Horde, orcs — the "mix") ──────────────────────────
  ch({ id: "uzruk", name: "Uzruk", sex: "male", dynasty: "gorthak", birthYear: 963, province: "p8", drives: D(0.85, 0.8, 0.85, 0.05, 0.5, 0.1), founds: "gorthak", holds: "t8",
       claims: [{ title: "t6", strength: "weak", basis: "the orcs will not kneel to a Qarash Khagan forever", year: 1000 }] }),
  ch({ id: "gruul", name: "Gruul", sex: "male", dynasty: "gorthak", birthYear: 989, province: "p8", drives: D(0.8, 0.75, 0.85, 0.05, 0.5, 0.15), father: "uzruk" }),

  // ── House Darzan (Empire of Zafran, primogeniture) — settled, pious, soft ─
  ch({ id: "khosru", name: "Khosru", sex: "male", dynasty: "darzan", birthYear: 955, province: "p9", drives: D(0.45, 0.5, 0.3, 0.75, 0.5, 0.4), founds: "darzan", holds: "t9" }),
  ch({ id: "roshanak", name: "Roshanak", sex: "female", dynasty: "darzan", birthYear: 960, province: "p9", drives: D(0.4, 0.5, 0.35, 0.7, 0.5, 0.4), spouse: "khosru" }),
  ch({ id: "bahram", name: "Bahram", sex: "male", dynasty: "darzan", birthYear: 985, province: "p9", drives: D(0.5, 0.55, 0.4, 0.6, 0.5, 0.45), father: "khosru", mother: "roshanak" }),
  ch({ id: "yasmin", name: "Yasmin", sex: "female", dynasty: "darzan", birthYear: 988, province: "p9", drives: D(0.55, 0.5, 0.4, 0.55, 0.5, 0.4), father: "khosru", mother: "roshanak" }),
  ch({ id: "farid", name: "Farid", sex: "male", dynasty: "darzan", birthYear: 959, province: "p10", drives: D(0.6, 0.6, 0.5, 0.4, 0.5, 0.4), holds: "t10" }),

  // ── House Sythe (Mirewood, seniority) — insular, superstitious ───────────
  ch({ id: "vessa", name: "Vessa", sex: "female", dynasty: "sythe", birthYear: 961, province: "p11", drives: D(0.5, 0.4, 0.6, 0.7, 0.4, 0.5), founds: "sythe", holds: "t11" }),
  ch({ id: "doran", name: "Doran", sex: "male", dynasty: "sythe", birthYear: 964, province: "p12", drives: D(0.5, 0.45, 0.6, 0.6, 0.5, 0.5), holds: "t12" }),
  ch({ id: "nessa", name: "Nessa", sex: "female", dynasty: "sythe", birthYear: 990, province: "p11", drives: D(0.55, 0.4, 0.65, 0.6, 0.5, 0.5) }),
];

export const FRONTIER_SPEC: WorldSpec = {
  startYear: 1000,
  provinces,
  titles,
  dynasties,
  characters,
};
