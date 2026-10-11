// odd-patches.test.ts — #1633: odd patches of humans and strangely growing
// settlements, never explained. Excluded from storytelling/tsconfig (it imports
// `vitest`); run by `npm run unit:story`.
//
// Owner canon: humans are native to Mistheim, but throughout history there have
// been odd patches of extra humans in unexpected places, and some human
// settlements have grown in strange ways. Nobody in the world knows why, so the
// engine shows it and never explains it.
//
// Most scenarios build a tiny three-province world by hand (a Bergfolk hold, a
// human village and a Lövfolk wood, in a row) and call the pass's two pieces
// directly, so they don't have to hunt for a seed where a rare event happens.
// The long-run scenarios run the frontier world (which has humans) over many
// seeds, once, in beforeAll.

import { beforeAll, describe, expect, test } from "vitest";
import {
  ODD_PATCH_CHANCE,
  STRANGE_GROWTH_CHANCE,
  isHumanRace,
  runOddPatches,
  spawnOddPatch,
  strangeGrowth,
} from "./odd-patches.js";
import { carryingCapacity } from "./geography.js";
import { oddHumansSaying, renderEvent } from "./render.js";
import { RNG } from "./rng.js";
import { loadWorld } from "./seed.js";
import { sift } from "./sifter.js";
import { runSim } from "./testkit.js";
import { tick } from "./tick.js";
import type { WorldEvent } from "./types.js";
import { oddPatchSeed, type World } from "./world.js";
import type { RaceSpec, WorldSpec } from "./world-spec.js";

// --- A tiny world: Bergfolk hold — human village — Lövfolk wood ------------
const RACES: RaceSpec[] = [
  { id: "Bergfolk", name: "Bergfolk" },
  { id: "Riksfolk", name: "Riksfolk", human: true },
  { id: "Lövfolk", name: "Lövfolk" },
];
function tinySpec(races: RaceSpec[] = RACES): WorldSpec {
  const prov = (id: string, name: string, neighbors: string[], terrain: "hills" | "plains" | "forest") => ({
    id, name, terrain, fertility: 0.8, coastal: false, river: false, neighbors, population: 400, mana: 0.1,
  });
  const people = [
    { p: "berg", race: "Bergfolk", culture: "highhall", house: "Stonebeard" },
    { p: "vale", race: "Riksfolk", culture: "fieldborn", house: "Kornby" },
    { p: "wood", race: "Lövfolk", culture: "greenwood", house: "Lindgren" },
  ];
  return {
    startYear: 1,
    provinces: [
      prov("berg", "Gravhall", ["vale"], "hills"),
      prov("vale", "Hollowford", ["berg", "wood"], "plains"),
      prov("wood", "Alderwood", ["vale"], "forest"),
    ],
    titles: people.map((x) => ({ id: `t_${x.p}`, name: `Hold of ${x.p}`, tier: "county" as const, law: "primogeniture" as const, seat: x.p, liege: null })),
    dynasties: people.map((x) => ({ id: `d_${x.p}`, name: x.house, culture: x.culture, race: x.race, faith: `f_${x.p}` })),
    characters: people.map((x, i) => ({
      id: `c${i}`, name: `Lord${i}`, sex: "male" as const, dynasty: `d_${x.p}`, birthYear: -30, province: x.p,
      drives: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], father: null, mother: null, spouse: null, founds: `d_${x.p}`, holds: `t_${x.p}`, claims: [],
    })),
    cultures: ["highhall", "fieldborn", "greenwood"].map((id) => ({
      id, name: id[0].toUpperCase() + id.slice(1), namesMale: ["Arn", "Bo", "Esbjörn"], namesFemale: ["Ylva", "Saga", "Tyra"], surnames: ["Hedlund", "Oxlade"],
    })),
    races,
    faiths: ["f_berg", "f_vale", "f_wood"].map((id) => ({ id, name: id })),
  };
}
const tiny = (races?: RaceSpec[]) => loadWorld(tinySpec(races), 7);
const NAMES_EARTH = /\bearth\b|fragment/i;

describe("odd patches of humans (#1633)", () => {
  // Scenario 1
  // Given a world with humans in it (the frontier),
  // When it lives through 200 years, over many seeds,
  // Then odd patches and strange growths both turn up, a few per run, and each rarer than plagues.
  describe("over a long run", () => {
    const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let patches = 0, growths = 0, plagues = 0;
    let worlds: World[] = [];
    beforeAll(() => {
      worlds = SEEDS.map((seed) => runSim({ name: `frontier·s${seed}`, world: "frontier", seed, years: 200 }));
      for (const w of worlds) for (const e of w.events) {
        if (e.type === "ODD_PATCH") patches++;
        if (e.type === "STRANGE_GROWTH") growths++;
        if (e.type === "PLAGUE") plagues++;
      }
    }, 180_000);

    test("a few odd patches and strange growths appear, rarer than plagues", () => {
      expect(ODD_PATCH_CHANCE).toBeLessThan(0.03); // plague's yearly chance (phenomena.ts)
      expect(STRANGE_GROWTH_CHANCE).toBeLessThan(0.03);
      expect(patches).toBeGreaterThan(0);
      expect(growths).toBeGreaterThan(0);
      expect(patches).toBeLessThan(plagues);
      expect(growths).toBeLessThan(plagues);
      // "A few" per 200-year history: on average between one and five of each.
      expect(patches / SEEDS.length).toBeGreaterThanOrEqual(0.5);
      expect(patches / SEEDS.length).toBeLessThanOrEqual(5);
      expect(growths / SEEDS.length).toBeGreaterThanOrEqual(0.5);
      expect(growths / SEEDS.length).toBeLessThanOrEqual(5);
    });

    // Scenario 6 (long-run half): every one the chronicle tells is a mystery that never names the cause.
    test("every telling is unexplained and never names Earth", () => {
      for (const w of worlds) for (const e of w.events) {
        if (e.type !== "ODD_PATCH" && e.type !== "STRANGE_GROWTH") continue;
        const line = renderEvent(w, e);
        expect(line).not.toMatch(NAMES_EARTH);
        expect(line).toMatch(e.type === "ODD_PATCH" ? /where they had come from/ : /no road had brought them/);
      }
    });
  });

  // Scenario 2
  // Given a world with no human race (the default tableau has no peoples),
  // When it lives through 200 years,
  // Then no odd patch or strange growth happens, and their stream is never drawn.
  test("a world without humans never sees them, and never draws from their stream", () => {
    const w = runSim({ name: "default·s42", world: "default", seed: 42, years: 200 });
    expect(w.events.some((e) => e.type === "ODD_PATCH" || e.type === "STRANGE_GROWTH")).toBe(false);
    expect(w.oddPatchRng.next()).toBe(new RNG(oddPatchSeed(42)).next());
  }, 60_000);

  // Scenario 3
  // Given a Bergfolk hold with no humans in it,
  // When an odd patch of humans turns up there,
  // Then they are new people with no parents, of a human People, in a new low-born
  // house that takes the culture and faith of the hold, and its population grows by their number.
  test("strangers have no past and take the culture of the place they settle", () => {
    const w = tiny();
    const before = w.province("berg")!.population;
    const eventsBefore = w.events.length;
    const ev = spawnOddPatch(w, "berg")!;
    expect(ev.type).toBe("ODD_PATCH");
    expect(ev.provinceId).toBe("berg");
    expect(w.events.length).toBe(eventsBefore + 1); // nothing else: no births, no migration
    const house = w.dynasty(w.char(ev.actorId)!.dynastyId)!;
    const people = w.living().filter((c) => c.dynastyId === house.id);
    expect(people.length).toBe(Number(ev.data["named"]));
    expect(people.length).toBeGreaterThanOrEqual(2);
    for (const c of people) {
      expect(c.fatherId).toBeNull();
      expect(c.motherId).toBeNull();
      expect(c.lowborn).toBe(true);
      expect(c.provinceId).toBe("berg");
      expect(w.age(c)).toBeGreaterThanOrEqual(16);
    }
    expect(isHumanRace(w.races.get(house.raceId))).toBe(true);
    expect(house.cultureId).toBe("highhall");
    expect(house.faithId).toBe("f_berg");
    expect(house.founderId).toBe(ev.actorId);
    expect(w.province("berg")!.population).toBe(before + Number(ev.data["souls"]));
    expect(ev.data["unexpected"]).toBe(true); // no humans in the hold before them
  });

  // Scenario 3b
  // Given many odd patches, in places with small name pools and none,
  // When their people are named,
  // Then no two strangers of one patch share a given name (no "Gunhild I" among them).
  test("strangers of one patch never share a given name", () => {
    for (let i = 0; i < 40; i++) {
      const w = loadWorld(tinySpec(), 100 + i);
      for (const where of ["berg", "vale", "wood"]) {
        const ev = spawnOddPatch(w, where)!;
        const house = w.char(ev.actorId)!.dynastyId;
        const names = w.living().filter((c) => c.dynastyId === house).map((c) => c.name);
        expect(new Set(names).size, names.join(",")).toBe(names.length);
      }
    }
    // And with no culture at all (the global name pool).
    const bare = tinySpec();
    for (const d of bare.dynasties) delete d.culture;
    for (let i = 0; i < 40; i++) {
      const w = loadWorld(bare, 300 + i);
      const ev = spawnOddPatch(w, "berg")!;
      const house = w.char(ev.actorId)!.dynastyId;
      const names = w.living().filter((c) => c.dynastyId === house).map((c) => c.name);
      expect(new Set(names).size, names.join(",")).toBe(names.length);
    }
  });

  // Scenario 4
  // Given a world with humans,
  // When the pass runs, an odd patch is planted or a settlement grows,
  // Then nothing is drawn from the main stream (only from the odd-patches stream).
  test("the pass never draws from the main stream", () => {
    const w = tiny();
    (w.rng as unknown as { next: () => number }).next = () => { throw new Error("drew from w.rng"); };
    expect(() => spawnOddPatch(w, "wood")).not.toThrow();
    expect(() => strangeGrowth(w, "vale")).not.toThrow();
    // Every roll comes up "yes" so both halves of the yearly pass run.
    (w.oddPatchRng as unknown as { next: () => number }).next = () => 0.001;
    expect(() => runOddPatches(w)).not.toThrow();
    expect(w.events.filter((e) => e.type === "ODD_PATCH").length).toBe(2);
    expect(w.events.filter((e) => e.type === "STRANGE_GROWTH").length).toBe(2);
  });

  // Scenario 5
  // Given a human village with room to grow,
  // When it grows strangely,
  // Then its population jumps well past what a year's births give, with no arrivals:
  // no named newcomers, no migration read by the regional level.
  test("a human settlement swells with no arrivals from any known place", () => {
    const w = tiny();
    const vale = w.province("vale")!;
    const before = vale.population;
    const charsBefore = w.characters.size;
    const ev = strangeGrowth(w, "vale")!;
    expect(ev.type).toBe("STRANGE_GROWTH");
    expect(ev.actorId).toBeNull();
    const gain = Number(ev.data["gain"]);
    expect(vale.population).toBe(before + gain);
    expect(gain / before).toBeGreaterThanOrEqual(0.08); // a normal year's growth is at most 3%
    expect(vale.population).toBeLessThanOrEqual(Math.round(carryingCapacity(vale) * 1.25));
    expect(w.characters.size).toBe(charsBefore);
    tick(w); // the regional level reads the year after
    expect(w.regionalEvents.some((r) => r.kind === "MIGRATION" && r.causeEventId === ev.id)).toBe(false);
    // Only human settlements grow like this: the Bergfolk hold never does.
    expect(strangeGrowth(w, "berg")).toBeNull();
  });

  // Scenario 6
  // Given an odd patch and a strange growth,
  // When the chronicle tells them,
  // Then both are told as mysteries and neither names Earth or any cause.
  test("both are told as unexplained, and no text names Earth", () => {
    const w = tiny();
    const patch = spawnOddPatch(w, "berg")!;
    const growth = strangeGrowth(w, "vale")!;
    const a = renderEvent(w, patch), b = renderEvent(w, growth);
    expect(a).toMatch(/where they had come from/);
    expect(b).toMatch(/no road had brought them/);
    for (const line of [a, b]) expect(line).not.toMatch(NAMES_EARTH);
    for (const r of [...RACES, { id: "orc", name: "Orc" }, { id: "goblin", name: "Goblin" }]) {
      const ww = tiny([...RACES, r]);
      expect(oddHumansSaying(ww, r.id)).not.toMatch(NAMES_EARTH);
    }
    expect(oddHumansSaying(w, "")).not.toMatch(NAMES_EARTH);
  });

  // Scenario 7
  // Given strangers found among the Bergfolk, and a human village bordered by the Lövfolk,
  // When the chronicle tells them,
  // Then each People explains it its own way (WORLD.md): the Bergfolk say the deep rock
  // coughs them up, the Lövfolk that humans root like weeds, the goblins that humans
  // breed when nobody's looking; a People the engine doesn't know says humans come, not grow;
  // and a spec can give a People its own saying.
  test("each People explains it its own way", () => {
    const w = tiny();
    expect(oddHumansSaying(w, "Bergfolk")).toMatch(/deep rock/);
    expect(oddHumansSaying(w, "Lövfolk")).toMatch(/root like weeds/);
    const g = tiny([...RACES, { id: "goblin", name: "Goblin" }]);
    expect(oddHumansSaying(g, "goblin")).toMatch(/nobody's looking/);
    const o = tiny([...RACES, { id: "orc", name: "Orc" }]);
    expect(oddHumansSaying(o, "orc")).toMatch(/the orcs .*come; they do not grow/i);
    const own = tiny([...RACES, { id: "pandor", name: "Pandor", oddHumansSaying: "The Pandor say the lake gives back what it was given." }]);
    expect(oddHumansSaying(own, "pandor")).toBe("The Pandor say the lake gives back what it was given.");

    const patch = spawnOddPatch(w, "berg")!;
    expect(patch.data["teller"]).toBe("Bergfolk");
    expect(renderEvent(w, patch)).toMatch(/deep rock/);
    // The village is human: its tellers are the neighbouring People (the most populous non-human neighbour).
    w.province("wood")!.population = 900;
    const growth = strangeGrowth(w, "vale")!;
    expect(growth.data["teller"]).toBe("Lövfolk");
    expect(renderEvent(w, growth)).toMatch(/root like weeds/);
  });

  // Scenario 8
  // Given an odd patch and a strange growth in the log,
  // When the sifter scores the history,
  // Then both are worth telling: above the Reach's telling threshold (5), an odd patch more than a growth.
  test("the sifter finds them worth telling", () => {
    const w = tiny();
    const patch = spawnOddPatch(w, "berg")!;
    const growth = strangeGrowth(w, "vale")!;
    const { chronicle } = sift(w, 5);
    expect(patch.significance).toBeGreaterThanOrEqual(7);
    expect(growth.significance).toBeGreaterThanOrEqual(5);
    expect(patch.significance).toBeGreaterThan(growth.significance);
    expect(chronicle.map((e) => e.id)).toEqual(expect.arrayContaining([patch.id, growth.id]));
  });

  // Scenario 9
  // Given the same world and seed,
  // When it lives through its history twice,
  // Then the same strangers turn up in the same places, and the same settlements grow.
  test("deterministic: same seed, same strangers", () => {
    const pick = (w: World) => w.events.filter((e: WorldEvent) => e.type === "ODD_PATCH" || e.type === "STRANGE_GROWTH")
      .map((e) => `${e.year}|${e.type}|${e.provinceId}|${e.actorId}|${JSON.stringify(e.data)}`);
    const cfg = { name: "frontier·s5", world: "frontier" as const, seed: 5, years: 200 };
    expect(pick(runSim(cfg))).toEqual(pick(runSim(cfg)));
  }, 60_000);
});
