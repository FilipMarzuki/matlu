/**
 * Artificer web frontend — Region 1, Greywind Reach (#1209).
 *
 * Plain DOM over the headless sim core: no Phaser, no framework. The pattern is
 * "state in, HTML out": every click updates an immutable `AppState` through the
 * controller, then `render()` redraws the whole page from it. At this size a
 * full redraw is instant, and it means the screen can never drift out of sync
 * with the sim — there is no second copy of the rules here, only presentation.
 *
 * Clicks are handled by ONE listener on the root (event delegation): buttons
 * carry `data-*` attributes saying what they do, so re-rendering never has to
 * re-wire handlers.
 */

import './style.css';
import { repack, createRegion1, PLANNING_UNLOCKED, survivalLockOf, ACTIONS, blockedReason, SITES, BUILD_COST, FISH_CATCH, DAY_HOURS, REGION1_MILESTONES, warmth, winterReady, winterOutlook, tonightsFright, FIRE_WARMTH, coldPitHolds, coldCapacity, spoilage, type TripLoad, routeKnown, parseItem, HIDE_PARKA_RECIPE, DISCOVERIES, queueId, queueHours, type ActionId, type QueueId, type LogEntry, type SiteId } from '../artificer/region1';
import { RINGS, RING_NAME, TRAVEL_HOURS, RICHNESS, FINDS, LEVEL_NAME, domainsOf, level, reachable, scouted, tripYield, hasFind, supplyWord, type Domain, type Ring } from '../artificer/exploration';
import { modifiersFor } from '../artificer/crafting';
import { maxLoad, comfortableLoad, strainRecovery, GEAR_ITEMS, EXHAUSTED_DRAIN, type GearItem, type Haul } from '../artificer/load';
import { bestRun, canContinue, runNumberFor, type RunRecord } from '../artificer/legacy';
import { seasonOf, MIDWINTER_AFTER, type Grade, type OutcomeKind } from '../artificer/winter';
import { daylightHours } from '../artificer/clock';
import { dayMean, nightTemp, coldNightNeeds, isBlizzard, weatherName, BLIZZARD_HOURS, type WeatherId } from '../artificer/weather';
import { BASELINE, CAP_CEIL, morale, type Pool } from '../artificer/vitality';
import { SKILLS, SKILL_IDS, LEVELS, MAX_LEVEL, perceivedProgress, isSupernatural } from '../artificer/skills';
import { TECHNIQUES, manualById, type Technique } from '../artificer/techniques';
import { introBeats, fillName, type Beat, type IntroKind } from './intro';
import { PORTRAITS, portraitById, portraitStyle } from './portraits';
import { GOALS, GOAL_IDS, FOCUS_CONCEPTS, FOCUS_COST, CONCEPT_PER_HOUR, focusLabel, focusKey, parseFocus } from '../artificer/focus';
import { TALENTS, TALENT_PICKS, talentOffer, seedOf, type TalentId } from '../artificer/talents';
import { SUGGESTED_PACK, KIT, KIT_GROUPS, PACK_CAPACITY, packWeight, validPack, kitItem, kitSupplies, type KitId, type KitGroup } from '../artificer/kit';
import { grownStats, isYoung, DEFAULT_AGE, START_AGES } from '../artificer/growing';
import { STATS, STAT_IDS, DEFAULT_STATS, POINT_BUDGET, canRaise, canLower, raiseCost, pointsLeft, statNote, statEffects, validStats, type Stats, type StatId } from '../artificer/stats';
import { artificerRank, conceptRanks } from '../artificer/rank';
import { roadView, routeStrip, roadStatus, lastNews, questLog, roadEnd, type RoadUi } from './road-view';
import { personById, CONTACT_TRUST } from '../artificer/villages';
import { ROAD_DAYS, type RoadState } from '../artificer/road';
import { encounterModal, type EncounterAfter } from './encounter-view';
import { ringPinChip, ringPins, pinsList } from './pins-view';
import { tripPinNote } from '../artificer/pins';
import { meetingModal } from './caravan-view';
import { truthLine, THREAT_WORDS, DARK_FADES } from '../artificer/panic';
import { QUIRKS, quirkName, isFear, FEAR_OF, FEAR_FADES } from '../artificer/quirks';
import { encounterById, stepOf } from '../artificer/encounters';
import { choose, carryOn, forget, weighPin, roadChoose, GAME_WORLD, act, endTheDay, queueLocked, newGame, newRun, currentRun, rideCaravan, meetCaravan, meetingChoose, stayBehind, roadAct, roadEndDay, newCharacterId, chooseFocus, chooseEating, recordRun, serializeHistory, deserializeHistory, HISTORY_KEY, enqueue, dequeueAt, clearQueue, setOption, runQueuedDay, runWholeQueue, settle, previewQueue, serialize, deserialize, SAVE_KEY, type AppState } from './controller';

// ── Presentation-only data (wording lives here, rules live in the sim) ──────

const GROUPS: { title: string; ids: ActionId[] }[] = [
  { title: 'EXPLORE', ids: ['scout', 'survey', 'track', 'lookout'] },
  { title: 'PROVISION', ids: ['gather', 'hunt', 'water', 'wood', 'quarry', 'fish', 'preserve'] },
  { title: 'BUILD', ids: ['build', 'coldPit', 'coldGear'] },
  { title: 'CRAFT TOOLS', ids: ['knife', 'snare', 'waterskin', 'bedroll', 'shovel'] },
  { title: 'CARRYING GEAR', ids: ['basket', 'backpack', 'harness', 'sled'] },
  { title: 'THINK & RECOVER', ids: ['study', 'tinker', 'rest', 'treat'] },
];

const ICON: Record<ActionId, string> = {
  scout: '🥾', survey: '📐', track: '🐾', gather: '🌿', hunt: '🏹', water: '💧',
  wood: '🪵', quarry: '⛰️', preserve: '🧂', build: '⛺', coldGear: '🧥', tinker: '🛠️', rest: '☕', treat: '🩹',
  lookout: '🔭', study: '📖', knife: '🔪', snare: '🪤', waterskin: '🫗', bedroll: '🛏️', shovel: '⛏️', fish: '🎣', coldPit: '🧊', basket: '🧺', backpack: '🎒', harness: '🪢', sled: '🛷',
};

/** Extra yield your tools give an action (shown in the hint). */
const bonus = (s: AppState['sim'], id: ActionId): number => modifiersFor(s.tools, id).yieldAdd;

/** +2 if you've made the find in this ring × domain. */
const fb = (s: AppState['sim'], r: Ring, d: Domain): number => (hasFind(s.explore, r, d) ? 2 : 0);
/** Shorthand: this trip's yield from what you know of the ring (mirrors region1.ts). */
const ty = (s: AppState['sim'], r: Ring, d: Domain, base: number, per: number): number => tripYield(s.explore, r, d, base, per);

/** One-line "what you get" per action, in the chosen ring. Numbers mirror region1.ts yields. */
const YIELD: Record<ActionId, (s: AppState['sim'], r: Ring) => string> = {
  scout: () => 'everything there at least suspected',
  survey: () => 'everything there observed → richer trips',
  track: () => 'game observed → you can hunt',
  lookout: () => 'ring +1 level · see over the next ring',
  study: () => 'a third of your clarity → concept insight',
  gather: (s, r) => `+${ty(s, r, 'forage', 3, 2) + bonus(s, 'gather')} raw food${fb(s, r, 'forage') ? ' +2 fiber' : ''}`,
  hunt: (s, r) => `deer +${ty(s, r, 'game', 7, 0) + bonus(s, 'hunt') + fb(s, r, 'game')} food & a hide · or small game`,
  water: (s, r) => `+${ty(s, r, 'water', 4, 1) + (s.site === 'river' && r === 1 ? 2 : 0) + bonus(s, 'water') + fb(s, r, 'water')} water`,
  wood: (s, r) => `+${ty(s, r, 'timber', 4, 1) + (s.site === 'tree' && r === 1 ? 1 : 0) + fb(s, r, 'timber')} fuel, +${ty(s, r, 'timber', 2, 1)} mat`,
  quarry: (s, r) => `+${ty(s, r, 'stone', 3, 1) + fb(s, r, 'stone')} stone`,
  fish: (_s, r) => `+~${FISH_CATCH * RICHNESS[r]} raw food · once the lake ice is thick`,
  preserve: () => '2 raw → 1 ration · smoke ×3 or dry ×2',
  build: s => (s.tier < 2 ? `tier ${s.tier + 1} from ${BUILD_COST[s.tier as 0 | 1]} mat · choose site & design in the queue` : 'winterized'),
  coldGear: () => 'eases a freezing night without enough fire · fiber or hide',
  coldPit: s => `keeps ${coldPitHolds(s.site)} raw food from spoiling · 4 stone + 2 mat`,
  knife: () => 'hunt −15% vigor, quicker preserving',
  snare: () => '+1 food every night',
  waterskin: () => '+1 water per trip · takes a hide',
  bedroll: () => '+6 clarity overnight',
  shovel: () => 'build −20% vigor · needs a roof',
  basket: () => 'food & materials easier to carry · 2 mat',
  backpack: () => 'every load easier to carry · a hide + 2 mat',
  harness: () => 'wood, stone & hides easier to carry · a hide + 1 mat',
  sled: () => 'drag stone, wood & hides — half the bulk on snow or level ground · 5 mat',
  tinker: () => 'rests body, spends mind',
  rest: () => 'recovers a little',
  treat: () => 'tends your worst injury: heals faster, won\'t worsen · a dressing, or improvised',
};

const SITE_NOTE: Record<SiteId, string> = {
  cave: 'Dry rock at your back. The warmest ground.',
  tree: 'Windbreak and wood close by (+1 fuel per trip).',
  river: 'Water at hand (+2 per trip), but the damp chills.',
  hill: 'A fine view and nothing to stop the wind.',
};

const OUTCOME: Record<OutcomeKind, { head: string; body: string }> = {
  survived: { head: 'YOU MADE IT TO THE THAW', body: 'The ice breaks on the streams and the light comes back. Whatever the winter took from you, you are still here — and the Reach knows your name.' },
  thrive: { head: 'YOU RIDE OUT WITH THE CARAVAN', body: 'You climb aboard rested and provisioned, trading surplus rations for a corner of the wagon and word of the road ahead. Region 2 opens already half-known to you.' },
  ragged: { head: 'YOU SCRAMBLE ABOARD THE CARAVAN', body: 'You leave a half-built camp behind. The traders share what they can, but you spend the first leg recovering. You reach the next region alive — just thin.' },
  crossed: { head: 'YOU STRIKE OUT ALONE', body: 'Cold gear cinched, rations packed, a route in your head — you walk out into the white. It is brutal and slow, but you make it through on what you built, beholden to no one.' },
  turnedBack: { head: 'THE ROAD TURNS YOU BACK', body: 'You push into the winter stretch underprepared. The cold finds every gap; days in, you turn back carrying a lasting mark: frostbite, a permanent injury.' },
  wintered: { head: 'YOU WINTER OVER IN THE REACH', body: 'The snows close the Reach in, but your shelter holds warm, the larder lasts and the fire never dies. When thaw comes, the Reach is yours.' },
  collapsed: { head: 'THE CARAVAN FINDS YOU', body: 'Worked past the end of yourself, your body simply stops — days before the thaw. The spring caravan, coming up the valley, finds you and carries you out, barely alive. You keep what you learned — and the lesson about limits.' },
  died: { head: 'THE REACH TAKES YOU', body: 'The Reach does not forgive: thirst, hunger, the cold, or a collapse with no one near but the wild. Your story ends here — what you learned dies with you. Another Warden will have to begin again.' },
  grim: { head: 'A GRIM WINTER', body: 'You hunker down on too little. The larder runs thin, the shelter leaks heat, and the cold grinds at you week after week. You limp into spring weaker than you started.' },
};

// ── Small helpers ───────────────────────────────────────────────────────────

/** Escape text for innerHTML — sim text is ours today, but a save could be edited. */
const esc = (t: string | number): string => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
/** Hours for display: snow and blizzards stretch work into fractions, so show at most one decimal. */
const hrs = (h: number): string => String(Math.round(h * 10) / 10);
const pct = (x: number): number => Math.max(0, Math.min(100, x * 100));
const band = (ratio: number): string => (ratio > 0.75 ? 'fresh' : ratio > 0.45 ? 'ok' : ratio > 0.2 ? 'warn' : 'low');

// ── Rendering ───────────────────────────────────────────────────────────────

function poolRow(label: string, p: Pool): string {
  const b = band(p.cap > 0 ? p.current / p.cap : 0);
  // One scale up to the ceiling, so growth past the baseline is visible.
  return `<div class="vital"><span class="vn">${label}</span><div class="track">`
    + `<div class="fill ${b}" style="width:${pct(p.current / CAP_CEIL)}%"></div>`
    + `<span class="mark base" style="left:${pct(BASELINE / CAP_CEIL)}%"></span>`
    + `<span class="mark cap" style="left:${pct(p.cap / CAP_CEIL)}%"></span>`
    + `</div><span class="vs ${b}">${Math.round(p.current)} / ${Math.round(p.cap)}</span></div>`;
}

function moodLine(a: AppState): string {
  const v = a.sim.vitals;
  if (v.vigor.current <= 0) return 'Spent — your legs are done. Push on and it costs your health.';
  if (v.clarity.current <= 0) return 'Burnt out — you can barely think.';
  const m = morale(v);
  return m > 0.78 ? 'You feel sharp and steady.' : m > 0.58 ? 'Steady enough.' : m > 0.38 ? 'Worn thin; everything asks a little more.' : 'Running on fumes.';
}

function timeline(a: AppState): string {
  const cal = a.sim.config.calendar;
  const last = cal.thawDay;
  // Day d sits at the left edge of its slot; slots are 1/last wide.
  const x = (d: number): number => ((d - 1) / last) * 100;
  return `<div class="timeline">`
    + `<div class="season autumn" style="width:${x(cal.winterDay)}%"></div>`
    + `<div class="season winter" style="width:${100 - x(cal.winterDay)}%"></div>`
    + `<span class="lbl" style="left:0">AUTUMN</span>`
    + `<span class="lbl" style="left:${x(cal.winterDay)}%">WINTER</span>`
    + `<span class="lbl" style="left:${x(cal.thawDay) - 8}%">THAW</span>`
    + `<div class="today" style="left:${Math.min(99.5, x(a.sim.day + 0.5))}%"></div></div>`
    + `<div class="tl-legend"><span><b>Autumn</b> — prepare, days 1–${cal.winterDay - 1}</span><span><b>Winter</b> — survive, days ${cal.winterDay}–${cal.thawDay - 1}</span><span><b>Thaw</b> — day ${cal.thawDay}</span></div>`;
}

const WEATHER_ICON: Record<WeatherId, string> = { clear: '☀', overcast: '☁', rain: '🌧', fog: '🌫', wind: '🌬', storm: '⛈', snow: '❄' };

/**
 * The season strip (#1308): one bar per day from day 1 to the thaw, its
 * height the day's daylight — so the shortening days are something you see —
 * coloured by season, with the first snow and midwinter marked. Under it,
 * today: the weather, the light, the cold and the snow cover.
 */
function seasonStrip(a: AppState): string {
  const s = a.sim;
  const cal = s.config.calendar;
  const days = cal.thawDay - 1;
  const midwinter = cal.winterDay + MIDWINTER_AFTER;
  const bars = Array.from({ length: days }, (_, i) => {
    const d = i + 1;
    const cls = [seasonOf(d, cal), d < s.day ? 'past' : d === s.day ? 'now' : '', d === cal.winterDay || d === midwinter ? 'mark' : ''].join(' ');
    // Daylight runs about 6–11.5 hours; scale it so midwinter's short days still show.
    return `<i class="${cls}" style="height:${Math.round(25 + 75 * Math.min(1, (daylightHours(d, cal) - 5) / 7))}%" title="Day ${d} · ${daylightHours(d, cal).toFixed(1)}h of light"></i>`;
  }).join('');
  // Markers sit over the centre of their day's bar.
  const at = (d: number): string => `left:${(((d - 0.5) / days) * 100).toFixed(2)}%`;
  const marks = `<span class="sm" style="${at(cal.winterDay)}">FIRST SNOW</span><span class="sm" style="${at(midwinter)}">MIDWINTER</span><span class="sm end">THAW ▸</span>`;
  const seeded = s.config.world.weather === 'seeded';
  const blizzard = seeded && isBlizzard(s.weatherToday, s.day, cal);
  const today = [
    seeded ? `<span class="wx ${blizzard ? 'danger' : ''}">${WEATHER_ICON[s.weatherToday]} ${esc(weatherName(s.weatherToday, s.day, cal))}</span>` : '',
    `<span>☼ ${daylightHours(s.day, cal).toFixed(1)}h light</span>`,
    seeded ? `<span>${Math.round(dayMean(s.day, cal))}°C</span>` : '',
    seeded && (s.snowDepth ?? 0) > 0 ? `<span>snow cover ${Math.round((s.snowDepth ?? 0) * 100)}%</span>` : '',
  ].filter(Boolean).join('');
  return `<div class="seasonstrip" aria-label="The season, day by day"><div class="bars">${bars}</div><div class="marks">${marks}</div>`
    + `<div class="today">${today}</div>`
    + (blizzard ? `<p class="lockbanner">❄ A BLIZZARD — work out on the land takes ${BLIZZARD_HOURS}× as long, and the white is no place to be. Camp work is safe.</p>` : '')
    + '</div>';
}

/** The nights the outlook measures against: the rest of the winter (all of it, while it's still autumn). */
const outlookNights = (s: AppState['sim']): number => Math.min(winterOutlook(s).nightsToThaw, s.config.calendar.thawDay - s.config.calendar.winterDay);

/** What falls short of the thaw, in plain words (empty when nothing does). */
function outlookWarnings(s: AppState['sim']): string[] {
  const o = winterOutlook(s);
  const need = outlookNights(s);
  const out: string[] = [];
  if (need === 0) return out; // the thaw: nothing left to last
  if (o.foodDays < need) out.push(`Food lasts ${o.foodDays} night${o.foodDays === 1 ? '' : 's'} — ${need - o.foodDays} short of the thaw.`);
  if (o.fuelDays < need) out.push(`Firewood lasts ${o.fuelDays} night${o.fuelDays === 1 ? '' : 's'} — about ${Math.max(0, o.fuelToThaw - s.stores.firewood)} more wood to see the winter out.`);
  if (o.warmthMargin < 0) out.push('The shelter is too cold for a clear midwinter night, even with the fire in. Walls, bedding or cold gear.');
  return out;
}

/** The winter outlook (#1308): food, fuel and warmth against the nights to the thaw. Replaces the readiness pillars. */
function outlookBlock(a: AppState): string {
  const s = a.sim;
  const cal = s.config.calendar;
  const o = winterOutlook(s);
  const need = outlookNights(s);
  const warmNeed = coldNightNeeds(nightTemp(cal.winterDay + MIDWINTER_AFTER, 'clear', cal));
  const row = (name: string, progress: number, status: string, ok: boolean): string =>
    `<div class="pillar"><span class="pn">${name}</span><div class="track"><div class="fill ${ok ? 'done' : 'short'}" style="width:${pct(progress)}%"></div></div><span class="st ${ok ? 'done' : 'short'}">${status}</span></div>`;
  const warnings = outlookWarnings(s);
  return row('FOOD', need ? o.foodDays / need : 1, `${o.foodDays} / ${need} NIGHTS`, o.foodDays >= need)
    + row('FUEL', need ? o.fuelDays / need : 1, `${o.fuelDays} / ${need} NIGHTS`, o.fuelDays >= need)
    // Warmth is judged against the year's hardest kind of night: clear, at midwinter.
    + row('WARMTH', (warmth(s) + FIRE_WARMTH) / warmNeed, `${Math.floor((warmth(s) + FIRE_WARMTH) * 100)}% / ${Math.ceil(warmNeed * 100)}%`, o.warmthMargin >= 0)
    + `<p class="mood" style="margin:6px 0 0">Water: ${o.waterDays} night${o.waterDays === 1 ? '' : 's'} in hand — fetch it as you go.</p>`
    + (warnings.length ? `<ul class="warnlist">${warnings.map(w => `<li>⚠ ${esc(w)}</li>`).join('')}</ul>` : `<p class="mood ok">Enough laid by to reach the thaw, if nothing goes wrong.</p>`);
}

/** Queue entries whose options menu is open (UI-only; reset when the queue shifts). */
const expanded = new Set<number>();

/** Which ring the palette's land actions aim at (UI-only; not saved). */
let focusRing: Ring = 1;

/** The ring whose remembered places are listed on the land (#1380), if any. */
let pinRing: Ring | null = null;

const DOMAIN_LABEL: Record<Domain, string> = { forage: 'Forage', timber: 'Timber', stone: 'Stone', water: 'Water', game: 'Game', routes: 'Routes' };

/**
 * What you know of the land, ring by ring, as confidence chips (design §3):
 * ??? unknown · ~suspected · observed · detailed — plus the finds you've made.
 */
function land(a: AppState): string {
  const e = a.sim.explore;
  return RINGS.map(r => {
    const head = `<div class="ringhead">${RING_NAME[r].toUpperCase()} <span>${TRAVEL_HOURS[r] ? `+${TRAVEL_HOURS[r]}h` : 'home'}</span></div>`;
    if (!reachable(e, r) && domainsOf(r).every(d => level(e, r, d) === 0)) return `${head}<p class="mood" style="margin:0 0 6px">Out of reach — know the ring inside it first.</p>`;
    const chips = domainsOf(r).map(d => {
      const lv = level(e, r, d);
      // What the land holds (#1304): only worth saying once you know the place, and once it isn't plenty.
      const supply = d === 'routes' ? null : supplyWord(e.supply[r][d]);
      const label = (lv === 0 ? '???' : lv === 1 ? `~${DOMAIN_LABEL[d]}` : DOMAIN_LABEL[d]) + (lv > 0 && supply && supply !== 'plenty' ? ` · ${supply}` : '');
      return `<span class="chip l${lv}" title="${DOMAIN_LABEL[d]}: ${LEVEL_NAME[lv]}${supply ? ` · ${supply}` : ''}${e.worked[r][d] ? ` · worked ${e.worked[r][d]}×` : ''}">${label}</span>`;
    }).join('');
    const finds = domainsOf(r).filter(d => hasFind(e, r, d)).map(d => `<span class="chip find">★ ${FINDS[d]?.name}</span>`).join('');
    const pass = r === 3 && routeKnown(a.sim) ? '<span class="chip find">★ The pass</span>' : '';
    // Places you remember there (#1380): a 📌 that lists them when tapped.
    return `${head}<div class="res">${chips}${finds}${pass}${ringPinChip(a.sim, r, pinRing === r)}</div>${pinRing === r ? ringPins(a.sim, r) : ''}`;
  }).join('');
}

/** Names of the recipes you know (for the Tools & knowledge panel). */
function knownList(s: AppState['sim']): string {
  const name = (id: string): string => DISCOVERIES.find(d => d.recipe === id)?.name ?? RECIPE_NAMES[id] ?? id;
  return s.known.map(name).join(', ');
}
const RECIPE_NAMES: Record<string, string> = { 'shelter-leanto': 'Lean-to', 'shelter-timber': 'Timber walls', 'cold-gear': 'Woven cold gear', 'stone-knife': 'Stone knife', bedroll: 'Bedroll' };
const undiscovered = (s: AppState['sim']): number => DISCOVERIES.filter(d => !s.known.includes(d.recipe)).length;

// ── Blocks (each tab is composed from these) ────────────────────────────────

const storeChip = (icon: string, label: string, n: number, low = false): string => `<span class="r ${low ? 'low' : ''}">${icon} ${label} <b>${n}</b></span>`;

// ── Carrying (#1296) ────────────────────────────────────────────────────────

const GEAR_NAME: Record<GearItem | 'waterskin', string> = { basket: 'basket', backpack: 'backpack', harness: 'harness', sled: 'sled', waterskin: 'waterskin' };
const HAUL_NAME: Record<keyof Haul, string> = { rawFood: 'food', rations: 'rations', water: 'water', firewood: 'fuel', materials: 'mat', stone: 'stone', hides: 'hide' };
const haulText = (h: Haul): string => (Object.keys(h) as (keyof Haul)[]).filter(k => (h[k] ?? 0) > 0).map(k => `${h[k]} ${HAUL_NAME[k]}`).join(', ');

/**
 * A trip's load bar (#1296): the fill is the bulk of what's carried, the end of the bar is the max you
 * can lift (a hard line), and a tick marks the comfortable load. Green comfortable, amber heavy, red staggering.
 */
function loadBar(l: TripLoad): string {
  const left = haulText(l.left);
  // Overload costs only on a walk home (#1292): near camp, a heavy load is just heavy.
  const word = left ? `too much to carry — ${left} left behind` : l.ratio <= 1 ? 'comfortable' : !l.walk ? 'heavy, but camp is close' : l.ratio <= 1.5 ? 'heavy' : l.ratio <= 2 ? 'staggering' : 'barely able to carry it';
  const cls = left ? 'over' : l.ratio <= 1 || !l.walk ? 'ok' : l.ratio <= 1.5 ? 'heavy' : 'stagger';
  const help = l.wouldHelp.length && (left || (l.ratio > 1 && l.walk)) ? ` · a ${GEAR_NAME[l.wouldHelp[0]]} would make this easier` : '';
  return `<div class="loadrow ${cls}" title="Bulk ${Math.round(l.cumbersome)} of ${Math.round(l.max)} stones (comfortable ${Math.round(l.comfortable)})">`
    + `<span class="lhaul">↩ ${esc(haulText(l.haul))}</span>`
    + `<span class="lbar"><span class="lfill" style="width:${pct(l.cumbersome / l.max)}%"></span><span class="lcomf" style="left:${pct(l.comfortable / l.max)}%"></span></span>`
    + `<span class="lword">${esc(word)}${esc(help)}</span></div>`;
}

/** The WARDEN tab's carrying panel (#1296): what you can lift, your gear, and how strained you are. */
function carryingBlock(s: AppState['sim']): string {
  const st = s.character.stats;
  const gear = s.tools.filter(t => (GEAR_ITEMS as readonly string[]).includes(t.item));
  const chips = gear.length ? gear.map(t => `<span class="r tool ${t.grade}">${esc(GEAR_NAME[t.item as GearItem])} <b>${t.grade.toUpperCase()}</b></span>`).join('')
    : '<span class="mood" style="margin:0">No carrying gear — a basket, backpack, harness or sled would make loads easier.</span>';
  const strain = s.strain ?? 0;
  const status = s.today.exhausted ? `<p class="lockbanner">EXHAUSTED — your back aches from yesterday's loads. All work drains ${Math.round((EXHAUSTED_DRAIN - 1) * 100)}% more today.</p>`
    : strain >= 0.5 ? `<p class="mood warn">Aching back — strain ${strain.toFixed(1)}. Tonight's recovery ${Math.round((1 - strainRecovery(strain)) * 100)}% less; a night's rest halves it.</p>`
      : '<p class="mood ok">No strain — fresh for a heavy haul.</p>';
  return `<div class="carrystats"><span>MAX <b>${maxLoad(st)}</b> stones</span><span>COMFORTABLE <b>${Math.round(comfortableLoad(st))}</b></span></div>
    <div class="res" style="margin-top:6px">${chips}</div>${status}`;
}

/** The CAMP tab's cold storage (#1296): raw food kept cold or exposed, and what tonight will cost. */
function coldBlock(s: AppState['sim']): string {
  if (s.config.world.weather !== 'seeded') return '';
  const t = nightTemp(s.day, s.weatherToday, s.config.calendar);
  const cap = coldCapacity(s, t);
  const sp = spoilage(s.stores.rawFood, cap, t);
  const pit = s.site && s.coldPitAt === s.site ? `a cold pit (${coldPitHolds(s.site)})` : null;
  const snow = cap - (pit ? coldPitHolds(s.site) : 0) > 0 ? `the snow (${cap - (pit ? coldPitHolds(s.site) : 0)})` : null;
  const where = [pit, snow].filter(Boolean).join(' and ') || 'nothing — dig a cold pit';
  return `<div class="coldrow"><span>🧊 Kept cold <b>${sp.kept}</b> / ${cap}</span><span>Exposed <b>${sp.exposed}</b></span>`
    + `<span class="${sp.spoiled ? 'warn' : 'ok'}">${sp.spoiled ? `${sp.spoiled} will go bad tonight` : 'nothing will spoil tonight'}</span></div>`
    + `<p class="mood" style="margin:4px 0 0">Cold storage: ${where}. Rations never spoil.</p>`;
}

function storesRow(s: AppState['sim']): string {
  const st = s.stores;
  // A running hunger/thirst streak shows on the chip: the next night without costs more (#1233).
  const streak = (n: number, word: string): string => (n ? ` <span class="streak">${word} ×${n}</span>` : '');
  return `<div class="res">${storeChip('🍖', 'Food', st.rawFood, st.rawFood < 1).replace('</span>', `${streak(s.deprivation.hungry, 'HUNGRY')}</span>`)}${storeChip('💧', 'Water', st.water, st.water < 1).replace('</span>', `${streak(s.deprivation.thirsty, 'THIRSTY')}</span>`)}${storeChip('🪵', 'Fuel', st.firewood)}${storeChip('🪨', 'Mat', st.materials)}${storeChip('🧂', 'Rations', st.rations)}${storeChip('⛰️', 'Stone', st.stone)}${storeChip('🦌', 'Hides', st.hides)}</div>`;
}

/** A portrait frame (or a blank silhouette for an unnamed quick-start Warden). */
function portraitEl(id: string | null, size: number, cls = ''): string {
  const p = portraitById(id);
  return p ? `<span class="portrait ${cls}" role="img" aria-label="${esc(p.label)}" style="${portraitStyle(p, size)}"></span>` : `<span class="portrait blank ${cls}" style="width:${size}px;height:${size}px" aria-hidden="true">?</span>`;
}

/** Status-bar focus chip (#1238): the focus, or SURVIVAL in red with the reason when locked. Opens the Warden tab. */
function focusChip(s: AppState['sim']): string {
  const lock = survivalLockOf(s);
  if (lock) return `<button class="focuschip locked" data-tab="warden" title="Survival has taken over your thoughts">FOCUS <b>SURVIVAL</b> <span>${esc(lock)}</span></button>`;
  // Willpower moves the line where focus frays (#1256).
  const below = statEffects(s.character.stats).unreliableBelow;
  const frayed = s.focus && s.vitals.clarity.current < below;
  return `<button class="focuschip ${s.focus ? '' : 'none'}" data-tab="warden" title="${frayed ? `Clarity under ${below} — focus is unreliable` : 'What your mind is working on'}">FOCUS <b>${esc(focusLabel(s.focus))}</b>${frayed ? ' <span>frayed</span>' : ''}</button>`;
}

/** The eating plan (#1305): tap to cycle full → half → none. */
function eatingChip(s: AppState['sim']): string {
  const plan = s.eating ?? 'full';
  const label = plan === 'full' ? 'FULL' : plan === 'half' ? 'HALF' : 'NONE';
  const tip = plan === 'full' ? 'A meal every night' : plan === 'half' ? 'A meal every other night: stretches the larder, wears the body' : 'Fasting: the food stays untouched';
  return `<button class="focuschip ${plan === 'full' ? 'none' : ''}" data-cmd="eat" title="${tip} — tap to change">RATIONS <b>${label}</b></button>`;
}

/** The focus picker (#1238): goals, skills, concepts; the lock banner when survival overrides. */
function focusBlock(s: AppState['sim']): string {
  const lock = survivalLockOf(s);
  const cur = focusKey(s.focus);
  const chip = (key: string, label: string, note: string) =>
    `<button class="fchip" data-focus="${key}" aria-pressed="${cur === key}" title="${esc(note)}">${esc(label)}</button>`;
  const goals = GOAL_IDS.map(g => chip(`goal:${g}`, GOALS[g].name, `${GOALS[g].actions.join(', ')}: +1 yield, 10% lighter`)).join('');
  const skills = SKILL_IDS.map(k => chip(`skill:${k}`, SKILLS[k].name, 'practises 3x as fast')).join('');
  const concepts = FOCUS_CONCEPTS.map(c => chip(`concept:${c}`, c[0].toUpperCase() + c.slice(1), `${CONCEPT_PER_HOUR} insight per hour you work`)).join('');
  return `${lock ? `<p class="lockbanner">⚠ SURVIVAL HAS TAKEN OVER — ${esc(lock)}. Water, food, wood and shelter work goes better; learning waits until it passes.</p>` : ''}
    <p class="mood" style="margin-top:0">One thing at a time. Costs ${FOCUS_COST} Clarity a night; below ${statEffects(s.character.stats).unreliableBelow} Clarity it's halved.</p>
    <p class="fgroup">GOAL</p><div class="fchips">${goals}</div>
    <p class="fgroup">SKILL</p><div class="fchips">${skills}</div>
    <p class="fgroup">CONCEPT</p><div class="fchips">${concepts}</div>
    <div class="fchips" style="margin-top:6px">${chip('none', 'No focus', 'free your mind (saves the Clarity)')}</div>`;
}

/** The Warden tab (#1239): who you are — portrait, name, rank, focus, stats, talents, skills, concepts. */
function wardenTab(a: AppState): string {
  const c = a.sim.character;
  // Talents (#1263): the known ones by name; a hidden one only as a hint that it exists. Tiers are never shown.
  const hidden = c.talents.filter(t => !t.known).length;
  const talents = c.talents.length
    ? c.talents.filter(t => t.known).map(t => `<div class="trait"><b>${esc(TALENTS[t.id].name)}</b><span class="up">+ ${esc(TALENTS[t.id].blurb)}</span>${t.id === 'tough' && c.lastStandUsed ? '<span class="note">last stand used this run</span>' : ''}</div>`).join('')
      + (hidden ? '<div class="trait hidden"><b>A hidden gift</b><span class="note">Something in you not yet known. Watch for signs.</span></div>' : '')
    : '<p class="mood">No talents — a quick-start Warden. Start a fresh Warden to choose two.</p>';
  const concepts = Object.entries(a.sim.concepts).filter(([, p]) => p.rank > 0 || p.insight > 0);
  return `<div class="cols">
    <section class="box"><div class="idcard">${portraitEl(c.portrait, 120)}<div><p class="eyebrow">ARTIFICER</p><h2 class="wname">${esc(c.name || 'Unnamed Warden')}</h2>
      <p class="wrank">RANK: ${artificerRank(a.sim).toUpperCase()} <span>· ${conceptRanks(a.sim)} concept rank${conceptRanks(a.sim) === 1 ? '' : 's'}</span></p></div></div>
      <p class="eyebrow" style="margin-top:16px">FOCUS</p>${focusBlock(a.sim)}
      <p class="eyebrow" style="margin-top:16px">STATS — ${c.age !== undefined ? `age ${c.age}${isYoung(c.age) ? ', still growing' : ', grown'}` : "what you're built for"}</p>${statsBlock(c.stats, c.adult)}
      <p class="eyebrow" style="margin-top:16px">CARRYING — what a trip can bring home</p>${carryingBlock(a.sim)}
      ${packBlock(a.sim)}
      <p class="eyebrow" style="margin-top:16px">TALENTS</p><div class="traits">${talents}</div>
      <p class="eyebrow" style="margin-top:16px">QUIRKS — how you are, as far as you know it</p><div class="traits">${quirksBlock(c)}</div>${roadKeepsBlock(a)}</section>
    <section class="box"><p class="eyebrow">SKILLS — improve by doing, faster with focus; techniques come by practice or teaching</p>${skillsBlock(a.sim)}
      <p class="eyebrow" style="margin-top:16px">CONCEPTS — deepen by study and craft</p>
      ${concepts.length ? `<ul class="concepts">${concepts.map(([id, p]) => `<li><b>${esc(id[0].toUpperCase() + id.slice(1))}</b> rank ${p.rank} <span>· ${p.insight.toFixed(1)} insight</span></li>`).join('')}</ul>` : '<p class="mood">Nothing studied yet. Study a concept, or craft, to start.</p>'}</section>
  </div>`;
}

/**
 * Quirks (#1364): the ones you know, by name and what they do; hidden ones only as a hint; and
 * any fears, with how far you've come in facing them.
 */
function quirksBlock(c: AppState['sim']['character']): string {
  const qs = c.quirks ?? [];
  const known = qs.filter(q => q.known && !isFear(q.id)).map(q => `<div class="trait quirk"><b>${esc(quirkName(q.id))}</b><span class="note">${esc(QUIRKS[q.id]?.blurb ?? '')}</span></div>`);
  const fears = qs.filter(q => isFear(q.id)).map(q => {
    const tag = q.id.slice(5), words = FEAR_OF[tag] ?? tag, fades = tag === 'dark' ? DARK_FADES : FEAR_FADES;
    return `<div class="trait fear"><b>${esc(quirkName(q.id))}</b><span class="down">− ${esc(words)} look${words.endsWith('s') ? '' : 's'} worse to you</span><span class="note">Face ${words.endsWith('s') ? 'them' : 'it'} calmly to fade it: ${q.faced ?? 0} of ${fades}.</span></div>`;
  });
  const hidden = qs.filter(q => !q.known).length;
  const hint = hidden ? `<div class="trait hidden"><b>${hidden === 1 ? 'Something' : 'Things'} you don't know about yourself yet</b><span class="note">How you are when it's too much shows itself when it's too much.</span></div>` : '';
  return known.join('') + fears.join('') + hint || '<p class="mood">Nothing known yet.</p>';
}

/** Marks and contacts (#1252): what the road earned, and what carries to the next road. */
function roadKeepsBlock(a: AppState): string {
  const marks = a.road?.marks ?? a.sim.marks ?? 0;
  const contacts = a.road ? [...new Set([...a.road.contacts, ...Object.entries(a.road.trust).filter(([, t]) => t >= CONTACT_TRUST).map(([id]) => id)])] : a.sim.contacts ?? [];
  if (!a.road && !marks && !contacts.length) return '';
  return `<p class="eyebrow" style="margin-top:16px">THE ROAD — marks &amp; contacts</p>
    <div class="res"><span class="chip">🪙&nbsp;<b>${marks}</b>&nbsp;marks</span></div>
    ${contacts.length ? `<ul class="contacts">${contacts.map(id => { const p = personById(id); return `<li><b>${esc(p?.name ?? id)}</b> <span>${esc(p?.role ?? '')} · trust ${Math.round(a.road?.trust[id] ?? CONTACT_TRUST)}</span></li>`; }).join('')}</ul>` : `<p class="mood">No contacts yet — anyone whose trust in you reaches ${CONTACT_TRUST} will remember you.</p>`}`;
}

/** The hike pack (#1400): what you brought, each with what it does, and what's left of what runs out. */
function packBlock(s: AppState['sim']): string {
  if (!s.kit) return '';
  const left = kitSupplies(s.kit, s.dressings ?? 0);
  return `<p class="eyebrow" style="margin-top:16px">THE PACK — what you brought on the hike</p>
    <div class="packlist">${s.kit.items.map(id => `<span class="packitem" title="${esc(kitItem(id).effect)}">${esc(kitItem(id).name)}</span>`).join('')}</div>
    ${left.length ? `<p class="mood" style="margin:6px 0 0">Left: ${esc(left.join(' · '))}</p>` : ''}`;
}

/**
 * Stats (#1256, #1258), shown exactly — unlike skills, you know your own body and mind. While
 * young (#1399), each shows what it grows to.
 */
function statsBlock(st: Stats, adult?: Stats): string {
  return `<div class="statgrid">${STAT_IDS.map(id => `<div class="stat ${st[id] > 10 ? 'hi' : st[id] < 10 ? 'lo' : ''}" title="${esc(STATS[id].blurb)}">`
    + `<span class="sk">${STATS[id].short}</span><span class="sv">${st[id]}</span>${adult && adult[id] !== st[id] ? `<span class="sg">grows to ${adult[id]}</span>` : '<span></span>'}`
    + `<span class="sd">${esc(statNote(id, st[id]))}</span></div>`).join('')}</div>`;
}

/**
 * Skills (#1236, #1241) as the Warden sees them: a *self-assessed* level and
 * how close it feels to the next. The true level is hidden (Dunning–Kruger) —
 * you feel it in the work instead.
 */
function skillsBlock(s: AppState['sim']): string {
  return `<p class="mood" style="margin-top:0">How good you <i>think</i> you are. The work itself tells the truth.</p><div class="skills">${SKILL_IDS.map(id => {
    const seems = perceivedProgress(s.skills[id] ?? 0);
    const lvl = Math.floor(seems);
    const name = LEVELS[lvl];
    return `<div class="skill" title="${esc(SKILLS[id].blurb)} — self-assessed"><span class="sn">${esc(SKILLS[id].name)}</span>`
      + `<span class="sl ${isSupernatural(lvl) ? 'super' : ''}">${isSupernatural(lvl) ? '✦ ' : ''}${name}</span><div class="track"><div class="fill" style="width:${pct(lvl >= MAX_LEVEL ? 1 : seems - lvl)}%"></div></div>`
      + `<div class="techs">${TECHNIQUES.filter(t => t.skill === id).map(techChip(s)).join('')}</div></div>`;
  }).join('')}</div>${s.manuals.length ? `<p class="mood">Manuals: ${s.manuals.map(m => `<b>${esc(manualById(m)?.name ?? m)}</b>`).join(', ')} — they guide your practice and teach what's within reach.</p>` : ''}`;
}

/** How a technique (#1243) is learned, as a hint for one you don't know yet. */
const LEARN_HINT: Record<Technique['difficulty'], string> = {
  easy: 'comes with a little practice',
  hard: 'slow to work out alone — a manual or teacher helps',
  teacher: 'can only be taught',
};

/** One technique: named once known; otherwise a hint at how it's learned. Each is typical of a level, not locked to it. */
const techChip = (s: AppState['sim']) => (t: Technique): string => s.techniques.includes(t.id)
  ? `<span class="tech known" title="${esc(t.how)} — typical of ${LEVELS[t.level]}">${esc(t.name)}</span>`
  : `<span class="tech ${t.difficulty}" title="Typical of ${LEVELS[t.level]}: ${LEARN_HINT[t.difficulty]}">? ${t.difficulty === 'teacher' ? 'taught only' : t.difficulty}</span>`;

function vitalsBlock(a: AppState): string {
  const v = a.sim.vitals;
  return `<div class="vitals">${poolRow('VIGOR', v.vigor)}${poolRow('CLARITY', v.clarity)}
      <div class="vital"><span class="vn">RESERVE</span><div class="track"><div class="fill ${band(v.condition / 100)}" style="width:${pct(v.condition / 100)}%"></div></div><span class="vs ${band(v.condition / 100)}">${Math.round(v.condition)}%</span></div>
    </div><p class="mood">${moodLine(a)}</p>`;
}

function sitesBlock(a: AppState): string {
  const s = a.sim;
  const sites = (Object.keys(SITES) as SiteId[]).map(id =>
    `<button class="siteopt ${s.site === id ? 'chosen' : ''}" data-site="${id}" ${scouted(s.explore, 1) && !s.outcome ? '' : 'disabled'}>`
    + `<div class="t">${SITES[id].name.toUpperCase()}<span class="warm" style="margin-left:auto">MAX ${Math.round(SITES[id].warmth * 100)}% WARM</span></div>`
    + `<div class="d">${SITE_NOTE[id]}${s.site === id ? ` Shelter tier ${s.tier}/2${s.shelterGrade ? ` (${s.shelterGrade})` : ''} · ${Math.round(warmth(s) * 100)}% warm${s.coldPitAt === id ? ` · cold pit (${coldPitHolds(id)} raw food)` : ''}.` : ''}</div></button>`).join('');
  return `<div class="sites">${sites}</div>${scouted(s.explore, 1) ? '<p class="mood">Pick camp here, or choose a location on a queued build.</p>' : '<p class="mood">Scout first to find somewhere to settle.</p>'}`;
}

function toolsBlock(a: AppState): string {
  const s = a.sim;
  // Tool names come from the craft actions that make them (output item → action).
  const toolName = (item: string): string => (item === HIDE_PARKA_RECIPE.output.item ? HIDE_PARKA_RECIPE.name : Object.values(ACTIONS).find(x => x.recipe?.output.item === item)?.recipe?.name ?? item);
  const tools = s.tools.map(t => `<span class="r tool ${t.grade}">${esc(toolName(t.item))} <b>${t.grade.toUpperCase()}</b></span>`).join('');
  const concepts = Object.entries(s.concepts).filter(([, p]) => p.rank > 0 || p.insight > 0)
    .map(([id, p]) => `<span class="r concept">${esc(id)} <b>R${p.rank}</b></span>`).join('');
  return `<div class="res">${tools || '<span class="mood" style="margin:0">No tools yet — craft some once you have materials.</span>'}</div>
    ${concepts ? `<div class="res" style="margin-top:6px">${concepts}</div>` : ''}
    <p class="mood" style="margin:6px 0 0">Known recipes: ${esc(knownList(s))}${undiscovered(s) ? ` · ${undiscovered(s)} still to work out` : ''}</p>`;
}

function milesBlock(a: AppState): string {
  return `<ol class="miles">${REGION1_MILESTONES.map(m => {
    const done = a.sim.milestones.includes(m.id);
    return `<li class="${done ? 'done' : ''}"><span class="mk">${done ? '✓' : '·'}</span><span class="mn">${esc(m.name.toUpperCase())}</span></li>`;
  }).join('')}</ol>`;
}

function journal(a: AppState, limit: number): string {
  return [...a.sim.log].reverse().slice(0, limit).map((l: LogEntry) => {
    const cls = l.kind === 'hardship' ? 'bad' : l.kind === 'milestone' || l.kind === 'outcome' ? 'good' : l.kind === 'skip' ? 'skip' : '';
    return `<li class="${cls}"><span class="d">D${l.day}</span>${esc(l.text)}</li>`;
  }).join('') || '<li style="color:var(--faint);font-style:italic">Day 1 in the Reach. Scout before anything else — you don\'t yet know where food, water or wood are.</li>';
}

type Preview = ReturnType<typeof previewQueue>;

function paletteBlock(a: AppState, preview: Preview): string {
  const resolved = a.sim.outcome !== null;
  // Gates are judged against the state *after* the queue so far, so you can
  // plan "scout, then gather" in one go. Blocked actions stay clickable (a
  // skipped action costs nothing) but are dashed and say why.
  // Land actions go to the ring picked in the tabs; everything else happens at camp.
  const tabs = `<div class="rings">${RINGS.map(r => {
    const open = reachable(preview.projected.explore, r);
    return `<button class="ringtab ${focusRing === r ? 'on' : ''} ${open ? '' : 'locked'}" data-ring="${r}" title="${open ? '' : 'Scout the ring inside it first'}">`
      + `${RING_NAME[r].toUpperCase()}<span>${TRAVEL_HOURS[r] ? `+${TRAVEL_HOURS[r]}h travel` : 'home ground'}</span></button>`;
  }).join('')}</div>`;
  return tabs + GROUPS.map(g => `<div class="group"><h4>${g.title}${g.title === 'EXPLORE' || g.title === 'PROVISION' ? ` <span class="ringnote">· ${RING_NAME[focusRing].toLowerCase()} ring</span>` : ''}</h4><div class="acts">${g.ids.map(id => {
    const def = ACTIONS[id];
    const r: Ring = def.ringed ? focusRing : 1;
    const q = queueId(id, r);
    const why = blockedReason(preview.projected, id, r);
    const spends = [def.vigorRate < 0 ? 'vigor' : '', def.clarityRate < 0 ? 'clarity' : ''].filter(Boolean).join(' + ') || 'restores';
    return `<button class="act ${why ? 'soft' : ''}" data-q="${q}" ${resolved ? 'disabled' : ''} title="${why ? esc(`Would be skipped: ${why}`) : ''}">`
      + `<div class="t">${ICON[id]} ${def.name.toUpperCase()}<span class="h">${hrs(queueHours(q, preview.projected))}H</span></div>`
      + `<div class="y">${why ? `<span class="gate">${esc(why)}</span>` : `<span class="yield">${YIELD[id](preview.projected, r)}</span> · <span class="vc">${spends}</span>`}</div></button>`;
  }).join('')}</div></div>`).join('');
}

/** Today's planned hours (only entries that would run today and not be skipped). */
const todayHours = (a: AppState, preview: Preview): number =>
  a.queue.reduce((h, item, i) => h + (preview.dayOffset[i] === 0 && !preview.warnings[i] ? queueHours(item, preview.before[i]) : 0), a.sim.hoursToday);

/**
 * Before planning is learned (#1350): no queue — each tap does the thing now, and you end
 * the day yourself. The latest journal line shows what just happened.
 */
function oneAtATime(a: AppState): string {
  const s = a.sim;
  const last = s.log.at(-1);
  const spent = s.hoursToday >= DAY_HOURS;
  return `<div class="queue onestep">
      <p class="eyebrow" style="color:var(--gold);margin-bottom:8px">ONE THING AT A TIME</p>
      <p class="mood" style="margin:0 0 8px">${esc(queueLocked(a) ?? '')} Tap an action to do it now.</p>
      ${last ? `<p class="news ${last.kind}">${esc(last.text)}</p>` : ''}
      <div class="qtot"><span>Today <b>${hrs(s.hoursToday)} / ${DAY_HOURS}h</b></span>${spent ? '<span>The day is spent.</span>' : ''}</div>
      <div class="runbar"><button class="btn go" data-cmd="endday" ${s.outcome ? 'disabled' : ''}>☾ END THE DAY</button></div>
    </div>`;
}

function queueBlock(a: AppState, preview: Preview): string {
  const s = a.sim;
  if (!s.canPlan) return oneAtATime(a);
  const resolved = s.outcome !== null;
  // The day planning opened up (#1350): the queue arrives with a glow.
  const fresh = s.log.some(l => l.text === PLANNING_UNLOCKED && l.day >= s.day - 1);
  const items = a.queue.map((item, i) => {
    const { id, ring, opts } = parseItem(item);
    const d = preview.dayOffset[i];
    const why = preview.warnings[i];
    // Options are judged against the state this entry would run in (after the ones before it).
    const groups = ACTIONS[id].options?.(preview.before[i], opts) ?? [];
    const needsChoice = groups.some(g => g.value === null);
    const open = groups.length > 0 && (expanded.has(i) || needsChoice);
    const chosen = groups.map(g => g.choices.find(c => c.value === g.value)?.label).filter(Boolean).join(' · ');
    const toggle = groups.length ? `<button class="tog" data-toggle="${i}" aria-expanded="${open}" aria-label="Options">${open ? '▾' : '▸'}</button>` : '';
    const menu = open ? `<div class="opts">${groups.map(g => `<div class="optgroup"><span class="optlabel">${esc(g.label.toUpperCase())}</span><div class="optchoices">${g.choices.map(c =>
      `<button class="opt ${g.value === c.value ? 'on' : ''}" data-opt="${i}|${g.key}|${c.value}" ${c.blocked ? 'disabled' : ''} title="${esc(c.blocked ?? c.note)}">`
      + `<b>${esc(c.label)}</b><span>${esc(c.blocked ?? c.note)}</span></button>`).join('')}</div></div>`).join('')}</div>` : '';
    return `<li class="${why ? 'skip' : ''} ${open ? 'expanded' : ''}"><div class="row">${toggle}<span class="dayn">${d === 0 ? 'TODAY' : `DAY ${s.day + d}`}</span>`
      + `<span class="n">${ICON[id]} ${ACTIONS[id].name.toUpperCase()}${ring > 1 ? ` <span class="ringtag">${RING_NAME[ring].toUpperCase()}</span>` : ''}</span>`
      + (chosen && !open ? `<span class="chosen">${esc(chosen)}</span>` : '')
      + (why ? `<span class="why">skips: ${esc(why)}</span>` : '')
      // What a remembered place does for this trip (#1380).
      + (!why && ACTIONS[id].ringed && tripPinNote(preview.before[i].pins, id, ring) ? `<span class="why pinnote">${esc(tripPinNote(preview.before[i].pins, id, ring)!)}</span>` : '')
      + (preview.dangers[i] ? `<span class="why danger">⚠ ${esc(preview.dangers[i]!)}</span>` : '')
      // How it will feel out there (#1364): the dark, the weather, the distance — and what that does to you.
      + (preview.unease[i] ? `<span class="why unease u-${preview.unease[i]!.state}" title="The work wears the mind harder${preview.unease[i]!.state === 'panicked' ? ', and something out there could send you running' : ''}">🌑 ${esc(preview.unease[i]!.reasons.filter(r => r !== 'ground you know').join(' · '))} — ${preview.unease[i]!.state === 'shaken' ? "you'll be uneasy" : 'you may panic'}</span>` : '')
      + `<span class="meta">${hrs(queueHours(item, preview.before[i]))}h</span><button class="x" data-x="${i}" aria-label="Remove">×</button></div>${preview.loads[i] ? loadBar(preview.loads[i]!) : ''}${menu}</li>`;
  }).join('');
  const days = a.queue.length ? (preview.dayOffset.at(-1) ?? 0) + 1 : 0;
  return `<div class="queue ${fresh ? 'fresh' : ''}">
      <p class="eyebrow" style="color:var(--gold);margin-bottom:8px">THE QUEUE${fresh ? ' — NEW: PLAN AHEAD' : ''}</p>
      <ol>${items || `<li class="empty">Empty — tap actions to plan. A day is ${DAY_HOURS} waking hours; the queue spills into the next day and you sleep between.</li>`}</ol>
      <div class="qtot"><span>Today <b>${hrs(todayHours(a, preview))} / ${DAY_HOURS}h</b></span><span>Spans <b>${days}</b> day${days === 1 ? '' : 's'}</span></div>
      <div class="runbar">
        <button class="btn go" data-cmd="day" ${resolved ? 'disabled' : ''}>${a.queue.length ? '▶ RUN THE DAY' : '☾ PASS THE DAY'}</button>
        <button class="btn" data-cmd="all" ${resolved || !a.queue.length ? 'disabled' : ''}>⏭ RUN WHOLE QUEUE</button>
        <button class="btn" data-cmd="clear" ${a.queue.length ? '' : 'disabled'}>CLEAR</button>
      </div>
    </div>`;
}

/** Where we are in the season, in a few words (for the header chip). */
function phaseChip(a: AppState): string {
  const cal = a.sim.config.calendar;
  const d = a.sim.day;
  if (seasonOf(d, cal) === 'autumn') { const n = cal.winterDay - d; return `<span class="phase">AUTUMN · SNOW IN ${n} DAY${n === 1 ? '' : 'S'}</span>`; }
  if (seasonOf(d, cal) === 'thaw') return '<span class="phase gold">THE THAW</span>';
  const n = cal.thawDay - d;
  return `<span class="phase ice">WINTER · THAW IN ${n} DAY${n === 1 ? '' : 'S'}</span>`;
}

/** Always-visible summary: body, key stores, today's hours, readiness. */
function statusBar(a: AppState, preview: Preview): string {
  const s = a.sim;
  const mini = (label: string, cur: number, cap: number, max: number): string => {
    const b = band(cap > 0 ? cur / cap : 0);
    return `<span class="mini"><span class="ml">${label}</span><span class="mt"><span class="mf ${b}" style="width:${pct(cur / max)}%"></span></span><span class="mv ${b}">${Math.round(cur)}</span></span>`;
  };
  const st = s.stores;
  const ready = winterReady(s);
  return `<div class="statusbar">
    <div class="minis">${mini('VIG', s.vitals.vigor.current, s.vitals.vigor.cap, CAP_CEIL)}${mini('CLA', s.vitals.clarity.current, s.vitals.clarity.cap, CAP_CEIL)}${mini('RES', s.vitals.condition, 100, 100)}</div>
    <div class="sstores"><span class="${st.rawFood < 1 ? 'low' : ''}">🍖${st.rawFood}${a.sim.deprivation.hungry ? ` <i class="streak" title="Nights in a row without food">HUNGRY ×${a.sim.deprivation.hungry}</i>` : ''}</span><span class="${st.water < 1 ? 'low' : ''}">💧${st.water}${a.sim.deprivation.thirsty ? ` <i class="streak" title="Nights in a row without water">THIRSTY ×${a.sim.deprivation.thirsty}</i>` : ''}</span><span>🪵${st.firewood}</span><span>🪨${st.materials}</span><span>🧂${st.rations}</span></div>
    ${focusChip(s)}${eatingChip(s)}${nightChip(s)}
    <span class="shours">TODAY <b>${hrs(todayHours(a, preview))}/${DAY_HOURS}H</b></span>
    ${outlookTag(s, ready)}
  </div>`;
}

/** Tonight, if it looks frightening (#1364): an uneasy or sleepless night, and why. */
function nightChip(s: AppState['sim']): string {
  const f = tonightsFright(s);
  if (!f || f.state === 'calm' || s.outcome) return '';
  const why = f.reasons.filter(r => r !== 'home' && !r.startsWith('a warm')).join(', ');
  return `<span class="tag fear s-${f.state}" title="Tonight looks ${THREAT_WORDS[f.perceived]}: ${esc(why)}. ${f.state === 'shaken' ? 'You\'ll lie awake: less Clarity back.' : 'A sleepless night: much less Clarity and some Vigor back.'} Shelter, a fire, a camp you know — each helps.">🌑 ${f.state === 'shaken' ? 'UNEASY NIGHT' : 'SLEEPLESS NIGHT'}</span>`;
}

/** The status bar's verdict: readiness through the autumn; once the snow is down, whether what's laid by reaches the thaw. */
function outlookTag(s: AppState['sim'], ready: boolean): string {
  const season = seasonOf(s.day, s.config.calendar);
  if (season === 'thaw') return '';
  if (season === 'autumn') return `<span class="tag ${ready ? 'yes' : 'no'}">${ready ? 'WINTER-READY' : 'NOT READY'}</span>`;
  const short = outlookWarnings(s).length;
  return `<button class="tag ${short ? 'no' : 'yes'}" data-tab="progress" title="The winter outlook">${short ? 'FALLING SHORT' : 'HOLDING'}</button>`;
}

const OUTCOME_SHORT: Record<RunRecord['kind'], string> = { arrived: 'Reached Mistheim', survived: 'Survived the winter', thrive: 'Thrived — caravan', ragged: 'Ragged — caravan', crossed: 'Crossed alone', turnedBack: 'Turned back', wintered: 'Wintered well', grim: 'Grim winter', collapsed: 'Collapsed', died: 'Died' };

/** The history of finished runs (newest first), with the best one marked. */
function pastRuns(): string {
  if (!history.length) return '<p class="mood">No finished runs yet. Live through the winter to the thaw, and it will be recorded here.</p>';
  const best = bestRun(history);
  return `<ol class="runs">${history.map(r => `<li class="${r === best ? 'best' : ''}"><span class="rn">${r.characterName ? `${esc(r.characterName)} · ` : ''}RUN ${r.run}</span>`
    + `<span class="rk k-${r.kind}">${OUTCOME_SHORT[r.kind]}${r.grade ? ` — ${r.grade}` : ''}${r.injury ? ' · frostbite' : ''}</span>`
    + `<span class="rd">day ${r.day}${r.readyDay ? ` · ready d${r.readyDay}` : ''} · ${r.recipes} recipes</span>${r === best ? '<span class="rb">★ BEST</span>' : ''}</li>`).join('')}</ol>`;
}

const LAND_LEGEND = `<div class="legend"><span class="chip l0">???</span> unknown <span class="chip l1">~suspected</span> scouted <span class="chip l2">observed</span> surveyed <span class="chip l3">detailed</span> from working it <span class="chip find">★ find</span> +2 on those trips</div>`;

type Tab = 'plan' | 'camp' | 'land' | 'warden' | 'progress';
const TABS: { id: Tab; label: string }[] = [
  { id: 'plan', label: 'PLAN' }, { id: 'camp', label: 'CAMP' }, { id: 'land', label: 'LAND' }, { id: 'warden', label: 'WARDEN' }, { id: 'progress', label: 'PROGRESS' },
];
/** The open tab — a per-browser convenience, so storage failures just mean "Plan". */
let tab: Tab = (() => { try { const t = localStorage.getItem('artificer.tab'); return (TABS.some(x => x.id === t) ? t : 'plan') as Tab; } catch { return 'plan'; } })();
let showHelp = false;

function tabBody(a: AppState, preview: Preview): string {
  switch (tab) {
    case 'plan':
      return `<section class="box seasonbox">${seasonStrip(a)}</section><div class="plan">
        <section class="box"><p class="eyebrow">ACTIONS — ${a.sim.canPlan ? 'tap to add to the queue' : 'tap to do it now'}</p>${paletteBlock(a, preview)}</section>
        <section class="box planside">${queueBlock(a, preview)}
          <div class="log"><p class="eyebrow" style="color:var(--faint);margin-bottom:7px">LATEST</p><ul>${journal(a, 6)}</ul></div></section>
      </div>`;
    case 'camp':
      return `<div class="cols">
        <section class="box"><p class="eyebrow">THE WARDEN</p>${vitalsBlock(a)}
          <p class="eyebrow" style="margin-top:14px">STORES</p>${storesRow(a.sim)}${coldBlock(a.sim)}
          <p class="eyebrow" style="margin-top:14px">TOOLS &amp; KNOWLEDGE</p>${toolsBlock(a)}</section>
        <section class="box camp-scene"><p class="eyebrow">SITE &amp; SHELTER</p>${sitesBlock(a)}</section>
      </div>`;
    case 'land':
      return `<section class="box"><p class="eyebrow">THE LAND — what you know, ring by ring</p>${land(a)}${LAND_LEGEND}
        <p class="mood">Scout for the overview, survey to firm it up, and work the land for the detail. The near ring runs thin as you work it; push outward for richer ground.</p></section>
        <section class="box" style="margin-top:14px"><p class="eyebrow">PINS — places you remember</p>${pinsList(a.sim)}</section>`;
    case 'warden':
      return wardenTab(a);
    case 'progress':
      return `<div class="cols">
        <section class="box"><p class="eyebrow ice">THE SEASON</p>${timeline(a)}
          <p class="eyebrow" style="margin-top:16px">WINTER OUTLOOK</p>${outlookBlock(a)}
          <p class="eyebrow" style="margin-top:16px">MILESTONES</p>${milesBlock(a)}
          <p class="eyebrow" style="margin-top:16px">PAST RUNS</p>${pastRuns()}</section>
        <section class="box log"><p class="eyebrow" style="color:var(--faint);margin-bottom:7px">JOURNAL</p><ul class="full">${journal(a, 200)}</ul></section>
      </div>`;
  }
}

/** How the thaw finds a Warden of each grade, for the summary's headline. */
const THAW_HEAD: Record<Grade, string> = { hale: 'HALE — STRONGER FOR IT', worn: 'WORN THIN, BUT STANDING', broken: 'BROKEN, BUT ALIVE' };

/**
 * The winter's worst nights, from the journal: the winter days with the most
 * hardship, worst first (ties go to the earlier night), with what went wrong.
 */
function worstNights(s: AppState['sim'], n = 3): { day: number; lines: string[] }[] {
  const byDay = new Map<number, string[]>();
  for (const l of s.log) {
    // Work lines carry their hour (`at`); what's left is the evening and the night — the cold, hunger and thirst.
    if (l.kind !== 'hardship' || l.at || seasonOf(l.day, s.config.calendar) !== 'winter') continue;
    byDay.set(l.day, [...(byDay.get(l.day) ?? []), l.text]);
  }
  return [...byDay].map(([day, lines]) => ({ day, lines })).sort((x, y) => y.lines.length - x.lines.length || x.day - y.day).slice(0, n);
}

/**
 * The thaw summary (#1308): how you came through, what was left, the winter's
 * worst nights, and the spring caravan — whose road opens with Region 1.5 (#1250).
 */
function thawSummary(a: AppState): string {
  const s = a.sim;
  const grade = s.outcome?.grade ?? 'worn';
  const st = s.stores;
  const worst = worstNights(s);
  return `<div class="thaw"><p class="eyebrow ice">THE THAW — DAY ${s.day}</p><span class="grade g-${grade}">${THAW_HEAD[grade]}</span>
    <p class="mood" style="margin:6px 0 10px">Condition ${Math.round(s.vitals.condition)}% coming out of it.</p>
    <p class="fgroup">WHAT WAS LEFT</p><div class="res">${storeChip('🍖', 'Food', st.rawFood)}${storeChip('🧂', 'Rations', st.rations)}${storeChip('💧', 'Water', st.water)}${storeChip('🪵', 'Fuel', st.firewood)}${storeChip('🪨', 'Mat', st.materials)}</div>
    <p class="fgroup" style="margin-top:12px">THE WORST NIGHTS</p>${worst.length
      ? `<ul class="worst">${worst.map(w => `<li><span class="d">D${w.day}</span>${w.lines.map(esc).join(' ')}</li>`).join('')}</ul>`
      : '<p class="mood" style="margin:0">Not one hard night all winter.</p>'}
    ${a.stayed
      ? '<p class="mood" style="margin-top:12px">You let the caravan go on without you. The Reach is yours alone again.</p>'
      : `<div class="runbar" style="margin-top:12px"><button class="btn go" data-cmd="meet" title="The spring caravan has come up the valley (#1356)">🛞 MEET THE CARAVAN</button>
      <span class="mood" style="margin:0">Wagons in the valley: three villages, then Mistheim — if they'll take you.</span></div>`}</div>`;
}

function resolvePanel(a: AppState): string {
  const s = a.sim;
  if (s.outcome) {
    const o = OUTCOME[s.outcome.kind];
    const r = history[0];
    const facts = r ? `<ul class="runfacts">
        <li>${r.choice === 'thaw' ? 'Reached the thaw' : r.choice === 'collapse' ? 'Ended' : 'Left'} on <b>day ${r.day}</b>${r.grade ? ` — <b>${r.grade}</b>` : ''}${r.readyDay ? ` · winter-ready on <b>day ${r.readyDay}</b>` : ' · never winter-ready'}</li>
        <li>${r.site ? `${esc(SITES[r.site].name)}, shelter tier ${r.tier}${r.shelterGrade ? ` (${r.shelterGrade})` : ''}` : 'No camp'} · ${r.tools.length} tool${r.tools.length === 1 ? '' : 's'} · ${r.recipes} recipes · ${r.milestones} milestones</li>
      </ul>` : '';
    return `<div class="resolve"><h3>${s.outcome.choice === 'collapse' ? `✝ RUN ${r?.run ?? ''} ENDED` : `❄ REGION 1 COMPLETE — RUN ${r?.run ?? ''}`}</h3><div class="outcome"><span class="head">${o.head}</span>${o.body}</div>${s.outcome.kind === 'survived' ? thawSummary(a) : ''}${facts}`
      // Only a living Warden goes on (#1242): after a death, the only way forward is someone new.
      + `<div class="runbar" style="margin-top:12px">${canContinue(s)
        ? `<button class="btn go" data-cmd="carry" title="The same Warden goes on: recipes, concept ranks and skills carry over">↻ ${s.character.name ? `CONTINUE AS ${esc(s.character.name.toUpperCase())}` : 'NEW RUN'} — KEEP WHAT YOU LEARNED</button>`
        : ''}<button class="btn ${canContinue(s) ? '' : 'go'}" data-cmd="reset" title="A new person, starting from nothing">✦ ${canContinue(s) ? 'FRESH WARDEN' : 'NEW WARDEN'}</button></div></div>`;
  }
  return '';
}

function render(a: AppState): void {
  if (a.stage === 'road' && a.road) { renderRoad(a, a.road); return; }
  const preview = previewQueue(a);
  // The winter look (#1308): the panels frost over as the snow deepens.
  const winter = seasonOf(a.sim.day, a.sim.config.calendar) === 'winter';
  root.classList.toggle('winter', winter);
  root.style.setProperty('--snow', String(winter ? Math.max(0.25, a.sim.snowDepth ?? 0) : 0));
  const fresh = a.sim.log.length === 0;
  root.innerHTML = `
    <header>
      <h1>❄ GREYWIND <span class="mark">REACH</span></h1>
      ${phaseChip(a)}
      <span class="spacer"></span>
      ${a.sim.character.name ? `<button class="who" data-tab="warden" title="Your Warden">${portraitEl(a.sim.character.portrait, 26)}<span><b>${esc(a.sim.character.name)}</b> · ${artificerRank(a.sim)}</span></button>` : ''}
      <span class="counter ctl">RUN <b>${runNumberFor(history, a.sim.character.id) - (a.sim.outcome ? 1 : 0)}</b></span>
      <span class="counter ctl">DAY <b>${a.sim.day}</b></span>
      <span class="ctl"><button class="pill" data-cmd="help" aria-pressed="${showHelp}">?</button></span>
      <span class="ctl"><button class="pill" data-cmd="reset">↺ NEW SAVE</button></span>
    </header>
    ${fresh || showHelp ? `<p class="lede">You arrive alone with almost nothing, and <b>winter is coming</b>. Lay in a <b>larder</b>, build a
      <b>winter-proof shelter</b>, stock <b>fuel</b> and keep body &amp; mind sound. Plan each day as a <b>queue of actions</b>
      and run it. Each action costs <b>hours</b> and spends <b>Vigor</b> (body) / <b>Clarity</b> (mind).
      Each night you eat and drink: <b>water is critical</b> — a few dry nights wreck body and mind — while <b>food</b> can be skipped for a while at a slower cost. Every night in a row without either hurts more. Scout first, then push outward —
      working the land teaches you its detail. The snow comes on day ${a.sim.config.calendar.winterDay}, and there is no way out until spring: <b>live through the winter to the thaw</b>.
      Progress saves in this browser.</p>` : ''}
    ${statusBar(a, preview)}
    ${resolvePanel(a)}
    <nav class="tabbar" role="tablist">${TABS.map(t => `<button class="tabbtn ${tab === t.id ? 'on' : ''}" role="tab" aria-selected="${tab === t.id}" data-tab="${t.id}">${t.label}</button>`).join('')}</nav>
    ${tabBody(a, preview)}
    ${encounterModal(a.sim, encounterAfter, a.queue.length)}
    ${meetingModal(a.sim, a.meeting)}`;
}

/** The encounter just answered (#1347), shown in the modal until you carry on. */
let encounterAfter: EncounterAfter | null = null;

// ── The caravan road (#1252) ────────────────────────────────────────────────

type RoadTab = 'road' | 'quests' | 'warden' | 'journal';
const ROAD_TABS: { id: RoadTab; label: string }[] = [{ id: 'road', label: 'ROAD' }, { id: 'quests', label: 'QUESTS' }, { id: 'warden', label: 'WARDEN' }, { id: 'journal', label: 'JOURNAL' }];
let roadTab: RoadTab = 'road';
const roadUi: RoadUi = { person: null };

/**
 * The Warden on the road, in Region 1's shape — so the Warden tab shows what the road
 * changed (skills, techniques, recipes, the body) without a second copy of that tab.
 */
const wardenOnRoad = (a: AppState, r: RoadState): AppState => ({
  ...a, sim: { ...a.sim, vitals: r.vitals, stores: r.stores, tools: r.tools, concepts: r.concepts, character: r.character, skills: r.skills, techniques: r.techniques, manuals: r.manuals, known: r.known, focus: r.focus },
});

function roadJournal(r: RoadState, limit: number): string {
  return [...r.log].reverse().slice(0, limit).map(l => {
    const cls = l.kind === 'hardship' ? 'bad' : l.kind === 'milestone' || l.kind === 'outcome' ? 'good' : l.kind === 'skip' ? 'skip' : '';
    return `<li class="${cls}"><span class="d">R${l.day}</span>${esc(l.text)}</li>`;
  }).join('');
}

function renderRoad(a: AppState, r: RoadState): void {
  root.classList.remove('winter');
  root.style.setProperty('--snow', '0');
  const body = roadTab === 'quests' ? `<section class="box">${questLog(r)}</section>`
    : roadTab === 'warden' ? wardenTab(wardenOnRoad(a, r))
    : roadTab === 'journal' ? `<section class="box"><p class="eyebrow">JOURNAL — THE ROAD</p><div class="log" style="border:0;margin:0;padding:0"><ul style="max-height:none">${roadJournal(r, 200)}</ul></div></section>`
    : r.outcome ? `<section class="box"><p class="eyebrow">THE LAST OF THE ROAD</p><div class="log" style="border:0;margin:0;padding:0"><ul>${roadJournal(r, 12)}</ul></div></section>` : roadView(r, roadUi);
  const end = r.outcome ? `${roadEnd(r)}<div class="runbar" style="margin:12px 0">${canContinue(r)
    ? `<button class="btn go" data-cmd="carry">↻ CONTINUE AS ${esc((r.character.name || 'YOUR WARDEN').toUpperCase())} — KEEP WHAT YOU LEARNED</button>` : ''}<button class="btn ${canContinue(r) ? '' : 'go'}" data-cmd="reset">✦ ${canContinue(r) ? 'FRESH WARDEN' : 'NEW WARDEN'}</button></div>` : '';
  root.innerHTML = `
    <header>
      <h1>🛞 THE CARAVAN <span class="mark">ROAD</span></h1>
      <span class="spacer"></span>
      ${r.character.name ? `<button class="who" data-rtab="warden" title="Your Warden">${portraitEl(r.character.portrait, 26)}<span><b>${esc(r.character.name)}</b> · ${artificerRank(wardenOnRoad(a, r).sim)}</span></button>` : ''}
      <span class="counter ctl">MARKS <b>${r.marks}</b></span>
      <span class="counter ctl">ROAD DAY <b>${Math.min(r.day, ROAD_DAYS)}</b></span>
      <span class="ctl"><button class="pill" data-cmd="reset">↺ NEW SAVE</button></span>
    </header>
    ${routeStrip(r)}
    ${end}
    ${r.outcome ? '' : `${roadStatus(r)}${lastNews(r)}`}
    <nav class="tabbar" role="tablist">${ROAD_TABS.map(t => `<button class="tabbtn ${roadTab === t.id ? 'on' : ''}" role="tab" aria-selected="${roadTab === t.id}" data-rtab="${t.id}">${t.label}</button>`).join('')}</nav>
    ${body}
    ${encounterModal(r as unknown as AppState['sim'], encounterAfter, 0)}`;
}

// ── Save / load (browser storage can be missing or blocked — never fatal) ───

/** The saved game, or null when there is none (or it can't be read) — a first visit. */
function loadSaved(): AppState | null {
  try { return deserialize(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}

function save(a: AppState): void {
  try { localStorage.setItem(SAVE_KEY, serialize(a)); } catch { /* private mode etc. — play on unsaved */ }
}

// ── Wiring ──────────────────────────────────────────────────────────────────

/** Past runs live under their own key, so a new save never erases them. */
function loadHistory(): RunRecord[] {
  try { return deserializeHistory(localStorage.getItem(HISTORY_KEY)); } catch { return []; }
}

function saveHistory(h: readonly RunRecord[]): void {
  try { localStorage.setItem(HISTORY_KEY, serializeHistory(h)); } catch { /* history is a convenience; play on */ }
}

const root = document.getElementById('app') as HTMLElement;
const saved = loadSaved();
let state = saved ?? newGame();
let history = loadHistory();

// ── Arrival intro (#1228) ───────────────────────────────────────────────────
// A separate overlay element, so the game renders (and stays usable) underneath
// and render() — which rewrites #app wholesale — never wipes the intro.

let intro: { beats: Beat[]; i: number } | null = null;
const introEl = document.createElement('div');
introEl.className = 'intro';
introEl.setAttribute('role', 'dialog');
introEl.setAttribute('aria-label', 'Arrival');
introEl.hidden = true;
document.body.appendChild(introEl);

/** What the player is choosing on the creation screen (#1239). */
// The draft carries the new Warden's id from the start: the talents on offer are seeded by it (#1263).
let draft: { id: string; name: string; portrait: string; talents: TalentId[]; stats: Stats; age: number } = { id: newCharacterId(), name: '', portrait: PORTRAITS[0].id, talents: [], stats: { ...DEFAULT_STATS }, age: DEFAULT_AGE };
const draftValid = (): boolean => draft.name.trim().length > 0 && draft.talents.length === TALENT_PICKS;
/** What's in the pack on the packing screen (#1401): the leader's list for a new Warden, last time's for one carrying on. */
let draftPack: KitId[] = [...SUGGESTED_PACK];

function startIntro(kind: IntroKind): void {
  draft = { id: newCharacterId(), name: '', portrait: PORTRAITS[0].id, talents: [], stats: { ...DEFAULT_STATS }, age: DEFAULT_AGE };
  draftPack = kind === 'carry' && state.sim.kit ? [...state.sim.kit.items] : [...SUGGESTED_PACK];
  drawnBeat = -1;
  intro = { beats: introBeats(kind, state.sim, runNumberFor(history, state.sim.character.id)), i: 0 };
  renderIntro();
}

/** Leaving the creation screen: the Warden is made with the chosen name, portrait, talents and stats (a hidden talent is rolled from the id). */
function commitCharacter(): void {
  state = { sim: createRegion1({ planning: 'learned', world: GAME_WORLD }, undefined, { id: draft.id, name: draft.name.trim().slice(0, 24), portrait: draft.portrait, chosen: draft.talents, stats: validStats(draft.stats) ? draft.stats : { ...DEFAULT_STATS }, background: 'scout', age: draft.age, pack: [...SUGGESTED_PACK] }), queue: [] };
  render(state);
}

function endIntro(): void {
  intro = null;
  introEl.hidden = true;
  introEl.innerHTML = '';
  // Persist now, so a reload after the intro doesn't play it again.
  save(state);
}

function advanceIntro(): void {
  if (!intro) return;
  if (intro.beats[intro.i].kind === 'create') { if (!draftValid()) return; commitCharacter(); }
  // Off we go (#1401): the pack chosen is the one the run starts with. (Skipping keeps the pack you had.)
  if (intro.beats[intro.i].kind === 'pack') { state = { ...state, sim: repack(state.sim, draftPack) }; render(state); }
  if (intro.i >= intro.beats.length - 1) endIntro();
  else { intro.i += 1; renderIntro(); }
}

/** The beat last drawn: re-drawing the same beat (a creation pick) must not replay its fade-in. */
let drawnBeat = -1;

function renderIntro(): void {
  if (!intro) return;
  const b = intro.beats[intro.i];
  introEl.classList.toggle('settled', drawnBeat === intro.i);
  drawnBeat = intro.i;
  const last = intro.i === intro.beats.length - 1;
  // Each line fades in after the one before (--n drives the CSS animation delay).
  const lines = b.lines.map((l, n) => `<p style="--n:${n}">${esc(fillName(l, state.sim.character.name))}</p>`).join('')
    + (b.kind === 'create' ? createForm() : b.kind === 'pack' ? packForm() : '');
  const dots = intro.beats.map((_, n) => `<i class="${n === intro!.i ? 'on' : n < intro!.i ? 'past' : ''}"></i>`).join('');
  // A pick re-draws the beat; keep the form scrolled where it was (the stats sit below the fold on a phone).
  const scrolled = introEl.querySelector('.beat')?.scrollTop ?? 0;
  introEl.hidden = false;
  introEl.innerHTML = `
    <div class="portal ${b.portal ? 'open' : ''}" aria-hidden="true"></div>
    <div class="beat ${b.kind}" aria-live="polite">${lines}</div>
    <div class="introbar">
      <span class="dots" aria-hidden="true">${dots}</span>
      <span class="spacer"></span>
      ${last ? '' : '<button class="pill" data-intro="skip">SKIP ›</button>'}
      <button class="btn go" data-intro="next" ${b.kind === 'create' && !draftValid() ? 'disabled' : ''}>${last ? 'BEGIN ▸' : b.kind === 'pack' ? 'OFF WE GO ▸' : 'CONTINUE ▸'}</button>
    </div>`;
  const beatEl = introEl.querySelector('.beat');
  if (beatEl && drawnBeat === intro.i) beatEl.scrollTop = scrolled;
  // On the creation screen, start in the name field (unless a name is already typed).
  if (b.kind === 'create' && !draft.name) introEl.querySelector<HTMLInputElement>('#wname')?.focus();
  else introEl.querySelector<HTMLButtonElement>('[data-intro="next"]')?.focus();
}

/**
 * The packing screen (#1401): the whole list, by group — each item with its weight, what it does
 * out here, and a scout's note. Tap to pack, tap again to take it out; what won't fit is greyed.
 * The weight bar and the leader's list stay at the bottom.
 */
function packForm(): string {
  const kg = packWeight(draftPack);
  const groups = (Object.keys(KIT_GROUPS) as KitGroup[]).map(g => {
    const items = KIT.filter(k => k.group === g).map(k => {
      const on = draftPack.includes(k.id);
      const fits = on || packWeight([...draftPack, k.id]) <= PACK_CAPACITY;
      return `<button type="button" class="kchoice" data-kit="${k.id}" aria-pressed="${on}" ${fits ? '' : 'disabled'} title="${fits ? '' : "won't fit — take something out first"}">`
        + `<span class="khead"><b>${esc(k.name)}</b>${k.sv && k.sv.toLowerCase() !== k.name.toLowerCase() ? ` <i>${esc(k.sv)}</i>` : ''}<span class="kkg">${k.weight} kg</span></span>`
        + `<span class="keffect">${esc(k.effect)}</span><span class="knote">${esc(k.note)}</span></button>`;
    }).join('');
    return `<p class="clabel">${esc(KIT_GROUPS[g].toUpperCase())}</p><div class="kchoices">${items}</div>`;
  }).join('');
  const pct = Math.min(100, (kg / PACK_CAPACITY) * 100);
  return `<form class="create pack" onsubmit="return false">
    <p class="mood" style="margin:0">The backpack comes free, and the clothes you're wearing. Everything else has to fit in ${PACK_CAPACITY} kg.</p>
    ${groups}
    <div class="kfoot">
      <div class="kbar" role="meter" aria-label="Pack weight" aria-valuemin="0" aria-valuemax="${PACK_CAPACITY}" aria-valuenow="${kg}"><span style="width:${pct}%"></span></div>
      <span class="kweight"><b>${kg}</b> / ${PACK_CAPACITY} kg</span>
      <button type="button" class="pill" data-kitcmd="leader">THE LEADER'S LIST</button>
      <button type="button" class="pill" data-kitcmd="empty">EMPTY IT</button>
    </div>
  </form>`;
}

/** The creation form: name, portrait, two of four offered talents, stats. Choices live in `draft` until Continue. */
function createForm(): string {
  const portraits = PORTRAITS.map(p => `<button class="pchoice" data-portrait="${p.id}" aria-pressed="${draft.portrait === p.id}">${portraitEl(p.id, 64)}<span>${esc(p.label)}</span></button>`).join('');
  const offer = talentOffer(seedOf(draft.id));
  const talents = offer.map(t => `<button class="tchoice" data-talent="${t}" aria-pressed="${draft.talents.includes(t)}"><b>${esc(TALENTS[t].name)}</b><span class="up">+ ${esc(TALENTS[t].blurb)}</span></button>`).join('');
  return `<form class="create" onsubmit="return false">
    <label class="clabel" for="wname">NAME</label>
    <input id="wname" class="cname" maxlength="24" autocomplete="off" spellcheck="false" placeholder="What are you called?" value="${esc(draft.name)}">
    <p class="clabel">PORTRAIT</p><div class="pchoices">${portraits}</div>
    <p class="clabel">TALENTS — choose ${TALENT_PICKS} <span>(${draft.talents.length}/${TALENT_PICKS})</span></p><div class="tchoices">${talents}</div>
    <p class="mood" style="margin:0">…and something else in you, not yet known.</p>
    <p class="clabel">AGE — how old you are, the weekend it began</p>
    <div class="achoices">${START_AGES.map(a => `<button type="button" class="achoice" data-age="${a}" aria-pressed="${draft.age === a}">${a}</button>`).join('')}</div>
    <p class="mood" style="margin:0">You'll grow up over the runs, a year each; your stats grow with you.</p>
    ${statsForm()}
  </form>`;
}

/**
 * The stats step (#1258): point-buy over the six stats. Every stat starts at 10
 * with 6 points to spend; steps above 13 cost 2. All 10s is a valid Warden, so
 * this never blocks BEGIN — unspent points just get a nudge.
 */
function statsForm(): string {
  const left = pointsLeft(draft.stats);
  const rows = STAT_IDS.map(id => {
    const v = draft.stats[id];
    const dear = v >= 13 && v < 15 ? ' dear' : '';
    // Growing up (#1399): what you have now, at the age chosen; the score is who you'll be at 18.
    const now = grownStats(draft.stats, draft.age)[id];
    return `<div class="srow"><div class="sname"><b>${esc(STATS[id].name)}</b><span>${esc(STATS[id].blurb)}</span><span class="snote ${v > 10 ? 'up' : v < 10 ? 'cost' : ''}">${esc(statNote(id, v))}</span>${now !== v ? `<span class="snow">${now} now, at ${draft.age}</span>` : ''}</div>`
      + `<div class="sstep"><button type="button" class="pill" data-stat="${id}" data-delta="-1" aria-label="Lower ${esc(STATS[id].name)}" ${canLower(draft.stats, id) ? '' : 'disabled'}>−</button>`
      + `<span class="sval">${v}</span>`
      + `<button type="button" class="pill${dear}" data-stat="${id}" data-delta="1" aria-label="Raise ${esc(STATS[id].name)} (costs ${raiseCost(v)})" title="${v >= 13 ? 'costs 2 points' : 'costs 1 point'}" ${canRaise(draft.stats, id) ? '' : 'disabled'}>+</button></div></div>`;
  }).join('');
  return `<p class="clabel">STATS — who you'll grow up to be · spend ${POINT_BUDGET} points <span>(${left} left${left > 0 ? ' · unspent points are wasted' : ''}) · above 13 costs 2 · lower one to 7 to buy more</span></p>
    <div class="schoices">${rows}</div>`;
}

// Tap anywhere to advance (the tablet path); Skip ends it at once. On the creation
// screen only its own controls act, so a stray tap can't skip past your choices.
introEl.addEventListener('click', e => {
  const el = e.target as HTMLElement;
  const btn = el.closest<HTMLElement>('[data-intro], [data-portrait], [data-talent], [data-stat], [data-age], [data-kit], [data-kitcmd]');
  // On the creation and packing screens only their own controls act, so a stray tap can't skip past your choices.
  const creating = intro?.beats[intro.i].kind === 'create' || intro?.beats[intro.i].kind === 'pack';
  if (btn?.dataset.portrait) { draft.portrait = btn.dataset.portrait; renderIntro(); return; }
  if (btn?.dataset.age) { draft.age = Number(btn.dataset.age); renderIntro(); return; }
  // Packing (#1401): tap to pack or take out; only what fits goes in.
  if (btn?.dataset.kit) {
    const id = btn.dataset.kit as KitId;
    if (draftPack.includes(id)) draftPack = draftPack.filter(x => x !== id);
    else if (validPack([...draftPack, id])) draftPack = [...draftPack, id];
    renderIntro(); return;
  }
  if (btn?.dataset.kitcmd) { draftPack = btn.dataset.kitcmd === 'leader' ? [...SUGGESTED_PACK] : []; renderIntro(); return; }
  if (btn?.dataset.stat) {
    // A step up or down, only if point-buy allows it (the buttons are disabled otherwise, but check anyway).
    const id = btn.dataset.stat as StatId;
    const up = btn.dataset.delta === '1';
    if (up ? canRaise(draft.stats, id) : canLower(draft.stats, id)) draft.stats = { ...draft.stats, [id]: draft.stats[id] + (up ? 1 : -1) };
    renderIntro(); return;
  }
  if (btn?.dataset.talent) {
    const t = btn.dataset.talent as TalentId;
    // Toggle; picking a third replaces the earliest pick.
    draft.talents = draft.talents.includes(t) ? draft.talents.filter(x => x !== t) : [...draft.talents, t].slice(-TALENT_PICKS);
    renderIntro(); return;
  }
  if (btn?.dataset.intro === 'skip') endIntro();
  else if (btn?.dataset.intro === 'next' || !creating) { if (!el.closest('.create')) advanceIntro(); }
});
// Typing a name updates the draft without re-rendering (which would steal focus).
introEl.addEventListener('input', e => {
  const input = e.target as HTMLInputElement;
  if (input.id !== 'wname') return;
  draft.name = input.value;
  const next = introEl.querySelector<HTMLButtonElement>('[data-intro="next"]');
  if (next) next.disabled = !draftValid();
});
document.addEventListener('keydown', e => {
  if (!intro) return;
  const typing = (e.target as HTMLElement).tagName === 'INPUT';
  if (e.key === 'Escape') { e.preventDefault(); endIntro(); }
  else if (e.key === 'Enter') { e.preventDefault(); advanceIntro(); }
  else if (!typing && (e.key === ' ' || e.key === 'ArrowRight') && intro.beats[intro.i].kind !== 'create' && intro.beats[intro.i].kind !== 'pack') { e.preventDefault(); advanceIntro(); }
});

function update(next: AppState): void {
  // The moment a run resolves, it goes into the history (once).
  const h = recordRun(history, state, next);
  if (h.length !== history.length || h[0] !== history[0]) { history = h; saveHistory(history); }
  state = next;
  save(state);
  render(state);
}

root.addEventListener('click', e => {
  // closest() finds the button even when the click lands on a child span.
  const el = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const d = el.dataset;
  if (d.tab) { tab = d.tab as Tab; try { localStorage.setItem('artificer.tab', tab); } catch { /* per-browser convenience only */ } render(state); }
  else if (d.cmd === 'help') { showHelp = !showHelp; render(state); }
  else if (d.ring) { focusRing = Number(d.ring) as Ring; render(state); }
  // Pins (#1380): list a ring's places, let one go, or weigh it.
  else if (d.pinring) { const r = Number(d.pinring) as Ring; pinRing = pinRing === r ? null : r; render(state); }
  else if (d.forget) update(forget(state, d.forget));
  else if (d.interest) { const [id, n] = d.interest.split('|'); update(weighPin(state, id, Number(n) as 0 | 1 | 2 | 3)); }
  else if (d.focus) update(chooseFocus(state, parseFocus(d.focus)));
  else if (d.cmd === 'eat') { const plans = ['full', 'half', 'none'] as const; update(chooseEating(state, plans[(plans.indexOf(state.sim.eating ?? 'full') + 1) % plans.length])); }
  // Before planning is learned (#1350), a tap does the thing now.
  else if (d.q) update(state.sim.canPlan ? enqueue(state, d.q as QueueId) : act(state, d.q as QueueId));
  else if (d.cmd === 'endday') update(endTheDay(state));
  else if (d.toggle !== undefined) { const i = Number(d.toggle); if (expanded.has(i)) expanded.delete(i); else expanded.add(i); render(state); }
  // Keep the menu open while choosing (it may have opened only because a choice was missing).
  else if (d.opt) { const [i, key, value] = d.opt.split('|'); expanded.add(Number(i)); update(setOption(state, Number(i), key, value)); }
  else if (d.x !== undefined) { expanded.clear(); update(dequeueAt(state, Number(d.x))); }
  else if (d.site) update(settle(state, d.site as SiteId));
  else if (d.cmd === 'day') update(runQueuedDay(state));
  else if (d.cmd === 'all') update(runWholeQueue(state));
  else if (d.cmd === 'clear') update(clearQueue(state));
  else if (d.cmd === 'reset') { update(newGame()); startIntro('fresh'); }
  // Encounters (#1347): choose an option, then carry on with the day.
  // A road encounter (#1349): the same modal, answered on the road state.
  else if (d.choose && state.stage === 'road' && state.road?.pending) {
    const p = state.road.pending, t = encounterById(p.id);
    const opt = t ? stepOf(t, p.step).options.find(o => o.id === d.choose) : undefined;
    const next = roadChoose(state, d.choose);
    if (t && opt && next.road && !next.road.pending) {
      const fresh = next.road.log.slice(state.road.log.length).map(l => l.text);
      encounterAfter = { kind: t.kind, scene: t.text, choice: opt.label, text: fresh.map(l => l.startsWith(`${opt.label}: `) ? l.slice(opt.label.length + 2) : l), died: !!next.road.outcome };
    }
    update(next);
  }
  else if (d.choose) {
    const p = state.sim.pending, t = p && encounterById(p.id);
    const opt = t && p ? stepOf(t, p.step).options.find(o => o.id === d.choose) : undefined;
    const next = choose(state, d.choose);
    if (t && opt && !next.sim.pending) {
      const fresh = next.sim.log.slice(state.sim.log.length).map(l => l.text);
      encounterAfter = {
        kind: t.kind, scene: stepOf(t, p!.step).text, choice: opt.label, text: fresh.map(l => l.startsWith(`${opt.label}: `) ? l.slice(opt.label.length + 2) : l), died: !!next.sim.outcome,
        // When your read was badly wrong, the outcome shows the truth (#1364).
        truth: p ? truthLine(p.perceived ?? t.threat, t.threat, t.kind) : null,
      };
    }
    update(next);
  }
  else if (d.cmd === 'carryon') { encounterAfter = null; if (state.stage === 'road') render(state); else update(carryOn(state)); }
  // The caravan road (#1252): ride on, act, end the day, open a villager's sheet, switch tabs.
  // Meeting the caravan (#1356): open the dialogue, answer, then climb aboard or watch them go.
  else if (d.cmd === 'meet') update(meetCaravan(state));
  else if (d.meet) update(meetingChoose(state, d.meet));
  else if (d.cmd === 'stay') update(stayBehind(state));
  else if (d.cmd === 'board' || d.cmd === 'ride') { roadTab = 'road'; roadUi.person = null; update(rideCaravan(state)); }
  else if (d.road) update(roadAct(state, d.road as Parameters<typeof roadAct>[1]));
  else if (d.cmd === 'roadday') { roadUi.person = null; update(roadEndDay(state)); }
  else if (d.person) { roadUi.person = roadUi.person === d.person ? null : d.person; render(state); }
  else if (d.rtab) { roadTab = d.rtab as RoadTab; render(state); }
  else if (d.cmd === 'carry' && canContinue(currentRun(state))) { update(newRun(currentRun(state))); startIntro('carry'); }
});

render(state);
if (!saved) startIntro('fresh');
