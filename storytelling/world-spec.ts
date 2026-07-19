// world-spec.ts — the WorldSpec schema + the default starting tableau as DATA.
//
// This is the engine's "world bible": pure data, no logic. seed.ts (loadWorld)
// turns a WorldSpec into a live World. Today there's one spec — DEFAULT_SPEC,
// the original hand-built three-realm tableau — but the whole point is that
// other specs can be fed in: a culture-driven realm, an Azgaar-derived map, a
// lore-seeded dynasty set. Each is just a different WorldSpec; the engine code
// never changes. (It also doubles as the byte-stable prefix you'd later cache
// for the LLM renderer.)
//
// NOTE: mana is now AUTHORED data here (per province), not derived from terrain
// — the "second geography" we can feed from a corruption/ley overlay.
//
// DEFAULT_SPEC was generated from the original seed.ts via dump-spec.ts, so the
// data (and crucially the character ORDER, which fixes the RNG stream) matches
// the original exactly.

import type { SuccessionLaw, Terrain, Tier, Sex, PerceptualBias } from "./types.js";

export interface ProvinceSpec {
  id: string;
  name: string;
  terrain: Terrain;
  fertility: number;
  coastal: boolean;
  river: boolean;
  neighbors: string[];
  population: number;
  mana: number;
  subsurface?: boolean;   // underground hall; uses mineralWealth instead of fertility
  mineralWealth?: number; // 0..1; carrying capacity base when subsurface
  zoneFlags?: string[];   // authored tags: "port", "sanctuary", "battlefield" etc.
}

export interface TitleSpec {
  id: string;
  name: string;
  tier: Tier;
  law: SuccessionLaw;
  seat: string; // provinceId
  liege: string | null; // titleId
}

export interface DynastySpec {
  id: string;
  name: string;
  culture?: string; // CultureSpec.id
  race?: string; // RaceSpec.id
  faith?: string; // FaithSpec.id
}

// --- Peoples layer -----------------------------------------------------------
// A culture gives its houses a naming convention, a temperament (drive biases
// that newborns pull toward), and a default succession law. This is what makes
// a region read as a distinct people across generations, not just gen-0.
export interface CultureSpec {
  id: string;
  name: string;
  namesMale: string[];
  namesFemale: string[];
  surnames?: string[]; // for low-born risers who found new houses in this land
  // Target drive profile [ambition, greed, vengeance, piety, lust, fear];
  // newborns of this culture blend toward it. Omit to leave temperament free.
  driveBias?: number[];
  law?: SuccessionLaw; // default succession law for this culture's realms
  // Perceptual bias seeds: base intensities stamped at birth, with ±0.15 noise.
  // Stacks on top of faith seeds. Omit keys that don't characterise the culture.
  biasSeed?: Partial<Record<PerceptualBias, number>>;
  // Mechanical traits active from the world's founding (e.g. ["slavery"]).
  // Populated into CultureState.traits at world load, before the sim runs.
  startingTraits?: string[];
  // Clan / tribal-subunit names for cultures organised below the dynastic level
  // (steppe horde, beastkin tribes, dwarven holds). Consumed by the steppe
  // events catalog for kinship prose and by the surname picker as fallback.
  clans?: string[];
}

// Physical traits that vary between races and feed into simulation mechanics:
// lifespan governs the mortality curve, fertility/sun drive population growth,
// plague resistance modulates epidemic kill rates, mana affinity scales XP gain.
// All fields are optional; absent fields fall back to human-baseline defaults in
// getBiology() (biology.ts). That way adding biology to one race never touches
// the code paths for races that haven't been characterised yet.
export interface RaceBiology {
  lifespan?: number;           // natural lifespan in years; default 75
  sunTolerance?: number;       // 0..1; <0.5 penalises surface pop growth; default 1.0
  manaAffinity?: number;       // 0..1; XP multiplier (neutral = 0.5); default 0.5
  fertilityRate?: number;      // multiplier on province population growth; default 1.0
  plagueResistance?: number;   // 0..1 fraction of plague mortality absorbed; default 0.0
  dietType?: "omnivore" | "carnivore" | "herbivore" | "lithivore";
  preferredTerrain?: Terrain[];
}

// A race carries an inter-group opinion modifier: how members of this race
// regard members of another (negative = friction). Drives the orc/human strain.
export interface RaceSpec {
  id: string;
  name: string;
  affinities?: Record<string, number>; // otherRaceId -> opinion delta
  biology?: RaceBiology;
}

// A faith can be hostile to others — a holy-war axis and a source of grudges.
export interface FaithSpec {
  id: string;
  name: string;
  hostileTo?: string[]; // faith ids this faith is hostile toward
  // Perceptual bias seeds layered on top of the character's cultural seeds.
  biasSeed?: Partial<Record<PerceptualBias, number>>;
}

export interface ClaimSpec {
  title: string;
  strength: "strong" | "weak";
  basis: string;
  year: number;
}

export interface CharacterSpec {
  id: string; // local label, used only to wire relationships within the spec
  name: string;
  sex: Sex;
  dynasty: string; // DynastySpec.id
  birthYear: number;
  province: string; // ProvinceSpec.id (final seat, after marriage/holding)
  drives: number[]; // [ambition, greed, vengeance, piety, lust, fear]
  father: string | null;
  mother: string | null;
  spouse: string | null;
  founds: string | null; // DynastySpec.id this character is the founder of
  holds: string | null; // TitleSpec.id this character holds at start
  claims: ClaimSpec[];
}

export interface WorldSpec {
  startYear: number;
  provinces: ProvinceSpec[];
  titles: TitleSpec[];
  dynasties: DynastySpec[];
  characters: CharacterSpec[];
  // Optional peoples layer. Absent (as in DEFAULT_SPEC) = no cultures, and the
  // sim falls back to the global name pool with no temperament/opinion effects.
  cultures?: CultureSpec[];
  races?: RaceSpec[];
  faiths?: FaithSpec[];
}

export const DEFAULT_SPEC: WorldSpec =
{
  "startYear": 1000,
  "provinces": [
    {
      "id": "p0",
      "name": "Hearthvale",
      "terrain": "plains",
      "fertility": 0.9,
      "coastal": false,
      "river": true,
      "neighbors": [
        "p1",
        "p2",
        "p3"
      ],
      "population": 650,
      "mana": 0.25
    },
    {
      "id": "p1",
      "name": "Stonewatch",
      "terrain": "hills",
      "fertility": 0.6,
      "coastal": false,
      "river": false,
      "neighbors": [
        "p0",
        "p7"
      ],
      "population": 320,
      "mana": 0.4
    },
    {
      "id": "p2",
      "name": "Rivermouth",
      "terrain": "coast",
      "fertility": 0.7,
      "coastal": true,
      "river": true,
      "neighbors": [
        "p0",
        "p5"
      ],
      "population": 450,
      "mana": 0.4
    },
    {
      "id": "p3",
      "name": "Greywood",
      "terrain": "forest",
      "fertility": 0.55,
      "coastal": false,
      "river": true,
      "neighbors": [
        "p0",
        "p4",
        "p6"
      ],
      "population": 260,
      "mana": 0.6
    },
    {
      "id": "p4",
      "name": "Thornfen",
      "terrain": "plains",
      "fertility": 0.8,
      "coastal": false,
      "river": false,
      "neighbors": [
        "p3",
        "p5",
        "p7"
      ],
      "population": 620,
      "mana": 0.25
    },
    {
      "id": "p5",
      "name": "Saltcliff",
      "terrain": "coast",
      "fertility": 0.65,
      "coastal": true,
      "river": false,
      "neighbors": [
        "p2",
        "p4"
      ],
      "population": 430,
      "mana": 0.4
    },
    {
      "id": "p6",
      "name": "Highreach",
      "terrain": "mountain",
      "fertility": 0.4,
      "coastal": false,
      "river": false,
      "neighbors": [
        "p3",
        "p7"
      ],
      "population": 130,
      "mana": 0.8
    },
    {
      "id": "p7",
      "name": "Westmoor",
      "terrain": "hills",
      "fertility": 0.6,
      "coastal": false,
      "river": false,
      "neighbors": [
        "p1",
        "p4",
        "p6"
      ],
      "population": 330,
      "mana": 0.4
    }
  ],
  "titles": [
    {
      "id": "t0",
      "name": "Kingdom of Valmark",
      "tier": "kingdom",
      "law": "primogeniture",
      "seat": "p0",
      "liege": null
    },
    {
      "id": "t1",
      "name": "County of Stonewatch",
      "tier": "county",
      "law": "primogeniture",
      "seat": "p1",
      "liege": "t0"
    },
    {
      "id": "t2",
      "name": "County of Rivermouth",
      "tier": "county",
      "law": "primogeniture",
      "seat": "p2",
      "liege": "t0"
    },
    {
      "id": "t3",
      "name": "Kingdom of Corvane",
      "tier": "kingdom",
      "law": "seniority",
      "seat": "p3",
      "liege": null
    },
    {
      "id": "t4",
      "name": "County of Thornfen",
      "tier": "county",
      "law": "seniority",
      "seat": "p4",
      "liege": "t3"
    },
    {
      "id": "t5",
      "name": "County of Saltcliff",
      "tier": "county",
      "law": "seniority",
      "seat": "p5",
      "liege": "t3"
    },
    {
      "id": "t6",
      "name": "Kingdom of Halvar",
      "tier": "kingdom",
      "law": "gavelkind",
      "seat": "p6",
      "liege": null
    },
    {
      "id": "t7",
      "name": "County of Westmoor",
      "tier": "county",
      "law": "gavelkind",
      "seat": "p7",
      "liege": "t6"
    }
  ],
  "dynasties": [
    {
      "id": "aldermark",
      "name": "Aldermark"
    },
    {
      "id": "corvane",
      "name": "Corvane"
    },
    {
      "id": "halvar",
      "name": "Halvar"
    }
  ],
  "characters": [
    {
      "id": "magnus",
      "name": "Magnus",
      "sex": "male",
      "dynasty": "aldermark",
      "birthYear": 965,
      "province": "p0",
      "drives": [
        0.7,
        0.4,
        0.3,
        0.5,
        0.5,
        0.3
      ],
      "father": null,
      "mother": null,
      "spouse": "brigid",
      "founds": "aldermark",
      "holds": "t0",
      "claims": []
    },
    {
      "id": "reynard",
      "name": "Reynard",
      "sex": "male",
      "dynasty": "corvane",
      "birthYear": 960,
      "province": "p3",
      "drives": [
        0.6,
        0.6,
        0.5,
        0.3,
        0.4,
        0.4
      ],
      "father": null,
      "mother": null,
      "spouse": "mathilde",
      "founds": "corvane",
      "holds": "t3",
      "claims": []
    },
    {
      "id": "haldan",
      "name": "Haldan",
      "sex": "male",
      "dynasty": "halvar",
      "birthYear": 958,
      "province": "p6",
      "drives": [
        0.5,
        0.5,
        0.4,
        0.6,
        0.6,
        0.3
      ],
      "father": null,
      "mother": null,
      "spouse": "verena",
      "founds": "halvar",
      "holds": "t6",
      "claims": []
    },
    {
      "id": "brigid",
      "name": "Brigid",
      "sex": "female",
      "dynasty": "corvane",
      "birthYear": 968,
      "province": "p0",
      "drives": [
        0.4,
        0.3,
        0.6,
        0.5,
        0.5,
        0.5
      ],
      "father": null,
      "mother": null,
      "spouse": "magnus",
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "verena",
      "name": "Verena",
      "sex": "female",
      "dynasty": "corvane",
      "birthYear": 962,
      "province": "p6",
      "drives": [
        0.3,
        0.4,
        0.3,
        0.7,
        0.6,
        0.3
      ],
      "father": null,
      "mother": null,
      "spouse": "haldan",
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "mathilde",
      "name": "Mathilde",
      "sex": "female",
      "dynasty": "aldermark",
      "birthYear": 964,
      "province": "p3",
      "drives": [
        0.5,
        0.5,
        0.5,
        0.3,
        0.4,
        0.4
      ],
      "father": null,
      "mother": null,
      "spouse": "reynard",
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "aldric",
      "name": "Aldric",
      "sex": "male",
      "dynasty": "aldermark",
      "birthYear": 986,
      "province": "p0",
      "drives": [
        0.85,
        0.4,
        0.5,
        0.3,
        0.5,
        0.3
      ],
      "father": "magnus",
      "mother": "brigid",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": [
        {
          "title": "t3",
          "strength": "weak",
          "basis": "through his mother Brigid of Corvane",
          "year": 1000
        }
      ]
    },
    {
      "id": "roesia",
      "name": "Roesia",
      "sex": "female",
      "dynasty": "aldermark",
      "birthYear": 988,
      "province": "p0",
      "drives": [
        0.5,
        0.4,
        0.4,
        0.5,
        0.6,
        0.4
      ],
      "father": "magnus",
      "mother": "brigid",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "conrad",
      "name": "Conrad",
      "sex": "male",
      "dynasty": "aldermark",
      "birthYear": 991,
      "province": "p1",
      "drives": [
        0.7,
        0.6,
        0.6,
        0.2,
        0.4,
        0.5
      ],
      "father": "magnus",
      "mother": "brigid",
      "spouse": null,
      "founds": null,
      "holds": "t1",
      "claims": []
    },
    {
      "id": "edrik",
      "name": "Edrik",
      "sex": "male",
      "dynasty": "aldermark",
      "birthYear": 994,
      "province": "p0",
      "drives": [
        0.6,
        0.5,
        0.7,
        0.3,
        0.4,
        0.6
      ],
      "father": "magnus",
      "mother": "brigid",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "doran",
      "name": "Doran",
      "sex": "male",
      "dynasty": "aldermark",
      "birthYear": 970,
      "province": "p2",
      "drives": [
        0.75,
        0.5,
        0.6,
        0.2,
        0.5,
        0.4
      ],
      "father": null,
      "mother": null,
      "spouse": "sibyl",
      "founds": null,
      "holds": "t2",
      "claims": []
    },
    {
      "id": "sibyl",
      "name": "Sibyl",
      "sex": "female",
      "dynasty": "halvar",
      "birthYear": 974,
      "province": "p2",
      "drives": [
        0.3,
        0.4,
        0.4,
        0.6,
        0.6,
        0.4
      ],
      "father": null,
      "mother": null,
      "spouse": "doran",
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "falk",
      "name": "Falk",
      "sex": "male",
      "dynasty": "aldermark",
      "birthYear": 995,
      "province": "p2",
      "drives": [
        0.8,
        0.6,
        0.7,
        0.2,
        0.4,
        0.5
      ],
      "father": "doran",
      "mother": "sibyl",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "wystan",
      "name": "Wystan",
      "sex": "male",
      "dynasty": "aldermark",
      "birthYear": 998,
      "province": "p2",
      "drives": [
        0.6,
        0.5,
        0.5,
        0.4,
        0.4,
        0.4
      ],
      "father": "doran",
      "mother": "sibyl",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "tancred",
      "name": "Tancred",
      "sex": "male",
      "dynasty": "corvane",
      "birthYear": 983,
      "province": "p5",
      "drives": [
        0.8,
        0.6,
        0.6,
        0.2,
        0.4,
        0.4
      ],
      "father": "reynard",
      "mother": "mathilde",
      "spouse": null,
      "founds": null,
      "holds": "t5",
      "claims": []
    },
    {
      "id": "gisela",
      "name": "Gisela",
      "sex": "female",
      "dynasty": "corvane",
      "birthYear": 986,
      "province": "p3",
      "drives": [
        0.5,
        0.5,
        0.5,
        0.4,
        0.6,
        0.4
      ],
      "father": "reynard",
      "mother": "mathilde",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "bertran",
      "name": "Bertran",
      "sex": "male",
      "dynasty": "corvane",
      "birthYear": 989,
      "province": "p3",
      "drives": [
        0.6,
        0.7,
        0.5,
        0.3,
        0.4,
        0.5
      ],
      "father": "reynard",
      "mother": "mathilde",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "perrin",
      "name": "Perrin",
      "sex": "male",
      "dynasty": "corvane",
      "birthYear": 992,
      "province": "p3",
      "drives": [
        0.5,
        0.5,
        0.6,
        0.3,
        0.4,
        0.6
      ],
      "father": "reynard",
      "mother": "mathilde",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "sigmund",
      "name": "Sigmund",
      "sex": "male",
      "dynasty": "corvane",
      "birthYear": 966,
      "province": "p4",
      "drives": [
        0.7,
        0.5,
        0.5,
        0.3,
        0.5,
        0.4
      ],
      "father": null,
      "mother": null,
      "spouse": "linnea",
      "founds": null,
      "holds": "t4",
      "claims": []
    },
    {
      "id": "linnea",
      "name": "Linnea",
      "sex": "female",
      "dynasty": "halvar",
      "birthYear": 970,
      "province": "p4",
      "drives": [
        0.4,
        0.4,
        0.4,
        0.6,
        0.6,
        0.4
      ],
      "father": null,
      "mother": null,
      "spouse": "sigmund",
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "osric",
      "name": "Osric",
      "sex": "male",
      "dynasty": "corvane",
      "birthYear": 992,
      "province": "p4",
      "drives": [
        0.6,
        0.5,
        0.5,
        0.4,
        0.4,
        0.5
      ],
      "father": "sigmund",
      "mother": "linnea",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "ivar",
      "name": "Ivar",
      "sex": "male",
      "dynasty": "halvar",
      "birthYear": 984,
      "province": "p7",
      "drives": [
        0.6,
        0.5,
        0.5,
        0.4,
        0.5,
        0.4
      ],
      "father": "haldan",
      "mother": "verena",
      "spouse": null,
      "founds": null,
      "holds": "t7",
      "claims": []
    },
    {
      "id": "katla",
      "name": "Katla",
      "sex": "female",
      "dynasty": "halvar",
      "birthYear": 987,
      "province": "p6",
      "drives": [
        0.5,
        0.5,
        0.6,
        0.3,
        0.6,
        0.4
      ],
      "father": "haldan",
      "mother": "verena",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "leoric",
      "name": "Leoric",
      "sex": "male",
      "dynasty": "halvar",
      "birthYear": 990,
      "province": "p6",
      "drives": [
        0.75,
        0.6,
        0.7,
        0.2,
        0.4,
        0.5
      ],
      "father": "haldan",
      "mother": "verena",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "norbert",
      "name": "Norbert",
      "sex": "male",
      "dynasty": "halvar",
      "birthYear": 993,
      "province": "p6",
      "drives": [
        0.6,
        0.6,
        0.6,
        0.3,
        0.4,
        0.6
      ],
      "father": "haldan",
      "mother": "verena",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    },
    {
      "id": "yorick",
      "name": "Yorick",
      "sex": "male",
      "dynasty": "halvar",
      "birthYear": 996,
      "province": "p6",
      "drives": [
        0.7,
        0.5,
        0.7,
        0.2,
        0.4,
        0.5
      ],
      "father": "haldan",
      "mother": "verena",
      "spouse": null,
      "founds": null,
      "holds": null,
      "claims": []
    }
  ]
}
;
