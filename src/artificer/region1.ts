/**
 * Region 1 — Greywind Reach: the playable opening loop, headless (#1207).
 *
 * Composes the sim-core modules into the Region 1 game: you arrive with almost
 * nothing, winter is coming, and you plan each day as a queue of actions to lay
 * in a larder, winterize a shelter, stock fuel and stay sound — then live
 * through the winter on what you built, until the thaw (#1302,
 * docs/region-1-design.md).
 *
 * Same discipline as the rest of src/artificer: pure functions that return a
 * new state, deterministic (no randomness yet), no Phaser imports. A DOM
 * frontend, a test, or Core Warden can all drive it identically.
 */

import { talentEffects, talentDrain, startingTalents, startingPractice, growTalents, TIER_UP_LINE, noticeTalent, signOf, withoutHidden, hasHidden, type Difference, type GrowthEvent, type Talent, type TalentId } from './talents';
import { difficultyOf, difficultyRead } from './difficulty';
import { DEFAULT_STATS, statEffects, statDrain, withTraining, exercise, exerciseFrom, gainLine, wearDown, wearLine, WIL_EXERCISE_BELOW, STAT_IDS as GROWTH_STATS, HARD_NIGHT_EXERCISE, LONG_DAY_HOURS, WEAR_HUNGRY, WEAR_THIRSTY, WEAR_LIMIT, RECOVERY_CAP, overtrainedLine, OVERTRAINED, type Stats } from './stats';
import { FULL_WORLD, type WorldConfig } from './world';
import { accidentRisk, craftRisk, rollAccident, worstFortune, accidentLine, ACCIDENT_CONDITION, EXHAUSTED_BELOW, type Accident } from './accidents';
import { painOf, strainPain, painRiseLine, painNightLine, PAIN_DRAIN, PAIN_HOURS, PAIN_NIGHT, type Pain } from './pain';
import { startFromPack, hasKit, hasExtra, extrasOn, usedKit, kitColdCost, kitTimeMult, kitVigorMult, kitFireNeed, validPack, packWorldOf, kitOffered, hasAxeFishing, FISH_KIT_CATCH, strapsOf, packWalkMult, type KitId, type KitState } from './kit';
import { grownStats, birthdayLine, isYoung, YOUNG_PRACTICE } from './growing';
import { trainingOf, knowsTheCold, coldWise, type Background } from './scout';
import { severityOf, injure, injuryCost, nightHealing, strains, AGGRAVATE_CHANCE, HEAL_POINTS, HARM_OF, STIFF_KNEE_COST, WEAK_GRIP_GRADE, SCAR_ACHE, CUT_BLEED, INJURY_NAME, healingLine, healedLine, notHealingLine, injuryView, KNOWS, worstUntreated, treatmentFor, treatmentQuality, treatLine, festerLine, NO_TREATMENT, TREAT_BONUS, FESTER_CHANCE, FESTER_CONDITION, type Injury, type Harm } from './injuries';
import { pinId, placeName, PIN_WORDS, pinYield, pinAmbient, awedIn, shelterPin, maxInterest, SHELTER_PIN_WARMTH, type Pin, type Interest } from './pins';
import { startingQuirks, reveal, hasQuirk, fearId, isFear, QUIRKS, FEAR_OF, FEAR_FADES, STOIC_CRASH, type Quirk } from './quirks';
import { landAmbient, nightAmbient, frightOf, landReasons, nightReasons, type LandScene, type NightScene, type Threat, spookChance, DUSK_LIGHT, UNEASE_CLARITY, UNEASY_NIGHT, SLEEPLESS_NIGHT, DARK_FADES, type PanicState, type Response as PanicResponse } from './panic';
import { readThreat, responseOf, overrideChance, RESPONSE_QUIRK, SHAKEN_CLARITY, FREEZE_HOURS, CRASH_VIGOR, CRASH_CLARITY, SHAKING_GRADE, SHAKING_SLEEP, INSTINCT_LINE } from './panic';
import { clockHour, lightOver } from './clock';
import { darkYieldMult, darkWorkDrain, darkTravelDrain, tooDarkToSee, nightWork, scaleHaul, SEE_BELOW } from './darkness';
import { rawWeight, fitHaul, bestGear, leftLine, overloadRatio, overloadWalk, overloadWord, strainFrom, strainRecovery, cumbersome, maxLoad, comfortableLoad, EXHAUSTED_AT, EXHAUSTED_DRAIN, GEAR_ITEMS, type Haul, type GearItem } from './load';
import { weatherFor, weatherName, lateFrom, isBlizzard, nextSnowDepth, snowSlow, iceThick, exposureFor, EXPOSURE_COST, BLIZZARD_HOURS, DANGER_SENSE_INT, tempAt, nightTemp, isColdNight, coldNightNeeds, fireNeed, freezeLoss, meltsSnow, MELT_FIREWOOD, iceOn, FREEZING_WORK, ICE_EXTRA_HOURS, weatherHours, blindInFog, stormBars, weatherDrain, windChill, windFire, WET_HOURS, WET_CLARITY, type Forecast, type WeatherId } from './weather';
import { seedOf, streamFor } from './rng';
import { canDrawMap, mapDrawnLine, descriptiveMapOn } from './descriptive-map';
import { mapLearningOn, drawMapGate, MAP_DRAW_HOURS, LOOK_AROUND_LINE, PLACED_LINE } from './map-learning';
import { campAsActionOn, knownSpot, knownSpots, defaultSpot, siteKnowledge, ratingText, CAMP_SETUP_HOURS, type CampSpotState } from './camp-sites';
import { buildsPerSiteOn, campHere, moveNotes, buildsText, weathered, weatherSteps, pitFoodChoice, pitFoodOf, siteAtText, NOTE_TEXT, PIT_FOOD_CHOICES, PIT_FOOD_TEXT, type SiteBuild, type KeptPit, type PitFoodChoice } from './camp-builds';
import { TECHNIQUES, MANUALS, MANUAL_BY_RING, techniqueById, manualById, techniqueEffects, selfLearnHours, canBeTaught, guidanceRate, techniqueFactor, type Guidance, type Technique } from './techniques';
import { survivalLock, workEffects, focusGrade, reliability, focusLabel, focusInline, focusKey, isTopic, FOCUS_COST, CONCEPT_PER_HOUR, type Focus } from './focus';
import { topicsOpen, type Acquaintance } from './topics';
import { SKILLS, SKILL_IDS, skillFor, skillLevel, perceivedLevel, practise, drainMult, toolMult, yieldBonus, craftBonus, type SkillId, type SkillPractice } from './skills';
import { STIMULUS, applyActivity, driftCapacity, recoverCondition, createVitals, type Pool, type Vitals } from './vitality';
import { isWinterReady, evaluateMilestones, DEFAULT_THRESHOLDS, type MilestoneDef, type ReadinessInput, type ReadinessThresholds } from './readiness';
import { gradeOf, seasonOf, MIDWINTER_AFTER, DEFAULT_CALENDAR, type Calendar, type Outcome } from './winter';
import { encounterFor, encounterById, unmet, chanceOf, rollOutcome, stepOf, type PendingEncounter } from './encounters';
import { ACTION_DOMAIN, BAND_MULT, bandFor, bandLine, haulFortune, luckShifts, luckSteps, oddsWord, type Band, type Shift } from './luck';
import { createExploration, scout, survey, track, lookout, explore as exploreRing, work, regrow, level, domainsOf, scouted, reachable, landYield, supplyFactor, supplyWord, hasFind, RICHNESS, SUPPLY_DRAW, type GrowSeason, RINGS, RING_NAME, TRAVEL_HOURS, FINDS, type Domain, type Exploration, type Ring } from './exploration';
import type { Legacy } from './legacy';
import { craft, craftGrade, craftQuality, craftScore, craftBlocker, addInsight, study as studyConcept, craftWorld, createCrafter, capabilities, modifiersFor, toolInUse, damageTool, heirloomList, heirloomLesson, toolServes, bestPerItem, conceptOpen, GRADES, DEFAULT_EFFECTS, type CraftRecipe, type CraftResult, type CrafterState, type ConceptDef, type ConceptProgress, type Grade, type Tool } from './crafting';
// The full tech tree (#1469): the copy the crafting menu fetches at runtime. The root macro-world/ copy is an older, shorter one.
import conceptsRegistry from './content/concepts.json';
import { featureOn } from './features';
import { forecastsOn, noteFamiliar, craftKey, taskKey } from './forecasts';
import { cutTrips, killMoment, stopKindOf, type Cut, type DayStop } from './stop-action';
import { huntingGearOn, huntScore, huntOdds, trapFortune, huntOnFortune, CATCH_CHANCE, HUNT_UNLOCK, FISH_UNLOCK, BOW_UNLOCK, BOW_LEVEL, SLING, BOW, HOOK_LINE, SINEW_SMALL, SINEW_DEER, BOW_SINEW, NEED_SINEW, sinewNote, type HuntOdds, type HuntTool } from './hunting-gear';
import { scavengersOn, leftover, rollTheft, theftLine, nightScavengers, storedScavengers, storedTheftLine, awayScavengers, LONG_AWAY_HOURS, DAY_BASE, NIGHT_BASE, BIG_CLARITY, MEAT_PLACES, STORE_MEAT_HOURS, bankedFireOn, bankedFireDraw, bankLine, fireOutLine, burntDownLine, BANK_FIREWOOD, BANK_HOURS, BANK_WORK_HOURS, FIRE_OUT, type Guard, type MeatPlace, type PutBy } from './camp-scavengers';
import { lidOn, walledLarderOn, miceChance, rollNibble, pitScavengers, pitTheftLine, verminScavengers, pitVerminScavengers, miceLine, pitMiceLine, LID_COST, LID_HOURS, LID_LINE } from './camp-scavengers';
import { builtWarmth, builtWarmthOn, naturalRoof, siteShelterText } from './built-warmth';
import { thermalOn, thermalNight, thermalEffects, sleeperEnvironment, type ThermalNight } from './thermal';
import { ACTION_VISIBILITY, subActionLock, newlyOpen, STONE_GATHERING, QUARRY_TECHNIQUE, QUARRY_UNLOCK, STONE_GATHER_FIND_NOTE } from './action-unlocks';
import { ringWordsFor } from './distance-words';
import { wayOf, wayOptions, isHeading, headOut, lookHere, walksBackFirst, walkBackHours, walkBackLine, backAtCamp, awayFromCamp, directedOn } from './directed-explore';
import { walkTrip, walkOn, legAt, noteWalk, tripLine, endWalk, pathHome, type Trip, type TrailDay } from './walk-the-map';
import { withHeadingLock, wayLock, headingExtraHours, needleLock, needleGate, makeNeedleCompass, steerHeading, NEEDLE_HOURS, type NeedleCompass } from './compass-heading';
import { experimentStep, inputWords, EXPERIMENT_HOURS, type ExperimentTarget } from './experiment';
import { hasLength, chosenLength, planTrips, patchesOf, patchKey, abundance, patchWord, recoverPatches, ACTION_PATCHES, MAIN, HOUR_CHOICES, UNTIL_CHOICES, STEP, MIN_WORK, type LengthAction, type PatchId, type Patches, type TripPlan } from './action-length';

/** Waking hours you can queue in a day; the queue spills into the next. */
export const DAY_HOURS = 14;

// ── Sites & shelter ─────────────────────────────────────────────────────────

export type SiteId = 'cave' | 'tree' | 'river' | 'hill';

/**
 * Where you settle sets how warm a finished shelter can get — which drives
 * both winter-readiness and nightly Clarity recovery. A cold site can never
 * truly winterize, so the site choice *is* a winter choice.
 */
export const SITES: Readonly<Record<SiteId, { name: string; warmth: number }>> = {
  cave: { name: 'Cave', warmth: 0.9 },
  tree: { name: 'Treeline', warmth: 0.7 },
  river: { name: 'Riverbank', warmth: 0.4 },
  hill: { name: 'Hilltop', warmth: 0.2 },
};

/** How much of a site's warmth an unbuilt camp realises (a fire and a windbreak). */
const OPEN_CAMP_FACTOR = 0.3;
/** Materials for the default builds: a lean-to (tier 1), then timber walls (tier 2). */
export const BUILD_COST = [3, 5] as const;
export type Tier = 0 | 1 | 2;

/** The first stage of a shelter: what kind of roof you raise. */
export type ShelterType = 'leanto' | 'hut';
/** The second stage: what you winterize it with. */
export type WallMaterial = 'timber' | 'stone';
/** The design choices behind the shelter at the current site. */
export interface ShelterBuild {
  type: ShelterType | null; walls: WallMaterial | null;
  /** Built where you knew the wind doesn't reach (#1379): you held a sheltered place near camp in mind. */
  sited?: boolean;
}
/**
 * How well the shelter was built scales its warmth (capped at fully warm): a
 * crude lean-to leaks, a fine one holds heat. Keyed by the latest build's grade.
 */
export const GRADE_WARMTH: Readonly<Record<Grade, number>> = { crude: 0.85, sound: 1, fine: 1.1, masterwork: 1.2 };

// ── State ───────────────────────────────────────────────────────────────────

/** The carrying life in numbers (#1297), for the AI report and the invariants. */
export interface CarryTally { leftStones: number; overloadedHours: number; spoiled: number; heaviest: number }
const addTally = (s: Region1State, add: Partial<CarryTally>): void => {
  const t = s.tally ?? { leftStones: 0, overloadedHours: 0, spoiled: 0, heaviest: 0 };
  s.tally = { leftStones: t.leftStones + (add.leftStones ?? 0), overloadedHours: t.overloadedHours + (add.overloadedHours ?? 0), spoiled: t.spoiled + (add.spoiled ?? 0), heaviest: Math.max(t.heaviest, add.heaviest ?? 0) };
};

export interface Stores {
  rawFood: number;
  water: number;
  firewood: number;
  materials: number;
  /** Preserved food — the winter larder (not today's meals). */
  rations: number;
  /** Quarried stone — for stone-banked walls. */
  stone: number;
  /** Hides from deer hunts — for waterskins and hide parkas. */
  hides: number;
}

export interface LogEntry {
  day: number;
  text: string;
  kind: 'action' | 'skip' | 'milestone' | 'hardship' | 'outcome';
  /** For work: when it started (clock hour) and the average light it had, walk included (#1280). */
  at?: { hour: number; light: number };
}

export interface Region1Config {
  calendar: Calendar;
  thresholds: ReadinessThresholds;
  /** Which parts of the living world are on (#1279): the full world in play, the flat world for isolated tests. */
  world: WorldConfig;
  /**
   * Is planning learned (#1350)? `learned`: a fresh Warden has no queue until their first
   * level-up — the app and the AI play this way. `open` (the default): planning from day 1,
   * as tests and older saves expect.
   */
  planning?: 'learned' | 'open';
}

export interface Region1State {
  day: number;
  hoursToday: number;
  vitals: Vitals;
  stores: Stores;
  /** Road-worthy (not crude) cold gear — derived from the cold-gear tool after each craft. */
  coldGear: boolean;
  /** What you know of the land, ring by ring (src/artificer/exploration.ts). */
  explore: Exploration;
  site: SiteId | null;
  tier: Tier;
  /** Grade of the latest shelter build (null before the first). */
  shelterGrade: Grade | null;
  /** Which roof and walls were chosen (reset when you move). */
  shelter: ShelterBuild;
  /** One-way "ever did X" flags behind the first-time milestones. */
  flags: { everWater: boolean; everFood: boolean; everWood: boolean; everHunt: boolean; everPreserve: boolean; everHide: boolean };
  /** Marks and road contacts carried from an earlier road (#1250); the next road starts with them. Absent when none. */
  marks?: number;
  contacts?: string[];
  /** Recipe ids you know how to make (the rest are discovered — see DISCOVERIES). */
  known: string[];
  /** Study sessions per concept today (diminishing returns; reset each night). */
  studiedToday: Record<string, number>;
  milestones: string[];
  /**
   * Can the Warden plan ahead (#1350)? A fresh Warden can't: one thing at a time, until the
   * first time a skill's true level rises and they catch themselves thinking a step ahead.
   */
  canPlan: boolean;
  /** An encounter waiting for your choice (#1343): the day is paused until you make it. */
  pending?: PendingEncounter | null;
  /** The last day an encounter happened — at most one a day. */
  encounterDay?: number;
  /** Encounters met and survived, by template id (#1360): the more often, the smaller they look. Carries across runs. */
  met?: Record<string, number>;
  /** The day you settled the current camp (#1367): a camp lived in long enough feels like home at night. */
  siteDay?: number;
  /** Things you did that the world may remember (#1346): fed a starving stranger, put a lost herald right. */
  deeds?: string[];
  /** What comes in overnight (#1345): a snare line you reset. Paid out, and cleared, at the day's end. */
  /** Open injuries (#1286, #1392): a sprain, a hurt hand, a deep cut — each with its severity and the healing it still needs. */
  injuries?: Injury[];
  /** First-aid kit dressings left (#1393): from the hike pack (#1400). Each treats any injury, one step better. */
  dressings?: number;
  /** The hike kit (#1400): what was packed, and the supplies that run out. Absent: no pack (tests, old saves). */
  kit?: KitState;
  /** Places you remember (#1378). They belong to this run: a new run starts with none. */
  pins?: Pin[];
  overnight?: { stores: Partial<Record<keyof Stores, number>>; text: string }[];
  /** Trap lines set today (#1821, `hunting-gear`), by distance: checked by morning, then gone. Absent when none. */
  traps?: Ring[];
  /**
   * Sinew (#1821, `hunting-gear`): from small game (a trap catch, a sling hunt) and deer, for the bow's
   * string. Optional: absent in a run with the switch off and in saves from before it, and read as 0
   * (`sinewOf`), so an old save loads unchanged and gets its first sinew from its next catch.
   */
  sinew?: number;
  /**
   * Raw meat (#1823, `camp-scavengers`): how much of `stores.rawFood` is meat from hunting and traps
   * (the rest is foraged plants and fish, which draw no animals). Written only with the switch on;
   * absent reads as none. Read through `meatOf`, which never counts more meat than there is raw food:
   * eating and spoiling take the plants first, so the meat is what's left.
   */
  meat?: number;
  /**
   * Of that meat, how much is stored safely at this camp (#1823, Store the meat) and where. Read
   * through `storedMeatOf` (never more than the meat): what's eaten comes off the meat lying out
   * first. Meat brought in afterwards lies out until it's stored too. Making camp elsewhere drops it.
   * The lidded cold pit's meat (#1857) is kept apart, in `meatPit`.
   */
  meatStored?: { n: number; place: PutBy };
  /**
   * The cold pit at camp has its lid on (#1857, `cold-pit-lid`). It belongs to the pit at
   * `coldPitAt`: digging a new pit, or leaving this one behind, takes it off (a pit kept at a camp
   * you left, `siteBuilds`, keeps it as `lid`). Written only with the switch on. Absent: no lid.
   */
  pitLid?: true;
  /**
   * Of the meat, how much is in the lidded cold pit (#1857): read through `pitMeatOf`, never more than
   * the meat or what the pit holds. Store the meat fills it first. Written only with the switch on;
   * dropped when the pit is empty or you make camp elsewhere. Absent: none.
   */
  meatPit?: number;
  /**
   * A banked fire at camp (#1865, `banked-fire`): the day it was banked and the hour of that day
   * (`hoursToday`) it smoulders until. Read through `bankedNow`, so a mark from an earlier day, or a
   * fire that has burned down, counts for nothing. Written only with the switch on; cleared at night
   * (the night's own fire takes over) and when camp moves.
   */
  banked?: { day: number; until: number };
  /** Crafted items that carry effects (src/artificer/crafting.ts). */
  tools: Tool[];
  /** Concept ranks and insight, earned by crafting. */
  concepts: Record<string, ConceptProgress>;
  /** Items (by id) that have already taught what their maker knew (#1456): each teaches once, the first time it's used this run. */
  taughtBy?: string[];
  /** Running totals for today, fed to nightly capacity drift. */
  /** Today so far. `outside` / `absorbed` (#1305): went out on the land; did study or craft work — either keeps cabin fever off. */
  today: { loadVigor: number; loadClarity: number; pushedVigor: boolean; pushedClarity: boolean; outside?: boolean; absorbed?: boolean; exhausted?: boolean;
    /** The day's peak pain (#1409), from working through an injury; resting pain is worked out from the injuries. */
    pain?: Pain;
    /** After a panic (#1361): shaking hands — crafts go a grade worse, and tonight's sleep is poor. */
    shaking?: boolean;
    /** Went back to a ring where you remember a place (#1379): Memory has had its practice today. */
    revisited?: boolean };
  /** Nights in a row without food / without water (#1233); each night without costs more. */
  deprivation: { hungry: number; thirsty: number };
  /** Practice hours per skill (#1236); levels come from these. */
  skills: SkillPractice;
  /** Who the Warden is (#1237, #1239, #1263): name, portrait, talents, stats, and whether Tough's last stand is spent. */
  character: Character;
  /** What the mind is working on (#1238), or null. The survival lock can override it (survivalLockOf). */
  focus: Focus | null;
  /** Techniques known (#1243) — knowledge, so it carries with the character. */
  techniques: string[];
  /** Manuals owned (#1243): they guide practice in their skill and teach their techniques when you're ready. */
  manuals: string[];
  /** Today's weather (#1282) — a fixed seeded schedule per character. */
  weatherToday: WeatherId;
  /** What the Warden knows of the coming days' weather (#1282): from a look-out or Weather sense. */
  forecast: Forecast;
  /** Hours spent outside in today's rain (#1284); reset each dawn. */
  wetHours?: number;
  /** Snow cover on the ground, 0 (bare) to 1 (deep) (#1315). Absent on saves from before it: bare. */
  snowDepth?: number;
  /** How the Warden eats (#1305): a standing choice, set like focus. Absent: full. */
  eating?: EatingPlan;
  /** Days in a row cooped up — not out on the land, no study or craft (#1305). */
  cabinDays?: number;
  /** Running totals of the carrying life (#1297): stones left behind, hours walked overloaded, raw food spoiled, and the heaviest raw load ever carried. Absent: none yet. */
  tally?: CarryTally;
  /** Strain from carrying overloaded (#1293): spoils the night's recovery, halves each night. Absent: none. */
  strain?: number;
  /** Where a cold pit was dug (#1295): it keeps raw food cold at that site only. Absent: none. */
  coldPitAt?: SiteId | null;
  /**
   * The rot owed by the food in the cold pit (#1757, `cold-pit-slows`): a fraction of one raw food,
   * 0..1, carried from night to night until it adds up to a whole one that goes bad. Written only
   * with the switch on; dropped when nothing is in the pit. Absent: none owed.
   */
  pitRot?: number;
  /**
   * Where camp is on the Reach (#1732, `camp-as-action`): the spot's id (`river@12,20`) and every spot
   * camped at, whose true traits you know. Written only by the Make camp action, so only with the
   * switch on. Absent: camp is a site kind alone, as before.
   */
  campSpot?: CampSpotState;
  /**
   * Where the Warden stands when it isn't camp (#1839, `directed-explore`): the Reach square they
   * headed out to (directed-explore.ts). Absent: at camp, or (before camp) at the start. Written only
   * by heading out, so only with the switch on; cleared by the walk back and by Make camp.
   */
  afield?: { x: number; y: number };
  /**
   * The Reach squares seen by heading out, or by looking around away from camp (#1839), as sorted
   * indices: the rings' knowledge has no direction, so what one direction shows is kept by square.
   * Written only with the switch on. Absent: none.
   */
  seenOut?: number[];
  /**
   * The last few days' walking (#1876, `walk-the-map`): each day's squares stepped on, in order, for
   * a live map later (walk-the-map.ts). Written only with the switch on. Absent: none kept.
   */
  trail?: TrailDay[];
  /**
   * The needle compass (#1868, `compass-heading`): the day its needle was last stroked, what it was
   * made from (the sewing kit's needle, or the hook from a hook and line) and the trips headed out
   * with it, its practice (compass-heading.ts). Written only by Make a needle compass and by heading
   * out with it, so only with the switch on. Absent: none made.
   */
  needleCompass?: NeedleCompass;
  /**
   * The map-drawing session is done (#1754, `map-learning`): you've placed what you found, and your
   * own map is drawn (descriptive-map.ts `canDrawMap`). Written only by the Draw your map action, so
   * only with the switch on. Absent: not yet (or a run without the switch).
   */
  mapLearned?: true;
  /**
   * The camps you're away from (#1753, `camp-builds-per-site`), by spot id: the day you left and
   * what's built there (the shelter, the cold pit and the raw food in it). The camp you're at stays
   * in the fields above. Written only by Make camp with the switch on; absent when none.
   */
  siteBuilds?: Record<string, SiteBuild>;
  /**
   * How worked each patch is (#1668, `action-length`): deadfall, berries, a fishing spot… by
   * `${ring}:${patch}`, 0..1. Written only by a session of chosen length, so only with the switch
   * on; a patch back to full is dropped. Absent: every patch untouched.
   */
  patches?: Patches;
  /**
   * Experimenting (#1690, `action-visibility`): hours of progress towards each recipe not yet
   * worked out, by recipe id (experiment.ts). Written only by the Experiment action, so only with
   * the switch on; a recipe worked out is dropped. Absent: none.
   */
  experiments?: Record<string, number>;
  /**
   * Familiarity (#1827, `forecasts`): how many times each task was done at each distance
   * (`wood@2`) and each recipe tried, failures too (`craft:stone-knife`). Counted, never rolled.
   * Written only with the switch on; absent: nothing done yet (or a run without the switch).
   */
  familiar?: Record<string, number>;
  log: LogEntry[];
  outcome: Outcome | null;
  config: Region1Config;
}

/** A fresh save: day 1, baseline body, a couple of meals, nothing known. */
/** Who the Warden is. `id` ties runs and carried knowledge to this one person (#1242). */
export interface Character {
  id: string;
  name: string;
  portrait: string | null;
  /** Talents (#1263): two chosen (known) and one hidden, each with a tier the player never sees. */
  talents: Talent[];
  lastStandUsed: boolean;
  /** Base stats (#1256): what they are now — growing, while young (#1399), towards `adult`. Every effect reads these. */
  stats: Stats;
  /** Growing up (#1399): their age, and the adult stats chosen at creation. Both absent: an adult (old saves, tests). */
  age?: number;
  adult?: Stats;
  /** Quirks (#1362): character rather than gifts — a panic response, temperament, fears. Hidden until revealed. */
  quirks?: Quirk[];
  /** Lasting harms (#1392): what grave injuries left behind — a stiff knee, a weak grip, a scar. They go with the character into every run. */
  harms?: Harm[];
  /** Who they were before the Reach (#1398): a scout brings training. Absent: none (tests, old saves). */
  background?: Background;
  /** What they packed for the hike (#1400), last time: the next run packs again, starting from it. */
  pack?: KitId[];
  /** Growth by use and wear (#1257): points gained or lost, exercise towards the next point, and wear. They carry. */
  trained?: Partial<Stats>;
  exercise?: Partial<Stats>;
  wear?: number;
  /** Exercise since the last proper night (#1414), waiting on recovery to bank it. It doesn't carry into a new run. */
  pending?: Partial<Stats>;
  /**
   * Difficulty (#1728): what was left unspent at creation — stat points and talent picks — as a
   * multiplier for a future high score (difficulty.ts). Fixed when the Warden is made; no rule
   * reads it. Absent: ×1.00 (all spent, a quick start, or a save from before it).
   */
  difficulty?: number;
}

/**
 * Who a new Warden is. `chosen` are the talents picked at creation (a hidden
 * one is rolled from `id`); `talents` carries a living character's talents
 * as they are (tiers and discoveries) into a new run.
 */
/** `stats` are the adult stats chosen at creation; `age` (#1399) makes them young. */
export interface WardenSpec extends Partial<Pick<Character, 'id' | 'name' | 'portrait' | 'stats' | 'talents' | 'background' | 'age' | 'pack'>> {
  chosen?: TalentId[];
  /** What's strapped on the outside of the pack (#1871, `pack-volume`); absent, the default straps (kit.ts autoOutside). Ignored with the switch off. */
  outside?: KitId[];
}

export function createRegion1(config: Partial<Region1Config> = {}, legacy?: Legacy, who: WardenSpec = {}): Region1State {
  // Talents (#1263): carried as they are, or two chosen plus a hidden one rolled from the id.
  const talents = (who.talents ?? legacy?.talents)?.map(t => ({ ...t })) ?? startingTalents(who.chosen ?? [], who.id ?? '');
  // Skills a Warden starts with: what a past run taught (legacy) and what a chosen talent brings, whichever is more.
  const start: SkillPractice = { ...(legacy?.skills ?? {}) };
  for (const [k, h] of Object.entries(startingPractice(who.chosen ?? [])) as [SkillId, number][]) start[k] = Math.max(start[k] ?? 0, h);
  // A scout's training (#1398): first aid, camp chores, map and compass — again, whichever is more.
  const background = who.background ?? legacy?.background;
  // Growing up (#1399): the stats chosen (or carried) are the adult ones; a young Warden has less of them for now.
  // Each new run of the same character is a year on.
  const adult: Stats = { ...(who.stats ?? legacy?.stats ?? DEFAULT_STATS) };
  const age = who.age ?? (legacy?.age !== undefined ? legacy.age + 1 : undefined);
  // The hike pack (#1400): chosen now, or what this character packed last time. None: today's bare start.
  // Only what this world offers (#1870): a Warden who packed the hand axe last time, starting in a
  // world without its switch, leaves it at home (it isn't on this list), so the run is today's.
  const pack = (who.pack ?? legacy?.pack)?.filter(id => kitOffered(id, (config.world ?? FULL_WORLD).features));
  // Difficulty (#1728), fixed here, at BEGIN: a character carried on keeps theirs; a new one made
  // from creation choices (stats or talent picks) is worth what they left unspent. A quick start
  // (neither: tests, old callers) is ×1.00. Kept only above ×1.00, so a full spend saves as before.
  const carried = legacy?.stats !== undefined || legacy?.talents !== undefined || who.talents !== undefined;
  const difficulty = carried ? difficultyRead(legacy?.difficulty)
    : who.chosen !== undefined || who.stats !== undefined ? difficultyOf(adult, who.chosen ?? []) : 1;
  // The odd things' switch (#1727) is the world's, read as a run would read it.
  // …and so is the pack's volume (#1871): with it on, where things went is kept in the kit.
  const run = { config: { world: config.world ?? FULL_WORLD } };
  const packed = pack ? startFromPack(pack, extrasOn(run), strapsOf(pack, { ...run.config.world, ...(who.outside ? { outside: who.outside } : {}) })) : null;
  for (const [k, h] of Object.entries(trainingOf(background)) as [SkillId, number][]) start[k] = Math.max(start[k] ?? 0, h);
  // What this Warden packed, and what the last one left for them (#1455) — less anything the pack already matches or beats.
  const packTools: Tool[] = packed ? packed.tools.map(t => ({ ...t })) : [];
  const left: Tool[] = (legacy?.heirlooms ?? [])
    .filter(h => !packTools.some(p => p.item === h.item && GRADES.indexOf(p.grade) >= GRADES.indexOf(h.grade)))
    .map(t => ({ ...t, heirloom: true }));
  const s: Region1State = {
    day: 1,
    hoursToday: 0,
    vitals: createVitals(),
    stores: { rawFood: 2, water: 2, firewood: 0, materials: 1 + (packed?.stores.materials ?? 0), rations: packed?.stores.rations ?? 0, stone: 0, hides: 0 },
    coldGear: false,
    explore: createExploration(),
    site: null,
    tier: 0,
    shelterGrade: null,
    shelter: { type: null, walls: null },
    flags: { everWater: false, everFood: false, everWood: false, everHunt: false, everPreserve: false, everHide: false },
    known: [...STARTING_RECIPES],
    studiedToday: {},
    milestones: [],
    // Someone who has done this before remembers how to plan; a fresh Warden learns it (#1350).
    canPlan: config.planning !== 'learned' || SKILL_IDS.some(id => skillLevel(legacy?.skills ?? {}, id) >= 1),
    tools: [...packTools, ...left],
    ...(packed ? { kit: { ...packed.kit, items: [...packed.kit.items] }, ...(packed.dressings ? { dressings: packed.dressings } : {}) } : {}),
    concepts: {},
    today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false },
    deprivation: { hungry: 0, thirsty: 0 },
    skills: start,
    // Stats (#1256): chosen at creation, or carried from this character's last run.
    character: {
      id: who.id ?? '', name: who.name ?? '', portrait: who.portrait ?? null, talents, lastStandUsed: false, stats: withTraining(grownStats(adult, age), legacy?.trained), ...(age !== undefined ? { age, adult } : {}),
      // What use and hardship made of them (#1257) goes on with them.
      ...(legacy?.trained ? { trained: { ...legacy.trained } } : {}), ...(legacy?.exercise ? { exercise: { ...legacy.exercise } } : {}), ...(legacy?.wear ? { wear: legacy.wear } : {}),
      // Quirks (#1362): carried as they are, or rolled from the id — one panic response, perhaps a temperament.
      ...((legacy?.quirks ?? (who.id ? startingQuirks(seedOf(who.id)) : undefined)) ? { quirks: (legacy?.quirks ?? startingQuirks(seedOf(who.id!))).map(q => ({ ...q })) } : {}),
      // Lasting harms (#1392): an old injury goes with you.
      ...(legacy?.harms?.length ? { harms: [...legacy.harms] } : {}),
      ...(background ? { background } : {}),
      ...(pack ? { pack: [...pack] } : {}),
      ...(difficulty > 1 ? { difficulty } : {}),
    },
    focus: null,
    techniques: [...(legacy?.techniques ?? [])],
    manuals: [],
    weatherToday: 'clear',
    forecast: {},
    log: [],
    outcome: null,
    config: { calendar: config.calendar ?? DEFAULT_CALENDAR, thresholds: config.thresholds ?? DEFAULT_THRESHOLDS, world: { ...(config.world ?? FULL_WORLD) } },
  };
  // Today's weather, and what Weather sense tells of the next two days (#1282).
  dawnWeather(s);
  // What the last Warden left (#1455): their tools, found where they were. The game's own
  // next run carries only these; the knowledge below is the older, same-character carry.
  if (left.length) say(s, `Someone was here before you. Left for you: ${heirloomList(left)}.`, 'milestone');
  // A run that keeps what the last Warden learned: recipes and concept
  // ranks carry over (insight starts again); body, stores and land don't.
  if (legacy?.marks) s.marks = legacy.marks;
  if (legacy?.contacts?.length) s.contacts = [...legacy.contacts];
  if (legacy?.met) s.met = { ...legacy.met };
  if (legacy && (legacy.known.length || Object.keys(legacy.concepts).length)) {
    for (const r of legacy.known) if (!s.known.includes(r)) s.known.push(r);
    // Clamped to the concept's own cap (#1469): a legacy from before the web was loaded can hold sealing 3.
    for (const [id, rank] of Object.entries(legacy.concepts)) s.concepts[id] = { rank: Math.min(rank, CRAFT_WORLD.concepts[id]?.ranks ?? rank), insight: 0 };
    const ranks = Object.entries(legacy.concepts).map(([id, r]) => `${id} ${r}`).join(', ');
    say(s, `You carry what you learned: ${s.known.length} recipes${ranks ? ` and ${ranks}` : ''}.`, 'milestone');
  }
  // A year on (#1399): what grew.
  const grew = legacy && age !== undefined && legacy.age !== undefined ? birthdayLine(adult, age) : null;
  if (grew) say(s, grew, 'milestone');
  // Learning the map (#1754): the first thing you do is look around; the land is directions and distances for now.
  if (mapLearningOn(s) && descriptiveMapOn(s)) say(s, LOOK_AROUND_LINE, 'milestone');
  return s;
}

/** Deep-enough copy so every exported function can stay pure. */
function clone(s: Region1State): Region1State {
  return {
    ...s,
    vitals: { vigor: { ...s.vitals.vigor }, clarity: { ...s.vitals.clarity }, condition: s.vitals.condition },
    stores: { ...s.stores },
    shelter: { ...s.shelter },
    flags: { ...s.flags },
    known: [...s.known],
    studiedToday: { ...s.studiedToday },
    milestones: [...s.milestones],
    tools: [...s.tools],
    concepts: { ...s.concepts },
    ...(s.taughtBy ? { taughtBy: [...s.taughtBy] } : {}),
    ...(s.experiments ? { experiments: { ...s.experiments } } : {}),
    today: { ...s.today },
    deprivation: { ...s.deprivation },
    skills: { ...s.skills },
    character: { ...s.character, talents: s.character.talents.map(t => ({ ...t })), stats: { ...s.character.stats }, ...(s.character.quirks ? { quirks: s.character.quirks.map(q => ({ ...q })) } : {}), ...(s.character.harms ? { harms: [...s.character.harms] } : {}) },
    techniques: [...s.techniques],
    manuals: [...s.manuals],
    ...(s.pins ? { pins: s.pins.map(p => ({ ...p })) } : {}),
    ...(s.injuries ? { injuries: s.injuries.map(i => ({ ...i })) } : {}),
    ...(s.kit ? { kit: { ...s.kit, items: [...s.kit.items] } } : {}),
    forecast: { ...s.forecast },
    log: [...s.log],
  };
}

// With `distance-not-rings` on (#1752), every line the journal keeps says distances, not rings (distance-words.ts).
const say = (s: Region1State, text: string, kind: LogEntry['kind'], at?: LogEntry['at']): void => {
  const said = ringWordsFor(s, text);
  s.log.push(at ? { day: s.day, text: said, kind, at } : { day: s.day, text: said, kind });
};

/**
 * Exercise stats (#1257) — hours per stat, from work on the Reach, on the road, or the night. It
 * waits as pending until a proper night's recovery banks it (#1414).
 */
export function exerciseStats(next: { character: Character }, gains: Partial<Stats>): void {
  const pending = { ...(next.character.pending ?? {}) };
  let any = false;
  for (const id of GROWTH_STATS) {
    const h = gains[id] ?? 0;
    if (h <= 0) continue;
    pending[id] = Math.round(((pending[id] ?? 0) + h) * 100) / 100;
    any = true;
  }
  if (any) next.character = { ...next.character, pending };
}

/**
 * A proper night's recovery (#1414): bank up to RECOVERY_CAP hours of each stat's pending exercise,
 * raising the stat when it reaches the next point, and let the rest go. The journal says each gain,
 * and when training outran recovery.
 */
function recoverStats(next: { character: Character; log: LogEntry[]; day: number }): void {
  const pending = next.character.pending;
  if (!pending) return;
  let wasted = 0;
  for (const id of GROWTH_STATS) {
    const p = pending[id] ?? 0;
    if (p <= 0) continue;
    const banked = Math.min(p, RECOVERY_CAP);
    wasted += p - banked;
    const c = next.character;
    const r = exercise(c.stats, { trained: c.trained, exercise: c.exercise, wear: c.wear }, id, banked);
    next.character = { ...c, stats: r.stats, ...(r.growth.trained ? { trained: r.growth.trained } : {}), exercise: r.growth.exercise };
    for (const score of r.reached) next.log.push({ day: next.day, text: gainLine(id, score), kind: 'milestone' });
  }
  const { pending: _done, ...rest } = next.character;
  next.character = rest;
  // Said once a run, the first time it happens — a lesson, not a nightly nag.
  if (wasted >= 1 && !next.log.some(l => l.text.startsWith(OVERTRAINED))) next.log.push({ day: next.day, text: overtrainedLine(wasted), kind: 'action' });
}

/** A night of long deprivation (#1257): wear builds, and at the limit costs a point of Constitution. */
function wearNight(next: { character: Character; log: LogEntry[]; day: number }, thirst: boolean): void {
  const c = next.character;
  const wear = (c.wear ?? 0) + 1;
  if (wear < WEAR_LIMIT) { next.character = { ...c, wear }; return; }
  const r = wearDown(c.stats, { trained: c.trained, exercise: c.exercise }, 'con');
  next.character = { ...c, stats: r.stats, trained: r.growth.trained, wear: 0 };
  if (r.lost) next.log.push({ day: next.day, text: wearLine(thirst, r.stats.con), kind: 'hardship' });
}

/** When a piece of work starts and the light it has, from the hours already spent and how long it takes (#1280). */
const stampFor = (s: Pick<Region1State, 'day' | 'hoursToday' | 'config'>, hours: number): { hour: number; light: number } =>
  ({ hour: clockHour(s.hoursToday), light: s.config.world.darkness ? lightOver(s.day, clockHour(s.hoursToday), hours, s.config.calendar) : 1 });

// ── Derived values ──────────────────────────────────────────────────────────

/** How much of the site's warmth the shelter as built realises. */
function shelterFactor(s: Region1State): number {
  if (s.tier === 0) return OPEN_CAMP_FACTOR;
  if (s.tier === 1) return SHELTER_TYPES[s.shelter.type ?? 'leanto'].factor;
  return WALL_TYPES[s.shelter.walls ?? 'timber'].factor;
}

/**
 * Shelter warmth, 0..1 = site potential × the design built × how well it was built. With
 * `built-warmth` (#1763) the site gives a head start instead of a ceiling (built-warmth.ts).
 */
export function warmth(s: Region1State): number {
  // A night out on the land away from camp (#1839, `directed-explore`): under the sky, no shelter.
  if (!s.site || awayFromCamp(s)) return 0;
  if (builtWarmthOn(s)) return builtWarmth(s, GRADE_WARMTH, SHELTER_PIN_WARMTH);
  return Math.min(1, SITES[s.site].warmth * shelterFactor(s) * GRADE_WARMTH[s.shelterGrade ?? 'sound'] + (s.shelter.sited && s.tier > 0 ? SHELTER_PIN_WARMTH : 0));
}

export function readinessInput(s: Region1State): ReadinessInput {
  return { rations: s.stores.rations, firewood: s.stores.firewood, shelterWarmth: warmth(s), vitals: s.vitals };
}

export const winterReady = (s: Region1State): boolean => isWinterReady(readinessInput(s), s.config.thresholds);

/**
 * The winter outlook (#1302): advice, not a gate. How many nights the stores
 * last at the rates the nights actually use, and how the shelter stands
 * against a midwinter night. Winter itself is the test.
 */
export interface WinterOutlook {
  /** Nights of food (raw food first, then rations — one a night). */
  foodDays: number;
  /** Nights of water. */
  waterDays: number;
  /** Nights the firewood lasts, at the burn of a typical night of each day ahead (capped at the thaw). */
  fuelDays: number;
  /** Firewood the nights from tonight to the thaw will need (#1303). */
  fuelToThaw: number;
  /** Shelter warmth, with a fire kept in (#1306), less what a clear midwinter night needs not to be cold (negative: too cold). */
  warmthMargin: number;
  /** Nights left until the thaw, tonight included. */
  nightsToThaw: number;
}

/**
 * Firewood a night in camp on `day` will burn (#1303), at today's shelter
 * warmth. Tonight uses tonight's weather; later nights a typical one (no
 * weather shift). None in the flat world.
 */
export function nightFuel(s: Region1State, day = s.day): number {
  if (!feelsTemperature(s)) return 0;
  const w = Math.max(0, warmth(s) - (day === s.day ? windChill(s.weatherToday) : 0));
  const weather = day === s.day ? s.weatherToday : 'wind';
  return nightFire(s, nightTemp(day, weather, s.config.calendar), weather, w, day);
}

/**
 * Firewood a night's fire asks (#1303): 1, plus 1 for every full 5 °C of frost, less in a warm
 * shelter (weather.ts fireNeed). With `thermal-model` (#1770) the frost is judged where you sleep
 * with no fire lit (thermal.ts sleeperEnvironment), so a cave's steady air (its own, about +4 °C) asks for none and
 * walls take a few degrees off; and above freezing a fire is lit anyway (1 firewood) if the night
 * would be cold or worse without one, as anyone would.
 */
function nightFire(s: Region1State, t: number, weather: WeatherId, w: number, day = s.day): number {
  if (!thermalOn(s)) return fireNeed(t, w);
  const at = { ...s, day };
  const frost = fireNeed(sleeperEnvironment(at, { tempC: t, weather, fire: 0 }).airC, w);
  if (frost > 0) return frost;
  const bare = thermalNight(at, { tempC: t, weather, fire: 0 }).quality;
  return bare === 'cold' || bare === 'dangerous' ? 1 : 0;
}

/**
 * Tonight at camp as the thermal model sees it (#1770, `thermal-model`): with the fire judged as
 * the night will judge it (all of it if the woodpile covers what the frost asks, else its share).
 * Null with the switch off, in the flat world, or before there's a camp. Pure.
 */
export function tonightThermal(s: Region1State): ThermalNight | null {
  if (!thermalOn(s) || !feelsTemperature(s) || !s.site) return null;
  const t = nightTemp(s.day, s.weatherToday, s.config.calendar);
  const shelterW = Math.max(0, warmth(s) - windChill(s.weatherToday));
  const need = kitFireNeed(s, nightFire(s, t, s.weatherToday, shelterW));
  const fire = need === 0 ? 0 : Math.min(1, s.stores.firewood / need);
  return thermalNight(s, { tempC: t, weather: s.weatherToday, fire });
}

export function winterOutlook(s: Region1State): WinterOutlook {
  const cal = s.config.calendar;
  const midwinter = nightTemp(cal.winterDay + MIDWINTER_AFTER, 'clear', cal);
  // Walk the nights to the thaw: how far the woodpile goes, and what the whole winter asks.
  let left = s.stores.firewood, fuelDays = 0, fuelToThaw = 0, lasting = true;
  for (let d = s.day; d < cal.thawDay; d++) {
    const need = nightFuel(s, d);
    fuelToThaw += need;
    if (lasting && left >= need) { left -= need; fuelDays++; } else lasting = false;
  }
  return {
    foodDays: s.stores.rawFood + s.stores.rations,
    waterDays: s.stores.water,
    fuelDays,
    fuelToThaw,
    warmthMargin: warmth(s) + FIRE_WARMTH - coldNightNeeds(midwinter),
    nightsToThaw: Math.max(0, cal.thawDay - s.day),
  };
}

// ── Actions ─────────────────────────────────────────────────────────────────

export type ActionId =
  | 'scout' | 'survey' | 'track'
  | 'gather' | 'hunt' | 'water' | 'wood' | 'quarry' | 'preserve'
  | 'build' | 'coldGear'
  | 'knife' | 'snare' | 'waterskin' | 'bedroll' | 'shovel'
  | 'basket' | 'backpack' | 'harness' | 'sled'
  | 'lookout' | 'study'
  | 'tinker' | 'rest' | 'treat'
  | 'fish' | 'coldPit'
  // Learning your actions as you go (#1689, #1690): only with the `action-visibility` switch on.
  | 'explore' | 'experiment'
  // Making camp is an action (#1732): only with the `camp-as-action` switch on.
  | 'camp'
  // Drawing your map from what you've found (#1754): only with the `map-learning` switch on.
  | 'drawmap'
  // Picking up loose stone (#1816): only with the `stone-gathering` switch on.
  | 'gatherstone'
  // Traps, and the gear active hunting and fishing need (#1821): only with the `hunting-gear` switch on.
  | 'traps' | 'sling' | 'bow' | 'hookline'
  // Storing the meat out of reach of animals (#1823): only with the `camp-scavengers` switch on.
  | 'storemeat'
  // A lid for the cold pit (#1857): only with the `cold-pit-lid` switch on.
  | 'lidpit'
  // Banking the fire to guard the meat while you're away (#1865): only with the `banked-fire` switch on.
  | 'bankfire'
  // Making a needle compass to keep a heading by (#1868): only with the `compass-heading` switch on.
  | 'needlecompass';

/** Actions that happen out on the land, in a chosen ring. */
export type RingActionId = 'scout' | 'survey' | 'track' | 'lookout' | 'gather' | 'hunt' | 'water' | 'wood' | 'quarry' | 'fish' | 'explore' | 'gatherstone' | 'traps';
/**
 * A queue entry: an action, optionally aimed at a ring (`wood@2`). A bare id
 * means the near ring, so plans written before rings existed still read right.
 */
export type QueueId = ActionId | `${RingActionId}@${Ring}`;

/** Split a queue entry into its action and ring. */
export function parseQueueId(q: QueueId): { id: ActionId; ring: Ring } {
  const [id, r] = q.split('@') as [ActionId, string | undefined];
  return { id, ring: (r ? Number(r) : 1) as Ring };
}

/** Choices made for one queued action (e.g. `{ site: 'tree', type: 'hut' }`). */
export type ActionOpts = Readonly<Record<string, string>>;
/** A queue entry with its chosen options. A plain QueueId means "defaults". */
export type QueueItem = QueueId | { q: QueueId; opts: ActionOpts };

/** Split any queue item into action, ring and options. */
export function parseItem(item: QueueItem): { id: ActionId; ring: Ring; opts: ActionOpts } {
  const q = typeof item === 'string' ? item : item.q;
  return { ...parseQueueId(q), opts: typeof item === 'string' ? {} : item.opts };
}

/** One choice inside an option group, with why it's unavailable (or null). */
export interface OptionChoice { value: string; label: string; note: string; blocked: string | null }
/** A decision an action needs: only groups with a real choice are offered. */
export interface OptionGroup { key: string; label: string; value: string | null; choices: OptionChoice[] }

/** Build a queue entry (ring 1 stays bare). */
export const queueId = (id: ActionId, ring: Ring = 1): QueueId => (ring === 1 || !ACTIONS[id].ringed ? id : (`${id}@${ring}` as QueueId));

interface ActionDef {
  name: string;
  hours: number;
  /** Per-hour pull on each pool (negative = drain). */
  vigorRate: number;
  clarityRate: number;
  /** Why the action can't be done right now (in this ring, with these choices), or null if it can. */
  gate?: (s: Region1State, ring: Ring, opts: ActionOpts) => string | null;
  /** Decisions this action offers, given the state it would run in and what's chosen so far (and the ring, when known). */
  options?: (s: Region1State, opts: ActionOpts, ring?: Ring) => OptionGroup[];
  /**
   * Apply the effect to (an already-cloned) state; return the journal line.
   * `bonus` is the extra yield your tools give this action; `light` is the
   * average light the work had (#1281, 1 by day — darkness costs haul and sight).
   */
  /** `luck`: the trip's haul multiplier from its luck band (#1314) — 1 for an ordinary trip, and for work that isn't a haul. */
  /** `sc` (#1668): how many usual trips' worth a session of chosen length adds up to — per patch for the yield, overall for the land. */
  run: (s: Region1State, bonus: number, ring: Ring, opts: ActionOpts, light: number, luck: number, sc: RunScale) => string;
  /** How the chosen options change the work itself (hours and per-hour pulls). */
  variant?: (opts: ActionOpts, s?: Region1State, ring?: Ring) => { hours?: number; vigorRate?: number; clarityRate?: number };
  /** Happens out on the land: can target a ring, and pays its travel time. */
  ringed?: boolean;
  /** A craft: paid from stores and resolved by crafting.craft (its hours/rates come from there). */
  recipe?: CraftRecipe;
  /** A craft whose recipe depends on the state and choices (each shelter stage and design is its own build). */
  recipeFor?: (s: Region1State, opts: ActionOpts) => CraftRecipe | null;
}

/** Learning your actions as you go (#1689, #1690): the run's switch. */
export const visibilityOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, ACTION_VISIBILITY);
/** Gather stones first, quarry once you know the cleave (#1816): the run's switch. */
export const stoneGatheringOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, STONE_GATHERING);
/** Quarrying is hidden (#1816) until the cleave is known: only with `stone-gathering` on. */
const quarryLocked = (s: Region1State): boolean => stoneGatheringOn(s) && !s.techniques.includes(QUARRY_TECHNIQUE);
/** Whether the Warden has this tool (an heirloom too). */
const hasItem = (s: Pick<Region1State, 'tools'>, item: string): boolean => s.tools.some(t => t.item === item);
/** Sinew the Warden has (#1821): 0 when the run or the save has none. */
export const sinewOf = (s: Pick<Region1State, 'sinew'>): number => s.sinew ?? 0;
/** Add sinew from a catch, and say how much (for `sinewNote`). Mutates `s`. */
const addSinew = (s: Region1State, n: number): number => { s.sinew = sinewOf(s) + n; return n; };
/** Raw meat at camp (#1823): never more than the raw food there is. 0 with the switch off. */
export const meatOf = (s: Pick<Region1State, 'meat' | 'stores'>): number => Math.max(0, Math.min(s.meat ?? 0, s.stores.rawFood));
/** What the meat helpers read: the meat, where it's put by, and the camp's pit (#1823, #1857). */
type MeatView = Pick<Region1State, 'meat' | 'meatStored' | 'meatPit' | 'pitLid' | 'stores' | 'site' | 'coldPitAt' | 'config'>;
/**
 * Whether camp's cold pit has its lid on (#1857, `cold-pit-lid`): the lid belongs to the pit, so it
 * counts only where the pit is, at camp.
 */
export const pitLidded = (s: Pick<Region1State, 'pitLid' | 'site' | 'coldPitAt' | 'config'>): boolean =>
  s.pitLid === true && !!s.site && s.coldPitAt === s.site && lidOn(s);
/**
 * The meat in the lidded cold pit (#1857): never more than the meat there is, or than the pit holds.
 * When meat goes (eaten, spoiled), the pit's is the last to go: it's the best place. 0 with no lid.
 */
export const pitMeatOf = (s: MeatView): number => (pitLidded(s) ? Math.max(0, Math.min(s.meatPit ?? 0, meatOf(s), coldPitHolds(s.site))) : 0);
/** The meat hung or cached (#1823): never more than the meat left once the pit's is counted. */
export const hungMeatOf = (s: MeatView): number => Math.max(0, Math.min(s.meatStored?.n ?? 0, meatOf(s) - pitMeatOf(s)));
/**
 * Of it, the meat stored safely (#1823): hung or cached, and (#1857) in the lidded pit. With no lid
 * the pit's share is 0, so this is the count it always was.
 */
export const storedMeatOf = (s: MeatView): number => pitMeatOf(s) + hungMeatOf(s);
/** The meat lying out at camp, not stored (#1823): what animals can get at. */
export const openMeatOf = (s: MeatView): number => meatOf(s) - storedMeatOf(s);
/** Add meat brought in from a hunt or a trap line (#1823): only with the switch on. Mutates `s`. */
const addMeat = (s: Region1State, n: number): void => { if (n > 0 && scavengersOn(s)) s.meat = meatOf(s) + n; };
/**
 * Take meat out of the stores (#1823): a theft, or meat preserved. It comes off the meat lying out
 * first, then what's hung or cached, and last (#1857) the lidded pit's. Mutates `s`.
 */
function takeMeat(s: Region1State, n: number, fromStores: boolean): void {
  const pit = pitMeatOf(s), stored = hungMeatOf(s);
  s.meat = meatOf(s) - n;
  if (fromStores) s.stores.rawFood -= n;
  // With no lid `pit` is 0, so the hung meat keeps min(stored, meat), as before #1857.
  const pitLeft = Math.min(pit, s.meat);
  if (s.meatPit !== undefined) {
    if (pitLeft > 0) s.meatPit = pitLeft;
    else delete s.meatPit;
  }
  if (s.meatStored) {
    if (Math.min(stored, s.meat - pitLeft) > 0) s.meatStored = { ...s.meatStored, n: Math.min(stored, s.meat - pitLeft) };
    else delete s.meatStored;
  }
}
/** Whether camp's shelter has walls to keep the meat in (#1858, `walled-larder`): tier 2, either kind. A roof alone doesn't count. */
export const walledHere = (s: Pick<Region1State, 'site' | 'tier' | 'config'>): boolean => !!s.site && s.tier >= 2 && walledLarderOn(s);
/**
 * The guards on the meat lying loose at camp (#1858): `base` (none while you're away, `nightGuards`
 * at night), and the walls when there are walls. With no walls (or the switch off), `base` as it was.
 */
export const openGuards = (s: Pick<Region1State, 'site' | 'tier' | 'config'>, base: readonly Guard[]): Guard[] => (walledHere(s) ? [...base, 'walled'] : [...base]);
/**
 * The days camp has stood at its site (#1858): from `siteDay`, written each time camp is made or
 * moved (moveCamp), so moving camp sets it back to 0. 0 before camp, or on a save without it.
 */
export const campDaysOf = (s: Pick<Region1State, 'site' | 'siteDay' | 'day'>): number => (s.site && s.siteDay !== undefined ? Math.max(0, s.day - s.siteDay) : 0);
/** Whether mice can come to this camp tonight (#1858): it has stood long enough at its site. */
export const miceAbout = (s: Pick<Region1State, 'site' | 'siteDay' | 'day' | 'config'>): boolean => (walledLarderOn(s) || lidOn(s)) && miceChance(campDaysOf(s)) > 0;
/**
 * Whether a fire will burn tonight (#1823): enough firewood for what the night asks, or, on a night
 * that asks for none, any wood at all for one (as the night's fright reads it, nightSceneOf).
 */
export const fireTonight = (s: Region1State): boolean => s.stores.firewood > 0 && s.stores.firewood >= nightFuel(s);
/** The guards on the meat lying out tonight (#1823, #1859): you asleep at camp, and a fire if one burns. */
export const nightGuards = (fire: boolean): Guard[] => (fire ? ['asleep', 'fire'] : ['asleep']);
/**
 * Whether a banked fire smoulders at camp right now (#1865, `banked-fire`): banked today and not yet
 * burned down (nor put out: then the mark is gone). False with the switch off.
 */
export const bankedNow = (s: Pick<Region1State, 'banked' | 'day' | 'hoursToday' | 'config'>): boolean =>
  bankedFireOn(s) && !!s.banked && s.banked.day === s.day && s.hoursToday < s.banked.until;
/** The guards on the meat lying out while you're away (#1865): a banked fire if one smoulders, else none. */
export const awayGuards = (banked: boolean): Guard[] => (banked ? ['fire'] : []);
/** The guard where the stored meat is (#1859): each place is a row of the table; the pit's (#1857) is `lidded`. */
export const placeGuard = (place: MeatPlace): Guard => (place === 'pit' ? 'lidded' : place);
/**
 * The best place outside the pit camp has the makings for, to store the meat (#1823): MEAT_PLACES is
 * best first. The lidded pit (#1857) is filled before this, by Store the meat itself, since it needs
 * the pit rather than stores.
 */
export const meatPlaceFor = (s: Pick<Region1State, 'stores'>): PutBy | null => {
  for (const p of MEAT_PLACES) if (p.needs !== 'lid' && s.stores[p.needs.store] >= p.needs.n) return p.place;
  return null;
};
/** Room left in the lidded pit for more meat (#1857): 0 with no lid. */
const pitRoom = (s: Region1State): number => (pitLidded(s) ? Math.max(0, coldPitHolds(s.site) - pitMeatOf(s)) : 0);
/**
 * A theft from the meat lying out (#1823), drawn from its own stream: on a long absence (by day,
 * `night` false) or a night at camp. Says what took it, takes it, and (something big at night)
 * the fright's Clarity. Mutates `next`. With luck off (the flat world) nothing comes.
 */
function scavenge(next: Region1State, open: number, rand: () => number, guards: readonly Guard[], night: boolean, at?: LogEntry['at']): void {
  if (open <= 0 || next.config.world.luck === false) return;
  const theft = rollTheft(rand, open, leftover(guards, night ? NIGHT_BASE : DAY_BASE), night, seasonOf(next.day, next.config.calendar) === 'winter');
  if (!theft) return;
  takeMeat(next, Math.min(theft.taken, openMeatOf(next)), true);
  say(next, theftLine(theft, night), 'hardship', at);
  // A big animal in camp at night (#1823): a frightening encounter, though nobody is hurt.
  if (theft.big) fright(next);
}
/**
 * Whether the fire banked when the trip set out (`s`) still smoulders when it's back (`next`), #1865.
 * Heavy wet weather may put it out (FIRE_OUT, a draw from its own stream keyed on the hour the trip
 * set out, so it never moves the meat's away roll); and a trip that runs past the banking's hours
 * comes back to cold ashes. Either way the fire is gone (the mark cleared) and the journal says so.
 * With luck off (the flat world) the weather never puts it out. Mutates `next`.
 */
function fireLasted(next: Region1State, s: Region1State, at?: LogEntry['at']): boolean {
  const chance = FIRE_OUT[next.weatherToday] ?? 0;
  if (chance > 0 && next.config.world.luck !== false && bankedFireDraw(seedOf(next.character.id), s.day, s.hoursToday)() < chance) {
    delete next.banked;
    say(next, fireOutLine(next.weatherToday), 'hardship', at);
    return false;
  }
  if (next.hoursToday > s.banked!.until + 1e-9) {
    delete next.banked;
    say(next, burntDownLine(), 'hardship', at);
    return false;
  }
  return true;
}
/**
 * A bear at the stored meat in the night (#1823): hung meat and a stone cache keep everything else
 * off, but a bear can climb or heave the stones aside, rarely. Its own stream, so it never moves the
 * open meat's draws. Only the big threat can reach stored meat (its small pass-through is 0), and
 * what it takes is all of what was put by. Mutates `next`.
 */
function raidStore(next: Region1State, fire: boolean): void {
  // Only what's hung or cached: the lidded pit's meat (#1857) has a roll of its own (raidPit).
  const stored = hungMeatOf(next);
  if (stored <= 0 || !next.meatStored || next.config.world.luck === false) return;
  const risk = leftover([...nightGuards(fire), placeGuard(next.meatStored.place)], NIGHT_BASE);
  const u = storedScavengers(seedOf(next.character.id), next.day)();
  if (u >= risk.big) return;
  next.meat = meatOf(next) - stored;
  next.stores.rawFood -= stored;
  delete next.meatStored;
  say(next, storedTheftLine(stored), 'hardship');
  fright(next);
}
/** The Clarity a big animal in camp at night costs (#1823): a frightening encounter, though nobody is hurt. Mutates `next`. */
function fright(next: Region1State): void {
  next.vitals = { ...next.vitals, clarity: { ...next.vitals.clarity, current: Math.max(0, next.vitals.clarity.current - BIG_CLARITY) } };
}
/**
 * A bear at the lidded cold pit in the night (#1857): the stones keep foxes, ravens and wolves out
 * (`lidded`'s small pass-through is 0, and only a bear is strong enough for the big part), so only a
 * bear can get in, and not in winter, when it sleeps. Its own stream (`pitScavengers`), so it never
 * moves the other draws. It takes all of the pit's meat. Mutates `next`.
 */
function raidPit(next: Region1State, fire: boolean): void {
  const inPit = pitMeatOf(next);
  if (inPit <= 0 || next.config.world.luck === false || seasonOf(next.day, next.config.calendar) === 'winter') return;
  const risk = leftover([...nightGuards(fire), 'lidded'], NIGHT_BASE);
  if (pitScavengers(seedOf(next.character.id), next.day)() >= risk.big) return;
  next.meat = meatOf(next) - inPit;
  next.stores.rawFood -= inPit;
  delete next.meatPit;
  say(next, pitTheftLine(inPit), 'hardship');
  fright(next);
}
/**
 * Mice in the night (#1858): only at a camp that has stood at its site a few days (`miceChance`).
 * They nibble a small share of the meat loose behind walls (`walled-larder`) and of the meat in the
 * lidded pit (`cold-pit-lid`), at the vermin pass-through of the guards there; each from a stream
 * of its own. Hung or cached meat is out in the trees, away from the shelter that draws them, and
 * rations are smoked: they leave those be. Mutates `next`.
 */
function mice(next: Region1State, fire: boolean): void {
  const chance = miceChance(campDaysOf(next));
  if (chance <= 0 || next.config.world.luck === false) return;
  const seed = seedOf(next.character.id);
  if (walledHere(next)) {
    const loose = openMeatOf(next);
    const k = rollNibble(verminScavengers(seed, next.day), loose, chance * leftover(openGuards(next, nightGuards(fire))).vermin);
    if (k > 0) {
      takeMeat(next, k, true);
      say(next, miceLine(k), 'hardship');
    }
  }
  const inPit = pitMeatOf(next);
  if (inPit > 0) {
    const k = rollNibble(pitVerminScavengers(seed, next.day), inPit, chance * leftover([...nightGuards(fire), 'lidded']).vermin);
    if (k > 0) {
      // From the pit itself: the meat loose and hung keeps what it has.
      next.meat = meatOf(next) - k;
      next.stores.rawFood -= k;
      if (inPit - k > 0) next.meatPit = inPit - k;
      else delete next.meatPit;
      say(next, pitMiceLine(k), 'hardship');
    }
  }
}
/** The ranged tool a Warden hunts with (#1821): the bow if they have one, else a sling, else none. */
export const huntTool = (s: Pick<Region1State, 'tools'>): 'sling' | 'bow' | null => (hasItem(s, BOW) ? 'bow' : hasItem(s, SLING) ? 'sling' : null);
/** Hunting is hidden (#1821) until a sling or a bow: only with `hunting-gear` on. */
const huntLocked = (s: Region1State): boolean => huntingGearOn(s) && huntTool(s) === null;
/** Fishing is hidden (#1821) until a hook and line: only with `hunting-gear` on. */
// The fishing kit (#1870) is a hook and line already: real hooks and a line, so fishing opens with it from day 1.
const fishLocked = (s: Region1State): boolean => huntingGearOn(s) && !hasItem(s, HOOK_LINE) && !hasAxeFishing(s, 'fishing-kit');
/** Knowing hunting (or woodcraft) well enough to make a bow (#1821). */
const bowReady = (s: Region1State): boolean => skillLevel(s.skills, 'hunting') >= BOW_LEVEL.hunting || skillLevel(s.skills, 'woodcraft') >= BOW_LEVEL.woodcraft;
/** A hunt's quarry: as chosen, else deer — or small game, with `hunting-gear` and no bow (#1821). */
const huntTarget = (s: Region1State | undefined, o: ActionOpts): string => o.target ?? (s && huntingGearOn(s) && huntTool(s) !== 'bow' ? 'small' : 'deer');
/** The method a hunt or a trap line uses, for its odds (#1821). */
const methodOf = (s: Region1State, id: 'hunt' | 'traps'): HuntTool => (id === 'traps' ? 'traps' : huntTool(s) ?? 'sling');
/** The odds of a hunt or a trap line there, from the true Hunting level: what the sim plays by. */
const trueHuntOdds = (s: Region1State, id: 'hunt' | 'traps', ring: Ring): HuntOdds =>
  huntOdds(huntScore(level(s.explore, ring, 'game'), methodOf(s, id), skillLevel(s.skills, 'hunting'), supplyWord(s.explore.supply[ring].game)));
/**
 * The odds of a hunt or a trap line there, in a word (#1821): good odds, fair odds, a long shot —
 * for the page's cards and the AI. From what you know of the game there, the tool and the Hunting
 * level the Warden *thinks* they have (#1241), as the trip odds are. Null with the switch off.
 */
export function huntOddsOf(s: Region1State, id: 'hunt' | 'traps', ring: Ring): HuntOdds | null {
  if (!huntingGearOn(s)) return null;
  return huntOdds(huntScore(level(s.explore, ring, 'game'), methodOf(s, id), perceivedLevel(s.skills, 'hunting'), supplyWord(s.explore.supply[ring].game)));
}
/** A small-game catch from a trap line there (#1821): a couple of hares near camp, more further out, less where the game is thin. */
export const trapCatchOf = (e: Exploration, ring: Ring): number => Math.max(1, Math.round(landYield(e, ring, 'game', 2, 0.5) * supplyFactor(e, ring, 'game')));
/** Setting a line of traps (#1821): light work along the trails, and a little cord. */
const TRAP_HOURS = 2;
const TRAP_CORD = 1;

/** How the land gets known: by scouting, or (with the switch on) by exploring. */
const scoutVerb = (s: Region1State): string => (visibilityOn(s) ? 'explore' : 'scout');

const needsScout = (s: Region1State): string | null => (scouted(s.explore, 1) ? null : `you don't know the land yet — ${scoutVerb(s)} first`);

/** Can you get to this ring? (The one inside it must be known first.) */
const reach = (s: Region1State, ring: Ring): string | null =>
  (reachable(s.explore, ring) ? null : `the ${RING_NAME[(ring - 1) as Ring].toLowerCase()} ring isn't known yet — ${scoutVerb(s)} it first`);

/** Game you've tracked (observed) in any ring. */
export const gameTracked = (s: Region1State): boolean => RINGS.some(r => level(s.explore, r, 'game') >= 2);
/** You've seen the pass out through the distant hills — the way on, come spring. */
export const routeKnown = (s: Region1State): boolean => level(s.explore, 3, 'routes') >= 1;

const where = (ring: Ring): string => (ring === 1 ? '' : ` in the ${RING_NAME[ring].toLowerCase()} ring`);
/** Looking at the land in the dark teaches nothing (#1281). */
const tooDark = (ring: Ring): string => `Too dark to make anything out${where(ring)} — the hours pass and you learn nothing.`;
/** Fog hides the land (#1284). */
const fogged = (ring: Ring): string => `Fog lies thick${where(ring)} — you can't see past your own hand, and learn nothing.`;
/** A note when poor light cost part of the haul (#1281). */
const dimNote = (light: number): string => (light < 1 ? (light < 0.5 ? ' Most of it lost to the dark.' : ' The light was failing.') : '');

/**
 * Work a domain on (an already-cloned) state: it teaches you the ground and
 * draws down its supply (#1304). Returns a journal suffix for any find.
 */
function workLand(s: Region1State, ring: Ring, d: Domain, amount = 1): string {
  const w = work(s.explore, ring, d, amount);
  s.explore = w.exploration;
  const f = w.found ? FINDS[w.found] : undefined;
  // Before the cleave (#1816) a flint seam's note names the stone work you have: gathering.
  const note = w.found === 'stone' && quarryLocked(s) ? STONE_GATHER_FIND_NOTE : f?.note;
  return f ? ` You know this ground well now — found a ${f.name.toLowerCase()} (${note}).` : '';
}
/**
 * A trip's haul (#1304): what the ground and the Warden bring together, taken
 * at the land's supply, then by the trip's luck (#1314). Rounded; the land
 * alone never gives nothing — a stripped patch still gives a little — but bad
 * luck can.
 */
const haul = (s: Region1State, ring: Ring, d: Domain, raw: number, luck = 1): number =>
  (luck === 0 ? 0 : Math.max(1, Math.round(raw * supplyFactor(s.explore, ring, d) * luck)));
/**
 * How much a stretch of land work adds up to (#1668): `yieldOf(patch)` multiplies the haul from
 * that patch, `amount` the land's draw and what the work teaches. A usual trip is one of each.
 */
export interface RunScale { yieldOf: (p: PatchId) => number; amount: number }
const ONE_TRIP: RunScale = { yieldOf: () => 1, amount: 1 };

/** What an ordinary day of ice fishing brings in, near camp (#1315). */
export const FISH_CATCH = 3;
/** Gathering stones (#1816): a little shorter than quarrying's 5 hours. */
const GATHER_STONE_HOURS = 4;
/** Camp sites where loose stone lies near camp (#1816): the riverbed's cobbles, the hill's scree. */
export const LOOSE_STONE_SITES: readonly SiteId[] = ['river', 'hill'];
/** +2 from a find already made here. */
const findBonus = (s: Region1State, ring: Ring, d: Domain): number => (hasFind(s.explore, ring, d) ? 2 : 0);

// ── Crafting (src/artificer/crafting.ts) ────────────────────────────────────
//
// Region 1 has no item-level inventory yet, so its crafts are paid in its own
// store units (mostly "materials") and output real registry items. The
// crafting module does the rest: grade, failure + salvage, concept insight.

/** Region 1's craftable tools, as CraftRecipes whose inputs are Store keys. */
export const REGION1_RECIPES: Readonly<Record<'knife' | 'snare' | 'waterskin' | 'bedroll' | 'shovel', CraftRecipe>> = {
  knife: { id: 'stone-knife', name: 'Stone knife', inputs: [{ item: 'materials', qty: 2 }], output: { item: 'stone-knife', qty: 1 }, tier: 0, station: null, timeBase: 3, concepts: ['sharpening'] },
  snare: { id: 'trap-snare', name: 'Snare', inputs: [{ item: 'materials', qty: 2 }], output: { item: 'trap-snare', qty: 1 }, tier: 0, station: null, timeBase: 3, concepts: ['tension', 'leverage'] },
  waterskin: { id: 'waterskin', name: 'Waterskin', inputs: [{ item: 'materials', qty: 1 }, { item: 'hides', qty: 1 }], output: { item: 'waterskin', qty: 1 }, tier: 0, station: null, timeBase: 4, concepts: ['sealing'] },
  bedroll: { id: 'bedroll', name: 'Bedroll', inputs: [{ item: 'materials', qty: 3 }], output: { item: 'bedroll', qty: 1 }, tier: 0, station: null, timeBase: 5 },
  shovel: { id: 'crude-shovel', name: 'Crude shovel', inputs: [{ item: 'materials', qty: 2 }], output: { item: 'crude-shovel', qty: 1 }, tier: 1, station: null, timeBase: 3, concepts: ['leverage'] },
};

/** Carrying gear (#1294): it eases how awkward a load is, never how much you can lift (see load.ts). */
export const GEAR_RECIPES: Readonly<Record<'basket' | 'backpack' | 'harness' | 'sled', CraftRecipe>> = {
  basket: { id: 'basket', name: 'Basket', inputs: [{ item: 'materials', qty: 2 }], output: { item: 'basket', qty: 1 }, tier: 0, station: null, timeBase: 3, concepts: ['weaving'] },
  backpack: { id: 'backpack', name: 'Backpack', inputs: [{ item: 'hides', qty: 1 }, { item: 'materials', qty: 2 }], output: { item: 'backpack', qty: 1 }, tier: 0, station: null, timeBase: 4, concepts: ['sealing'] },
  harness: { id: 'harness', name: 'Harness', inputs: [{ item: 'hides', qty: 1 }, { item: 'materials', qty: 1 }], output: { item: 'harness', qty: 1 }, tier: 0, station: null, timeBase: 3, concepts: ['tension'] },
  sled: { id: 'sled', name: 'Sled', inputs: [{ item: 'materials', qty: 5 }], output: { item: 'sled', qty: 1 }, tier: 0, station: null, timeBase: 5, concepts: ['leverage'] },
};

/**
 * The gear active hunting and fishing need (#1821, `hunting-gear`): a sling (cord and a stone pouch,
 * an early craft), a bow (wood and cord, once you know hunting well enough), a hook and line (a bone
 * or wood hook on a cord). Known from the start with the switch on, the bow hidden until its level.
 */
export const HUNTING_RECIPES: Readonly<Record<'sling' | 'bow' | 'hookline', CraftRecipe>> = {
  sling: { id: SLING, name: 'Sling', inputs: [{ item: 'materials', qty: 2 }], output: { item: SLING, qty: 1 }, tier: 0, station: null, timeBase: 2, concepts: ['tension'] },
  bow: { id: BOW, name: 'Bow', inputs: [{ item: 'materials', qty: 3 }, { item: 'sinew', qty: BOW_SINEW }], output: { item: BOW, qty: 1 }, tier: 0, station: null, timeBase: 5, concepts: ['tension', 'leverage'] },
  hookline: { id: HOOK_LINE, name: 'Hook and line', inputs: [{ item: 'materials', qty: 1 }], output: { item: HOOK_LINE, qty: 1 }, tier: 0, station: null, timeBase: 2, concepts: ['sharpening'] },
};

/** The cold pit (#1295): a stone-lined pit that keeps raw food cold (and, with `cold-pit-slows`, #1757, slows the rot rather than stopping it). Dug at camp, it stays there. */
export const COLD_PIT_RECIPE: CraftRecipe = { id: 'cold-pit', name: 'Cold pit', inputs: [{ item: 'stone', qty: 4 }, { item: 'materials', qty: 2 }], output: { item: 'cold-pit', qty: 1 }, tier: 0, station: null, timeBase: 4 };

const shelterRecipe = (id: string, name: string, tier: number, inputs: CraftRecipe['inputs'], timeBase: number, vigorRate = -3.5): CraftRecipe =>
  ({ id, name, inputs, output: { item: id, qty: 1 }, tier, station: null, timeBase, concepts: ['joinery'], effort: { vigorRate, clarityRate: -1.5 } });

/**
 * First stage: the roof. A lean-to is quick and cheap; a brush hut costs more
 * and holds more heat. Both are tier-0 work (you can raise them in the field).
 */
export const SHELTER_TYPES: Readonly<Record<ShelterType, { name: string; factor: number; recipe: CraftRecipe }>> = {
  leanto: { name: 'Lean-to', factor: 0.65, recipe: shelterRecipe('shelter-leanto', 'Lean-to', 0, [{ item: 'materials', qty: BUILD_COST[0] }], 8) },
  hut: { name: 'Brush hut', factor: 0.75, recipe: shelterRecipe('shelter-hut', 'Brush hut', 0, [{ item: 'materials', qty: 5 }], 11) },
};

/**
 * Second stage: winterizing. Stone banked against the walls stores the fire's
 * heat; it needs quarried stone and a heavier day. Tier-1 work: needs the roof.
 */
export const WALL_TYPES: Readonly<Record<WallMaterial, { name: string; factor: number; recipe: CraftRecipe }>> = {
  timber: { name: 'Timber walls', factor: 1, recipe: shelterRecipe('shelter-timber', 'Timber walls', 1, [{ item: 'materials', qty: BUILD_COST[1] }], 8) },
  stone: { name: 'Stone-banked walls', factor: 1.1, recipe: shelterRecipe('shelter-stone', 'Stone-banked walls', 1, [{ item: 'materials', qty: 2 }, { item: 'stone', qty: 4 }], 10, -4) },
};

const isShelterType = (v: string | undefined): v is ShelterType => v === 'leanto' || v === 'hut';
const isWall = (v: string | undefined): v is WallMaterial => v === 'timber' || v === 'stone';
const isSite = (v: string | undefined): v is SiteId => v !== undefined && v in SITES;

/**
 * Where and what a build would make, given the choices: the target site
 * (defaults to camp), the tier it starts from there (0 if it means moving),
 * and the recipe for the next stage.
 */
export function planBuild(s: Region1State, opts: ActionOpts): { site: SiteId | null; moving: boolean; fromTier: Tier; recipe: CraftRecipe | null } {
  // With camp as an action (#1732) a build is always at camp: moving is the Make camp action's.
  const site = isSite(opts.site) && !campAsActionOn(s) ? opts.site : s.site;
  const moving = site !== null && site !== s.site;
  const fromTier: Tier = moving ? 0 : s.tier;
  const recipe = fromTier === 0 ? SHELTER_TYPES[isShelterType(opts.type) ? opts.type : 'leanto'].recipe
    : fromTier === 1 ? WALL_TYPES[isWall(opts.walls) ? opts.walls : 'timber'].recipe : null;
  return { site, moving, fromTier, recipe };
}

/**
 * What a stage of shelter would do, for its option's note: the share of the site's ceiling it
 * holds ("holds 65%"), or with `built-warmth` (#1763) how warm it would make camp there, soundly
 * built ("about 80% warm here"), since the site no longer caps it.
 */
function stageNote(s: Region1State, site: SiteId | null, built: Pick<Region1State, 'tier' | 'shelter'>, factor: number): string {
  if (!builtWarmthOn(s) || !site) return `holds ${Math.round(factor * 100)}%`;
  return `about ${Math.round(warmth({ ...s, site, ...built, shelterGrade: 'sound' }) * 100)}% warm here`;
}

const costNote = (r: CraftRecipe): string => `${r.inputs.map(i => `${i.qty} ${i.item}`).join(' + ')} · ${r.timeBase}h`;

/** Build shelter's decisions: where, and (per stage) what kind. Only real choices are returned. */
function buildOptions(s: Region1State, opts: ActionOpts): OptionGroup[] {
  const plan = planBuild(s, opts);
  const groups: OptionGroup[] = [];
  const knowsLand = scouted(s.explore, 1);
  if (!campAsActionOn(s)) groups.push({
    key: 'site', label: 'Location', value: plan.site,
    choices: (Object.keys(SITES) as SiteId[]).map(id => ({
      value: id, label: SITES[id].name,
      // With `built-warmth` (#1763) a site is said by its natural shelter and what it needs, not a ceiling.
      note: `${builtWarmthOn(s) ? siteShelterText(id) : `up to ${Math.round(SITES[id].warmth * 100)}% warm`}${s.site && id !== s.site && s.tier > 0 ? ' · leaves your shelter behind' : id === s.site ? ' · your camp' : ''}`,
      blocked: knowsLand ? null : 'scout first',
    })),
  });
  if (plan.fromTier === 0) {
    groups.push({
      key: 'type', label: 'Shelter type', value: isShelterType(opts.type) ? opts.type : 'leanto',
      choices: (Object.keys(SHELTER_TYPES) as ShelterType[]).map(t => ({ value: t, label: SHELTER_TYPES[t].name, note: `${costNote(SHELTER_TYPES[t].recipe)} · ${stageNote(s, plan.site, { tier: 1, shelter: { type: t, walls: null } }, SHELTER_TYPES[t].factor)}`, blocked: knows(s, SHELTER_TYPES[t].recipe) ? null : 'not yet discovered' })),
    });
  } else if (plan.fromTier === 1) {
    groups.push({
      key: 'walls', label: 'Wall material', value: isWall(opts.walls) ? opts.walls : 'timber',
      choices: (Object.keys(WALL_TYPES) as WallMaterial[]).map(w => ({ value: w, label: WALL_TYPES[w].name, note: `${costNote(WALL_TYPES[w].recipe)} · ${stageNote(s, plan.site, { tier: 2, shelter: { ...s.shelter, walls: w } }, WALL_TYPES[w].factor)}`, blocked: knows(s, WALL_TYPES[w].recipe) ? null : 'not yet discovered' })),
    });
  }
  return groups.filter(g => g.choices.length > 1);
}

// ── Make camp (#1732, `camp-as-action`) ─────────────────────────────────────

/** The site a Make camp entry is for: the one chosen, or (none chosen) the action's default. Undefined: none it can be. */
const chosenSpot = (s: Region1State, opts: ActionOpts) => (opts.spot ? knownSpot(s, opts.spot) : defaultSpot(s));

/** Why camp can't be made there now, or null. */
function campGate(s: Region1State, opts: ActionOpts): string | null {
  if (opts.spot) {
    const p = knownSpot(s, opts.spot);
    if (!p) return "you don't know of a place to camp there";
    return p.here ? "you're camped here already" : null;
  }
  return defaultSpot(s) ? null : 'you know no other place to camp yet — explore first';
}

/**
 * The sites you know, as the action's decision: each by name, direction and walking time, and what
 * you can tell of it. With `camp-builds-per-site`, and a cold pit here with raw food for it, a second
 * decision: take the pit's food with you (the default) or leave it in the pit (#1753).
 */
function campOptions(s: Region1State, opts: ActionOpts): OptionGroup[] {
  if (!campAsActionOn(s)) return [];
  const chosen = chosenSpot(s, opts);
  const pit = pitFoodChoice(s);
  const pitGroup: OptionGroup[] = pit ? [{
    key: 'pitFood', label: PIT_FOOD_TEXT.label, value: pitFoodOf(opts),
    choices: PIT_FOOD_CHOICES.map(c => ({
      value: c, label: PIT_FOOD_TEXT[c].label, blocked: null,
      note: PIT_FOOD_TEXT[c].note.replace('{n}', String(pit.n)).replace('{site}', siteAtText(pit.site)),
    })),
  }] : [];
  return [{
    key: 'spot', label: 'Where', value: chosen?.id ?? null,
    choices: knownSpots(s).map(p => {
      // How good a place you believe it is (#1756, `camp-site-ratings`): '' when poor or off.
      const rated = ratingText(s, p);
      // What's built there, and what stays behind here (#1753, `camp-builds-per-site`); off, the shelter is left for good.
      const kept = buildsPerSiteOn(s) ? moveNotes(s, p).map(n => ` · ${NOTE_TEXT[n.key].replace('{list}', buildsText(n.items ?? []))}`).join('')
        : !p.here && s.tier > 0 ? ' · leaves your shelter behind' : '';
      return {
        value: p.id, label: SITES[p.kind].name,
        note: `${p.text} · ${builtWarmthOn(s) ? siteShelterText(p.kind) : `up to ${Math.round(SITES[p.kind].warmth * 100)}% warm`}${kept} · ${siteKnowledge(s, p).text}${rated ? ` · ${rated}` : ''}`,
        blocked: p.here ? "you're camped here already" : null,
      };
    }),
  }, ...pitGroup];
}

/**
 * Keep the camp you're leaving (#1753, `camp-builds-per-site`) in `siteBuilds` by its spot id, and
 * take out the record of the camp you're going to. The pit's food comes with you (`take`, the
 * default): the pit stays, empty, with no rot owed (rot is owed by food in the pit, and the open-air
 * rate takes over for what you carry). With `leave`, the raw food the pit holds stays in it, out of
 * your stores, with the rot it owes. Returns the destination's record, if it had one, and how much
 * food was left in the pit. Mutates `next`.
 */
function keepCamp(next: Region1State, to: string, pitFood: PitFoodChoice): { back: SiteBuild | undefined; left: number } {
  const builds = { ...(next.siteBuilds ?? {}) };
  const from = next.campSpot?.at;
  if (from) {
    const here = campHere(next);
    const stash = pitFood === 'leave' ? here.pit?.food ?? 0 : 0;
    // The lid (#1857) stays on the pit you leave, and is there when you come back.
    const pit: KeptPit | null = here.pit ? { food: stash, ...(stash > 0 && next.pitRot ? { rot: next.pitRot } : {}), ...(pitLidded(next) ? { lid: true as const } : {}) } : null;
    if (here.shelter || pit) builds[from] = { left: next.day, ...(here.shelter ? { shelter: here.shelter } : {}), ...(pit ? { pit } : {}) };
    else delete builds[from];
    if (pit?.food) next.stores.rawFood -= pit.food;
  }
  const back = builds[to];
  delete builds[to];
  if (Object.keys(builds).length) next.siteBuilds = builds;
  else delete next.siteBuilds;
  return { back, left: from ? builds[from]?.pit?.food ?? 0 : 0 };
}

/**
 * The food in a cold pit you left on day `left`, back on `next.day`: it spent those nights in the pit,
 * and spoils as it would have with you there (`nightSpoilage`, by the run's seeded weather: no draws).
 */
function pitWhileAway(next: Region1State, site: SiteId, pit: KeptPit, left: number): { food: number; rot: number; spoiled: number } {
  let food = pit.food, rot = pit.rot ?? 0;
  if (feelsTemperature(next)) {
    for (let d = left; d < next.day && food > 0; d++) {
      const sp = nightSpoilage({ site, coldPitAt: site, day: d, config: next.config, stores: { ...next.stores, rawFood: food }, pitRot: rot }, nightTemp(d, weatherOn(next, d), next.config.calendar));
      food -= sp.spoiled;
      rot = sp.pitRot ?? 0;
    }
  }
  return { food, rot: food > 0 ? rot : 0, spoiled: pit.food - food };
}

/** Leave the current shelter and settle at `site` (on an already-cloned state); `pitFood`: what happens to the cold pit's food (#1753). */
function moveCamp(next: Region1State, site: SiteId, spot?: string, pitFood: PitFoodChoice = 'take'): void {
  const moved = next.site !== null && next.tier > 0;
  // Each camp keeps what's built there (#1753): only with camp as an action, where camps have spot ids.
  const keep = spot !== undefined && buildsPerSiteOn(next);
  const { back, left } = keep ? keepCamp(next, spot, pitFood) : { back: undefined, left: 0 };
  next.site = site;
  // Camp as an action (#1732): camp is a real place now, and you'll know it as it is from tonight.
  // A cold pit stays where it was dug, so a pit at the old spot doesn't follow you.
  if (spot) {
    next.campSpot = { at: spot, camped: next.campSpot?.camped.includes(spot) ? [...next.campSpot.camped] : [...(next.campSpot?.camped ?? []), spot] };
    if (next.coldPitAt) next.coldPitAt = null;
    // …and its lid (#1857) stays on it: kept with the pit in `siteBuilds` (keepCamp), if at all.
    delete next.pitLid;
  }
  // The pit's carried rot (#1757) belongs to the pit where it built up: leaving camp leaves it behind.
  delete next.pitRot;
  // The meat you'd stored (#1823) comes down with you: at the new camp it lies out until it's stored again.
  // So does the meat in the lidded pit (#1857).
  delete next.meatStored;
  delete next.meatPit;
  // …and a fire banked there (#1865) stays behind, smouldering, at a camp you've left.
  delete next.banked;
  next.siteDay = next.day;
  next.tier = 0;
  next.shelterGrade = null;
  next.shelter = { type: null, walls: null };
  say(next, `Chose the ${SITES[site].name.toLowerCase()} as your ground${moved ? ' — the old shelter is left behind' : ''}.`, 'action');
  if (left > 0) say(next, `You leave ${left} raw food in the cold pit.`, 'action');
  if (back?.shelter) {
    // The shelter you built here still stands, a grade worse for every WEATHER_DAYS away (never below crude).
    const grade = weathered(back.shelter.grade, weatherSteps(next.day - back.left));
    next.tier = back.shelter.tier;
    next.shelterGrade = grade;
    next.shelter = { type: back.shelter.type, walls: back.shelter.walls, ...(back.shelter.sited ? { sited: true } : {}) };
    say(next, grade === back.shelter.grade ? 'Your shelter here still stands.' : 'Your shelter here still stands, a little weathered.', 'action');
  } else if (hasKit(next, 'tarp')) {
    // The patrol's tarp (#1400) goes up wherever you camp: a crude lean-to roof, no tree felled.
    next.tier = 1;
    next.shelterGrade = 'crude';
    next.shelter = { type: 'leanto', walls: null };
    say(next, 'You string the tarp between two trees and peg it down low — a roof, of sorts.', 'action');
  }
  if (back?.pit) {
    // The cold pit you dug here, and the food you left in it: yours again, less what went bad meanwhile.
    next.coldPitAt = site;
    // Its lid (#1857), if you'd laid one, is still on it.
    if (back.pit.lid && lidOn(next)) next.pitLid = true;
    const p = pitWhileAway(next, site, back.pit, back.left);
    if (p.spoiled > 0) {
      addTally(next, { spoiled: p.spoiled });
      say(next, `${p.spoiled} raw food in the cold pit went bad while you were away.`, 'hardship');
    }
    if (p.food > 0) {
      next.stores.rawFood += p.food;
      if (p.rot > 0 && featureOn(next.config.world.features, 'cold-pit-slows')) next.pitRot = p.rot;
      say(next, `You take ${p.food} raw food back out of the cold pit.`, 'action');
    } else if (!p.spoiled) say(next, 'The cold pit here is as you left it.', 'action');
  }
}

/** Cold-weather gear: fine work for the mind. A graded tool that unlocks winter travel. */
export const COLD_GEAR_RECIPE: CraftRecipe = {
  id: 'cold-gear', name: 'Cold gear', inputs: [{ item: 'materials', qty: 3 }], output: { item: 'cold-gear', qty: 1 },
  tier: 0, station: null, timeBase: 6, concepts: ['weaving'], effort: { vigorRate: -1.5, clarityRate: -5 },
};

const STORE_KEYS = ['rawFood', 'water', 'firewood', 'materials', 'rations', 'stone', 'hides'] as const;
// Region 1's own item on top of the registry defaults: cold gear lets you travel in winter.
// Carrying gear (#1294) does its work in load.ts, but it's still a graded tool you own — so it gets an (empty) effects entry.
export const CRAFT_WORLD = craftWorld([], conceptsRegistry.concepts as ConceptDef[], {
  ...DEFAULT_EFFECTS, 'cold-gear': { unlock: ['winter-travel'] }, 'hide-parka': { unlock: ['winter-travel'] },
  basket: { unlock: ['carry'] }, backpack: { unlock: ['carry'] }, harness: { unlock: ['carry'] }, sled: { unlock: ['carry'] },
  // The hunting and fishing gear (#1821): what it opens is region1's (`huntTool`, `fishLocked`); the entries make them tools.
  [SLING]: { unlock: ['hunt-small'] }, [BOW]: { unlock: ['hunt-small', 'hunt-deer'] }, [HOOK_LINE]: { unlock: ['fish-line'] },
});

/** Sound cold gear: you have some, and it isn't crude (crude gear won't hold up through a winter). */
const roadworthyGear = (tools: readonly Tool[]): boolean =>
  tools.some(t => (t.item === 'cold-gear' && t.grade !== 'crude') || t.item === 'hide-parka');

/** Cold gear from hides: heavier on materials you hunt for, but hide holds the cold even when the work is crude. */
export const HIDE_PARKA_RECIPE: CraftRecipe = {
  id: 'hide-parka', name: 'Hide parka', inputs: [{ item: 'materials', qty: 1 }, { item: 'hides', qty: 2 }], output: { item: 'hide-parka', qty: 1 },
  tier: 0, station: null, timeBase: 6, concepts: ['sealing'], effort: { vigorRate: -1.5, clarityRate: -5 },
};
const coldGearRecipe = (o: ActionOpts): CraftRecipe => (o.material === 'hide' ? HIDE_PARKA_RECIPE : COLD_GEAR_RECIPE);

/** An option group, offered only when it's a real choice. */
const choiceGroup = (key: string, label: string, value: string, choices: OptionChoice[]): OptionGroup => ({ key, label, value, choices });

/** Hours to one decimal, for notes. */
const hrs1 = (h: number): string => String(Math.round(h * 10) / 10);
/** A store in the words the journal uses. */
const STORE_WORD: Readonly<Record<keyof Stores, string>> = { rawFood: 'food', water: 'water', firewood: 'firewood', materials: 'materials', rations: 'rations', stone: 'stone', hides: 'hides' };

/**
 * The length choices of an open-ended gathering action (#1668): how long (the usual trip, 1-4
 * hours walks included, or the rest of the day) and "until you have N" of its main store. None
 * with the `action-length` switch off, so the action offers what it always did: nothing.
 */
function lengthOptions(id: LengthAction): (s: Region1State, opts: ActionOpts, ring?: Ring) => OptionGroup[] {
  return (s, o, at) => {
    if (!featureOn(s.config.world.features, 'action-length')) return [];
    // Without a ring (the AI's list of actions), the notes speak for any ring.
    const ring = at ?? 1;
    const { work, travel } = actionHours(s, id, ring, {});
    const rest = Math.max(0, DAY_HOURS - s.hoursToday);
    const store = MAIN[id].store, word = STORE_WORD[store];
    const timed = o.hours !== undefined && o.hours !== 'usual';
    return [
      choiceGroup('hours', 'Length', o.hours ?? 'usual', [
        { value: 'usual', label: at === undefined ? 'Usual' : `Usual (${hrs1(work + travel)}h)`, note: 'one trip, as always', blocked: null },
        ...HOUR_CHOICES.filter(h => h !== 'day').map(h => ({
          value: h, label: `${h}h`, blocked: null,
          note: at === undefined ? `${h}h, walks included: trips out and back, as many as the time and your load allow`
            : travel > 0 ? `${h}h walks included, ${hrs1(travel)}h there and back each trip` : `${h}h of work, as many trips as it takes to carry`,
        })),
        { value: 'day', label: 'Rest of day', note: `${hrs1(rest)}h left today`, blocked: null },
      ]),
      choiceGroup('until', 'Until you have', o.until ?? 'none', [
        { value: 'none', label: 'No target', note: 'stop when the time is up', blocked: null },
        ...UNTIL_CHOICES.map(n => ({
          value: n, label: `${n} ${word}`, note: `stop at ${n} ${word}, or when the ${timed ? 'time is up' : 'day ends'}`,
          blocked: s.stores[store] >= Number(n) ? `you have ${s.stores[store]} already` : null,
        })),
      ]),
    ];
  };
}

/** View a Region 1 state as a crafter: stores are the inventory, the shelter is the bench. */
function crafterOf(s: Region1State): CrafterState {
  return createCrafter(s.vitals, {
    // Sinew (#1821) is the crafter's too with `hunting-gear` on, for the bow's string; off, the inventory is as it was.
    inventory: huntingGearOn(s) ? { ...s.stores, sinew: sinewOf(s) } : { ...s.stores },
    tools: s.tools,
    concepts: s.concepts,
    // Region 1's shelter is the first workbench (crafting design §6–7).
    bench: { tier: s.tier >= 1 ? 1 : 0, stations: [] },
  });
}

// ── Discovery (crafting design §5) ──────────────────────────────────────────
//
// Recipes aren't all known on day 1. A few are innate; the rest you work out
// from what you see and find — or by studying the concept behind them.

/** Recipe ids every Warden knows from the start. */
export const STARTING_RECIPES: readonly string[] = ['shelter-leanto', 'shelter-timber', 'cold-gear', 'stone-knife', 'bedroll'];

/** How each other recipe is discovered: an observation/find, or rank 1 in its concept. */
export const DISCOVERIES: readonly { recipe: string; name: string; concept: string; trigger: (s: Region1State) => boolean; how: string }[] = [
  { recipe: 'trap-snare', name: 'Snare', concept: 'tension', trigger: s => gameTracked(s), how: 'watching the game trails, you see how a snare would hold' },
  { recipe: 'shelter-hut', name: 'Brush hut', concept: 'joinery', trigger: s => level(s.explore, 1, 'forage') >= 2, how: 'knowing where the brush grows thick, you can see a hut in it' },
  { recipe: 'shelter-stone', name: 'Stone-banked walls', concept: 'joinery', trigger: s => RINGS.some(r => level(s.explore, r, 'stone') >= 2), how: 'the flat stone out there would bank a wall and hold the heat' },
  { recipe: 'hide-parka', name: 'Hide parka', concept: 'sealing', trigger: s => s.flags.everHide, how: 'a fresh hide in your hands — it would turn the wind' },
  { recipe: 'waterskin', name: 'Waterskin', concept: 'sealing', trigger: s => s.flags.everHide, how: 'sewn tight, a hide would carry water' },
  { recipe: 'crude-shovel', name: 'Crude shovel', concept: 'leverage', trigger: s => s.tier >= 1, how: 'digging the footings, you wanted a blade on a pole' },
  // Carrying gear (#1294): each comes from feeling the load it would ease.
  { recipe: 'basket', name: 'Basket', concept: 'weaving', trigger: s => s.flags.everFood, how: 'arms full of loose food, you see how a woven basket would hold it' },
  { recipe: 'backpack', name: 'Backpack', concept: 'sealing', trigger: s => s.flags.everHide, how: 'a hide over a frame of sticks would ride on your back' },
  { recipe: 'harness', name: 'Harness', concept: 'tension', trigger: s => s.flags.everHide && s.flags.everWood, how: 'a strap of hide across the brow would take the weight of the wood' },
  { recipe: 'sled', name: 'Sled', concept: 'leverage', trigger: s => (s.snowDepth ?? 0) > 0 || RINGS.some(r => level(s.explore, r, 'stone') >= 2), how: 'dragged, not carried — runners would take the heavy loads' },
];

/** The six concepts every Warden starts open on; the rest of the web opens by prerequisite. */
const REGION_1_CONCEPTS: readonly string[] = ['joinery', 'tension', 'sealing', 'leverage', 'sharpening', 'weaving'];

/**
 * The concepts open to study: the six Region 1 ones; any concept this Warden already has a grasp
 * of (a rank, or insight from a lesson or an heirloom — #1469); and any concept in the wider web
 * whose prerequisites they've met. One with no prerequisites that nothing has shown them
 * (friction, combustion…) stays out of reach — and the study gate refuses it, not only the menu.
 */
export const STUDY_CONCEPTS = (s: { concepts: Readonly<Record<string, ConceptProgress>> }): readonly string[] => [
  ...REGION_1_CONCEPTS,
  ...Object.values(CRAFT_WORLD.concepts)
    .filter(c => !REGION_1_CONCEPTS.includes(c.id) && (
      (s.concepts[c.id]?.rank ?? 0) > 0 || (s.concepts[c.id]?.insight ?? 0) > 0 || (c.requires?.length && conceptOpen(s.concepts, c))))
    .map(c => c.id),
];

/**
 * Why a focus can't turn this concept over now, or null (#1478): one the Warden hasn't come across
 * (the study gate's rule), or one they've mastered — the insight would go nowhere. Checked when
 * focus is set, when a save loads, on the AI's reply, and each night before insight lands.
 */
export function focusRefusal(s: { concepts: Readonly<Record<string, ConceptProgress>> }, id: string): string | null {
  if (!STUDY_CONCEPTS(s).includes(id)) return `you haven't come across ${id} yet`;
  if ((s.concepts[id]?.rank ?? 0) >= (CRAFT_WORLD.concepts[id]?.ranks ?? 3)) return `you've mastered ${id}`;
  return null;
}

/**
 * Why a focus can't be held now, or null: a concept not open or already mastered (#1478), or a
 * topic the Warden hasn't come across (#1494). One rule for every way a focus is set — the picker,
 * the road, a save, the AI.
 */
export function refusalOf(s: Acquaintance & { concepts: Readonly<Record<string, ConceptProgress>> }, focus: Focus | null): string | null {
  if (focus?.kind === 'concept') return focusRefusal(s, focus.id);
  if (isTopic(focus)) return topicsOpen(s).includes(focusKey(focus)) ? null : `you haven't come across ${focusInline(focus)} yet`;
  return null;
}

/** The concepts a focus can turn over now (#1478): open to this Warden, and not yet mastered. */
export const FOCUS_OPEN = (s: { concepts: Readonly<Record<string, ConceptProgress>> }): readonly string[] =>
  STUDY_CONCEPTS(s).filter(c => !focusRefusal(s, c));

export const knows = (s: Region1State, r: CraftRecipe): boolean => s.known.includes(r.id);
const unknownRecipe = (s: Region1State, r: CraftRecipe): string | null => (knows(s, r) ? null : `you haven't worked out how to make a ${r.name.toLowerCase()} yet`);

/** Learn anything newly discovered (on a cloned state), journalling each once. */
function latchDiscoveries(s: Region1State): void {
  for (const d of DISCOVERIES) {
    if (s.known.includes(d.recipe)) continue;
    const studied = (s.concepts[d.concept]?.rank ?? 0) >= 1;
    if (!d.trigger(s) && !studied) continue;
    s.known.push(d.recipe);
    say(s, `Worked out: ${d.name} — ${studied && !d.trigger(s) ? `your study of ${d.concept} shows the way` : d.how}.`, 'milestone');
  }
}

/** Every recipe discovery could lead to, by id: what Experiment works towards (#1690). */
const RECIPE_BY_ID: Readonly<Record<string, CraftRecipe>> = Object.fromEntries([
  ...Object.values(REGION1_RECIPES), ...Object.values(GEAR_RECIPES), ...Object.values(SHELTER_TYPES).map(t => t.recipe),
  ...Object.values(WALL_TYPES).map(t => t.recipe), HIDE_PARKA_RECIPE,
].map(r => [r.id, r]));

/** What experimenting can work out (#1690): each discovery, with what its recipe is made from. In DISCOVERIES order. */
export const EXPERIMENT_TARGETS: readonly ExperimentTarget[] = DISCOVERIES.map(d => {
  const r = RECIPE_BY_ID[d.recipe];
  return { recipe: d.recipe, name: d.name, concepts: [d.concept, ...(r?.concepts ?? []).filter(c => c !== d.concept)], skill: skillFor('build', d.recipe), inputs: r ? r.inputs.map(i => i.item) : [] };
});

/** Store keys the Warden can choose to try with (#1690): those at hand that some target is made from. */
const experimentMaterials = (s: Region1State): (keyof Stores)[] =>
  STORE_KEYS.filter(k => s.stores[k] >= 1 && EXPERIMENT_TARGETS.some(t => !s.known.includes(t.recipe) && t.inputs.includes(k)));

/**
 * Why the Warden doesn't know how to do this at all, or null (#1690): the reason an action is
 * **hidden** rather than greyed out. The two new actions don't exist with the switch off; with it
 * on, an exploring sub-action not yet learned (#1689), or a craft whose recipe isn't worked out.
 * The circumstances (a missing tool, materials, the dark, the weather) are `blockedReason`'s.
 */
export function skillLockOf(s: Region1State, id: ActionId, opts: ActionOpts = {}): string | null {
  if (id === 'camp') return campAsActionOn(s) ? null : "camp isn't part of this game's rules";
  if (id === 'drawmap') return mapLearningOn(s) && descriptiveMapOn(s) ? null : "drawmap isn't part of this game's rules";
  if (id === 'explore' || id === 'experiment') return visibilityOn(s) ? null : `${id} isn't part of this game's rules`;
  // Gather stones first, quarry once you know the cleave (#1816): its own switch, whatever `action-visibility` says.
  if (id === 'gatherstone') return stoneGatheringOn(s) ? null : `${id} isn't part of this game's rules`;
  if (id === 'quarry' && quarryLocked(s)) return `you don't know how to ${QUARRY_UNLOCK.verb} yet — ${QUARRY_UNLOCK.how} (${SKILLS.stonework.name})`;
  // Traps first; hunting needs a sling or a bow, fishing a hook and line (#1821): its own switch, whatever `action-visibility` says.
  if (id === 'traps' || id === 'sling' || id === 'bow' || id === 'hookline') {
    if (!huntingGearOn(s)) return `${id} isn't part of this game's rules`;
    return id === 'bow' && !bowReady(s) ? `you don't know how to ${BOW_UNLOCK.verb} yet — ${BOW_UNLOCK.how} (${SKILLS.hunting.name})` : null;
  }
  // Store the meat (#1823): its own switch, whatever `action-visibility` says.
  if (id === 'storemeat') return scavengersOn(s) ? null : `${id} isn't part of this game's rules`;
  // Lid the cold pit (#1857): its own switch (with `camp-scavengers`), whatever `action-visibility` says.
  if (id === 'lidpit') return lidOn(s) ? null : `${id} isn't part of this game's rules`;
  // Bank the fire (#1865): its own switch (on top of `camp-scavengers`), whatever `action-visibility` says.
  if (id === 'bankfire') return bankedFireOn(s) ? null : `${id} isn't part of this game's rules`;
  // Make a needle compass (#1868): its own switch, and no need of it with the real compass packed.
  if (id === 'needlecompass') return needleLock(s);
  if (id === 'hunt' && huntLocked(s)) return `you don't know how to ${HUNT_UNLOCK.verb} yet — ${HUNT_UNLOCK.how} (${SKILLS.hunting.name})`;
  if (id === 'fish' && fishLocked(s)) return `you don't know how to ${FISH_UNLOCK.verb} yet — ${FISH_UNLOCK.how} (${SKILLS[skillFor('fish') ?? 'fieldcraft'].name})`;
  if (!visibilityOn(s)) return null;
  const sub = subActionLock(id, s);
  if (sub) return ringWordsFor(s, sub);
  // Cold gear's default is woven fiber, which every Warden knows; its hide option is a choice inside it.
  // Anyone can dig a cold pit: it has a recipe for its costs, but nothing to work out.
  if (id === 'coldPit') return null;
  const recipe = id === 'coldGear' ? coldGearRecipe(opts) : ACTIONS[id].recipe;
  return recipe ? unknownRecipe(s, recipe) : null;
}

/**
 * Gate for a craft action. The extra gate goes first (a hide needs a hunt),
 * then "you already have a good one", then the crafting module's own checks.
 * A crude tool can be remade; anything sound or better is kept.
 */
const craftGate = (r: CraftRecipe, extra?: (s: Region1State) => string | null) => (s: Region1State, _ring?: Ring): string | null => {
  const unknown = unknownRecipe(s, r);
  if (unknown) return unknown;
  const pre = extra?.(s) ?? null;
  if (pre) return pre;
  // An heirloom (#1455) doesn't count: making your own is how you learn, and the line shouldn't freeze at what the first Warden made.
  const owned = s.tools.find(t => t.item === r.output.item && !t.heirloom && GRADES.indexOf(t.grade) >= GRADES.indexOf('sound'));
  if (owned) return `you already have a ${owned.grade} ${r.name.toLowerCase()}`;
  return craftBlocker(crafterOf(s), r);
};

/** One craft definition for the ACTIONS table: its gate and costs come from the recipe. */
const craftAction = (r: CraftRecipe, extra?: (s: Region1State) => string | null): ActionDef => ({
  name: `Craft ${r.name.toLowerCase()}`, hours: r.timeBase, vigorRate: 0, clarityRate: 0,
  gate: craftGate(r, extra), recipe: r, run: () => '',
});

/**
 * A craft of hunting or fishing gear (#1821): known with the switch on, so no recipe to work out
 * (`skillLockOf` hides the bow until its level); otherwise as any craft — one good one is enough.
 */
const gearCraft = (r: CraftRecipe): ActionDef => ({
  ...craftAction(r),
  gate: s => {
    const owned = s.tools.find(t => t.item === r.output.item && !t.heirloom && GRADES.indexOf(t.grade) >= GRADES.indexOf('sound'));
    if (owned) return `you already have a ${owned.grade} ${r.name.toLowerCase()}`;
    // The bow's string is sinew (#1821): said plainly, before the generic missing-input line.
    const sinew = r.inputs.find(i => i.item === 'sinew')?.qty ?? 0;
    return sinewOf(s) < sinew ? NEED_SINEW : craftBlocker(crafterOf(s), r);
  },
});

/** Make camp's pull on Vigor per hour (#1732), named so a heavy pack's walk there (#1871) can add to it. */
const CAMP_VIGOR_RATE = -2.5;

export const ACTIONS: Readonly<Record<ActionId, ActionDef>> = {
  scout: {
    name: 'Scout', hours: 4, vigorRate: -3.5, clarityRate: -1, ringed: true, gate: reach,
    run: (s, _b, r, _o, light) => {
      if (tooDarkToSee('scout', light)) return tooDark(r);
      if (blindInFog(s.weatherToday, 'scout')) return fogged(r);
      s.explore = scout(s.explore, r);
      return r === 1 ? 'Scouted the near ground — you can see where food, water, wood and stone lie.'
        : r === 2 ? 'Pushed out to the far ring — new forage and timber, and paths leading on.'
          : 'Reached the distant hills — and glimpsed the pass out of the Reach.';
    },
  },
  survey: {
    name: 'Survey', hours: 7, vigorRate: -2, clarityRate: -5, ringed: true, gate: reach,
    run: (s, _b, r, _o, light) => {
      if (tooDarkToSee('survey', light)) return tooDark(r);
      if (blindInFog(s.weatherToday, 'survey')) return fogged(r);
      s.explore = survey(s.explore, r); return `Surveyed carefully${where(r)} — every trip there yields more now.`;
    },
  },
  track: {
    name: 'Track', hours: 4, vigorRate: -3, clarityRate: -2.5, ringed: true, gate: reach,
    run: (s, _b, r) => { s.explore = track(s.explore, r); return `Tracked a deer herd${where(r)} — you can hunt there.`; },
  },
  gather: {
    name: 'Gather food', hours: 5, vigorRate: -3.5, clarityRate: -1, ringed: true, gate: reach, options: lengthOptions('gather'),
    run: (s, b, r, _o, light, luck, sc) => {
      const blind = level(s.explore, r, 'forage') === 0;
      // In poor light you miss most of what's there (#1281).
      // …and snow cover buries what's left (#1306): deep snow, almost nothing to find.
      const n = scaleHaul(haul(s, r, 'forage', landYield(s.explore, r, 'forage', 3, 2) + b, luck * sc.yieldOf('berries')), darkYieldMult('gather', light) * snowBuries(s));
      const note = workLand(s, r, 'forage', sc.amount);
      const fiber = findBonus(s, r, 'forage');
      s.stores.rawFood += n; s.stores.materials += fiber; s.flags.everFood = true;
      return `${blind ? 'Wandered, not knowing where to look — gathered' : 'Gathered'} ${n} raw food${fiber ? ` and ${fiber} fiber` : ''}${where(r)}.${note}${dimNote(light)}`;
    },
  },
  hunt: {
    name: 'Hunt', hours: 5, vigorRate: -4, clarityRate: -2, ringed: true,
    // Deer need tracking (game observed); small game only needs to be known to be about.
    // With `hunting-gear` (#1821) a sling takes small game only: deer need a bow (and small game is the sling's default).
    gate: (s, r, o) => reach(s, r) ?? (huntTarget(s, o) === 'small'
      ? (level(s.explore, r, 'game') >= 1 ? null : `you haven't seen any game${where(r) || ' nearby'}`)
      : huntingGearOn(s) && huntTool(s) !== 'bow' ? 'deer need a bow — a sling is for small game'
        : (level(s.explore, r, 'game') >= 2 ? null : `no game tracked${where(r) || ' nearby'} yet`)),
    variant: (o, s) => (huntTarget(s, o) === 'small' ? { hours: 3, vigorRate: -2.5, clarityRate: -1.5 } : {}),
    options: (s, o) => [choiceGroup('target', 'Quarry', huntTarget(s, o), [
      { value: 'deer', label: 'Deer', note: '5h · ~7 food + a hide · needs tracking', blocked: huntingGearOn(s) && huntTool(s) !== 'bow' ? 'needs a bow' : null },
      { value: 'small', label: 'Small game', note: '3h · ~3 food · lighter · no tracking needed', blocked: null },
    ])],
    run: (s, b, r, o, _light, luck) => {
      const small = huntTarget(s, o) === 'small';
      const n = haul(s, r, 'game', (small ? landYield(s.explore, r, 'game', 3, 1) : landYield(s.explore, r, 'game', 7, 0)) + b + findBonus(s, r, 'game'), luck);
      const note = workLand(s, r, 'game');
      s.stores.rawFood += n; s.flags.everFood = true; s.flags.everHunt = true;
      // An empty hunt brings no deer down, so no hide either.
      if (!small && n > 0) { s.stores.hides += 1; s.flags.everHide = true; }
      if (n === 0) return `Hunted ${small ? 'small game' : 'deer'}${where(r)} and took nothing.${note}`;
      // Sinew from the catch (#1821, `hunting-gear`): no draw of its own, it follows from the kill.
      const sinew = huntingGearOn(s) ? addSinew(s, small ? SINEW_SMALL : SINEW_DEER) : 0;
      return (small ? `Took small game${where(r)} — ${n} raw food.${note}` : `Brought down a deer${where(r)} — ${n} raw food and a hide.${note}`) + sinewNote(sinew);
    },
  },
  water: {
    name: 'Fetch water', hours: 2, vigorRate: -3, clarityRate: -0.5, ringed: true,
    // Frozen hard (#1303), the only water is snow melted over a fire.
    gate: (s, r) => reach(s, r) ?? (melting(s) && s.stores.firewood < MELT_FIREWOOD ? 'the streams are frozen hard, and there is no firewood to melt snow' : null),
    // Once the streams ice over you break through to the water first (#1283); frozen hard, you melt snow instead (#1303).
    variant: (_o, s) => (s && feelsTemperature(s) && iceOn(s.day, s.config.calendar) ? { hours: 2 + ICE_EXTRA_HOURS } : {}),
    options: lengthOptions('water'),
    run: (s, b, r, _o, _light, luck, sc) => {
      const n = haul(s, r, 'water', landYield(s.explore, r, 'water', 4, 1) + (s.site === 'river' && r === 1 ? 2 : 0) + b + findBonus(s, r, 'water'), luck * sc.yieldOf('spring'));
      const note = workLand(s, r, 'water', sc.amount);
      const melt = melting(s);
      // A longer session (#1668) melts more snow, and burns wood in proportion — as far as the woodpile goes.
      const burn = sc.amount === 1 ? MELT_FIREWOOD : Math.min(s.stores.firewood, Math.max(MELT_FIREWOOD, Math.round(MELT_FIREWOOD * sc.amount)));
      if (melt) s.stores.firewood -= burn;
      s.stores.water += n; s.flags.everWater = true;
      return melt ? `Melted ${n} water from snow${where(r)} (${burn} firewood).${note}` : `Fetched ${n} water${where(r)}.${note}`;
    },
  },
  wood: {
    name: 'Gather wood', hours: 4, vigorRate: -4, clarityRate: -1, ringed: true, gate: reach, options: lengthOptions('wood'),
    // `b` (skill, tools, focus, techniques) adds to the firewood — it used to be ignored here (#1243).
    // Firewood is the deadfall and materials the standing timber (#1668): on a long session the sticks run out first.
    run: (s, b, r, _o, light, luck, sc) => {
      const dim = darkYieldMult('wood', light);
      const f = scaleHaul(haul(s, r, 'timber', landYield(s.explore, r, 'timber', 4, 1) + (s.site === 'tree' && r === 1 ? 1 : 0) + findBonus(s, r, 'timber') + b, luck * sc.yieldOf('deadfall')), dim);
      const m = scaleHaul(haul(s, r, 'timber', landYield(s.explore, r, 'timber', 2, 1), luck * sc.yieldOf('timber')), dim);
      const note = workLand(s, r, 'timber', sc.amount);
      s.stores.firewood += f; s.stores.materials += m; s.flags.everWood = true;
      return `Cut ${f} firewood and ${m} materials${where(r)}.${note}${dimNote(light)}`;
    },
  },
  fish: {
    name: 'Ice fishing', hours: 5, vigorRate: -2, clarityRate: -2.5, ringed: true,
    // Once the lake ice is thick enough to stand on (#1315) — open all year in the flat world.
    gate: (s, r) => reach(s, r) ?? (feelsTemperature(s) && !iceThick(s.day, s.config.calendar) ? 'the ice is too thin' : null),
    // A slow, steady catch: modest, but the lake doesn't run out the way the land does.
    // (Over a long sitting the spot itself goes quiet, #1668 — and comes back in a few days.)
    options: lengthOptions('fish'),
    run: (s, b, r, _o, light, luck, sc) => {
      // A real hook from the fishing kit (#1870) catches a little better than a whittled one.
      const hook = hasAxeFishing(s, 'fishing-kit') ? FISH_KIT_CATCH : 1;
      const n = scaleHaul(haul(s, r, 'water', (FISH_CATCH * RICHNESS[r] + b) * hook, luck * sc.yieldOf('fishing')), darkYieldMult('gather', light));
      s.stores.rawFood += n; s.flags.everFood = true;
      return n > 0 ? `Fished through the ice${where(r)} — ${n} raw food.` : `Sat over a hole in the ice${where(r)} and caught nothing.`;
    },
  },
  quarry: {
    name: 'Quarry stone', hours: 5, vigorRate: -4.5, clarityRate: -1, ringed: true, gate: reach, options: lengthOptions('quarry'),
    run: (s, b, r, _o, light, luck, sc) => {
      const n = scaleHaul(haul(s, r, 'stone', landYield(s.explore, r, 'stone', 3, 1) + findBonus(s, r, 'stone') + b, luck * sc.yieldOf('stone')), darkYieldMult('quarry', light));
      const note = workLand(s, r, 'stone', sc.amount);
      s.stores.stone += n;
      return `Broke out ${n} stone${where(r)}.${note}${dimNote(light)}`;
    },
  },
  // Picking loose stone off the ground, out of the riverbed and the scree (#1816, `stone-gathering`):
  // lighter and a little shorter than quarrying, and about half its stone at the same place. More
  // where loose stone lies: camped on the riverbank or the hill, the near ground gives +1 (as a
  // treeline camp does for wood). A known flint seam gives half its find; the luck, the supply and
  // the stone patch are quarrying's, so it draws on nothing new.
  gatherstone: {
    name: 'Gather stones', hours: GATHER_STONE_HOURS, vigorRate: -3, clarityRate: -0.5, ringed: true, gate: reach, options: lengthOptions('gatherstone'),
    run: (s, b, r, _o, light, luck, sc) => {
      const loose = r === 1 && s.site !== null && LOOSE_STONE_SITES.includes(s.site) ? 1 : 0;
      const n = scaleHaul(haul(s, r, 'stone', landYield(s.explore, r, 'stone', 1.5, 0.5) + loose + findBonus(s, r, 'stone') / 2 + b, luck * sc.yieldOf('stone')), darkYieldMult('gatherstone', light));
      const note = workLand(s, r, 'stone', sc.amount);
      s.stores.stone += n;
      return `Gathered ${n} stone${where(r)}.${note}${dimNote(light)}`;
    },
  },
  preserve: {
    name: 'Preserve food', hours: 4, vigorRate: -1, clarityRate: -4.5,
    gate: s => needsScout(s) ?? (s.stores.rawFood >= 2 ? null : 'not enough raw food to preserve'),
    variant: o => (o.method === 'dry' ? { hours: 2, clarityRate: -2 } : {}),
    options: (_s, o) => [choiceGroup('method', 'Method', o.method ?? 'smoke', [
      { value: 'smoke', label: 'Smoke', note: '4h · meat or fish · up to 3 rations · careful work', blocked: null },
      { value: 'dry', label: 'Air-dry', note: '2h · up to 2 rations · easy on the mind', blocked: null },
    ])],
    run: (s, _b, _r, o) => {
      // Two raw food cure down to one ration; smoking does up to three a session, drying two.
      const dry = o.method === 'dry';
      const made = Math.min(dry ? 2 : 3, Math.floor(s.stores.rawFood / 2));
      // The meat is cured first (#1823, `camp-scavengers`): smoked or dried, nothing comes for it.
      if (scavengersOn(s)) takeMeat(s, Math.min(made * 2, meatOf(s)), false);
      s.stores.rawFood -= made * 2; s.stores.rations += made; s.flags.everPreserve = true;
      // No salt in the wild (#1860): nothing in the kit or the land gives it, so the wild's own
      // preserving is smoked or air-dried, never salted. Salt is Saltmere's and the caravans'.
      return `${dry ? 'Air-dried' : 'Smoked'} ${made * 2} food into ${made} winter ration${made === 1 ? '' : 's'}.`;
    },
  },
  // Make camp (#1732, `camp-as-action`): an action like any other, at a site you know, a real place on
  // the Reach. It takes the walk there from where you are, then the setting up.
  camp: {
    name: 'Make camp', hours: CAMP_SETUP_HOURS, vigorRate: CAMP_VIGOR_RATE, clarityRate: -0.5,
    gate: (s, _r, o) => campGate(s, o),
    options: (s, o) => campOptions(s, o),
    variant: (o, s) => (s && campAsActionOn(s) ? campVariant(s, o) : {}),
    // moveCamp writes the journal's lines ("Chose the … as your ground", the tarp), so the action adds none.
    run: (s, _b, _r, o) => {
      const spot = chosenSpot(s, o);
      // The cold pit's food comes with you unless the entry says `pitFood: 'leave'` (#1753).
      if (spot) moveCamp(s, spot.kind, spot.id, pitFoodOf(o));
      // Wherever you walked from (#1839), you're at camp now.
      if (spot) backAtCamp(s);
      return '';
    },
  },
  // Draw your map (#1754, `map-learning`): once a few nights have passed and enough places are found
  // in enough directions, with something to draw on, you sit down at camp and place what you found.
  // On the page a placement session comes first (map-learning.ts); the AI's Warden draws from what it knows.
  drawmap: {
    name: 'Draw your map', hours: MAP_DRAW_HOURS, vigorRate: 0, clarityRate: -1.5,
    gate: s => drawMapGate(s),
    // The journal's "you have a map of your own now" follows (the milestone below, descriptive-map.ts mapDrawnLine).
    run: s => {
      s.mapLearned = true;
      return PLACED_LINE;
    },
  },
  build: {
    name: 'Build shelter', hours: 8, vigorRate: -3.5, clarityRate: -1.5,
    gate: (s, _r, opts) => {
      const plan = planBuild(s, opts);
      if (!plan.site) return campAsActionOn(s) ? 'make camp first' : 'choose a location';
      if (plan.moving && !scouted(s.explore, 1)) return needsScout(s);
      if (!plan.recipe) return 'the shelter is already winterized';
      const unknown = unknownRecipe(s, plan.recipe);
      if (unknown) return unknown;
      // Judge materials against the camp as it would be (moving keeps your stores, resets the bench).
      return craftBlocker(crafterOf(plan.moving ? { ...s, tier: 0 } : s), plan.recipe);
    },
    options: buildOptions,
    recipeFor: (s, opts) => planBuild(s, opts).recipe,
    run: () => '',
  },
  coldGear: {
    ...craftAction(COLD_GEAR_RECIPE), name: 'Craft cold gear',
    gate: (s, _r, o) => (roadworthyGear(s.tools) ? 'you already have sound cold gear' : unknownRecipe(s, coldGearRecipe(o)) ?? craftBlocker(crafterOf(s), coldGearRecipe(o))),
    recipeFor: (_s, o) => coldGearRecipe(o),
    options: (s, o) => [choiceGroup('material', 'Material', o.material ?? 'fiber', [
      { value: 'fiber', label: 'Woven fiber', note: `${costNote(COLD_GEAR_RECIPE)} · crude won't hold up through a winter`, blocked: null },
      { value: 'hide', label: 'Hide parka', note: `${costNote(HIDE_PARKA_RECIPE)} · holds the cold even if crude`, blocked: knows(s, HIDE_PARKA_RECIPE) ? null : 'not yet discovered' },
    ])],
  },
  coldPit: {
    ...craftAction(COLD_PIT_RECIPE), name: 'Dig a cold pit',
    // Anyone can dig a pit and line it with stone: no recipe to discover. It belongs to the camp, not the Warden.
    gate: s => (!s.site ? 'make camp first' : s.coldPitAt === s.site ? 'there is already a cold pit here' : craftBlocker(crafterOf(s), COLD_PIT_RECIPE)),
  },
  knife: craftAction(REGION1_RECIPES.knife, needsScout),
  basket: craftAction(GEAR_RECIPES.basket),
  backpack: craftAction(GEAR_RECIPES.backpack, s => (s.stores.hides >= 1 ? null : 'you need a hide — hunt deer first')),
  harness: craftAction(GEAR_RECIPES.harness, s => (s.stores.hides >= 1 ? null : 'you need a hide — hunt deer first')),
  sled: craftAction(GEAR_RECIPES.sled),
  snare: craftAction(REGION1_RECIPES.snare),
  // Traps first (#1821, `hunting-gear`): a line of snares along the trails where you've seen game,
  // light work and a little cord. It catches overnight with no more work: by morning there may be
  // small game in it (endDay, `checkTraps`). Setting it works the game there as a hunt does.
  traps: {
    name: 'Set traps', hours: TRAP_HOURS, vigorRate: -2, clarityRate: -1, ringed: true,
    gate: (s, r) => reach(s, r)
      ?? (level(s.explore, r, 'game') >= 1 ? null : `you haven't seen any game${where(r) || ' nearby'}`)
      ?? ((s.traps ?? []).includes(r) ? 'your traps are already set there' : null)
      ?? (s.stores.materials >= TRAP_CORD ? null : `needs ${TRAP_CORD} materials (have ${s.stores.materials})`),
    run: (s, _b, r) => {
      s.stores.materials -= TRAP_CORD;
      const note = workLand(s, r, 'game');
      s.traps = [...(s.traps ?? []), r];
      return `Set a line of traps${where(r)}: snares along the game trails, to check by morning.${note}`;
    },
  },
  // Store the meat (#1823, `camp-scavengers`): a short job at camp, putting the raw meat lying out in
  // the best place camp has the makings for (camp-scavengers.ts MEAT_PLACES): under a stone cache with
  // stone, else hung in a tree with cord. Nothing is used up. It holds until you take from it.
  storemeat: {
    name: 'Store the meat', hours: STORE_MEAT_HOURS, vigorRate: -1.5, clarityRate: -0.5,
    // With a lidded cold pit (#1857) the pit is the first place: it can be all the job needs.
    gate: s => (!s.site ? 'make camp first'
      : openMeatOf(s) <= 0 ? 'no raw meat lying out to store'
        : meatPlaceFor(s) || pitRoom(s) > 0 ? null
          : pitLidded(s) ? 'the cold pit is full, and the rest needs 1 materials for cord, or 3 stone for a cache' : 'needs 1 materials for cord, or 3 stone for a cache'),
    run: s => {
      const n = meatOf(s);
      // The lidded pit first (#1857), up to what it holds; with no lid, nothing goes in it and the
      // job is the one it always was: all the meat to the best place outside it.
      const pit = pitLidded(s) ? Math.min(n, coldPitHolds(s.site)) : 0;
      const rest = n - pit;
      const place = rest > 0 ? meatPlaceFor(s) : null;
      if (pit > 0) s.meatPit = pit;
      if (place) s.meatStored = { n: rest, place };
      else if (rest <= 0) delete s.meatStored;
      if (pit <= 0) return place === 'cache' ? `Put ${n} raw meat under a cairn of heavy stones, out of reach.` : `Hung ${n} raw meat high in a tree with cord, out of reach.`;
      const inPit = `Put ${pit} raw meat in the cold pit, under its lid and the stones`;
      if (rest <= 0) return `${inPit}.`;
      if (place === 'cache') return `${inPit}, and ${rest} more under a cairn of heavy stones.`;
      if (place === 'hung') return `${inPit}, and hung ${rest} more high in a tree with cord.`;
      return `${inPit}. The rest doesn't fit.`;
    },
  },
  // Lid the cold pit (#1857, `cold-pit-lid`): a short camp craft. Split wood laid over the pit and two
  // heavy stones on top. Nothing to work out, so no recipe to discover; it stays with the pit, and
  // after it the pit is one more place Store the meat uses (the first).
  lidpit: {
    name: 'Lid the cold pit', hours: LID_HOURS, vigorRate: -2, clarityRate: -0.5,
    gate: s => (!s.site ? 'make camp first'
      : s.coldPitAt !== s.site ? 'dig a cold pit first'
        : s.pitLid ? 'the cold pit already has a lid'
          : s.stores.materials < LID_COST.materials ? `needs ${LID_COST.materials} materials (have ${s.stores.materials})`
            : s.stores.stone < LID_COST.stone ? `needs ${LID_COST.stone} stone (have ${s.stores.stone})` : null),
    run: s => {
      s.stores.materials -= LID_COST.materials;
      s.stores.stone -= LID_COST.stone;
      s.pitLid = true;
      return LID_LINE;
    },
  },
  // Make a needle compass (#1868, `compass-heading`): a short job anywhere, nothing used up. Stroke a
  // steel needle (the sewing kit's, or the hook from a hook and line) one way on wool and float it on
  // still water, and it points north. Kept once made; its pull fades, and the same job refreshes it.
  needlecompass: {
    name: 'Make a needle compass', hours: NEEDLE_HOURS, vigorRate: -0.5, clarityRate: -1,
    gate: s => needleGate(s),
    run: s => makeNeedleCompass(s),
  },
  sling: gearCraft(HUNTING_RECIPES.sling),
  bow: gearCraft(HUNTING_RECIPES.bow),
  hookline: gearCraft(HUNTING_RECIPES.hookline),
  waterskin: craftAction(REGION1_RECIPES.waterskin, s => (s.stores.hides >= 1 ? null : 'you need a hide — hunt deer first')),
  bedroll: craftAction(REGION1_RECIPES.bedroll, needsScout),
  shovel: craftAction(REGION1_RECIPES.shovel, needsScout),
  lookout: {
    // You look out over ground you've scouted; without that it would stand in for scouting two rings at once.
    name: 'Climb & look out', hours: 5, vigorRate: -4.5, clarityRate: -1, ringed: true,
    gate: (s, r) => reach(s, r) ?? (scouted(s.explore, r) ? null : `${scoutVerb(s)} the ${RING_NAME[r].toLowerCase()} ring first`),
    // Camped on the hilltop, the near look-out is a short climb.
    variant: (_o, s, ring) => (s?.site === 'hill' && ring === 1 ? { hours: 2 } : {}),
    run: (s, _b, r, _o, light) => {
      if (tooDarkToSee('lookout', light)) return tooDark(r);
      s.explore = lookout(s.explore, r);
      // From up high you can read tomorrow's sky (#1282).
      const tomorrow = foresee(s, s.day + 1);
      return `Climbed high${where(r)} and looked out — the ground sharpens below${r < 3 ? `, and you can see over the ${RING_NAME[(r + 1) as Ring].toLowerCase()} ring` : ''}.${s.config.world.weather === 'seeded' ? ` Tomorrow looks like ${weatherName(tomorrow, s.day + 1, s.config.calendar).toLowerCase()}.` : ''}`;
    },
  },
  study: {
    name: 'Study', hours: 3, vigorRate: 0, clarityRate: 0,
    // Locked (naming what it needs), mastered or too foggy first; then a concept that's open but that nothing has
    // shown you yet (#1469) — the road's study and an AI's reply come through here too, not only the menu.
    gate: (s, _r, o) => {
      const concept = o.concept ?? 'joinery';
      return studyConcept(crafterOf(s), concept, CRAFT_WORLD).reason ?? (STUDY_CONCEPTS(s).includes(concept) ? null : `you haven't come across ${concept} yet`);
    },
    options: (s, o) => [choiceGroup('concept', 'Concept', o.concept ?? 'joinery', STUDY_CONCEPTS(s).map(c => {
      const reveals = DISCOVERIES.filter(d => d.concept === c && !s.known.includes(d.recipe)).map(d => d.name.toLowerCase());
      return { value: c, label: c[0].toUpperCase() + c.slice(1), note: `rank ${s.concepts[c]?.rank ?? 0}${reveals.length ? ` · rank 1 reveals ${reveals.join(', ')}` : ''}`, blocked: null };
    }))],
    // Focus spends about a third of a fresh mind (crafting.study); insight grows the concept.
    run: (s, _b, _r, o, light) => {
      const concept = o.concept ?? 'joinery';
      const before = s.vitals.clarity.current;
      const c = { ...crafterOf(s), studiedToday: s.studiedToday };
      const r = studyConcept(c, concept, CRAFT_WORLD);
      s.vitals = r.state.vitals;
      s.concepts = r.state.concepts;
      s.studiedToday = r.state.studiedToday;
      s.today.loadClarity += Math.max(0, before - s.vitals.clarity.current);
      // Intelligence (#1256): a sharper mind takes more from the same session.
      // …and a notebook to write it down in (#1400) keeps a little more of it.
      const extra = r.gained * (statEffects(s.character.stats).insight - 1 + (hasKit(s, 'notebook') ? NOTEBOOK_INSIGHT : 0));
      if (extra !== 0) addInsight(s.concepts, concept, extra, CRAFT_WORLD.concepts);
      // At night you read and reckon by firelight — or strain in the dark (#1281), unless a headlamp lights it (#1400).
      const night = closeWork(s, light, 3);
      const strain = Math.max(0, before - s.vitals.clarity.current) * (night.clarity - 1);
      spendCloseWork(s, night);
      s.vitals.clarity.current = Math.max(0, s.vitals.clarity.current - strain);
      s.today.loadClarity += strain;
      return `Studied ${concept} — ${(r.gained + extra).toFixed(1)} insight (rank ${s.concepts[concept]?.rank ?? 0}).${night.lamp ? ' By headlamp.' : night.fire ? ' By firelight.' : night.clarity > 1 ? ' Straining in the dark.' : ''}`;
    },
  },
  // Learning your actions as you go (#1689): the one exploring action a new Warden has.
  explore: {
    name: 'Explore', hours: 4, vigorRate: -3.5, clarityRate: -1, ringed: true,
    // Heading out one way (#1839, `directed-explore`) goes where the land takes you: no need to know the ground inside first.
    // …but it needs something to keep a heading by (#1868, `compass-heading`): a compass, a needle compass, or the sun.
    gate: (s, r, o) => skillLockOf(s, 'explore') ?? (isHeading(wayOf(s, o)) ? wayLock(s, o) : reach(s, r)),
    // Look around, or head out one of eight ways (#1839): no choice at all with the switch off.
    // With nothing to keep a heading by (#1868), the eight ways are there but blocked, saying what's missing.
    options: (s, o) => withHeadingLock(s, wayOptions(s, o)),
    run: (s, _b, r, o, light) => {
      if (tooDarkToSee('explore', light)) return tooDark(r);
      if (blindInFog(s.weatherToday, 'explore')) return fogged(r);
      // Heading out (#1839): the land that way, and you end the day out there. Its lines in order, the last one returned.
      const way = wayOf(s, o);
      if (isHeading(way)) {
        // Keeping the heading (#1868): the shadow stick's marks, and a needle that drifts one direction off.
        const steer = steerHeading(s, way);
        const lines = [...steer.lines, ...headOut(s, steer.dir, r)];
        for (const l of lines.slice(0, -1)) say(s, l, 'action');
        return lines[lines.length - 1];
      }
      // Away from camp (or, before camp, from the start), looking around sees the land where you stand.
      if (way === 'here' && s.afield && directedOn(s)) return lookHere(s, r);
      const first = !scouted(s.explore, r);
      s.explore = exploreRing(s.explore, r);
      if (first) {
        return r === 1 ? 'Walked out and looked around — you know now roughly where food, water, wood and stone lie.'
          : r === 2 ? 'Walked out to the far ring and looked around — forage, timber, and paths leading on.'
            : 'Walked out as far as the distant hills — and glimpsed the pass out of the Reach.';
      }
      return `Walked the ground${where(r)} again and looked closer — it's a little clearer now.`;
    },
  },
  // Try something with what you have (#1690): always there with the switch on, it works out what you don't know yet.
  experiment: {
    name: 'Experiment', hours: EXPERIMENT_HOURS, vigorRate: -0.5, clarityRate: -3,
    gate: s => skillLockOf(s, 'experiment'),
    options: (s, o) => {
      // Nothing to choose in a game without the action (a random player's options mustn't shift a stream).
      const mats = visibilityOn(s) ? experimentMaterials(s) : [];
      return mats.length > 1 ? [choiceGroup('with', 'Try with', o.with ?? 'any', [
        { value: 'any', label: 'Anything', note: 'whatever seems promising', blocked: null },
        ...mats.map(k => ({ value: k, label: STORE_WORD[k][0].toUpperCase() + STORE_WORD[k].slice(1), note: `${s.stores[k]} at hand`, blocked: null })),
      ])] : [];
    },
    run: (s, _b, _r, o) => {
      s.today.absorbed = true;
      const step = experimentStep({ targets: EXPERIMENT_TARGETS, known: s.known, have: k => s.stores[k as keyof Stores] ?? 0, progress: s.experiments ?? {}, focus: s.focus, with: o.with && o.with !== 'any' ? o.with : undefined });
      if (!step.target) return 'Turned over what you have — nothing in it you don\'t already know how to use. More to work with might show you more.';
      s.experiments = step.progress;
      if (!Object.keys(s.experiments).length) delete s.experiments;
      const stuff = inputWords(step.target);
      if (step.learned) {
        s.known.push(step.target.recipe);
        say(s, `Worked out: ${step.target.name} — trying things with ${stuff}, you found how it goes together.`, 'milestone');
        return `Experimented with ${stuff}${step.steered ? ', your mind on it' : ''} — and it came.`;
      }
      return step.hinted
        ? `Experimented with ${stuff}. You think there's a way to make something of it, if you keep at it.`
        : `Experimented with ${stuff}${step.steered ? ', your mind on it' : ''} — closer, you think.`;
    },
  },
  tinker: {
    name: 'Tinker / plan', hours: 5, vigorRate: 2, clarityRate: -5.5,
    run: () => 'Worked at the bench — the body eased while the mind spent.',
  },
  rest: {
    name: 'Rest', hours: 3, vigorRate: 4, clarityRate: 1.5,
    run: s => {
      // The hike kit (#1400): a dry seat on a wet rock; and, once, a rainy day with a comic.
      const pad = hasKit(s, 'sit-pad');
      if (pad) s.vitals = { ...s.vitals, vigor: { ...s.vitals.vigor, current: Math.min(s.vitals.vigor.cap, s.vitals.vigor.current + SIT_PAD_VIGOR) } };
      const comic = s.kit && s.kit.comic > 0 && s.weatherToday === 'rain';
      if (comic) {
        s.kit!.comic = 0;
        s.vitals = { ...s.vitals, clarity: { ...s.vitals.clarity, current: Math.min(s.vitals.clarity.cap, s.vitals.clarity.current + COMIC_CLARITY) } };
      }
      return `Sat a while${pad ? ' on your sit pad' : ''} and let the ache settle.${comic ? ' The rain drums on and you read your comic cover to cover, again.' : ''}`;
    },
  },
  // First aid (#1393): tend your worst untreated injury — a kit dressing if you have one, else improvised.
  // How well is First aid's doing; a treated injury heals faster and won't worsen or fester.
  treat: {
    name: 'Treat an injury', hours: 1, vigorRate: 0, clarityRate: -2,
    gate: s => {
      const inj = worstUntreated(s.injuries);
      if (!inj) return s.injuries?.length ? 'your injuries are already tended' : 'you have no injuries to tend';
      return treatmentFor(inj.kind, s.stores, s.dressings ?? 0) ? null : NO_TREATMENT[inj.kind];
    },
    run: s => {
      const inj = worstUntreated(s.injuries)!;
      const plan = treatmentFor(inj.kind, s.stores, s.dressings ?? 0)!;
      for (const [k, n] of Object.entries(plan.cost) as [keyof typeof plan.cost, number][]) s.stores[k] -= n;
      if (plan.dressing) s.dressings = (s.dressings ?? 0) - 1;
      // The true level does the work, as with every skill; you only *think* you know how good you are.
      const quality = treatmentQuality(skillLevel(s.skills, 'firstaid'), plan.better);
      s.injuries = s.injuries!.map(i => (i === inj ? { ...i, treated: quality } : i));
      return treatLine(inj, plan.via, quality);
    },
  },
  // Last in the table, so the action ids before it keep their places (the uniform random player picks by index).
  // Bank the fire (#1865, `banked-fire`): a short job at camp before a long trip. Rake the embers
  // together, heap on firewood and cover it with ash and turf, so it smoulders for hours untended and
  // keeps animals off the meat lying out (the `fire` guard on the day roll). It's paid up front, at
  // about 1 firewood per 4 hours (camp-scavengers.ts BANK_*): the sim doesn't know yet how long the
  // next trip will be, so a fixed banking that lasts a long trip there and back is the honest price.
  bankfire: {
    name: 'Bank the fire', hours: BANK_WORK_HOURS, vigorRate: -1, clarityRate: -0.5,
    gate: s => (!s.site ? 'make camp first'
      : openMeatOf(s) <= 0 ? 'no raw meat lying out to guard'
        : bankedNow(s) ? 'the fire is already banked'
          : s.stores.firewood < BANK_FIREWOOD ? `needs ${BANK_FIREWOOD} firewood to bank the fire (have ${s.stores.firewood})` : null),
    run: s => {
      s.stores.firewood -= BANK_FIREWOOD;
      // `hoursToday` already counts this job (runActionCore adds the hours before `run`), so the fire
      // smoulders from the moment you set out.
      s.banked = { day: s.day, until: s.hoursToday + BANK_HOURS };
      return bankLine();
    },
  },
};

// ── Milestones ──────────────────────────────────────────────────────────────

/** The Region 1 first-win ladder (region-1 §2): early rungs guide, late rungs are the readiness thresholds. */
export const REGION1_MILESTONES: readonly MilestoneDef<Region1State>[] = [
  { id: 'scout', name: 'Get your bearings', done: s => scouted(s.explore, 1) },
  { id: 'site', name: 'Stake a claim', done: s => s.site !== null },
  { id: 'water', name: 'Water secured', done: s => s.flags.everWater },
  { id: 'forage', name: 'First forage', done: s => s.flags.everFood },
  { id: 'timber', name: 'Fire & timber', done: s => s.flags.everWood },
  { id: 'roof', name: 'A roof overhead', done: s => s.tier >= 1 },
  { id: 'track', name: 'Read the tracks', done: s => gameTracked(s) },
  { id: 'catch', name: 'First catch', done: s => s.flags.everHunt },
  { id: 'pushout', name: 'Push out', done: s => scouted(s.explore, 2) },
  { id: 'larder0', name: 'The larder begins', done: s => s.flags.everPreserve },
  { id: 'winterized', name: 'Winterized', done: s => warmth(s) >= s.config.thresholds.warmth },
  { id: 'larder', name: 'Larder stocked', done: s => s.stores.rations >= s.config.thresholds.larder },
  { id: 'fuel', name: 'Fuel laid in', done: s => s.stores.firewood >= s.config.thresholds.fuel },
  { id: 'ready', name: 'Winter-ready', done: s => winterReady(s) },
];

/** Re-evaluate the ladder on a (cloned) state, journalling any new rungs. */
function latchMilestones(s: Region1State): void {
  latchDiscoveries(s);
  const r = evaluateMilestones(REGION1_MILESTONES, s, s.milestones);
  s.milestones = r.achieved;
  for (const id of r.newlyAchieved) {
    const def = REGION1_MILESTONES.find(m => m.id === id);
    say(s, `Milestone — ${def?.name ?? id}`, 'milestone');
  }
}

// ── The loop ────────────────────────────────────────────────────────────────

/** Settle on a site (needs scouting). Moving resets the shelter build. */
export function chooseSite(s: Region1State, site: SiteId): Region1State {
  const next = clone(s);
  if (next.outcome) return next;
  // With camp as an action (#1732) the site is chosen by the Make camp action, never set for free.
  if (campAsActionOn(next)) return next;
  if (!scouted(next.explore, 1)) { say(next, `Can't stake a claim yet: ${needsScout(next)}.`, 'skip'); return next; }
  if (next.site === site) return next;
  moveCamp(next, site);
  latchMilestones(next);
  return next;
}

/**
 * Make camp's hours (#1732): the setting up, and the walk there. With a heavy pack on (#1871,
 * `pack-volume`) the walk there is the last one under it and costs more Vigor: the action has one
 * rate, so the walk's extra is spread over its hours (the walk's share of them, times the extra).
 * At or under the comfortable weight there's no rate here at all, so the action is exactly as before.
 */
function campVariant(s: Region1State, o: ActionOpts): { hours: number; vigorRate?: number } {
  const walk = chosenSpot(s, o)?.hours ?? 0;
  const hours = CAMP_SETUP_HOURS + walk;
  const heavy = packWalkMult(s);
  return heavy > 1 && walk > 0 ? { hours, vigorRate: CAMP_VIGOR_RATE + TRAVEL_VIGOR_RATE * (heavy - 1) * walk / hours } : { hours };
}

/** Per-hour pull of walking to and from an outer ring. */
export const TRAVEL_VIGOR_RATE = -3;
export const TRAVEL_CLARITY_RATE = -0.5;

/**
 * A land or camp action's hours (#1475): its work — the tools' speed, rain, deep snow for the
 * felling, a blizzard, the hike kit (#1400), pain (#1409) — and the walk to an outer ring. The run
 * and the plan's estimate both use this, so the plan's hours are the work's.
 */
function actionHours(s: Region1State, id: ActionId, ring: Ring, opts: ActionOpts): { work: number; travel: number } {
  const def = ACTIONS[id];
  const v = def.variant?.(opts, s, ring) ?? {};
  // Deep snow (#1315) slows the walk out and the felling; a blizzard slows everything out there.
  const snow = snowSlowFor(s);
  const storm = inBlizzard(s, id) ? BLIZZARD_HOURS : 1;
  const work = (v.hours ?? def.hours) * modifiersFor(s.tools, id).timeMult * weatherHours(s.weatherToday, id) * (id === 'wood' ? snow : 1) * storm * kitTimeMult(s, id) * PAIN_HOURS[painOf(s)]
    // Heading out by the sun (#1868, `compass-heading`): the shadow stick's two marks, a while apart.
    + (id === 'explore' ? headingExtraHours(s, opts) : 0);
  // Walking the map (#1876, `walk-the-map`): the walk is the path's there and back, not the ring's flat hours.
  const trip = def.ringed ? tripOf(s, id, ring, opts) : null;
  const travel = def.ringed ? (trip ? trip.outHours + trip.backHours : TRAVEL_HOURS[ring]) * snow * storm : 0;
  return { work, travel };
}

/**
 * The trip a task walks on the map (#1876), or null: the switch off, or Explore's own ways — heading
 * out, and looking around where you stand (#1839) — which move the Warden by their own rules.
 */
function tripOf(s: Region1State, id: ActionId, ring: Ring, opts: ActionOpts): Trip | null {
  if (!walkOn(s)) return null;
  const way = id === 'explore' ? wayOf(s, opts) : 'here';
  return walkTrip(s, id, ring, isHeading(way) || (way === 'here' && !!s.afield && directedOn(s)));
}

/** A craft's or build's hours (#1475): the recipe's time, the craft tools' speed, a hurt hand (#1286) and pain — the run's and the estimate's. */
function craftHours(s: Region1State, recipe: CraftRecipe): number {
  return recipe.timeBase * modifiersFor(s.tools, 'craft').timeMult * injuryCost(s.injuries, 'hand') * PAIN_HOURS[painOf(s)];
}

/**
 * The walk back to camp from out on the land (#1839): its hours, and the walk's pull on Vigor and
 * Clarity at the travel rates. You're at camp after it. Mutates `next`; returns the hours.
 */
function walkBack(next: Region1State): number {
  const h = walkBackHours(next);
  // With a heavy pack still on (#1871, `pack-volume`: no camp made yet), the walk costs more.
  const w = applyActivity(next.vitals, { hours: h, vigorRate: TRAVEL_VIGOR_RATE * packWalkMult(next), clarityRate: TRAVEL_CLARITY_RATE });
  next.vitals = w.vitals;
  next.today.loadVigor += w.loadVigor;
  next.today.loadClarity += w.loadClarity;
  next.hoursToday += h;
  // Walking the map (#1876): the way back goes on today's trail.
  noteWalk(next, pathHome(next));
  backAtCamp(next);
  say(next, walkBackLine(h), 'action');
  return h;
}

/** Building somewhere new moves camp first — and pitches the tarp, if one's packed (#1400). Mutates `next`. */
function moveForBuild(next: Region1State, opts: ActionOpts): void {
  const plan = planBuild(next, opts);
  if (plan.moving && plan.site) moveCamp(next, plan.site);
}

/**
 * Hours a queue entry will take (its work plus any travel) — for planning previews, the AI's
 * view and the sim's light reckoning. Pass the state it would run in: with it, the estimate is
 * the run's own reckoning (#1475) — the same recipe (a build that moves camp builds from the new
 * ground), the same multipliers. Without it, the base hours.
 *
 * Not in the estimate: what only the run can know — an accident or an encounter that cuts the
 * work short, or the slower walk home under an overloaded haul (#1296), which depends on the haul.
 */
export function queueHours(item: QueueItem, s?: Region1State): number {
  const { id, ring, opts } = parseItem(item);
  const def = ACTIONS[id];
  if (!s) return (def.recipe ? def.recipe.timeBase : def.variant?.(opts, s, ring).hours ?? def.hours) + (def.ringed ? TRAVEL_HOURS[ring] : 0);
  // Away from camp (#1839), the walk back comes first: the plan's hours are the work's and the walk's.
  if (walksBackFirst(s, id, opts)) {
    const back = walkBackHours(s);
    const home = clone(s);
    backAtCamp(home);
    return back + queueHours(item, home);
  }
  let at = s;
  if (id === 'build' && planBuild(s, opts).moving) { at = clone(s); moveForBuild(at, opts); }
  const recipe = def.recipeFor?.(at, opts) ?? def.recipe;
  if (recipe) return craftHours(at, recipe);
  // A session of chosen length (#1668): its trips' work and walks.
  const ses = sessionOf(s, item);
  if (ses) return ses.plan.work + ses.plan.travel;
  const { work, travel } = actionHours(s, id, ring, opts);
  return work + travel;
}

// ── Chosen lengths (#1668) ──────────────────────────────────────────────────

/** A session of chosen length, planned as trips (action-length.ts). */
export interface Session {
  id: LengthAction;
  ring: Ring;
  plan: TripPlan;
  /** The usual trip's work hours: a session's yield is counted in usual trips' worth. */
  usual: number;
  /** The yield multiplier per patch: hours harvested at a fresh patch over the usual trip's hours. */
  factor: Partial<Record<PatchId, number>>;
  /** The work in usual trips, for the land's draw and what the work teaches. */
  amount: number;
}

/** A queue item's options without a chosen length: the usual trip. */
const withoutLength = (opts: ActionOpts): ActionOpts => Object.fromEntries(Object.entries(opts).filter(([k]) => k !== 'hours' && k !== 'until'));

/** The length chosen for an item, when the switch is on and the action takes one; else null. */
const lengthOf = (s: Region1State, id: ActionId, opts: ActionOpts): ReturnType<typeof chosenLength> =>
  (hasLength(id) && featureOn(s.config.world.features, 'action-length') ? chosenLength(opts) : null);

/**
 * What a usual trip brings in, by store, before anything is left behind: a dry run with carrying
 * and accidents off. Its haul per hour sets how heavy a session's loads get.
 */
function probeTrip(s: Region1State, id: LengthAction, ring: Ring, opts: ActionOpts): Haul {
  const dry = runActionCore({ ...s, config: { ...s.config, world: { ...s.config.world, carrying: false, accidents: false } } }, { q: queueId(id, ring), opts });
  const out: Haul = {};
  for (const k of STORE_KEYS) { const g = dry.stores[k] - s.stores[k]; if (g > 0) out[k] = g; }
  return out;
}

/** Plan a session of `budget` hours (walks included) as trips: carrying and the patches decide how they go. */
function planSession(s: Region1State, id: LengthAction, ring: Ring, opts: ActionOpts, budget: number): Session {
  const { work: usual, travel } = actionHours(s, id, ring, opts);
  const probe = probeTrip(s, id, ring, opts);
  const patches = patchesOf(id);
  const start = Object.fromEntries(patches.map(p => [p, abundance(s.patches, ring, p)])) as Partial<Record<PatchId, number>>;
  // How heavy an hour's harvest is, patch by patch, with the gear that suits it (#1294). A trip
  // ends at a comfortable load: past that the walk home slows and strains (#1292), so you go back.
  const gear = bestGear(s.tools, { ring, snow: (s.snowDepth ?? 0) > 0 || s.weatherToday === 'snow' }, probe, s.character.stats);
  const bulkPerHour: Partial<Record<PatchId, number>> = {};
  for (const k of Object.keys(probe) as (keyof Haul)[]) {
    const p = ACTION_PATCHES[id][k];
    if (p) bulkPerHour[p] = (bulkPerHour[p] ?? 0) + (cumbersome({ [k]: probe[k] }, gear) - gear.extra) / usual;
  }
  const capacity = Math.max(STEP, comfortableLoad(s.character.stats) - gear.extra);
  const plan = planTrips({ budget, travel, start, main: MAIN[id].patch, bulkPerHour, capacity });
  const factor = Object.fromEntries(patches.map(p => [p, (plan.harvest[p] ?? 0) / usual])) as Partial<Record<PatchId, number>>;
  return { id, ring, plan, usual, factor, amount: plan.work / usual };
}

/**
 * "Until you have N" (#1668): the shortest session, on the planning grid and within `cap` hours,
 * whose dry run brings the stores to N, or the whole cap if even that falls short. The dry run
 * is the real run (same seeds, same hour), so the session then stops exactly where it said.
 */
function untilHours(s: Region1State, id: LengthAction, ring: Ring, opts: ActionOpts, until: number, cap: number): number {
  const store = MAIN[id].store;
  const have = (h: number): number => runActionCore(s, { q: queueId(id, ring), opts: { ...opts, hours: String(h) } }).stores[store];
  const lo = Math.max(1, Math.ceil((actionHours(s, id, ring, opts).travel + MIN_WORK) / STEP - 1e-9));
  const hi = Math.max(lo, Math.floor(cap / STEP + 1e-9));
  if (have(hi * STEP) < until) return hi * STEP;
  let a = lo, b = hi;
  while (a < b) {
    const m = Math.floor((a + b) / 2);
    if (have(m * STEP) >= until) b = m; else a = m + 1;
  }
  return a * STEP;
}

/**
 * The session a queue item plays as (#1668), or null for the usual trip: the switch off, an action
 * with a fixed length, or no length chosen. `hours` is the session's length, walks included (the
 * first trip always gets an hour's work, however far the walk); "day" and "until" without hours run
 * to the end of the day. Deterministic: no draws of its own.
 */
export function sessionOf(s: Region1State, item: QueueItem): Session | null {
  const { id, ring, opts } = parseItem(item);
  const len = lengthOf(s, id, opts);
  if (!len || !hasLength(id)) return null;
  // Planned afresh on every call, on purpose: no cache, so nothing outlives the state it was planned
  // for (an "until" costs a handful of dry runs, a few milliseconds).
  const usualOpts = withoutLength(opts);
  const rest = Math.max(0, DAY_HOURS - s.hoursToday);
  const cap = len.hours === 'day' || len.hours === null ? rest : len.hours;
  const budget = len.until !== null ? untilHours(s, id, ring, usualOpts, len.until, cap) : cap;
  const out = planSession(s, id, ring, usualOpts, budget);
  // Home early with enough: the last trip ended on the target, not the clock.
  const last = out.plan.trips[out.plan.trips.length - 1];
  if (len.until !== null && budget < cap && last.ended === 'time') last.ended = 'target';
  return out;
}

/** The yield and land scale a session runs at. */
const scaleOf = (ses: Session): RunScale => ({ yieldOf: p => ses.factor[p] ?? 1, amount: ses.amount });

/** The patches after a session, back into the save: a patch at full is left out. */
function withPatches(patches: Patches | undefined, ring: Ring, end: Partial<Record<PatchId, number>>): Patches | undefined {
  const out: Record<string, number> = { ...(patches ?? {}) };
  for (const [p, a] of Object.entries(end) as [PatchId, number][]) {
    if (a < 1) out[patchKey(ring, p)] = a; else delete out[patchKey(ring, p)];
  }
  return Object.keys(out).length ? out : undefined;
}

/** What thinned, in words ("the deadfall is getting thin"), from a session's end. */
const thinWords = (ses: Session): string[] =>
  (Object.entries(ses.plan.end) as [PatchId, number][]).map(([p, a]) => patchWord(p, a)).filter((w): w is string => w !== null);

/** The journal's line on how a session went: its trips, and why it stopped. */
function sessionLine(ses: Session): string {
  const n = ses.plan.trips.length;
  const last = ses.plan.trips[n - 1];
  const why = last.ended === 'target' ? ', enough, and home' : last.ended === 'thin' ? ', not worth going back' : '';
  const thin = thinWords(ses);
  return `${n} trip${n === 1 ? '' : 's'}, ${hrs1(ses.plan.work)}h of work${ses.plan.travel > 0 ? ` and ${hrs1(ses.plan.travel)}h walking` : ''}${thin.length ? `; ${thin.join(', ')}` : ''}${why}.`;
}

/**
 * The plan of a queued session, for the queue preview (#1668): "3 trips, about 14 firewood and 6
 * materials, the deadfall is getting thin". From a dry run of the session itself, so the numbers
 * are the run's (an encounter or a panic can still change the day). Null for a usual trip.
 */
export function sessionNote(s: Region1State, item: QueueItem): string | null {
  const ses = sessionOf(s, item);
  if (!ses) return null;
  const dry = runActionCore(s, item);
  const got = STORE_KEYS.map(k => [k, dry.stores[k] - s.stores[k]] as const).filter(([, g]) => g > 0).map(([k, g]) => `${g} ${STORE_WORD[k]}`);
  const n = ses.plan.trips.length;
  const parts = [`${n} trip${n === 1 ? '' : 's'}`, got.length ? `about ${got.length === 1 ? got[0] : `${got.slice(0, -1).join(', ')} and ${got.at(-1)}`}` : 'little to show for it', ...thinWords(ses)];
  return parts.join(', ');
}

/**
 * Why an action can't be done right now, or null if it can: its own gate, or
 * the weather (a storm keeps you out of the far rings, #1284). A blizzard
 * refuses nothing; it's a danger, not a wall (#1315). Every place that
 * asks "is this allowed?" — the sim, the plan preview, the AI — uses this.
 */
export function blockedReason(s: Region1State, id: ActionId, ring: Ring, opts: ActionOpts = {}): string | null {
  const why = whyBlocked(s, id, ring, opts);
  // Said as distances with `distance-not-rings` on (#1752): the page, the AI and the API read this.
  return why === null ? null : ringWordsFor(s, why);
}

function whyBlocked(s: Region1State, id: ActionId, ring: Ring, opts: ActionOpts): string | null {
  const def = ACTIONS[id];
  // Something you don't know how to do yet (#1690): refused before any circumstance is looked at.
  const lock = skillLockOf(s, id, opts);
  if (lock) return lock;
  if (def.gate) { const g = def.gate(s, ring, opts); if (g) return g; }
  // "Until you have N" (#1668) with N already in the stores: nothing to go out for.
  const len = lengthOf(s, id, opts);
  if (len?.until != null && hasLength(id) && s.stores[MAIN[id].store] >= len.until) return `you already have ${len.until} ${STORE_WORD[MAIN[id].store]}`;
  if (!def.ringed) return null;
  // An autumn storm keeps you out of the far rings (#1284). A winter blizzard doesn't refuse you —
  // you can go out in it, and it may well kill you (#1315; see `dangerOf`).
  if (isBlizzard(s.weatherToday, s.day, s.config.calendar)) return null;
  return stormBars(s.weatherToday, ring) ? 'the storm makes it too dangerous to go out' : null;
}

/**
 * Do one action now. A refused action (gate not met) costs nothing — it simply
 * doesn't happen — and is journalled as a skip.
 */
/**
 * Run one action now. While an encounter waits for your choice (#1343), nothing runs; after
 * land work, an encounter may happen and pause the day.
 */
export function runAction(s: Region1State, item: QueueItem, stop?: number): Region1State {
  if (s.pending) return s;
  // `stop` (#1815, `stop-action`): cut the action short that many hours in, by its plan (stop-action.ts).
  const next = runActionCore(s, item, stop);
  // Did a hidden talent make a difference (#1265)? Run the same work without it and compare.
  if (hasHidden(s.character.talents)) noticeHidden(next, differenceOf(next, runActionCore(hiddenless(s), item, stop)));
  maybeEncounter(s, next, item);
  return next;
}

/**
 * The crash after a panic (#1361): the adrenaline drains away and leaves you wrung out and
 * shaking. Stoic (#1362) halves it; Surge (#1363) spares the body's Vigor.
 */
function crash(next: Region1State, at?: ReturnType<typeof stampFor>): void {
  const stoic = hasQuirk(next, 'stoic') ? STOIC_CRASH : 1;
  const surged = talentEffects(next.character.talents).crashVigor;
  const pool = (q: Pool, d: number): Pool => ({ ...q, current: Math.max(0, Math.min(q.cap, q.current + d)) });
  next.vitals = { ...next.vitals, vigor: pool(next.vitals.vigor, -CRASH_VIGOR * stoic * surged), clarity: pool(next.vitals.clarity, -CRASH_CLARITY * stoic) };
  next.today = { ...next.today, shaking: true };
  say(next, 'Afterwards the strength drains out of you all at once, and your hands won\'t stop shaking.', 'hardship', at);
  if (stoic < 1) revealQuirk(next, 'stoic', at);
}

/** Condition a wound costs (#1344): 5% less per point of CON above 10, within half and half again of the base, softened by Tough. */
function woundLoss(s: Region1State, base: number): number {
  const con = Math.min(1.5, Math.max(0.5, 1 - 0.05 * (s.character.stats.con - 10)));
  return Math.round(base * con * talentEffects(s.character.talents).overexertCondition);
}

/** A fear of `tag` (#1362), if you don't have one yet — with the moment it took hold. */
function gainFear(next: Region1State, tag: string, at?: ReturnType<typeof stampFor>): void {
  if (hasQuirk(next, fearId(tag))) return;
  next.character = { ...next.character, quirks: [...(next.character.quirks ?? []), { id: fearId(tag), known: true, faced: 0 }] };
  const words = FEAR_OF[tag] ?? tag;
  say(next, `Something in you won't forget this. ${words.charAt(0).toUpperCase()}${words.slice(1)} will frighten you now.`, 'hardship', at);
}

/** Facing something you fear and coming through it calmly (#1362): `fades` times, and the fear is gone. */
function faceFear(next: Region1State, tags: readonly string[], fades: number, at?: ReturnType<typeof stampFor>): void {
  for (const q of next.character.quirks ?? []) {
    if (!isFear(q.id) || !tags.includes(q.id.slice(5))) continue;
    const faced = (q.faced ?? 0) + 1;
    next.character = { ...next.character, quirks: faced >= fades
      ? next.character.quirks!.filter(x => x.id !== q.id)
      : next.character.quirks!.map(x => (x.id === q.id ? { ...x, faced } : x)) };
    const words = FEAR_OF[q.id.slice(5)] ?? q.id.slice(5);
    if (faced >= fades) say(next, `You notice ${words} ${words.endsWith('s') ? 'don\'t' : 'doesn\'t'} frighten you the way ${words.endsWith('s') ? 'they' : 'it'} did.`, 'milestone', at);
  }
}

/** The environment's threat out on the land at this light (#1367), and how it sits with you. Null when the world has no fear in it. */
function landFright(s: Region1State, ring: Ring, light: number): (ReturnType<typeof frightOf> & { ambient: number; reasons: string[] }) | null {
  if (!s.config.world.encounters) return null;
  const ambient = ringAmbient(s, ring, light);
  return { ...frightOf(s, ambient, light < DUSK_LIGHT), ambient, reasons: landReasons(sceneOf(s, ring, light)).map(r => ringWordsFor(s, r)) };
}

/** A stretch of land as fear reads it (#1367). */
const sceneOf = (s: Region1State, ring: Ring, light: number): LandScene => ({
  light, weather: s.weatherToday ?? 'clear', blizzard: isBlizzard(s.weatherToday, s.day, s.config.calendar), ring,
  winter: seasonOf(s.day, s.config.calendar) === 'winter', knownGround: domainsOf(ring).every(d => level(s.explore, ring, d) >= 3),
});

/** How frightening a ring is, 0–4, at this light (#1367) — with what the places you remember there do to it (#1379). */
export function ringAmbient(s: Region1State, ring: Ring, light: number): Threat {
  const scene = sceneOf(s, ring, light);
  // The places you remember there (#1379): a peaceful glade calms the ring, an eerie carving darkens it —
  // and something that awed you means the dark there is no worse than the day.
  const felt = awedIn(s.pins, ring) ? Math.min(landAmbient(scene), landAmbient({ ...scene, light: 1 })) : landAmbient(scene);
  return Math.max(0, Math.min(4, felt + pinAmbient(s.pins, ring))) as Threat;
}

/**
 * How frightening a queued land trip will be (#1364): your state, and why — for the queue
 * preview and the AI's observation. Null for camp work, or in a world without fear.
 */
export function tripUnease(s: Region1State, item: QueueItem): { state: PanicState; perceived: Threat; reasons: string[] } | null {
  const { id, ring } = parseItem(item);
  if (!ACTIONS[id].ringed) return null;
  const f = landFright(s, ring, stampFor(s, queueHours(item, s)).light);
  return f && { state: f.state, perceived: f.perceived, reasons: f.reasons };
}

/** Tonight's scene (#1367): the weather, the season, shelter, fire, and how long you've lived here. */
function nightSceneOf(s: Region1State, fire: boolean, fireKept: boolean): NightScene {
  return {
    weather: s.weatherToday ?? 'clear', blizzard: isBlizzard(s.weatherToday, s.day, s.config.calendar), winter: seasonOf(s.day, s.config.calendar) === 'winter',
    sheltered: s.tier > 0, fire, fireKeptWarm: fireKept && s.tier >= 2, campDays: s.site && s.siteDay !== undefined ? s.day - s.siteDay : 0,
  };
}

/**
 * How tonight looks from here (#1364): if you went to bed now, would it be a fearful night? The
 * fire is judged as the night will judge it: kept in if the frost asks for it and there's wood
 * enough, otherwise lit if there's any wood at all. Null in a world without fear.
 */
export function tonightsFright(s: Region1State): { state: PanicState; perceived: Threat; reasons: string[] } | null {
  if (!s.config.world.encounters) return null;
  const shelterW = Math.max(0, warmth(s) - windChill(s.weatherToday));
  const need = feelsTemperature(s) ? nightFire(s, nightTemp(s.day, s.weatherToday, s.config.calendar), s.weatherToday, shelterW) : 0;
  const kept = need > 0 && s.stores.firewood >= need;
  const scene = nightSceneOf(s, kept || (need === 0 && s.stores.firewood > 0), kept);
  const f = frightOf(s, nightAmbient(scene), true);
  return { state: f.state, perceived: f.perceived, reasons: nightReasons(scene) };
}

/** What a spook makes you do (#1367), by panic response: the journal line. */
export const SPOOK_LINE: Readonly<Record<PanicResponse, string>> = {
  flight: 'Something moved out there, and you ran for camp — dropping half of what you carried.',
  freeze: 'You froze where you stood, every sense straining, until it passed. Hours gone, and nothing to show for them.',
  fight: 'Every nerve says go home. You push on regardless, jaw set.',
  fawn: 'You leave a little food on a stone for whatever is out there, and go home with what you can carry.',
};

/**
 * Frightened on the land (#1367). Coming through it grows the nerve. Panicked, a seeded roll for
 * the hour may spook you, and your panic response decides what that means: a runner bolts home
 * (half the haul dropped, the work cut short), a freezer loses two hours and comes back with
 * nothing, a fighter pushes on (#1285's accidents will bite harder), an appeaser leaves food and
 * goes home. A spook is a panic: the crash follows, your response shows itself, and in the dark
 * it may leave a fear of it.
 */
function landPanic(next: Region1State, fright: { perceived: number; nerve: number; state: PanicState }, before: Stores, workHours: number, at: ReturnType<typeof stampFor>): void {
  growFrom(next, { kind: 'fright', panicked: fright.state === 'panicked' });
  if (fright.state !== 'panicked') return;
  if (streamFor(seedOf(next.character.id), next.day, `spook@${at.hour}`)() >= spookChance(fright.perceived - fright.nerve)) return;
  const instinct = responseOf(next);
  const drop = (keep: (gained: number) => number): void => {
    for (const k of STORE_KEYS) { const gained = next.stores[k] - before[k]; if (gained > 0) next.stores[k] = before[k] + keep(gained); }
  };
  if (instinct === 'flight' || instinct === 'fawn') { drop(g => Math.floor(g / 2)); next.hoursToday = Math.max(0, next.hoursToday - workHours / 2); }
  if (instinct === 'fawn' && next.stores.rawFood > 0) next.stores.rawFood -= 1;
  if (instinct === 'freeze') { drop(() => 0); next.hoursToday += FREEZE_HOURS; }
  say(next, SPOOK_LINE[instinct], 'hardship', at);
  const quirk = next.character.quirks?.find(q => RESPONSE_QUIRK[q.id]);
  if (quirk) revealQuirk(next, quirk.id, at);
  crash(next, at);
  if (at.light < DUSK_LIGHT) gainFear(next, 'dark', at);
}

/** Make a quirk known (#1362), with its line in the journal — once. */
function revealQuirk(next: Region1State, id: string, at?: ReturnType<typeof stampFor>): void {
  const r = reveal(next.character.quirks, id);
  if (!r.revealed) return;
  next.character = { ...next.character, quirks: r.quirks };
  say(next, QUIRKS[id]?.revealed ?? `You learn something about yourself: ${id}.`, 'milestone', at);
}

/** A craft made with shaking hands (#1361): one grade worse (never below crude), on the item and in the report. */
function shakyMade(next: Region1State, made: Extract<CraftResult, { kind: 'crafted' }>): CraftResult {
  const grade = GRADES[Math.max(0, GRADES.indexOf(made.grade) - SHAKING_GRADE)];
  const at = next.tools.map(t => t.item).lastIndexOf(made.output.item);
  if (at >= 0 && next.tools[at].grade === made.grade) next.tools[at] = { ...next.tools[at], grade };
  return { ...made, grade };
}

/** After a stretch of land work that ran, roll for an encounter (#1343), and pause the day if one comes. */
function maybeEncounter(before: Region1State, next: Region1State, item: QueueItem): void {
  const { id, ring } = parseItem(item);
  const hours = next.hoursToday - before.hoursToday;
  if (next.outcome || !next.config.world.encounters || !ACTIONS[id].ringed || hours <= 0 || next.encounterDay === next.day) return;
  const at = stampFor(before, hours);
  const t = encounterFor(seedOf(next.character.id), next.day, at.hour, ring, seasonOf(next.day, next.config.calendar), at.light < 0.5);
  if (!t) return;
  // How it looks, and whether you can hold (#1360). Shaken, the fright itself costs some Clarity.
  // The hour's own threat (#1367): met in the dark or a storm, anything looks worse.
  const read = readThreat(next, t, landFright(next, ring, at.light)?.ambient ?? 0);
  // A temperament shows itself the first time it changes how you stand (#1362).
  for (const id of ['reckless', 'jumpy'] as const) {
    if (!hasQuirk(next, id) || next.character.quirks!.find(q => q.id === id)!.known) continue;
    const without = readThreat({ ...next, character: { ...next.character, quirks: next.character.quirks!.filter(q => q.id !== id) } }, t);
    if (without.state !== read.state) revealQuirk(next, id, at);
  }
  next.pending = { id: t.id, day: next.day, hour: at.hour, ring, action: id, perceived: read.perceived, state: read.state, margin: read.perceived - read.nerve };
  next.encounterDay = next.day;
  say(next, t.text, 'hardship', at);
  if (read.state !== 'calm') {
    next.vitals = { ...next.vitals, clarity: { ...next.vitals.clarity, current: Math.max(0, next.vitals.clarity.current - SHAKEN_CLARITY) } };
    say(next, read.state === 'shaken' ? 'Your heart is hammering.' : 'Panic. You can barely think.', 'hardship', at);
  }
}

/**
 * Make your choice in a waiting encounter (#1343): pay its cost, roll the seeded outcome, apply
 * it, and free the day. An option you can't take is refused with the reason. Death ends the run,
 * and the journal says what killed you.
 */
export function chooseOption(s: Region1State, optionId: string): Region1State {
  if (!s.pending) return s;
  const p = s.pending;
  const t = encounterById(p.id);
  const options = t ? stepOf(t, p.step).options : [];
  const chosen = options.find(x => x.id === optionId);
  const next = clone(s);
  if (!t || !chosen) { say(next, `Choice: skipped — there's no "${optionId}" here.`, 'skip'); return next; }
  const why = unmet(next, chosen);
  if (why) { say(next, `${chosen.label}: skipped — ${why}.`, 'skip'); return next; }
  // Panicked (#1361): instinct may take over — a seeded roll, likelier the further past holding you were.
  // It reaches for the option that is your panic response; with none (or if you're a freezer), you freeze.
  let o = chosen, froze = false;
  if (p.state === 'panicked' && streamFor(seedOf(next.character.id), p.day, `panic:${p.id}`)() < overrideChance(p.margin ?? 2)) {
    const instinct = responseOf(next);
    const pick = instinct === 'freeze' ? undefined : options.find(x => x.response === instinct && !unmet(next, x));
    if (chosen.response !== (pick ? instinct : 'freeze')) {
      if (pick) o = pick; else froze = true;
      say(next, `You meant to ${chosen.label.charAt(0).toLowerCase()}${chosen.label.slice(1)}. ${INSTINCT_LINE[pick ? instinct : 'freeze']}`, 'hardship');
      // The first time your panic response fires, you learn it about yourself (#1362).
      const quirk = next.character.quirks?.find(q => RESPONSE_QUIRK[q.id]);
      if (quirk) revealQuirk(next, quirk.id);
    }
  }
  if (!froze) for (const [k, n] of Object.entries(o.cost?.stores ?? {})) next.stores[k as keyof Stores] -= n ?? 0;
  // Freezing: hours lost, and the danger decides.
  const { tier, effect } = froze ? { tier: 'fail' as const, effect: t.freeze } : rollOutcome(seedOf(next.character.id), p, o, chanceOf(next, o));
  const v = next.vitals;
  const pool = (q: Pool, d = 0): Pool => ({ ...q, current: Math.max(0, Math.min(q.cap, q.current + d)) });
  // A wound (#1344): the body decides how bad — CON softens it, and Tough.
  const wound = effect.wound ? woundLoss(next, effect.wound) : 0;
  next.vitals = { vigor: pool(v.vigor, effect.vigor), clarity: pool(v.clarity, effect.clarity), condition: Math.max(0, Math.min(100, v.condition + (effect.condition ?? 0) - wound)) };
  for (const [k, n] of Object.entries(effect.stores ?? {})) next.stores[k as keyof Stores] = Math.max(0, next.stores[k as keyof Stores] + (n ?? 0));
  // A talent that gets more from it (Hunter's Patience from a kill, #1344).
  for (const [tid, extra] of Object.entries(effect.talentStores ?? {})) {
    if (next.character.talents.some(x => x.id === tid)) for (const [k, n] of Object.entries(extra ?? {})) next.stores[k as keyof Stores] += n ?? 0;
  }
  if (effect.practice) practiceSkill(next, effect.practice.skill, effect.practice.hours);
  // What a person's dialogue can leave you with (#1346): a deed remembered, insight from talk, a map's worth of ground.
  if (effect.deed && !(next.deeds ?? []).includes(effect.deed)) next.deeds = [...(next.deeds ?? []), effect.deed];
  if (effect.insight) addInsight(next.concepts, effect.insight.concept, effect.insight.amount, CRAFT_WORLD.concepts);
  if (effect.survey) next.explore = survey(next.explore, effect.survey);
  // What a find can leave you with (#1345): a tool, a manual you didn't have, a catch by morning.
  if (effect.tool) next.tools.push({ ...effect.tool });
  // Remembering a place (#1378): a pin, kept until you let it go or the run ends.
  if (effect.pin) next.pins = [...(next.pins ?? []), { id: pinId(p.id, p.ring), place: p.id, kind: effect.pin.kind, ring: p.ring, day: p.day, ...(effect.pin.feeling ? { feeling: effect.pin.feeling } : {}) }];
  if (effect.overnight) next.overnight = [...(next.overnight ?? []), effect.overnight];
  next.hoursToday += (froze ? FREEZE_HOURS : o.cost?.hours ?? 0) + (effect.hours ?? 0);
  next.pending = null;
  say(next, froze ? effect.text : `${o.label}: ${effect.text}`, tier === 'fail' ? 'hardship' : 'action');
  // A manual found (#1345) is read after the find is told.
  if (effect.manual) { const m = MANUALS.find(x => !next.manuals.includes(x.id)); if (m) findManual(next, m.id); }
  // The dialogue goes on (#1346): the encounter stays open at the next step, and the day stays paused.
  if (effect.next && !froze && next.vitals.condition > 0 && t.steps?.[effect.next]) {
    next.pending = { ...p, step: effect.next };
    say(next, t.steps[effect.next].text, 'hardship');
    return next;
  }
  // The crash after a panic (#1361): the adrenaline drains away and leaves you wrung out and shaking.
  if (p.state === 'panicked') crash(next);
  // Coming through a fright grows the nerve (#1363): Steady from any, Surge from panic.
  if (p.state && p.state !== 'calm' && !next.outcome) growFrom(next, { kind: 'fright', panicked: p.state === 'panicked' });
  // Fears (#1362): a panic that ends badly leaves one; facing its kind calmly, again and again, fades it.
  // Only a kind of danger can leave a fear: a harmless find (`find`) can't.
  if (p.state === 'panicked' && tier === 'fail' && t.tags[0] && FEAR_OF[t.tags[0]]) gainFear(next, t.tags[0]);
  else if (p.state !== 'panicked' && tier !== 'fail') faceFear(next, t.tags, FEAR_FADES);
  // Tough's last stand (#1263) holds here too: once a run, you cling on.
  if (next.vitals.condition <= 0 && talentEffects(next.character.talents).lastStand && !next.character.lastStandUsed) {
    next.vitals = { ...next.vitals, condition: 1 };
    next.character = { ...next.character, lastStandUsed: true };
    say(next, 'It should have been the end of you. It isn\'t. Condition 1 — that was your one reprieve.', 'hardship');
  }
  if (next.vitals.condition <= 0) {
    next.outcome = { choice: 'collapse', kind: 'died', vitals: next.vitals };
    say(next, `Killed by ${effect.killedBy ?? 'what you met out there'}.`, 'outcome');
  } else {
    // Lived through it (#1360): next time it looms a little less.
    next.met = { ...(next.met ?? {}), [t.id]: (next.met?.[t.id] ?? 0) + 1 };
  }
  return next;
}

/**
 * Going back to a ring where you remember a place (#1379): an hour of Memory practice, once a day —
 * and the first return to something that awed you teaches a little.
 */
function revisit(next: Region1State, ring: Ring, at: LogEntry['at']): void {
  // A place found on an earlier day: today's find isn't a return to it.
  const here = (next.pins ?? []).filter(p => p.ring === ring && p.day < next.day);
  if (!here.length) return;
  if (!next.today.revisited) {
    next.today.revisited = true;
    // A quiet line in the journal (#1380) — louder for a place you know well (★★★).
    const known = [...here].sort((x, y) => (y.interest ?? 0) - (x.interest ?? 0))[0];
    say(next, `You go back by ${placeName(known)} you remembered.`, known.interest === 3 ? 'milestone' : 'action', at);
    practiceSkill(next, 'memory', 1);
  }
  for (const p of here) if (p.feeling === 'awed' && !p.visited) {
    addInsight(next.concepts, 'sealing', AWED_INSIGHT, CRAFT_WORLD.concepts);
    say(next, 'Back by the carving. Knowing what you are looking for, you see more in it this time.', 'action', at);
  }
  next.pins = next.pins!.map(p => (here.includes(p) ? { ...p, visited: true } : p));
}

/** Insight from going back to something that awed you (#1379). */
const AWED_INSIGHT = 2;

/**
 * How much a place interests you (#1379): ★ to ★★★, or none (0). You can't weigh places until
 * Memory reaches Apprentice; ★★★ opens at Adept. Returns the state unchanged if you can't.
 */
export function setInterest(s: Region1State, id: string, stars: 0 | Interest): Region1State {
  const pin = s.pins?.find(p => p.id === id);
  if (!pin || stars > maxInterest(s.skills)) return s;
  const next = clone(s);
  next.pins = next.pins!.map(p => (p.id !== id ? p : stars ? { ...p, interest: stars } : (({ interest: _, ...rest }) => rest)(p)));
  return next;
}

/** Let a place go (#1378), freeing room in your memory for another. */
export function forgetPin(s: Region1State, id: string): Region1State {
  const pin = s.pins?.find(p => p.id === id);
  if (!pin) return s;
  const next = clone(s);
  next.pins = next.pins!.filter(p => p.id !== id);
  say(next, `You let it go: ${PIN_WORDS[pin.kind]} in the ${RING_NAME[pin.ring].toLowerCase()} ring.`, 'action');
  return next;
}

/**
 * What an heirloom's maker put into it (#1456): the first time the work leans on it, each concept
 * it was `made` with teaches at the maker's rank — once per item, per run. Only heirlooms teach
 * (#1469): your own tool doesn't give you back what you put into it. Every heirloom the action
 * leans on teaches, not only the best-graded one; and a lesson stays with the tool until it has
 * somewhere to go (a concept at its full rank, or still locked, takes nothing and spends nothing).
 */
function teachFromTool(next: Region1State, actions: readonly string[]): void {
  // The copies the work actually uses: one of each item, the best (an heirloom shadowed by your own better one isn't in hand).
  for (const tool of bestPerItem(next.tools)) {
    if (!tool.heirloom || (next.taughtBy ?? []).includes(tool.item) || !actions.some(a => toolServes(tool, a, CRAFT_WORLD.effects))) continue;
    const gained: string[] = [];
    for (const l of heirloomLesson(tool)) {
      const before = next.concepts[l.concept] ?? { rank: 0, insight: 0 };
      addInsight(next.concepts, l.concept, l.insight, CRAFT_WORLD.concepts);
      const after = next.concepts[l.concept];
      if (after && (after.rank !== before.rank || after.insight !== before.insight)) gained.push(l.concept);
    }
    if (!gained.length) continue;
    next.taughtBy = [...(next.taughtBy ?? []), tool.item];
    say(next, `The ${tool.item.replace(/-/g, ' ')} teaches you what its maker knew: ${gained.join(', ')}.`, 'milestone');
  }
}

function runActionCore(s: Region1State, item: QueueItem, stop?: number): Region1State {
  const next = clone(s);
  if (next.outcome) return next;
  const { id, ring, opts } = parseItem(item);
  const def = ACTIONS[id];
  const refused = blockedReason(next, id, ring, opts);
  if (refused) { say(next, `${def.name}${where(ring)}: skipped — ${refused}.`, 'skip'); return next; }
  // Away from camp (#1839, `directed-explore`), the work starts with the walk back to camp; a stop is
  // still counted from the start of the action's own plan, so it comes off the walk first.
  if (walksBackFirst(next, id, opts)) {
    const back = walkBack(next);
    if (stop !== undefined) stop = Math.max(0, stop - back);
  }
  // Building somewhere new moves camp first; the build then starts there from scratch.
  if (id === 'build') moveForBuild(next, opts);
  const recipe = def.recipeFor?.(next, opts) ?? def.recipe;
  // Done once more (#1827, `forecasts`): the task at this distance, or a try at this recipe. A count, no dice.
  // A task stopped partway still counts (the owner): you were out there and saw what it brings, as a failed craft does.
  // Stopped before any of its own work began (at 0h, or during the walk back) it was never tried, so it doesn't.
  if (forecastsOn(next) && (stop === undefined || stop > 0)) noteFamiliar(next, recipe ? craftKey(recipe.id) : taskKey(id, def.ringed ? ring : 1));
  // An heirloom's maker teaches the first time it's leaned on (#1456) — out on the land, and at the bench
  // or building too (#1469): crafts and builds go to runCraft below, so the lesson lands first.
  teachFromTool(next, recipe ? [id, 'craft'] : [id]);
  if (recipe) return runCraft(next, id, recipe, stop);
  // Your tools make the work cheaper, quicker or richer (crafting design §2) —
  // and your skill in the field makes it cheaper still, richer, and gets more from the tools (#1236).
  const mod = modifiersFor(next.tools, id);
  const skill = skillFor(id);
  const lvl = skill ? skillLevel(next.skills, skill) : 0;
  const v = def.variant?.(opts, next, ring) ?? {};
  const pain = painOf(next);
  // How long it takes (#1475): rain, deep snow and a blizzard (#1284, #1315), the tools, the map and
  // compass (#1400), agony (#1409) — and the walk to an outer ring, hard on the legs, easy on the mind.
  // A session of chosen length (#1668) is its trips: the work at the site and a walk per trip.
  const session = sessionOf(s, item);
  const usual = actionHours(next, id, ring, opts);
  const planWork = session ? session.plan.work : usual.work;
  const planTravel = session ? session.plan.travel : usual.travel;
  const td = talentDrain(next.character.talents, id);
  const tf = talentEffects(next.character.talents);
  // Stats (#1256): Strength for heavy work, Agility for nimble work and the walk, Willpower for the mind.
  const se = statEffects(next.character.stats);
  const sd = statDrain(next.character.stats, id, skill);
  // Focus (#1238): goal or survival work is lighter and richer; a focused skill practises faster.
  const fx = workEffects(next.focus, survivalLockOf(next), id, skill, next.vitals.clarity.current, se.unreliableBelow);
  // Techniques you know (#1243): richer, lighter work — and Pathfinding eases the walk out.
  const te = techniqueEffects(next.techniques, id, undefined, def.ringed);
  // The light the work has (#1280), and what the dark costs (#1281): heavier felling, a harder walk.
  // Judged on the plan's hours even when it's stopped (#1815): the same hour, the same light, the same luck.
  const at = stampFor(next, planWork + planTravel);
  const wd = weatherDrain(next.weatherToday, id, !!def.ringed, ring);
  const dw = darkWorkDrain(id, at.light) * coldWork(next, at.hour) * wd, dt = darkTravelDrain(at.light);
  // Exhausted from yesterday's loads (#1293): everything drains more today.
  const ex = next.today.exhausted ? EXHAUSTED_DRAIN : 1;
  // The dark, the weather, the distance (#1367): how frightening this stretch is. Uneasy, the work wears the mind.
  const fright = def.ringed ? landFright(next, ring, at.light) : null;
  const uneasy = fright && fright.state !== 'calm' ? UNEASE_CLARITY : 1;
  // How you set out (#1285): tired or foggy at the start, out there you're likelier to get hurt.
  const setOut = { vigor: next.vitals.vigor.current, clarity: next.vitals.clarity.current };
  // A sprain (#1286): physical work and walking cost more while it lasts.
  const sprain = injuryCost(next.injuries, 'sprain');
  // A stiff knee from an old injury (#1392): the walk out costs more, for good.
  const knee = def.ringed && next.character.harms?.includes('stiff-knee') ? STIFF_KNEE_COST : 1;
  // Talents that bring back more (Forager, Hunter's Patience, Waterfinder) — hidden ones too.
  // …and places you remember in that ring (#1379): a fishing spot, a berry thicket, good stone.
  const bonus = Math.round(mod.yieldAdd * toolMult(lvl)) + yieldBonus(lvl) + fx.yield + te.yield + (tf.yield[id] ?? 0) + (def.ringed ? pinYield(next.pins, id, ring) : 0);
  // A gathering trip rolls its luck (#1314): the fortune of its starting hour, with weather, supply, skill and light setting the odds.
  const luck = tripLuck(next, id, ring, at, lvl, te.yield > 0 || te.drain < 1);
  // Out in a blizzard (#1315): the white decides how you come back — if you do.
  const exposure = inBlizzard(next, id) ? exposureFor(streamFor(seedOf(next.character.id), next.day, `blizzard@${at.hour}`)(), (next.coldGear ? 1 : 0) + (knowsTheCold(next.character) ? 1 : 0) + (hasKit(next, 'hat-mittens') ? 1 : 0) - (ring - 1)) : null;
  // (Worked out before the hours are, since a hunt's kill can end it early, #1821: all pure, nothing drawn twice.)
  const lost = exposure === 'lost';
  const luckMult = lost ? 0 : luck ? BAND_MULT[luck.band] : 1;
  // Stopped partway (#1815): the hours, Vigor and Clarity as far as you got, and the work that still counts.
  // A hunt's kill (#1815) comes at its own moment in the work, rolled only when it's stopped: a stream of its own, keyed on the hour it began.
  const kind = stopKindOf(id);
  const killAt = kind === 'kill' ? killMoment(seedOf(s.character.id), s.day, s.hoursToday) : 1;
  // A kill ends the hunt (#1821, `hunting-gear`): you walk home with it at its moment, the hours left over
  // yours, unless the catch keeps you within a comfortable load — then you stow it and hunt on. A deer
  // never fits. The same moment a stop reads (#1815), so the hunt is cut there as a stop after the kill is.
  const hunt = id === 'hunt' && stop === undefined && huntingGearOn(next) && luckMult > 0 ? huntEnding(next, ring, opts, bonus, luckMult) : null;
  const atStop = hunt === 'ends' ? planTravel / 2 + killAt * planWork : stop;
  const cut = atStop === undefined ? null : cutTrips(session ? session.plan.trips : [{ travel: planTravel, work: planWork }], atStop, kind, killAt);
  const workHours = cut ? cut.work : planWork;
  // Walking the map (#1876, `walk-the-map`): the trip's square and its path. A stop leaves the Warden
  // on the path (`leg`): the walk is as far as they got, with no walk back yet (the next work starts
  // with it), and that holds on the last walk home too, where there's nothing of the work to cut.
  const trip = def.ringed ? tripOf(next, id, ring, opts) : null;
  const leg = trip && stop !== undefined ? legAt(session ? session.plan.trips : [{ travel: planTravel, work: planWork }], stop) : null;
  const travel = leg ? leg.walked : cut ? cut.travel : planTravel;
  // The hand axe (#1870): chopping wood costs half the Vigor (kit.ts `kitVigorMult`; 1 for everything else).
  const kv = kitVigorMult(next, id);
  const r = applyActivity(next.vitals, { hours: workHours, vigorRate: (v.vigorRate ?? def.vigorRate) * sprain * mod.vigorMult * drainMult(lvl) * td.vigor * sd.vigor * fx.drain * te.drain * dw * ex * kv, clarityRate: (v.clarityRate ?? def.clarityRate) * mod.clarityMult * drainMult(lvl) * td.clarity * sd.clarity * fx.drain * te.drain * wd * ex * uneasy * PAIN_DRAIN[pain] });
  // A heavy pack (#1871, `pack-volume`): over the comfortable weight, the walk costs more Vigor until camp is made.
  const t = applyActivity(r.vitals, { hours: travel, vigorRate: TRAVEL_VIGOR_RATE * sprain * knee * te.travelDrain * se.travel * dt * ex * packWalkMult(next), clarityRate: TRAVEL_CLARITY_RATE * te.travelDrain * se.travel * dt * ex * uneasy * PAIN_DRAIN[pain] });
  next.vitals = t.vitals;
  next.today.loadVigor += r.loadVigor + t.loadVigor;
  next.today.loadClarity += r.loadClarity + t.loadClarity;
  next.today.pushedVigor ||= r.pushedVigor || t.pushedVigor;
  next.today.pushedClarity ||= r.pushedClarity || t.pushedClarity;
  next.hoursToday += workHours + travel;
  // Stats grow (#1257): the right skill builds its stat, hard work STR and CON (or INT and WIL), and a tired mind the will.
  exerciseStats(next, exerciseFrom({
    hours: workHours, skill, level: lvl, vigorRate: v.vigorRate ?? def.vigorRate, clarityRate: v.clarityRate ?? def.clarityRate,
    pushed: r.pushedVigor, tiredMind: setOut.clarity < WIL_EXERCISE_BELOW || !!survivalLockOf(s), study: id === 'study',
  }));
  // Out on the land, or deep in study (#1305): either keeps cabin fever off.
  if (def.ringed) next.today.outside = true;
  if (id === 'study') next.today.absorbed = true;
  // Out in the rain, you get soaked (#1284).
  // Rain gear (#1400) keeps you dry twice as long.
  // Rubber boots (#1727, with the odd things on) keep your feet out of it, a quarter slower again.
  if (def.ringed && next.weatherToday === 'rain') next.wetHours = (next.wetHours ?? 0) + (workHours + travel) * (hasKit(next, 'rain-gear') ? RAIN_GEAR_WET : 1) * (hasExtra(next, 'rubber-boots') ? BOOTS_WET : 1);
  // Tough (#1263): pushing past empty costs less Condition — give back the part it spares.
  refundOverexertion(next, r.conditionLost + t.conditionLost, tf.overexertCondition);

  if (exposure === 'killed') {
    next.vitals.condition = 0;
    next.outcome = { choice: 'collapse', kind: 'died', vitals: next.vitals };
    say(next, `You went out into the blizzard${where(ring)} and lost the way back. They find you at the thaw.`, 'outcome', at);
    return next;
  }
  // Where the trip went (#1876), once the Warden got there.
  const went = trip && leg?.leg !== 'out' ? tripLine(next, trip) : null;
  if (went) say(next, went, 'action', at);
  const before = { ...next.stores };
  // The share of the work whose yield is kept, when stopped (#1815): 1 for the whole action.
  let kept = cut ? (planWork > 0 ? cut.kept / planWork : 0) : 1;
  if (cut && !def.ringed) {
    // Stopped at camp: the time is spent and nothing is done.
    say(next, `${def.name}: stopped — nothing made, and nothing used up.`, 'action', at);
  } else {
    const was = { explore: next.explore, flags: { ...next.flags } };
    const said = def.run(next, bonus, ring, opts, at.light, luckMult, session ? scaleOf(session) : ONE_TRIP);
    if (hunt === 'ends') {
      // Ended on its kill (#1821): the catch whole, and the walk home from there.
      say(next, said, 'action', at);
      say(next, `The kill came ${hrs1(killAt * planWork)}h into the hunt: you headed home with it, and the rest of the time is yours.`, 'action', at);
    } else if (cut) {
      // An empty hunt has no kill to keep, whenever it's stopped.
      if (kind === 'kill' && cut.phase === 'work' && next.stores.rawFood <= before.rawFood) kept = 0;
      keepShare(next, before, was, kept);
      // Traps (#1821) stopped before they were set aren't set.
      if (id === 'traps' && kept <= 0) next.traps = s.traps;
      // Sinew (#1821) is the catch's: kept as the catch is, none from a hunt given up before its kill.
      const sinewGot = sinewOf(next) - sinewOf(s);
      if (sinewGot > 0) next.sinew = sinewOf(s) + Math.floor(sinewGot * kept + 1e-9);
      say(next, stopLine(def.name + where(ring), cut, kept, kind, hrs1(cut.kept)), 'action', at);
    }
    // Make camp (#1732) has its say in moveCamp; every other action's line is said here, as always.
    else if (said || id !== 'camp') say(next, said, 'action', at);
    // Stowed and hunted on (#1821): the rest of the planned hours, with another chance at a catch.
    if (hunt === 'on') huntOn(next, before, ring, at, s.hoursToday);
  }
  // The walk done (#1876): the squares walked are seen, and a stop leaves the Warden out on the path.
  if (trip) { const stopped = endWalk(next, trip, leg); if (stopped) say(next, stopped, 'action', at); }
  // A session (#1668): how its trips went, and what it left of the patches (as far as it got, when stopped).
  if (session) {
    next.patches = withPatches(next.patches, ring, cut ? partOf(session.plan.end, Object.fromEntries(Object.keys(session.plan.end).map(p => [p, abundance(s.patches, ring, p as PatchId)])), kept) : session.plan.end);
    if (!cut) say(next, sessionLine(session), 'action', at);
  }
  // What you can carry home (#1291): a trip's haul is what it added to the stores, and what won't fit stays out there.
  if (def.ringed && next.config.world.carrying !== false) carryHome(next, before, at, ring, travel / 2, TRAVEL_VIGOR_RATE * te.travelDrain * se.travel * dt * ex, cut ? cut.trips : session?.plan.trips.length ?? 1);
  const luckLine = !lost && kept > 0 && luck && bandLine(luck.band, luck.shifts);
  if (luckLine) say(next, luckLine, luck!.band === 'good' ? 'action' : 'hardship', at);
  if (exposure) {
    next.vitals.condition = Math.max(0, next.vitals.condition - EXPOSURE_COST[exposure] * talentEffects(next.character.talents).coldCost);
    say(next, exposure === 'lost' ? 'Lost in the white for hours — you dropped everything you carried to find the way home.'
      : exposure === 'frostbitten' ? 'The blizzard bit deep: frostbitten fingers, a face that burns.' : 'A rough few hours in the blizzard, but you came back.', 'hardship', at);
  }
  // Accidents (#1285): out on the land, the worst hour of the trip against its risk.
  if (def.ringed && next.config.world.accidents && !next.outcome) {
    const risk = accidentRisk({ hours: workHours + travel, light: at.light, weather: next.weatherToday ?? 'clear', walking: travel > 0, blizzard: inBlizzard(next, id), vigor: setOut.vigor, clarity: setOut.clarity, skillLevel: lvl });
    const accident = rollAccident(worstFortune(seedOf(next.character.id), next.day, at.hour, workHours + travel), risk, workHours + travel);
    if (accident) applyAccident(next, accident, before, at, accidentLine(accident, next.weatherToday ?? 'clear', at.light < DUSK_LIGHT, false), id, setOut.vigor < EXHAUSTED_BELOW);
  }
  // Working through a serious injury (#1392) can make it grave.
  if (def.ringed || HEAVY_WORK_ACTIONS.includes(id)) aggravate(next, id, ring, false, at);
  // …and it hurts (#1409): straining a serious or grave injury makes the pain sharper.
  feelStrain(next, id, ring, false, at);
  // Frightened out there (#1367): coming through grows the nerve, and a panic may spook you off the land.
  // A calm stretch in the dark is one more step towards not fearing it.
  if (fright && fright.state !== 'calm') landPanic(next, fright, before, workHours, at);
  else if (fright && at.light < DUSK_LIGHT) faceFear(next, ['dark'], DARK_FADES, at);
  // First into a ring, you may find a manual someone left behind (#1243).
  const manual = (id === 'scout' || id === 'explore') && !cut && !tooDarkToSee(id, at.light) && !blindInFog(next.weatherToday, id) ? MANUAL_BY_RING[ring] : undefined;
  if (manual && !next.manuals.includes(manual)) findManual(next, manual);
  if (r.conditionLost + t.conditionLost > 3) say(next, 'Pushed past empty — it cost your health.', 'hardship');
  if (skill) practiceSkill(next, skill, workHours * fx.practice);
  // Getting better opens new ways to explore (#1689), each with a line in the journal.
  if (visibilityOn(next)) for (const u of newlyOpen(s, next)) say(next, u.line, 'milestone', at);
  // Knowing home ground well, with something to draw on, you draw your own map (#1686): said once,
  // on the trip that makes it possible (both only ever come true, so it can't happen twice).
  if (!canDrawMap(s) && canDrawMap(next)) say(next, mapDrawnLine(next), 'milestone', at);
  // Turned back on the way out (#1815), you never reached the place.
  if (def.ringed && cut?.phase !== 'out') revisit(next, ring, at);
  // Meat at camp (#1823, `camp-scavengers`): while you were away long enough, the meat lying out at
  // camp (what was there when you set out, not what you bring back) may have drawn a fox or ravens.
  // Its own stream, keyed on the hour you set out. Then a hunt's catch comes in as meat.
  if (def.ringed && scavengersOn(next) && !next.outcome) {
    const caught = id === 'hunt' ? Math.max(0, next.stores.rawFood - s.stores.rawFood) : 0;
    // A banked fire (#1865, `banked-fire`) guards it, if it lasted the trip: false with the switch off,
    // so the guards are [] and the roll is the one it always was. Behind walls (#1858, `walled-larder`),
    // nothing bigger than a mouse gets at it either way (openGuards adds the walls on top).
    const fire = bankedNow(s) && fireLasted(next, s, at);
    if (workHours + travel >= LONG_AWAY_HOURS) scavenge(next, openMeatOf(s), awayScavengers(seedOf(next.character.id), s.day, s.hoursToday), openGuards(s, awayGuards(fire)), false, at);
    addMeat(next, caught);
  }
  // Talents grow quietly from the work that uses them (#1264) — hidden ones too.
  growFrom(next, { kind: 'work', action: id, hours: workHours, practised: skill !== null });
  latchMilestones(next);
  return next;
}

/**
 * How a hunt with a kill goes on (#1821, `hunting-gear`): `ends` at its kill, or `on` — the catch
 * stowed within a comfortable load (load.ts, with your gear: a backpack makes room) and the hunt
 * going on to its planned hours. A deer never fits: you carry it home. The catch is worked out as
 * the hunt's `run` will (the same land, bonus and luck), so nothing is drawn for it.
 */
function huntEnding(s: Region1State, ring: Ring, opts: ActionOpts, bonus: number, luckMult: number): 'ends' | 'on' {
  if (huntTarget(s, opts) !== 'small') return 'ends';
  const n = haul(s, ring, 'game', landYield(s.explore, ring, 'game', 3, 1) + bonus + findBonus(s, ring, 'game'), luckMult);
  const catchLoad: Haul = { rawFood: n };
  const snow = (s.snowDepth ?? 0) > 0 || s.weatherToday === 'snow';
  const gear = bestGear(s.tools, { ring, snow }, catchLoad, s.character.stats);
  return cumbersome(catchLoad, gear) <= comfortableLoad(s.character.stats) + 1e-9 ? 'on' : 'ends';
}

/**
 * Hunting on with the catch stowed (#1821): the rest of the planned hours bring another chance at
 * small game, at the hunt's odds (the true Hunting level), half the first catch again. Its own
 * string-keyed stream, keyed on the hour the hunt began. Mutates `next`.
 */
function huntOn(next: Region1State, before: Stores, ring: Ring, at: LogEntry['at'], began: number): void {
  const first = next.stores.rawFood - before.rawFood;
  if (first <= 0) return;
  const chance = CATCH_CHANCE[trueHuntOdds(next, 'hunt', ring)];
  const more = huntOnFortune(seedOf(next.character.id), next.day, began) < chance ? Math.max(1, Math.round(first / 2)) : 0;
  if (more > 0) next.stores.rawFood += more;
  say(next, more > 0 ? `The catch was light enough to stow, so you hunted on — and took more: ${more} raw food.${sinewNote(addSinew(next, SINEW_SMALL))}` : 'The catch was light enough to stow, so you hunted on, but nothing more came.', 'action', at);
}

/**
 * The night's trap lines (#1821, `hunting-gear`), checked by morning: each one set today has a
 * seeded chance of small game, at its odds there (the true Hunting level), from a stream of its own
 * keyed on the day and the distance. A catch thins the game there again. Then the lines are gone:
 * set them again for another night. With luck off (the flat world) every line catches. Mutates `next`.
 */
function checkTraps(next: Region1State): void {
  const lines = next.traps;
  if (!lines?.length) return;
  next.traps = undefined;
  for (const r of lines) {
    const chance = CATCH_CHANCE[trueHuntOdds(next, 'traps', r)];
    const caught = next.config.world.luck === false || trapFortune(seedOf(next.character.id), next.day, r) < chance;
    if (!caught) { say(next, `By morning your traps${where(r)} were empty.`, 'action'); continue; }
    const n = trapCatchOf(next.explore, r);
    next.stores.rawFood += n;
    addMeat(next, n);
    next.flags.everFood = true;
    const e = { ...next.explore, supply: { ...next.explore.supply, [r]: { ...next.explore.supply[r], game: Math.max(0, Math.round((next.explore.supply[r].game - SUPPLY_DRAW.game) * 1000) / 1000) } } };
    next.explore = e;
    say(next, `By morning your traps${where(r)} held small game — ${n} raw food.${sinewNote(addSinew(next, SINEW_SMALL))}`, 'action');
  }
}

/**
 * What a stopped action keeps (#1815): of what the whole action brought (the stores, and what it
 * taught of the land and drew from it), the share `f` of the work done. Each store's change is cut
 * to that share, rounded down; the land's knowledge and supply move that share of the way. Nothing
 * kept, nothing changed at all (the flags too: no first water, no first hunt). Mutates `next`.
 */
function keepShare(next: Region1State, before: Stores, was: { explore: Region1State['explore']; flags: Region1State['flags'] }, f: number): void {
  for (const k of STORE_KEYS) {
    const d = next.stores[k] - before[k];
    next.stores[k] = before[k] + Math.sign(d) * Math.floor(Math.abs(d) * f + 1e-9);
  }
  if (f <= 0) { next.explore = was.explore; next.flags = was.flags; return; }
  const e = next.explore;
  type Grid = typeof e.known;
  const grid = (to: Grid, from: Grid): Grid => Object.fromEntries(RINGS.map(r => [r, Object.fromEntries((Object.keys(to[r]) as Domain[]).map(d => [d, from[r][d] + (to[r][d] - from[r][d]) * f]))])) as unknown as Grid;
  // A find comes with the detailed knowledge that earns it: only with the whole of the work.
  next.explore = { ...e, known: grid(e.known, was.explore.known), supply: grid(e.supply, was.explore.supply), finds: f < 1 ? [...was.explore.finds] : e.finds };
}

/** Each patch's abundance the share `f` of the way from `start` to `end` (a session stopped partway, #1815). */
const partOf = (end: Partial<Record<PatchId, number>>, start: Partial<Record<PatchId, number>>, f: number): Partial<Record<PatchId, number>> =>
  Object.fromEntries((Object.keys(end) as PatchId[]).map(p => [p, (start[p] ?? 1) + ((end[p] ?? 1) - (start[p] ?? 1)) * f]));

/** The journal's line on an action stopped partway (#1815). */
function stopLine(head: string, cut: Cut, f: number, kind: ReturnType<typeof stopKindOf>, hours: string): string {
  if (cut.phase === 'out' && f <= 0) return `${head}: stopped on the way out and turned back — nothing to show for it.`;
  // A hunt (#1815): stopped before its moment of the kill, or after it.
  if (kind === 'kill' && cut.phase === 'work') return f > 0 ? `${head}: stopped — you had already brought it down, and headed home with all of it.` : `${head}: stopped — you gave up before anything came.`;
  if (f <= 0) return `${head}: stopped before it was done — nothing to show for it.`;
  if (kind === 'see') return `${head}: stopped partway — you saw some of what was there.`;
  return `${head}: stopped after ${hours}h of the work — headed home with what you had.`;
}

/**
 * Fit a trip's haul to what the Warden can carry (#1291), leaving the rest behind — then pay for carrying it
 * (#1292): over a comfortable load, the walk home (`homeHours`, at `walkRate`) takes longer and costs more Vigor.
 * The near ring has no walk home, so there it costs nothing extra.
 */
function carryHome(next: Region1State, before: Stores, at: LogEntry['at'], ring: Ring, homeHours: number, walkRate: number, trips = 1): void {
  const haul: Haul = {};
  for (const k of STORE_KEYS) { const gained = next.stores[k] - before[k]; if (gained > 0) haul[k] = gained; }
  if (trips > 1) { carryHomeInTrips(next, haul, at, ring, homeHours, walkRate, trips); return; }
  // The gear that suits this haul (#1294) — the sled comes along only if it helps; it runs on snow.
  const snow = (next.snowDepth ?? 0) > 0 || next.weatherToday === 'snow';
  const gear = bestGear(next.tools, { ring, snow }, haul, next.character.stats);
  const { carried, left } = fitHaul(haul, gear, next.character.stats);
  for (const k of STORE_KEYS) next.stores[k] -= left[k] ?? 0;
  const line = leftLine(left);
  if (line) say(next, line, 'hardship', at);
  addTally(next, { leftStones: rawWeight(left), heaviest: rawWeight(carried) });
  const r = overloadRatio(carried, gear, next.character.stats);
  const { extraHours, extraVigor } = overloadWalk(r, homeHours, walkRate);
  if (extraHours <= 0) return;
  // Every overloaded hour builds strain (#1293), which the nights work off.
  next.strain = (next.strain ?? 0) + strainFrom(r, homeHours + extraHours);
  addTally(next, { overloadedHours: homeHours + extraHours });
  // The extra time and drain go on as one more stretch of walking (the rate covers both: drain ÷ hours).
  const w = applyActivity(next.vitals, { hours: extraHours, vigorRate: extraVigor / extraHours, clarityRate: 0 });
  next.vitals = w.vitals;
  next.today.loadVigor += w.loadVigor;
  next.today.pushedVigor ||= w.pushedVigor;
  next.hoursToday += extraHours;
  say(next, `Walked home ${overloadWord(r)} (${Math.round(extraHours * 60)} min slower).`, r > 1.5 ? 'hardship' : 'action', at);
}

/** A haul shared out over `trips` loads as evenly as whole units go: load `i` of each. */
function shareOf(haul: Haul, trips: number, i: number): Haul {
  const out: Haul = {};
  for (const k of Object.keys(haul) as (keyof Haul)[]) {
    const q = haul[k] ?? 0;
    const n = Math.floor(q / trips) + (i < q % trips ? 1 : 0);
    if (n > 0) out[k] = n;
  }
  return out;
}

/**
 * A session's haul carried home in its trips (#1668): each load fitted and walked home on its
 * own, so a planned series of comfortable loads costs nothing extra, and an over-full one pays
 * on its own walk. `homeHours` is the whole session's walking home.
 */
function carryHomeInTrips(next: Region1State, haul: Haul, at: LogEntry['at'], ring: Ring, homeHours: number, walkRate: number, trips: number): void {
  const snow = (next.snowDepth ?? 0) > 0 || next.weatherToday === 'snow';
  const left: Haul = {};
  let heaviest = 0, extraHours = 0, extraVigor = 0, strain = 0, overloaded = 0, worst = 0;
  const leg = homeHours / trips;
  for (let i = 0; i < trips; i++) {
    const load = shareOf(haul, trips, i);
    const gear = bestGear(next.tools, { ring, snow }, load, next.character.stats);
    const fit = fitHaul(load, gear, next.character.stats);
    for (const k of Object.keys(fit.left) as (keyof Haul)[]) left[k] = (left[k] ?? 0) + (fit.left[k] ?? 0);
    heaviest = Math.max(heaviest, rawWeight(fit.carried));
    const r = overloadRatio(fit.carried, gear, next.character.stats);
    const w = overloadWalk(r, leg, walkRate);
    if (w.extraHours <= 0) continue;
    worst = Math.max(worst, r);
    extraHours += w.extraHours; extraVigor += w.extraVigor;
    strain += strainFrom(r, leg + w.extraHours);
    overloaded += leg + w.extraHours;
  }
  for (const k of STORE_KEYS) next.stores[k] -= left[k] ?? 0;
  const line = leftLine(left);
  if (line) say(next, line, 'hardship', at);
  addTally(next, { leftStones: rawWeight(left), heaviest });
  if (extraHours <= 0) return;
  next.strain = (next.strain ?? 0) + strain;
  addTally(next, { overloadedHours: overloaded });
  const w = applyActivity(next.vitals, { hours: extraHours, vigorRate: extraVigor / extraHours, clarityRate: 0 });
  next.vitals = w.vitals;
  next.today.loadVigor += w.loadVigor;
  next.today.pushedVigor ||= w.pushedVigor;
  next.hoursToday += extraHours;
  say(next, `Walked home ${overloadWord(worst)} on some of the trips (${Math.round(extraHours * 60)} min slower in all).`, worst > 1.5 ? 'hardship' : 'action', at);
}

/** What a trip would bring home and what it's like to carry (#1296), for the queue preview. */
export interface TripLoad {
  /** The haul as found, before anything is left behind. */
  haul: Haul;
  /** What's left behind, if it's too much to carry. */
  left: Haul;
  /** Bulk of what's carried, and the Warden's max and comfortable loads. */
  cumbersome: number;
  max: number;
  comfortable: number;
  /** Overload ratio of what's carried (#1292): over 1 is heavy. */
  ratio: number;
  /** Carrying gear (or a waterskin) not yet owned that would make this load lighter, best first. */
  wouldHelp: (GearItem | 'waterskin')[];
  /** Whether there's a walk home to carry it on (#1292): the near ring has none, so overload costs nothing there. */
  walk: boolean;
  /** A session of chosen length (#1668): the loads it's carried home in. The bulk and ratio are the heaviest load's. Absent: one trip. */
  trips?: number;
}

/**
 * What a ringed trip from `s` would bring home (#1296): run it with carrying off to see the haul as
 * found (the same seeded luck as the real run), then fit it as the real run will. Null for camp work,
 * the flat world, or a trip that brings nothing.
 */
export function tripLoad(s: Region1State, item: QueueItem): TripLoad | null {
  const { id, ring } = parseItem(item);
  if (!ACTIONS[id].ringed || s.config.world.carrying === false) return null;
  const free = runAction({ ...s, config: { ...s.config, world: { ...s.config.world, carrying: false } } }, item);
  const haul: Haul = {};
  for (const k of STORE_KEYS) { const g = free.stores[k] - s.stores[k]; if (g > 0) haul[k] = g; }
  if (!Object.keys(haul).length) return null;
  const ctx = { ring, snow: (s.snowDepth ?? 0) > 0 || s.weatherToday === 'snow' };
  const stats = s.character.stats;
  // A session (#1668) carries its haul home in trips: judge the heaviest load (the first share), and what all of them leave.
  const trips = sessionOf(s, item)?.plan.trips.length ?? 1;
  const load = trips > 1 ? shareOf(haul, trips, 0) : haul;
  const fit = (tools: Region1State['tools']) => {
    const gear = bestGear(tools, ctx, load, stats);
    const { carried, left: one } = fitHaul(load, gear, stats);
    const left: Haul = trips > 1 ? Object.fromEntries(Object.entries(one).map(([k, n]) => [k, Math.min(haul[k as keyof Haul] ?? 0, (n ?? 0) * trips)])) : one;
    return { carried, left, gear, bulk: cumbersome(carried, gear), ratio: overloadRatio(carried, gear, stats) };
  };
  const now = fit(s.tools);
  // Gear you don't have that would ease this load: it brings more home, or carries it lighter.
  const carriedWeight = (h: Haul): number => (Object.keys(h) as (keyof Haul)[]).reduce((n, k) => n + (h[k] ?? 0), 0);
  const wouldHelp = (['waterskin', ...GEAR_ITEMS] as const).filter(g => !s.tools.some(t => t.item === g))
    .map(g => ({ g, f: fit([...s.tools, { item: g, grade: 'sound' }]) }))
    .filter(({ f }) => carriedWeight(f.carried) > carriedWeight(now.carried) || (now.ratio > 1 && f.ratio < now.ratio - 0.05))
    .sort((a, b) => a.f.ratio - b.f.ratio)
    .map(({ g }) => g);
  return { haul, left: now.left, cumbersome: now.bulk, max: maxLoad(stats), comfortable: comfortableLoad(stats), ratio: now.ratio, wouldHelp, walk: TRAVEL_HOURS[ring] > 0, ...(trips > 1 ? { trips } : {}) };
}

/** Run a craft through the crafting module and fold the result back into Region 1 (on a cloned state). */
/**
 * How the Warden comes to the bench for this recipe right now: the hours, the effort, the light and
 * the crafter with every bonus that lifts or lowers the grade. Pure; `runCraft` makes the craft from
 * it, and `craftOutlook` (#1827) reads the same, so a forecast judges the craft the sim would make.
 */
function benchFor(next: Region1State, id: ActionId, recipe: CraftRecipe) {
  const tr = talentEffects(next.character.talents);
  // A hurt hand (#1286): crafting takes longer while it lasts.
  const hours = craftHours(next, recipe);
  // Tools that serve this action (a shovel for building) lighten the craft's own effort.
  const mod = modifiersFor(next.tools, id);
  // Skill in the craft's field lightens the work and lifts the grade (#1236).
  const skill = skillFor(id, recipe.id);
  const lvl = skill ? skillLevel(next.skills, skill) : 0;
  const td = talentDrain(next.character.talents, id);
  const se = statEffects(next.character.stats);
  const sd = statDrain(next.character.stats, id, skill);
  const fx = workEffects(next.focus, survivalLockOf(next), id, skill, next.vitals.clarity.current, se.unreliableBelow);
  const te = techniqueEffects(next.techniques, id, recipe.id);
  const ex = next.today.exhausted ? EXHAUSTED_DRAIN : 1; // exhausted from yesterday's loads (#1293)
  const effort = recipe.effort && { vigorRate: recipe.effort.vigorRate * mod.vigorMult * drainMult(lvl) * td.vigor * sd.vigor * fx.drain * te.drain * ex, clarityRate: recipe.effort.clarityRate * mod.clarityMult * drainMult(lvl) * td.clarity * sd.clarity * fx.drain * te.drain * ex * PAIN_DRAIN[painOf(next)] };
  const crafter = crafterOf(next);
  // At night, close work needs firelight — or goes worse in the dark (#1281).
  const at = stampFor(next, hours);
  const night = closeWork(next, at.light, hours);
  // Intelligence (#1256) lifts — or, below average, lowers — the grade. So does a focus on the
  // craft's skill or one of its concepts (#1490): better work, not faster (survival lock overrides it).
  const focused = survivalLockOf(next) ? 0 : focusGrade(next.focus, skill, recipe.concepts ?? [], next.vitals.clarity.current, se.unreliableBelow);
  const bench: CrafterState = { ...crafter, skillBonus: craftBonus(lvl) + tr.craftGrade + te.grade + se.craftGrade + night.grade + focused + (next.character.harms?.includes('weak-grip') ? WEAK_GRIP_GRADE : 0), salvageBonus: crafter.salvageBonus + tr.salvage };
  return { tr, hours, skill, lvl, fx, effort, at, night, bench };
}

function runCraft(next: Region1State, id: ActionId, baseRecipe: CraftRecipe, stop?: number): Region1State {
  const before = next.vitals;
  const recipe = baseRecipe;
  const { tr, hours, skill, lvl, fx, effort, at, night, bench } = benchFor(next, id, recipe);
  // Stopped before it's done (#1815): the hours and the effort are spent, nothing is made, and the materials are kept.
  if (stop !== undefined && stop < hours) {
    const spent = Math.max(0, stop);
    const w = applyActivity(next.vitals, { hours: spent, vigorRate: effort?.vigorRate ?? 0, clarityRate: effort?.clarityRate ?? 0 });
    next.vitals = w.vitals;
    next.today.loadVigor += w.loadVigor;
    next.today.loadClarity += w.loadClarity;
    next.today.pushedVigor ||= w.pushedVigor;
    next.today.pushedClarity ||= w.pushedClarity;
    next.hoursToday += spent;
    say(next, `${ACTIONS[id].name}: stopped — nothing made, and nothing used up.`, 'action', at);
    return next;
  }
  const { state: c, result: made } = craft(bench, { ...recipe, effort }, CRAFT_WORLD);
  next.vitals = c.vitals;
  if (made.kind !== 'refused' && night.clarity > 1) {
    const strain = Math.max(0, before.clarity.current - c.vitals.clarity.current) * (night.clarity - 1);
    next.vitals = { ...next.vitals, clarity: { ...next.vitals.clarity, current: Math.max(0, next.vitals.clarity.current - strain) } };
  }
  refundOverexertion(next, Math.max(0, before.condition - c.vitals.condition), tr.overexertCondition);
  for (const k of STORE_KEYS) next.stores[k] = c.inventory[k] ?? 0;
  // The bow's sinew (#1821): spent from where it's kept, only by a recipe that takes it (craft() drops an emptied stack).
  if (recipe.inputs.some(i => i.item === 'sinew')) next.sinew = c.inventory.sinew ?? 0;
  if (made.kind !== 'refused') spendCloseWork(next, night);
  next.tools = c.tools;
  next.concepts = c.concepts;
  // Shaking hands after a panic (#1361): what comes off the bench is a grade worse than it would have been.
  const result = next.today.shaking && made.kind === 'crafted' ? shakyMade(next, made) : made;

  // craft() doesn't report its load, so read it off the pools for nightly drift.
  next.today.loadVigor += Math.max(0, before.vigor.current - c.vitals.vigor.current);
  next.today.loadClarity += Math.max(0, before.clarity.current - next.vitals.clarity.current);
  next.hoursToday += hours;
  next.coldGear = roadworthyGear(next.tools);

  const name = recipe.name.toLowerCase();
  const roof = (Object.keys(SHELTER_TYPES) as ShelterType[]).find(t => SHELTER_TYPES[t].recipe.id === recipe.id);
  const walls = (Object.keys(WALL_TYPES) as WallMaterial[]).find(w => WALL_TYPES[w].recipe.id === recipe.id);
  if (result.kind === 'crafted' && (roof || walls)) {
    next.tier = roof ? 1 : 2;
    // A sheltered place you remember near camp (#1379): you build where the wind doesn't reach.
    const sited = next.shelter.sited || shelterPin(next.pins);
    next.shelter = roof ? { type: roof, walls: null, ...(sited ? { sited } : {}) } : { ...next.shelter, walls: walls ?? null, ...(sited ? { sited } : {}) };
    next.shelterGrade = result.grade;
    say(next, `Raised ${article(name)}${result.grade} ${name} — tier ${next.tier}, ${Math.round(warmth(next) * 100)}% warm.`, 'action', at);
  } else if (result.kind === 'crafted' && recipe.id === COLD_PIT_RECIPE.id) {
    // The pit is part of the camp, not something you carry.
    next.tools = next.tools.filter(t => t.item !== COLD_PIT_RECIPE.output.item);
    next.coldPitAt = next.site;
    // A new pit starts with no rot carried over (#1757), even if one was left behind earlier today,
    // and with no lid (#1857): the old pit's lid, and its meat, stay with the old pit.
    delete next.pitRot;
    delete next.pitLid;
    delete next.meatPit;
    say(next, `Dug a cold pit and lined it with stone — it keeps ${coldPitHolds(next.site)} raw food cold${featureOn(next.config.world.features, 'cold-pit-slows') ? ' and slows the rot' : ''}.`, 'action', at);
  } else if (result.kind === 'crafted') {
    say(next, `Crafted ${article(name)}${result.grade} ${name}.${id === 'coldGear' ? (next.coldGear ? ' Good gear for the winter.' : " Crude — it won't hold up through a winter.") : ''}`, 'action', at);
  } else if (result.kind === 'failed') {
    const back = result.salvaged.map(b => `${b.qty} ${b.item}`).join(', ');
    say(next, `The ${name} came apart in your hands — materials wasted${back ? ` (salvaged ${back})` : ''}. Too foggy for fine work.`, 'hardship');
  }
  // Accidents at the bench (#1285): a slipped knife, a split stone. Separate from a failed craft — both can happen.
  if (result.kind !== 'refused' && next.config.world.accidents) {
    const careful = next.character.talents.find(t => t.id === 'carefulHands')?.tier ?? 0;
    const risk = craftRisk({ hours, blade: BLADE_CRAFTS.includes(recipe.id), building: !!(roof || walls), light: at.light, firelight: night.fire > 0, vigor: before.vigor.current, clarity: before.clarity.current, skillLevel: lvl, carefulTier: careful });
    const accident = rollAccident(worstFortune(seedOf(next.character.id), next.day, at.hour, hours), risk, hours, true);
    if (accident) applyAccident(next, accident, null, at, accidentLine(accident, next.weatherToday ?? 'clear', at.light < DUSK_LIGHT, true), 'craft', before.vigor.current < EXHAUSTED_BELOW);
  }
  if (result.kind !== 'refused') { aggravate(next, id, 1, true, at); feelStrain(next, id, 1, true, at); }
  // Even a failed attempt is practice (refused crafts never got this far).
  if (skill && result.kind !== 'refused') practiceSkill(next, skill, hours * fx.practice);
  if (result.kind !== 'refused') growFrom(next, { kind: 'work', action: id, hours, craft: true, practised: skill !== null });
  // At the bench too (#1257): the craft's skill builds its stat, fiddly or heavy work more.
  if (result.kind !== 'refused') exerciseStats(next, exerciseFrom({
    hours, skill, level: lvl, vigorRate: recipe.effort?.vigorRate ?? 0, clarityRate: recipe.effort?.clarityRate ?? 0,
    tiredMind: before.clarity.current < WIL_EXERCISE_BELOW || !!survivalLockOf(next),
  }));
  // Making something absorbs the mind (#1305).
  if (result.kind !== 'refused') next.today.absorbed = true;
  latchMilestones(next);
  return next;
}

/** Heavy camp work that strains a sprain (#1392), beside every trip out. */
const HEAVY_WORK_ACTIONS: readonly string[] = ['build'];

/**
 * Working through a serious injury (#1392): if this work strains it, a seeded roll for the hour may
 * make it grave — and its healing is topped up to a grave one's.
 */
function aggravate(next: Region1State, action: string, ring: number, craft: boolean, at: LogEntry['at']): void {
  if (!next.config.world.accidents || next.outcome) return;
  for (const inj of next.injuries ?? []) {
    // A tended injury (#1393) is protected: splinted, bound or eased, it won't give.
    if (inj.severity !== 'serious' || inj.treated || !strains(inj.kind, action, ring, craft)) continue;
    if (streamFor(seedOf(next.character.id), next.day, `aggravate:${inj.kind}@${at?.hour ?? 0}`)() >= AGGRAVATE_CHANCE) continue;
    next.injuries = next.injuries!.map(i => (i === inj ? { ...i, severity: 'grave', heal: i.heal + HEAL_POINTS.grave - HEAL_POINTS.serious } : i));
    // What you make of it depends on what you know (#1410): untrained, only that it hurts far worse.
    const knows = skillLevel(next.skills, 'firstaid') >= KNOWS.severity;
    say(next, `You push on through it, and something gives — ${knows ? `your ${INJURY_NAME[inj.kind]} is worse now (grave)` : `your ${injuryView(inj, 0).name} hurts far worse now`}.`, 'hardship', at);
  }
}

// ── The hike kit (#1400) ────────────────────────────────────────────────────

/**
 * Pack again before setting out (#1401): on day 1, before any work, swap the pack — its tools,
 * food, cord, dressings and supplies — for another. Refused (no change) once the day has begun,
 * or for a pack that won't do. With `pack-volume` off, how heavy it may be is this Warden's
 * (#1872, kit.ts carryLimit): their Strength's with `stats-before-pack` on, 9 kg otherwise.
 */
export function repack(s: Region1State, pack: readonly KitId[], outside?: readonly KitId[]): Region1State {
  // Checked against this run's world (#1870): a hand axe in a world without its switch won't do.
  // With `pack-volume` (#1871) the pack is checked for room and straps, not weight; `outside` is
  // what's strapped on (absent: the default straps). With it off, `outside` is ignored, and the
  // weight is checked against what this Warden can carry (#1872, kit.ts carryLimit): their STR's
  // comfortable weight with `stats-before-pack` on, 9 kg otherwise. createRegion1 made their stats
  // already, so a pack is always checked against who carries it.
  const rules = packWorldOf(s, outside);
  if (s.day !== 1 || s.hoursToday > 0 || s.outcome || !validPack(pack, rules)) return s;
  const old = s.kit ? startFromPack(s.kit.items, extrasOn(s)) : null;
  const p = startFromPack(pack, extrasOn(s), strapsOf(pack, rules));
  const next = clone(s);
  // On the first morning, the tools are the pack's — and what the last Warden left (#1455), which no repacking touches.
  next.tools = [...p.tools.map(t => ({ ...t })), ...s.tools.filter(t => t.heirloom).map(t => ({ ...t }))];
  next.stores.rations += p.stores.rations - (old?.stores.rations ?? 0);
  next.stores.materials += p.stores.materials - (old?.stores.materials ?? 0);
  next.dressings = p.dressings || undefined;
  next.kit = { ...p.kit, items: [...p.kit.items] };
  next.character = { ...next.character, pack: [...pack] };
  return next;
}

/** What the kit adds: a notebook's insight, a sit pad's rest, a comic, rain gear, dry socks, and the night's comforts. */
export const NOTEBOOK_INSIGHT = 0.1, SIT_PAD_VIGOR = 2, COMIC_CLARITY = 3, RAIN_GEAR_WET = 0.5, SOCKS_WET = 0.5;
export const KASA_CLARITY = 1, THERMOS_CLARITY = 4, STOVE_CLARITY = 3, PILLOW_CLARITY = 2, SWEETS_CLARITY = 6, SWEETS_BELOW = 30;
/**
 * The odd things (#1727), with their switch on: rubber boots in the rain, the pillow from home every
 * night, the salsa on one meal, the board game on a storm day, and the dumbbells' nightly half hour.
 */
export const BOOTS_WET = 0.75, HOME_PILLOW_CLARITY = 1, SALSA_CLARITY = 2, BOARD_GAME_CLARITY = 2, DUMBBELL_HOURS = 0.5;

/** Close work at night (#1281) with the kit (#1400): by headlamp, while the battery lasts; else a fire the steel holds in the wind and a match helps light. */
interface CloseWork { fire: number; clarity: number; grade: number; lamp: number; match: number }
/**
 * What the bench would make of a queued craft now (#1827, the forecasts): its recipe, the quality
 * score it's judged on and the grade (null: it would fail, inputs wasted). The same judgement
 * `runCraft` makes, on a copy (a build moves camp first; an heirloom teaches first), with shaking
 * hands' grade off it; nothing is rolled and the state passed in isn't touched. Null when the action
 * isn't a craft, or has nothing to make (a winterized shelter).
 */
export function craftOutlook(s: Region1State, item: QueueItem): { recipe: CraftRecipe; score: number; grade: Grade | null } | null {
  const { id, opts } = parseItem(item);
  const def = ACTIONS[id];
  if (!def.recipe && !def.recipeFor) return null;
  const next = clone(s);
  if (id === 'build') moveForBuild(next, opts);
  const recipe = def.recipeFor?.(next, opts) ?? def.recipe;
  if (!recipe) return null;
  teachFromTool(next, [id, 'craft']);
  const { bench } = benchFor(next, id, recipe);
  const q = craftQuality(bench, recipe, CRAFT_WORLD);
  const made = craftGrade(q);
  const grade = made && next.today.shaking ? GRADES[Math.max(0, GRADES.indexOf(made) - SHAKING_GRADE)] : made;
  return { recipe, score: craftScore(q), grade };
}

function closeWork(s: Region1State, light: number, hours: number): CloseWork {
  const k = s.kit;
  if (light < SEE_BELOW && k && k.lamp >= hours) return { fire: 0, clarity: 1.2, grade: 0, lamp: hours, match: 0 };
  const wind = hasKit(s, 'fire-steel') ? 0 : windFire(s.weatherToday);
  const match = light < SEE_BELOW && k && k.matches > 0 ? 1 : 0;
  const n = nightWork(light, s.stores.firewood + match, hours, wind);
  return n.fire > 0 && match ? { ...n, fire: n.fire - 1, lamp: 0, match: 1 } : { ...n, lamp: 0, match: 0 };
}
function spendCloseWork(s: Region1State, n: CloseWork): void {
  s.stores.firewood = Math.max(0, s.stores.firewood - n.fire);
  if (s.kit && (n.lamp || n.match)) s.kit = { ...s.kit, lamp: s.kit.lamp - n.lamp, matches: s.kit.matches - n.match };
}

/** After the night (#1400): the kåsa, the thermos, the stove, the pillow, the sweets — and the phone gives up. */
function kitNight(next: Region1State, fireKept: boolean, cold: boolean): void {
  const k = next.kit;
  if (!k) return;
  const lift = (n: number, line: string) => {
    next.vitals = { ...next.vitals, clarity: { ...next.vitals.clarity, current: Math.min(next.vitals.clarity.cap, next.vitals.clarity.current + n) } };
    say(next, line, 'action');
  };
  const kit = { ...k };
  if (fireKept && hasKit(next, 'kasa')) lift(KASA_CLARITY, 'A hot drink from your kåsa by the fire.');
  if (cold && kit.thermos > 0) { kit.thermos--; lift(THERMOS_CLARITY, kit.thermos ? 'Hot blackcurrant from the thermos — still warm, somehow.' : 'The last of the thermos. It tastes of home.'); }
  if (cold && !fireKept && kit.stove > 0) { kit.stove--; lift(STOVE_CLARITY, `A hot meal on the Trangia${kit.stove ? '' : ' — the last of the fuel'}.`); }
  if (next.day === 1 && hasKit(next, 'pillow')) lift(PILLOW_CLARITY, "Your own pillow. It helps more than you'd have thought.");
  if (kit.sweets > 0 && next.vitals.clarity.current < SWEETS_BELOW) { kit.sweets = 0; lift(SWEETS_CLARITY, 'You eat the Saturday sweets, every one. For a while the world is bearable.'); }
  if (next.day === 2 && hasKit(next, 'phone')) say(next, 'Your phone dies in the night. There was never any signal out here anyway.', 'action');
  // The odd things (#1727): each only with the switch on, and none of them rolls a die.
  if (hasExtra(next, 'home-pillow')) lift(HOME_PILLOW_CLARITY, 'The pillow from home smells of your own bed.');
  // Fed tonight (a full meal or a lean one): the salsa goes on it, once.
  if (hasExtra(next, 'salsa') && !usedKit(next, 'salsa') && next.deprivation.hungry === 0) {
    kit.used = [...(kit.used ?? []), 'salsa'];
    lift(SALSA_CLARITY, 'You open the salsa. No tacos, but it makes supper something to look forward to.');
  }
  if (hasExtra(next, 'board-game') && next.weatherToday === 'storm') lift(BOARD_GAME_CLARITY, 'The storm howls. You play the board game against yourself, with rules you make up as you go.');
  // A few lifts before sleep: exercise that tomorrow night's recovery banks, as a day's work is (#1414).
  if (hasExtra(next, 'dumbbells')) exerciseStats(next, { str: DUMBBELL_HOURS });
  if (next.day === 1 && hasExtra(next, 'alarm-clock')) say(next, 'The alarm clock rings at dawn, loud enough to wake the whole forest. You switch it off.', 'action');
  next.kit = kit;
}

/** Working through an injury hurts (#1409): straining a serious untreated or grave one makes the day's pain sharper, and says so. */
function feelStrain(next: Region1State, action: string, ring: number, craft: boolean, at: LogEntry['at']): void {
  if (next.outcome) return;
  const before = painOf(next);
  const { pain, rose } = strainPain(next.injuries, before, action, ring, craft);
  if (!rose) return;
  next.today = { ...next.today, pain };
  say(next, painRiseLine(rose, pain), 'hardship', at);
}

/** Crafts that knap stone or cut with a blade (#1285): double the bench risk. */
const BLADE_CRAFTS: readonly string[] = ['stone-knife', 'hide-parka', 'waterskin'];

/**
 * An accident's outcome (#1285): Condition lost to a bruise or a cut, or the haul lost on the way
 * back (whatever this trip added to the stores since `before`). Journalled; a cut can kill.
 */
function applyAccident(next: Region1State, accident: Accident, before: Stores | null, at: LogEntry['at'], line: string, action: string, tired: boolean): void {
  let a = accident;
  // A damaged tool (#1286): the tool the work leans on drops a grade, a crude one breaks. With no tool in it, the haul (or, at the bench, your hand) takes it.
  if (a.kind === 'damaged-tool') {
    const tool = toolInUse(next.tools, action);
    // Duct tape (#1727, with the odd things on): once, the knocked tool is taped up and keeps its grade.
    // The accident was already rolled, so this takes no draw: the run's dice are the same with or without it.
    if (tool && hasExtra(next, 'duct-tape') && !usedKit(next, 'duct-tape')) {
      next.kit = { ...next.kit!, used: [...(next.kit!.used ?? []), 'duct-tape'] };
      say(next, `You go down hard, and your ${tool.item.replace(/-/g, ' ')} takes the fall — but a few turns of duct tape hold it together.`, 'hardship', at);
      return;
    }
    if (tool) {
      const d = damageTool(next.tools, tool.item);
      next.tools = d.tools;
      next.coldGear = roadworthyGear(next.tools);
      const name = tool.item.replace(/-/g, ' ');
      say(next, d.broke ? `You go down hard, and your crude ${name} snaps under you.` : `You go down hard, and your ${name} takes the fall — it's ${d.grade} now.`, 'hardship', at);
      return;
    }
    a = before ? { ...a, kind: 'lost-haul', condition: 0 } : { ...a, kind: 'cut', condition: ACCIDENT_CONDITION.cut };
    line = before ? 'You go down hard on the way back, and lose the haul.' : 'The tool slips — a bad cut across your hand.';
  }
  // An injury that lasts (#1286, #1392): how bad, by a seeded roll — worse if you set out exhausted. A worse one replaces a lighter one of its kind.
  if (a.injury) {
    const severity = severityOf(seedOf(next.character.id), next.day, at?.hour ?? clockHour(next.hoursToday), tired);
    const had = next.injuries?.find(i => i.kind === a.injury);
    if (!had || HEAL_POINTS[severity] > HEAL_POINTS[had.severity]) next.injuries = [...(next.injuries ?? []).filter(i => i.kind !== a.injury), injure(a.injury, severity)];
    // You can tell how bad it is from Apprentice First aid (#1410).
    if (skillLevel(next.skills, 'firstaid') >= KNOWS.severity) line = `${line} (${severity})`;
  }
  if (a.kind === 'lost-haul' && before) for (const k of STORE_KEYS) next.stores[k] = Math.min(next.stores[k], before[k]);
  next.vitals = { ...next.vitals, condition: Math.max(0, next.vitals.condition - a.condition) };
  say(next, line, 'hardship', at);
  if (next.vitals.condition <= 0) {
    next.outcome = { choice: 'collapse', kind: 'died', vitals: next.vitals };
    say(next, 'The wound goes bad, and there is no one to help. Dead of an accident.', 'outcome', at);
  }
}

/**
 * The practice hours a stretch of work credits (#1243): past Adept, practising alone counts
 * for less — a manual or a teacher brings it back — and knowing the techniques typical of
 * your level speeds the climb. Shared with the road, where teachers guide practice (#1249).
 */
export function creditedPractice(s: Pick<Region1State, 'skills' | 'techniques' | 'character'>, skill: SkillId, hours: number, guidance: Guidance): number {
  const lvl = skillLevel(s.skills, skill);
  // A young mind learns fast (#1399): under 18, every hour counts for more — in the Reach and on the road.
  return hours * talentEffects(s.character.talents).practice * guidanceRate(lvl, guidance) * techniqueFactor(s.techniques, skill, lvl) * (isYoung(s.character.age) ? YOUNG_PRACTICE : 1);
}

/**
 * Log hours of practice in a skill (on a cloned state) (#1236, #1241). `guidance` overrides
 * what you have to hand (a manual, or nothing) — Region 1.5's teachers pass `'teacher'`. The true
 * level is never announced — you feel it ("comes easier"); and when your own
 * estimate drops, you're humbled.
 */
export function practiceSkill(next: Region1State, skill: SkillId, hours: number, guidance?: Guidance): void {
  const credited = creditedPractice(next, skill, hours, guidance ?? guidanceFor(next, skill));
  const { practice, levelUp, humbled } = practise(next.skills, skill, credited);
  next.skills = practice;
  const name = SKILLS[skill].name;
  if (levelUp !== null) say(next, `${SKILLS[skill].felt} — ${name.toLowerCase()} comes easier.`, 'milestone');
  // The first level-up (#1350): the Warden notices they're thinking ahead — the plan queue opens.
  if (levelUp !== null && !next.canPlan) {
    next.canPlan = true;
    say(next, PLANNING_UNLOCKED, 'milestone');
  }
  if (humbled !== null) say(next, `The more you learn of ${name.toLowerCase()}, the more you see how little you know.`, 'action');
  learnWhatYouCan(next, skill);
}

/** The guidance you have for practising a skill: a manual for it, or nothing (teachers come with Region 1.5). */
const guidanceFor = (s: Region1State, skill: SkillId): Guidance => (s.manuals.some(m => manualById(m)?.skill === skill) ? 'manual' : 'none');

/** Work out techniques your practice has earned, and take up ones a manual offers once they're within reach. */
function learnWhatYouCan(next: Region1State, skill: SkillId): void {
  const lvl = skillLevel(next.skills, skill);
  for (const t of TECHNIQUES) {
    if (t.skill !== skill || next.techniques.includes(t.id)) continue;
    if ((next.skills[skill] ?? 0) >= selfLearnHours(t)) {
      next.techniques.push(t.id);
      say(next, `You've worked out ${t.name.toLowerCase()} — ${t.how}.`, 'milestone');
      continue;
    }
    const manual = next.manuals.map(manualById).find(m => m?.teaches.includes(t.id));
    if (manual && canBeTaught(t, lvl)) {
      next.techniques.push(t.id);
      say(next, `From ${manual.name.toLowerCase()}: ${t.name.toLowerCase()} — ${t.how}.`, 'milestone');
    }
  }
}

/** Pick up a manual (on a cloned state): it guides practice from now on and teaches when you're ready. */
function findManual(next: Region1State, id: string): void {
  const m = manualById(id);
  if (!m) return;
  next.manuals.push(id);
  say(next, `${m.found}.`, 'milestone');
  const lvl = skillLevel(next.skills, m.skill);
  const beyond = m.teaches.map(techniqueById).filter((t): t is Technique => !!t && !next.techniques.includes(t.id) && !canBeTaught(t, lvl));
  if (beyond.length) say(next, `Some of it is beyond you for now — you'll come back to it as your ${SKILLS[m.skill].name.toLowerCase()} grows.`, 'action');
  learnWhatYouCan(next, m.skill);
}

/**
 * Learn a technique from a source (#1243). `self`: only once practice has earned it;
 * `teacher` / `manual`: anything up to TEACH_REACH levels above your true level —
 * which is how a Warden ends up lopsided. Region 1.5's teachers call this.
 */
export function learnTechnique(s: Region1State, id: string, source: 'self' | 'teacher' | 'manual'): { state: Region1State; learned: boolean; reason?: string } {
  const t = techniqueById(id);
  if (!t) return { state: s, learned: false, reason: 'no such technique' };
  if (s.techniques.includes(id)) return { state: s, learned: false, reason: 'already known' };
  const lvl = skillLevel(s.skills, t.skill);
  if (source === 'self' && (s.skills[t.skill] ?? 0) < selfLearnHours(t)) {
    return { state: s, learned: false, reason: t.difficulty === 'teacher' ? 'this has to be taught' : 'not enough practice yet' };
  }
  if (source !== 'self' && !canBeTaught(t, lvl)) return { state: s, learned: false, reason: `too far beyond your ${SKILLS[t.skill].name.toLowerCase()}` };
  const next = clone(s);
  next.techniques.push(id);
  say(next, `${source === 'teacher' ? 'Taught' : source === 'manual' ? 'Learned from the page' : "You've worked out"}: ${t.name.toLowerCase()} — ${t.how}.`, 'milestone');
  return { state: next, learned: true };
}

/**
 * Food & water (#1233), tuned to feel real: water is critical (four nights without
 * kills from full health), food can be skipped for a while (slow wear), and
 * both fog the mind. Per night without, Condition and Clarity drop by the value
 * × the nights in a row; sleep recovery is scaled by the factors (both missing:
 * the losses add, the factors multiply).
 */
export const NEEDS = {
  water: { condition: 10, clarity: 8, vigorRecovery: 0.3, clarityRecovery: 0.3 },
  food: { condition: 1, clarity: 3, vigorRecovery: 0.5, clarityRecovery: 0.8 },
} as const;

// ── Spoilage and cold storage (#1295) ─────────────────────────────────────────

/** Raw food a cold pit keeps: 8, or 12 at the river, where the water runs cold past it. */
export const coldPitHolds = (site: SiteId | null): number => (site === 'river' ? 12 : 8);
/** Raw food the snow keeps, once winter has come and while the nights stay at or below 2 °C. */
export const SNOW_CACHE = 6;

/** Raw food the cold pit at this camp holds: none when there's no pit here. */
const pitCapacity = (s: Pick<Region1State, 'site' | 'coldPitAt'>): number => (s.site && s.coldPitAt === s.site ? coldPitHolds(s.site) : 0);
/** Raw food the snow keeps tonight, at night temperature `t`: only in winter, on a night at or below 2 °C. */
const snowCapacity = (s: Pick<Region1State, 'day' | 'config'>, t: number): number => (seasonOf(s.day, s.config.calendar) === 'winter' && t <= 2 ? SNOW_CACHE : 0);

/** Raw food kept cold tonight, at night temperature `t`: the pit at this camp, and the snow in winter. */
export function coldCapacity(s: Pick<Region1State, 'site' | 'coldPitAt' | 'day' | 'config'>, t: number): number {
  return pitCapacity(s) + snowCapacity(s, t);
}

/**
 * With `cold-pit-slows` (#1757): the share of the open rate at which food in the cold pit still
 * spoils. A third; a quarter at the river, where the water runs cold past the pit.
 */
export const pitSlowing = (site: SiteId | null): number => (site === 'river' ? 0.25 : 1 / 3);

/** The share of exposed raw food that spoils in a night at `t` °C: a fifth when mild, half that near freezing, none in a hard frost. */
export const spoilRate = (t: number): number => (t <= -5 ? 0 : t <= 2 ? 0.1 : 0.2);

/**
 * One night's spoilage (pure): cold storage takes what it can hold, and of the
 * rest a share goes bad, rounded up. Rations — smoked or dried — never spoil.
 */
export function spoilage(rawFood: number, capacity: number, t: number): { kept: number; exposed: number; spoiled: number } {
  const kept = Math.min(rawFood, capacity);
  const exposed = rawFood - kept;
  // (The epsilon keeps 20% of 10 at 2 rather than float noise rounding it up to 3; max keeps a zero from going -0.)
  return { kept, exposed, spoiled: Math.max(0, Math.ceil(exposed * spoilRate(t) - 1e-9)) };
}

/** One night's spoilage at camp, with what the cold pit holds and the rot it carries to tomorrow. */
export interface NightSpoilage {
  kept: number;
  exposed: number;
  spoiled: number;
  /** Of the food kept, how much is in the pit (and so still slowly spoiling). 0 with the switch off. */
  inPit: number;
  /** The rot the pit's food owes after tonight (0..1). Only with `cold-pit-slows`. */
  pitRot?: number;
}

/**
 * Tonight's spoilage at camp (pure). With `cold-pit-slows` off (or a run from before it), exactly
 * `spoilage`: what the pit and the snow hold keeps. With it on (#1757), the snow still keeps what
 * it holds (packed in snow, food stays frozen), but the food in the pit spoils too, at a share of
 * the open rate (`pitSlowing`), so mild nights speed it and frost slows it as for open food.
 *
 * Deterministic, with no draw: a third of a fifth of 8 is 0.53 of a food, so rather than round each
 * night up (which would rot one every night, nearly the open rate), the fraction is carried in
 * `pitRot`, and a whole food goes bad each time it adds up to one.
 */
export function nightSpoilage(s: Pick<Region1State, 'site' | 'coldPitAt' | 'day' | 'config' | 'stores' | 'pitRot'>, t: number): NightSpoilage {
  const base = spoilage(s.stores.rawFood, coldCapacity(s, t), t);
  if (!featureOn(s.config.world.features, 'cold-pit-slows')) return { ...base, inPit: 0 };
  // The snow fills first (it keeps for good); the pit takes the rest of what's kept.
  const inPit = Math.min(pitCapacity(s), Math.max(0, base.kept - snowCapacity(s, t)));
  if (inPit === 0) return { ...base, inPit, pitRot: 0 };
  const owed = (s.pitRot ?? 0) + inPit * spoilRate(t) * pitSlowing(s.site);
  // (The epsilon keeps float noise from leaving 0.9999… owed; the result is rounded so saves stay tidy.)
  const rot = Math.min(inPit, Math.floor(owed + 1e-9));
  return { ...base, spoiled: base.spoiled + rot, inPit, pitRot: Math.max(0, Math.round((owed - rot) * 1e6) / 1e6) };
}

/** Days before the thaw within which the spring caravan is near enough to find a collapsed Warden (#1323). */
export const RESCUE_WITHIN = 3;

/** Whether someone could find a Warden who collapses on the night of `day`: only the spring caravan, when it's close (#1323). */
export const rescuable = (day: number, cal: Calendar): boolean => cal.thawDay - day <= RESCUE_WITHIN;

/** A collapse is death when this deprived: nights in a row without water / without food (#1234). */
export const DEATH_THIRST = 2;
export const DEATH_HUNGER = 5;

const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** "a " for a countable thing; nothing for plurals and mass nouns ("timber walls", "cold gear"). */
const article = (name: string): string => (/s$|gear$/.test(name) ? '' : 'a ');

/**
 * End the day: eat and drink (each is needed to recover; going without
 * costs Condition, more each night in a row), sleep (recovery scales with shelter warmth), a cold night bites,
 * then capacity drifts on how the day was lived and a good night heals a
 * little Condition.
 */
export function endDay(s: Region1State): Region1State {
  const next = clone(s);
  if (next.outcome) return next;
  // The day as it was lived, for focus (#1238): was the mind locked, how clear was it, how long did it work.
  const lockedToday = survivalLockOf(next);

  // A set snare line brings in a little food overnight (before supper).
  if (capabilities(next.tools).has('snare-line')) {
    next.stores.rawFood += 1;
    addMeat(next, 1);
    say(next, 'The snare line caught something — 1 raw food.', 'action');
  }
  // What a find set going comes in overnight (#1345).
  for (const o of next.overnight ?? []) {
    for (const [k, n] of Object.entries(o.stores)) next.stores[k as keyof Stores] += n ?? 0;
    say(next, o.text, 'action');
  }
  next.overnight = undefined;

  // Wet through after hours in the rain (#1284): a miserable evening.
  if (next.weatherToday === 'rain' && (next.wetHours ?? 0) >= WET_HOURS) {
    // Dry socks to change into (#1400) take half the misery out of it.
    // A whole stack of spare socks (#1727, with the odd things on) does the same.
    const socks = hasKit(next, 'spare-socks') || hasExtra(next, 'lots-of-socks');
    next.vitals.clarity.current = Math.max(0, next.vitals.clarity.current - WET_CLARITY * (socks ? SOCKS_WET : 1));
    say(next, `Wet through and miserable after a day out in the rain${socks ? ' — at least there are dry socks' : ''}.`, 'hardship');
  }
  // Wind strips warmth from the night (#1284).
  const shelterW = Math.max(0, warmth(next) - windChill(next.weatherToday));
  // The night's fire (#1303): burn what the frost asks. Kept in all night, it warms the shelter too (#1306).
  const fire = keepFire(next, shelterW);
  // With `thermal-model` (#1770) the night is a heat balance (thermal.ts): the air, wind and fire at
  // the sleeper against what they wear, sleep in and lie on. Its quality decides the same cold-night
  // effects the warmth fraction did (thermalEffects), so only *which* night it was changes.
  const heat = feelsTemperature(next) && thermalOn(next)
    ? thermalNight(next, { tempC: nightTemp(next.day, next.weatherToday, next.config.calendar), weather: next.weatherToday, fire: fire.share })
    : null;
  const felt = heat ? thermalEffects(heat) : null;
  if (heat?.quality === 'dangerous') say(next, 'Dangerously cold: you lie shivering, and the cold goes deep.', 'hardship');
  const w = felt ? felt.warmth : Math.min(1, shelterW + (fire.kept ? FIRE_WARMTH : 0));
  const freeze = felt ? felt.freeze : fire.freeze;
  // A cold night (#1283): the frost decides how much shelter is enough — and rain with no roof is always cold (#1284).
  // (The flat world keeps the old rule.)
  const cold = felt ? felt.coldNight : feelsTemperature(next)
    ? isColdNight(w, nightTemp(next.day, next.weatherToday, next.config.calendar)) || (next.weatherToday === 'rain' && next.tier === 0 && !naturalRoof(next))
    : w < 0.3 && next.tier < 2;
  // Cooped up (#1305): a day without going out, studying or crafting adds to the streak; any of them ends it.
  const cooped = feelsTemperature(next) && !next.today.outside && !next.today.absorbed;
  next.cabinDays = cooped ? (next.cabinDays ?? 0) + 1 : 0;
  if (next.cabinDays === CABIN_FEVER_FROM) say(next, 'Cabin fever — too many days inside these walls. Your thoughts go round in circles.', 'hardship');
  // How far short of tonight's frost the shelter falls (#1306): a deep shortfall bites harder.
  const coldShortfall = felt ? felt.coldShortfall : cold && feelsTemperature(next) ? Math.max(0, coldNightNeeds(nightTemp(next.day, next.weatherToday, next.config.calendar)) - w) : 0;
  // How frightening the night is (#1367): the weather, the season, the shelter and the fire — read against your nerve.
  // A fire burns if it was kept in through the frost — or, on a night that asked for none, if there's wood for one.
  const nightFright = next.config.world.encounters
    ? frightOf(next, nightAmbient(nightSceneOf(next, fire.kept || (fire.freeze === 0 && next.stores.firewood > 0), fire.kept)), true) : null;
  const nightOpts: NightOpts = { warmth: w, coldNight: cold, coldShortfall, lockedToday: lockedToday !== null, freeze, eating: next.eating, cabinDays: next.cabinDays, fright: nightFright?.state };
  // The same night without the hidden talent (#1265), to see whether it made a difference.
  const withoutGift = hasHidden(next.character.talents) ? clone(hiddenless(next)) : null;
  const night = sleepNight(next, nightOpts);
  if (withoutGift && !night.ended) { const other = sleepNight(withoutGift, nightOpts); noticeHidden(next, differenceOf(next, withoutGift, !!other.ended)); }
  // The hike kit's small comforts (#1400): a hot drink, a hot meal, a pillow, the sweets.
  if (!night.ended) kitNight(next, fire.kept, cold);
  // A night in pain (#1409): sharp pain keeps you restless, agony half awake.
  const hurting = painOf(next);
  if (!night.ended && PAIN_NIGHT[hurting] > 0) {
    next.vitals = { ...next.vitals, clarity: { ...next.vitals.clarity, current: Math.max(0, next.vitals.clarity.current - PAIN_NIGHT[hurting]) } };
    say(next, painNightLine(next.injuries, hurting), 'hardship');
  }
  // After a fearful night (#1367): coming through grows the nerve; a sleepless one can leave a fear of the dark; calm ones fade it.
  if (nightFright && !night.ended) {
    if (nightFright.state !== 'calm') growFrom(next, { kind: 'fright', panicked: nightFright.state === 'panicked' });
    if (nightFright.state === 'panicked') gainFear(next, 'dark');
    else if (nightFright.state === 'calm') faceFear(next, ['dark'], DARK_FADES);
  }
  // Condition gone: the run ends (#1234). Deprived, you die of it; otherwise you collapse — and out here,
  // only the spring caravan could find you in time (#1323). Anywhere else, the animals find you first.
  if (night.ended) {
    const found = night.ended === 'collapsed' && rescuable(next.day, next.config.calendar);
    const kind = night.ended === 'collapsed' && !found ? 'died' : night.ended;
    next.outcome = { choice: 'collapse', kind, vitals: next.vitals };
    say(next, night.ended === 'died'
      ? night.cause === 'cold' ? 'The fire is long dead and the cold comes in. You don\'t wake. Dead of the cold.' : deathLine(next)
      : found ? 'Your body gives out and you collapse. The caravan\'s traders, coming up the thawing valley, find you barely alive — this season is over.'
        : seasonOf(next.day, next.config.calendar) === 'winter'
          ? 'Your body gives out and you collapse in the snow. No one comes into the Reach in winter — the wolves find you first.'
          : 'Your body gives out and you collapse. No one passes this way — a bear finds you first.', 'outcome');
    return next;
  }

  // Animals at the meat in the night (#1823, `camp-scavengers`): you're asleep at camp, which halves
  // the risk, and a fire burning keeps almost everything off (the same fire the night's fright reads).
  // What's stored is out of reach. Its own stream, keyed on the day.
  if (scavengersOn(next)) {
    const lit = fire.kept || (fire.freeze === 0 && next.stores.firewood > 0);
    // Walls (#1858) keep everything but mice off the meat lying loose in the shelter.
    scavenge(next, openMeatOf(next), nightScavengers(seedOf(next.character.id), next.day), openGuards(next, nightGuards(lit)), true);
    raidStore(next, lit);
    // The lidded pit (#1857): a bear, rarely, outside winter. Then mice (#1858), once camp has stood a few days.
    // Each from a stream of its own, so with the switches off nothing here draws at all.
    if (lidOn(next)) raidPit(next, lit);
    if (walledLarderOn(next) || lidOn(next)) mice(next, lit);
  }

  // Fresh food spoils (#1295): what the cold pit and the snow don't keep goes off, faster on a mild night.
  // With `cold-pit-slows` (#1757), the pit's food spoils too, slowly, its rot carried night to night.
  if (feelsTemperature(next)) {
    const t = nightTemp(next.day, next.weatherToday, next.config.calendar);
    const { spoiled, pitRot } = nightSpoilage(next, t);
    if (pitRot !== undefined) {
      if (pitRot > 0) next.pitRot = pitRot;
      else delete next.pitRot;
    }
    if (spoiled > 0) {
      next.stores.rawFood -= spoiled;
      addTally(next, { spoiled });
      say(next, `${spoiled} raw food went bad.`, 'hardship');
    }
  }

  // Overnight the land regrows a little, by the season — hardly at all in winter (#1304).
  next.explore = regrow(next.explore, growSeason(next.day, next.config.calendar), next.weatherToday === 'wind' || next.weatherToday === 'storm');
  // ...and the patches a long session worked come back (#1668): the berries ripen again, the wind brings down new sticks.
  if (next.patches && featureOn(next.config.world.features, 'action-length')) next.patches = recoverPatches(next.patches);
  // The day's snow lies, settles or melts (#1315).
  if (feelsTemperature(next)) next.snowDepth = nextSnowDepth(next.snowDepth ?? 0, next.weatherToday, next.day, next.config.calendar);

  // The trap lines set today (#1821): checked by morning, before the new day begins.
  checkTraps(next);
  next.day += 1;
  next.hoursToday = 0;
  next.today = { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false };
  next.studiedToday = {};
  // A banked fire (#1865) is the day's: by nightfall it has burned down, and the night has its own fire.
  delete next.banked;
  // The thaw (#1302): the Warden made it through, graded by how they came out of it.
  if (seasonOf(next.day, next.config.calendar) === 'thaw') {
    const grade = gradeOf(next.vitals.condition);
    next.outcome = { choice: 'thaw', kind: 'survived', grade, vitals: next.vitals };
    say(next, `The ice breaks on the streams. You made it through the winter — ${GRADE_LINE[grade]}`, 'outcome');
    // The spring caravan (#1307): the way on to the road.
    say(next, 'The caravan comes up the thawing valley, wheels deep in the mud. There is room on the last wagon.', 'outcome');
    return next;
  }
  if (next.day === next.config.calendar.winterDay) say(next, 'Snow in the night, and it stays. Winter has come — hold on until the thaw.', 'milestone');
  dawnWeather(next);
  // Still strained after the night (#1293): exhausted today — all work drains more.
  if ((next.strain ?? 0) >= EXHAUSTED_AT) {
    next.today.exhausted = true;
    say(next, "Your back aches from yesterday's loads.", 'hardship');
  }
  // Tell the player when survival takes over the mind, and when it lets go.
  const lockedNow = survivalLockOf(next);
  if (lockedNow && !lockedToday) say(next, `Survival takes over your thoughts — ${lockedNow}. Your focus will have to wait.`, 'hardship');
  if (!lockedNow && lockedToday && next.focus) say(next, `The pressure eases — your focus returns to ${focusLabel(next.focus)}.`, 'milestone');
  latchMilestones(next);
  return next;
}

/**
 * The night's fire (#1303): burn what the frost asks for, as far as the
 * woodpile goes. Returns whether it was kept in all night (then it warms the
 * shelter, #1306) and the Condition a short or missing fire will cost.
 * Above freezing, or in the flat world, no fire is needed.
 */
function keepFire(next: Region1State, w: number): { kept: boolean; freeze: number; share: number } {
  if (!feelsTemperature(next)) return { kept: false, freeze: 0, share: 0 };
  const t = nightTemp(next.day, next.weatherToday, next.config.calendar);
  // With `thermal-model` (#1770) the frost is judged where you sleep (a cave asks for no fire), and a
  // night that would be cold without one gets a fire above freezing too.
  const full = nightFire(next, t, next.weatherToday, w);
  if (full === 0) return { kept: false, freeze: 0, share: 0 };
  // A clear day and a magnifying glass (#1727): the fire is lit in the last of the sun, sparing a log.
  const need = kitFireNeed(next, full);
  if (need < full) say(next, 'You light the evening fire with the magnifying glass while the sun is still out.', 'action');
  const burnt = Math.min(need, next.stores.firewood);
  next.stores.firewood -= burnt;
  if (burnt === need) {
    say(next, `Kept the fire in through a ${Math.round(t)} °C night — ${burnt} firewood.`, 'action');
    return { kept: true, freeze: 0, share: 1 };
  }
  say(next, burnt > 0
    ? `The firewood ran out in the night (${burnt} of the ${need} it needed). The cold crept in.`
    : `No firewood — a fireless night at ${Math.round(t)} °C.`, 'hardship');
  // `share`: how much of the night the fire burned, for the thermal model (#1770).
  return { kept: false, freeze: freezeLoss(t, w, next.coldGear, (need - burnt) / need), share: burnt / need };
}

/** How much a fire kept in all night adds to the shelter's warmth (#1306). */
export const FIRE_WARMTH = 0.15;

/** The season the land regrows by on a day (#1304): early autumn, late autumn, or winter. */
export function growSeason(day: number, cal: Calendar): GrowSeason {
  if (seasonOf(day, cal) !== 'autumn') return 'winter';
  return day < lateFrom(cal) ? 'early' : 'late';
}

/**
 * A gathering trip's luck (#1314): its band and the shifts that set the odds.
 * Null for work that isn't a haul, and when the world has luck off (the flat world: every trip ordinary).
 */
function tripLuck(s: Region1State, id: ActionId, ring: Ring, at: { hour: number; light: number }, skillLevel: number, technique: boolean): { band: Band; shifts: Shift[] } | null {
  const domain = ACTION_DOMAIN[id];
  if (!domain || s.config.world.luck === false) return null;
  const shifts = luckShifts({ domain, weather: s.weatherToday, supply: s.explore.supply[ring][domain], skillLevel, technique, light: at.light, blizzard: inBlizzard(s, id) });
  // A bow (#1821, `hunting-gear`) raises a hunt's odds: it reaches game a sling never could.
  if (bowLifts(s, id)) shifts.push(BOW_SHIFT);
  const steps = shifts.reduce((n, x) => n + x.steps, 0);
  return { band: bandFor(haulFortune(seedOf(s.character.id), s.day, at.hour), steps), shifts };
}

/** A bow's lift on a hunt's odds (#1821): one step, only with `hunting-gear` on. */
const BOW_SHIFT: Shift = { steps: 1, why: 'the bow reached game a sling never could' };
const bowLifts = (s: Region1State, id: ActionId): boolean => id === 'hunt' && huntingGearOn(s) && huntTool(s) === 'bow';

/** Out in a winter blizzard today, on ringed work (#1315). Never in the flat world. */
const inBlizzard = (s: Region1State, id: ActionId): boolean =>
  !!ACTIONS[id].ringed && feelsTemperature(s) && isBlizzard(s.weatherToday, s.day, s.config.calendar);

/**
 * A warning about a dangerous trip, or null (#1315). Only a Warden sharp enough
 * to read the danger (Intelligence 12+) is warned; anyone else just sees the
 * snow. The same for a person and an AI.
 */
export function dangerOf(s: Region1State, id: ActionId, ring: Ring): string | null {
  if (!inBlizzard(s, id) || s.character.stats.int < DANGER_SENSE_INT) return null;
  return ring > 1 ? 'a blizzard, and a long way out — you may not come back' : 'a blizzard — out in this you could freeze, or never come back';
}

/**
 * The odds a gathering trip would have now, in a word (#1314) — for the player
 * and the AI. Uses the skill the Warden *thinks* they have (#1241), so the
 * odds never give the true level away; null for work that isn't a haul.
 */
export function tripOdds(s: Region1State, id: ActionId, ring: Ring): 'good' | 'fair' | 'poor' | 'bad' | null {
  const domain = ACTION_DOMAIN[id];
  if (!domain || s.config.world.luck === false) return null;
  const skill = skillFor(id);
  const te = techniqueEffects(s.techniques, id, undefined, true);
  const light = s.config.world.darkness ? lightOver(s.day, clockHour(s.hoursToday), queueHours(queueId(id, ring), s), s.config.calendar) : 1;
  return oddsWord(luckSteps({
    domain, weather: s.weatherToday, supply: s.explore.supply[ring][domain],
    skillLevel: skill ? perceivedLevel(s.skills, skill) : 0, technique: te.yield > 0 || te.drain < 1, light, blizzard: inBlizzard(s, id),
  }) + (bowLifts(s, id) ? BOW_SHIFT.steps : 0));
}

// ── Rationing and cabin fever (#1305) ───────────────────────────────────────

/** How the Warden eats: full (a meal a night), half (every other night), or none (fasting, even with food). */
export type EatingPlan = 'full' | 'half' | 'none';
export const EATING_PLANS: readonly EatingPlan[] = ['full', 'half', 'none'];
/** A cold, broken night costs this much Condition (#1283)… */
export const COLD_NIGHT_COST = 4;
/** …plus this much for every whole unit of warmth the shelter falls short of the night's need (#1306): 3 per 0.1. */
export const COLD_SHORTFALL_COST = 30;
/** A lean night on half rations costs this much Condition — far less than going hungry. */
export const LEAN_CONDITION = 1;
/** …lets Vigor recover only this much… */
export const LEAN_VIGOR_RECOVERY = 0.75;
/** …and pulls the Vigor cap down, as a body on thin rations does. */
export const LEAN_VIGOR_TARGET = -10;
/** Cabin fever sets in on this many days cooped up in a row… */
export const CABIN_FEVER_FROM = 3;
/** …pulling the Clarity cap down this much per day beyond the second, to at most 20. */
export const CABIN_FEVER_STEP = 4;
/** Cabin fever's pull on tonight's Clarity cap target. */
export const cabinFever = (days: number): number => (days >= CABIN_FEVER_FROM ? -Math.min(20, CABIN_FEVER_STEP * (days - (CABIN_FEVER_FROM - 1))) : 0);

/** Set how the Warden eats (#1305). Takes effect tonight. */
export function setEating(s: Region1State, plan: EatingPlan): Region1State {
  if ((s.eating ?? 'full') === plan) return s;
  const next = clone(s);
  next.eating = plan;
  say(next, plan === 'half' ? 'You put yourself on half rations — a meal every other night.' : plan === 'none' ? 'You stop eating. The food stays where it is.' : 'Back to full rations.', 'action');
  return next;
}

/** How the thaw finds a Warden of each grade. */
export const GRADE_LINE: Readonly<Record<'hale' | 'worn' | 'broken', string>> = {
  hale: 'hale, and stronger for it.',
  worn: 'worn thin, but standing.',
  broken: 'barely. It will be a long time before you are right.',
};

/**
 * What a night needs from a Warden — shared by Region 1 and the caravan road
 * (#1244), so survival works the same wherever you sleep.
 */
export type Sleeper = Pick<Region1State, 'day' | 'hoursToday' | 'vitals' | 'stores' | 'tools' | 'concepts' | 'today' | 'deprivation' | 'character' | 'focus' | 'log' | 'strain' | 'injuries' | 'kit' | 'skills'>;

export interface NightOpts {
  /** Shelter warmth for the night, 0–1. */
  warmth: number;
  /** A cold, broken night: exposure costs Condition (unless the Warden is cold-proof). */
  coldNight: boolean;
  /** How far short of the night's need the shelter's warmth falls (#1306): each 0.1 short costs 3 more Condition. */
  coldShortfall?: number;
  /** The mind was locked to survival today, so a focused concept wasn't worked on. */
  lockedToday: boolean;
  /** Someone else waters you tonight (the caravan's barrels, #1244): you don't go thirsty, and your own water is kept. */
  providedWater?: boolean;
  /** Condition lost to a freezing night without enough fire (#1303). */
  freeze?: number;
  /** How the Warden eats tonight (#1305). Default full. */
  eating?: EatingPlan;
  /** Days in a row cooped up, today included (#1305): cabin fever pulls the Clarity cap down. */
  cabinDays?: number;
  /** How frightening the night was for you (#1367): shaken, you lie awake; panicked, you hardly sleep. */
  fright?: PanicState;
}

/** The night's verdict: null if the Warden lives to see morning; otherwise how it ended. */
export interface NightResult { ended: null | 'died' | 'collapsed'; cause?: 'cold' }

/**
 * Grow the Warden's talents from one event (#1264). A tier gained is felt —
 * one line, naming neither the talent nor the tier.
 */
function growFrom(next: Pick<Region1State, 'character' | 'log' | 'day'>, e: GrowthEvent): void {
  const { talents, tierUps } = growTalents(next.character.talents, e);
  next.character.talents = talents;
  if (tierUps > 0) next.log.push({ day: next.day, text: TIER_UP_LINE, kind: 'milestone' });
}

/** What can show a hidden talent's hand (#1265): the pools, the goods, practice and tools — and on the road, marks and trust. */
export type Noticed = Pick<Region1State, 'vitals' | 'stores' | 'skills' | 'tools'> & { marks?: number; trust?: Record<string, number> };

const GRADE_RANK: Readonly<Record<string, number>> = { crude: 0, sound: 1, fine: 2, masterwork: 3 };
const plus = (a: Readonly<Record<string, number | undefined>>, b: Readonly<Record<string, number | undefined>>): number =>
  Object.keys(a).reduce((n, k) => n + Math.max(0, (a[k] ?? 0) - (b[k] ?? 0)), 0);

/** What a hidden talent changed: this moment against the same moment without it. */
export function differenceOf(withIt: Noticed, without: Noticed, clung = false): Difference {
  const rank = (t: Noticed['tools']) => t.reduce((n, x) => n + (GRADE_RANK[x.grade] ?? 0), 0);
  return {
    vigor: withIt.vitals.vigor.current - without.vitals.vigor.current,
    clarity: withIt.vitals.clarity.current - without.vitals.clarity.current,
    condition: withIt.vitals.condition - without.vitals.condition,
    yield: plus(withIt.stores as unknown as Record<string, number>, without.stores as unknown as Record<string, number>),
    practice: plus(withIt.skills, without.skills),
    grade: withIt.tools.length === without.tools.length ? rank(withIt.tools) - rank(without.tools) : 0,
    marks: (withIt.marks ?? 0) - (without.marks ?? 0),
    trust: plus(withIt.trust ?? {}, without.trust ?? {}),
    clung,
  };
}

/**
 * A hidden talent's sign (#1265): if it made a noticeable difference, count it, and write what that
 * earns — a hint at 2 signs and 4, and at 6 the reveal. Hints are felt, never named.
 */
export function noticeHidden(next: { character: Character; log: LogEntry[]; day: number }, d: Difference): void {
  if (!hasHidden(next.character.talents) || !signOf(d)) return;
  const r = noticeTalent(next.character.talents);
  next.character = { ...next.character, talents: r.talents };
  for (const l of r.lines) next.log.push({ day: next.day, text: l.text, kind: l.reveal ? 'milestone' : 'action' });
}

/** The same Warden without their hidden talent — the "what if" a sign is measured against. */
export const hiddenless = <S extends { character: Character }>(s: S): S => ({ ...s, character: { ...s.character, talents: withoutHidden(s.character.talents) } });

/** Give back the share of overexertion's Condition cost that a talent spares (Tough, #1263). */
function refundOverexertion(next: Pick<Region1State, 'vitals'>, lost: number, mult: number): void {
  if (lost > 0 && mult < 1) next.vitals.condition = Math.min(100, next.vitals.condition + lost * (1 - mult));
}

/** The temperature matters in the full world; the flat world (tests) has none (#1283). */
const feelsTemperature = (s: Pick<Region1State, 'config'>): boolean => s.config.world.weather === 'seeded';
/** How much the snow cover slows walking and felling today (#1315): none in the flat world. */
const snowSlowFor = (s: Pick<Region1State, 'config' | 'snowDepth'>): number => (feelsTemperature(s) ? snowSlow(s.snowDepth ?? 0) : 1);
/** How much forage the snow cover leaves findable (#1306): all of it on bare ground, none under deep snow. */
const snowBuries = (s: Pick<Region1State, 'config' | 'snowDepth'>): number => (feelsTemperature(s) ? Math.max(0, 1 - (s.snowDepth ?? 0)) : 1);
/** The streams are frozen hard today: water means melting snow (#1303). */
const melting = (s: Pick<Region1State, 'config' | 'day'>): boolean => feelsTemperature(s) && meltsSnow(s.day, s.config.calendar);

/** Work below freezing is heavier (#1283). */
const coldWork = (s: Pick<Region1State, 'config' | 'day' | 'weatherToday'>, hour: number): number =>
  feelsTemperature(s) && tempAt(s.day, hour, s.weatherToday, s.config.calendar) < 0 ? FREEZING_WORK : 1;

/** The weather on a day for this Warden (#1282): seeded by the character id and the day. */
const weatherOn = (s: Pick<Region1State, 'character' | 'config'>, day: number): WeatherId =>
  weatherFor(seedOf(s.character.id), day, s.config.world, s.config.calendar);

/** Learn a coming day's weather (a look-out, or Weather sense). */
function foresee(s: Pick<Region1State, 'character' | 'config' | 'forecast'>, day: number): WeatherId {
  const w = weatherOn(s, day);
  s.forecast[day] = w;
  return w;
}

/**
 * A new day's weather (#1282): set today's, forget forecasts for days that have
 * come, let Weather sense read the next two days, and note the morning's sky.
 */
function dawnWeather(s: Region1State): void {
  s.weatherToday = weatherOn(s, s.day);
  s.wetHours = 0;
  for (const d of Object.keys(s.forecast)) if (Number(d) <= s.day) delete s.forecast[Number(d)];
  if (s.techniques.includes('weather')) { foresee(s, s.day + 1); foresee(s, s.day + 2); }
  if (s.config.world.weather === 'seeded') say(s, `Morning: ${weatherName(s.weatherToday, s.day, s.config.calendar).toLowerCase()}.`, 'action');
}

/** The death line for a Warden who died of deprivation in the night. */
export function deathLine(s: Pick<Region1State, 'deprivation'>): string {
  const { hungry: h, thirsty: t } = s.deprivation;
  const thirst = t >= DEATH_THIRST;
  return `You lie down in the night and don't get up. Dead of ${thirst ? 'thirst' : 'starvation'} (${thirst ? `${t} nights without water` : `${h} nights without food`}).`;
}

/**
 * One night, on a cloned state (mutated in place): eat and drink (each is needed to recover; going without
 * costs Condition, more each night in a row), sleep (recovery scales with warmth), a cold night bites,
 * then — if you wake — capacity drifts on how the day was lived and a good night heals a little Condition.
 * The day counter is the caller's to advance.
 */
export function sleepNight(next: Sleeper, o: NightOpts): NightResult {
  const clarityAtDusk = next.vitals.clarity.current;
  const hoursWorked = next.hoursToday;
  // On the Reach (a run with its switches), said as distances with `distance-not-rings` on (#1752).
  const config = (next as Partial<Pick<Region1State, 'config'>>).config;
  const say = (text: string, kind: LogEntry['kind']): void => { next.log.push({ day: next.day, text: config ? ringWordsFor({ config }, text) : text, kind }); };

  // Food and water are separate needs, and both are needed to recover (#1233).
  // Fresh food first; when it's gone, the winter larder (#1302).
  // Half rations (#1305) skip every other night — a lean night, not a hungry one; fasting skips them all.
  const plan = o.eating ?? 'full';
  const hasFood = next.stores.rawFood > 0 || next.stores.rations > 0;
  const lean = plan === 'half' && hasFood && next.day % 2 === 1;
  const ate = plan !== 'none' && hasFood && !lean;
  const drank = o.providedWater || next.stores.water > 0;
  if (ate && next.stores.rawFood > 0) next.stores.rawFood -= 1;
  else if (ate) next.stores.rations -= 1;
  if (drank && !o.providedWater) next.stores.water -= 1;
  next.deprivation = { hungry: ate || lean ? 0 : next.deprivation.hungry + 1, thirsty: drank ? 0 : next.deprivation.thirsty + 1 };
  const running = (n: number): string => (n > 1 ? ` (${ordinal(n)} night running)` : '');
  if (lean) say('Half rations — a lean night.', 'hardship');
  else if (!ate) say(hasFood ? `Fasting — the food stays untouched${running(next.deprivation.hungry)}.` : `Hungry — no food${running(next.deprivation.hungry)}.`, 'hardship');
  if (!drank) say(`Thirsty — no water${running(next.deprivation.thirsty)}.`, 'hardship');

  const w = o.warmth;
  // Sleep restores body and mind in full only when fed and watered; each unmet need scales it down.
  // Knows the cold (#1399): a scout's winters take the edge off a cold night, like a little Cold-blooded.
  const talentFx = talentEffects(next.character.talents);
  // Wool and a pad (#1400) help too.
  const tr = { ...talentFx, coldCost: talentFx.coldCost * coldWise(next.character) * kitColdCost(next) };
  const se = statEffects(next.character.stats);
  // Strain from yesterday's loads (#1293) spoils the body's recovery: 10% per point, at most half.
  const strained = next.strain ?? 0;
  // A fearful night (#1367): lying awake listening — or hardly sleeping at all.
  const fear = o.fright === 'panicked' ? SLEEPLESS_NIGHT : o.fright === 'shaken' ? UNEASY_NIGHT : { clarity: 1, vigor: 1 };
  // A panic today (#1361) means a poor night: you keep waking with your heart going.
  const vigorFactor = (drank ? 1 : NEEDS.water.vigorRecovery) * (ate ? 1 : lean ? LEAN_VIGOR_RECOVERY : NEEDS.food.vigorRecovery) * strainRecovery(strained) * (next.today.shaking ? SHAKING_SLEEP : 1) * fear.vigor;
  if (o.fright === 'shaken') say('You lie awake a long time, listening to the dark.', 'hardship');
  if (o.fright === 'panicked') say('A sleepless night: every sound out there is something coming.', 'hardship');
  const clarityFactor = (drank ? 1 : NEEDS.water.clarityRecovery) * (ate || lean ? 1 : NEEDS.food.clarityRecovery) * fear.clarity;
  // Bedding (a "sleep" yield) is a flat Clarity bonus on top of the night's recovery.
  const bedding = modifiersFor(next.tools, 'sleep').yieldAdd;
  next.vitals = applyActivity(next.vitals, { hours: 8, vigorRate: 4.25 * vigorFactor, clarityRate: 5 * clarityFactor, clarityFlat: bedding, sleep: true }, { shelterWarmth: w }).vitals;
  // Going without escalates night by night — on the body (Condition) and the mind (Clarity).
  const { hungry, thirsty } = next.deprivation;
  const hc = tr.hungerCost;
  // Constitution and Tough soften the body's losses, Willpower the mind's (#1256, #1263).
  next.vitals.condition = Math.max(0, next.vitals.condition - (NEEDS.food.condition * hungry * hc + NEEDS.water.condition * thirsty) * se.deprivationCondition * tr.deprivationCondition);
  next.vitals.clarity.current = Math.max(0, next.vitals.clarity.current - (NEEDS.food.clarity * hungry * hc + NEEDS.water.clarity * thirsty) * se.deprivationClarity);
  if (lean) next.vitals.condition = Math.max(0, next.vitals.condition - LEAN_CONDITION * se.deprivationCondition * tr.deprivationCondition);
  // Holding a focus costs a little of the mind each night; a focused concept was turned over all day.
  if (next.focus) {
    next.vitals.clarity.current = Math.max(0, next.vitals.clarity.current - FOCUS_COST);
    // Only a concept the Warden can turn over (#1478) — whatever path set the focus (a save, the road).
    if (next.focus.kind === 'concept' && !o.lockedToday && !focusRefusal(next, next.focus.id)) {
      addInsight(next.concepts, next.focus.id, CONCEPT_PER_HOUR * hoursWorked * reliability(clarityAtDusk, se.unreliableBelow), CRAFT_WORLD.concepts);
    }
  }
  // Cold-blooded (#1263) takes the edge off — or all of it, at mastery.
  if (o.coldNight && tr.coldCost > 0) {
    next.vitals.condition = Math.max(0, next.vitals.condition - (COLD_NIGHT_COST + COLD_SHORTFALL_COST * (o.coldShortfall ?? 0)) * tr.coldCost);
    say('A cold, broken night — the exposure bites.', 'hardship');
  }

  // A freezing night without fire (#1303) — Cold-blooded eases it too.
  const froze = (o.freeze ?? 0) * tr.coldCost;
  if (froze > 0) next.vitals.condition = Math.max(0, next.vitals.condition - froze);

  // Tough (#1237, from tier 3 since #1263): once per run, you cling on instead of going under.
  if (next.vitals.condition <= 0 && tr.lastStand && !next.character.lastStandUsed) {
    next.vitals.condition = 1;
    next.character.lastStandUsed = true;
    say('Everything in you says stop. You refuse. You wake, somehow — Condition 1. That was your one reprieve.', 'hardship');
  }
  // Condition gone (#1234): deprived, you die of it; otherwise you collapse.
  if (next.vitals.condition <= 0) {
    if (next.deprivation.thirsty >= DEATH_THIRST || next.deprivation.hungry >= DEATH_HUNGER) return { ended: 'died' };
    // Frozen to death: there's no being found collapsed in a winter night like that.
    return froze > 0 ? { ended: 'died', cause: 'cold' } : { ended: 'collapsed' };
  }
  // A night of hardship survived grows the talents that meet it (#1264): hunger, cold, being worn down.
  growFrom(next, { kind: 'night', hungry: !ate && !lean, cold: o.coldNight || froze > 0, condition: next.vitals.condition, strained: strained >= EXHAUSTED_AT });
  // A long day or a hard night survived toughens the body (#1257)…
  exerciseStats(next, { con: Math.max(0, hoursWorked - LONG_DAY_HOURS) + ((!ate && !lean) || !drank ? HARD_NIGHT_EXERCISE : 0) });
  // …but going without for long leaves its mark: wear builds, and at its limit Constitution drops a point.
  if (next.deprivation.hungry >= WEAR_HUNGRY || next.deprivation.thirsty >= WEAR_THIRSTY) wearNight(next, next.deprivation.thirsty >= WEAR_THIRSTY);
  // Growth comes in recovery (#1414): only a proper night — fed, watered, warm enough — banks the day's exercise.
  if (ate && drank && !o.coldNight && froze <= 0) recoverStats(next);
  // A night's rest works half the strain off.
  if (strained > 0) next.strain = strained / 2;

  const summary = {
    loadVigor: next.today.loadVigor,
    loadClarity: next.today.loadClarity,
    ate,
    drank,
    hungryNights: next.deprivation.hungry,
    shelterWarmth: w,
    pushedVigor: next.today.pushedVigor,
    pushedClarity: next.today.pushedClarity,
    // Thin rations wear the body down; too long cooped up wears on the mind (#1305).
    vigorTarget: lean ? LEAN_VIGOR_TARGET : 0,
    clarityTarget: cabinFever(o.cabinDays ?? 0),
  };
  next.vitals = driftCapacity(next.vitals, summary);
  // Healing, scaled by Constitution (#1256). A cold, broken night is no rest (#1306): it heals nothing.
  const preHeal = next.vitals.condition;
  if (!o.coldNight) next.vitals = recoverCondition(next.vitals, summary);
  next.vitals.condition = Math.min(100, preHeal + (next.vitals.condition - preHeal) * se.heal);
  // An old scar (#1392) aches on a cold night.
  if (o.coldNight && next.character.harms?.includes('scar')) next.vitals.clarity.current = Math.max(0, next.vitals.clarity.current - SCAR_ACHE);
  // Injuries mend by the night (#1392), wherever you sleep: a good night (fed, watered, warm) a point, a light day before it
  // one more, Constitution scaling it; a bad night, nothing. A deep cut bleeds you a little each night it's open. A grave
  // one, once healed, leaves its mark on the character for good.
  if (next.injuries?.length) {
    // An untreated serious deep cut can fester overnight (#1393): grave, and it costs Condition.
    next.injuries = next.injuries.map(i => {
      if (i.kind !== 'cut' || i.severity !== 'serious' || i.treated) return i;
      if (streamFor(seedOf(next.character.id), next.day, 'fester')() >= FESTER_CHANCE) return i;
      next.vitals.condition = Math.max(0, next.vitals.condition - FESTER_CONDITION);
      say(festerLine(i), 'hardship');
      return { ...i, severity: 'grave', heal: i.heal + HEAL_POINTS.grave - HEAL_POINTS.serious };
    });
    const base = nightHealing({ ate, drank, cold: o.coldNight, restful: next.today.loadVigor + next.today.loadClarity < STIMULUS, healFactor: se.heal });
    // A tended injury heals faster (#1393) — on any night that heals at all.
    const amountFor = (i: Injury): number => (base > 0 && i.treated ? base + TREAT_BONUS[i.treated] : base);
    const healed: Injury[] = [];
    for (const i of next.injuries) {
      if (i.kind === 'cut') next.vitals.condition = Math.max(0, next.vitals.condition - CUT_BLEED);
      const amount = amountFor(i);
      const left = Math.max(0, i.heal - amount);
      const fa = skillLevel(next.skills, 'firstaid');
      if (left > 0) { say(amount > 0 ? healingLine({ ...i, heal: left }, fa) : notHealingLine(i, fa), 'hardship'); continue; }
      healed.push(i);
      // A grave injury leaves its mark — unless a healer set it properly (#1394).
      const harm = i.severity === 'grave' && !i.mended ? HARM_OF[i.kind] : null;
      if (harm && !next.character.harms?.includes(harm)) next.character = { ...next.character, harms: [...(next.character.harms ?? []), harm] };
      say(healedLine(i, harm), harm ? 'hardship' : 'milestone');
    }
    next.injuries = next.injuries.filter(i => !healed.includes(i)).map(i => ({ ...i, heal: Math.max(0, i.heal - amountFor(i)) }));
  }
  return { ended: null };
}

/** Set (or clear, with null) what the mind is working on (#1238). Free: it costs no hours. */
export function setFocus(s: Region1State, focus: Focus | null): Region1State {
  const next = clone(s);
  // A concept can be turned over only once the Warden has come across it, and until it's mastered
  // (#1478); a topic, once they've come across it (#1494). Refused, the focus stays what it was.
  const why = refusalOf(s, focus);
  if (why) {
    say(next, `You can't turn your mind to ${focusInline(focus!)} — ${why}.`, 'skip');
    return next;
  }
  next.focus = focus;
  return next;
}

/** Why the mind is locked to survival right now, or null (#1238). */
export function survivalLockOf(s: Region1State): string | null {
  return survivalLock({
    thirsty: s.deprivation.thirsty,
    hungry: s.deprivation.hungry,
    condition: s.vitals.condition,
    daysToWinter: s.config.calendar.winterDay - s.day,
    winterReady: winterReady(s),
  });
}

/**
 * Run a planned queue for the rest of today: actions run in order until the
 * 14 waking hours are spent (an action started before the limit finishes),
 * then the day ends. Returns the new state and the unrun remainder, which
 * carries into tomorrow.
 */
/** The journal line when planning opens up (#1350). */
export const PLANNING_UNLOCKED = 'Halfway through the work you catch yourself already thinking about the next job, and the one after. You can plan ahead now.';

export function runDay(s: Region1State, queue: readonly QueueItem[], stop?: DayStop): { state: Region1State; remaining: QueueItem[] } {
  // A waiting encounter (#1343) holds the day: nothing runs, and the night doesn't come, until you choose.
  if (s.outcome || s.pending) return { state: s, remaining: [...queue] };
  let state = s;
  const remaining = [...queue];
  // A stop (#1815): the plan's action `stop.action` is cut short, and the day pauses after it.
  const cutAt = (i: number): number | undefined => (stop && stop.action === i ? stop.hours : undefined);
  // One thing at a time until planning is learned (#1350): only the first action runs today.
  if (!s.canPlan && remaining.length) {
    state = runAction(state, remaining.shift() as QueueItem, cutAt(0));
    return { state: state.pending || cutAt(0) !== undefined ? state : endDay(state), remaining };
  }
  for (let i = 0; remaining.length > 0 && state.hoursToday < DAY_HOURS; i++) {
    state = runAction(state, remaining.shift() as QueueItem, cutAt(i));
    // An encounter pauses the day where it happened: the rest of the queue waits. So does a stop.
    if (state.pending || cutAt(i) !== undefined) return { state, remaining };
  }
  return { state: endDay(state), remaining };
}

