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
import { visibilityOf, greyedTappable, shown } from '../artificer/action-visibility';
import { describeLand, drawnSight, mapMode, mapNeeds } from '../artificer/descriptive-map';
import { repack, visibilityOn, CRAFT_WORLD, FOCUS_OPEN, PLANNING_UNLOCKED, survivalLockOf, ACTIONS, SITES, BUILD_COST, FISH_CATCH, DAY_HOURS, REGION1_MILESTONES, warmth, winterReady, winterOutlook, tonightsFright, FIRE_WARMTH, coldPitHolds, coldCapacity, spoilage, type TripLoad, routeKnown, parseItem, HIDE_PARKA_RECIPE, DISCOVERIES, queueId, queueHours, type ActionId, type QueueId, type LogEntry, type SiteId } from '../artificer/region1';
import { RINGS, RING_NAME, TRAVEL_HOURS, RICHNESS, FINDS, LEVEL_NAME, domainsOf, level, reachable, scouted, tripYield, hasFind, supplyWord, type Domain, type Ring } from '../artificer/exploration';
import { modifiersFor } from '../artificer/crafting';
import { maxLoad, comfortableLoad, strainRecovery, GEAR_ITEMS, EXHAUSTED_DRAIN, type GearItem, type Haul } from '../artificer/load';
import { bestRun, heirloomsOf, runNumberFor, type RunRecord } from '../artificer/legacy';
import { seasonOf, MIDWINTER_AFTER, type Grade, type OutcomeKind } from '../artificer/winter';
import { daylightHours, DAY_START } from '../artificer/clock';
import { dayMean, nightTemp, coldNightNeeds, isBlizzard, weatherName, BLIZZARD_HOURS, type WeatherId } from '../artificer/weather';
import { BASELINE, CAP_CEIL, morale, type Pool } from '../artificer/vitality';
import { SKILLS, SKILL_IDS, LEVELS, MAX_LEVEL, perceivedProgress, isSupernatural, skillLevel } from '../artificer/skills';
import { TECHNIQUES, manualById, type Technique } from '../artificer/techniques';
import { introBeats, fillName, type Beat } from './intro';
import { portraitById, portraitStyle } from './portraits';
import { GOALS, GOAL_IDS, FOCUS_COST, CONCEPT_PER_HOUR, focusLabel, focusKey, parseFocus } from '../artificer/focus';
import { topicsOpen } from '../artificer/topics';
import { TALENTS, TALENT_PICKS, talentOffer, seedOf, type TalentId } from '../artificer/talents';
import { generateReach, mapRows, sightFor, describeCell, GLYPH, BIOME_NAME, type Biome, type Reach } from '../artificer/world/reach';
import { provincesOf, type Provinces } from '../artificer/world/provinces';
import { settlementOf, TIER_NAME, type Settlement } from '../artificer/world/settlements';
import { cultureName } from '../artificer/world/peoples';
import { keptHistory, type ReachHistory } from '../artificer/world/history-format';
import { painOf, PAIN_NAME, PAIN_DRAIN, PAIN_HOURS, PAIN_NIGHT } from '../artificer/pain';
import { HARM_NAME, HARM_WORDS, injuryView, injuryWords, KNOWS } from '../artificer/injuries';
import { hasKit, SUGGESTED_PACK, KIT, KIT_GROUPS, PACK_CAPACITY, packWeight, validPack, kitItem, kitSupplies, type KitId, type KitGroup } from '../artificer/kit';
import { grownStats, isYoung, DEFAULT_AGE, START_AGES } from '../artificer/growing';
import { isSelfKnowledge } from '../artificer/self-knowledge';
import { STATS, STAT_IDS, DEFAULT_STATS, POINT_BUDGET, canRaise, canLower, raiseCost, pointsLeft, statNote, statEffects, validStats, type Stats, type StatId } from '../artificer/stats';
import { artificerRank, conceptRanks } from '../artificer/rank';
import { roadView, routeStrip, roadStatus, lastNews, questLog, roadEnd, type RoadUi } from './road-view';
import { QUESTION_CHARS } from '../artificer/free-questions';
import { matchFreeQuestion } from '../artificer/knowledge-questions';
import { keepHistory, playFacts } from '../artificer/history-in-play';
import { cleanQuestion } from '../artificer-play/questions';
import { FEATURES, experimentalOn, featuresOf } from '../artificer/features';
import { weekOfId, shortWeek } from '../artificer-play/weekly';
import { newLog, recordMove, runOver, claimOf, WEB_LOG_VERSION, type Recorder, type WebMove, type WebStart } from '../artificer-play/web-log';
import { runOf } from '../artificer-play/record-of';
import { achievementsOf, type Achievement } from '../artificer-play/achievements';
import type { RunSummary } from '../artificer-play/records';
import type { Tool } from '../artificer/crafting';
import { devMode, devTruths, devPasswordMatches, loadChoices, saveChoices, setDevMode, tabIsDev, tabToOpen, visibleTabs, vitalCostLabel, type TabDef, type TabView } from './feature-choices';
import { hasCamp, withCampLine } from './camp-view';
import { personById, CONTACT_TRUST } from '../artificer/villages';
import { feltWord } from '../artificer/rapport';
import { ROAD_DAYS, roadLockOf, type RoadState } from '../artificer/road';
import { encounterModal, type EncounterAfter } from './encounter-view';
import { ringPinChip, ringPins, pinsList } from './pins-view';
import { tripPinNote } from '../artificer/pins';
import { meetingModal } from './caravan-view';
import { truthLine, THREAT_WORDS, DARK_FADES } from '../artificer/panic';
import { QUIRKS, quirkName, isFear, FEAR_OF, FEAR_FADES } from '../artificer/quirks';
import { encounterById, stepOf } from '../artificer/encounters';
import { respondedOn } from '../artificer/journal';
import { choose, carryOn, forget, weighPin, roadChoose, endTheDay, queueLocked, makeWarden, newGame, legacyFor, currentRun, rideCaravan, meetCaravan, meetingChoose, stayBehind, roadAct, roadEndDay, newCharacterId, chooseFocus, chooseEating, recordRun, serializeHistory, deserializeHistory, HISTORY_KEY, enqueue, dequeueAt, clearQueue, setOption, settle, previewQueue, todayHours, serialize, deserialize, SAVE_KEY, type AppState } from './controller';
import { playAct, playDay, playWholeQueue, momentAt, shownAt, linesAt, clockText, parseSpeed, worthPlaying, MS_PER_HOUR, SPEEDS, type DayPlay, type Moment, type Phase, type Speed } from './playback';
import { inject } from '@vercel/analytics';
import { LANGS, makeT, parseLang, type Key, type Lang, type T } from '../artificer/i18n';
import { pickerNeeded, storedLang, storeLang } from './lang';
import { itemIcon } from './item-icons';

// Vercel Web Analytics (#1565): page views, referrers and devices for artificer.corewarden.app.
// `inject()` adds Vercel's small script (served by Vercel at /_vercel/insights/script.js), which
// counts a visit without cookies or personal data. Only a production build on the real domain
// loads it: `npm run dev`, local previews and tests, *.vercel.app URLs and the copy of this page
// the main game's build carries all load nothing and send nothing, so they can't eat into the
// free plan's monthly events or blur the numbers. If the domain changes, change it here too.
// It sees page views only; what happens in a game belongs in the run records (#1558), not here.
const ANALYTICS_HOST = 'artificer.corewarden.app';
if (import.meta.env.PROD && location.hostname === ANALYTICS_HOST) inject();

// ── The viewer's language (#1704) ─────────────────────────────────────────────
// The app chrome (header, tabs, headings, buttons, help, the dev gate) is drawn through `t`, from
// the string catalog in src/artificer/i18n. Presentation only: the sim never sees the language, and
// it isn't saved with the game. The opening, camp, road and generated text are still English
// (later phases of #1685). `let`: choosing a language swaps `t` and redraws.
let lang: Lang = storedLang() ?? 'en';
let t: T = makeT(lang);
document.documentElement.lang = lang;

// ── Presentation-only data (wording lives here, rules live in the sim) ──────

// `key` names the group's heading in the catalog (`group.*`); the ids are the actions in it.
const GROUPS: { key: 'explore' | 'provision' | 'build' | 'craft' | 'carry' | 'think'; ids: ActionId[] }[] = [
  { key: 'explore', ids: ['explore', 'scout', 'survey', 'track', 'lookout'] },
  { key: 'provision', ids: ['gather', 'hunt', 'water', 'wood', 'quarry', 'fish', 'preserve'] },
  { key: 'build', ids: ['build', 'coldPit', 'coldGear'] },
  { key: 'craft', ids: ['knife', 'snare', 'waterskin', 'bedroll', 'shovel'] },
  { key: 'carry', ids: ['basket', 'backpack', 'harness', 'sled'] },
  { key: 'think', ids: ['study', 'experiment', 'tinker', 'rest', 'treat'] },
];

const ICON: Record<ActionId, string> = {
  scout: '🥾', survey: '📐', track: '🐾', gather: '🌿', hunt: '🏹', water: '💧',
  wood: '🪵', quarry: '⛰️', preserve: '🧂', build: '⛺', coldGear: '🧥', tinker: '🛠️', rest: '☕', treat: '🩹',
  lookout: '🔭', study: '📖', explore: '🧭', experiment: '🧪', knife: '🔪', snare: '🪤', waterskin: '🫗', bedroll: '🛏️', shovel: '⛏️', fish: '🎣', coldPit: '🧊', basket: '🧺', backpack: '🎒', harness: '🪢', sled: '🛷',
};

/** Extra yield your tools give an action (shown in the hint). */
const bonus = (s: AppState['sim'], id: ActionId): number => modifiersFor(s.tools, id).yieldAdd;

/** +2 if you've made the find in this ring × domain. */
const fb = (s: AppState['sim'], r: Ring, d: Domain): number => (hasFind(s.explore, r, d) ? 2 : 0);
/** Shorthand: this trip's yield from what you know of the ring (mirrors region1.ts). */
const ty = (s: AppState['sim'], r: Ring, d: Domain, base: number, per: number): number => tripYield(s.explore, r, d, base, per);

/** One-line "what you get" per action, in the chosen ring. Numbers mirror region1.ts yields. */
const YIELD: Record<ActionId, (s: AppState['sim'], r: Ring) => string> = {
  explore: () => 'look around: a new ring at least suspected, a known one a little clearer',
  experiment: () => 'try things with what you have → work out what you don\'t know yet',
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

// ── The map (#1539) ───────────────────────────────────────────────────────────
// The Reach as a generated grid, drawn as text. It's made from the run's seed, so it's the same
// land every time this run is drawn; the cache just saves regenerating it on every render.
let reachCache: Reach | null = null;
const reachFor = (characterId: string): Reach => {
  const seed = seedOf(characterId);
  if (reachCache?.seed !== seed) reachCache = generateReach(seed);
  return reachCache;
};
/** The square last tapped on the map, whose description shows under it. */
let mapCell: { x: number; y: number } | null = null;

// ── The Reach's history (#1540) ──────────────────────────────────────────────
// The provinces come straight from the map (quick), but their history takes the engine a second or
// more, so a worker tells it in the background as soon as the run's seed is known, and the page
// keeps the result: a reload reads it back instead of telling it again. Until it's ready, the MAP
// and HISTORY tabs say it's still being told.
let provincesCache: Provinces | null = null;
let provincesSeed: number | null = null;
const provincesFor = (characterId: string): Provinces => {
  const r = reachFor(characterId);
  if (provincesSeed !== r.seed || !provincesCache) { provincesCache = provincesOf(r); provincesSeed = r.seed; }
  return provincesCache;
};
const CHRONICLE_KEY = 'artificer.chronicle';
let chronicle: ReachHistory | null = null;
/** The seed whose history is told or being told. */
let chronicleSeed: number | null = null;

/** This run's history, or null while the worker is still telling it (asking starts it). */
function chronicleFor(characterId: string): ReachHistory | null {
  const seed = seedOf(characterId);
  if (chronicleSeed === seed) return chronicle;
  chronicleSeed = seed;
  chronicle = (() => { try { return keptHistory(localStorage.getItem(CHRONICLE_KEY), seed); } catch { return null; } })();
  // The road's people answer from it (#1656, history-in-play.ts), so the sim gets it as soon as the page has it.
  if (chronicle) keepHistory(chronicle);
  else tellHistory(seed);
  return chronicle;
}

function tellHistory(seed: number): void {
  const told = (h: ReachHistory) => {
    if (h.seed !== chronicleSeed) return; // a new run started meanwhile
    chronicle = h;
    keepHistory(h);
    try { localStorage.setItem(CHRONICLE_KEY, JSON.stringify(h)); } catch { /* kept for this visit only */ }
    if (tab === 'map' || tab === 'history') render(state);
  };
  // Without workers (or if one fails), tell it here after all: a pause beats no history. The
  // dynamic import keeps the engine out of the page's bundle either way.
  const here = () => { import('../artificer/world/history').then(m => told(m.runHistory(seed))).catch(e => console.error('The Reach\'s history could not be told', e)); };
  try {
    // `new URL(…, import.meta.url)` is how Vite finds a worker's file and bundles it separately.
    const worker = new Worker(new URL('./history.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ReachHistory>) => { worker.terminate(); told(e.data); };
    worker.onerror = () => { worker.terminate(); here(); };
    worker.postMessage({ seed });
  } catch {
    here();
  }
}

// ── Settlements (#1541) ──────────────────────────────────────────────────────
// One at each province's seat, drawn as '#' on the map where you can see it. Laying one out takes
// a few milliseconds, so each is built the first time it's opened and kept for the run.
const SEAT_GLYPH = '#';
let settlementCache = new Map<string, Settlement>();
let settlementSeed: number | null = null;
function settlementFor(characterId: string, provinceId: string): Settlement {
  const r = reachFor(characterId);
  if (settlementSeed !== r.seed) { settlementCache = new Map(); settlementSeed = r.seed; }
  let s = settlementCache.get(provinceId);
  if (!s) {
    s = settlementOf(r, provincesFor(characterId).list.find(p => p.id === provinceId)!);
    settlementCache.set(provinceId, s);
  }
  return s;
}
/** The settlement open in the MAP tab (its province id), and the building last tapped in it. */
let mapSettlement: string | null = null;
let settlementPick: string | null = null;

/** The settlement view: its layout as text, a letter per building, the key, and a tapped building's details. */
function settlementView(a: AppState, provinceId: string): string {
  const s = settlementFor(a.sim.character.id, provinceId);
  const h = chronicleFor(a.sim.character.id)?.provinces.find(q => q.id === provinceId);
  const grid = s.rows.map(row => [...row].map(ch => {
    if (ch === '.') return '<span class="s-ground">.</span>';
    if (ch === '=' || ch === '-') return `<span class="s-road">${ch}</span>`;
    return `<span class="s-bldg${settlementPick === ch ? ' sel' : ''}" data-bldg="${ch}">${esc(ch)}</span>`;
  }).join('')).join('\n');
  const key = s.buildings.map(b => `<button class="keyitem${settlementPick === b.letter ? ' on' : ''}" data-bldg="${b.letter}"><b>${esc(b.letter)}</b> ${esc(b.name)}${b.people.length ? ' ★' : ''}</button>`).join('');
  const pick = s.buildings.find(b => b.letter === settlementPick);
  const info = pick
    ? `<p class="mapinfo"><b>${esc(pick.name)}</b>: ${esc(pick.role)}.${pick.lore ? ` <span class="dim">${esc(pick.lore)}</span>` : ''}</p>${pick.people.length ? `<p class="mapinfo">Here: ${esc(pick.people.join(', '))}.</p>` : ''}`
    : '<p class="mapinfo">Tap a building, or its letter in the key.</p>';
  const lord = h ? `${esc(h.title)}${h.holder ? `, held by ${esc(h.holder)}` : ''}. ` : '';
  return `<section class="box"><p class="eyebrow">${esc(s.name.toUpperCase())} — a ${esc(s.purpose.replace('-', ' '))} ${TIER_NAME[s.tier]} of the ${esc(cultureName(s.culture))}</p>
    <p class="mood">${lord}${s.buildings.length} buildings. <span class="s-road">=</span> road, <span class="s-road">-</span> lane, a letter for each building${s.about.length ? `. About the place: ${esc(s.about.join(', '))}` : ''}.</p>
    <div class="mapwrap"><pre class="reachmap settlemap" aria-label="Layout of ${esc(s.name)}">${grid}</pre></div>
    ${info}<div class="settlekey">${key}</div>
    <p style="margin-top:12px"><button class="pill" data-settle="">${esc(t('btn.backToMap'))}</button></p></section>`;
}

/** Who holds a square's province, and what the province remembers (for the MAP tab's square info). */
function provinceInfo(a: AppState, x: number, y: number): string {
  const r = reachFor(a.sim.character.id);
  const provinces = provincesFor(a.sim.character.id);
  const p = provinces.list[provinces.at[y * r.w + x]];
  const h = chronicleFor(a.sim.character.id)?.provinces.find(q => q.id === p.id);
  if (!h) return `<p class="mapinfo provinfo"><b>${esc(p.name)}</b>, ${esc(cultureName(p.culture))} country. <span class="dim">Its story is still being told…</span></p>`;
  const lines = h.lines.map(l => `<li><b>Year ${l.year}</b> ${esc(l.text)}</li>`).join('');
  return `<p class="mapinfo provinfo"><b>${esc(h.title)}</b>, ${esc(h.culture)} country${h.holder ? `, held by ${esc(h.holder)}` : ', its seat empty'}.</p>${lines ? `<ul class="provlines">${lines}</ul>` : ''}`;
}

const MAP_LEGEND = `<div class="legend maplegend">${(['meadow', 'heath', 'birch', 'pine', 'marsh', 'river', 'lake', 'scree', 'fell', 'snow'] as Biome[])
  .map(b => `<span><b class="m-${b}">${GLYPH[b]}</b> ${BIOME_NAME[b].toLowerCase()}</span>`).join('')}<span><b class="m-camp">${GLYPH.camp}</b> camp</span><span><b class="m-seat">#</b> settlement</span><span><b class="m-fog">${GLYPH.unknown}</b> unknown</span></div>`;

/** The MAP tab: the Reach as one character per square, what you can see of it, and a tapped square's details. */
/** The world the MAP tab last drew: a new run is a new Reach, so its open settlement and tapped square go. */
let mapSeed: number | null = null;

/**
 * The MAP tab before you've drawn a map (#1686, `descriptive-map`): no grid, just what you know of
 * the land as a scout would tell it, from camp, and what it'd take to draw a map of your own.
 */
function describedMapTab(a: AppState): string {
  const compass = hasKit(a.sim, 'map-compass');
  const lines = describeLand(a.sim).map(l => `<li>${esc(l)}</li>`).join('');
  const needs = mapNeeds(a.sim);
  const intro = compass
    ? 'The map in your pack shows somewhere else entirely; this world isn\'t on it. But the compass still points north, so you know your bearings.'
    : 'There\'s no map of this world, and no compass to take a bearing by. You know the land the way you\'d tell it to a friend.';
  return `<section class="box"><p class="eyebrow">${esc(t('head.landDescribed'))}</p>
    <p class="mapinfo">${esc(intro)}</p>
    <ul class="landwords">${lines}</ul>
    <p class="mood">Explore to learn more of it: scouting adds places further out, and surveying makes the distances sure.${needs.length ? ` To draw a map of your own you need ${esc(needs.join(' and '))}.` : ''}</p></section>`;
}

function mapTab(a: AppState): string {
  const mode = mapMode(a.sim);
  if (mode === 'described') return describedMapTab(a);
  const r = reachFor(a.sim.character.id);
  if (mapSeed !== r.seed) { mapSeed = r.seed; mapSettlement = null; settlementPick = null; mapCell = null; }
  if (mapSettlement) return settlementView(a, mapSettlement);
  const provinces = provincesFor(a.sim.character.id);
  const seatAt = new Map(provinces.list.map(p => [p.seat.y * r.w + p.seat.x, p]));
  // Your own drawn map (#1686) shows only what you've seen; with the switch off, the Reach map as before.
  const sight = mode === 'drawn' ? drawnSight(a.sim) : sightFor(r, a.sim.explore);
  const rows = mapRows(r, sight);
  const grid = rows.map((row, y) => [...row].map((ch, x) => {
    // Glimpsed squares (only suspected so far) draw dimmer than ones you've surveyed or worked.
    const seen = sight(x, y);
    const seat = seen > 0 && seatAt.has(y * r.w + x) && !(x === r.camp.x && y === r.camp.y);
    const cls = x === r.camp.x && y === r.camp.y ? 'm-camp' : seat ? `m-seat${seen === 1 ? ' dim' : ''}` : seen > 0 ? `m-${r.cells[y * r.w + x].biome}${seen === 1 ? ' dim' : ''}` : 'm-fog';
    const sel = mapCell?.x === x && mapCell?.y === y ? ' sel' : '';
    return `<span class="${cls}${sel}" data-cell="${x},${y}">${esc(seat ? SEAT_GLYPH : ch)}</span>`;
  }).join('')).join('\n');
  const known = !!mapCell && sight(mapCell.x, mapCell.y) > 0;
  const info = !mapCell ? 'Tap a square to see what it is.'
    : known ? describeCell(r, mapCell.x, mapCell.y)
    : 'Unknown ground. Scout the rings further out to learn it.';
  const seatHere = known && mapCell ? seatAt.get(mapCell.y * r.w + mapCell.x) : undefined;
  const enter = seatHere ? `<p class="mapinfo"><b>${esc(seatHere.name)}</b> stands here. <button class="pill" data-settle="${seatHere.id}">${esc(t('btn.enter', { name: seatHere.name.toUpperCase() }))}</button></p>` : '';
  const drawn = mode === 'drawn';
  const words = drawn ? `<ul class="landwords">${describeLand(a.sim).map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
  return `<section class="box"><p class="eyebrow">${esc(t(drawn ? 'head.yourMap' : 'head.reachMap'))}</p>
    <div class="mapwrap"><pre class="reachmap" aria-label="${drawn ? 'Your map' : 'Map of the Reach'}: ${rows.length} rows of ${r.w} squares">${grid}</pre></div>
    <p class="mapinfo">${esc(info)}</p>${enter}${known && mapCell ? provinceInfo(a, mapCell.x, mapCell.y) : ''}${MAP_LEGEND}${words}
    <p class="mood">A square is about half an hour's walk on open ground: more in wood, bog and on the fells. ${drawn
      ? (hasKit(a.sim, 'map-compass') ? 'Drawn true to the compass: what\'s within two hours of camp, the rings you\'ve glimpsed (dim), and those you know (bright).' : 'Drawn without a compass: ground you\'ve only glimpsed from afar can\'t be placed yet, so it stays off until you know it.')
      : 'You see what\'s within two hours of camp; scout the rings to glimpse further out (dim), and survey or work them to know them (bright).'}</p></section>`;
}

/**
 * The HISTORY tab (#1540): who holds the Reach now, and the chronicle the engine wrote. The
 * chronicle is plain text (the engine's layered renderer: threads for the older years, then living
 * memory year by year); its section rules become headings and its dated lines get their year picked out.
 */
function historyTab(a: AppState): string {
  const h = chronicleFor(a.sim.character.id);
  if (!h) return `<section class="box"><p class="eyebrow">${esc(t('head.history'))}</p><p class="mood">The old ones are still telling it. It takes a few seconds, once per run.</p></section>`;
  const r = reachFor(a.sim.character.id);
  const provinces = provincesFor(a.sim.character.id);
  const campProvince = provinces.list[provinces.at[r.camp.y * r.w + r.camp.x]].id;
  const lordships = h.provinces.map(p => `<tr><td><b>${esc(p.title)}</b>${p.id === campProvince ? ' <span class="chip">your camp</span>' : ''}</td><td>${esc(p.culture)}</td><td>${p.holder ? esc(p.holder) : '<span class="faint">empty seat</span>'}</td></tr>`).join('');
  const body = h.chronicle.split('\n').map(line => {
    if (!line.trim() || /^[─═]+$/.test(line)) return '';
    if (/^(AGES OF LEGEND|THE CHRONICLE|LIVING MEMORY)/.test(line)) return `<p class="eyebrow chronhead">${esc(line)}</p>`;
    // A line marked ◇ is a big regional event (#1598): news from a region's countryside, not a court.
    const dated = line.match(/^\s*(\d+)\s{2}(.*)$/);
    const text = (dated ? dated[2] : line).trim();
    const regional = text.startsWith('◇ ');
    const body = esc(regional ? text.slice(2) : text);
    const mark = regional ? '<span class="regmark" title="news from the countryside">◇</span> ' : '';
    return `<p class="chron${regional ? ' regional' : ''}">${dated ? `<b>${dated[1]}</b> ` : ''}${mark}${body}</p>`;
  }).join('');
  return `<section class="box"><p class="eyebrow">${esc(t('head.history'))}</p>
    <p class="mood">Years are the Reach's own count, from when its oldest houses first held land. It is now year ${h.year}. ${h.told} of ${h.logged} remembered deeds are worth the telling. <span class="regmark">◇</span> marks news from a region's countryside: famine, plague, a house losing its last seat.</p>
    <p class="eyebrow" style="margin-top:12px">${esc(t('head.lordships'))}</p>
    <div class="tablewrap"><table class="lordships"><thead><tr><th>${esc(t('head.lordship'))}</th><th>${esc(t('head.people'))}</th><th>${esc(t('head.heldBy'))}</th></tr></thead><tbody>${lordships}</tbody></table></div>
    <div class="chronicle">${body}</div></section>`;
}

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

/**
 * A store chip: the good's 32 px icon (#1675), or its old emoji until it has one, the name as text
 * and the count. The name is printed, so the icon's alt is empty (see item-icons.ts).
 */
const storeChip = (id: keyof AppState['sim']['stores'], emoji: string, label: string, n: number, low = false): string =>
  `<span class="r ${low ? 'low' : ''}">${itemIcon(id, { fallback: emoji })} ${label} <b>${n}</b></span>`;

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
  const chips = gear.length ? gear.map(t => `<span class="r tool ${t.grade}">${itemIcon(t.item)}${esc(GEAR_NAME[t.item as GearItem])} <b>${t.grade.toUpperCase()}</b></span>`).join('')
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
  return `<div class="res">${storeChip('rawFood', '🍖', 'Food', st.rawFood, st.rawFood < 1).replace('</span>', `${streak(s.deprivation.hungry, 'HUNGRY')}</span>`)}${storeChip('water', '💧', 'Water', st.water, st.water < 1).replace('</span>', `${streak(s.deprivation.thirsty, 'THIRSTY')}</span>`)}${storeChip('firewood', '🪵', 'Fuel', st.firewood)}${storeChip('materials', '🪨', 'Mat', st.materials)}${storeChip('rations', '🧂', 'Rations', st.rations)}${storeChip('stone', '⛰️', 'Stone', st.stone)}${storeChip('hides', '🦌', 'Hides', st.hides)}</div>`;
}

/** A portrait frame (or a blank silhouette for an unnamed quick-start Warden). */
function portraitEl(id: string | null, size: number, cls = ''): string {
  const p = portraitById(id);
  return p ? `<span class="portrait ${cls}" role="img" aria-label="${esc(p.label)}" style="${portraitStyle(p, size)}"></span>` : `<span class="portrait blank ${cls}" style="width:${size}px;height:${size}px" aria-hidden="true">?</span>`;
}

/** Status-bar focus chip (#1238): the focus, or SURVIVAL in red with the reason when locked. Opens the Warden tab. */
function focusChip(s: AppState['sim']): string {
  const lock = survivalLockOf(s);
  if (lock) return `<button class="focuschip locked" data-tab="warden" title="${esc(t('status.survivalTip'))}">${esc(t('status.focus'))} <b>${esc(t('status.survival'))}</b> <span>${esc(lock)}</span></button>`;
  // Willpower moves the line where focus frays (#1256).
  const below = statEffects(s.character.stats).unreliableBelow;
  const frayed = s.focus && s.vitals.clarity.current < below;
  return `<button class="focuschip ${s.focus ? '' : 'none'}" data-tab="warden" title="${esc(frayed ? t('status.frayedTip', { n: below }) : t('status.focusTip'))}">${esc(t('status.focus'))} <b>${esc(focusLabel(s.focus))}</b>${frayed ? ` <span>${esc(t('status.frayed'))}</span>` : ''}</button>`;
}

/** The eating plan (#1305): tap to cycle full → half → none. */
function eatingChip(s: AppState['sim']): string {
  const plan = s.eating ?? 'full';
  const label = t(plan === 'full' ? 'status.full' : plan === 'half' ? 'status.half' : 'status.none');
  const tip = t(plan === 'full' ? 'status.fullTip' : plan === 'half' ? 'status.halfTip' : 'status.noneTip');
  return `<button class="focuschip ${plan === 'full' ? 'none' : ''}" data-cmd="eat" title="${esc(t('status.tapToChange', { tip }))}">${esc(t('status.rations'))} <b>${esc(label)}</b></button>`;
}

/** Topic kinds as the Warden tab groups them (#1495). */
const TOPIC_GROUPS: readonly (readonly [string, Key])[] = [['material', 'focus.material'], ['place', 'focus.place'], ['group', 'focus.group'], ['person', 'focus.person'], ['quest', 'focus.quest'], ['role', 'focus.job']];

/**
 * The focus picker (#1238): goals, skills, concepts; the lock banner when survival overrides. On
 * the road (#1479) the chips set the road's focus, and the note says what a focus does there.
 */
function focusBlock(s: AppState['sim'], road?: RoadState): string {
  const lock = road ? roadLockOf(road) : survivalLockOf(s);
  const cur = focusKey(s.focus);
  const chip = (key: string, label: string, note: string) =>
    `<button class="fchip" data-focus="${key}" aria-pressed="${cur === key}" title="${esc(note)}">${esc(label)}</button>`;
  // On the road (#1479) a goal has no work to help: the chip says so instead of its Reach effect. A
  // skill has no work either, but it's something to ask people about (#1495).
  const idle = 'nothing to work on from the wagon (still costs the Clarity)';
  const goals = GOAL_IDS.map(g => chip(`goal:${g}`, GOALS[g].name, road ? idle : `${GOALS[g].actions.join(', ')}: +1 yield, 10% lighter`)).join('');
  const skills = SKILL_IDS.map(k => chip(`skill:${k}`, SKILLS[k].name, road ? 'learns 3x as much from wagon crafts, which come out better; and something to ask people about' : 'learns 3x as much from practice; better work and better odds')).join('');
  // The concepts open to this Warden and not yet mastered (#1478): the six, and the web as it opens.
  const concepts = FOCUS_OPEN(s).map(c => chip(`concept:${c}`, focusLabel({ kind: 'concept', id: c }), `${CONCEPT_PER_HOUR} insight per hour you work${road ? ', and something to ask people about' : ''}`)).join('');
  // Topics (#1494, #1495): on the road, what you've come across — met, held, taken on, heard named —
  // grouped by kind. A topic is something to ask people about; it does no work.
  const open = road ? topicsOpen(road) : [];
  const topics = TOPIC_GROUPS.map(([kind, name]) => {
    const chips = open.filter(k => k.startsWith(`${kind}:`)).map(k => { const f = parseFocus(k); return f ? chip(k, focusLabel(f), 'something to ask people about') : ''; }).join('');
    return chips ? `<p class="fgroup">${esc(t(name))}</p><div class="fchips">${chips}</div>` : '';
  }).join('');
  const below = statEffects(s.character.stats).unreliableBelow;
  // On the road a focus still costs its Clarity each night (the road sleeps by Region 1's rules), but
  // only a concept gets anything for it: no goal work from the wagon, and wagon crafts practise at
  // their own pace.
  const note = road
    ? `On the road, a focus costs ${FOCUS_COST} Clarity a night. A concept is turned over each night (halved below ${below} Clarity). A skill learns 3x as much from wagon crafts, and they come out better. Any focus but a goal gives you something to ask people about. Goals have no work from the wagon. No focus makes work faster.`
    : `One thing at a time. Costs ${FOCUS_COST} Clarity a night; below ${below} Clarity it's halved.`;
  const helps = road ? '' : 'Water, food, wood and shelter work goes better; ';
  return `${lock ? `<p class="lockbanner">⚠ SURVIVAL HAS TAKEN OVER — ${esc(lock)}. ${helps}learning waits until it passes.</p>` : ''}
    <p class="mood" style="margin-top:0">${note}</p>
    <p class="fgroup">${esc(t('focus.goal'))}</p><div class="fchips">${goals}</div>
    <p class="fgroup">${esc(t('focus.skill'))}</p><div class="fchips">${skills}</div>
    <p class="fgroup">${esc(t('focus.concept'))}</p><div class="fchips">${concepts}</div>${topics}
    <div class="fchips" style="margin-top:6px">${chip('none', t('focus.none'), 'free your mind (saves the Clarity)')}</div>`;
}

/** The Warden tab (#1239): who you are — portrait, name, rank, focus, stats, talents, skills, concepts. */
function wardenTab(a: AppState): string {
  const c = a.sim.character;
  // Talents (#1263): the known ones by name; a hidden one only as a hint that it exists. Tiers are never shown.
  const hidden = c.talents.filter(t => !t.known).length;
  const talents = c.talents.length
    ? c.talents.filter(t => t.known).map(t => `<div class="trait"><b>${esc(TALENTS[t.id].name)}</b><span class="up">+ ${esc(TALENTS[t.id].blurb)}</span>${t.signs !== undefined ? '<span class="found">discovered</span>' : ''}${t.id === 'tough' && c.lastStandUsed ? '<span class="note">last stand used this run</span>' : ''}</div>`).join('')
      + (hidden ? '<div class="trait hidden"><b>A hidden gift</b><span class="note">Something in you not yet known. Watch for signs in the journal.</span></div>' : '')
    : '<p class="mood">No talents — a quick-start Warden. Start a fresh Warden to choose two.</p>';
  const concepts = Object.entries(a.sim.concepts).filter(([, p]) => p.rank > 0 || p.insight > 0);
  return `<div class="cols">
    <section class="box"><div class="idcard">${portraitEl(c.portrait, 120)}<div><p class="eyebrow">${esc(t('head.artificer'))}</p><h2 class="wname">${esc(c.name || 'Unnamed Warden')}</h2>
      <p class="wrank">${esc(t('head.rank'))}: ${artificerRank(a.sim, CRAFT_WORLD.concepts).toUpperCase()} <span>· ${conceptRanks(a.sim)} concept rank${conceptRanks(a.sim) === 1 ? '' : 's'}</span></p></div></div>
      <p class="eyebrow" style="margin-top:16px">${esc(t('head.focus'))}</p>${focusBlock(a.sim, a.stage === 'road' ? a.road : undefined)}
      <p class="eyebrow" style="margin-top:16px">${esc(c.age !== undefined ? t(isYoung(c.age) ? 'head.statsAge' : 'head.statsGrown', { age: c.age }) : t('head.stats'))}</p>${statsBlock(c.stats, c.adult)}
      <p class="eyebrow" style="margin-top:16px">${esc(t('head.carrying'))}</p>${carryingBlock(a.sim)}
      ${packBlock(a.sim)}
      ${harmsBlock(a.sim)}
      <p class="eyebrow" style="margin-top:16px">${esc(t('head.talents'))}</p><div class="traits">${talents}</div>
      <p class="eyebrow" style="margin-top:16px">${esc(t('head.quirks'))}</p><div class="traits">${quirksBlock(c)}</div>${roadKeepsBlock(a)}</section>
    <section class="box"><p class="eyebrow">${esc(t('head.skills'))}</p>${skillsBlock(a.sim)}
      <p class="eyebrow" style="margin-top:16px">${esc(t('head.concepts'))}</p>
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
  return `<p class="eyebrow" style="margin-top:16px">${esc(t('head.roadKeeps'))}</p>
    <div class="res"><span class="chip">🪙&nbsp;<b>${marks}</b>&nbsp;marks</span></div>
    ${contacts.length ? `<ul class="contacts">${contacts.map(id => { const p = personById(id); return `<li><b>${esc(p?.name ?? id)}</b> <span>${esc(p?.role ?? '')}${a.road && a.road.trust[id] !== undefined ? ` · ${feltWord(a.road, id)}` : ''}</span></li>`; }).join('')}</ul>` : '<p class="mood">No contacts yet — anyone who comes to trust you on the road will remember you.</p>'}`;
}

/**
 * A packed item's hover text: what it's for and the scout's note (#1684), never its rule, unless
 * the hidden truths are on (`?dev=truths`). Plain dev mode is on for everyone, so it can't be that.
 */
function packTitle(id: KitId): string {
  const k = kitItem(id);
  return `${k.does} ${k.note}${truths ? ` [rule: ${k.effect}]` : ''}`;
}

/** The hike pack (#1400): what you brought, each with what it's for, and what's left of what runs out. */
function packBlock(s: AppState['sim']): string {
  if (!s.kit) return '';
  const left = kitSupplies(s.kit, s.dressings ?? 0);
  return `<p class="eyebrow" style="margin-top:16px">${esc(t('head.pack'))}</p>
    <div class="packlist">${s.kit.items.map(id => `<span class="packitem" title="${esc(packTitle(id))}">${itemIcon(id)}${esc(kitItem(id).name)}</span>`).join('')}</div>
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
    // Dev mode (#1579) shows the true level the game hides.
    const truth = truths ? ` <span class="devtruth" title="Dev mode (?dev=truths): the true level">true: ${esc(LEVELS[skillLevel(s.skills, id)])}</span>` : '';
    return `<div class="skill" title="${esc(SKILLS[id].blurb)} — self-assessed"><span class="sn">${esc(SKILLS[id].name)}</span>`
      + `<span class="sl ${isSupernatural(lvl) ? 'super' : ''}">${isSupernatural(lvl) ? '✦ ' : ''}${name}${truth}</span><div class="track"><div class="fill" style="width:${pct(lvl >= MAX_LEVEL ? 1 : seems - lvl)}%"></div></div>`
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
  const tools = s.tools.map(t => `<span class="r tool ${t.grade}">${itemIcon(t.item)}${esc(toolName(t.item))} <b>${t.grade.toUpperCase()}</b></span>`).join('');
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

/** A journal line's colour: hardship, a win, a skip — and, softly, what you learn about yourself (#1266). */
const logClass = (l: Pick<LogEntry, 'kind' | 'text'>): string =>
  isSelfKnowledge(l.text) ? 'hint' : l.kind === 'hardship' ? 'bad' : l.kind === 'milestone' || l.kind === 'outcome' ? 'good' : l.kind === 'skip' ? 'skip' : '';

function journal(a: AppState, limit: number): string {
  // The camp's line (#1691) is added as the journal is drawn, not by the sim: see camp-view.ts.
  return [...withCampLine(a.sim.log)].reverse().slice(0, limit).map((l: LogEntry) => {
    return `<li class="${logClass(l)}"><span class="d">D${l.day}</span>${esc(l.text)}</li>`;
  }).join('') || `<li style="color:var(--faint);font-style:italic">Day 1 in the Reach. ${visibilityOn(a.sim) ? 'Explore' : 'Scout'} before anything else — you don't yet know where food, water or wood are.</li>`;
}

type Preview = ReturnType<typeof previewQueue>;

/**
 * A craft's ingredients (#1675) as icon chips under its card: "[icon] 2 mat". The recipe is the one
 * the action would use with its default options (cold gear: woven fiber; a build: the plan as it
 * stands), so a chosen option can change it; the queue row's options say what the choice costs.
 */
function ingredients(def: (typeof ACTIONS)[ActionId], s: AppState['sim']): string {
  const recipe = def.recipeFor?.(s, {}) ?? def.recipe;
  if (!recipe?.inputs.length) return '';
  return `<div class="ingr">${recipe.inputs.map(i => `<span>${itemIcon(i.item)}<b>${i.qty}</b> ${esc(HAUL_NAME[i.item as keyof Haul] ?? i.item)}</span>`).join('')}</div>`;
}

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
  // A group with nothing the Warden knows how to do yet (#1690) isn't shown at all.
  const known = GROUPS.map(g => ({ ...g, ids: g.ids.filter(id => shown(preview.projected, id)) })).filter(g => g.ids.length);
  return tabs + known.map(g => `<div class="group"><h4>${esc(t(`group.${g.key}`))}${g.key === 'explore' || g.key === 'provision' ? ` <span class="ringnote">${esc(t('group.ringNote', { ring: RING_NAME[focusRing].toLowerCase() }))}</span>` : ''}</h4><div class="acts">${g.ids.map(id => {
    const def = ACTIONS[id];
    const r: Ring = def.ringed ? focusRing : 1;
    const q = queueId(id, r);
    // What the Warden knows how to do (#1690): hidden if not, greyed out (with why) if not right now.
    // With the switch off a blocked action stays tappable, as before: it would just be skipped.
    const vis = visibilityOf(preview.projected, id, r);
    if (vis.status === 'hidden') return '';
    const why = vis.reason;
    const greyed = !!why && !greyedTappable(preview.projected);
    // Which vitals it spends: a dev-mode view (#1688); players plan by hours and read the bars.
    const spends = vitalCostLabel(def, dev);
    return `<button class="act ${why ? 'soft' : ''} ${greyed ? 'greyed' : ''}" data-q="${q}" ${resolved || greyed ? 'disabled' : ''} title="${why ? esc(greyed ? why : `Would be skipped: ${why}`) : ''}">`
      + `<div class="t">${ICON[id]} ${def.name.toUpperCase()}<span class="h">${hrs(queueHours(q, preview.projected))}H</span></div>`
      + `<div class="y">${why ? `<span class="gate">${esc(why)}</span>` : `<span class="yield">${YIELD[id](preview.projected, r)}</span>${spends ? ` · <span class="vc">${spends}</span>` : ''}`}</div>${ingredients(def, preview.projected)}</button>`;
  }).join('')}</div></div>`).join('');
}

/**
 * Before planning is learned (#1350): no queue — each tap does the thing now, and you end
 * the day yourself. The latest journal line shows what just happened.
 */
function oneAtATime(a: AppState): string {
  const s = a.sim;
  const last = s.log.at(-1);
  const spent = s.hoursToday >= DAY_HOURS;
  return `<div class="queue onestep">
      <p class="eyebrow" style="color:var(--gold);margin-bottom:8px">${esc(t('head.oneThing'))}</p>
      <p class="mood" style="margin:0 0 8px">${esc(queueLocked(a) ?? '')} ${esc(t('queue.tapNow'))}</p>
      ${last ? `<p class="news ${last.kind}">${esc(last.text)}</p>` : ''}
      <div class="qtot"><span>${esc(t('queue.todayHours'))} <b>${hrs(s.hoursToday)} / ${DAY_HOURS}h</b></span>${spent ? `<span>${esc(t('queue.spent'))}</span>` : ''}</div>
      <div class="runbar"><button class="btn go" data-cmd="endday" ${s.outcome ? 'disabled' : ''}>${esc(t('btn.endDay'))}</button></div>
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
    const groups = ACTIONS[id].options?.(preview.before[i], opts, ring) ?? [];
    const needsChoice = groups.some(g => g.value === null);
    const open = groups.length > 0 && (expanded.has(i) || needsChoice);
    // A length left at its usual (#1668) isn't worth a label on the row.
    const chosen = groups.map(g => g.choices.find(c => c.value === g.value && c.value !== 'usual' && c.value !== 'none')?.label).filter(Boolean).join(' · ');
    const toggle = groups.length ? `<button class="tog" data-toggle="${i}" aria-expanded="${open}" aria-label="${esc(t('queue.options'))}">${open ? '▾' : '▸'}</button>` : '';
    const menu = open ? `<div class="opts">${groups.map(g => `<div class="optgroup"><span class="optlabel">${esc(g.label.toUpperCase())}</span><div class="optchoices">${g.choices.map(c =>
      `<button class="opt ${g.value === c.value ? 'on' : ''}" data-opt="${i}|${g.key}|${c.value}" ${c.blocked ? 'disabled' : ''} title="${esc(c.blocked ?? c.note)}">`
      + `<b>${esc(c.label)}</b><span>${esc(c.blocked ?? c.note)}</span></button>`).join('')}</div></div>`).join('')}</div>` : '';
    return `<li class="${why ? 'skip' : ''} ${open ? 'expanded' : ''}"><div class="row">${toggle}<span class="dayn">${esc(d === 0 ? t('queue.today') : t('queue.day', { n: s.day + d }))}</span>`
      + `<span class="n">${ICON[id]} ${ACTIONS[id].name.toUpperCase()}${ring > 1 ? ` <span class="ringtag">${RING_NAME[ring].toUpperCase()}</span>` : ''}</span>`
      + (chosen && !open ? `<span class="chosen">${esc(chosen)}</span>` : '')
      + (why ? `<span class="why">skips: ${esc(why)}</span>` : '')
      // What a remembered place does for this trip (#1380).
      + (!why && ACTIONS[id].ringed && tripPinNote(preview.before[i].pins, id, ring) ? `<span class="why pinnote">${esc(tripPinNote(preview.before[i].pins, id, ring)!)}</span>` : '')
      // A session of chosen length (#1668): its plan — trips, the haul, what's thinning.
      + (preview.plans[i] ? `<span class="why plan">${esc(preview.plans[i]!)}</span>` : '')
      + (preview.dangers[i] ? `<span class="why danger">⚠ ${esc(preview.dangers[i]!)}</span>` : '')
      // Work that could make an injury worse (#1395).
      + (preview.strains[i] ? `<span class="why strain" title="A serious, untreated injury: heavy work (or crafting, for a hand) has a 15% chance to make it grave. Treat it first.">${esc(preview.strains[i]!)}</span>` : '')
      // How it will feel out there (#1364): the dark, the weather, the distance — and what that does to you.
      + (preview.unease[i] ? `<span class="why unease u-${preview.unease[i]!.state}" title="The work wears the mind harder${preview.unease[i]!.state === 'panicked' ? ', and something out there could send you running' : ''}">🌑 ${esc(preview.unease[i]!.reasons.filter(r => r !== 'ground you know').join(' · '))} — ${preview.unease[i]!.state === 'shaken' ? "you'll be uneasy" : 'you may panic'}</span>` : '')
      + `<span class="meta">${hrs(queueHours(item, preview.before[i]))}h</span><button class="x" data-x="${i}" aria-label="${esc(t('queue.remove'))}">×</button></div>${preview.loads[i] ? loadBar(preview.loads[i]!) : ''}${menu}</li>`;
  }).join('');
  const days = a.queue.length ? (preview.dayOffset.at(-1) ?? 0) + 1 : 0;
  return `<div class="queue ${fresh ? 'fresh' : ''}">
      <p class="eyebrow" style="color:var(--gold);margin-bottom:8px">${esc(t(fresh ? 'head.queueNew' : 'head.queue'))}</p>
      <ol>${items || `<li class="empty">${esc(t('queue.empty', { hours: DAY_HOURS }))}</li>`}</ol>
      <div class="qtot"><span>${esc(t('queue.todayHours'))} <b>${hrs(todayHours(a, preview))} / ${DAY_HOURS}h</b></span><span>${t(days === 1 ? 'queue.spans.one' : 'queue.spans.other', { n: days })}</span></div>
      <div class="runbar">
        <button class="btn go" data-cmd="day" ${resolved ? 'disabled' : ''}>${esc(t(a.queue.length ? 'btn.runDay' : 'btn.passDay'))}</button>
        <button class="btn" data-cmd="all" ${resolved || !a.queue.length ? 'disabled' : ''}>${esc(t('btn.runAll'))}</button>
        <button class="btn" data-cmd="clear" ${a.queue.length ? '' : 'disabled'}>${esc(t('btn.clear'))}</button>
      </div>
    </div>`;
}

/** Where we are in the season, in a few words (for the header chip). */
function phaseChip(a: AppState): string {
  const cal = a.sim.config.calendar;
  const d = a.sim.day;
  if (seasonOf(d, cal) === 'autumn') { const n = cal.winterDay - d; return `<span class="phase">${esc(t(n === 1 ? 'top.autumn.one' : 'top.autumn.other', { n }))}</span>`; }
  if (seasonOf(d, cal) === 'thaw') return `<span class="phase gold">${esc(t('top.thaw'))}</span>`;
  const n = cal.thawDay - d;
  return `<span class="phase ice">${esc(t(n === 1 ? 'top.winter.one' : 'top.winter.other', { n }))}</span>`;
}

/** Always-visible summary: body, key stores, today's hours, readiness. */
function statusBar(a: AppState, preview: Preview): string {
  const s = a.sim;
  const mini = (label: string, cur: number, cap: number, max: number): string => {
    const b = band(cap > 0 ? cur / cap : 0);
    return `<span class="mini"><span class="ml">${label}</span><span class="mt"><span class="mf ${b}" style="width:${pct(cur / max)}%"></span></span><span class="mv ${b}">${Math.round(cur)}</span></span>`;
  };
  const st = s.stores;
  // The compact stores (#1675): icon and count, no name beside it, so the icon carries the name as
  // its alt (and title, for a hover); the old emoji stays as the fallback.
  const sIcon = (id: keyof typeof st, emoji: string, name: string): string => {
    const img = itemIcon(id, { alt: name });
    return img ? img.replace('<img ', `<img title="${name}" `) : emoji;
  };
  const ready = winterReady(s);
  return `<div class="statusbar">
    <div class="minis">${mini(t('status.vig'), s.vitals.vigor.current, s.vitals.vigor.cap, CAP_CEIL)}${mini(t('status.cla'), s.vitals.clarity.current, s.vitals.clarity.cap, CAP_CEIL)}${mini(t('status.res'), s.vitals.condition, 100, 100)}</div>
    <div class="sstores"><span class="${st.rawFood < 1 ? 'low' : ''}">${sIcon('rawFood', '🍖', 'Food')}${st.rawFood}${a.sim.deprivation.hungry ? ` <i class="streak" title="${esc(t('status.hungryTip'))}">${esc(t('status.hungry'))} ×${a.sim.deprivation.hungry}</i>` : ''}</span><span class="${st.water < 1 ? 'low' : ''}">${sIcon('water', '💧', 'Water')}${st.water}${a.sim.deprivation.thirsty ? ` <i class="streak" title="${esc(t('status.thirstyTip'))}">${esc(t('status.thirsty'))} ×${a.sim.deprivation.thirsty}</i>` : ''}</span><span>${sIcon('firewood', '🪵', 'Fuel')}${st.firewood}</span><span>${sIcon('materials', '🪨', 'Mat')}${st.materials}</span><span>${sIcon('rations', '🧂', 'Rations')}${st.rations}</span></div>
    ${focusChip(s)}${eatingChip(s)}${nightChip(s)}${painChip(s)}${injuryChips(s)}
    <span class="shours">${esc(t('status.today'))} <b>${hrs(todayHours(a, preview))}/${DAY_HOURS}H</b></span>
    ${outlookTag(s, ready)}
  </div>`;
}

/** Pain (#1409): what you feel, always — sharper when you've worked through an injury. */
function painChip(s: AppState['sim']): string {
  const p = painOf(s);
  if (!p) return '';
  const tip = p >= 2 ? `Work drains your mind ${PAIN_DRAIN[p]}x${PAIN_HOURS[p] > 1 ? ` and takes ${PAIN_HOURS[p]}x as long` : ''}; tonight costs ${PAIN_NIGHT[p]} Clarity. Working through a bad injury makes it sharper.` : 'An ache. Working through a bad injury would make it sharper.';
  return `<span class="tag pain p-${p}" title="${esc(tip)}">PAIN · ${PAIN_NAME[p].toUpperCase()}</span>`;
}

/** Each open injury (#1395): kind, severity and healing left — in the warning colour when it could get worse. */
function injuryChips(s: AppState['sim']): string {
  // Only what your First aid lets you understand (#1410): pain (its own chip) you always feel.
  const fa = skillLevel(s.skills, 'firstaid');
  return (s.injuries ?? []).map(i => {
    const v = injuryView(i, fa);
    const tip = `${injuryWords(i, fa)}.${fa < KNOWS.severity ? ' You can\'t tell how bad it is — the pain is your guide.' : ''}`;
    const parts = [v.name.toUpperCase(), v.severity?.toUpperCase() ?? v.badness?.toUpperCase(), v.nights !== undefined ? `~${v.nights} NIGHT${v.nights === 1 ? '' : 'S'}` : null].filter(Boolean);
    return `<span class="tag inj${v.severity ? ` sev-${v.severity}` : ''}${v.risk || v.festers ? ' risk' : ''}" title="${esc(tip)}">🩹 ${esc(parts.join(' · '))}</span>`;
  }).join('');
}

/** Old wounds (#1395): what grave injuries left behind, and what each does — for good. */
function harmsBlock(s: AppState['sim']): string {
  const harms = s.character.harms ?? [];
  if (!harms.length) return '';
  return `<p class="eyebrow" style="margin-top:16px">${esc(t('head.wounds'))}</p>
    <ul class="harms">${harms.map(h => `<li><b>${esc(HARM_NAME[h][0].toUpperCase() + HARM_NAME[h].slice(1))}</b> <span>${esc(HARM_WORDS[h])}</span></li>`).join('')}</ul>`;
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
  if (season === 'autumn') return `<span class="tag ${ready ? 'yes' : 'no'}">${esc(t(ready ? 'status.ready' : 'status.notReady'))}</span>`;
  const short = outlookWarnings(s).length;
  return `<button class="tag ${short ? 'no' : 'yes'}" data-tab="progress" title="${esc(t('status.outlookTip'))}">${esc(t(short ? 'status.short' : 'status.holding'))}</button>`;
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

type Tab = 'plan' | 'camp' | 'land' | 'map' | 'history' | 'warden' | 'progress';
// `label` is the English name; the page draws each tab's label from the catalog (`tab.<id>`, #1704).
const TABS: TabDef<Tab>[] = [
  { id: 'plan', label: 'PLAN' }, { id: 'camp', label: 'CAMP', needsCamp: true }, { id: 'land', label: 'LAND' }, { id: 'map', label: 'MAP' }, { id: 'history', label: 'HISTORY', dev: true }, { id: 'warden', label: 'WARDEN' }, { id: 'progress', label: 'PROGRESS' },
];
/**
 * Dev mode (#1688): off for players; the password in the help panel's faint ⚙ opens it (remembered in
 * this browser), "Leave dev mode" shuts it. It only shows views: the features panel, the HISTORY tab,
 * the CAMP tab before camp is made, actions' vital costs, and the `?dev=truths` extras. `let`: it flips.
 */
let dev = devMode();
/** The hidden truths (true trust, true skill levels): `?dev=truths`, and only while dev mode is on (#1578). */
let truths = dev && devTruths();
/** The open tab — a per-browser convenience, so storage failures just mean "Plan". */
// Which tabs show depends on the run too (no CAMP tab before camp, #1691), so drawPage settles the
// open tab against what shows each time it draws (`tabToOpen`).
let tab: Tab = (() => { try { const t = localStorage.getItem('artificer.tab'); return (TABS.some(x => x.id === t) ? t : 'plan') as Tab; } catch { return 'plan'; } })();
let showHelp = false;

/**
 * Before camp is made (#1691) there's no CAMP tab, but choosing a site is how camp is made, so the
 * site picker sits on the Plan tab until then (with the tools you've made so far, which the Camp tab
 * shows later). Vitals and stores are always in the status bar.
 */
function beforeCamp(a: AppState): string {
  return `<div class="camp-scene" style="margin-top:16px"><p class="eyebrow">${esc(t('head.makeCamp'))}</p>${sitesBlock(a)}
    <p class="eyebrow" style="margin-top:14px">${esc(t('head.tools'))}</p>${toolsBlock(a)}</div>`;
}

function tabBody(a: AppState, preview: Preview): string {
  switch (tab) {
    case 'plan':
      return `<section class="box seasonbox">${seasonStrip(a)}</section><div class="plan">
        <section class="box"><p class="eyebrow">${esc(t(a.sim.canPlan ? 'head.actionsQueue' : 'head.actionsNow'))}</p>${paletteBlock(a, preview)}</section>
        <section class="box planside">${queueBlock(a, preview)}
          <div class="log"><p class="eyebrow" style="color:var(--faint);margin-bottom:7px">${esc(t('head.latest'))}</p><ul>${journal(a, 6)}</ul></div>${hasCamp(a.sim) ? '' : beforeCamp(a)}</section>
      </div>`;
    case 'camp':
      return `<div class="cols">
        <section class="box"><p class="eyebrow">${esc(t('head.warden'))}</p>${vitalsBlock(a)}
          <p class="eyebrow" style="margin-top:14px">${esc(t('head.stores'))}</p>${storesRow(a.sim)}${coldBlock(a.sim)}
          <p class="eyebrow" style="margin-top:14px">${esc(t('head.tools'))}</p>${toolsBlock(a)}</section>
        <section class="box camp-scene"><p class="eyebrow">${esc(t('head.site'))}</p>${sitesBlock(a)}</section>
      </div>`;
    case 'land':
      return `<section class="box"><p class="eyebrow">${esc(t('head.land'))}</p>${land(a)}${LAND_LEGEND}
        <p class="mood">Scout for the overview, survey to firm it up, and work the land for the detail. The near ring runs thin as you work it; push outward for richer ground.</p></section>
        <section class="box" style="margin-top:14px"><p class="eyebrow">${esc(t('head.pins'))}</p>${pinsList(a.sim)}</section>`;
    case 'map':
      return mapTab(a);
    case 'history':
      return historyTab(a);
    case 'warden':
      return wardenTab(a);
    case 'progress':
      return `<div class="cols">
        <section class="box"><p class="eyebrow ice">${esc(t('head.season'))}</p>${timeline(a)}
          <p class="eyebrow" style="margin-top:16px">${esc(t('head.outlook'))}</p>${outlookBlock(a)}
          <p class="eyebrow" style="margin-top:16px">${esc(t('head.milestones'))}</p>${milesBlock(a)}
          <p class="eyebrow" style="margin-top:16px">${esc(t('head.pastRuns'))}</p>${pastRuns()}</section>
        <section class="box log"><p class="eyebrow" style="color:var(--faint);margin-bottom:7px">${esc(t('head.journal'))}</p><ul class="full">${journal(a, 200)}</ul></section>
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
    <p class="fgroup">WHAT WAS LEFT</p><div class="res">${storeChip('rawFood', '🍖', 'Food', st.rawFood)}${storeChip('rations', '🧂', 'Rations', st.rations)}${storeChip('water', '💧', 'Water', st.water)}${storeChip('firewood', '🪵', 'Fuel', st.firewood)}${storeChip('materials', '🪨', 'Mat', st.materials)}</div>
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
    return `<div class="resolve"><h3>${s.outcome.choice === 'collapse' ? `✝ RUN ${r?.run ?? ''} ENDED` : `❄ REGION 1 COMPLETE — RUN ${r?.run ?? ''}`}</h3><div class="outcome"><span class="head">${o.head}</span>${o.body}</div>${s.outcome.kind === 'survived' ? thawSummary(a) : ''}${facts}${recordBox(a)}`
      // One run per Warden (#1455): whoever comes next is someone new, and finds what this one left.
      + `<div class="runbar" style="margin-top:12px"><button class="btn go" data-cmd="reset" title="${esc(t('btn.newWardenTip'))}">${esc(t('btn.newWarden'))}</button></div></div>`;
  }
  return '';
}

/**
 * Draw the page. While the day plays out on the timer (#1669) the page shows the day as far as
 * it has got, whatever asked for the redraw: the game already holds the day's end.
 */
function render(a: AppState): void {
  drawPage(playing ? shownNow(playing) : a);
}

function drawPage(a: AppState): void {
  // Start telling this run's history in the background if it isn't told yet (#1540). On the road
  // too: its people answer from it (#1656), so a run reloaded there needs it back.
  chronicleFor(a.sim.character.id);
  if (a.stage === 'road' && a.road) { renderRoad(a, a.road); return; }
  const preview = previewQueue(a);
  // The winter look (#1308): the panels frost over as the snow deepens.
  const winter = seasonOf(a.sim.day, a.sim.config.calendar) === 'winter';
  root.classList.toggle('winter', winter);
  root.style.setProperty('--snow', String(winter ? Math.max(0.25, a.sim.snowDepth ?? 0) : 0));
  const fresh = a.sim.log.length === 0;
  // Which tabs show (#1688, #1691), and the open one settled against them: a CAMP tab kept from an
  // earlier run opens PLAN until this run's camp is made, a kept HISTORY tab PLAN once dev mode is left.
  const view: TabView = { dev, camp: hasCamp(a.sim) };
  tab = tabToOpen(tab, TABS, view);
  root.innerHTML = `
    <header>
      <h1>❄ GREYWIND <span class="mark">REACH</span></h1>
      ${phaseChip(a)}
      <span class="spacer"></span>
      ${a.sim.character.name ? `<button class="who" data-tab="warden" title="${esc(t('top.yourWarden'))}">${portraitEl(a.sim.character.portrait, 26)}<span><b>${esc(a.sim.character.name)}</b> · ${artificerRank(a.sim, CRAFT_WORLD.concepts)}</span></button>` : ''}
      <span class="counter ctl">${esc(t('top.run'))} <b>${runNumberFor(history, a.sim.character.id) - (state.sim.outcome ? 1 : 0)}</b></span>
      <span class="counter ctl">${esc(t('top.day'))} <b>${a.sim.day}</b></span>
      ${weekChip(a)}
      ${experimentChip(a)}
      <span class="ctl"><a class="pill" href="/play-with-ai/" title="${esc(t('top.playAiTip'))}">${esc(t('top.playAi'))}</a></span>
      <span class="ctl"><button class="pill" data-cmd="weekly" title="${esc(t('top.weekTip'))}">${esc(t('top.week'))}</button></span>
      ${featuresButton()}
      <span class="ctl"><button class="pill" data-cmd="help" aria-pressed="${showHelp}" aria-label="${esc(t('top.help'))}" title="${esc(t('top.help'))}">?</button></span>
      <span class="ctl"><button class="pill" data-cmd="reset">${esc(t('top.newSave'))}</button></span>
    </header>
    ${featuresPanel(a)}
    ${fresh || showHelp ? `<div class="ledewrap"><p class="lede">${t('help.ledeHtml', { winterDay: a.sim.config.calendar.winterDay })}</p>${langSwitch()}${devGate()}</div>` : ''}
    ${statusBar(a, preview)}
    ${resolvePanel(a)}
    <nav class="tabbar" role="tablist">${visibleTabs(TABS, view).map(d => `<button class="tabbtn ${tab === d.id ? 'on' : ''}" role="tab" aria-selected="${tab === d.id}" data-tab="${d.id}">${esc(t(`tab.${d.id}`))}${tabIsDev(d, view) ? devTag() : ''}</button>`).join('')}</nav>
    ${tabBody(a, preview)}
    ${encounterModal(a.sim, encounterAfter, a.queue.length)}
    ${meetingModal(a.sim, a.meeting)}
    ${timerPanel()}`;
  root.classList.toggle('playing', !!playing);
  if (playing) {
    tickTimer(playing);
    // The newest line in view: lines arrive at the bottom of the timer's list.
    const lines = root.querySelector<HTMLElement>('.timer .tlog');
    if (lines) lines.scrollTop = lines.scrollHeight;
  }
}

/** The encounter just answered (#1347), shown in the modal until you carry on. */
let encounterAfter: EncounterAfter | null = null;

// ── Feature switches and dev mode (#1579) ──────────────────────────────────

// `dev` and `truths` are declared beside TABS.
let showFeatures = false;

/** The small DEV tag on a view only dev mode shows (#1688). */
const devTag = (): string => ` <span class="devtag">${esc(t('tab.dev'))}</span>`;

/**
 * The password's SHA-256 (lowercase hex), from the build (#1688): set `VITE_DEV_PASSWORD_HASH` in the
 * Artificer's Vercel project, or in `.env.local` to try dev mode locally (see feature-choices.ts).
 * Unset, the ⚙ still shows, and no password opens it.
 */
const DEV_PASSWORD_HASH: string | undefined = import.meta.env.VITE_DEV_PASSWORD_HASH;

/** The dev gate's state: its password field open, and what the last try said (a catalog key, so it follows the language). */
let devGateOpen = false;
let devGateNote: Key | '' = '';

/**
 * The semi-hidden way into dev mode (#1688): a faint ⚙ in the corner of the help panel. Tapping it
 * opens an in-page password field (the viewer blocks `prompt()`); in dev mode it offers the way out.
 */
function devGate(): string {
  const icon = `<button class="devdot" data-cmd="devgate" aria-expanded="${devGateOpen}" aria-label="${esc(t('dev.label'))}" title="">⚙</button>`;
  if (!devGateOpen) return icon;
  const body = dev
    ? `<span class="faint">${esc(t('dev.on'))}</span> <button class="pill" data-cmd="devleave">${esc(t('dev.leave'))}</button>`
    : `<form class="devform" data-devform><input id="devpw" type="password" autocomplete="off" aria-label="${esc(t('dev.password'))}" placeholder="${esc(t('dev.placeholder'))}">
      <button class="pill" type="submit">${esc(t('dev.unlock'))}</button>${devGateNote ? ` <span class="faint">${esc(t(devGateNote))}</span>` : ''}</form>`;
  return `${icon}<div class="devgate">${body}</div>`;
}

// ── Language: the switch in help, and the picker before anything else (#1704) ──

/** The help panel's language switch: each language named in itself, so it's findable whatever is showing. */
function langSwitch(): string {
  const pills = LANGS.map(l => `<button class="pill" data-lang="${l}" lang="${l}" aria-pressed="${lang === l}">${esc(makeT(l)('lang.name'))}</button>`).join('');
  return `<div class="langswitch"><span>${esc(t('help.language'))}</span>${pills}</div>`;
}

/**
 * Change the language: remember it, swap `t`, and redraw whatever is showing. Nothing in the game
 * changes, so there's nothing to save but the choice itself.
 */
function setLang(next: Lang): void {
  lang = next;
  t = makeT(next);
  storeLang(next);
  document.documentElement.lang = next;
  introEl.setAttribute('aria-label', t('intro.label'));
  render(state);
  if (intro) renderIntro();
}

/**
 * The picker (#1704): the very first screen for a viewer who hasn't chosen (or whose stored choice
 * is junk), before the hike page. Its own overlay over the page, like the intro, and drawn in both
 * languages at once, since we don't know yet which one the viewer reads. `then` carries on to
 * whatever would have come first without it (the intro, the weekly world, or the saved game).
 */
function showPicker(then: () => void): void {
  const el = document.createElement('div');
  el.className = 'intro langpick';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', LANGS.map(l => makeT(l)('picker.title')).join(' · '));
  const choices = LANGS.map(l => {
    const tl = makeT(l);
    return `<button class="langchoice" data-pick="${l}" lang="${l}"><b>${esc(tl('lang.name'))}</b><span>${esc(tl('lang.play'))}</span></button>`;
  }).join('');
  const title = LANGS.map(l => `<span lang="${l}">${esc(makeT(l)('picker.title'))}</span>`).join('<span class="sep">·</span>');
  const notes = LANGS.map(l => `<span lang="${l}">${esc(makeT(l)('picker.note'))}</span>`).join('');
  el.innerHTML = `<div class="pickbox"><p class="picktitle">${title}</p><div class="langchoices">${choices}</div><p class="picknote">${notes}</p></div>`;
  el.addEventListener('click', e => {
    const pick = parseLang((e.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick);
    if (!pick) return;
    el.remove();
    setLang(pick);
    then();
  });
  document.body.appendChild(el);
  el.querySelector<HTMLButtonElement>('.langchoice')?.focus();
}

/** Open or shut dev mode, remember it, and leave a tab that no longer shows for the first one that does. */
function setDev(on: boolean): void {
  dev = on;
  setDevMode(on);
  truths = on && devTruths('');
  roadUi.truths = truths;
  if (!on) showFeatures = false;
  devGateOpen = false;
  devGateNote = '';
}

/** Check a typed password against the build's hash; the right one opens dev mode. */
async function tryDevPassword(typed: string): Promise<void> {
  if (await devPasswordMatches(typed, DEV_PASSWORD_HASH)) setDev(true);
  else devGateNote = DEV_PASSWORD_HASH ? 'dev.wrong' : 'dev.noHash';
  render(state);
}

/** A 🧪 in the header while this run plays with an experimental rule feature: it may change, or go. */
function experimentChip(a: AppState): string {
  const on = experimentalOn(featuresOf(a.sim.config.world.features));
  if (!on.length) return '';
  return `<span class="ctl"><span class="pill exp" title="${esc(t('top.experimentTip', { names: on.map(f => f.name).join(', ') }))}">${esc(t('top.experiment'))}</span></span>`;
}

/** A 📅 chip while this run plays the weekly world (#1559): its week, the same world everyone plays. */
function weekChip(a: AppState): string {
  const week = weekOfId(a.sim.character.id);
  return week ? `<span class="counter ctl weekchip" title="${esc(t('top.weekChipTip', { week }))}">📅 <b>${esc(shortWeek(week))}</b></span>` : '';
}

const featuresButton = (): string => (dev ? `<span class="ctl"><button class="pill" data-cmd="features" aria-pressed="${showFeatures}">${esc(t('top.features'))}${devTag()}</button></span>` : '');

/**
 * The features panel (dev mode): every switchable feature, what it does, and its switch. Rule
 * features change the next new game; this run keeps what it started with, shown beside each.
 */
function featuresPanel(a: AppState): string {
  if (!dev || !showFeatures) return '';
  const choices = loadChoices();
  const run = featuresOf(a.sim.config.world.features);
  const rows = FEATURES.map(f => {
    const on = typeof choices[f.id] === 'boolean' ? choices[f.id] : f.default;
    const now = f.kind === 'rules' ? ` · ${t('dev.thisRun', { state: esc(t(run[f.id] ? 'dev.runOn' : 'dev.runOff')) })}` : '';
    return `<li><div><b>${esc(f.name)}</b> <span class="stage s-${f.stage}">${f.stage === 'experimental' ? '🧪 ' : ''}${f.stage.toUpperCase()}</span>
      <p class="mood">${esc(f.note)} <span class="faint">(${esc(t(f.kind === 'rules' ? 'dev.rules' : 'dev.looks'))}${now} · #${f.issue})</span></p></div>
      <button class="pill" data-feature="${esc(f.id)}" aria-pressed="${on}">${esc(t(on ? 'dev.featOn' : 'dev.featOff'))}</button></li>`;
  }).join('');
  return `<section class="box features"><p class="eyebrow">${esc(t('head.features'))}</p><ul class="flist">${rows}</ul>
    <p class="mood">${t('dev.featuresNoteHtml')}</p>
    <p><button class="pill" data-cmd="devleave">${esc(t('dev.leave'))}</button></p></section>`;
}

// ── The caravan road (#1252) ────────────────────────────────────────────────

type RoadTab = 'road' | 'quests' | 'warden' | 'journal';
// Labels come from the catalog (`tab.<id>`).
const ROAD_TABS: readonly RoadTab[] = ['road', 'quests', 'warden', 'journal'];
let roadTab: RoadTab = 'road';
// Dev mode (#1579) shows each person's true trust beside how they seem (#1578).
const roadUi: RoadUi = { person: null, truths };

/**
 * The Warden on the road, in Region 1's shape — so the Warden tab shows what the road
 * changed (skills, techniques, recipes, the body) without a second copy of that tab.
 */
const wardenOnRoad = (a: AppState, r: RoadState): AppState => ({
  ...a, sim: { ...a.sim, vitals: r.vitals, stores: r.stores, tools: r.tools, concepts: r.concepts, character: r.character, skills: r.skills, techniques: r.techniques, manuals: r.manuals, known: r.known, focus: r.focus },
});

function roadJournal(r: RoadState, limit: number): string {
  return [...r.log].reverse().slice(0, limit).map(l => {
    return `<li class="${logClass(l)}"><span class="d">R${l.day}</span>${esc(l.text)}</li>`;
  }).join('');
}

function renderRoad(a: AppState, r: RoadState): void {
  root.classList.remove('winter');
  root.style.setProperty('--snow', '0');
  const body = roadTab === 'quests' ? `<section class="box">${questLog(r)}</section>`
    : roadTab === 'warden' ? wardenTab(wardenOnRoad(a, r))
    : roadTab === 'journal' ? `<section class="box"><p class="eyebrow">${esc(t('head.roadJournal'))}</p><div class="log" style="border:0;margin:0;padding:0"><ul style="max-height:none">${roadJournal(r, 200)}</ul></div></section>`
    : r.outcome ? `<section class="box"><p class="eyebrow">${esc(t('head.roadLast'))}</p><div class="log" style="border:0;margin:0;padding:0"><ul>${roadJournal(r, 12)}</ul></div></section>` : roadView(r, roadUi);
  const end = r.outcome ? `${roadEnd(r)}<section class="box">${recordBox(a)}</section><div class="runbar" style="margin:12px 0"><button class="btn go" data-cmd="reset" title="${esc(t('btn.newWardenTip'))}">${esc(t('btn.newWarden'))}</button></div>` : '';
  root.innerHTML = `
    <header>
      <h1>${t('top.roadTitleHtml')}</h1>
      <span class="spacer"></span>
      ${r.character.name ? `<button class="who" data-rtab="warden" title="${esc(t('top.yourWarden'))}">${portraitEl(r.character.portrait, 26)}<span><b>${esc(r.character.name)}</b> · ${artificerRank(wardenOnRoad(a, r).sim, CRAFT_WORLD.concepts)}</span></button>` : ''}
      <span class="counter ctl">${esc(t('top.marks'))} <b>${r.marks}</b></span>
      <span class="counter ctl">${esc(t('top.roadDay'))} <b>${Math.min(r.day, ROAD_DAYS)}</b></span>
      ${weekChip(a)}
      ${experimentChip(a)}
      <span class="ctl"><button class="pill" data-cmd="weekly" title="${esc(t('top.weekTip'))}">${esc(t('top.week'))}</button></span>
      ${featuresButton()}
      <span class="ctl"><button class="pill" data-cmd="reset">${esc(t('top.newSave'))}</button></span>
    </header>
    ${featuresPanel(a)}
    ${routeStrip(r)}
    ${end}
    ${r.outcome ? '' : `${roadStatus(r)}${lastNews(r)}`}
    <nav class="tabbar" role="tablist">${ROAD_TABS.map(id => `<button class="tabbtn ${roadTab === id ? 'on' : ''}" role="tab" aria-selected="${roadTab === id}" data-rtab="${id}">${esc(t(`tab.${id}`))}</button>`).join('')}</nav>
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
let state = saved ?? newGame(undefined, loadChoices());
let history = loadHistory();

// ── The run's log, for the records (#1559) ──────────────────────────────────
// The page runs the sim itself, so a run it sends to the records is checked by playing it again on
// the server (src/artificer-play/web-run.ts). For that it keeps a log from the start: who the Warden
// was and every move (web-log.ts). The log sits under its own key beside the save and belongs to
// one Warden: a log for anyone else (a save from before logs, say) means this run has none.
const LOG_KEY = 'artificer.weblog.v1';
/** The log, and once the run has been sent, its game id there and the achievements it got. */
type Kept = Recorder & { sent?: { gameId: string; achievements?: Achievement[] } };

function loadKept(): Kept | null {
  try {
    const k = JSON.parse(localStorage.getItem(LOG_KEY) ?? 'null') as Kept | null;
    return k && k.log?.v === WEB_LOG_VERSION && Array.isArray(k.log.moves) && typeof k.log.start?.id === 'string' && !!k.measures && typeof k.measures === 'object' ? k : null;
  } catch { return null; }
}

function saveKept(): void {
  try {
    if (kept) localStorage.setItem(LOG_KEY, JSON.stringify(kept));
    else localStorage.removeItem(LOG_KEY);
  } catch { /* the run plays on; it just can't be sent to the records */ }
}

let kept: Kept | null = loadKept();
/** This run's log, or null when there's none for this Warden. */
const logFor = (a: AppState): Kept | null => (kept && kept.log.start.id === a.sim.character.id ? kept : null);

/**
 * Begin a log for a Warden the page just made: what it passed to makeWarden, and what an earlier
 * Warden left. Heirlooms say which run they came from only if that run was sent to the records,
 * because the server can check them against no other.
 */
function startLog(a: AppState, spec: Omit<WebStart, 'id' | 'features' | 'heirlooms' | 'heirloomsFrom'>, heirlooms: Tool[] | null, heirloomsFrom: string | null = null): void {
  const start: WebStart = { id: a.sim.character.id, ...spec, features: { ...(a.sim.config.world.features ?? {}) }, heirlooms, ...(heirlooms?.length && heirloomsFrom ? { heirloomsFrom } : {}) };
  kept = { log: newLog(start), measures: {} };
  saveKept();
}
// A first visit: a Warden made just now, with nothing behind it.
if (!saved) startLog(state, {}, null);

/** A move the page made: written down if it changed the game (web-log.ts recordMove), then shown. */
function play(next: AppState, move: WebMove): void {
  kept = recordMove(kept, state, next, move);
  update(next);
}

// ── The day on a timer (#1669) ──────────────────────────────────────────────
// Running the queue plays the day out in real time: a bar fills for each action, the clock moves
// through the hours, and each action's journal lines arrive as it finishes. Presentation only:
// the day is resolved at once, exactly as before (playback.ts), and saved before the first frame,
// so closing or reloading the page simply finds the day done. Skip shows the end at once.

/** The viewer's speed: 1×, 2× or 4×, kept in this browser (a convenience; storage may be blocked). */
const SPEED_KEY = 'artificer.speed';
let speed: Speed = (() => { try { return parseSpeed(localStorage.getItem(SPEED_KEY)); } catch { return 1; } })();

/** The screen wake lock, where the browser has one (typed here: older DOM typings lack it). */
type WakeLockHandle = { release(): Promise<void> };
type WakeLockApi = { request(kind: 'screen'): Promise<WakeLockHandle> };

interface Playing {
  plays: DayPlay[];
  /** How each day is written in the run's log (#1559). */
  moveOf: (p: DayPlay) => WebMove;
  /** The day playing, an index into `plays`. */
  day: number;
  /** Playback hours into that day. */
  t: number;
  /** The last frame's time (ms), or null before the first. */
  last: number | null;
  frame: number;
  /** The step the page was last drawn at, so the page is redrawn only when one finishes. */
  drawn: number;
  lock: WakeLockHandle | null;
}
let playing: Playing | null = null;

/** The moment the timer is at. */
const momentOf = (pl: Playing): Moment => momentAt(pl.plays[pl.day], pl.t);

/** The game as far as the timer has got: what the page draws while it runs. */
const shownNow = (pl: Playing): AppState => shownAt(pl.plays[pl.day], momentOf(pl).done);

/**
 * Play days out on the timer. Each day is logged and saved as it starts, so leaving mid-day finds
 * that day done. Nothing worth watching (a finished run, a choice still waiting): no timer.
 */
function playOut(plays: DayPlay[], moveOf: (p: DayPlay) => WebMove): void {
  if (!worthPlaying(plays)) {
    for (const p of plays) { kept = recordMove(kept, state, p.after, moveOf(p)); keep(p.after); }
    render(state);
    return;
  }
  const pl: Playing = { plays, moveOf, day: 0, t: 0, last: null, frame: 0, drawn: -1, lock: null };
  playing = pl;
  startDay(pl);
  void holdScreen(pl);
  pl.drawn = momentOf(pl).index;
  render(state);
  pl.frame = requestAnimationFrame(now => frame(pl, now));
}

/** A day begins on the timer: it goes into the game (logged and saved) at once. */
function startDay(pl: Playing): void {
  const p = pl.plays[pl.day];
  kept = recordMove(kept, state, p.after, pl.moveOf(p));
  keep(p.after);
  pl.t = 0;
  pl.drawn = -1;
}

function frame(pl: Playing, now: number): void {
  if (playing !== pl) return;
  if (pl.last !== null) pl.t += ((now - pl.last) * speed) / MS_PER_HOUR;
  pl.last = now;
  let m = momentOf(pl);
  if (m.over) {
    if (pl.day + 1 >= pl.plays.length) { endTimer(); return; }
    pl.day += 1;
    startDay(pl);
    m = momentOf(pl);
  }
  // A step finished (or the night came): the page catches up, and its lines arrive.
  if (m.index !== pl.drawn) { pl.drawn = m.index; render(state); }
  else tickTimer(pl);
  pl.frame = requestAnimationFrame(t => frame(pl, t));
}

/** Skip (#1669): every day still to come goes into the game at once, and the screen shows the end. */
function skipTimer(): void {
  const pl = playing;
  if (!pl) return;
  while (pl.day + 1 < pl.plays.length) { pl.day += 1; startDay(pl); }
  endTimer();
}

function endTimer(): void {
  const pl = playing;
  if (!pl) return;
  cancelAnimationFrame(pl.frame);
  playing = null;
  if (pl.lock) void pl.lock.release().catch(() => undefined);
  render(state);
}

function setSpeed(x: Speed): void {
  speed = x;
  try { localStorage.setItem(SPEED_KEY, String(x)); } catch { /* this visit only */ }
  render(state);
}

/** Keep the screen awake while the day plays (a tablet left on the table), where the browser allows it. */
async function holdScreen(pl: Playing): Promise<void> {
  try {
    const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
    if (!api) return;
    const lock = await api.request('screen');
    if (playing === pl) pl.lock = lock; else void lock.release().catch(() => undefined);
  } catch { /* refused (battery saver, no permission): the timer runs anyway */ }
}

// The timer runs only while you watch: leave the page and the day is simply done when you come back.
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) skipTimer(); });
document.addEventListener('keydown', e => { if (playing && !intro && e.key === 'Escape') { e.preventDefault(); skipTimer(); } });

const PHASE_WORD: Record<Phase['kind'], string> = { out: 'walking out', work: 'working', back: 'walking back' };

/** What the step running is called: "🪵 WOOD · NEAR". */
function stepName(p: DayPlay, m: Moment): string {
  if (m.index >= p.steps.length) return '☾ NIGHT FALLS';
  const { id, ring } = parseItem(p.steps[m.index].item);
  return `${ICON[id]} ${ACTIONS[id].name.toUpperCase()}${ring > 1 ? ` · ${RING_NAME[ring].toUpperCase()}` : ''}`;
}

/** The leg of a trip session (#1668), in words; else the action's hours. */
function phaseText(p: DayPlay, m: Moment): string {
  if (m.index >= p.steps.length) return 'You eat, and sleep.';
  const st = p.steps[m.index];
  if (m.phase) return `${m.phase.trips > 1 ? `Trip ${m.phase.trip} of ${m.phase.trips} · ` : ''}${PHASE_WORD[m.phase.kind]}`;
  return st.hours > 0 ? `${hrs(st.hours)}h` : 'skipped';
}

/** The timer's sheet, along the bottom of the screen: clock, the day's strip, the action's bar, what's happened. */
function timerPanel(): string {
  const pl = playing;
  if (!pl) return '';
  const p = pl.plays[pl.day];
  const m = momentOf(pl);
  const night = m.index >= p.steps.length;
  const lines = linesAt(p, m.done, night);
  const days = pl.plays.length > 1 ? t('timer.days', { n: pl.day + 1, total: pl.plays.length }) : '';
  return `<section class="timer${night ? ' night' : ''}" aria-label="${esc(t('timer.label'))}">
    <div class="trow"><span class="tday">${esc(t('timer.day', { n: p.before.sim.day }) + days)}</span><span class="tclock" id="pb-clock">${clockText(m.clock)}</span>
      <span class="tspeed" role="group" aria-label="${esc(t('timer.speed'))}">${SPEEDS.map(x => `<button class="pill" data-speed="${x}" aria-pressed="${speed === x}">${x}×</button>`).join('')}</span>
      <button class="btn go tskip" data-pbskip title="${esc(t('timer.skipTip'))}">${esc(t('timer.skip'))}</button></div>
    <div class="tstrip" aria-hidden="true"><span class="tsfill" id="pb-day"></span></div>
    <div class="tnow"><span class="tname">${stepName(p, m)}</span><span class="tphase" id="pb-phase">${esc(phaseText(p, m))}</span><span class="tcount">${night ? '' : `${m.index + 1} / ${p.steps.length}`}</span></div>
    <div class="tbar" role="progressbar" aria-label="${esc(t('timer.action'))}" aria-valuemin="0" aria-valuemax="100"><span class="tfill" id="pb-bar"></span></div>
    <ul class="tlog" aria-live="polite">${lines.length ? lines.map(l => `<li class="${logClass(l)}">${esc(l.text)}</li>`).join('') : '<li class="wait">…</li>'}</ul>
  </section>`;
}

/** Each frame: the clock, the bars and the trip's leg, without redrawing the page. */
function tickTimer(pl: Playing): void {
  const p = pl.plays[pl.day];
  const m = momentOf(pl);
  const clock = document.getElementById('pb-clock');
  if (clock) clock.textContent = clockText(m.clock);
  const bar = document.getElementById('pb-bar');
  if (bar) {
    bar.style.width = `${Math.round(m.frac * 1000) / 10}%`;
    bar.dataset.phase = m.phase?.kind ?? '';
    bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(m.frac * 100)));
  }
  const strip = document.getElementById('pb-day');
  if (strip) strip.style.width = `${Math.min(100, Math.max(0, ((m.clock - DAY_START) / DAY_HOURS) * 100))}%`;
  const phase = document.getElementById('pb-phase');
  const text = phaseText(p, m);
  if (phase && phase.textContent !== text) phase.textContent = text;
}

// ── Arrival intro (#1228) ───────────────────────────────────────────────────
// A separate overlay element, so the game renders (and stays usable) underneath
// and render() — which rewrites #app wholesale — never wipes the intro.

let intro: { beats: Beat[]; i: number } | null = null;
const introEl = document.createElement('div');
introEl.className = 'intro';
introEl.setAttribute('role', 'dialog');
introEl.setAttribute('aria-label', t('intro.label'));
introEl.hidden = true;
document.body.appendChild(introEl);

/** What the player is choosing on the creation screen (#1239). */
// The draft carries the new Warden's id from the start: the talents on offer are seeded by it (#1263).
// Everyone starts as Loke for now: no portrait to pick, just your name to write.
const STANDARD_PORTRAIT = 'loke';
type Draft = { id: string; name: string; portrait: string; talents: TalentId[]; stats: Stats; age: number };
const blankDraft = (): Draft => ({ id: newCharacterId(), name: '', portrait: STANDARD_PORTRAIT, talents: [], stats: { ...DEFAULT_STATS }, age: DEFAULT_AGE });
let draft: Draft = blankDraft();
const draftValid = (): boolean => draft.name.trim().length > 0 && draft.talents.length === TALENT_PICKS;
/** What's in the pack on the packing screen (#1401): the leader's list for a new Warden, last time's for one carrying on. */
let draftPack: KitId[] = [...SUGGESTED_PACK];

// The draft survives a reload (#1266): the same Warden-to-be, with the same seeded offer —
// so reloading the page can't re-roll the talents on offer, and nothing typed is lost.
const DRAFT_KEY = 'artificer.draft';
function loadDraft(): typeof draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<typeof draft> | null;
    if (!d || typeof d.id !== 'string' || !d.id) return null;
    const offer = talentOffer(seedOf(d.id));
    return {
      id: d.id,
      name: typeof d.name === 'string' ? d.name.slice(0, 24) : '',
      portrait: STANDARD_PORTRAIT,
      talents: Array.isArray(d.talents) ? [...new Set(d.talents.filter(t => offer.includes(t)))].slice(0, TALENT_PICKS) : [],
      stats: d.stats && validStats(d.stats) ? { ...d.stats } : { ...DEFAULT_STATS },
      age: START_AGES.includes(d.age as number) ? d.age! : DEFAULT_AGE,
    };
  } catch { return null; }
}
const saveDraft = (): void => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* a convenience; play on */ } };
const clearDraft = (): void => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ } };

function startIntro(): void {
  draft = loadDraft() ?? blankDraft();
  draftPack = [...SUGGESTED_PACK];
  drawnBeat = -1;
  intro = { beats: introBeats(state.sim), i: 0 };
  renderIntro();
}

/** Leaving the creation screen: the Warden is made with the chosen name, portrait, talents and stats (a hidden talent is rolled from the id). */
function commitCharacter(): void {
  // The sim is made again from the draft — keeping what the last Warden left (#1455), which the intro already told them about.
  const left = heirloomsOf({ tools: state.sim.tools.filter(t => t.heirloom) });
  const legacy = left.heirlooms?.length ? left : undefined;
  const spec = { name: draft.name.trim().slice(0, 24), portrait: draft.portrait, chosen: [...draft.talents], stats: validStats(draft.stats) ? { ...draft.stats } : { ...DEFAULT_STATS }, age: draft.age };
  // The log starts again from this Warden (#1559); the heirlooms came from the same run as before.
  const from = kept?.log.start.heirloomsFrom ?? null;
  state = makeWarden({ id: draft.id, ...spec }, legacy, loadChoices());
  startLog(state, spec, legacy ? legacy.heirlooms ?? [] : null, from);
  // The pack screen comes first now (#1666), and makeWarden starts from the default pack — so
  // pack again: the same makeWarden → startLog → repack the run had when packing came last.
  applyPack();
  render(state);
}

/** The pack chosen is the one the run starts with (#1401); the log's start says what was packed (#1559). */
function applyPack(): void {
  state = { ...state, sim: repack(state.sim, draftPack) };
  const k = logFor(state);
  if (k && !k.log.moves.length) { kept = { ...k, log: { ...k.log, start: { ...k.log.start, pack: [...draftPack] } } }; saveKept(); }
}

function endIntro(): void {
  intro = null;
  introEl.hidden = true;
  introEl.innerHTML = '';
  // Persist now, so a reload after the intro doesn't play it again — and only now let the draft go:
  // until the game is saved, a reload must bring back the same Warden-to-be (#1266).
  save(state);
  clearDraft();
}

function advanceIntro(): void {
  if (!intro) return;
  if (intro.beats[intro.i].kind === 'create') { if (!draftValid()) return; commitCharacter(); }
  // Off we go (#1401): the pack chosen is the one the run starts with. (Skipping keeps the pack you had.)
  // Applied here too, so skipping the rest of the intro still starts with it; creation packs again (#1666).
  if (intro.beats[intro.i].kind === 'pack') { applyPack(); render(state); }
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
      ${last ? '' : `<button class="pill" data-intro="skip">${esc(t('intro.skip'))}</button>`}
      <button class="btn go" data-intro="next" ${b.kind === 'create' && !draftValid() ? 'disabled' : ''}>${esc(t(last ? 'intro.begin' : b.kind === 'pack' ? 'intro.offWeGo' : 'intro.next'))}</button>
    </div>`;
  const beatEl = introEl.querySelector('.beat');
  if (beatEl && drawnBeat === intro.i) beatEl.scrollTop = scrolled;
  // On the creation screen, start in the name field (unless a name is already typed).
  if (b.kind === 'create') saveDraft();
  if (b.kind === 'create' && !draft.name) introEl.querySelector<HTMLInputElement>('#wname')?.focus();
  else introEl.querySelector<HTMLButtonElement>('[data-intro="next"]')?.focus();
}

/**
 * The packing screen (#1401): the whole list, by group — each item with its weight, what it is for
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
        + `<span class="khead">${itemIcon(k.id)}<b>${esc(k.name)}</b>${k.sv && k.sv.toLowerCase() !== k.name.toLowerCase() ? ` <i>${esc(k.sv)}</i>` : ''}<span class="kkg">${k.weight} kg</span></span>`
        // What a scout would say it's for, never the rule it plays (#1684): the player finds out
        // what's useful by playing. The rule shows only with the hidden truths (`?dev=truths`).
        + `<span class="kdoes">${esc(k.does)}</span><span class="knote">${esc(k.note)}</span>`
        + `${truths ? `<span class="devtruth" title="Dev mode (?dev=truths): the rule this item plays">rule: ${esc(k.effect)}</span>` : ''}</button>`;
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

/** The creation form: your name (written, beside the standard portrait), two of four offered talents, age, stats. Choices live in `draft` until Continue. */
function createForm(): string {
  const offer = talentOffer(seedOf(draft.id));
  const talents = offer.map(t => `<button class="tchoice" data-talent="${t}" aria-pressed="${draft.talents.includes(t)}"><b>${esc(TALENTS[t].name)}</b><span class="up">+ ${esc(TALENTS[t].blurb)}</span></button>`).join('');
  return `<form class="create" onsubmit="return false">
    <label class="clabel" for="wname">NAME — write it</label>
    <div class="cwho">${portraitEl(STANDARD_PORTRAIT, 64)}<input id="wname" class="cname" maxlength="24" autocomplete="off" spellcheck="false" placeholder="What are you called?" value="${esc(draft.name)}"></div>
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
  const btn = el.closest<HTMLElement>('[data-intro], [data-talent], [data-stat], [data-age], [data-kit], [data-kitcmd]');
  // On the creation and packing screens only their own controls act, so a stray tap can't skip past your choices.
  const creating = intro?.beats[intro.i].kind === 'create' || intro?.beats[intro.i].kind === 'pack';
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
  saveDraft();
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
  keep(next);
  render(state);
}

/** Make `next` the game: into the history if the run just resolved, then saved. No redraw. */
function keep(next: AppState): void {
  // The moment a run resolves, it goes into the history (once).
  const h = recordRun(history, state, next);
  if (h.length !== history.length || h[0] !== history[0]) { history = h; saveHistory(history); }
  state = next;
  save(state);
  saveKept();
}

root.addEventListener('click', e => {
  // A building in a settlement (#1541), on its grid or in the key: show what it is.
  const bldg = (e.target as HTMLElement).closest<HTMLElement>('[data-bldg]');
  if (bldg?.dataset.bldg) { settlementPick = settlementPick === bldg.dataset.bldg ? null : bldg.dataset.bldg; render(state); return; }
  // Enter a settlement from the map, or go back to the map ("").
  const enterEl = (e.target as HTMLElement).closest<HTMLElement>('[data-settle]');
  if (enterEl) { mapSettlement = enterEl.dataset.settle || null; settlementPick = null; render(state); return; }
  // A square on the map (#1539): show what it is.
  const square = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
  if (square?.dataset.cell) { const [x, y] = square.dataset.cell.split(',').map(Number); mapCell = { x, y }; render(state); return; }
  // closest() finds the button even when the click lands on a child span.
  const el = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const d = el.dataset;
  // While the day plays out (#1669), only the timer's own buttons, the tabs and help act: the game
  // already holds the day's end, so a move now would be made from a state the screen isn't showing.
  if (playing) {
    if (d.speed) { setSpeed(parseSpeed(d.speed)); return; }
    if (d.pbskip !== undefined) { skipTimer(); return; }
    if (!d.tab && d.cmd !== 'help' && !d.lang) return;
  }
  if (d.tab) { tab = d.tab as Tab; try { localStorage.setItem('artificer.tab', tab); } catch { /* per-browser convenience only */ } render(state); }
  else if (d.cmd === 'help') { showHelp = !showHelp; render(state); }
  // The language switch in help (#1704): presentation only, so it's fine mid-day too.
  else if (d.lang) { const l = parseLang(d.lang); if (l) setLang(l); }
  else if (d.cmd === 'features') { showFeatures = !showFeatures; render(state); }
  else if (d.cmd === 'devgate') { devGateOpen = !devGateOpen; devGateNote = ''; render(state); if (devGateOpen) root.querySelector<HTMLInputElement>('#devpw')?.focus(); }
  else if (d.cmd === 'devleave') { setDev(false); render(state); }
  else if (d.feature) {
    // Flip one switch (#1579); a rule feature takes effect at the next new game.
    const choices = loadChoices();
    const f = FEATURES.find(x => x.id === d.feature);
    if (f) { saveChoices({ ...choices, [f.id]: !(typeof choices[f.id] === 'boolean' ? choices[f.id] : f.default) }); render(state); }
  }
  else if (d.ring) { focusRing = Number(d.ring) as Ring; render(state); }
  // Pins (#1380): list a ring's places, let one go, or weigh it.
  else if (d.pinring) { const r = Number(d.pinring) as Ring; pinRing = pinRing === r ? null : r; render(state); }
  // Game moves go through play(), which writes them in the run's log (#1559); the plan's edits
  // (queueing, options, removing) are the page's own and aren't moves.
  else if (d.forget) play(forget(state, d.forget), { set: { forget: d.forget } });
  else if (d.interest) { const [id, n] = d.interest.split('|'); play(weighPin(state, id, Number(n) as 0 | 1 | 2 | 3), { set: { pin: d.interest } }); }
  else if (d.focus) { const f = parseFocus(d.focus); play(chooseFocus(state, f), { set: { focus: focusKey(f) } }); }
  else if (d.cmd === 'eat') { const plans = ['full', 'half', 'none'] as const; const plan = plans[(plans.indexOf(state.sim.eating ?? 'full') + 1) % plans.length]; play(chooseEating(state, plan), { set: { eating: plan } }); }
  // Before planning is learned (#1350), a tap does the thing now.
  else if (d.q) { const q = d.q as QueueId; if (state.sim.canPlan) update(enqueue(state, q)); else playOut([playAct(state, q)], () => ({ do: q })); }
  else if (d.cmd === 'endday') play(endTheDay(state), { endDay: true });
  else if (d.toggle !== undefined) { const i = Number(d.toggle); if (expanded.has(i)) expanded.delete(i); else expanded.add(i); render(state); }
  // Keep the menu open while choosing (it may have opened only because a choice was missing).
  else if (d.opt) { const [i, key, value] = d.opt.split('|'); expanded.add(Number(i)); update(setOption(state, Number(i), key, value)); }
  else if (d.x !== undefined) { expanded.clear(); update(dequeueAt(state, Number(d.x))); }
  else if (d.site) play(settle(state, d.site as SiteId), { set: { site: d.site } });
  // A day run from the plan is logged as that day's plan, as it stood.
  // On the timer (#1669): each day's actions play out, and each day is logged as its plan, as it stood.
  else if (d.cmd === 'day') playOut([playDay(state)], p => ({ plan: p.before.queue }));
  else if (d.cmd === 'all') playOut(playWholeQueue(state), p => ({ plan: p.before.queue }));
  else if (d.cmd === 'clear') update(clearQueue(state));
  // A new Warden (#1455): if this run is over, they find its tools; mid-run or with no run, nothing.
  else if (d.cmd === 'reset') { newWarden(); clearDraft(); startIntro(); }
  else if (d.cmd === 'weekly') void startWeekly();
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
    play(next, { choose: d.choose });
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
    play(next, { choose: d.choose });
  }
  // Carrying on runs the rest of the planned day: logged as that day's plan, if it ran anything.
  else if (d.cmd === 'carryon') { encounterAfter = null; if (state.stage === 'road') render(state); else { const next = carryOn(state); playOut(next === state ? [] : [playDay(state, next)], p => ({ plan: p.before.queue })); } }
  // The caravan road (#1252): ride on, act, end the day, open a villager's sheet, switch tabs.
  // Meeting the caravan (#1356): open the dialogue, answer, then climb aboard or watch them go.
  else if (d.cmd === 'meet') update(meetCaravan(state));
  else if (d.meet) play(meetingChoose(state, d.meet), { choose: d.meet });
  else if (d.cmd === 'stay') update(stayBehind(state));
  else if (d.cmd === 'board' || d.cmd === 'ride') { roadTab = 'road'; roadUi.person = null; update(rideCaravan(state)); }
  else if (d.road) play(roadAct(state, d.road as Parameters<typeof roadAct>[1]), { do: d.road });
  else if (d.cmd === 'roadday') { roadUi.person = null; play(roadEndDay(state), { endDay: true }); }
  else if (d.person) { roadUi.person = roadUi.person === d.person ? null : d.person; render(state); }
  else if (d.rtab) { roadTab = d.rtab as RoadTab; render(state); }
});

// Ask anything (#1575): a free question to someone on the road, once per person per stay. It's
// matched here, to what they know (free-questions.ts), and played as the topic it matched: the
// words never go into the game or its save. Then it's sent to be kept, because what players ask
// is what shows how to grow the game. Nothing waits for that, and if it fails the game goes on.
root.addEventListener('submit', e => {
  if (playing) { e.preventDefault(); return; }
  // The dev gate's password (#1688): checked against the build's hash, never sent anywhere.
  const devForm = (e.target as HTMLElement).closest<HTMLFormElement>('form[data-devform]');
  if (devForm) { e.preventDefault(); void tryDevPassword(devForm.querySelector<HTMLInputElement>('#devpw')?.value ?? ''); return; }
  // Sending the run to the records (#1559).
  if ((e.target as HTMLElement).closest('form[data-sendrun]')) { e.preventDefault(); void sendRun(); return; }
  const form = (e.target as HTMLElement).closest<HTMLFormElement>('form[data-question]');
  if (!form) return;
  e.preventDefault();
  const r = state.road;
  const pid = form.dataset.question ?? '';
  const raw = (form.elements.namedItem('q') as HTMLInputElement | null)?.value ?? '';
  const clean = cleanQuestion(raw);
  if (!r || !clean || (r.questioned ?? []).includes(pid)) return;
  // Matched by this run's switches (#1611): the knowledge model's topics when knowledge-questions is on.
  // Against the run's facts (#1656, `playFacts`): with history-in-play on, its villages' history too.
  const topic = matchFreeQuestion(pid, clean, r.asked?.[pid] ?? [], r.features, { facts: playFacts(r) });
  const trust = Math.round(r.trust[pid] ?? 0);
  const played = `question:${pid}${topic ? `:${topic}` : ''}`;
  const next = roadAct(state, played as Parameters<typeof roadAct>[1]);
  if (!next.road?.questioned?.includes(pid)) { play(next, { do: played }); return; }
  // Told, rather than kept back or sent elsewhere: the topic is among what they've told you now.
  // A lie told instead (#1580, `claimed:<topic>`) is an answer too: they responded.
  const answered = topic !== null && respondedOn(next.road.asked?.[pid], topic);
  // What they said, for their sheet: the journal's line without its "You ask Orrin about iron." lead-in.
  const said = next.road.log.slice(r.log.length).find(l => l.kind === 'action')?.text.replace(/^You ask [^.]+\. /, '') ?? '';
  roadUi.asked = { ...roadUi.asked, [pid]: { question: [...raw.trim()].slice(0, QUESTION_CHARS).join(''), topic, reply: said } };
  // Logged as the road action it was played as: the words never go into the game or its log.
  play(next, { do: played });
  // Same origin: the Artificer's site serves the play API (src/artificer-play/). The server cleans
  // the question again before it keeps it, so it's sent as typed.
  void fetch('/api/v1/questions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
    body: JSON.stringify({ person: pid, question: raw, topic, answered, trust }),
  }).catch(() => undefined);
});

// ── A new Warden, and sending a run to the records (#1559) ──────────────────

/**
 * A new Warden (#1455): if this run is over, they find its tools; mid-run or with no run, nothing.
 * Their log says where the tools came from if that run was sent to the records, so the server can
 * check them.
 */
function newWarden(): void {
  const legacy = legacyFor(currentRun(state));
  const next = newGame(legacy, loadChoices());
  startLog(next, {}, legacy ? legacy.heirlooms ?? [] : null, logFor(state)?.sent?.gameId ?? null);
  update(next);
}

/** The records box's state, for one run: the achievements worked out here, and sending the run. */
interface RecordUi { forId: string; name: string; status: 'idle' | 'sending' | 'error'; message: string; fetched: boolean; preview: Achievement[] | null }
let recordUi: RecordUi | null = null;

function recordUiFor(a: AppState): RecordUi {
  if (recordUi?.forId !== a.sim.character.id) {
    recordUi = { forId: a.sim.character.id, name: currentRun(a).character.name, status: 'idle', message: '', fetched: false, preview: null };
  }
  return recordUi;
}

/** This run's record as the page works it out: what it claims, and what its achievements are worked out from. */
const localRun = (a: AppState, k: Kept | null) =>
  runOf(a, k?.measures ?? {}, { playerKind: 'person', model: null, client: 'artificer-web', surface: 'web', gameVersion: k?.log.version ?? '', name: recordUi?.name ?? null, moves: k?.log.moves.length ?? 0 });

/**
 * How this run compares, before it's sent: the records it would be compared with (this week's for a
 * run of the weekly world, else the recent ones), fetched once per run. Started from the render,
 * like the Reach's history (#1540): the box draws at once and fills in when they come.
 */
function previewAchievements(a: AppState, ui: RecordUi): void {
  if (ui.fetched) return;
  ui.fetched = true;
  const week = weekOfId(a.sim.character.id);
  void fetch(week ? `/api/v1/runs/week/${week}` : '/api/v1/runs')
    .then(r => (r.ok ? r.json() as Promise<{ recent?: RunSummary[]; runs?: RunSummary[] }> : null))
    .then(b => {
      const list = b?.runs ?? b?.recent;
      if (!list || recordUi !== ui || !runOver(state)) return;
      ui.preview = achievementsOf(localRun(state, logFor(state)), list);
      render(state);
    })
    .catch(() => undefined);
}

const achievementsHtml = (list: readonly Achievement[]): string =>
  `<ul class="achlist">${list.map(x => `<li class="${x.status}" title="${esc(x.rule)}"><b>${x.status === 'earned' ? '★' : '☆'} ${esc(x.name)}</b><span>${esc(x.detail)}</span></li>`).join('')}</ul>`;

/**
 * The end of a run's records box: its achievements, and sending it to the records with a
 * nickname. Opt-in: nothing is sent unless the player sends it. A run the server can't check (no
 * log, or heirlooms from a run that wasn't sent) says so instead of offering to send.
 */
function recordBox(a: AppState): string {
  if (!runOver(a)) return '';
  const ui = recordUiFor(a);
  const k = logFor(a);
  const sent = k?.sent;
  if (!sent) previewAchievements(a, ui);
  const list = sent?.achievements ?? ui.preview;
  const ach = list ? achievementsHtml(list) : `<p class="note">${esc(t('records.working'))}</p>`;
  let foot: string;
  if (sent) foot = `<p class="note">${esc(t('records.sent'))} <a href="/records/?game=${esc(sent.gameId)}">${esc(t('records.compare'))}</a></p>`;
  else if (!k) foot = '<p class="note">This run began before runs could be sent to the records, so it can\'t be checked.</p>';
  else if (k.log.start.heirlooms?.length && !k.log.start.heirloomsFrom) {
    foot = '<p class="note">This Warden started with what an earlier one left, from a run that wasn\'t sent to the records, so the server can\'t check it. Send a run before you start the next Warden, and the next one can be sent too.</p>';
  } else {
    const sending = ui.status === 'sending';
    foot = `<form data-sendrun><input id="runname" name="nick" maxlength="24" autocomplete="off" spellcheck="false" placeholder="${esc(t('records.nickname'))}" aria-label="${esc(t('records.nicknameLabel'))}" value="${esc(ui.name)}">`
      + `<button class="btn go" type="submit" ${sending ? 'disabled' : ''}>${esc(t(sending ? 'records.sending' : 'records.send'))}</button></form>`
      + `<p class="note">${esc(t('records.replayNote'))}</p>`
      + (ui.status === 'error' ? `<p class="note warn">${esc(ui.message)}</p>` : '');
  }
  return `<div class="runrecord"><p class="eyebrow">${esc(t('head.records'))}</p>${ach}${foot}</div>`;
}

/** Send this run to the records (#1559): its log and what it came to, for the server to replay. */
async function sendRun(): Promise<void> {
  const k = logFor(state);
  if (!k || k.sent || !runOver(state) || recordUi?.status === 'sending') return;
  const ui = recordUiFor(state);
  ui.status = 'sending';
  render(state);
  try {
    const r = await fetch('/api/v1/runs/submit', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ log: k.log, claim: claimOf(localRun(state, k)), name: ui.name }),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; achievements?: Achievement[]; error?: string };
    if ((r.status === 201 || r.status === 200) && body.id) {
      if (logFor(state) === k) { kept = { ...k, sent: { gameId: body.id, ...(body.achievements ? { achievements: body.achievements } : {}) } }; saveKept(); }
      ui.status = 'idle';
    } else {
      ui.status = 'error';
      ui.message = body.error ?? t('records.failed', { status: r.status });
    }
  } catch {
    ui.status = 'error';
    ui.message = t('records.unreachable');
  }
  render(state);
}

// The nickname is kept as it's typed, so a redraw (the achievements coming in) doesn't lose it.
root.addEventListener('input', e => {
  const input = e.target as HTMLInputElement;
  if (input.id === 'runname' && recordUi) recordUi.name = input.value;
});

// ── The weekly world (#1559) ────────────────────────────────────────────────

/**
 * Play this week's world: the same seed for everyone this week, people and AIs (weekly.ts). The page
 * runs the sim itself, so it needs the seed, which the play API hands out for the current week. The
 * Warden starts with nothing an earlier one left (no heirlooms), so everyone on the week's world
 * begins alike, and goes through the creation screen as any new Warden does. True if it started.
 */
async function startWeekly(): Promise<boolean> {
  let gameId: string | null = null;
  try {
    const r = await fetch('/api/v1/weekly');
    const body = r.ok ? (await r.json()) as { gameId?: unknown } : null;
    if (typeof body?.gameId === 'string' && weekOfId(body.gameId)) gameId = body.gameId;
  } catch { /* offline, or the API isn't there (a local dev server): said below */ }
  if (!gameId) {
    alert(t('weekly.unreachable'));
    return false;
  }
  if (state.sim.log.length > 0 && !runOver(state) && !confirm(t('weekly.leave'))) return false;
  const next = makeWarden({ id: gameId }, undefined, loadChoices());
  startLog(next, {}, null);
  update(next);
  draft = { ...blankDraft(), id: gameId };
  saveDraft();
  startIntro();
  return true;
}

render(state);
// `/?weekly` (the Records page links it) starts this week's world; the address loses it, so a reload
// doesn't start it again. Otherwise a Warden still being made (a first visit, or after New Game)
// picks up where it was (#1266).
const resume = (): void => { if (!saved || loadDraft()) startIntro(); };
const weekly = new URLSearchParams(location.search).has('weekly');
if (weekly) window.history.replaceState(null, '', location.pathname); // `window.`: `history` here is the run history
const begin = (): void => {
  if (weekly) void startWeekly().then(started => { if (!started) resume(); });
  else resume();
};
// The language comes before everything else (#1704): a viewer with no usable choice stored picks one
// first, then the page carries on exactly as it would have.
if (pickerNeeded()) showPicker(begin);
else begin();
