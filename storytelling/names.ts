// names.ts — name pools for newborns and breakout commoners.
//
// Purely cosmetic, but a chronicle full of "Character c37" reads like a
// spreadsheet, not history. Names are drawn from a vaguely medieval pool and
// suffixed with the dynasty's house name elsewhere. Regnal numbers (Aldric II)
// are added at render time when a name repeats within a dynasty.

import type { RNG } from "./rng.js";

const MALE = [
  "Aldric", "Bertran", "Conrad", "Doran", "Edrik", "Falk", "Garren", "Haldan",
  "Ivar", "Joran", "Kalman", "Leoric", "Magnus", "Norbert", "Osric", "Perrin",
  "Quintus", "Reynard", "Sigmund", "Tancred", "Ulric", "Valter", "Wystan", "Yorick",
];

const FEMALE = [
  "Adela", "Brigid", "Carine", "Dervla", "Elswyth", "Frida", "Gisela", "Hedwig",
  "Isolde", "Jocelyn", "Katla", "Linnea", "Mathilde", "Nesta", "Ottilie", "Petra",
  "Roesia", "Sibyl", "Thyra", "Ulrika", "Verena", "Wilona", "Ysolt", "Zaida",
];

// Surnames for lowborn risers who found NEW dynasties on breakout — earthy,
// trade-and-place flavoured, to contrast with the noble house names.
const COMMON_SURNAMES = [
  "Ashford", "Brewer", "Carter", "Dunn", "Fletcher", "Greaves", "Holt", "Mason",
  "Reed", "Smith", "Tanner", "Weaver",
];

export function givenName(rng: RNG, sex: "male" | "female"): string {
  return rng.pick(sex === "male" ? MALE : FEMALE);
}

export function commonSurname(rng: RNG): string {
  return rng.pick(COMMON_SURNAMES);
}
