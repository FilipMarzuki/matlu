/**
 * Who lives in the generated Reach, as the history engine needs them (#1540).
 *
 * The engine wants each culture as data: names to give children, a temperament newborns lean
 * toward, a succession law. These are the Reach's cultures, ids from `macro-world/cultures.json`
 * (cultures are race-agnostic, see CLAUDE.md), written out here because the Artificer owns its
 * content and doesn't read the Homestead's registries (#1531). The same cultures already live in
 * the hand-written villages (villages.ts): Hollowford is fieldborn and ridgefolk, Saltmere is
 * waterstead and steppe-camp, Kestrel Gate's passes are mountainhold country.
 *
 * Which Peoples follow each culture comes from docs/peoples-and-races.md. The engine's races are
 * those Peoples, with no invented biology or old hatreds: canon gives them none. There are no
 * faiths either: in Mistheim the gods are dead and their names aren't said (WORLD.md), so nobody
 * fights a holy war.
 */

import type { CultureSpec, RaceSpec, TitleSpec } from '../../../storytelling/world-spec';
import type { SuccessionLaw } from '../../../storytelling/types';
import type { People } from '../villages';

export type ReachCulture = 'fieldborn' | 'ridgefolk' | 'waterstead' | 'steppe-camp' | 'mountainhold';

/** Drive biases in the engine's order: [ambition, greed, vengeance, piety, lust, fear]. */
const D = (a: number, g: number, v: number, p: number, l: number, f: number): number[] => [a, g, v, p, l, f];

export const REACH_CULTURES: readonly CultureSpec[] = [
  {
    // Markfolk farmers of the valley floor: patient, dry, slow to forgive (Maren of Hollowford).
    id: 'fieldborn', name: 'Fieldborn', law: 'primogeniture',
    driveBias: D(0.4, 0.5, 0.55, 0.45, 0.45, 0.45),
    biasSeed: { loss_aversion: 0.35, sunk_cost: 0.25 },
    namesMale: ['Arvid', 'Bengt', 'Einar', 'Gösta', 'Halvard', 'Ivar', 'Jonas', 'Knut', 'Nils', 'Olof', 'Per', 'Sten'],
    namesFemale: ['Agnes', 'Brita', 'Dagny', 'Elin', 'Frida', 'Greta', 'Hedda', 'Karin', 'Liv', 'Maja', 'Tova', 'Ylva'],
    surnames: ['Barleyhold', 'Hedlund', 'Kornby', 'Fallowmark', 'Lindgren', 'Oxlade'],
  },
  {
    // Markfolk and Bergfolk of the wooded heights: gruff, generous, impossible to rush (Orrin).
    id: 'ridgefolk', name: 'Ridgefolk', law: 'gavelkind',
    driveBias: D(0.5, 0.45, 0.6, 0.4, 0.5, 0.25),
    biasSeed: { honor_bound: 0.45, fatalist: 0.3 },
    namesMale: ['Bror', 'Eskil', 'Folke', 'Hjalmar', 'Holger', 'Orvar', 'Ragnar', 'Stig', 'Torbjörn', 'Ulf'],
    namesFemale: ['Åsa', 'Gunhild', 'Hjördis', 'Ragnhild', 'Ronja', 'Signe', 'Solveig', 'Thyra', 'Vigdis'],
    surnames: ['Bergqvist', 'Crowhelm', 'Ridgeholt', 'Stenmark', 'Tallow', 'Ulfhild'],
  },
  {
    // Pandor of the lakes and rivers: archivists who write every sale in a book (Saltmere).
    id: 'waterstead', name: 'Waterstead', law: 'seniority',
    driveBias: D(0.4, 0.55, 0.35, 0.5, 0.4, 0.45),
    biasSeed: { mercantile: 0.4, loss_aversion: 0.3 },
    startingTraits: ['literacy_valued', 'mercantile'],
    namesMale: ['Anund', 'Edvin', 'Gunnar', 'Hakon', 'Lars', 'Måns', 'Ture', 'Viggo'],
    namesFemale: ['Alva', 'Embla', 'Idun', 'Linnea', 'Märta', 'Saga', 'Svea', 'Vendela'],
    surnames: ['Inkwell', 'Ledgerby', 'Marshbook', 'Reedwater', 'Sjöberg', 'Tallyman'],
  },
  {
    // Viddfolk of the open heath: route-singers who keep the roads (Yrsa).
    id: 'steppe-camp', name: 'Steppe-camp', law: 'elective',
    driveBias: D(0.55, 0.45, 0.5, 0.35, 0.55, 0.3),
    biasSeed: { honor_bound: 0.35, fatalist: 0.35 },
    namesMale: ['Aslak', 'Brage', 'Dag', 'Egil', 'Finn', 'Joar', 'Vidar', 'Yngve'],
    namesFemale: ['Aud', 'Bodil', 'Eira', 'Hild', 'Rakel', 'Runa', 'Tyra', 'Yrsa'],
    surnames: ['Farsong', 'Longroad', 'Heathwalker', 'Windward', 'Vidmark'],
  },
  {
    // Bergfolk holds in the fells and passes: runesmiths, long memories, carved halls.
    id: 'mountainhold', name: 'Mountainhold', law: 'clan_elder',
    driveBias: D(0.45, 0.6, 0.7, 0.45, 0.35, 0.2),
    biasSeed: { sunk_cost: 0.45, honor_bound: 0.4 },
    startingTraits: ['meritocracy'],
    namesMale: ['Brandr', 'Dvalgar', 'Hrafn', 'Ketil', 'Orm', 'Sigvald', 'Thrand', 'Vemund'],
    namesFemale: ['Arnhild', 'Bergljot', 'Gudrun', 'Hallgerd', 'Ingunn', 'Jorunn', 'Rannveig', 'Torunn'],
    surnames: ['Anvilsong', 'Deepcarve', 'Runehall', 'Stonebeard', 'Fellhammer'],
  },
];

/** The Peoples who follow each culture, with weights (docs/peoples-and-races.md). */
export const PEOPLES_OF: Readonly<Record<ReachCulture, readonly [People, number][]>> = {
  fieldborn: [['Markfolk', 1]],
  ridgefolk: [['Markfolk', 0.5], ['Bergfolk', 0.5]],
  waterstead: [['Pandor', 1]],
  'steppe-camp': [['Viddfolk', 1]],
  mountainhold: [['Bergfolk', 1]],
};

export const REACH_PEOPLES: readonly RaceSpec[] = (['Markfolk', 'Bergfolk', 'Pandor', 'Viddfolk'] as const).map(id => ({ id, name: id }));

/** What each culture calls a lordship: a county (one province) and a realm (several). */
export const TITLE_WORDS: Readonly<Record<ReachCulture, Record<TitleSpec['tier'], string>>> = {
  fieldborn: { county: 'Hundred', duchy: 'Lordship', kingdom: 'Kingdom' },
  ridgefolk: { county: 'Hold', duchy: 'High Hold', kingdom: 'Kingdom' },
  waterstead: { county: 'Moot', duchy: 'League', kingdom: 'Kingdom' },
  'steppe-camp': { county: 'Camp', duchy: 'Circle', kingdom: 'Kingdom' },
  mountainhold: { county: 'Hall', duchy: 'Deep Hall', kingdom: 'Kingdom' },
};

export const lawOf = (c: ReachCulture): SuccessionLaw => REACH_CULTURES.find(s => s.id === c)!.law!;
export const cultureName = (c: ReachCulture): string => REACH_CULTURES.find(s => s.id === c)!.name;
