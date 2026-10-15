/**
 * A night at camp as a heat balance (#1770, switch `thermal-model`).
 *
 * #1763 (built-warmth.ts) made camp warmth a fraction: the site's natural shelter plus a share of
 * the gap. The owner asked for "something realistic … R values or maybe there is some already
 * adopted rating", so with this switch on a night is worked out the way cold-weather ergonomics
 * does it, with the standards people already use:
 *
 * - **ISO 11079 IREQ**: the clothing insulation (clo) a person needs to stay in heat balance, from
 *   the air and radiant temperature, wind, humidity and metabolic rate. Two levels: IREQ_min (the
 *   body holds its heat but runs cool, skin ~30 °C) and IREQ_neutral (thermally neutral).
 * - **clo**, the clothing insulation unit: 1 clo = 0.155 m²K/W (Gagge, Burton & Bazett 1941; ISO 9920).
 * - **ISO 23537** sleeping-bag ratings (comfort and limit temperatures), turned into insulation.
 * - **ASTM F3340** sleeping-pad R-values, which are in US units (ft²·°F·h/Btu): R × 0.1761 = m²K/W.
 * - **JAG/TI 2001** wind chill, for "it feels colder than it is" on a windy hilltop.
 * - **Cave air** sits near the region's mean annual surface temperature, the same in midwinter and
 *   early autumn.
 *
 * What the Warden has (clothes, bag, pad) is compared with what tonight needs. The gap is the
 * night's quality (warm / cool / cold / dangerous), and that maps onto the sim's existing cold-night
 * effects (`thermalEffects`), so balance stays in the range the warmth fraction gave.
 *
 * Pure arithmetic on the state: no draws on any random stream, so a run replays exactly and the
 * golden hashes don't move. Every iteration is a fixed-count bisection, so the numbers are the same
 * on every machine.
 *
 * Sources:
 * - ISO 11079:2007, Ergonomics of the thermal environment: Determination and interpretation of cold
 *   stress when using required clothing insulation (IREQ) and local cooling effects. Its Annex
 *   program (Holmér & Nilsson, 1990) is reproduced in the R package `comf`, `calcIREQ`
 *   (https://github.com/cran/comf/blob/master/R/calcIREQ.R), which is what the equations below follow.
 *   Lund University's calculator: https://www.design.lth.se/english/the-department/research-laboratories/climate-lab/tools/calculations-for-ireq-and-wct/
 * - ISO 9920:2007 (clothing insulation; the clo values and the wind and air-permeability correction
 *   of the resultant insulation used in the same program).
 * - ISO 23537-1:2022 (sleeping-bag ratings: comfort for a standard woman relaxed, limit for a
 *   standard man curled up for 8 h), e.g. https://australianhiker.com.au/advice/iso-23537-12022-sleeping-bag-temperature-rating/
 * - ASTM F3340-18 (pad R-value: hot plate 35 °C, cold plate 5 °C, 2 kPa load). Foam pads test about
 *   R 2, a 25 mm self-inflating mat about R 3.4, winter inflatables R 5–7, 50 mm EPS about R 10
 *   (https://yamatomichi.com/en/journals/309473, https://en.wikipedia.org/wiki/Sleeping_pad). EPS
 *   50 mm at k ≈ 0.035 W/mK is 1.43 m²K/W = R 8.1 in US units, which is why the US unit is the one.
 * - Osczevski & Bluestein (2005), The new wind chill equivalent temperature chart, BAMS 86(10)
 *   (the JAG/TI 2001 formula, wind at 10 m in km/h, valid at or below +10 °C and above 4.8 km/h).
 * - Cave temperature ≈ mean annual surface temperature: e.g. Cuthbert et al. (2015), Quaternary
 *   Science Reviews 127 (cave heat and drip-water temperature); a first approximation, ±2 °C.
 */

import { featureOn } from './features';
import { dayMean } from './weather';
import { GRADE_WARMTH, type Region1State, type SiteId } from './region1';
import { hasKit } from './kit';
import type { Grade } from './crafting';
import type { WeatherId } from './world';

/** The switch (features.ts). */
export const THERMAL_MODEL = 'thermal-model';
export const thermalOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, THERMAL_MODEL);

// ── Units ───────────────────────────────────────────────────────────────────

/** 1 clo = 0.155 m²K/W (ISO 9920). */
export const CLO = 0.155;
/** ASTM F3340 R-values are in ft²·°F·h/Btu: 1 of those = 0.1761 m²K/W. */
export const ASTM_R = 0.1761;
/** 1 met = 58.15 W/m² (ISO 8996). */
export const MET = 58.15;

/**
 * Metabolic rate asleep, 0.8 met (ISO 8996 lists sleeping at about 40–46 W/m²). ISO 11079's
 * program is stated for 58–400 W/m²; below 58 we extrapolate its own skin-temperature and wetness
 * lines, which is what makes a night asleep need more than an hour sitting.
 */
export const SLEEP_MET = 0.8 * MET;

// ── ISO 11079 IREQ ──────────────────────────────────────────────────────────

/** The climate at the person: air and mean radiant temperature (°C), air speed at the body (m/s), humidity (%). */
export interface Climate { airC: number; radiantC: number; windMs: number; rh: number }

/** Saturated vapour pressure (kPa) at t °C, as the ISO 11079 program writes it (Antoine form). */
const psat = (t: number): number => 0.1333 * Math.exp(18.6686 - 4030.183 / (t + 235));

/** The program's limits: air at most +10 °C, air speed 0.4–18 m/s (ISO 11079's validity range). */
const clampClimate = (c: Climate): Climate => ({ ...c, airC: Math.min(10, c.airC), windMs: Math.min(18, Math.max(0.4, c.windMs)) });

/** The boundary air layer's insulation Ia (m²K/W) at air speed v and walking speed w (ISO 9920 / 11079). */
export const boundaryLayer = (v: number, w = 0): number => 0.092 * Math.exp(-0.15 * v - 0.22 * w) - 0.0045;

/**
 * Air movement from the body's own motion (m/s): ISO 11079's program takes at least
 * 0.0052·(M − 58), at most 1.2, for someone working in place. A sleeper (M < 58) makes none.
 */
const bodyMotion = (M: number): number => Math.min(1.2, Math.max(0, 0.0052 * (M - 58)));

/** Skin temperature and skin wetness at the two IREQ levels (ISO 11079, from M in W/m²). */
const skinAt = (level: 'min' | 'neutral', M: number): { tsk: number; wet: number } =>
  (level === 'min' ? { tsk: 33.34 - 0.0354 * M, wet: 0.06 } : { tsk: 35.7 - 0.0285 * M, wet: 0.001 * M });

/**
 * The body's heat balance with resultant clothing insulation `I` (m²K/W) at a skin level: what's
 * left after evaporation, breathing and dry heat loss (W/m²; negative = the body is losing heat).
 * The ISO 11079 program's equations: clothing area factor fcl = 1 + 1.197·I, evaporative
 * resistance Rt = (0.06/0.38)(Ia + I), respiratory loss from the exhaled air (Tex = 29 + 0.2·ta),
 * radiation with ε 0.95 over 77% of the body, convection as what the boundary layer lets through.
 */
function balance(I: number, c: Climate, M: number, level: 'min' | 'neutral'): { S: number; tcl: number } {
  const { airC: ta, radiantC: tr, windMs: v } = clampClimate(c);
  const Ia = boundaryLayer(v, bodyMotion(M));
  const { tsk, wet } = skinAt(level, M);
  const tex = 29 + 0.2 * ta;
  const pa = (c.rh / 100) * psat(ta);
  const fcl = 1 + 1.197 * I;
  const E = wet * (psat(tsk) - pa) / ((0.06 / 0.38) * (Ia + I));
  const Hres = 1.73e-2 * M * (psat(tex) - pa) + 1.4e-3 * M * (tex - ta);
  // Dry heat out through the clothing must equal what leaves its surface (radiation + convection):
  // solve the clothing surface temperature by bisection (60 halvings: exact to the last bit we use).
  const out = (tcl: number): number => {
    const d = tcl - tr;
    const hr = Math.abs(d) < 1e-9 ? 4 * 5.67e-8 * 0.95 * 0.77 * (273 + tr) ** 3 : 5.67e-8 * 0.95 * 0.77 * ((273 + tcl) ** 4 - (273 + tr) ** 4) / d;
    const hc = Math.max(0, 1 / Ia - hr);
    return fcl * (hr * (tcl - tr) + hc * (tcl - ta));
  };
  let lo = Math.min(ta, tr) - 40, hi = tsk;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    // Through the clothing (tsk − tcl)/I against what leaves the surface: too little leaving → warmer surface.
    if ((tsk - mid) / Math.max(I, 1e-6) > out(mid)) lo = mid; else hi = mid;
  }
  const tcl = (lo + hi) / 2;
  return { S: M - E - Hres - out(tcl), tcl };
}

/** The insulation (m²K/W) at which the balance at a level is zero (or reaches `S`), by bisection. */
function insulationFor(c: Climate, M: number, level: 'min' | 'neutral', S = 0): number {
  let lo = 0, hi = 4; // 0–26 clo
  if (balance(lo, c, M, level).S >= S) return 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (balance(mid, c, M, level).S >= S) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** What tonight needs, in clo: IREQ at the two levels, and the night's survivable limit (below `min`). */
export interface Required { min: number; neutral: number; limit: number }

/**
 * ISO 11079's body-heat debt limit: 40 Wh/m² (144 kJ/m²) is as much stored heat as the body can
 * lose before the exposure must end (the program's DLE = 40 / |S| hours). Spread over a night of
 * sleep, that's the rate a body can run short and still see the morning without real harm.
 */
export const DEBT_LIMIT_WH = 40;
export const NIGHT_HOURS = 8;
/**
 * A sleeper short of IREQ_min doesn't stay at 0.8 met: they wake, curl up and shiver on and off,
 * which raises the metabolic rate to about 1.5 met (ISO 8996: sustained shivering 1.5–2 met, peaks
 * far higher). The night's limit and its heat debt are reckoned at that rate.
 */
export const SHIVER_MET = 1.5 * MET;

/**
 * IREQ (ISO 11079), in clo: the resultant clothing insulation needed at the minimal and the
 * neutral level for metabolic rate `met` (W/m²); and `limit`, the insulation at which a night of
 * broken, shivering sleep (`SHIVER_MET`) runs up exactly the 40 Wh/m² debt by morning
 * (DLE = 8 h at the minimal level). Below `limit` the night does real harm.
 */
export function ireq(env: Climate, met: number): Required {
  return {
    min: insulationFor(env, met, 'min') / CLO,
    neutral: insulationFor(env, met, 'neutral') / CLO,
    limit: insulationFor(env, Math.max(met, SHIVER_MET), 'min', -DEBT_LIMIT_WH / NIGHT_HOURS) / CLO,
  };
}

/** The body's heat-storage rate (W/m², negative = losing) at the minimal level with `heldClo` on. */
export const heatStorage = (heldClo: number, env: Climate, met: number): number => balance(heldClo * CLO, env, met, 'min').S;

/**
 * ISO 9920's correction of basic insulation for wind and the fabric's air permeability `p`
 * (l/m²s: a windproof shell about 8, a sleeping bag's shell about 50, open wool 100+): the
 * resultant insulation, as the ISO 11079 program computes it. In still air it's ~95% of the
 * basic value; in a strong wind a permeable layer loses nearly half.
 */
export function resultant(basicClo: number, v: number, p: number): number {
  const vv = Math.min(18, Math.max(0.4, v));
  const icl = basicClo * CLO;
  const fcl = 1 + 1.197 * icl;
  const corr = 0.54 * Math.exp(-0.15 * vv) * p ** 0.075 - 0.06 * Math.log(p) + 0.5;
  return Math.max(0, ((icl + 0.085 / fcl) * corr - boundaryLayer(vv) / fcl) / CLO);
}

// ── Wind chill (JAG/TI 2001) ────────────────────────────────────────────────

/**
 * The wind chill temperature (°C) for air at `t` °C and wind `v10` m/s at 10 m (the JAG/TI 2001
 * formula: 13.12 + 0.6215 T − 11.37 V^0.16 + 0.3965 T V^0.16, V in km/h). It's only defined at or
 * below +10 °C with wind above 4.8 km/h; elsewhere the air temperature is returned.
 */
export function windChillC(t: number, v10: number): number {
  const V = v10 * 3.6;
  if (t > 10 || V <= 4.8) return t;
  const p = V ** 0.16;
  return 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p;
}

// ── The environment at the sleeper ──────────────────────────────────────────

/**
 * The cave's air (°C): the region's mean annual surface temperature. For the Reach (Nordic
 * forest, inland), +4 °C: central Sweden and southern Finland run about +2 to +6 °C. A constant
 * per region: deep enough in, a cave is the same in midwinter and early autumn.
 */
export const CAVE_TEMP = 4;
/** Cave air is near saturation. */
export const CAVE_RH = 95;

/** Wind at 10 m (m/s) for each weather: a light breeze, a fresh one, a gale for the storm (Beaufort 2, 3, 5, 8). */
export const WIND_10M: Readonly<Record<WeatherId, number>> = { clear: 2, overcast: 3, fog: 1, rain: 4, snow: 4, wind: 9, storm: 16 };
/**
 * From 10 m down to a person lying on the ground: ISO 11079 and JAG/TI take wind at face height as
 * about two thirds of the 10 m wind; lying lower still, half.
 */
export const GROUND_WIND = 0.5;
/** How much of the wind reaches each kind of site (a hilltop all of it, a cave's back next to none). */
export const SITE_WIND: Readonly<Record<SiteId, number>> = { hill: 1, river: 0.8, tree: 0.35, cave: 0.05 };
/**
 * How much colder than the air the surroundings radiate on a night out under the sky (°C): a clear
 * sky radiates like air 20–30 °C colder, and a sleeper sees about half sky, half ground; cloud or
 * falling snow closes most of that.
 */
export const SKY_CHILL: Readonly<Record<WeatherId, number>> = { clear: 6, overcast: 1, fog: 1, rain: 1, snow: 1, wind: 3, storm: 1 };
/** How much sky each site shows overhead with nothing built (the trees' canopy, the cave's roof). */
export const SITE_SKY: Readonly<Record<SiteId, number>> = { hill: 1, river: 1, tree: 0.5, cave: 0 };

/**
 * What each stage of shelter does with no fire, soundly built (reasoned orders of magnitude):
 * - `cut`: how much of the wind it stops. A lean-to's open front lets half through; a hut's
 *   doorway a fifth; timber walls chinked with moss a tenth; stone walls a twentieth.
 * - `sky`: how much of the night sky the sleeper still sees (a roof blocks the radiant chill).
 * - `air`: how much warmer the still air inside is, from the body's own ~80 W in a small space and
 *   the ground's warmth (a degree or two under a roof, a few inside walls).
 * - `fireAir`, `fireRadiant`: what a fire kept in all night adds to the air and to the mean radiant
 *   temperature (°C). A radiant flux q on the body raises the mean radiant temperature by about
 *   q / (4εσT³) ≈ q / 4.4 W/m² per °C, so a night fire's 25–50 W/m² is +6 to +11 °C. In the open it
 *   warms one side (+6); a lean-to's back wall reflects it onto you (+12, the classic reflector
 *   fire); inside walls it heats the air too (a small log hut with a hearth runs +15 to +20 above
 *   the outside, about +20), stone more for its mass. A fire at a cave's mouth bounces off the rock.
 */
interface ShelterHeat { cut: number; sky: number; air: number; fireAir: number; fireRadiant: number }
export const OPEN_CAMP: ShelterHeat = { cut: 0, sky: 1, air: 0, fireAir: 0, fireRadiant: 6 };
export const SHELTER_HEAT: Readonly<Record<'leanto' | 'hut' | 'timber' | 'stone', ShelterHeat>> = {
  leanto: { cut: 0.5, sky: 0.3, air: 0.5, fireAir: 2, fireRadiant: 12 },
  hut: { cut: 0.8, sky: 0, air: 1.5, fireAir: 10, fireRadiant: 10 },
  timber: { cut: 0.9, sky: 0, air: 3, fireAir: 20, fireRadiant: 10 },
  stone: { cut: 0.95, sky: 0, air: 4, fireAir: 24, fireRadiant: 12 },
};
/** A fire at the mouth of a cave: the rock reflects it, and the cave's air hardly moves. */
export const CAVE_FIRE: Pick<ShelterHeat, 'fireAir' | 'fireRadiant'> = { fireAir: 1, fireRadiant: 10 };
/** A shelter built where you knew the wind doesn't reach (#1379): half of what wind is left. */
export const SITED_CUT = 0.5;

/** The ground under the bed: its temperature (°C) and what its surface adds to the bed's insulation (m²K/W). */
export interface Ground { tempC: number; resistance: number }

/** What a sleeper's environment reads: the parts of the run it needs. */
export type ThermalRun = Pick<Region1State, 'site' | 'tier' | 'shelter' | 'shelterGrade' | 'tools' | 'kit' | 'day' | 'config' | 'wetHours' | 'weatherToday'>;

/** Tonight as the sleeper meets it. */
export interface SleeperEnv extends Climate {
  /** The night's air outside camp (°C) and its 10 m wind (m/s). */
  outsideC: number;
  wind10: number;
  /** The wind chill outside camp (JAG/TI 2001), for the words "colder than it looks". */
  feelsC: number;
  ground: Ground;
  /** Rain on a camp with no roof: what's on you and in the bag is wet. */
  soaked: boolean;
}

/** The night to read: its air temperature outside (°C), its weather, and how much of the night a fire burns (0–1). */
export interface NightIn { tempC: number; weather: WeatherId; fire: number }

/** The stage of shelter standing at camp (none for an open camp). */
function shelterHeat(s: Pick<Region1State, 'tier' | 'shelter'>): ShelterHeat {
  if (s.tier === 0) return OPEN_CAMP;
  if (s.tier === 1) return SHELTER_HEAT[s.shelter.type ?? 'leanto'];
  return SHELTER_HEAT[s.shelter.walls ?? 'timber'];
}

/** A crude build leaks and a fine one holds: the same grade factor as the warmth fraction (region1.ts GRADE_WARMTH), capped at a full cut. */
const graded = (x: number, g: Grade | null): number => Math.min(1, x * GRADE_WARMTH[g ?? 'sound']);

/**
 * The air temperature at the sleeper, the wind that reaches them and the radiant gain (#1770).
 *
 * - **A cave**: the region's constant (`CAVE_TEMP`), still, humid air, the rock at the same
 *   temperature underfoot and overhead. Mild in midwinter, cooler than outside on a warm night.
 * - **Elsewhere**: the night's air, the site's share of the wind (hilltop all, treeline a third),
 *   cut by the shelter (and by building where the wind doesn't reach), and the night sky's chill
 *   where no roof blocks it.
 * - **A fire** for the share of the night it burns adds radiant heat, more with a reflector or walls.
 */
export function sleeperEnvironment(s: Pick<ThermalRun, 'site' | 'tier' | 'shelter' | 'shelterGrade' | 'day' | 'config'>, night: NightIn): SleeperEnv {
  // No camp yet: you sleep where you stopped, on the forest floor among the trees (the Reach is forest).
  const site = s.site ?? 'tree';
  const wind10 = WIND_10M[night.weather];
  const feelsC = windChillC(night.tempC, wind10 * SITE_WIND[site]);
  const h = shelterHeat(s);
  const cut = 1 - (1 - graded(h.cut, s.shelterGrade)) * (s.tier > 0 && s.shelter.sited ? SITED_CUT : 1);
  const fire = Math.max(0, Math.min(1, night.fire));
  const wet = night.weather === 'rain' || night.weather === 'fog' || night.weather === 'snow';
  if (site === 'cave') {
    const air = CAVE_TEMP + (s.tier > 0 ? h.air / 2 : 0) + fire * CAVE_FIRE.fireAir;
    return {
      airC: air, radiantC: air + fire * CAVE_FIRE.fireRadiant, windMs: wind10 * GROUND_WIND * SITE_WIND.cave * (1 - cut), rh: CAVE_RH,
      outsideC: night.tempC, wind10, feelsC, ground: { tempC: CAVE_TEMP, resistance: 0 }, soaked: false,
    };
  }
  const retained = GRADE_WARMTH[s.shelterGrade ?? 'sound'];
  const air = night.tempC + (s.tier > 0 ? h.air * retained : 0) + fire * h.fireAir * (s.tier > 0 ? retained : 1);
  const sky = SKY_CHILL[night.weather] * SITE_SKY[site] * h.sky;
  return {
    airC: air,
    radiantC: air - sky + fire * h.fireRadiant,
    windMs: wind10 * GROUND_WIND * SITE_WIND[site] * (1 - cut),
    rh: wet ? 95 : 80,
    outsideC: night.tempC, wind10, feelsC,
    ground: groundUnder(s, site, air, night.tempC),
    soaked: night.weather === 'rain' && s.tier === 0,
  };
}

/**
 * The ground under the bed. Bare rock (a cave, a hilltop's bedrock) and frozen or wet ground add
 * nothing and draw heat straight out of you; unfrozen forest litter (the treeline) adds a little
 * (about 0.05 m²K/W, a few cm of needles and moss). Its surface sits between the air and 0 °C on a
 * frost night (snow and soil hold some warmth), and a soundly built shelter's floor of poles and
 * boughs keeps you a little off it.
 */
function groundUnder(s: Pick<ThermalRun, 'tier' | 'shelterGrade' | 'day' | 'config'>, site: SiteId, airC: number, outsideC: number): Ground {
  const frozen = dayMean(s.day, s.config.calendar) < 0 || outsideC < -2;
  const tempC = airC >= 0 ? airC : airC / 2;
  const litter = site === 'tree' && !frozen ? 0.05 : 0;
  const floor = s.tier > 0 && (s.shelterGrade ?? 'sound') !== 'crude' ? 0.05 : 0;
  return { tempC, resistance: litter + floor };
}

// ── What the Warden has ─────────────────────────────────────────────────────

/**
 * Clothing, in basic clo (ISO 9920's tables, summed for an ensemble). A scout's hiking clothes
 * (trousers, shirt, fleece, socks, boots) are about 1.0 clo; long wool underwear adds about 0.3;
 * a hat and mittens 0.1; a rain shell 0.15 (its real work is stopping the wind: air permeability
 * ~8 l/m²s instead of ~100); woven cold gear (a quilted fibre coat) 0.8, crude 0.5; a hide parka 1.2.
 */
export const CLOTHES = { base: 1.0, wool: 0.3, hatMittens: 0.1, rainGear: 0.15, coldGear: 0.8, crudeColdGear: 0.5, hideParka: 1.2 } as const;
/** Air permeability (l/m²s): open knit and fleece, and with a windproof shell over them (ISO 9920). */
export const PERMEABLE = 100, WINDPROOF = 8;

/**
 * Sleeping bags by their ISO 23537 ratings (°C): comfort (standard woman, relaxed) and limit
 * (standard man, curled, 8 h). Typical retail bags: summer +12/+8, three-season +4/−2, winter
 * −9/−15. The scout's bag is a three-season one. (ISO 23537 doesn't rate children's bags; a scout's
 * bag is taken at an adult rating.) A crafted bedroll (blankets of woven fibre and grass, or hides
 * at their best) is rated by its grade.
 */
export const BAG_RATING = {
  summer: { comfort: 12, limit: 8 },
  'three-season': { comfort: 4, limit: -2 },
  winter: { comfort: -9, limit: -15 },
} as const;
export type BagKind = keyof typeof BAG_RATING | 'bedroll';
export const BEDROLL_COMFORT: Readonly<Record<Grade, number>> = { crude: 15, sound: 11, fine: 7, masterwork: 3 };

/**
 * Pads by ASTM F3340 R-value (US units). The scout's closed-cell foam pad R 2.0 (the benchmark for
 * foam: Z Lite, RidgeRest, FlexMat 2.0–2.2); a sit pad R 1.5 that only reaches the hips (taken as
 * 40% of it under the body); a bough bed R 2 (an estimate: 10–15 cm of spruce boughs pressed down,
 * comparable to foam; there's no tested rating). For reference: a 25 mm self-inflating mat R 3.4, a
 * winter inflatable R 5–7.
 */
export const PAD_R = { foam: 2.0, sitPad: 1.5, boughs: 2.0, selfInflating: 3.4, winterInflatable: 6.0 } as const;
export const SIT_PAD_SHARE = 0.4;

/**
 * Lying down, about a quarter of the skin presses into the bed: back, buttocks, calves, heels.
 * That part loses heat by conduction through the pad to the ground, not to the air.
 */
export const CONTACT = 0.25;
/** Under the body a bag's loft is crushed to about 15% of its insulation, clothes to half. */
export const BAG_CRUSHED = 0.15, CLOTHES_CRUSHED = 0.5;
/** Wet through, fibres lose about half their insulation (down more, wool less). */
export const WET_LOSS = 0.5;

/** What the Warden sleeps in. */
export interface Insulation {
  /** Clothing worn, basic clo. */
  clothingClo: number;
  /** The bag or bedroll, basic clo (0 without one). */
  bagClo: number;
  bag: BagKind | null;
  /** The pad under the body, ASTM F3340 R (US units) and in m²K/W. */
  padR: number;
  padSI: number;
  /** The outer layer's air permeability (l/m²s). */
  permeability: number;
}

/** The scout's three-season bag, or a crafted bedroll by its grade (the better of the two). */
function bagOf(s: Pick<ThermalRun, 'tools' | 'kit'>): { kind: BagKind | null; comfort: number } {
  const roll = s.tools.find(t => t.item === 'bedroll');
  const kitBag = hasKit(s, 'sleeping-bag');
  const crafted = roll ? BEDROLL_COMFORT[roll.grade] : Infinity;
  if (kitBag && BAG_RATING['three-season'].comfort <= crafted) return { kind: 'three-season', comfort: BAG_RATING['three-season'].comfort };
  return roll ? { kind: 'bedroll', comfort: crafted } : { kind: null, comfort: Infinity };
}

/**
 * Clothing, bag and pad (#1770). The kit's wool underlayer, hat and mittens and rain gear add to
 * the clothes; crafted cold gear (or a hide parka) is worn too. The bag's insulation comes from
 * its ISO 23537 comfort rating (`bagClo`). The pad: the scout's foam pad, the sit pad's share, or
 * the bough bed under a crafted bedroll; ASTM R-values add when stacked (F3340 says so).
 */
export function insulationHeld(s: Pick<ThermalRun, 'tools' | 'kit'>): Insulation {
  const gear = s.tools.filter(t => t.item === 'cold-gear' || t.item === 'hide-parka');
  const coat = gear.some(t => t.item === 'hide-parka') ? CLOTHES.hideParka
    : gear.some(t => t.grade !== 'crude') ? CLOTHES.coldGear : gear.length ? CLOTHES.crudeColdGear : 0;
  const clothingClo = CLOTHES.base + (hasKit(s, 'wool-underlayer') ? CLOTHES.wool : 0) + (hasKit(s, 'hat-mittens') ? CLOTHES.hatMittens : 0)
    + (hasKit(s, 'rain-gear') ? CLOTHES.rainGear : 0) + coat;
  const b = bagOf(s);
  const roll = s.tools.some(t => t.item === 'bedroll');
  const padR = (hasKit(s, 'sleeping-pad') ? PAD_R.foam : 0) + (hasKit(s, 'sit-pad') ? PAD_R.sitPad * SIT_PAD_SHARE : 0)
    // A crafted bedroll is laid on a bough bed; the scout's own bag on the bare ground isn't.
    + (roll && b.kind === 'bedroll' ? PAD_R.boughs : 0);
  return {
    clothingClo, bag: b.kind, bagClo: b.kind ? bagClo(b.comfort) : 0,
    padR, padSI: padR * ASTM_R, permeability: hasKit(s, 'rain-gear') ? WINDPROOF : PERMEABLE,
  };
}

/** What the sleeper wears and lies on, in the climate: one effective resultant insulation (clo), comparable with IREQ. */
export function effectiveClo(held: Pick<Insulation, 'clothingClo' | 'bagClo' | 'padSI' | 'permeability'>, env: Climate & { ground: Ground; soaked?: boolean }, met: number): number {
  const c = clampClimate(env);
  const wetF = env.soaked ? WET_LOSS : 1;
  // In a bag the outer layer is the bag's shell (~50 l/m²s); in clothes alone, the clothes'.
  const p = held.bagClo > 0 ? Math.min(50, held.permeability) : held.permeability;
  const top = resultant((held.clothingClo + held.bagClo) * wetF, c.windMs, p) * CLO;
  const bottom = (held.clothingClo * CLOTHES_CRUSHED + held.bagClo * BAG_CRUSHED) * wetF * CLO + held.padSI + env.ground.resistance;
  const Ia = boundaryLayer(c.windMs);
  const tsk = skinAt('min', met).tsk;
  const to = (c.airC + c.radiantC) / 2;
  if (to >= tsk - 0.5) return 99; // a warm night: nothing to lose
  // Heat out per m² of skin: the top through clothes, bag and the boundary air to the surroundings;
  // the contact patch straight through the bed into the ground at its own temperature.
  const loss = (1 - CONTACT) * (tsk - to) / (top + Ia) + CONTACT * Math.max(0, tsk - env.ground.tempC) / Math.max(0.02, bottom);
  return Math.max(0, (tsk - to) / loss - Ia) / CLO;
}

/**
 * A sleeping bag's basic insulation (clo) from its ISO 23537 comfort temperature: the bag that,
 * in our model of the standard's test (still air, 50% RH, a sleeper at 0.8 met in a base layer of
 * 0.4 clo, on a good mat of R 4 over the chamber floor), holds exactly IREQ_neutral at that
 * temperature. Solved once by bisection. So "comfort +4 °C" means warm at +4 °C in still air on a
 * good pad, here as in the shop.
 */
export const TEST_CLOTHES = 0.4, TEST_PAD_R = 4;
const BAG_CACHE = new Map<number, number>();
export function bagClo(comfortC: number): number {
  if (!Number.isFinite(comfortC)) return 0;
  const cached = BAG_CACHE.get(comfortC);
  if (cached !== undefined) return cached;
  const env = { airC: comfortC, radiantC: comfortC, windMs: 0.4, rh: 50, ground: { tempC: comfortC, resistance: 0 } };
  const need = ireq(env, SLEEP_MET).neutral;
  let lo = 0, hi = 20;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (effectiveClo({ clothingClo: TEST_CLOTHES, bagClo: mid, padSI: TEST_PAD_R * ASTM_R, permeability: 50 }, env, SLEEP_MET) >= need) hi = mid; else lo = mid;
  }
  const out = (lo + hi) / 2;
  BAG_CACHE.set(comfortC, out);
  return out;
}

// ── The night's quality, and what it does ──────────────────────────────────

export type NightQuality = 'warm' | 'cool' | 'cold' | 'dangerous';

/**
 * Insulation held against tonight's need (clo):
 * - **warm**: at least IREQ_neutral.
 * - **cool**: at least IREQ_min: the body holds its heat, skin a little cool. You sleep.
 * - **cold**: short of IREQ_min, but the night's heat debt stays inside ISO 11079's 40 Wh/m²
 *   limit: a broken night, no lasting harm.
 * - **dangerous**: past the limit before morning: the body's core starts to go.
 */
export function nightQuality(held: number, required: Required): NightQuality {
  if (held >= required.neutral) return 'warm';
  if (held >= required.min) return 'cool';
  if (held >= required.limit) return 'cold';
  return 'dangerous';
}

/** A night worked through: the environment, what's held and needed, the quality, the heat debt (Wh/m², ≥ 0). */
export interface ThermalNight { env: SleeperEnv; held: Insulation; heldClo: number; required: Required; quality: NightQuality; debtWh: number }

/**
 * Tonight at camp (#1770): the sleeper's environment, what they have, what it needs. Wet through
 * after a day in the rain (#1284), the clothes are damp at bedtime: a fifth off them.
 */
export function thermalNight(s: ThermalRun, night: NightIn, met = SLEEP_MET): ThermalNight {
  const env = sleeperEnvironment(s, night);
  const held0 = insulationHeld(s);
  const damp = night.weather === 'rain' && (s.wetHours ?? 0) >= 4 ? 0.8 : 1;
  const held = { ...held0, clothingClo: held0.clothingClo * damp };
  const heldClo = effectiveClo(held, env, met);
  const required = ireq(env, met);
  const quality = nightQuality(heldClo, required);
  // The debt past the survivable limit, at the shivering rate (Wh/m² over the night).
  const debtWh = quality !== 'dangerous' ? 0 : Math.max(0, -heatStorage(heldClo, env, Math.max(met, SHIVER_MET)) * NIGHT_HOURS - DEBT_LIMIT_WH);
  return { env, held, heldClo, required, quality, debtWh };
}

/**
 * How a night's quality plays out in the sim's existing cold-night rules (region1.ts endDay and
 * sleepNight), so the thermal model only decides *which* night it was, and the sim's own costs
 * stay in the range the warmth fraction gave:
 *
 * - `warmth` stands in for the shelter warmth sleep reads (recovery scales 0.45 + 0.55·w, healing
 *   needs 0.5, capacity drift 0.5). Warm 0.9 and cool 0.65 are a well-built camp's range under the
 *   old fraction; cold 0.35 heals nothing; dangerous 0.15 is a night out in the open.
 * - `coldNight`: cold and dangerous nights are the "cold, broken night" (4 Condition, no healing).
 * - `coldShortfall`: each 0.1 costs 3 Condition (COLD_SHORTFALL_COST). How far the night falls from
 *   IREQ_min towards the survivable limit, times 0.5: up to 15 more, as the old rule's shelter
 *   that fell well short of its frost line (it reached ~26 at -19 °C with nothing at all).
 * - `freeze`: past the limit the body's core cools. 5 Condition for each 40 Wh/m² of heat debt
 *   past the limit, but never more than the old rule's fireless night at the same air
 *   (weather.ts freezeLoss with nothing to ease it: 2 + 1.2 per degree of frost, 20 at -15 °C) and
 *   at most 20. The debt at a fixed skin temperature overstates a long night (a cold sleeper curls up
 *   and the skin cools further), so the old rule's scale is kept as the ceiling. It takes the place of
 *   that loss (the fire is part of the environment now), and like it a night that takes the last of
 *   Condition is death by cold.
 */
export const QUALITY_WARMTH: Readonly<Record<NightQuality, number>> = { warm: 0.9, cool: 0.65, cold: 0.35, dangerous: 0.15 };
export const MAX_SHORTFALL = 0.5, FREEZE_PER_LIMIT = 5, FREEZE_MAX = 20;
/** The old rule's fireless-night loss at an air temperature (weather.ts freezeLoss, no shelter, no gear), as the ceiling. */
const freezeCeiling = (airC: number): number => Math.min(FREEZE_MAX, 2 + 1.2 * Math.max(0, -airC));

export interface ThermalEffects { warmth: number; coldNight: boolean; coldShortfall: number; freeze: number }

export function thermalEffects(n: Pick<ThermalNight, 'quality' | 'debtWh' | 'heldClo' | 'required'> & { env: Pick<SleeperEnv, 'airC'> }): ThermalEffects {
  const cold = n.quality === 'cold' || n.quality === 'dangerous';
  const span = Math.max(1e-6, n.required.min - n.required.limit);
  const short = Math.max(0, Math.min(1, (n.required.min - n.heldClo) / span));
  return {
    warmth: QUALITY_WARMTH[n.quality],
    coldNight: cold,
    coldShortfall: cold ? MAX_SHORTFALL * short : 0,
    freeze: n.quality === 'dangerous' ? Math.min(freezeCeiling(n.env.airC), FREEZE_PER_LIMIT * n.debtWh / DEBT_LIMIT_WH) : 0,
  };
}

/** The night in English words, for the AI and the API (the page says `night.q.*`). */
export const NIGHT_WORDS: Readonly<Record<NightQuality, string>> = { warm: 'a warm night', cool: 'a cool night', cold: 'a cold night', dangerous: 'dangerously cold' };

/** "NIGHT: a cool night (holds 4.6 clo; needs 4.3 clo at least, 4.7 to be warm)": what the AI reads. */
export const nightLineForAi = (n: ThermalNight): string =>
  `${NIGHT_WORDS[n.quality]} (insulation ${n.heldClo.toFixed(1)} clo held; ${n.required.min.toFixed(1)} clo needed at least, ${n.required.neutral.toFixed(1)} to sleep warm)`;
