/**
 * Encounters (#1343, epic #1342): things that happen while you work — an animal, a find, a
 * person — that pause the day and ask you to choose.
 *
 * Like trip luck (#1314) and accidents (#1285), they are seeded and fair: whether one happens
 * comes from a fixed roll for the day and hour, and how an option turns out from a fixed roll for
 * that encounter and choice. The same plan meets the same thing; reloading changes nothing.
 *
 * Options carry requirements (a skill level, a talent, a stat, something in stores or tools),
 * a cost, and odds that stats, skills, talents and tools move. The odds are shown in words —
 * safe, likely, risky, desperate — never as numbers, to a person and to the AI alike.
 *
 * Pure data and pure helpers; region1.ts pauses the day and applies the outcome. The templates
 * here are a first pair for the engine; animals, finds and people come in #1344–#1346.
 */

import type { Ring } from './exploration';
import type { Season } from './winter';
import type { Stores } from './region1';
import type { Grade, Tool } from './crafting';
import type { Stats, StatId } from './stats';
import type { Talent, TalentId } from './talents';
import { skillLevel, type SkillId, type SkillPractice } from './skills';
import { streamFor } from './rng';
import { ADRENALINE, SHAKEN_PENALTY, type PanicState, type Response, type Threat } from './panic';
import { JUMPY_FLIGHT, type Quirk } from './quirks';
import { talentEffects } from './talents';
import { pinCapacity, pinId, FULL_MEMORY, ALREADY_PINNED, type Pin, type PinKind, type Feeling } from './pins';

export type EncounterKind = 'animal' | 'find' | 'person' | 'place';

/** What an option needs before it can be chosen. All listed must hold. */
export interface Requirement {
  skill?: { id: SkillId; level: number };
  talent?: TalentId;
  stat?: { id: StatId; min: number };
  /** Goods in stores (also what the option costs, if `cost` repeats them). */
  stores?: Partial<Record<keyof Stores, number>>;
  /** An item among your tools. */
  tool?: string;
  /** Marks in hand (#1349): the road's currency. */
  marks?: number;
}

/** What an outcome does. Numbers are changes (negative costs). */
export interface Effect {
  text: string;
  condition?: number;
  vigor?: number;
  clarity?: number;
  stores?: Partial<Record<keyof Stores, number>>;
  /** Extra hours it takes. */
  hours?: number;
  /** If this takes Condition to 0, what the journal says killed you. */
  killedBy?: string;
  /**
   * A wound (#1344): base Condition lost, scaled by the body — 5% less per point of CON above 10
   * (more below), between half and half again of the base — and softened by Tough.
   */
  wound?: number;
  /** Practice a skill gets from it (watching a lynx hunt teaches hunting). */
  practice?: { skill: SkillId; hours: number };
  /** Extra goods if you have a talent (Hunter's Patience gets more from a kill). */
  talentStores?: Partial<Record<TalentId, Partial<Record<keyof Stores, number>>>>;
  /** A dialogue goes on (#1346): the next step's id. The encounter stays open, and the day paused. */
  next?: string;
  /** Something you did that the world may remember later (#1346): fed a starving stranger, put a herald right. */
  deed?: string;
  /** Insight a concept gains (a scholar's talk). */
  insight?: { concept: string; amount: number };
  /** A ring's ground you come to know (a delver's map): surveyed, as if you had walked it. */
  survey?: Ring;
  /** A tool you find (#1345): an old knife in an abandoned camp, a snare on a line. */
  tool?: { item: string; grade: Grade };
  /** A manual you don't have yet (#1345): a page in a dead trapper's pack. Nothing more if you have them all. */
  manual?: boolean;
  /** Something that comes in overnight (#1345): a snare line you reset catches by morning. */
  overnight?: { stores: Partial<Record<keyof Stores, number>>; text: string };
  /** Marks won or lost (#1349), on the road. */
  marks?: number;
  /** Trust won or lost (#1349), by person id — the caravan's people, on the road. */
  trust?: Readonly<Record<string, number>>;
  /** Remember the place (#1378): a pin of this kind, with how it made you feel. */
  pin?: { kind: PinKind; feeling?: Feeling };
}

/** How stats, skills, talents and tools move an option's chance of success. */
export interface OddsMods {
  /** Per point of the stat above 10 (negative below). */
  stats?: Partial<Record<StatId, number>>;
  /** Per true level of the skill. */
  skills?: Partial<Record<SkillId, number>>;
  /** If you have the talent (known or not — talents work before you know them). */
  talents?: Partial<Record<TalentId, number>>;
  /** If you carry the tool. */
  tools?: Readonly<Record<string, number>>;
  /** With Clarity under `below`, the odds move by `add` (#1345): a tired mind shouldn't touch what it can't read. */
  lowClarity?: { below: number; add: number };
}

export interface EncounterOption {
  id: string;
  label: string;
  requires?: Requirement;
  /** Paid when chosen, whatever the outcome. */
  cost?: { stores?: Partial<Record<keyof Stores, number>>; hours?: number; marks?: number };
  /** Base chance of success, 0–1. */
  odds: number;
  mods?: OddsMods;
  /** If you meet this, the option is a sure thing (#1344): a good scout backs away from a bear safely. */
  sureIf?: Requirement;
  /** Talking someone round (#1346): Silver Tongue makes it one odds word better. */
  persuasion?: boolean;
  /** Needs a clear head (#1360): fine judgement, talking, stalking. Shaken, it goes one odds word worse; panicked, it's closed. */
  careful?: boolean;
  /** Remembering a place (#1378): closed when your memory is full, or you already remember it. */
  remembers?: boolean;
  /** Which panic response this option is (#1361): what instinct reaches for when it takes over. */
  response?: Response;
  success: Effect;
  /** Between success and failure: half the misses land here, if given. */
  mixed?: Effect;
  fail: Effect;
}

export interface EncounterTemplate {
  id: string;
  kind: EncounterKind;
  /** What you see. */
  text: string;
  /** Where and when it can happen. Absent means anywhere / any time. */
  rings?: readonly Ring[];
  seasons?: readonly Season[];
  /** Only in the dark (light under 0.5), or only by day. */
  dark?: boolean;
  /** Also in the dark, whatever the season (#1344): wolves are out in winter, or at dusk any time. */
  orDark?: boolean;
  /** Relative weight among the encounters that fit. */
  weight: number;
  /** The danger it truly holds, 0–4 (#1360). What it *looks* like is panic.ts's `perceivedThreat`. */
  threat: Threat;
  /** What kind of danger it is (`animal`, `heights`, `person`…) — what fears attach to (#1362). */
  tags: readonly string[];
  /** The skill whose mastery makes it look smaller. */
  field?: SkillId;
  /** What happens if you freeze (#1361): you lose hours, and the danger decides. */
  freeze: Effect;
  /** A road encounter (#1349): met from the wagon, in a village, or either — never in the Reach. */
  road?: 'wagon' | 'village' | 'any';
  /** A dialogue's later steps (#1346), by id: each with what is said and the options it gives. At most three steps in all. */
  steps?: Readonly<Record<string, EncounterStep>>;
  options: readonly EncounterOption[];
}

/** A later step of a dialogue (#1346). */
export interface EncounterStep { text: string; options: readonly EncounterOption[] }

/** The step an encounter is on (#1346): its opening, or a later step of the dialogue. */
export function stepOf(t: EncounterTemplate, step?: string | null): EncounterStep {
  return (step && t.steps?.[step]) || { text: t.text, options: t.options };
}

/** The step a Warden is on in this encounter: their pending one if it's this encounter, else the opening. */
const stepFor = (w: Encounterer, t: EncounterTemplate): EncounterStep => stepOf(t, w.pending?.id === t.id ? w.pending.step : null);

/** An encounter waiting for your choice. */
export interface PendingEncounter {
  id: string; day: number; hour: number; ring: Ring; action: string;
  /** Where in a dialogue you are (#1346); absent at the opening. */
  step?: string;
  /** How it looked, and how you stood, when it opened (#1360). Absent (an older save) reads as calm. */
  perceived?: Threat;
  state?: PanicState;
  /** Perceived threat minus nerve, when it opened: how far past holding you were (#1361). */
  margin?: number;
}

/** The odds in words: what a person (and the AI) is told. */
export type OddsWord = 'safe' | 'likely' | 'risky' | 'desperate';

/** Chance per land trip, by ring; darkness multiplies it. At most one encounter a day. */
export const ENCOUNTER_CHANCE: Readonly<Record<Ring, number>> = { 1: 0.03, 2: 0.07, 3: 0.12 };
export const DARK_ENCOUNTER = 1.5;

/** The first templates: a gentle one and a deadly one, enough to exercise the engine. */
export const ENCOUNTERS: readonly EncounterTemplate[] = [
  {
    id: 'fox-at-the-treeline', kind: 'animal', weight: 3, threat: 1, tags: ['animal'], field: 'hunting',
    text: 'A fox stops at the treeline and looks straight at you, a hare hanging from its jaws.',
    freeze: { text: 'You stand rooted to the spot. The fox looks at you for a long moment, then trots off with its hare.' },
    options: [
      { id: 'back-away', label: 'Back away slowly', odds: 1, response: 'flight', success: { text: 'You back off until the trees close between you.' }, fail: { text: 'You back off until the trees close between you.' } },
      { id: 'watch', label: 'Stand still and watch', odds: 1, response: 'freeze', success: { text: 'It weighs you up, then trots off into the trees. You learn something about where the hares run.' }, fail: { text: 'It is gone before you blink.' } },
      { id: 'chase', label: 'Chase it for the hare', odds: 0.35, response: 'fight', mods: { stats: { agi: 0.04 } },
        success: { text: 'It drops the hare and bolts. Supper.', stores: { rawFood: 2 } },
        mixed: { text: 'You get close enough to scare it, and no closer.', vigor: -6 },
        fail: { text: 'You go down hard on the roots, and the fox is long gone.', condition: -6, vigor: -6 } },
      { id: 'stalk', label: 'Follow it home', requires: { skill: { id: 'hunting', level: 3 } }, odds: 0.75, careful: true, mods: { talents: { hunter: 0.15 } },
        success: { text: 'It leads you to a warren no one has touched.', stores: { rawFood: 3 }, hours: 1 },
        fail: { text: 'It doubles back and loses you in the brush.', hours: 1 } },
    ],
  },
  {
    id: 'crumbling-ledge', kind: 'find', weight: 1, rings: [2, 3], threat: 2, tags: ['heights'], field: 'scouting',
    text: 'Below a crumbling ledge, something glints — an old pack, wedged in the rocks.',
    freeze: { text: 'You stand frozen at the edge, staring down, until the fear drains out of your legs and you can step back.' },
    options: [
      { id: 'leave', label: 'Leave it', odds: 1, response: 'flight', success: { text: 'Whatever it was, it stays there.' }, fail: { text: 'Whatever it was, it stays there.' } },
      { id: 'go-around', label: 'Go the long way round to it', odds: 0.8, cost: { hours: 2 }, careful: true, mods: { skills: { scouting: 0.04 } },
        success: { text: 'An old trapper\'s pack: cord, a little salt, good leather.', stores: { materials: 3, hides: 1 } },
        fail: { text: 'There is no way down from this side. Two hours for nothing.' } },
      { id: 'climb-down', label: 'Climb straight down', odds: 0.6, response: 'fight', mods: { stats: { agi: 0.05, str: 0.02 } },
        success: { text: 'Quick and clean. An old trapper\'s pack: cord, a little salt, good leather.', stores: { materials: 3, hides: 1 } },
        mixed: { text: 'You slide the last stretch and land badly, but you have the pack.', condition: -12, stores: { materials: 3, hides: 1 } },
        fail: { text: 'The ledge gives way.', condition: -60, killedBy: 'a fall from a crumbling ledge' } },
    ],
  },
  // ── Animals (#1344) ──────────────────────────────────────────────────────
  // Animals are not evil (WORLD.md): a bear with cubs is afraid; a wolf pack in winter is hungry.
  {
    id: 'she-bear', kind: 'animal', weight: 2, rings: [2, 3], seasons: ['autumn'], threat: 3, tags: ['animal'], field: 'hunting',
    text: 'A she-bear rears up out of the berry scrub, two cubs tumbling behind her. She has seen you.',
    freeze: { text: 'You stand rooted while she huffs and slaps the ground. At last she herds the cubs away.' },
    options: [
      { id: 'back-away', label: 'Back away slowly, eyes down', odds: 0.75, response: 'flight', sureIf: { skill: { id: 'scouting', level: 2 } }, mods: { talents: { keenEye: 0.1 } },
        success: { text: 'You give her all the room she wants, and she lets you go.' },
        fail: { text: 'She bluff-charges and you go over backwards into the thorns.', wound: 10 } },
      { id: 'drop-haul', label: 'Drop what you carry and go', odds: 0.95, response: 'flight',
        success: { text: 'You let the pack fall and walk away. She tears into it instead of you.', stores: { rawFood: -3, materials: -2 } },
        fail: { text: 'She follows a few steps before she turns to the pack.', stores: { rawFood: -3, materials: -2 }, vigor: -10 } },
      { id: 'shout', label: 'Stand tall and shout', odds: 0.4, response: 'fight', mods: { stats: { str: 0.03, cha: 0.02 }, talents: { tough: 0.1 } },
        success: { text: 'You roar back at her. She weighs you a long moment, then turns away with her cubs.' },
        mixed: { text: 'She charges and stops short — close enough that you smell her.', clarity: -10 },
        fail: { text: 'She doesn\'t stop.', wound: 30, killedBy: 'a bear' } },
      { id: 'throw-food', label: 'Throw her your food', requires: { stores: { rawFood: 2 } }, cost: { stores: { rawFood: 2 } }, odds: 0.85, response: 'fawn',
        success: { text: 'She takes the food, and the cubs take her attention. You slip away.' },
        fail: { text: 'She takes the food — and still comes on, and you run.', vigor: -15 } },
      { id: 'fight', label: 'Fight her', odds: 0.15, response: 'fight', mods: { stats: { str: 0.04, con: 0.02 }, tools: { 'stone-knife': 0.15 }, talents: { tough: 0.05 } },
        success: { text: 'Somehow you drive her off, bleeding and roaring.', wound: 10, hours: 1 },
        fail: { text: 'She is far too strong.', wound: 30, killedBy: 'a bear' } },
    ],
  },
  {
    id: 'wolf-pack', kind: 'animal', weight: 2, rings: [2, 3], seasons: ['winter'], orDark: true, threat: 3, tags: ['animal'], field: 'hunting',
    text: 'Grey shapes slide between the trees, keeping pace with you. Wolves — four, five — hungry and patient.',
    freeze: { text: 'You stand still. They circle, closer, closer, and one snaps at your leg before something else takes their noses away.', wound: 15, killedBy: 'wolves' },
    options: [
      { id: 'fire', label: 'Build a fire and wait them out', requires: { stores: { firewood: 2 } }, cost: { stores: { firewood: 2 }, hours: 3 }, odds: 1, careful: true, response: 'freeze',
        success: { text: 'The fire holds them at the edge of the light until they lose interest.' },
        fail: { text: 'The fire holds them at the edge of the light until they lose interest.' } },
      { id: 'climb', label: 'Climb a tree', odds: 0.55, response: 'flight', mods: { stats: { agi: 0.05 } },
        success: { text: 'You haul yourself up. They wait below for an hour, then drift away.', hours: 2 },
        fail: { text: 'The branch breaks.', wound: 20, killedBy: 'wolves' } },
      { id: 'fight', label: 'Fight', odds: 0.25, response: 'fight', mods: { stats: { str: 0.03, con: 0.03 }, tools: { 'stone-knife': 0.15 }, talents: { tough: 0.05 } },
        success: { text: 'You hurt the first one badly enough that the pack thinks again.', wound: 10 },
        fail: { text: 'They pull you down.', wound: 40, killedBy: 'wolves' } },
      { id: 'retreat', label: 'Back off in step — never run', odds: 0.5, careful: true, response: 'flight', mods: { skills: { scouting: 0.06 }, talents: { keenEye: 0.1 } },
        success: { text: 'Step by step, facing them, you reach open ground. They let you go.', hours: 1 },
        mixed: { text: 'One darts in and opens your calf before they let you go.', wound: 10 },
        fail: { text: 'Your nerve breaks and you run. They come.', wound: 30, killedBy: 'wolves' } },
    ],
  },
  {
    id: 'rutting-elk', kind: 'animal', weight: 2, rings: [2, 3], seasons: ['autumn'], threat: 2, tags: ['animal'], field: 'hunting',
    text: 'A bull elk in rut steps out ahead, antlers lowered, breath steaming. He wants you gone.',
    freeze: { text: 'You freeze. He paws the ground, bellows, and crashes off after a rival.' },
    options: [
      { id: 'give-way', label: 'Give way', odds: 1, response: 'flight', cost: { hours: 1 },
        success: { text: 'You take the long way round.' }, fail: { text: 'You take the long way round.' } },
      { id: 'hide', label: 'Get the trees between you', odds: 0.8, response: 'freeze', mods: { talents: { keenEye: 0.1 } },
        success: { text: 'Trunks between you, he loses interest.' },
        fail: { text: 'He comes round the trees after you.', wound: 10 } },
      { id: 'charge-past', label: 'Dash past him', odds: 0.45, response: 'fight', mods: { stats: { agi: 0.05 } },
        success: { text: 'You are past before he turns.' },
        fail: { text: 'He catches you with an antler tine.', wound: 20 } },
    ],
  },
  {
    id: 'wild-boar', kind: 'animal', weight: 2, rings: [1, 2], threat: 2, tags: ['animal'], field: 'hunting',
    text: 'A boar bursts from the undergrowth, tusks low, and stops ten paces off — bristling, deciding.',
    freeze: { text: 'You keep perfectly still. He snorts, and trots off grumbling.' },
    options: [
      { id: 'climb', label: 'Climb out of reach', odds: 0.7, response: 'flight', mods: { stats: { agi: 0.04 } },
        success: { text: 'Up on a stump, you wait him out.', hours: 1 },
        fail: { text: 'He catches your calf as you scramble.', wound: 15 } },
      { id: 'stand-still', label: 'Stand still', odds: 0.6, careful: true, response: 'freeze',
        success: { text: 'He decides you are not worth it.' },
        fail: { text: 'He decides you are.', wound: 15 } },
      { id: 'fight', label: 'Fight him', odds: 0.3, response: 'fight', mods: { stats: { str: 0.03 }, skills: { hunting: 0.04 }, tools: { 'stone-knife': 0.2 } },
        success: { text: 'You bring him down. Meat for days, and a good hide.', stores: { rawFood: 4, hides: 1 }, wound: 5 },
        fail: { text: 'His tusks open your leg.', wound: 25, killedBy: 'a boar' } },
    ],
  },
  {
    id: 'lynx-kill', kind: 'animal', weight: 1, rings: [3], threat: 2, tags: ['animal'], field: 'hunting',
    text: 'A lynx crouches over a fresh hare, ear-tufts flat, staring at you over its kill.',
    freeze: { text: 'You stand still. The lynx drags its kill into the brush.' },
    options: [
      { id: 'leave', label: 'Leave it be', odds: 1, response: 'flight', success: { text: 'You go round.' }, fail: { text: 'You go round.' } },
      { id: 'take-kill', label: 'Drive it off and take the kill', odds: 0.45, response: 'fight', mods: { stats: { str: 0.03 }, talents: { hunter: 0.15 } },
        success: { text: 'It slinks off. The hare is yours.', stores: { rawFood: 2 } },
        fail: { text: 'It does not give up its dinner.', wound: 12 } },
      { id: 'watch', label: 'Watch it from a distance', odds: 1, careful: true, response: 'freeze',
        success: { text: 'You watch how it eats, and how it listens while it eats. You learn something about patience.', practice: { skill: 'hunting', hours: 2 }, hours: 1 },
        fail: { text: 'It slips away before you learn much.' } },
    ],
  },
  {
    id: 'wounded-deer', kind: 'animal', weight: 2, rings: [1, 2], threat: 1, tags: ['animal'], field: 'hunting',
    text: 'A deer stumbles out of the trees, a broken leg dragging. It will not last the night.',
    freeze: { text: 'You stand there until it limps out of sight.' },
    options: [
      { id: 'put-down', label: 'Put it out of its pain', requires: { tool: 'stone-knife' }, odds: 1, response: 'fight',
        success: { text: 'Quick and clean. It will feed you, and its hide will keep you warm.', stores: { rawFood: 3, hides: 1 }, talentStores: { hunter: { rawFood: 1 } }, hours: 1 },
        fail: { text: 'Quick and clean.' } },
      { id: 'leave', label: 'Leave it', odds: 1, response: 'flight', success: { text: 'You leave it to the wolves.' }, fail: { text: 'You leave it to the wolves.' } },
    ],
  },
  {
    id: 'circling-ravens', kind: 'animal', weight: 2, rings: [2], threat: 1, tags: ['animal'], field: 'scouting',
    text: 'Ravens circle low over the next rise, calling to each other.',
    freeze: { text: 'You watch them a long while. They settle somewhere out of sight.' },
    options: [
      { id: 'follow', label: 'Follow them', odds: 0.6, careful: true, mods: { skills: { scouting: 0.04 }, talents: { keenEye: 0.1 } },
        success: { text: 'They lead you to a carcass, barely touched.', stores: { rawFood: 3, hides: 1 } },
        mixed: { text: 'A lynx is already on it. You back away empty-handed.', hours: 1 },
        fail: { text: 'It is a bear\'s cache — and the bear is close.', wound: 20, killedBy: 'a bear' } },
      { id: 'ignore', label: 'Ignore them', odds: 1, response: 'flight', success: { text: 'You let the ravens keep their secret.' }, fail: { text: 'You let the ravens keep their secret.' } },
    ],
  },
  // ── People (#1346) ───────────────────────────────────────────────────────
  // The Reach isn't quite empty. Each is one of the Mistheim Peoples, met for a short dialogue.
  {
    id: 'lost-herald', kind: 'person', weight: 1, rings: [2, 3], threat: 0, tags: ['person'],
    text: 'A Viddfolk herald in a mud-spattered blue coat is turning in slow circles, singing a route-song under her breath and stopping halfway through each time. "This isn\'t the line," she says. "The ley-line went east of here. Didn\'t it?"',
    freeze: { text: 'You stand there saying nothing until she shrugs and wanders off, still singing.' },
    options: [
      { id: 'directions', label: 'Put her right', odds: 0.5, careful: true, mods: { skills: { scouting: 0.08 } }, sureIf: { skill: { id: 'scouting', level: 3 } },
        success: { text: '"East of the second ridge, then follow the water." Her face clears. "I owe you. I\'ll tell the caravan someone\'s up here — they may come a day early for it."', deed: 'herald-owes-you', next: 'news' },
        fail: { text: 'You point her the way you think is right. She looks doubtful, thanks you, and goes — the wrong way, probably.' } },
      { id: 'water', label: 'Share your water', requires: { stores: { water: 1 } }, cost: { stores: { water: 1 } }, odds: 1, response: 'fawn',
        success: { text: 'She drinks, and sings you the verse she remembers, the one about the Reach in spring.', clarity: 5, next: 'news' },
        fail: { text: 'She drinks, and thanks you.' } },
      { id: 'ignore', label: 'Leave her to it', odds: 1, response: 'flight', success: { text: 'You leave her to her song.' }, fail: { text: 'You leave her to her song.' } },
    ],
    steps: {
      news: {
        text: '"Ask me something, then," the herald says. "Heralds carry news. It\'s the only thing we carry."',
        options: [
          { id: 'ask-road', label: 'Ask about the road out', odds: 1, success: { text: '"The pass is open by the thaw most years. Hollowford first — the ford floods by late spring, so the caravan doesn\'t wait."' }, fail: { text: '"The road? Still there."' } },
          { id: 'ask-corruption', label: 'Ask about the grey on the hills', odds: 0.6, persuasion: true, mods: { stats: { cha: 0.04 } },
            success: { text: '"It isn\'t evil," she says, quietly. "It makes things more of what they already are. Remember that when something out here looks at you wrong."', insight: { concept: 'sealing', amount: 2 } },
            fail: { text: 'She doesn\'t want to talk about that. "Not out here," she says.' } },
        ],
      },
    },
  },
  {
    id: 'goblin-delver', kind: 'person', weight: 1, rings: [3], threat: 1, tags: ['person'],
    text: 'A Goblin delver squats on a boulder with a half-drawn map across her knees, chewing a pencil. She sizes you up the way a trader sizes up a cart. "Food?" she says. "I\'ll trade you for it."',
    freeze: { text: 'You hesitate too long. She shrugs, rolls up the map, and is gone among the rocks.' },
    options: [
      { id: 'trade', label: 'Trade her 2 food for a look at the map', requires: { stores: { rawFood: 2 } }, cost: { stores: { rawFood: 2 } }, odds: 1,
        success: { text: 'She lets you copy the ground she\'s walked: the gullies, the old cuts, where the stone is good.', survey: 3 }, fail: { text: 'She lets you copy the map.', survey: 3 } },
      { id: 'haggle', label: 'Drive a hard bargain', requires: { stat: { id: 'cha', min: 13 } }, cost: { stores: { rawFood: 1 } }, odds: 0.75, persuasion: true, mods: { stats: { cha: 0.03 } },
        success: { text: 'She laughs and gives in: one food for the whole map. "You\'d do well in the bazaar."', survey: 3 },
        fail: { text: 'She takes the food and shows you half of it. "That\'s what one food buys."', survey: 2 } },
      { id: 'compact', label: 'Ask her about the Compact', odds: 0.6, persuasion: true, mods: { stats: { cha: 0.04 } },
        success: { text: '"Old seals in the ruins are giving way where the Myst runs thin," she says. "The Compact is busier than it has been in a hundred years. Don\'t poke anything that hums."', insight: { concept: 'sealing', amount: 2 } },
        fail: { text: '"That\'s Compact business," she says, and goes back to her map.' } },
      { id: 'refuse', label: 'Keep your food and move on', odds: 1, response: 'flight', success: { text: 'You move on.' }, fail: { text: 'You move on.' } },
    ],
  },
  {
    id: 'pandor-scholar', kind: 'person', weight: 1, rings: [2], threat: 0, tags: ['person'],
    text: 'An old Pandor sits under a rock overhang with a lap full of bark-paper notes, absolutely unbothered by the weather. "Ah," he says, without looking up. "A visitor. Sit, if you like. I talk whether people listen or not."',
    freeze: { text: 'You stand awkwardly at the edge of the overhang. He talks to his notes until you leave.' },
    options: [
      { id: 'listen', label: 'Sit and listen', odds: 1, careful: true,
        success: { text: 'He talks about how a joint takes a load — the way the grain wants to run, and how to let it.', insight: { concept: 'joinery', amount: 3 }, hours: 1, next: 'teach' },
        fail: { text: 'He talks. You listen.' } },
      { id: 'firewood', label: 'Bring him firewood for his fire', requires: { stores: { firewood: 2 } }, cost: { stores: { firewood: 2 } }, odds: 1,
        success: { text: 'He nods at the wood as if it were an argument well made, and presses a packet of smoked fish on you. "For later. You\'ll need it more than I will."', stores: { rations: 2 }, deed: 'warmed-the-scholar' },
        fail: { text: 'He nods at the wood.' } },
      { id: 'leave', label: 'Leave him to his notes', odds: 1, response: 'flight', success: { text: 'You leave him talking.' }, fail: { text: 'You leave him talking.' } },
    ],
    steps: {
      teach: {
        text: '"You listen well," the scholar says, finally looking at you. "Rare. Do you want to learn something properly, or shall I go on rambling?"',
        options: [
          { id: 'learn', label: 'Ask him to teach you properly', odds: 0.7, careful: true, mods: { stats: { int: 0.04 } },
            success: { text: 'He makes you do it with your hands, twice, then a third time. It sticks.', insight: { concept: 'joinery', amount: 5 }, hours: 2 },
            fail: { text: 'It goes over your head. He doesn\'t seem to mind.', insight: { concept: 'joinery', amount: 1 }, hours: 2 } },
          { id: 'thank', label: 'Thank him and go', odds: 1, success: { text: '"Come back if you have questions," he says. "I will still be here. I am always still here."' }, fail: { text: 'He waves you off.' } },
        ],
      },
    },
  },
  {
    id: 'desperate-stranger', kind: 'person', weight: 1, rings: [1, 2], threat: 1, tags: ['person'],
    text: 'A gaunt Markfolk man steps out onto the path ahead, hands open, eyes on your pack. "Please," he says. "I haven\'t eaten in four days."',
    freeze: { text: 'You stand frozen. He looks at you a long moment, then turns and stumbles away into the trees.' },
    options: [
      { id: 'share', label: 'Share your food', requires: { stores: { rawFood: 2 } }, cost: { stores: { rawFood: 2 } }, odds: 1, response: 'fawn',
        success: { text: 'He eats like a man who had stopped hoping. "I won\'t forget this," he says. You suspect he means it.', deed: 'fed-the-stranger' },
        fail: { text: 'He eats.' } },
      { id: 'turn-away', label: 'Turn him away', odds: 0.6, persuasion: true, mods: { stats: { cha: 0.03, str: 0.02 } },
        success: { text: 'He looks at you, then at the knife at your belt, and goes.' },
        fail: { text: 'He doesn\'t go. His hand goes to his belt.', next: 'robbery' } },
    ],
    steps: {
      robbery: {
        text: '"Then give me the pack," he says. He has a stone blade, and nothing left to lose.',
        options: [
          { id: 'fight', label: 'Fight him off', odds: 0.5, response: 'fight', mods: { stats: { str: 0.04, agi: 0.02 }, tools: { 'stone-knife': 0.15 }, talents: { tough: 0.05 } },
            success: { text: 'You knock him down. He scrambles up and runs.', wound: 5 },
            fail: { text: 'He is faster than he looks. He takes the pack and leaves you bleeding in the mud.', stores: { rawFood: -99, rations: -99, materials: -3 }, wound: 20, killedBy: 'a desperate stranger' } },
          { id: 'give-in', label: 'Give him what he wants', odds: 1, response: 'fawn',
            success: { text: 'You hand over the food. He takes it and runs, without a word.', stores: { rawFood: -99 } },
            fail: { text: 'You hand over the food.', stores: { rawFood: -99 } } },
          { id: 'talk-down', label: 'Talk him down', odds: 0.35, persuasion: true, careful: true, mods: { stats: { cha: 0.05 } },
            success: { text: 'You talk about the caravan that comes at the thaw, and the work there will be. Slowly the blade comes down. He goes — empty-handed, but going.' },
            fail: { text: 'He isn\'t listening any more. He grabs the pack and runs.', stores: { rawFood: -99 } } },
        ],
      },
    },
  },
  {
    id: 'hollowford-hunter', kind: 'person', weight: 1, rings: [1, 2], seasons: ['autumn'], threat: 0, tags: ['person'],
    text: 'A Bergfolk hunter from Hollowford is gutting a hare by the stream. She lifts a bloody hand in greeting. "Didn\'t think anyone wintered up here any more."',
    freeze: { text: 'You stand there. She shrugs and goes back to her hare.' },
    options: [
      { id: 'tips', label: 'Swap hunting tips', odds: 1, careful: true,
        success: { text: 'She shows you how to read a run by the bent grass, and where the hares lie up in a frost.', practice: { skill: 'hunting', hours: 3 }, hours: 1 },
        fail: { text: 'You talk hunting.' } },
      { id: 'trade-hides', label: 'Trade a hide for meat', requires: { stores: { hides: 1 } }, cost: { stores: { hides: 1 } }, odds: 1,
        success: { text: 'A good hide for good meat. Fair.', stores: { rawFood: 4 } }, fail: { text: 'A fair trade.', stores: { rawFood: 4 } } },
      { id: 'news', label: 'Ask how the road is', odds: 1,
        success: { text: '"Pass should be clear early this year, the way the snow\'s lying. The caravan won\'t dawdle."', deed: 'heard-road-early' }, fail: { text: '"Same as ever."' } },
    ],
  },
  // ── Finds (#1345) ────────────────────────────────────────────────────────
  // Things found while working: some useful, some a trap, some a story.
  {
    id: 'abandoned-camp', kind: 'find', weight: 2, threat: 0, tags: ['find'], field: 'scouting',
    text: 'A ring of blackened stones, a lean-to fallen in on itself, a scatter of gear half under the leaves. Whoever camped here left in a hurry, or didn\'t leave.',
    freeze: { text: 'Something about the place stops you. You stand at its edge a long while, then go on.' },
    options: [
      { id: 'search', label: 'Search it', cost: { hours: 2 }, odds: 0.5, careful: true, mods: { stats: { int: 0.03 }, skills: { scouting: 0.03 }, talents: { keenEye: 0.2 } },
        success: { text: 'Under the lean-to: cord, pegs, a roll of good leather — and an old knife, notched but whole.', stores: { materials: 3 }, tool: { item: 'stone-knife', grade: 'crude' } },
        mixed: { text: 'Cord and pegs, still good. Someone took the rest.', stores: { materials: 2 } },
        fail: { text: 'Picked over long ago. A little cord is all.', stores: { materials: 1 } } },
      { id: 'leave', label: 'Leave it', odds: 1, response: 'flight', success: { text: 'You leave it to whoever left it.' }, fail: { text: 'You leave it to whoever left it.' } },
    ],
  },
  {
    id: 'buried-pack', kind: 'find', weight: 2, seasons: ['winter'], threat: 1, tags: ['dead'], field: 'scouting',
    text: 'A strap sticks up out of the snow. You tug it: a pack, frozen stiff, half-buried in a drift.',
    freeze: { text: 'You stand over the strap, not wanting to know what is under the snow. In the end you go on.' },
    options: [
      { id: 'open', label: 'Dig it out and open it', cost: { hours: 1 }, odds: 0.4, mods: { stats: { int: 0.02 }, talents: { keenEye: 0.1 } },
        success: { text: 'Wrapped in oilcloth at the bottom of the pack: a book of notes, the ink still good.', manual: true },
        mixed: { text: 'Hard bread and dried meat, frozen through but good.', stores: { rations: 3 } },
        fail: { text: 'The pack is still on its owner. A trapper, by the gear, curled up against the cold. Scratched on a strip of bark in his hand: "Waited for the caravan. Should have gone down to meet it."', clarity: -8 } },
      { id: 'leave', label: 'Leave it', odds: 1, response: 'flight', success: { text: 'You leave the snow to keep it.' }, fail: { text: 'You leave the snow to keep it.' } },
    ],
  },
  {
    id: 'old-snare-line', kind: 'find', weight: 2, rings: [1, 2], threat: 0, tags: ['find'], field: 'hunting',
    text: 'A line of old snares runs along a hare run, the cord greyed with weather. No one has checked them in a long time.',
    freeze: { text: 'You stand looking at the snares, then move on.' },
    options: [
      { id: 'take', label: 'Take the snares', odds: 1, cost: { hours: 1 },
        success: { text: 'The cord is weak but the loops are well made. They\'ll do.', tool: { item: 'trap-snare', grade: 'crude' } },
        fail: { text: 'The cord is weak but the loops are well made.', tool: { item: 'trap-snare', grade: 'crude' } } },
      { id: 'reset', label: 'Reset the line', odds: 1, cost: { hours: 1 }, careful: true,
        success: { text: 'You reset each loop the way its maker set it, and learn something from how they sat.', practice: { skill: 'hunting', hours: 2 }, overnight: { stores: { rawFood: 2 }, text: 'The old snare line you reset caught two hares in the night — 2 raw food.' } },
        fail: { text: 'You reset the loops.', practice: { skill: 'hunting', hours: 2 } } },
      { id: 'leave', label: 'Leave it', odds: 1, response: 'flight', success: { text: 'You leave the line to rot.' }, fail: { text: 'You leave the line to rot.' } },
    ],
  },
  {
    id: 'standing-stone', kind: 'find', weight: 1, rings: [2, 3], threat: 1, tags: ['uncanny'], field: 'scouting',
    text: 'A standing stone, cracked down the middle, cut with runes no one has read in a long time. Up close it hums, just at the edge of hearing.',
    freeze: { text: 'You stand before it, unable to look away, until the hum fades and you find yourself an hour later.' },
    options: [
      { id: 'study', label: 'Study the runes', cost: { hours: 2 }, odds: 0.7, careful: true, mods: { stats: { int: 0.05 } },
        success: { text: 'A binding, you think — something meant to hold a thing shut. The shape of it stays with you.', clarity: -10, insight: { concept: 'sealing', amount: 3 } },
        fail: { text: 'The runes swim. You get a headache and very little else.', clarity: -10, insight: { concept: 'sealing', amount: 1 } } },
      { id: 'touch', label: 'Lay a hand on it', odds: 0.45, response: 'fight', mods: { stats: { wil: 0.04 }, lowClarity: { below: 30, add: -0.3 } },
        success: { text: 'For a moment you understand it entirely: a seal, and what it seals. Then it is gone, and only the shape remains.', insight: { concept: 'sealing', amount: 5 } },
        fail: { text: 'The hum goes through your hand and into your head like a nail. You come to on the ground, shaking.', clarity: -30, hours: 1 } },
      { id: 'leave', label: 'Leave it be', odds: 1, response: 'flight', success: { text: 'You leave it humming.' }, fail: { text: 'You leave it humming.' } },
    ],
  },
  {
    id: 'glinting-sinkhole', kind: 'find', weight: 1, rings: [2, 3], threat: 2, tags: ['heights'], field: 'scouting',
    text: 'The ground has fallen in: a sinkhole, two men deep, and at the bottom, among the roots, something glints.',
    freeze: { text: 'You stand at the lip, staring down, until the edge crumbles under your boot and you jump back.' },
    options: [
      { id: 'climb-down', label: 'Climb down', odds: 0.5, response: 'fight', mods: { stats: { agi: 0.05 } },
        success: { text: 'Down and back up with dirt to the elbows — and a knife of old, fine work, its edge still keen.', tool: { item: 'stone-knife', grade: 'fine' }, hours: 1 },
        fail: { text: 'The side gives way and you go down with it.', wound: 25, killedBy: 'a fall into a sinkhole', hours: 1 } },
      { id: 'rope', label: 'Lower a rope and climb down on it', requires: { stores: { materials: 2 } }, cost: { hours: 2 }, odds: 0.9, careful: true, mods: { stats: { agi: 0.02 } },
        success: { text: 'You twist cord into a rope, tie off on a root and go down hand over hand. A knife of old, fine work, its edge still keen.', tool: { item: 'stone-knife', grade: 'fine' } },
        fail: { text: 'The root tears out halfway down. You land hard, but you land.', wound: 8 } },
      { id: 'leave', label: 'Leave it', odds: 1, response: 'flight', success: { text: 'Whatever it is, it stays down there.' }, fail: { text: 'Whatever it is, it stays down there.' } },
    ],
  },
  {
    id: 'corrupted-ground', kind: 'find', weight: 1, rings: [3], threat: 2, tags: ['corruption'], field: 'scouting',
    text: 'The ground ahead has gone grey-violet and glassy, stone and water alike. Nothing grows on it, and the stream that crosses it runs too still.',
    freeze: { text: 'You stand at its edge, the hairs on your arms up, until you can make yourself turn back.', hours: 1 },
    options: [
      { id: 'go-around', label: 'Go around', odds: 1, response: 'flight', cost: { hours: 1 },
        success: { text: 'You go the long way, keeping it in sight.' }, fail: { text: 'You go the long way, keeping it in sight.' } },
      { id: 'cross', label: 'Cross it quickly', odds: 0.6, response: 'fight', mods: { stats: { agi: 0.03, con: 0.03 } },
        success: { text: 'Quick, light steps. The ground rings under your feet, and lets you go.' },
        fail: { text: 'Halfway over, the stone cuts through your boot. The wound burns cold and won\'t close clean.', wound: 15, killedBy: 'corrupted ground' } },
      { id: 'sample', label: 'Take a sample', cost: { hours: 1 }, odds: 0.7, careful: true, mods: { stats: { int: 0.03 } },
        success: { text: 'You chip a flake of it off into a fold of hide. It is warm. It is more stone than stone should be — more of what it was, as the herald said.', insight: { concept: 'sealing', amount: 2 } },
        fail: { text: 'It flakes into your hand and burns. You drop it, and the burn doesn\'t fade until evening.', condition: -5, clarity: -10 } },
    ],
  },
  // ── Places (#1378) ───────────────────────────────────────────────────────
  // Places worth remembering. Nothing here is dangerous: the question is only whether to hold on to it.
  {
    id: 'sheltered-hollow', kind: 'place', weight: 1, rings: [1, 2], threat: 0, tags: ['place'], field: 'scouting',
    text: 'A hollow under a rock shoulder, out of the wind, with dry ground and a spring nearby. This would be a fine place for a shelter.',
    freeze: { text: 'You stand looking at the hollow a while, then go on.' },
    options: [
      { id: 'remember', label: 'Try to remember it', odds: 1, remembers: true,
        success: { text: 'You fix it in your mind: the shoulder of rock, the spring, the way the wind goes over.', pin: { kind: 'shelter' }, practice: { skill: 'memory', hours: 1 } },
        fail: { text: 'You fix it in your mind.', pin: { kind: 'shelter' }, practice: { skill: 'memory', hours: 1 } } },
      { id: 'look', label: 'Look it over', odds: 1, cost: { hours: 1 },
        success: { text: 'You walk the ground: where the water drains, where the snow would drift.', practice: { skill: 'scouting', hours: 1 } }, fail: { text: 'You walk the ground.' } },
      { id: 'move-on', label: 'Move on', odds: 1, success: { text: 'You move on.' }, fail: { text: 'You move on.' } },
    ],
  },
  {
    id: 'deep-pool', kind: 'place', weight: 1, threat: 0, tags: ['place'], field: 'fieldcraft',
    text: 'Below a bend in the stream, a deep, dark pool. Fish hang in it, nose to the current, hardly moving. A good fishing spot.',
    freeze: { text: 'You watch the fish a while, then go on.' },
    options: [
      { id: 'remember', label: 'Try to remember it', odds: 1, remembers: true,
        success: { text: 'You mark it in your mind: the bend, the alder leaning over, the dark water.', pin: { kind: 'fishing' }, practice: { skill: 'memory', hours: 1 } },
        fail: { text: 'You mark it in your mind.', pin: { kind: 'fishing' }, practice: { skill: 'memory', hours: 1 } } },
      { id: 'look', label: 'Watch the fish', odds: 1, cost: { hours: 1 },
        success: { text: 'You watch where they lie and when they rise.', practice: { skill: 'fieldcraft', hours: 1 } }, fail: { text: 'You watch them.' } },
      { id: 'move-on', label: 'Move on', odds: 1, success: { text: 'You move on.' }, fail: { text: 'You move on.' } },
    ],
  },
  {
    id: 'berry-thicket', kind: 'place', weight: 1, rings: [1, 2], seasons: ['autumn'], threat: 0, tags: ['place'], field: 'foraging',
    text: 'A thicket heavy with late berries, untouched — the birds haven\'t found it yet.',
    freeze: { text: 'You stand at the edge of the thicket, then go on.' },
    options: [
      { id: 'remember', label: 'Try to remember it', odds: 1, remembers: true,
        success: { text: 'You note the way here: past the split birch, down to the wet ground.', pin: { kind: 'forage' }, practice: { skill: 'memory', hours: 1 } },
        fail: { text: 'You note the way here.', pin: { kind: 'forage' }, practice: { skill: 'memory', hours: 1 } } },
      { id: 'look', label: 'Pick what you can carry', odds: 1, cost: { hours: 1 },
        success: { text: 'You eat a handful and fill a fold of your coat.', stores: { rawFood: 2 } }, fail: { text: 'You pick some.', stores: { rawFood: 2 } } },
      { id: 'move-on', label: 'Move on', odds: 1, success: { text: 'You move on.' }, fail: { text: 'You move on.' } },
    ],
  },
  {
    id: 'stone-outcrop', kind: 'place', weight: 1, rings: [2, 3], threat: 0, tags: ['place'], field: 'stonework',
    text: 'An outcrop of good grey stone, split into slabs by the frost and lying ready to hand.',
    freeze: { text: 'You look at the stone a while, then go on.' },
    options: [
      { id: 'remember', label: 'Try to remember it', odds: 1, remembers: true,
        success: { text: 'You fix it in your mind: the grey slabs, the ridge behind.', pin: { kind: 'stone' }, practice: { skill: 'memory', hours: 1 } },
        fail: { text: 'You fix it in your mind.', pin: { kind: 'stone' }, practice: { skill: 'memory', hours: 1 } } },
      { id: 'look', label: 'Knock off a slab', odds: 1, cost: { hours: 1 },
        success: { text: 'It comes away clean along the frost line.', stores: { stone: 1 } }, fail: { text: 'It comes away.', stores: { stone: 1 } } },
      { id: 'move-on', label: 'Move on', odds: 1, success: { text: 'You move on.' }, fail: { text: 'You move on.' } },
    ],
  },
  {
    id: 'strange-carving', kind: 'place', weight: 1, rings: [2, 3], threat: 0, tags: ['place'], field: 'scouting',
    text: 'Cut into a boulder, half under moss: a carving — a figure with too many hands, holding something shut. It is very old.',
    freeze: { text: 'You stand before the carving a long while, then go on.' },
    options: [
      // How it strikes you is a seeded roll: some see wonder in it, some something wrong.
      { id: 'remember', label: 'Try to remember it', odds: 0.5, remembers: true, mods: { stats: { wil: 0.03 } },
        success: { text: 'You fix it in your mind. Whoever made it made it with care; you go on feeling small, and glad of it.', pin: { kind: 'wonder', feeling: 'awed' }, practice: { skill: 'memory', hours: 1 } },
        fail: { text: 'You fix it in your mind, though you would rather not. Those hands stay with you all day.', pin: { kind: 'wonder', feeling: 'eerie' }, practice: { skill: 'memory', hours: 1 } } },
      { id: 'look', label: 'Look closer', odds: 1, cost: { hours: 1 }, careful: true,
        success: { text: 'Under the moss, the thing it holds shut is ringed with the same runes as the standing stones.', insight: { concept: 'sealing', amount: 2 } }, fail: { text: 'You look closer.' } },
      { id: 'move-on', label: 'Move on', odds: 1, success: { text: 'You move on.' }, fail: { text: 'You move on.' } },
    ],
  },
  {
    id: 'sunlit-glade', kind: 'place', weight: 1, rings: [1, 2], dark: false, threat: 0, tags: ['place'], field: 'scouting',
    text: 'A glade where the sun comes down through the birches and the wind doesn\'t reach. It is very quiet.',
    freeze: { text: 'You stand in the light a while, then go on.' },
    options: [
      { id: 'remember', label: 'Try to remember it', odds: 1, remembers: true,
        success: { text: 'You keep it: the light, the quiet. Somewhere to come back to.', pin: { kind: 'peaceful', feeling: 'peaceful' }, practice: { skill: 'memory', hours: 1 } },
        fail: { text: 'You keep it.', pin: { kind: 'peaceful', feeling: 'peaceful' }, practice: { skill: 'memory', hours: 1 } } },
      { id: 'look', label: 'Sit a while', odds: 1, cost: { hours: 1 },
        success: { text: 'You sit with your back to a birch and let your mind go quiet.', clarity: 8 }, fail: { text: 'You sit a while.', clarity: 8 } },
      { id: 'move-on', label: 'Move on', odds: 1, success: { text: 'You move on.' }, fail: { text: 'You move on.' } },
    ],
  },
  // ── The road (#1349) ─────────────────────────────────────────────────────
  // Met from the wagon or in a village, at most one a day; the road's currencies are marks and trust.
  {
    id: 'broken-axle', kind: 'find', road: 'wagon', weight: 2, threat: 0, tags: ['road'], field: 'handcraft',
    text: 'A crack like a branch breaking, and the second wagon lurches and stops dead. The rear axle has split. Pim is already under it, swearing at it lovingly.',
    freeze: { text: 'You stand by while the others work. It takes them all afternoon.', hours: 1 },
    options: [
      { id: 'help-fix', label: 'Get under it and help Pim', cost: { hours: 3 }, odds: 0.6, mods: { skills: { handcraft: 0.05, woodcraft: 0.04 }, stats: { str: 0.02 } },
        success: { text: 'Between you, you splint it with green ash and wire. Pim slaps the axle and then you. "It\'ll hold to Mistheim. You can come under my wagon any time."', trust: { 'cv-pim': 8, 'cv-bodil': 4 }, practice: { skill: 'handcraft', hours: 2 } },
        fail: { text: 'You hold the wrong end at the wrong moment, and the splint slips twice. Pim gets it done in the end, with a look.', vigor: -10, practice: { skill: 'handcraft', hours: 1 } } },
      { id: 'hands', label: 'Fetch, carry and hold the lantern', cost: { hours: 2 }, odds: 1,
        success: { text: 'Not glamorous, but somebody has to hold the lantern. Bodil notices who does.', trust: { 'cv-bodil': 3 } },
        fail: { text: 'You hold the lantern.' } },
      { id: 'leave', label: 'Leave it to them', odds: 1, response: 'flight',
        success: { text: 'You stay on your wagon. Bodil glances up at you once, and goes back to work.', trust: { 'cv-bodil': -3 } },
        fail: { text: 'You stay on your wagon.' } },
    ],
  },
  {
    id: 'bandits-at-ford', kind: 'person', road: 'wagon', weight: 1, threat: 3, tags: ['person'],
    text: 'At the ford, four riders sit their horses in the shallows, blocking the far bank. Their leader has a crossbow across her saddle. "Toll," she calls. "Or we take it out of the wagons."',
    freeze: { text: 'You freeze on the wagon bench. The riders take what they like from your pack while Bodil pays them off.', stores: { rawFood: -99, rations: -99 }, marks: -99 },
    options: [
      { id: 'pay', label: 'Pay your share of the toll', requires: { marks: 5 }, cost: { marks: 5 }, odds: 1, response: 'fawn',
        success: { text: 'You count five marks into Bodil\'s hand. The riders let the caravan through, laughing. Bodil mutters that she\'ll pay you back in suppers.', trust: { 'cv-bodil': 5 } },
        fail: { text: 'You pay.' } },
      { id: 'talk', label: 'Talk them down', odds: 0.35, persuasion: true, careful: true, mods: { stats: { cha: 0.05 } },
        success: { text: 'You point out the caravan guards, the open ground, the length of a crossbow reload. The leader considers it, spits, and waves you through for half.', marks: -2, trust: { 'cv-bodil': 8 } },
        fail: { text: 'She isn\'t interested in your arithmetic. The toll doubles, and they take it from your pack.', stores: { rawFood: -99 }, marks: -99, trust: { 'cv-bodil': -3 } } },
      { id: 'hide', label: 'Hide your goods and keep your head down', odds: 0.6, careful: true, response: 'freeze', mods: { stats: { agi: 0.03 }, skills: { scouting: 0.03 } },
        success: { text: 'Your marks go in your boot, your food under the sacks. The riders search the wagon and find nothing of yours.' },
        fail: { text: 'They find it all.', stores: { rawFood: -99, rations: -99 }, marks: -99 } },
      { id: 'fight', label: 'Stand with the guards', odds: 0.35, response: 'fight', mods: { stats: { str: 0.04, con: 0.02 }, tools: { 'stone-knife': 0.15 }, talents: { tough: 0.05 } },
        success: { text: 'The guards charge the ford and you go with them. The riders break and scatter. Bodil makes sure everyone hears your name.', wound: 10, trust: { 'cv-bodil': 15 } },
        fail: { text: 'A crossbow bolt takes you in the side.', wound: 40, killedBy: 'bandits at the ford' } },
    ],
  },
  {
    id: 'stranded-traveller', kind: 'person', road: 'wagon', weight: 2, threat: 0, tags: ['person'],
    text: 'A woman sits on a trunk by the road, her mule lame beside her, waving the caravan down. "Kestrel Gate? I\'ll pay what I can."',
    freeze: { text: 'You say nothing. Bodil makes room for her anyway.' },
    options: [
      { id: 'speak-up', label: 'Ask Bodil to take her on', odds: 0.7, persuasion: true, mods: { stats: { cha: 0.04 } },
        success: { text: 'Bodil grumbles and makes room. The woman presses a few marks on you. "For speaking up. Nobody does."', marks: 3, trust: { 'cv-bodil': 2 } },
        fail: { text: 'Bodil shakes her head: no room. You watch the woman get smaller behind you.', clarity: -5 } },
      { id: 'share', label: 'Give her some of your food for the walk', requires: { stores: { rawFood: 2 } }, cost: { stores: { rawFood: 2 } }, odds: 1, response: 'fawn',
        success: { text: 'She takes it with both hands. Ottilia, watching from the next wagon, nods to you.', trust: { 'cv-ottilia': 6 } },
        fail: { text: 'She takes it.' } },
      { id: 'pass', label: 'Ride on', odds: 1, response: 'flight', success: { text: 'The caravan rolls past her.' }, fail: { text: 'The caravan rolls past her.' } },
    ],
  },
  {
    id: 'elk-at-the-river', kind: 'animal', road: 'wagon', weight: 2, threat: 1, tags: ['animal'], field: 'hunting',
    text: 'Below the road, a herd of elk is crossing the spring river, calves and all, the water silver around their legs.',
    freeze: { text: 'You watch them until the road bends away.' },
    options: [
      { id: 'watch', label: 'Watch them cross', odds: 1, success: { text: 'You watch until the last calf scrambles out. For an hour you forget how tired you are.', clarity: 8 }, fail: { text: 'You watch.' } },
      { id: 'hunt', label: 'Jump down and try for one', cost: { hours: 3 }, odds: 0.35, mods: { skills: { hunting: 0.06 }, tools: { 'stone-knife': 0.1 }, talents: { hunter: 0.15 } },
        success: { text: 'You bring a yearling down at the shallows. The cook is delighted; there is meat for everyone tonight, and you are owed a lot of suppers.', stores: { rawFood: 4 }, trust: { 'cv-bodil': 4 }, practice: { skill: 'hunting', hours: 2 } },
        fail: { text: 'They are across and gone before you are close. You run to catch up with the wagons.', vigor: -12 } },
    ],
  },
  {
    id: 'herald-on-the-road', kind: 'person', road: 'any', weight: 1, threat: 0, tags: ['person'],
    text: 'A Viddfolk herald in a blue coat falls in beside you, singing under her breath. "News for a song, or a song for news. Which will it be?"',
    freeze: { text: 'You don\'t answer. She shrugs and sings to someone else.' },
    options: [
      { id: 'news', label: 'Ask for the news', odds: 1,
        success: { text: '"Saltmere is short of salt, if you can believe it, and Kestrel Gate is paying well for good tools." You file it away.', clarity: 4 }, fail: { text: 'She tells you the news.' } },
      { id: 'sing', label: 'Trade her a story of the winter for a song', odds: 0.6, persuasion: true, mods: { stats: { cha: 0.04 } },
        success: { text: 'She makes a verse of it on the spot, and by evening half the caravan is singing about you.', trust: { 'cv-bodil': 3, 'cv-runa': 6, 'cv-pim': 3 } },
        fail: { text: 'She listens politely. "Every winter is the hardest winter," she says, and moves on.' } },
    ],
  },
  {
    id: 'pickpocket', kind: 'person', road: 'village', weight: 2, threat: 1, tags: ['person'],
    text: 'In the press of the market a boy bumps into you, says sorry, and is gone — and your purse is lighter.',
    freeze: { text: 'By the time you think to move, he\'s gone, and so are your marks.', marks: -4 },
    options: [
      { id: 'grab', label: 'Go after him', odds: 0.5, response: 'fight', mods: { stats: { agi: 0.05 } },
        success: { text: 'You catch him by the collar two stalls down. He hands the marks back, white-faced, and bolts.' },
        fail: { text: 'He\'s quicker in a crowd than you are. Gone.', marks: -4, vigor: -6 } },
      { id: 'let-go', label: 'Let him go', odds: 1, response: 'flight',
        success: { text: 'Four marks. You hope he eats tonight.', marks: -4 }, fail: { text: 'Four marks gone.', marks: -4 } },
      { id: 'warn', label: 'Raise a shout so the stallholders know', odds: 0.7, mods: { stats: { cha: 0.03 } },
        success: { text: 'A baker steps into his path; the marks come back, and the stallholders nod to you the rest of the day.' },
        fail: { text: 'Nobody looks up. The boy is gone.', marks: -4 } },
    ],
  },
];

export const encounterById = (id: string): EncounterTemplate | undefined => ENCOUNTERS.find(e => e.id === id);

/** The Warden as encounters see them. */
export interface Encounterer {
  stores: Stores;
  tools: readonly Tool[];
  skills: SkillPractice;
  character: { stats: Stats; talents: readonly Talent[]; quirks?: readonly Quirk[] };
  /** Clarity, for options a tired mind does worse at (#1345). Absent reads as clear. */
  vitals?: { clarity: { current: number } };
  /** The places you remember (#1378). */
  pins?: readonly Pin[];
  /** Marks in hand (#1349), on the road. */
  marks?: number;
  /** The encounter in front of you, with how you stand (#1360): a shaken mind makes careful options harder. */
  pending?: PendingEncounter | null;
}

/** Why you can't choose an option, or null if you can. */
export function unmet(w: Encounterer, o: EncounterOption): string | null {
  // Tunnel vision (#1361): panicked, fine judgement is gone.
  if (o.careful && w.pending?.state === 'panicked') return "you can't think straight";
  // Memory (#1378): only so many places fit.
  if (o.remembers) {
    if (w.pending && w.pins?.some(p => p.id === pinId(w.pending!.id, w.pending!.ring))) return ALREADY_PINNED;
    if ((w.pins?.length ?? 0) >= pinCapacity(w)) return FULL_MEMORY;
  }
  const r = o.requires;
  const needs: Partial<Record<keyof Stores, number>> = { ...(r?.stores ?? {}) };
  for (const [k, n] of Object.entries(o.cost?.stores ?? {})) needs[k as keyof Stores] = Math.max(needs[k as keyof Stores] ?? 0, n ?? 0);
  if (r?.skill && skillLevel(w.skills, r.skill.id) < r.skill.level) return `needs ${r.skill.id} ${r.skill.level}`;
  if (r?.talent && !w.character.talents.some(t => t.id === r.talent)) return 'needs a gift you don\'t have';
  if (r?.stat && w.character.stats[r.stat.id] < r.stat.min) return `needs ${r.stat.id.toUpperCase()} ${r.stat.min}`;
  if (r?.tool && !w.tools.some(t => t.item === r.tool)) return `needs a ${r.tool.replace(/-/g, ' ')}`;
  const marks = Math.max(r?.marks ?? 0, o.cost?.marks ?? 0);
  if (marks && (w.marks ?? 0) < marks) return `needs ${marks} marks`;
  for (const [k, n] of Object.entries(needs)) if (w.stores[k as keyof Stores] < (n ?? 0)) return `needs ${n} ${k === 'rawFood' ? 'food' : k}`;
  return null;
}

/**
 * An option's chance of success for this Warden, 0.02–0.98 (1 stays 1: a sure thing is sure).
 * Shaken or worse (#1360), a careful option loses one odds word.
 */
export function chanceOf(w: Encounterer, o: EncounterOption): number {
  if (o.odds >= 1) return 1;
  // Sure for those who meet it (#1344) — however shaken.
  if (o.sureIf && !unmet(w, { ...o, requires: o.sureIf, cost: undefined, careful: false })) return 1;
  const rattled = o.careful && (w.pending?.state === 'shaken' || w.pending?.state === 'panicked');
  const m = o.mods ?? {};
  let p = o.odds;
  // Adrenaline (#1361): shaken or panicked, the body is stronger and faster for a moment.
  // Surge (#1363) doubles it.
  const surge = w.pending?.state === 'shaken' || w.pending?.state === 'panicked' ? ADRENALINE * talentEffects(w.character.talents).adrenaline : 0;
  for (const [id, per] of Object.entries(m.stats ?? {})) p += (per ?? 0) * (w.character.stats[id as StatId] - 10 + (id === 'str' || id === 'agi' ? surge : 0));
  for (const [id, per] of Object.entries(m.skills ?? {})) p += (per ?? 0) * skillLevel(w.skills, id as SkillId);
  for (const [id, add] of Object.entries(m.talents ?? {})) if (w.character.talents.some(t => t.id === id)) p += add ?? 0;
  for (const [id, add] of Object.entries(m.tools ?? {})) if (w.tools.some(t => t.item === id)) p += add;
  if (m.lowClarity && w.vitals && w.vitals.clarity.current < m.lowClarity.below) p += m.lowClarity.add;
  // Jumpy (#1362): the startle reflex gets you away fast.
  if (o.response === 'flight' && w.character.quirks?.some(q => q.id === 'jumpy')) p += JUMPY_FLIGHT;
  p = Math.max(0.02, Math.min(0.98, p));
  // Silver Tongue (#1346): talking someone round goes one odds word better.
  if (o.persuasion && w.character.talents.some(x => x.id === 'silverTongue')) p = silverChance(p);
  return rattled ? shakenChance(p) : p;
}

/** Where each odds word starts. */
const WORD_FLOOR: Readonly<Record<OddsWord, number>> = { safe: 0.95, likely: 0.7, risky: 0.4, desperate: 0 };

/**
 * A careful option, shaken (#1360): at least SHAKEN_PENALTY worse, and always at least one odds
 * word worse — "likely" becomes "risky" — since the word is what the Warden sees.
 */
function shakenChance(p: number): number {
  const floor = WORD_FLOOR[oddsWord(p)];
  return Math.max(0.02, Math.min(p - SHAKEN_PENALTY, floor > 0 ? floor - 0.05 : p - SHAKEN_PENALTY));
}

/** Persuasion with a silver tongue (#1346): at least SHAKEN_PENALTY better, and always one odds word better ("risky" becomes "likely"). */
function silverChance(p: number): number {
  const up: Readonly<Record<OddsWord, number>> = { desperate: 0.4, risky: 0.7, likely: 0.95, safe: 0.98 };
  return Math.min(0.98, Math.max(p + SHAKEN_PENALTY, up[oddsWord(p)] + 0.02));
}

/** The odds as words. */
export function oddsWord(p: number): OddsWord {
  return p >= 0.95 ? 'safe' : p >= 0.7 ? 'likely' : p >= 0.4 ? 'risky' : 'desperate';
}

/** The options as a Warden sees them: availability, the reason if not, and the odds in words. */
export function optionsFor(w: Encounterer, t: EncounterTemplate): { option: EncounterOption; unmet: string | null; odds: OddsWord }[] {
  return stepFor(w, t).options.map(option => ({ option, unmet: unmet(w, option), odds: oddsWord(chanceOf(w, option)) }));
}

/** What an option costs, as one number for breaking ties: its hours plus the goods it uses. */
export const costOf = (o: EncounterOption): number =>
  (o.cost?.hours ?? 0) + (o.cost?.marks ?? 0) + Object.values(o.cost?.stores ?? {}).reduce<number>((n, x) => n + (x ?? 0), 0);

/**
 * The safest option you can take (#1348): the best odds, ties going to the cheapest. What a
 * careful player picks, and what the AI harness falls back on when a reply never names a valid
 * choice. Every encounter has a sure, free option, so there is always one.
 */
export function safestOption(w: Encounterer, t: EncounterTemplate): EncounterOption {
  const options = stepFor(w, t).options;
  const open = options.filter(o => !unmet(w, o));
  return open.reduce((best, o) => {
    const d = chanceOf(w, o) - chanceOf(w, best);
    return d > 0 || (d === 0 && costOf(o) < costOf(best)) ? o : best;
  }, open[0] ?? options[0]);
}

/**
 * Does an encounter happen on this trip? A seeded roll for the day and hour against the ring's
 * chance (×1.5 in the dark), then a seeded, weighted pick among the encounters that fit.
 */
export function encounterFor(seed: number, day: number, hour: number, ring: Ring, season: Season, dark: boolean): EncounterTemplate | null {
  const roll = streamFor(seed, day, `encounter@${hour}`);
  if (roll() >= ENCOUNTER_CHANCE[ring] * (dark ? DARK_ENCOUNTER : 1)) return null;
  // Road encounters (#1349) are met only on the road.
  const fits = ENCOUNTERS.filter(e => !e.road && (!e.rings || e.rings.includes(ring)) && ((!e.seasons || e.seasons.includes(season)) || (e.orDark && dark)) && (e.dark === undefined || e.dark === dark));
  const total = fits.reduce((n, e) => n + e.weight, 0);
  let pick = roll() * total;
  for (const e of fits) { pick -= e.weight; if (pick < 0) return e; }
  return null;
}

/** How a chosen option turns out: a seeded roll for this encounter, day and choice. */
export function rollOutcome(seed: number, pending: PendingEncounter, o: EncounterOption, p: number): { tier: 'success' | 'mixed' | 'fail'; effect: Effect } {
  const u = streamFor(seed, pending.day, `encounter:${pending.id}:${o.id}`)();
  if (u < p) return { tier: 'success', effect: o.success };
  if (o.mixed && u < p + (1 - p) / 2) return { tier: 'mixed', effect: o.mixed };
  return { tier: 'fail', effect: o.fail };
}
