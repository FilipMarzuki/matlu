// seed.ts — the starting tableau: ~8 provinces, 3 noble houses, ~28 characters.
//
// The brief's instinct is right: relationship DENSITY makes intrigue, not map
// size. So we keep the map small and tangled and the families cross-married, so
// that within a generation claims criss-cross realm borders. Three succession
// laws (primogeniture / seniority / gavelkind) are deliberately spread across
// the three houses so the chronicle shows how differently each law makes
// history.

import { createCharacter, createDynasty } from "./people.js";
import { addClaim } from "./inheritance.js";
import type { Character, Drives, Sex } from "./types.js";
import { World } from "./world.js";

export const START_YEAR = 1000;

// Compact drive literal so the seed reads at a glance: [amb, greed, veng, piety, lust, fear].
function d(
  ambition: number,
  greed: number,
  vengeance: number,
  piety: number,
  lust: number,
  fear: number,
): Drives {
  return { ambition, greed, vengeance, piety, lust, fear };
}

export function buildWorld(seed: number): World {
  const w = new World(seed);
  w.year = START_YEAR;

  // --- Provinces: a small, tangled map ----------------------------------
  // addProvince(id, name, terrain, fertility, coastal, river, population)
  addProvince(w, "p0", "Hearthvale", "plains", 0.9, false, true, 650);
  addProvince(w, "p1", "Stonewatch", "hills", 0.6, false, false, 320);
  addProvince(w, "p2", "Rivermouth", "coast", 0.7, true, true, 450);
  addProvince(w, "p3", "Greywood", "forest", 0.55, false, true, 260);
  addProvince(w, "p4", "Thornfen", "plains", 0.8, false, false, 620);
  addProvince(w, "p5", "Saltcliff", "coast", 0.65, true, false, 430);
  addProvince(w, "p6", "Highreach", "mountain", 0.4, false, false, 130);
  addProvince(w, "p7", "Westmoor", "hills", 0.6, false, false, 330);

  // Connectivity (undirected). Note the river link p0–p3 and coast link p2–p5
  // bridge the three realms — that's how a plague (or an army) crosses borders.
  link(w, "p0", "p1");
  link(w, "p0", "p2");
  link(w, "p0", "p3");
  link(w, "p1", "p7");
  link(w, "p2", "p5");
  link(w, "p3", "p4");
  link(w, "p3", "p6");
  link(w, "p4", "p5");
  link(w, "p4", "p7");
  link(w, "p6", "p7");

  // --- Titles -----------------------------------------------------------
  // Three kingdoms, each with subordinate counties; three different laws.
  addTitle(w, "t0", "Kingdom of Valmark", "kingdom", "primogeniture", "p0", null);
  addTitle(w, "t1", "County of Stonewatch", "county", "primogeniture", "p1", "t0");
  addTitle(w, "t2", "County of Rivermouth", "county", "primogeniture", "p2", "t0");
  addTitle(w, "t3", "Kingdom of Corvane", "kingdom", "seniority", "p3", null);
  addTitle(w, "t4", "County of Thornfen", "county", "seniority", "p4", "t3");
  addTitle(w, "t5", "County of Saltcliff", "county", "seniority", "p5", "t3");
  addTitle(w, "t6", "Kingdom of Halvar", "kingdom", "gavelkind", "p6", null);
  addTitle(w, "t7", "County of Westmoor", "county", "gavelkind", "p7", "t6");

  // --- House Aldermark (Valmark, primogeniture) -------------------------
  const aldermark = createDynasty(w, "Aldermark", "");
  const magnus = person(w, aldermark.id, "Magnus", "male", 965, "p0", d(0.7, 0.4, 0.3, 0.5, 0.5, 0.3));
  aldermark.founderId = magnus.id;
  hold(w, "t0", magnus); // King of Valmark

  // --- House Corvane (Corvane, seniority) -------------------------------
  const corvane = createDynasty(w, "Corvane", "");
  const reynard = person(w, corvane.id, "Reynard", "male", 960, "p3", d(0.6, 0.6, 0.5, 0.3, 0.4, 0.4));
  corvane.founderId = reynard.id;
  hold(w, "t3", reynard); // King of Corvane

  // --- House Halvar (Halvar, gavelkind) ---------------------------------
  const halvar = createDynasty(w, "Halvar", "");
  const haldan = person(w, halvar.id, "Haldan", "male", 958, "p6", d(0.5, 0.5, 0.4, 0.6, 0.6, 0.3));
  halvar.founderId = haldan.id;
  hold(w, "t6", haldan); // King of Halvar

  // --- Cross-married queens (each from another of the three houses) ------
  // Their children carry the husband's house, but their birth-house gives the
  // heirs cross-realm blood — and thus cross-realm CLAIMS later on.
  const brigid = person(w, corvane.id, "Brigid", "female", 968, "p0", d(0.4, 0.3, 0.6, 0.5, 0.5, 0.5));
  marry(w, magnus, brigid);
  const verena = person(w, corvane.id, "Verena", "female", 962, "p6", d(0.3, 0.4, 0.3, 0.7, 0.6, 0.3));
  marry(w, haldan, verena);
  const mathilde = person(w, aldermark.id, "Mathilde", "female", 964, "p3", d(0.5, 0.5, 0.5, 0.3, 0.4, 0.4));
  marry(w, reynard, mathilde);

  // --- Aldermark children + cadet branch --------------------------------
  const aldric = child(w, magnus, brigid, "Aldric", "male", 986, d(0.85, 0.4, 0.5, 0.3, 0.5, 0.3));
  child(w, magnus, brigid, "Roesia", "female", 988, d(0.5, 0.4, 0.4, 0.5, 0.6, 0.4));
  const conrad = child(w, magnus, brigid, "Conrad", "male", 991, d(0.7, 0.6, 0.6, 0.2, 0.4, 0.5));
  child(w, magnus, brigid, "Edrik", "male", 994, d(0.6, 0.5, 0.7, 0.3, 0.4, 0.6));
  // Magnus's younger brother — a cadet line seated at Rivermouth.
  const doran = person(w, aldermark.id, "Doran", "male", 970, "p2", d(0.75, 0.5, 0.6, 0.2, 0.5, 0.4));
  const sibyl = person(w, halvar.id, "Sibyl", "female", 974, "p2", d(0.3, 0.4, 0.4, 0.6, 0.6, 0.4));
  marry(w, doran, sibyl);
  child(w, doran, sibyl, "Falk", "male", 995, d(0.8, 0.6, 0.7, 0.2, 0.4, 0.5));
  child(w, doran, sibyl, "Wystan", "male", 998, d(0.6, 0.5, 0.5, 0.4, 0.4, 0.4));
  hold(w, "t1", conrad); // 2nd son holds Stonewatch
  hold(w, "t2", doran); // brother holds Rivermouth

  // Aldric carries a WEAK claim to Corvane through his mother Brigid — a
  // single seeded cross-realm grievance to get the inter-house wars going.
  addClaim(aldric, {
    titleId: "t3",
    strength: "weak",
    basis: "through his mother Brigid of Corvane",
    year: START_YEAR,
  });

  // --- Corvane children + cadet branch ----------------------------------
  const tancred = child(w, reynard, mathilde, "Tancred", "male", 983, d(0.8, 0.6, 0.6, 0.2, 0.4, 0.4));
  child(w, reynard, mathilde, "Gisela", "female", 986, d(0.5, 0.5, 0.5, 0.4, 0.6, 0.4));
  child(w, reynard, mathilde, "Bertran", "male", 989, d(0.6, 0.7, 0.5, 0.3, 0.4, 0.5));
  child(w, reynard, mathilde, "Perrin", "male", 992, d(0.5, 0.5, 0.6, 0.3, 0.4, 0.6));
  // Reynard's brother Sigmund — under SENIORITY he outranks Reynard's sons!
  const sigmund = person(w, corvane.id, "Sigmund", "male", 966, "p4", d(0.7, 0.5, 0.5, 0.3, 0.5, 0.4));
  const linnea = person(w, halvar.id, "Linnea", "female", 970, "p4", d(0.4, 0.4, 0.4, 0.6, 0.6, 0.4));
  marry(w, sigmund, linnea);
  child(w, sigmund, linnea, "Osric", "male", 992, d(0.6, 0.5, 0.5, 0.4, 0.4, 0.5));
  hold(w, "t4", sigmund); // brother holds Thornfen
  hold(w, "t5", tancred); // heir-presumptive holds Saltcliff for now

  // --- Halvar children (gavelkind => many claimants) --------------------
  const ivar = child(w, haldan, verena, "Ivar", "male", 984, d(0.6, 0.5, 0.5, 0.4, 0.5, 0.4));
  child(w, haldan, verena, "Katla", "female", 987, d(0.5, 0.5, 0.6, 0.3, 0.6, 0.4));
  child(w, haldan, verena, "Leoric", "male", 990, d(0.75, 0.6, 0.7, 0.2, 0.4, 0.5));
  child(w, haldan, verena, "Norbert", "male", 993, d(0.6, 0.6, 0.6, 0.3, 0.4, 0.6));
  child(w, haldan, verena, "Yorick", "male", 996, d(0.7, 0.5, 0.7, 0.2, 0.4, 0.5));
  hold(w, "t7", ivar); // eldest holds Westmoor

  return w;
}

// ---------------------------------------------------------------------------
// Small builders used only by the seed.
// ---------------------------------------------------------------------------
function addProvince(
  w: World,
  id: string,
  name: string,
  terrain: "plains" | "hills" | "forest" | "coast" | "mountain",
  fertility: number,
  coastal: boolean,
  riverConnected: boolean,
  population: number,
): void {
  // Mana density is derived from terrain: wild, untamed land (mountains,
  // forests) holds more of it — and is more perilous, which is what mints
  // high-level people. The fat farming heartlands are mana-poor and safe.
  const MANA: Record<string, number> = {
    mountain: 0.8,
    forest: 0.6,
    coast: 0.4,
    hills: 0.4,
    plains: 0.25,
  };
  w.provinces.set(id, {
    id,
    name,
    terrain,
    fertility,
    coastal,
    riverConnected,
    neighbors: [],
    population,
    titleId: "", // filled by addTitle
    manaDensity: MANA[terrain] ?? 0.3,
  });
}

function link(w: World, a: string, b: string): void {
  w.province(a)!.neighbors.push(b);
  w.province(b)!.neighbors.push(a);
}

function addTitle(
  w: World,
  id: string,
  name: string,
  tier: "county" | "duchy" | "kingdom",
  law: "primogeniture" | "gavelkind" | "elective" | "seniority",
  provinceId: string,
  liegeId: string | null,
): void {
  w.titles.set(id, { id, name, tier, law, holderId: null, provinceId, liegeId });
  w.province(provinceId)!.titleId = id;
}

function person(
  w: World,
  dynastyId: string,
  name: string,
  sex: Sex,
  birthYear: number,
  provinceId: string,
  drives: Drives,
): Character {
  return createCharacter(w, { name, sex, dynastyId, birthYear, provinceId, drives });
}

function child(
  w: World,
  father: Character,
  mother: Character,
  name: string,
  sex: Sex,
  birthYear: number,
  drives: Drives,
): Character {
  return createCharacter(w, {
    name,
    sex,
    dynastyId: father.dynastyId,
    birthYear,
    provinceId: father.provinceId,
    drives,
    fatherId: father.id,
    motherId: mother.id,
  });
}

function marry(_w: World, a: Character, b: Character): void {
  a.spouseId = b.id;
  b.spouseId = a.id;
  // Wife resides at husband's seat.
  if (a.sex === "male") b.provinceId = a.provinceId;
  else a.provinceId = b.provinceId;
}

function hold(w: World, titleId: string, c: Character): void {
  const t = w.title(titleId)!;
  t.holderId = c.id;
  c.provinceId = t.provinceId;
}
