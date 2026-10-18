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
import { mapMode } from '../artificer/descriptive-map';
import { repack, CRAFT_WORLD, PLANNING_UNLOCKED, ACTIONS, DAY_HOURS, queueHours, winterReady, tonightsFright, type TripLoad, parseItem, type ActionId, type QueueId, type SiteId, type EatingPlan } from '../artificer/region1';
import { type Ring } from '../artificer/exploration';
import { type GearItem, type Haul } from '../artificer/load';
import { heirloomsOf, runNumberFor, type RunRecord } from '../artificer/legacy';
import { seasonOf } from '../artificer/winter';
import { DAY_START } from '../artificer/clock';
import { CAP_CEIL } from '../artificer/vitality';
import { skillLevel } from '../artificer/skills';
import { introBeats, introHtml, introWhere, type Beat } from './intro';
import { focusKey, parseFocus } from '../artificer/focus';
import { focusChip, focusPopover, focusPopAfter, FOCUS_POP_ID, type FocusUi } from './focus-popover';
import { GUIDE_FEATURE } from './survival-path';
import { TALENT_PICKS, talentOffer, seedOf, type TalentId } from '../artificer/talents';
import { generateReach, type Reach } from '../artificer/world/reach';
import { provincesOf, type Provinces } from '../artificer/world/provinces';
import { settlementOf, TIER_NAME, type Settlement } from '../artificer/world/settlements';
import { cultureName } from '../artificer/world/peoples';
import { keptHistory, type ReachHistory } from '../artificer/world/history-format';
import { painOf } from '../artificer/pain';
import { injuryView } from '../artificer/injuries';
import { SUGGESTED_PACK, validPack, offeredKit, type KitGroup, type KitId } from '../artificer/kit';
import { DEFAULT_AGE, START_AGES } from '../artificer/growing';
import { DEFAULT_STATS, canRaise, canLower, validStats, type Stats, type StatId } from '../artificer/stats';
import { artificerRank } from '../artificer/rank';
import { roadView, routeStrip, roadStatus, lastNews, questLog, roadEnd, type RoadUi } from './road-view';
import { QUESTION_CHARS } from '../artificer/free-questions';
import { matchFreeQuestion } from '../artificer/knowledge-questions';
import { keepHistory, playFacts } from '../artificer/history-in-play';
import { cleanQuestion } from '../artificer-play/questions';
import { FEATURES, experimentalOn, featuresOf, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { weekOfId, shortWeek } from '../artificer-play/weekly';
import { newLog, recordMove, runOver, claimOf, markDev, submitBody, WEB_LOG_VERSION, type Recorder, type WebMove, type WebStart } from '../artificer-play/web-log';
import { runOf } from '../artificer-play/record-of';
import { achievementsOf, type Achievement } from '../artificer-play/achievements';
import type { RunSummary } from '../artificer-play/records';
import type { Tool } from '../artificer/crafting';
import { APP_TABS, devMode, devTruths, devNeedsPassword, devUnlocks, keptTab, loadChoices, saveChoices, setDevMode, tabIsDev, viewToOpen, visibleTabs, type AppTab, type TabView } from './feature-choices';
import { hasCamp, withCampLine } from './camp-view';
import { journalItems, logClass, logText } from './journal-view';
import { injuryChip, nightTip, painTip, pinNoteText, uneaseText } from './queue-words';
import { ROAD_DAYS, type RoadState } from '../artificer/road';
import { encounterModal, type EncounterAfter } from './encounter-view';
import { mapSessionModal, newSessionUi, lookAroundLand, type MapSessionUi } from './map-session-view';
import { mapSessionOpen, placeOn, unplaced, moveCell, NEW_SESSION, type MapSession } from '../artificer/map-learning';
import { wardenTab } from './warden-view';
import { EATING_PLANS, RATIONS_FEATURE, eatingChip, rationsNote, rationsNoteDue, rationsPlace, rationsRow } from './rations-view';
import { LAND_FOUND_FEATURE, landTab, seeLandLink, tripNews } from './land-view';
import { START_LAND_FEATURE, claimStartLand, nearestFirst, startLandUsed, startNoteBlock, startTarget } from './start-land';
import { landNews, landSeen, mergeNews, ringsToOpen, storedSeen, storeSeen, tripRing, type LandNews } from './land-news';
import { FINDS_FEATURE, FIND_MS, findCount, findsShown, playFinds, storeTrips, storedTrips, timerLines, withTripLines, type TripFinds } from './explore-finds';
import { drawnMapBlock, reachMapSection } from './map-view';
import { setFold } from './fold';
import { ackWeather, loadWeatherFold, saveWeatherFold, toggleWeather, weatherFoldState, type WeatherFold } from './weather-fold';
import { defaultsFor, loadRingDefaults, rememberRing, saveRingDefaults } from './distance-defaults';
import { progressTab, outlookWarnings } from './progress-view';
import { historyTab as historyView, provinceInfo as provinceInfoView } from './history-view';
import { meetingModal } from './caravan-view';
import { truthLine } from '../artificer/panic';
import { encounterById, stepOf } from '../artificer/encounters';
import { respondedOn } from '../artificer/journal';
import { choose, carryOn, forget, weighPin, roadChoose, endTheDay, queueLocked, makeWarden, newGame, legacyFor, currentRun, rideCaravan, meetCaravan, meetingChoose, stayBehind, roadAct, roadEndDay, newCharacterId, chooseFocus, chooseEating, recordRun, serializeHistory, deserializeHistory, HISTORY_KEY, enqueue, dequeueAt, moveQueued, clearQueue, setOption, settle, previewQueue, todayHours, serialize, deserialize, SAVE_KEY, type AppState } from './controller';
import { nowTotal, queueTimes, timeWordsShown, timerClock } from './time-view';
import { endWords, partShort } from '../artificer/time-words';
import { LAND_ASSESS_FEATURE } from './land-assessment';
import { SIDE_QUEUE_FEATURE, compactEnd, compactItem, compactItemHtml, compactTotal, planLayout, queueStrip } from './plan-layout';
import { dropIndex, followMove, gapShift, pastThreshold, type RowRect } from './queue-drag';
import { playAct, playActStopped, playDay, playStopped, playWholeQueue, momentAt, shownAt, linesAt, parseSpeed, stopPoint, timeAt as playTimeAt, worthPlaying, MS_PER_HOUR, SPEEDS, type DayPlay, type Moment, type Speed } from './playback';
import { inject } from '@vercel/analytics';
import { LANGS, makeT, parseLang, type Key, type Lang, type T } from '../artificer/i18n';
import { pickerNeeded, storedLang, storeLang } from './lang';
import { itemIcon } from './item-icons';
import { esc, pct, band, wardenButton } from './html';
import { weatherRow } from './weather-row';
import { isBlizzard, BLIZZARD_HOURS } from '../artificer/weather';
import { ICON, haulWord, paletteBlock, weatherBox, weatherChips, storesRow, coldBlock, meatBlock, nightBlock, vitalsBlock, sitesBlock, toolsBlock, firstJournalLine, stepName, phaseText, outcomeCard, distanceItem, type Preview } from './camp-blocks';
import { DIRS, type Way } from '../artificer/directed-explore';
import { forecastBlock, taskCard } from './forecast-words';
import { packForm, createForm, sectionOpen, readPackOpen, allSectionsOpen, setAllSections, PACK_OPEN_KEY, type PackOpen } from './opening-view';
import { LOOKS, LOOK_IDS, LOOK_SWITCHER_FEATURE, applyLook, installLooks, loadLookChoice, lookFromQuery, lookOfGame, saveLookChoice, shownLook, stepLook, type LookId } from './looks';
import { installFeedback } from './feedback-panel';
import { deviceOf, lastJournal } from './feedback-draft';
import { actionName, choiceNote, distanceT, optionGroupLabel, optionLabel, rankName, recipeName, ringName, simLine } from './sim-words';
import { BACKDROP_FEATURE, NO_UI, loadStill, saveStill, sceneFor, timeAt, type BackdropUi, type BdTime } from './backdrop';
import { createBackdrop } from './backdrop-view';
import { TWO_ROW_FEATURE, wardenRow, type VitalReading } from './vital-words';
import { NOTES_FEATURE, howtoBody, journalHead, notesShown, journalBoxShown } from './journal-notes';
import { MENY_FEATURE, headerRows, elsewhereBody, experimentsBody, headerControls, helpExtras, menyButton, menyPage, newGameBody, newSaveButton, playAiLink, profileBody, soundBody, weeklyButton, type HeaderParts } from './meny';
import { AMBIENCE_FEATURE, inputFor, isOut, mixFor } from './ambience-mix';
import { createAmbience } from './ambience';
import { SoundSwitch } from './sound';
import { REVEALS, TAB_GUIDE, activeTip, began, guideFinished, guideFor, heldTabs, isGuideId, queueReach, loadGuide, markDone, markSeen, markShown, revealedNow, saveGuide, setPlayedBefore, showGuideAgain, suggestedAction, suitableSiteKnown, usedNow, type GuideId, type GuideRecord } from './reveal';
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
// it isn't saved with the game. The opening and a day at camp are too (#1707: opening-view.ts,
// camp-blocks.ts, and sim-words.ts for what the sim says in English). The journal, the road and
// generated text are still English (later phases of #1685). `let`: choosing a language swaps `t`
// and redraws.
let lang: Lang = storedLang() ?? 'en';
let baseT: T = makeT(lang);
// The run's own words on top (#1752): with `distance-not-rings` on, its rings said as distances
// (sim-words.ts distanceT). Set again on each draw, from the run being drawn.
let t: T = baseT;
document.documentElement.lang = lang;

// ── Presentation-only data (wording lives here, rules live in the sim) ──────

// ── Rendering ───────────────────────────────────────────────────────────────
// The opening's forms and a day at camp are drawn by opening-view.ts and camp-blocks.ts (#1707),
// in the viewer's language; the helpers (esc, hrs...) are html.ts's.

// The PROGRESS tab (season, outlook, milestones, past runs) is drawn by progress-view.ts (#1711).

/** Queue entries whose options menu is open (UI-only; reset when the queue shifts). */
const expanded = new Set<number>();

/**
 * The palette's distance chooser (#1814): which land action's is open under its card, if any, and
 * the distance each action was last aimed at, per Warden (distance-defaults.ts). The page redraws
 * by replacing its HTML, so both live here (the defaults in `localStorage` too), not in the DOM.
 */
let ringPick: ActionId | null = null;
let ringDefaults = loadRingDefaults();
/**
 * The way picked on Explore's compass (#1839, `directed-explore`) while its chooser is open: look
 * around (here), around camp, or one of the eight ways. Page state, as the chooser is: back to
 * "look around" whenever the chooser shuts.
 */
let exploreWay: Way = 'here';
/** Every way Explore's compass can pick (#1839). */
const WAYS: readonly Way[] = ['here', 'camp', ...DIRS];

/** Shut the chooser; with `refocus`, the keyboard goes back to the card it opened from. */
function closeRingPick(refocus: boolean): void {
  const id = ringPick;
  ringPick = null;
  exploreWay = 'here';
  render(state);
  if (refocus && id) root.querySelector<HTMLElement>(`[data-chooser="${id}"]`)?.focus();
}

/** What the palette needs from the page: dev mode, the language, and this Warden's chooser state. */
const paletteOpts = (s: AppState['sim']) => {
  // The start's highlight (#1853): Explore glows, and its chooser opens at the nearest distance.
  const own = defaultsFor(ringDefaults, s.character.id);
  return { dev, t, defaults: startHl ? nearestFirst(own) : own, chooser: ringPick, suggest: startHl ? startTarget().highlight : null, way: exploreWay };
};

// ── The start on LAND (#1853, start-land.ts) ─────────────────────────────────
// A ui feature: a new Warden's first view after the intro is LAND, with the patrol leader's advice
// and an Explore button that goes to PLAN with Explore highlighted and its chooser open. The page's
// own state, like the chooser's: nothing in the save.
const startLandOn = (): boolean => uiFeatureOn(loadChoices(), START_LAND_FEATURE);
/** Finds as you explore (#1869, explore-finds.ts): a ui feature, on unless switched off in the features panel. */
const findsOn = (): boolean => uiFeatureOn(loadChoices(), FINDS_FEATURE);
/** Runs whose first view this visit has claimed (storage may refuse, start-land.ts `claimStartLand`). */
const startClaimed = new Set<string>();
/** This run started on LAND: claimed now, or on an earlier visit. */
const startedOnLand = (id: string): boolean => startClaimed.has(id) || startLandUsed(id);
/**
 * Explore was tapped on the note and waits for PLAN's actions to show: at once, or (with the guide
 * at work) once the first morning's weather card has had its "Got it".
 */
let startPending = false;
/** Explore glows (and its chooser preselects the nearest distance) until the chooser shuts or the tab changes. */
let startHl = false;
/** The draw that opened the chooser for the start: scroll it into view and focus its distance. */
let startScroll = false;
/** The tap that opened it mustn't shut it again (the document's "tap elsewhere" handler runs after). */
let startPickTap = false;

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
    if (tab === 'land' || tab === 'history') render(state);
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
/** The settlement open from the LAND tab's map (its province id), and the building last tapped in it. */
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

/** Who holds a square's province, and what the province remembers (for the map's square info; history-view.ts, #1711). */
function provinceInfo(a: AppState, x: number, y: number): string {
  const r = reachFor(a.sim.character.id);
  const provinces = provincesFor(a.sim.character.id);
  const p = provinces.list[provinces.at[y * r.w + x]];
  const h = chronicleFor(a.sim.character.id)?.provinces.find(q => q.id === p.id);
  return provinceInfoView(p.name, cultureName(p.culture), h ?? null, t);
}

/** The world the LAND tab's map last drew: a new run is a new Reach, so its open settlement and tapped square go. */
let mapSeed: number | null = null;

/**
 * The LAND tab (#1730, land-view.ts), with the map drawn from this page's cached Reach and the square
 * last tapped (map-view.ts): the Reach map below the rings with the descriptive-map switch off, your
 * own map at the top once drawn. A settlement entered from the map opens in its place.
 */
function landBody(a: AppState): string {
  const mode = mapMode(a.sim);
  // How LAND is drawn (#1835, #1836): ui features, the viewer's own, so they switch live.
  const news = landNewsNow(a.sim);
  const look = { news, assess: uiFeatureOn(loadChoices(), LAND_ASSESS_FEATURE), foundOnly: uiFeatureOn(loadChoices(), LAND_FOUND_FEATURE), queue: a.queue,
    // The start's note on day 1 (#1853): its Explore button stands in for #1836's.
    startNote: startLandOn() ? startNoteBlock(a.sim, t) : '' };
  if (mode === 'described') return landTab(a.sim, t, pinRing, look);
  const r = reachFor(a.sim.character.id);
  if (mapSeed !== r.seed) { mapSeed = r.seed; mapSettlement = null; settlementPick = null; mapCell = null; }
  if (mapSettlement) return settlementView(a, mapSettlement);
  const world = { reach: r, provinces: provincesFor(a.sim.character.id) };
  const ui = { cell: mapCell, provinceInfo: (x: number, y: number) => provinceInfo(a, x, y) };
  return landTab(a.sim, t, pinRing, { ...look, map: mode === 'drawn' ? drawnMapBlock(a.sim, t, ui, world) : reachMapSection(a.sim, t, ui, world) });
}

/** The HISTORY tab (#1540), in the viewer's language (history-view.ts, #1711): who holds the Reach now, and the chronicle. */
function historyTab(a: AppState): string {
  const h = chronicleFor(a.sim.character.id);
  if (!h) return historyView(null, null, t);
  const r = reachFor(a.sim.character.id);
  const provinces = provincesFor(a.sim.character.id);
  return historyView(h, provinces.list[provinces.at[r.camp.y * r.w + r.camp.x]].id, t);
}

// ── Blocks (each tab is composed from these) ────────────────────────────────

// ── Carrying (#1296) ────────────────────────────────────────────────────────

/** A piece of carrying gear by name (its recipe's), lower case. */
const gearName = (item: GearItem | 'waterskin'): string => recipeName(item, t).toLowerCase();
const haulText = (h: Haul): string => (Object.keys(h) as (keyof Haul)[]).filter(k => (h[k] ?? 0) > 0).map(k => `${h[k]} ${haulWord(k, t)}`).join(', ');

/**
 * A trip's load bar (#1296): the fill is the bulk of what's carried, the end of the bar is the max you
 * can lift (a hard line), and a tick marks the comfortable load. Green comfortable, amber heavy, red staggering.
 */
/** `guess`: with `forecasts` (#1827), what the Warden expects the trip to bring, in place of the exact haul. */
function loadBar(l: TripLoad, guess?: string): string {
  const left = haulText(l.left);
  // Overload costs only on a walk home (#1292): near camp, a heavy load is just heavy.
  const word = left ? t('load.over', { left }) : t(l.ratio <= 1 ? 'load.ok' : !l.walk ? 'load.near' : l.ratio <= 1.5 ? 'load.heavy' : l.ratio <= 2 ? 'load.stagger' : 'load.barely');
  const cls = left ? 'over' : l.ratio <= 1 || !l.walk ? 'ok' : l.ratio <= 1.5 ? 'heavy' : 'stagger';
  const help = l.wouldHelp.length && (left || (l.ratio > 1 && l.walk)) ? t('load.help', { gear: gearName(l.wouldHelp[0]) }) : '';
  return `<div class="loadrow ${cls}" title="${esc(t('load.tip', { n: Math.round(l.cumbersome), max: Math.round(l.max), c: Math.round(l.comfortable) }))}">`
    + `<span class="lhaul">↩ ${esc(guess ?? haulText(l.haul))}</span>`
    + `<span class="lbar"><span class="lfill" style="width:${pct(l.cumbersome / l.max)}%"></span><span class="lcomf" style="left:${pct(l.comfortable / l.max)}%"></span></span>`
    + `<span class="lword">${esc(word)}${esc(help)}</span></div>`;
}

// The status bar's FOCUS chip and its picker (#1238, #1758) are drawn by focus-popover.ts.

/** Whether the status bar's focus picker is open (#1758): the page's alone, never saved. */
let focusPopOpen = false;

// The eating plan's chip (#1305) and its row in the Warden's view (#1848) are drawn by rations-view.ts.

/** Rations with the Warden (#1848): a ui feature, on unless switched off in the features panel. */
const rationsOn = (): boolean => uiFeatureOn(loadChoices(), RATIONS_FEATURE);
/** The status bar's RATIONS chip: only with the switch off, as before #1848. */
const statusEating = (s: AppState['sim']): string => (rationsPlace(s, rationsOn()) === 'status' ? eatingChip(s, t) : '');
/** The Warden view's Rations row: with the switch on, once the first evening meal is behind you. */
const wardenRations = (s: AppState['sim']): string => (rationsPlace(s, rationsOn()) === 'warden' ? rationsRow(s, t) : '');

/** The first meal's note (#1848) dismissed, per run: this device's, never the save's. */
const rationsNoteKey = (id: string): string => `artificer.rationsNote.${id}`;
function rationsNoteDismissed(id: string): boolean {
  try { return localStorage.getItem(rationsNoteKey(id)) === '1'; } catch { return false; }
}
/** Session fallback when storage is blocked, so OK still hides the note until a reload. */
const rationsNoteGone = new Set<string>();
function dismissRationsNote(id: string): void {
  rationsNoteGone.add(id);
  try { localStorage.setItem(rationsNoteKey(id), '1'); } catch { /* storage blocked: this page remembers it */ }
}
/** The note at the top of PLAN, the morning after the first night, until OK. */
function rationsNoteBlock(a: AppState): string {
  const id = a.sim.character.id;
  return rationsNoteDue(a.sim, rationsOn(), rationsNoteGone.has(id) || rationsNoteDismissed(id)) ? rationsNote(a.sim, t) : '';
}

// The WARDEN tab is drawn by warden-view.ts (#1711).

function journal(a: AppState, limit: number): string {
  // The camp's line (#1691) is added as the journal is drawn, not by the sim: see camp-view.ts.
  // Each line in the viewer's language (#1709, journal-view.ts): the log itself stays the sim's English.
  // A land trip's line links to its ring on the LAND tab (#1730).
  // The first day's look around (#1754) is followed by what lay where that morning.
  const seeLand = (l: { text: string }): string => { const r = tripRing(l.text); return r ? ` ${seeLandLink(r, t)}` : lookAroundLand(a.sim, l, t); };
  // Each land trip's finds as one line after it (#1869, `explore-finds`): this browser's, by the trip's place in the log.
  const log = findsOn() ? withTripLines(a.sim.log, storedTrips(a.sim.character.id), t) : a.sim.log;
  return journalItems(withCampLine(log), limit, 'D', t, seeLand) || `<li style="color:var(--faint);font-style:italic">${esc(firstJournalLine(a.sim, t))}</li>`;
}

/**
 * In one-at-a-time play (#1730): what the land trip just made turned up in its ring (the new places
 * and chips, against what the viewer last saw on the LAND tab), with the link there. A land trip
 * that turned up nothing new still gets the link; any other line, nothing.
 */
function lastTripNews(a: AppState): string {
  const s = a.sim;
  // The trip's own line can be followed by others (a milestone, a find): the last line of work (it carries its hour) is the one.
  const act = [...s.log].reverse().find(l => l.at);
  const r = act && act.day === s.day ? tripRing(act.text) : null;
  if (!r) return '';
  return tripNews(s, r, landNews(s, storedSeen(s.character.id)), t) || `<p style="margin:0 0 8px">${seeLandLink(r, t)}</p>`;
}

/** What the LAND tab marks new on this visit (#1730): kept while the viewer stays on the tab, so a redraw doesn't clear it. */
let landVisit: { id: string; news: LandNews } | null = null;

/** What's new on the land for this visit to the tab; drawing it counts as the viewer having seen it. */
function landNewsNow(s: AppState['sim']): LandNews {
  const id = s.character.id;
  const fresh = landNews(s, storedSeen(id));
  landVisit = { id, news: landVisit?.id === id ? mergeNews(landVisit.news, fresh) : fresh };
  storeSeen(id, landSeen(s));
  return landVisit.news;
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
      <p class="mood" style="margin:0 0 8px">${queueLocked(a) ? esc(t('queue.locked')) : ''} ${esc(t('queue.tapNow'))}</p>
      ${last ? `<p class="news ${last.kind}">${esc(logText(last, t))}</p>${lastTripNews(a)}` : ''}
      <div class="qtot"><span>${nowTotal(s, t, dev)}</span>${spent ? `<span>${esc(t('queue.spent'))}</span>` : ''}</div>
      <div class="runbar"><button class="btn go" data-cmd="endday" ${s.outcome ? 'disabled' : ''}>${esc(t('btn.endDay'))}</button></div>
    </div>`;
}

function queueBlock(a: AppState, preview: Preview): string {
  const s = a.sim;
  if (!s.canPlan) return oneAtATime(a);
  const resolved = s.outcome !== null;
  // The day planning opened up (#1350): the queue arrives with a glow.
  const fresh = s.log.some(l => l.text === PLANNING_UNLOCKED && l.day >= s.day - 1);
  // The hours, or the time of day in words (#1740, `time-words`, time-view.ts).
  const times = queueTimes(a, preview, t, dev);
  // The queue beside the actions (#1826): each row also carries its compact words, which a narrow
  // column shows instead of the full ones (style.css, a container query on `.planq`). Off, as before.
  const compact = sideQueueOn();
  // Forecasts (#1827): a trip not yet known at its distance shows the card's words on its load row, not the exact haul
  // (the same word as its card: seeded by the run, the day and the trip, not the queue).
  const items = a.queue.map((item, i) => {
    const { id, ring, opts } = parseItem(item);
    const d = preview.dayOffset[i];
    const why = preview.warnings[i];
    // Options are judged against the state this entry would run in (after the ones before it).
    const groups = ACTIONS[id].options?.(preview.before[i], opts, ring) ?? [];
    const needsChoice = groups.some(g => g.value === null);
    const open = groups.length > 0 && (expanded.has(i) || needsChoice);
    // A length left at its usual (#1668) isn't worth a label on the row.
    const chosen = groups.map(g => { const c = g.choices.find(x => x.value === g.value && x.value !== 'usual' && x.value !== 'none' && !(g.key === 'way' && x.value === 'here')); return c ? optionLabel(g, c, t) : ''; }).filter(Boolean).join(' · ');
    const toggle = groups.length ? `<button class="tog" data-toggle="${i}" aria-expanded="${open}" aria-label="${esc(t('queue.options'))}">${open ? '▾' : '▸'}</button>` : '';
    const menu = open ? `<div class="opts">${groups.map(g => `<div class="optgroup"><span class="optlabel">${esc(optionGroupLabel(g, t).toUpperCase())}</span><div class="optchoices">${g.choices.map(c => {
      const note = choiceNote(preview.before[i], g, c, t);
      return `<button class="opt ${g.value === c.value ? 'on' : ''}" data-opt="${i}|${g.key}|${c.value}" ${c.blocked ? 'disabled' : ''} title="${esc(note)}">`
        + `<b>${esc(optionLabel(g, c, t))}</b><span>${esc(note)}</span></button>`;
    }).join('')}</div></div>`).join('')}</div>` : '';
    // The grip (#1743): drag it (mouse, touch or pen) or use the arrow keys on it to move the task.
    // Only the grip takes the drag, so taps on the row's own buttons and scrolling the page still work.
    const grip = a.queue.length > 1 ? `<button class="grip" data-grip="${i}" aria-label="${esc(t('queue.grip', { name: actionName(id, t) }))}" title="${esc(t('queue.gripTip'))}">⋮⋮</button>` : '';
    // Compact (#1826): its words, and ▲ to move it up by a tap (the grip still drags).
    const qc = compact ? compactItemHtml(compactItem(id, ring, !!ACTIONS[id].ringed, queueHours(item, preview.before[i]), ICON[id], t))
      + (i > 0 ? `<button class="qup" data-qup="${i}" aria-label="${esc(t('qc.up', { name: actionName(id, t) }))}">▲</button>` : '') : '';
    return `<li class="${why ? 'skip' : ''} ${open ? 'expanded' : ''}" data-qi="${i}"><div class="row">${grip}${toggle}<span class="dayn${compact && d === 0 ? ' now' : ''}">${esc(d === 0 ? t('queue.today') : t('queue.day', { n: s.day + d }))}</span>${qc}`
      + `<span class="n">${ICON[id]} ${esc(actionName(id, t).toUpperCase())}${ring > 1 ? ` <span class="ringtag">${esc(ringName(ring, t).toUpperCase())}</span>` : ''}</span>`
      + (chosen && !open ? `<span class="chosen">${esc(chosen)}</span>` : '')
      + (why ? `<span class="why">${esc(t('queue.skips', { why: simLine(why, t) }))}</span>` : '')
      // What a remembered place does for this trip (#1380).
      + (!why && ACTIONS[id].ringed && pinNoteText(preview.before[i].pins, id, ring, t) ? `<span class="why pinnote">${esc(pinNoteText(preview.before[i].pins, id, ring, t)!)}</span>` : '')
      // A session of chosen length (#1668): its plan — trips, the haul, what's thinning.
      + (preview.plans[i] ? `<span class="why plan">${esc(simLine(preview.plans[i]!, t))}</span>` : '')
      + (preview.dangers[i] ? `<span class="why danger">⚠ ${esc(simLine(preview.dangers[i]!, t))}</span>` : '')
      // Work that could make an injury worse (#1395).
      + (preview.strains[i] ? `<span class="why strain" title="${esc(t('queue.strainTip'))}">${esc(simLine(preview.strains[i]!, t))}</span>` : '')
      // How it will feel out there (#1364): the dark, the weather, the distance — and what that does to you.
      + (preview.unease[i] ? ((u) => `<span class="why unease u-${preview.unease[i]!.state}" title="${esc(u.tip)}">${esc(u.text)}</span>`)(uneaseText(preview.unease[i]!, t)) : '')
      + `<span class="meta">${esc(times.rows[i])}</span><button class="x" data-x="${i}" aria-label="${esc(t('queue.remove'))}">×</button></div>${preview.loads[i] ? loadBar(preview.loads[i]!, taskCard(s, preview.before[i], id, ring, t)?.text) : ''}${menu}</li>`;
  }).join('');
  const days = a.queue.length ? (preview.dayOffset.at(-1) ?? 0) + 1 : 0;
  const spans = t(days === 1 ? 'queue.spans.one' : 'queue.spans.other', { n: days });
  const tot = compact
    ? `<span class="qfull">${times.total}</span><span class="qfull">${spans}</span><span class="qct">${esc(dayTotal(a, preview))}</span>`
    : `<span>${times.total}</span><span>${spans}</span>`;
  return `<div class="queue ${fresh ? 'fresh' : ''}">
      <p class="eyebrow" style="color:var(--gold);margin-bottom:8px">${esc(t(fresh ? 'head.queueNew' : 'head.queue'))}</p>
      ${times.now ? `<p class="mood timenow" style="margin:0 0 8px">${esc(times.now)}</p>` : ''}
      <ol>${items || `<li class="empty">${esc(times.empty)}</li>`}</ol>
      ${forecastBlock(a, preview, t)}
      <div class="qtot">${tot}</div>
      <div class="runbar"${guide.mark('runDay')}>
        <button class="btn go" data-cmd="day" ${resolved ? 'disabled' : ''}>${esc(t(a.queue.length ? 'btn.runDay' : 'btn.passDay'))}</button>
        <button class="btn" data-cmd="all" ${resolved || !a.queue.length ? 'disabled' : ''}>${esc(t('btn.runAll'))}</button>
        <button class="btn" data-cmd="clear" ${a.queue.length ? '' : 'disabled'}>${esc(t('btn.clear'))}</button>
      </div>${guideTip('runDay')}
    </div>`;
}

/** The compact total (#1826): the day's hours, and when today's plan ends if anything runs today. */
function dayTotal(a: AppState, preview: Preview): string {
  const s = a.sim;
  const today = todayHours(a, preview);
  const runsToday = preview.dayOffset.some((d, i) => d === 0 && !preview.warnings[i]);
  const end = runsToday ? compactEnd(today, timeWordsShown(s, dev) ? partShort(endWords(s.day, today, s.config.calendar), t) : null) : null;
  return compactTotal(today, end, t);
}

/** The phone's strip unfolded (#1826): the page's own, like the weather's fold; a reload starts folded. */
let stripOpen = false;

/** The phone's frozen strip over the actions (#1826, plan-layout.ts queueStrip). */
function stripBlock(a: AppState, preview: Preview): string {
  const s = a.sim;
  if (!s.canPlan) {
    return queueStrip({ items: [], note: t('head.oneThing'), total: compactTotal(s.hoursToday, null, t), open: stripOpen,
      button: { cmd: 'endday', label: t('btn.endDay'), disabled: !!s.outcome } }, t);
  }
  const items = a.queue.map((item, i) => { const { id, ring } = parseItem(item); return compactItem(id, ring, !!ACTIONS[id].ringed, queueHours(item, preview.before[i]), ICON[id], t); });
  return queueStrip({ items, note: t('qc.empty'), total: dayTotal(a, preview), open: stripOpen,
    button: { cmd: 'day', label: t(a.queue.length ? 'btn.runDay' : 'btn.passDay'), disabled: s.outcome !== null } }, t);
}

/** Always-visible summary: body, key stores, today's hours, readiness. */
/**
 * Always-visible summary. With the two-row header (#1824), `row2` (the Warden and the three
 * resources) is the sticky bar's top line, so the resources stay in view while the page scrolls, as
 * the bars did, and the frozen queue (#1826, `syncStickTop`) still stops right under it.
 */
function statusBar(a: AppState, preview: Preview, row2 = ''): string {
  const s = a.sim;
  const mini = (label: string, cur: number, cap: number, max: number): string => {
    const b = band(cap > 0 ? cur / cap : 0);
    return `<span class="mini"><span class="ml">${label}</span><span class="mt"><span class="mf ${b}" style="width:${pct(cur / max)}%"></span></span><span class="mv ${b}">${Math.round(cur)}</span></span>`;
  };
  const ready = winterReady(s);
  // The first-morning guide (#1792): with it on, each part arrives when it's of use (vitals and the
  // FOCUS chip after the weather, the stores once something's gathered or the first night is behind
  // you). With it off, or "I've played before", `guide` shows everything and marks nothing: as before.
  const g = guide;
  // The Warden's button shows from the start (#1818), so with the two rows the bar is never empty.
  if (!g.shows('vitals') && !g.shows('focus') && !g.shows('stores')) return row2 ? `<div class="statusbar">${row2}</div>` : '';
  const vitals = g.shows('vitals');
  const focus = g.shows('focus') ? `${markFirst(focusChip(s, t, focusPopOpen, focusUi()), 'focus', 'lock')}${focusPopOpen ? focusPopover(s, t, focusUi()) : ''}` : '';
  // The just-in-time tips (#1794) say their line here too, whatever the tab: the part they're about
  // (an injury's chip, the weather) may be on another tab, or gone again (the injury healed).
  const tips = `${guideTip('vitals')}${guideTip('focus')}${guideTip('stores')}${JIT_TIPS.map(guideTip).join('')}`;
  if (g.active) {
    const stores = g.shows('stores');
    return `<div class="statusbar">${row2}
    ${vitals && !twoRowOn() ? `<div class="minis"${g.mark('vitals')}>${mini(t('status.vig'), s.vitals.vigor.current, s.vitals.vigor.cap, CAP_CEIL)}${mini(t('status.cla'), s.vitals.clarity.current, s.vitals.clarity.cap, CAP_CEIL)}${mini(t('status.res'), s.vitals.condition, 100, 100)}</div>` : ''}
    ${stores ? markFirst(storesBar(a), 'stores') : ''}
    ${focus}${stores ? statusEating(s) : ''}${vitals ? `${nightChip(s)}${painChip(s)}${markFirst(injuryChips(s), 'injury')}
    ${twoRowOn() ? '' : `<span class="shours">${esc(t('status.today'))} <b>${queueTimes(a, preview, t, dev).status}</b></span>`}` : ''}
    ${g.shows('focus') ? outlookTag(s, ready) : ''}
  </div>${tips}`;
  }
  return `<div class="statusbar">${row2}
    ${twoRowOn() ? '' : `<div class="minis">${mini(t('status.vig'), s.vitals.vigor.current, s.vitals.vigor.cap, CAP_CEIL)}${mini(t('status.cla'), s.vitals.clarity.current, s.vitals.clarity.cap, CAP_CEIL)}${mini(t('status.res'), s.vitals.condition, 100, 100)}</div>`}
    ${storesBar(a)}
    ${focusChip(s, t, focusPopOpen, focusUi())}${focusPopOpen ? focusPopover(s, t, focusUi()) : ''}${statusEating(s)}${nightChip(s)}${painChip(s)}${injuryChips(s)}
    ${twoRowOn() ? '' : `<span class="shours">${esc(t('status.today'))} <b>${queueTimes(a, preview, t, dev).status}</b></span>`}
    ${outlookTag(s, ready)}
  </div>`;
}

/** The status bar's compact stores (#1675): icon and count, no name beside it. */
function storesBar(a: AppState): string {
  const s = a.sim;
  const st = s.stores;
  // The compact stores (#1675): icon and count, no name beside it, so the icon carries the name as
  // its alt (and title, for a hover); the old emoji stays as the fallback.
  const sIcon = (id: keyof typeof st, emoji: string, name: string): string => {
    const img = itemIcon(id, { alt: name });
    return img ? img.replace('<img ', `<img title="${esc(name)}" `) : emoji;
  };
  return `<div class="sstores"><span class="${st.rawFood < 1 ? 'low' : ''}">${sIcon('rawFood', '🍖', t('store.rawFood'))}${st.rawFood}${a.sim.deprivation.hungry ? ` <i class="streak" title="${esc(t('status.hungryTip'))}">${esc(t('status.hungry'))} ×${a.sim.deprivation.hungry}</i>` : ''}</span><span class="${st.water < 1 ? 'low' : ''}">${sIcon('water', '💧', t('store.water'))}${st.water}${a.sim.deprivation.thirsty ? ` <i class="streak" title="${esc(t('status.thirstyTip'))}">${esc(t('status.thirsty'))} ×${a.sim.deprivation.thirsty}</i>` : ''}</span><span>${sIcon('firewood', '🪵', t('store.firewood'))}${st.firewood}</span><span>${sIcon('materials', '🪨', t('store.materials'))}${st.materials}</span><span>${sIcon('rations', '🧂', t('store.rations'))}${st.rations}</span></div>`;
}

/** Pain (#1409): what you feel, always — sharper when you've worked through an injury. */
function painChip(s: AppState['sim']): string {
  const p = painOf(s);
  if (!p) return '';
  const tip = painTip(p, t);
  return `<span class="tag pain p-${p}" title="${esc(tip)}">${esc(t('pain.label', { name: t(`pain.${p}`).toUpperCase() }))}</span>`;
}

/** Each open injury (#1395): kind, severity and healing left — in the warning colour when it could get worse. */
function injuryChips(s: AppState['sim']): string {
  // Only what your First aid lets you understand (#1410): pain (its own chip) you always feel.
  const fa = skillLevel(s.skills, 'firstaid');
  return (s.injuries ?? []).map(i => {
    const v = injuryView(i, fa);
    // In the viewer's language (#1709): the chip and its tooltip are built from the injury's parts.
    const { parts, tip } = injuryChip(i, fa, t);
    return `<span class="tag inj${v.severity ? ` sev-${v.severity}` : ''}${v.risk || v.festers ? ' risk' : ''}" title="${esc(tip)}">🩹 ${esc(parts.join(' · '))}</span>`;
  }).join('');
}

/** Tonight, if it looks frightening (#1364): an uneasy or sleepless night, and why. */
function nightChip(s: AppState['sim']): string {
  const f = tonightsFright(s);
  if (!f || f.state === 'calm' || s.outcome) return '';
  return `<span class="tag fear s-${f.state}" title="${esc(nightTip({ state: f.state, perceived: f.perceived, reasons: f.reasons }, t))}">🌑 ${esc(t(f.state === 'shaken' ? 'night.uneasy' : 'night.sleepless'))}</span>`;
}

/** The status bar's verdict: readiness through the autumn; once the snow is down, whether what's laid by reaches the thaw. */
function outlookTag(s: AppState['sim'], ready: boolean): string {
  const season = seasonOf(s.day, s.config.calendar);
  if (season === 'thaw') return '';
  if (season === 'autumn') return `<span class="tag ${ready ? 'yes' : 'no'}">${esc(t(ready ? 'status.ready' : 'status.notReady'))}</span>`;
  const short = outlookWarnings(s, t).length;
  return `<button class="tag ${short ? 'no' : 'yes'}" data-tab="progress" title="${esc(t('status.outlookTip'))}">${esc(t(short ? 'status.short' : 'status.holding'))}</button>`;
}

// The tabs and their order live in feature-choices.ts (APP_TABS), so a test can check them (#1730).
type Tab = AppTab;
const TABS = APP_TABS;
/**
 * Dev mode (#1688, #1735): off until the help panel's faint ⚙ turns it on (with the password, if the
 * build sets one; remembered in this browser), "Leave dev mode" shuts it, and "DEV" shows in the header
 * while it's on. It only shows views: the features panel, the HISTORY tab, the CAMP tab before camp is
 * made, actions' vital costs, and the `?dev=truths` extras. `let`: it flips.
 */
let dev = devMode();
/** The hidden truths (true trust, true skill levels): `?dev=truths`, and only while dev mode is on (#1578). */
let truths = dev && devTruths();

// ── Era looks (#1719) ─────────────────────────────────────────────────────────
// The page's colours and ornaments, one of nine looks (looks.ts). Presentation only: the look is
// worked out each time the page is drawn (`lookOfGame`), never saved. Dev mode can preview any look
// (the picker in the features panel); `?look=<id>` previews one from the address too, in dev mode
// or on a local dev server (`npm run dev`, for screenshots). The preview is this page's alone: a
// reload without `?look` forgets it.
installLooks();
/** The temporary look switcher in the header (#1736): a ui feature, on unless switched off in the features panel. */
const switcherOn = (): boolean => uiFeatureOn(loadChoices(), LOOK_SWITCHER_FEATURE);
/** The Survival path in the FOCUS chip and picker (#1793): a ui feature, on unless switched off in the features panel. */
const focusUi = (): FocusUi => ({ guide: uiFeatureOn(loadChoices(), GUIDE_FEATURE) });
// While the switcher is on, the look chosen with it (or the dev picker) is kept in this browser.
let lookPreview: LookId | null = lookFromQuery(location.search, dev || import.meta.env.DEV) ?? (switcherOn() ? loadLookChoice() : null);

// ── The living backdrop (#1802) ───────────────────────────────────────────────
// The page behind the boxes: the season, today's weather, the time of day, the place and the
// Warden's mood, drawn on a canvas from the state (backdrop.ts says what, backdrop-view.ts draws
// it). A ui feature: off, there's no canvas and the page is exactly as before. Whether it moves is
// the viewer's ("Keep it still" under ?, kept in this browser), and reduced motion always stills it.
const backdropOn = (): boolean => uiFeatureOn(loadChoices(), BACKDROP_FEATURE);
const backdrop = createBackdrop();
let backdropStill = loadStill();
backdrop.setStill(backdropStill);
/** The time of day the backdrop was last drawn at, so the timer's frames redraw it only when that changes. */
let backdropTime: BdTime | null = null;

/** While a day plays on the timer, its clock (and whether its night has come); otherwise the Plan screen's night. */
function backdropUi(): BackdropUi {
  const pl = playing;
  if (!pl) return NO_UI;
  const m = momentOf(pl);
  return { clock: m.clock, night: m.index >= pl.plays[pl.day].steps.length };
}

function drawBackdrop(a: AppState): void {
  if (!backdropOn()) { backdropTime = null; backdrop.show(null); return; }
  const scene = sceneFor(a, backdropUi());
  backdropTime = scene.time;
  backdrop.show(scene);
}

/**
 * Under the help (?), with the switch on: keep the backdrop still (a slow tablet). In the Menu
 * (#1808, `inMeny`) the backdrop's own switch comes first, so it can be turned on there again.
 */
function backdropControls(inMeny = false): string {
  if (inMeny) {
    const on = backdropOn();
    return `<div class="langswitch"><span>${esc(t('backdrop.head'))}</span>`
      + `<button class="pill" data-feature="${BACKDROP_FEATURE}" aria-pressed="${on}">${esc(t(on ? 'dev.featOn' : 'dev.featOff'))}</button>`
      + (on ? `<button class="pill" data-backdrop="still" aria-pressed="${backdropStill}" title="${esc(t('backdrop.stillTip'))}">${esc(t('backdrop.still'))}</button>` : '')
      + '</div>';
  }
  if (!backdropOn()) return '';
  return `<div class="langswitch"><span>${esc(t('backdrop.head'))}</span>`
    + `<button class="pill" data-backdrop="still" aria-pressed="${backdropStill}" title="${esc(t('backdrop.stillTip'))}">${esc(t('backdrop.still'))}</button></div>`;
}

/** Show a look over the game's own (null: the game's), and keep it while the switcher is on. */
function setLookPreview(id: LookId | null): void {
  lookPreview = id;
  if (switcherOn()) saveLookChoice(id);
  render(state);
}
/** The open tab — a per-browser convenience, so storage failures just mean "Plan". */
// Which tabs show depends on the run too (no CAMP tab before camp, #1691), so drawPage settles the
// open tab against what shows each time it draws (`viewToOpen`).
// A kept `warden` opens the Warden's view (#1807): it's no tab in the row now, but the header button opens it.
let tab: Tab = (() => { try { const t = keptTab(localStorage.getItem('artificer.tab')); return (t === 'warden' || TABS.some(x => x.id === t) ? t : 'plan') as Tab; } catch { return 'plan'; } })();
let showHelp = false;

// ── The ⚙ Menu (#1808, meny.ts) ─────────────────────────────────────────────
// A ui feature: on, the header's extra controls and the help panel's settings live on one page
// behind the ⚙, drawn in place of the tab body. Whether it's open is the page's alone, like the
// weather's fold: a redraw (innerHTML) keeps it, a reload starts shut.
const menyOn = (): boolean => uiFeatureOn(loadChoices(), MENY_FEATURE);
/** The queue beside the actions, frozen while they scroll (#1826, plan-layout.ts): a ui feature, so it switches live. */
const sideQueueOn = (): boolean => uiFeatureOn(loadChoices(), SIDE_QUEUE_FEATURE);
let menyOpen = false;
/** "Start a new game" tapped: the Menu asks on the page before the run ends. */
let newGameAsk = false;
/** The run's id was copied (shown beside the button until the Menu shuts). */
let idCopied = false;
const menyShown = (): boolean => menyOpen && menyOn();

function setMeny(open: boolean): void {
  menyOpen = open;
  newGameAsk = false;
  idCopied = false;
  render(state);
  // Into the page's heading on the way in; back to the ⚙ on the way out (the redraw drops focus).
  root.querySelector<HTMLElement>(open ? '#meny-title' : '[data-cmd="meny"]')?.focus({ preventScroll: !open });
}

/** The Menu's page, on the Reach or the road. */
function menyView(a: AppState): string {
  const exp = experimentalOn(featuresOf(a.sim.config.world.features)).map(f => f.name);
  return menyPage({
    newgame: newGameBody({ asking: newGameAsk }, t),
    profile: profileBody({ runId: a.sim.character.id, copied: idCopied }, t),
    language: langSwitch(false),
    guide: guideControls(a, false),
    // How to play (#1824): the old ? panel's text, with the two-row header (which has no ?).
    // With the journal's notes (#1838), a link to them instead: one copy of the text, in the journal.
    howto: howtoBody({ notes: notesOn(), lede: twoRowOn() ? `<p class="lede">${t('help.ledeHtml', { winterDay: a.sim.config.calendar.winterDay })}</p>` : '' }, t),
    visual: `<div class="langswitch">${lookSwitcher(a, true)}</div>${backdropControls(true)}`,
    sound: soundOn() ? soundBody(sound.prefs, t) : '',
    elsewhere: elsewhereBody(t),
    experiments: experimentsBody({ on: exp, dev, controls: `${featuresButton()}${featuresPanel(a)}` }, t),
    developer: menyDevGate(),
  }, t);
}

// ── Ambient sound (#1828, ambience-mix.ts, ambience.ts, sound.ts) ─────────────
// A ui feature: the Menu's Sound section. The engine is made only from a gesture (the Sound on
// toggle, or the first tap for a player who left it on); a redraw only hands it the new mix.
const soundOn = (): boolean => uiFeatureOn(loadChoices(), AMBIENCE_FEATURE);
const sound = new SoundSwitch(createAmbience);
document.addEventListener('click', () => { if (soundOn()) sound.gesture(); }, true);
document.addEventListener('keydown', () => { if (soundOn()) sound.gesture(); }, true);
/** The time of day and the trip's leg the sound was last mixed for, while a day plays out. */
let soundAt = '';

/** The mix for what the page shows: while a day plays out, its clock and whether you're out on the land. */
function updateSound(a: AppState): void {
  if (!soundOn()) { sound.silence(); return; }
  if (!sound.built) return;
  const pl = playing;
  sound.update(mixFor(inputFor(a, { ui: backdropUi(), out: pl ? isOut(pl.plays[pl.day], momentOf(pl)) : false, volume: sound.prefs.volume })));
}

/** The header's controls after the title, with the Menu on or off (meny.ts says which go where). */
function header(p: Omit<HeaderParts, 'dev' | 'features' | 'look' | 'reset' | 'weekly'>, a: AppState): string {
  const on = menyOn();
  return headerControls(on, {
    ...p, dev: devChip(), weekly: weeklyButton(t), features: featuresButton(), look: lookSwitcher(a), reset: newSaveButton(t),
  }, on ? menyButton(menyShown(), t, dev ? devTag() : '') : '');
}

// ── The two-row header (#1824, vital-words.ts) ──────────────────────────────
// A ui feature on top of the Menu: row 1 the place, the day, the ⚙ and feedback; row 2 the Warden
// and the three resources as words (bars from day 8). Off (or with the Menu off), `header` above.
const twoRowOn = (): boolean => menyOn() && uiFeatureOn(loadChoices(), TWO_ROW_FEATURE);

// ── How to play in the journal (#1838, journal-notes.ts) ────────────────────
// A ui feature on top of the Menu: the Warden's own notes at the front of the journal, behind the
// 📖 on each journal box's heading, and no ? in the header. Whether they show is the page's alone:
// null until the player taps the 📖, which means "open while the journal is still empty".
const notesOn = (): boolean => menyOn() && uiFeatureOn(loadChoices(), NOTES_FEATURE);
let notesChosen: boolean | null = null;
/** A journal box's heading (and the notes under it while they show), for the run on screen. */
const jHead = (label: string, style: string, a: AppState, journalEmpty: boolean): string =>
  journalHead(label, style, { on: notesOn(), open: notesShown(notesChosen, journalEmpty), winterDay: a.sim.config.calendar.winterDay }, t);
const LATEST_STYLE = 'color:var(--faint);margin-bottom:7px';

/**
 * The 📖 (or the Menu's link, `fromMeny`): the notes open or shut. From the Menu they open, the
 * Menu shuts, and the journal they're in comes into view: PLAN's LATEST at camp, the road's JOURNAL.
 */
function openNotes(fromMeny: boolean): void {
  const onRoad = state.stage === 'road' && !!state.road;
  const wasOpen = notesShown(notesChosen, !onRoad && state.sim.log.length === 0);
  notesChosen = fromMeny ? true : !wasOpen;
  if (fromMeny) {
    menyOpen = false;
    if (onRoad) roadTab = 'journal';
    else if (tab !== 'plan' && tab !== 'progress') { tab = 'plan'; try { localStorage.setItem('artificer.tab', tab); } catch { /* per-browser convenience only */ } }
  }
  render(state);
  const head = root.querySelector<HTMLElement>(notesChosen ? '#notes-title' : '[data-cmd="notes"]');
  head?.focus({ preventScroll: true });
  if (notesChosen) root.querySelector('#notes')?.scrollIntoView({ block: 'nearest' });
}

/**
 * The whole header, drawn one way or the other: `title` is the h1, `row2` the Warden's row when it
 * goes in the header (the road's, with no status bar) and '' when the status bar carries it (the Reach).
 */
function headerBlock(title: string, p: Omit<HeaderParts, 'dev' | 'features' | 'look' | 'reset' | 'weekly'>, a: AppState, row2: string): string {
  if (!twoRowOn()) return `<header>\n      ${title}\n      <span class="spacer"></span>\n      ${header(p, a)}\n    </header>`;
  return `<header class="tworow">\n    ${headerRows({
    title, counters: p.counters, week: p.week, experiment: p.experiment, feedback: p.feedback,
    row2,
  }, menyButton(menyShown(), t, dev ? devTag() : '', true))}\n    </header>`;
}

/** The three resources as row 2 reads them: each against today's cap, the bars as wide as the old ones. */
const vitalReadings = (s: AppState['sim']): VitalReading[] => [
  { id: 'vigor', current: s.vitals.vigor.current, cap: s.vitals.vigor.cap, max: CAP_CEIL },
  { id: 'clarity', current: s.vitals.clarity.current, cap: s.vitals.clarity.cap, max: CAP_CEIL },
  { id: 'reserve', current: s.vitals.condition, cap: 100, max: 100 },
];

/**
 * Before camp is made (#1691) there's no CAMP tab, but choosing a site is how camp is made, so the
 * site picker sits on the Plan tab until then (with the tools you've made so far, which the Camp tab
 * shows later). Vitals and stores are always in the status bar.
 */
function beforeCamp(a: AppState): string {
  const g = guide;
  if (!g.active) {
    return `<div class="camp-scene" style="margin-top:16px"><p class="eyebrow">${esc(t('head.makeCamp'))}</p>${sitesBlock(a.sim, t)}
    <p class="eyebrow" style="margin-top:14px">${esc(t('head.tools'))}</p>${toolsBlock(a.sim, t)}</div>`;
  }
  // With the guide (#1792): the places to camp once a suitable one is known, the tools once you've made one.
  const sites = g.shows('sites') ? `<div${g.mark('sites')}><p class="eyebrow">${esc(t('head.makeCamp'))}</p>${guideTip('sites')}${sitesBlock(a.sim, t)}</div>` : '';
  const tools = g.shows('tools') ? `<div${g.mark('tools')}><p class="eyebrow" style="margin-top:14px">${esc(t('head.tools'))}</p>${guideTip('tools')}${toolsBlock(a.sim, t)}</div>` : '';
  return sites || tools ? `<div class="camp-scene" style="margin-top:16px">${sites}${tools}</div>` : '';
}

// ── The first-morning guide (#1792, reveal.ts) ──────────────────────────────
// A box on the Plan screen isn't drawn until it can be used; the first time it appears it glows,
// with the scout's line beside it, until "OK" or until it's used. What's been seen and shown is the
// device's (`localStorage`, per run), never the save's. The switch is the `guide` ui
// feature; off, or with "I've played before", the screen is drawn exactly as it was.

/** How the page draws the guide this time: which elements show, which one glows, and the action it suggests. */
interface GuideView {
  /** The guide is at work (switch on, not "played before"): off, everything shows and nothing is marked. */
  active: boolean;
  shows: (id: GuideId) => boolean;
  /** The one element whose line is showing now. */
  tip: GuideId | null;
  /**
   * The element's attributes: what a tap on it dismisses (`data-reveal`, space-separated when one
   * part carries several, as the FOCUS chip does the survival lock's tip), and the glow (`data-glow`).
   * Only the ids revealed now: a part drawn anyway (a chip) isn't marked before its tip is due.
   */
  mark: (...ids: GuideId[]) => string;
  /** The action that glows until a suitable place to camp is known. */
  suggest: ActionId | null;
  /** The weather is shown as the first morning's card: its line not seen yet in this run. */
  weatherIntro: boolean;
}

const GUIDE_OFF: GuideView = { active: false, shows: () => true, tip: null, mark: () => '', suggest: null, weatherIntro: false };
/** Set at the top of each draw (drawPage). */
let guide: GuideView = GUIDE_OFF;
/** The device's guide record (reveal.ts): read once, kept in step with storage. */
let guideRec: GuideRecord = loadGuide();
const guideSwitchOn = (): boolean => uiFeatureOn(loadChoices(), GUIDE_FEATURE);

/** Keep the record, if it changed. */
function keepGuide(next: GuideRecord): void {
  if (next === guideRec) return;
  guideRec = next;
  saveGuide(next);
}

/**
 * The guide for this draw. A run it hasn't met before starts with "I've played before" on when the
 * device has been through the guide (or has runs behind it from before the guide), or when the run
 * is already under way: a save from before the switch shouldn't start hiding its boxes.
 */
function guideView(a: AppState, preview: Preview): GuideView {
  if (!guideSwitchOn() || a.stage === 'road') return GUIDE_OFF;
  const s = a.sim;
  keepGuide(guideFor(guideRec, s.character.id, guideRec.done || history.length > 0 || began(s)));
  const run = guideRec.run!;
  if (run.playedBefore) return GUIDE_OFF;
  // How many days the queue reaches into (#1794): the preview says which day each entry runs on.
  const queueDays = queueReach(preview.dayOffset);
  const ctx = { sim: s, queued: a.queue.length, weatherAcked: run.seen.includes('weather'), queueDays };
  let rec = markSeen(guideRec, usedNow(ctx));
  // A run that started on LAND (#1853) has its LAND tab from the start, kept, and its line read (you've been there).
  if (startedOnLand(s.character.id)) rec = markShown(markSeen(rec, ['land']), ['land']);
  const revealed = revealedNow(ctx, rec.run!.shown);
  rec = markShown(rec, revealed);
  if (guideFinished(s)) rec = markDone(rec);
  keepGuide(rec);
  const tip = activeTip(revealed, rec.run!.seen, false);
  return {
    active: true,
    shows: id => revealed.has(id),
    tip,
    mark: (...ids) => {
      const on = ids.filter(id => revealed.has(id));
      return on.length ? ` data-reveal="${on.join(' ')}"${tip !== null && on.includes(tip) ? ' data-glow' : ''}` : '';
    },
    suggest: suitableSiteKnown(s) || s.outcome ? null : suggestedAction(s),
    weatherIntro: !rec.run!.seen.includes('weather'),
  };
}

/** The scout's line beside an element, while it's the one showing: "OK" dismisses it (the weather's card has its own button). */
function guideTip(id: GuideId): string {
  if (guide.tip !== id) return '';
  const line = REVEALS.find(r => r.id === id)?.line;
  if (!line) return '';
  const ok = id === 'weather' ? '' : `<button class="pill guideok" data-guideok="${id}">${esc(t('guide.ok'))}</button>`;
  return `<div class="guidetip" role="note" aria-label="${esc(t('guide.label'))}"><p>${esc(t(line))}</p>${ok}</div>`;
}

/** An element drawn elsewhere (the FOCUS chip, the stores): the guide's attributes go on its first tag. */
const markFirst = (html: string, ...ids: GuideId[]): string => html.replace(/^(\s*<[a-z]+)/i, `$1${guide.mark(...ids)}`);

/** The just-in-time tips (#1794), whose lines show under the status bar on every tab. */
const JIT_TIPS: readonly GuideId[] = ['injury', 'lock', 'cold', 'snow', 'skill', 'longQueue'];
/** The tabs' lines (#1794) show under the tab bar. */
const TAB_TIPS: readonly GuideId[] = ['camp', 'land', 'progress'];

/** Lines seen: kept, and the page redrawn. Keyboard focus goes to the next line's OK, if one shows. */
function guideSeen(ids: GuideId[]): void {
  keepGuide(markSeen(guideRec, ids));
  render(state);
  root.querySelector<HTMLElement>('[data-guideok]')?.focus({ preventScroll: true });
}

/** Under the help (?), with the switch on: "I've played before" and "Show the guide again". In the Menu (#1808) its section names it. */
function guideControls(a: AppState, label = true): string {
  if (!guideSwitchOn() || a.stage === 'road') return '';
  const played = guideRec.run?.id === a.sim.character.id && guideRec.run.playedBefore;
  return `<div class="langswitch guidectl">${label ? `<span>${esc(t('guide.head'))}</span>` : ''}`
    + `<button class="pill" data-guide="played" aria-pressed="${played}" title="${esc(t('guide.playedBeforeTip'))}">${esc(t('guide.playedBefore'))}</button>`
    + `<button class="pill" data-guide="again" title="${esc(t('guide.againTip'))}">${esc(t('guide.again'))}</button></div>`;
}

// How the weather box is folded (#1788, weather-fold.ts): the first time a big card, then a row of
// icon chips the player can open. Per device, so it's read once here and kept in step with storage.
let wxFold: WeatherFold = loadWeatherFold();
/** Put focus back on the weather toggle after the redraw a keyboard tap caused (innerHTML drops it). */
let wxRefocus = false;

/** The weather box's section on Plan: the first time's card is wider, centred and larger (style.css `.wxintrobox`). */
function weatherSection(a: AppState, preview: Preview): string {
  // With the guide (#1792), the weather is the first morning's first step: the big card, whatever
  // this device's fold says, until it's acknowledged in this run (it replaces #1788's own first time).
  const fold = guide.weatherIntro ? { mode: 'intro' as const, hint: false } : weatherFoldState(wxFold);
  // With the two-row header (#1825), after the first time's card the weather and the time of day
  // share one row (weather-row.ts), which unfolds into the full box; the TODAY chip leaves the
  // status bar. The first time's card is untouched: the guide's next steps wait on its "Got it".
  const box = fold.mode !== 'intro' && twoRowOn() ? weatherOneRow(a, preview, fold) : weatherBox(a.sim, t, { dev, fold });
  // The weather glows for the cold night's tip and the snow's (#1794); their lines are under the status bar.
  return `<section class="box seasonbox${fold.mode === 'intro' ? ' wxintrobox' : ''}"${guide.mark('cold', 'snow')}${guide.tip === 'weather' ? ' data-glow' : ''}>${guideTip('weather')}${box}</section>`;
}

/** The weather and the time of day in one row (#1825), the full box under it while it's open. */
function weatherOneRow(a: AppState, preview: Preview, fold: { mode: string; hint: boolean }): string {
  const s = a.sim;
  const blizzard = s.config.world.weather === 'seeded' && isBlizzard(s.weatherToday, s.day, s.config.calendar);
  return weatherRow({
    chips: weatherChips(s, t, { dev }),
    // The TODAY chip's own text (the part of the day the plan ends in, or the hours): plain words and
    // digits, so the row escapes it as text.
    time: queueTimes(a, preview, t, dev).status,
    open: fold.mode === 'open', hint: fold.hint,
    banner: blizzard ? `<p class="lockbanner">${esc(t('season.blizzard', { n: BLIZZARD_HOURS }))}</p>` : '',
    // Open, the box as it's drawn unfolded, without its own heading's toggle (the row is the toggle).
    details: weatherBox(s, t, { dev }),
  }, t);
}

/** The Plan tab with the guide at work (#1792): each box once it can be used, in the order of the first morning. */
function guidedPlan(a: AppState, preview: Preview): string {
  const g = guide;
  const s = a.sim;
  const actions = g.shows('actions')
    ? `<section class="box"${g.mark('actions')}><p class="eyebrow">${esc(t(s.canPlan ? 'head.actionsQueue' : 'head.actionsNow'))}</p>${guideTip('actions')}${paletteBlock(a, preview, { ...paletteOpts(s), suggest: startHl ? startTarget().highlight : g.suggest })}</section>`
    : '';
  const qid: GuideId = s.canPlan ? 'queue' : 'today';
  const queue = g.shows(qid) ? `<div${g.mark(qid, 'longQueue')}>${guideTip(qid)}${queueBlock(a, preview)}</div>` : '';
  // The notes opened on purpose (#1838) show the journal box even before the guide reveals it.
  const log = journalBoxShown(g.shows('journal'), notesOn(), notesChosen) ? `<div class="log"${g.mark('journal')}>${jHead(t('head.latest'), LATEST_STYLE, a, s.log.length === 0)}${guideTip('journal')}<ul>${journal(a, 6)}</ul></div>` : '';
  const camp = hasCamp(s) ? '' : beforeCamp(a);
  const strip = queue && sideQueueOn() ? stripBlock(a, preview) : '';
  return planLayout({ actions, queue, journal: log, camp, strip, stripOpen }, sideQueueOn(), t);
}

function tabBody(a: AppState, preview: Preview): string {
  switch (tab) {
    case 'plan':
      // The first meal's note (#1848) sits under the weather, at the top of the day's plan.
      if (guide.active) return `${weatherSection(a, preview)}${rationsNoteBlock(a)}${guidedPlan(a, preview)}`;
      return `${weatherSection(a, preview)}${rationsNoteBlock(a)}${planLayout({
        actions: `<section class="box"><p class="eyebrow">${esc(t(a.sim.canPlan ? 'head.actionsQueue' : 'head.actionsNow'))}</p>${paletteBlock(a, preview, paletteOpts(a.sim))}</section>`,
        queue: queueBlock(a, preview),
        journal: `<div class="log">${jHead(t('head.latest'), LATEST_STYLE, a, a.sim.log.length === 0)}<ul>${journal(a, 6)}</ul></div>`,
        camp: hasCamp(a.sim) ? '' : beforeCamp(a),
        strip: sideQueueOn() ? stripBlock(a, preview) : '',
        stripOpen,
      }, sideQueueOn(), t)}`;
    case 'camp':
      return `<div class="cols">
        <section class="box"><p class="eyebrow">${esc(t('head.warden'))}</p>${vitalsBlock(a.sim, t)}
          <p class="eyebrow" style="margin-top:14px">${esc(t('head.stores'))}</p>${storesRow(a.sim, t)}${markFirst(coldBlock(a.sim, t), 'cold')}${meatBlock(a.sim, t)}${nightBlock(a.sim, t, { dev })}
          <p class="eyebrow" style="margin-top:14px">${esc(t('head.tools'))}</p>${toolsBlock(a.sim, t)}</section>
        <section class="box camp-scene"><p class="eyebrow">${esc(t('head.site'))}</p>${sitesBlock(a.sim, t)}</section>
      </div>`;
    case 'land':
      return landBody(a);
    case 'history':
      return historyTab(a);
    case 'warden':
      return wardenTab(a, t, truths, wardenRations(a.sim));
    case 'progress':
      return progressTab(a.sim, history, journal(a, 200), t, jHead(t('head.journal'), LATEST_STYLE, a, a.sim.log.length === 0));
  }
}

function resolvePanel(a: AppState): string {
  const s = a.sim;
  if (s.outcome) {
    return `<div class="resolve">${outcomeCard(a, history[0], t)}${recordBox(a)}`
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
  // The feedback panel (#1773) sits outside the root: told the page changed, so what it would attach is current.
  feedback.refresh();
}

/** How many times the page has been drawn: lets a handler tell whether a tap already redrew it. */
let draws = 0;

function drawPage(a: AppState): void {
  draws += 1;
  t = distanceT(a.sim, baseT);
  // Start telling this run's history in the background if it isn't told yet (#1540). On the road
  // too: its people answer from it (#1656), so a run reloaded there needs it back.
  chronicleFor(a.sim.character.id);
  applyLook(shownLook(lookOfGame(a), lookPreview));
  // The scene behind the boxes (#1802): redrawn only when what it shows has changed (backdrop-view.ts).
  drawBackdrop(a);
  updateSound(a);
  if (a.stage === 'road' && a.road) { guide = GUIDE_OFF; renderRoad(a, a.road); return; }
  const preview = previewQueue(a);
  // The first-morning guide (#1792): what this draw shows, worked out once for every block.
  guide = guideView(a, preview);
  // The winter look (#1308): the panels frost over as the snow deepens.
  const winter = seasonOf(a.sim.day, a.sim.config.calendar) === 'winter';
  root.classList.toggle('winter', winter);
  root.style.setProperty('--snow', String(winter ? Math.max(0.25, a.sim.snowDepth ?? 0) : 0));
  const fresh = a.sim.log.length === 0;
  // Which tabs show (#1688, #1691), and the open one settled against them: a CAMP tab kept from an
  // earlier run opens PLAN until this run's camp is made, a kept HISTORY tab PLAN once dev mode is left.
  // With the guide at work (#1794), a tab shows once there's something to do there (reveal.ts).
  const view: TabView = { dev, camp: hasCamp(a.sim), held: guide.active ? heldTabs(TABS.map(d => d.id), guide.shows) : undefined };
  // The Warden's view (#1807) is no tab in the row: nothing holds it back, so a kept one stays open.
  tab = viewToOpen(tab, TABS, view);
  // The start's Explore (#1853): the highlight ends with the chooser or the tab; a pending tap opens
  // the chooser once PLAN's actions are drawn (with the guide, after the weather card's "Got it").
  if (startHl && (tab !== 'plan' || (startTarget().chooser !== null && ringPick !== startTarget().chooser))) startHl = false;
  if (startPending && tab !== 'plan') startPending = false;
  if (startPending && !menyShown() && !a.sim.outcome && (!guide.active || guide.shows('actions'))) {
    const to = startTarget();
    startPending = false;
    startHl = true;
    ringPick = to.chooser;
    startScroll = true;
    startPickTap = true;
    setTimeout(() => { startPickTap = false; }, 0);
  }
  // What's new on the land is judged against what the viewer last saw (#1730): a run's first draw sets that baseline, and leaving the LAND tab ends a visit's marks.
  if (!storedSeen(a.sim.character.id)) storeSeen(a.sim.character.id, landSeen(a.sim));
  if (tab !== 'land') landVisit = null;
  const meny = menyShown();
  const reachWarden = wardenButton({ name: a.sim.character.name, portrait: a.sim.character.portrait, rank: rankName(artificerRank(a.sim, CRAFT_WORLD.concepts), t), open: tab === 'warden' && !meny, data: 'tab', attrs: guide.mark('skill') }, t);
  root.innerHTML = `
    ${headerBlock(`<h1>${t('top.titleHtml')}</h1>`, {
        warden: reachWarden,
        counters: `<span class="counter ctl">${esc(t('top.day'))} <b>${a.sim.day}</b></span>`,
        week: weekChip(a), experiment: '', playAi: playAiLink(t),
        // No ? with the journal's notes (#1838): how to play is the 📖 on the journal.
        help: notesOn() ? '' : `<span class="ctl"><button class="pill" data-cmd="help" aria-pressed="${showHelp}" aria-label="${esc(t('top.help'))}" title="${esc(t('top.help'))}">?</button></span>`,
        feedback: feedback.button(t),
      }, a, '')}
    ${menyOn() ? '' : featuresPanel(a)}
    ${!notesOn() && ((fresh && !guide.active) || showHelp) ? `<div class="ledewrap"><p class="lede">${t('help.ledeHtml', { winterDay: a.sim.config.calendar.winterDay })}</p>${helpExtras(menyOn(), [langSwitch(), guideControls(a), backdropControls(), devGate()])}</div>` : ''}
    ${statusBar(a, preview, twoRowOn() ? wardenRow({ warden: reachWarden, vitals: vitalReadings(a.sim), day: a.sim.day, shown: guide.shows('vitals'), attrs: guide.mark('vitals') }, t) : '')}
    ${resolvePanel(a)}
    <nav class="tabbar" role="tablist">${visibleTabs(TABS, view).map(d => { const gid = TAB_GUIDE[d.id]; return `<button class="tabbtn ${tab === d.id ? 'on' : ''}" role="tab" aria-selected="${tab === d.id}" data-tab="${d.id}"${gid ? guide.mark(gid) : ''}>${esc(t(`tab.${d.id}`))}${tabIsDev(d, view) ? devTag() : ''}</button>`; }).join('')}</nav>${TAB_TIPS.map(guideTip).join('')}
    ${meny ? menyView(a) : tabBody(a, preview)}
    ${encounterModal(a.sim, encounterAfter, a.queue.length, t)}
    ${meetingModal(a.sim, a.meeting, t)}
    ${mapSessionModal(a.sim, mapUi && mapSessionOpen(a.sim) ? mapUi : null, t)}
    ${timerPanel()}`;
  root.classList.toggle('playing', !!playing);
  // The weather toggle just tapped (#1788) keeps the focus, so Enter/Space can tap it again.
  if (wxRefocus) { wxRefocus = false; root.querySelector<HTMLElement>('.wxtoggle')?.focus({ preventScroll: true }); }
  if (playing) {
    tickTimer(playing, performance.now());
    // The newest line in view: lines arrive at the bottom of the timer's list.
    const lines = root.querySelector<HTMLElement>('.timer .tlog');
    if (lines) lines.scrollTop = lines.scrollHeight;
  }
  syncStickTop();
  if (startScroll) {
    startScroll = false;
    const card = root.querySelector<HTMLElement>(`[data-chooser="${startTarget().highlight}"], .act.guide-suggest`);
    card?.scrollIntoView({ block: 'center' });
    root.querySelector<HTMLElement>('.ringpick .rpopt.on:not([disabled])')?.focus({ preventScroll: true });
  }
}

/**
 * Where the PLAN tab's frozen queue column stops (#1826): just under the sticky status bar, whose
 * height changes as it wraps. Measured here, the one place that sets `--stick-top` (style.css has
 * its default), so whatever the header and the bar become, the column follows.
 */
function syncStickTop(): void {
  const bar = root.querySelector<HTMLElement>('.statusbar');
  document.documentElement.style.setProperty('--stick-top', `${(bar?.offsetHeight ?? 0) + 8}px`);
}
window.addEventListener('resize', syncStickTop);

/** The encounter just answered (#1347), shown in the modal until you carry on. */
let encounterAfter: EncounterAfter | null = null;

// ── Drawing your map (#1754, map-learning.ts) ───────────────────────────────
// The session is the page's own until it's done: what's placed is kept while you look away
// ("Later"), and "Draw it" queues the Draw your map action, the move the log records. A reload
// starts the placing again: it's quick, and nothing in the game depends on it.

/** The open session, or null; and what was placed when it was last shut (for this run only). */
let mapUi: MapSessionUi | null = null;
let mapKept: { id: string; session: MapSession } | null = null;

function openMapSession(): void {
  const kept = mapKept?.id === state.sim.character.id ? mapKept.session : NEW_SESSION;
  mapUi = newSessionUi(kept);
  render(state);
  root.querySelector<HTMLElement>('.mapl-place:not([disabled])')?.focus();
}

function closeMapSession(): void {
  if (mapUi) mapKept = { id: state.sim.character.id, session: mapUi.session };
  mapUi = null;
  render(state);
}

/** A tap (or Enter) in the session: pick a place, place it on a square, draw, or shut it. */
function mapTap(d: DOMStringMap): void {
  if (!mapUi && (d.cmd === 'mapsession' || d.q === 'drawmap')) { openMapSession(); return; }
  if (!mapUi) return;
  if (d.cmd === 'mapclose') { closeMapSession(); return; }
  if (d.cmd === 'mapdraw') {
    mapUi = null;
    mapKept = null;
    // The action itself, as any other: queued if you can plan, else done now.
    const q = 'drawmap' as QueueId;
    if (state.sim.canPlan) update(enqueue(state, q)); else playOut([playAct(state, q)], () => ({ do: q }));
    return;
  }
  if (d.mapsel) {
    mapUi = { ...mapUi, selected: d.mapsel, note: null };
    render(state);
    root.querySelector<HTMLElement>('.mapl-cell.cur')?.focus();
    return;
  }
  if (d.mapcell) {
    const [x, y] = d.mapcell.split(',').map(Number);
    const cursor = { x, y };
    if (!mapUi.selected) { mapUi = { ...mapUi, cursor, note: { kind: 'pick' } }; render(state); root.querySelector<HTMLElement>('.mapl-place:not([disabled])')?.focus(); return; }
    const r = placeOn(state.sim, mapUi.session, mapUi.selected, cursor);
    const ok = r.judgement?.ok === true;
    const note: MapSessionUi['note'] = !r.judgement ? null : r.judgement.ok ? { kind: 'right', id: mapUi.selected } : { kind: 'hint', hint: r.judgement.hint };
    // Placed: on to the next place still to put down. A miss keeps the place picked, to try again.
    const next = ok ? unplaced(state.sim, r.session)[0]?.id ?? null : mapUi.selected;
    mapUi = { session: r.session, selected: next, cursor, note };
    render(state);
    root.querySelector<HTMLElement>(ok ? (next ? '.mapl-cell.cur' : '[data-cmd="mapdraw"]') : '.mapl-cell.cur')?.focus();
  }
}

// The session's keyboard: the arrow keys move the square in the grid (a roving tabindex), Escape shuts it.
document.addEventListener('keydown', e => {
  if (!mapUi) return;
  if (e.key === 'Escape') { e.preventDefault(); closeMapSession(); return; }
  if (!e.key.startsWith('Arrow') || !(e.target as HTMLElement).closest('.mapl-grid')) return;
  e.preventDefault();
  mapUi = { ...mapUi, cursor: moveCell(mapUi.cursor, e.key) };
  render(state);
  root.querySelector<HTMLElement>('.mapl-cell.cur')?.focus();
});

// ── Feature switches and dev mode (#1579) ──────────────────────────────────

// `dev` and `truths` are declared beside TABS.
let showFeatures = false;

/** The small DEV tag on a view only dev mode shows (#1688). */
const devTag = (): string => ` <span class="devtag">${esc(t('tab.dev'))}</span>`;

/**
 * The password's SHA-256 (lowercase hex), from the build (#1688): set `VITE_DEV_PASSWORD_HASH` in the
 * Artificer's Vercel project, or in `.env.local` to try dev mode locally (see feature-choices.ts).
 * Unset, dev mode is open to anyone testing (#1735): the ⚙ turns it on with no password.
 */
const DEV_PASSWORD_HASH: string | undefined = import.meta.env.VITE_DEV_PASSWORD_HASH;

/** The dev gate's state: its password field open, and what the last try said (a catalog key, so it follows the language). */
let devGateOpen = false;
let devGateNote: Key | '' = '';

/**
 * The semi-hidden way into dev mode (#1688): a faint ⚙ in the corner of the help panel. Tapping it
 * opens a button that turns dev mode on, or, when the build sets a password (#1735), an in-page
 * password field (the viewer blocks `prompt()`); in dev mode it offers the way out.
 */
function devGate(): string {
  const icon = `<button class="devdot" data-cmd="devgate" aria-expanded="${devGateOpen}" aria-label="${esc(t('dev.label'))}" title="">⚙</button>`;
  if (!devGateOpen) return icon;
  const body = dev
    ? `<span class="faint">${esc(t('dev.on'))}</span> <button class="pill" data-cmd="devleave">${esc(t('dev.leave'))}</button>`
    : !devNeedsPassword(DEV_PASSWORD_HASH)
      ? `<span class="faint">${esc(t('dev.openNote'))}</span> <button class="pill" data-cmd="deventer">${esc(t('dev.enter'))}</button>`
      : `<form class="devform" data-devform><input id="devpw" type="password" autocomplete="off" aria-label="${esc(t('dev.password'))}" placeholder="${esc(t('dev.placeholder'))}">
      <button class="pill" type="submit">${esc(t('dev.unlock'))}</button>${devGateNote ? ` <span class="faint">${esc(t(devGateNote))}</span>` : ''}</form>`;
  return `${icon}<div class="devgate">${body}</div>`;
}

/**
 * The dev gate in the Menu (#1808): the same gate as the help panel's faint ⚙, as a plain button
 * here, since the Menu is where settings are looked for. In dev mode, the way out shows at once.
 */
function menyDevGate(): string {
  if (dev) return `<p class="mood">${esc(t('dev.on'))}</p><div class="menyrow"><button class="pill" data-cmd="devleave">${esc(t('dev.leave'))}</button></div>`;
  const open = `<p class="mood">${esc(t('meny.devNote'))}</p><div class="menyrow"><button class="pill" data-cmd="devgate" aria-expanded="${devGateOpen}">${esc(t('meny.devOpen'))}</button></div>`;
  if (!devGateOpen) return open;
  const body = !devNeedsPassword(DEV_PASSWORD_HASH)
    ? `<span class="faint">${esc(t('dev.openNote'))}</span> <button class="pill" data-cmd="deventer">${esc(t('dev.enter'))}</button>`
    : `<form class="devform" data-devform><input id="devpw" type="password" autocomplete="off" aria-label="${esc(t('dev.password'))}" placeholder="${esc(t('dev.placeholder'))}">
      <button class="pill" type="submit">${esc(t('dev.unlock'))}</button>${devGateNote ? ` <span class="faint">${esc(t(devGateNote))}</span>` : ''}</form>`;
  return `${open}<div class="devgate">${body}</div>`;
}

// ── Language: the switch in help, and the picker before anything else (#1704) ──

/** The help panel's language switch: each language named in itself, so it's findable whatever is showing. */
function langSwitch(label = true): string {
  const pills = LANGS.map(l => `<button class="pill" data-lang="${l}" lang="${l}" aria-pressed="${lang === l}">${esc(makeT(l)('lang.name'))}</button>`).join('');
  return `<div class="langswitch">${label ? `<span>${esc(t('help.language'))}</span>` : ''}${pills}</div>`;
}

/**
 * Change the language: remember it, swap `t`, and redraw whatever is showing. Nothing in the game
 * changes, so there's nothing to save but the choice itself.
 */
function setLang(next: Lang): void {
  lang = next;
  baseT = makeT(next);
  t = baseT;
  storeLang(next);
  document.documentElement.lang = next;
  introEl.setAttribute('aria-label', t('intro.label'));
  render(state);
  // The intro's beats are words in a language now (#1707): tell them again in the new one, where it was.
  if (intro) { intro = { ...intro, beats: introBeats(state.sim, t) }; renderIntro(); }
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
  noteDevRun();
  truths = on && devTruths('');
  roadUi.truths = truths;
  if (!on) { showFeatures = false; if (!switcherOn()) lookPreview = null; }
  devGateOpen = false;
  devGateNote = '';
}

/** Check a typed password against the build's hash; the right one opens dev mode. */
async function tryDevPassword(typed: string): Promise<void> {
  if (await devUnlocks(typed, DEV_PASSWORD_HASH)) setDev(true);
  else devGateNote = DEV_PASSWORD_HASH ? 'dev.wrong' : 'dev.noHash';
  render(state);
}

/** A 🧪 in the header while this run plays with an experimental rule feature: it may change, or go. */
function experimentChip(a: AppState): string {
  const on = experimentalOn(featuresOf(a.sim.config.world.features));
  if (!on.length) return '';
  return `<span class="ctl"><span class="pill exp" title="${esc(t('top.experimentTip', { names: on.map(f => f.name).join(', ') }))}">${esc(t('top.experiment'))}</span></span>`;
}

/** "DEV" in the header while dev mode is on (#1735), so a screenshot or a bug report shows it. */
const devChip = (): string => (dev ? `<span class="ctl"><span class="pill devchip" title="${esc(t('top.devTip'))}">${esc(t('top.dev'))}</span></span>` : '');

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
  return `<section class="box features">${lookPicker(a)}<p class="eyebrow">${esc(t('head.features'))}</p><ul class="flist">${rows}</ul>
    <p class="mood">${t('dev.featuresNoteHtml')}</p>
    <p><button class="pill" data-cmd="devleave">${esc(t('dev.leave'))}</button></p></section>`;
}

/**
 * The look picker (dev mode, #1719): preview any of the nine looks on this page. It changes only
 * what's drawn: the game, its save and its run log never see it. "The game's look" ends the preview.
 */
function lookPicker(a: AppState): string {
  const game = lookOfGame(a);
  const shown = shownLook(game, lookPreview);
  const swatch = (id: LookId): string => `<i class="lookdot" style="background:${LOOKS[id].tokens.panel};border-color:${LOOKS[id].tokens.gold}"></i>`;
  const pills = LOOK_IDS.map(id => `<button class="pill" data-lookpick="${id}" aria-pressed="${lookPreview === id}" title="${id}">${swatch(id)}${esc(t(`look.${id}`))}</button>`).join('');
  const back = `<button class="pill" data-lookpick="game" aria-pressed="${lookPreview === null}">${esc(t('dev.lookGame', { look: t(`look.${game}`) }))}</button>`;
  return `<div class="lookpick"><p class="eyebrow">${esc(t('dev.looksHead'))}</p><div class="lookpills">${back}${pills}</div>
    <p class="mood">${esc(t('dev.lookNote', { look: t(`look.${shown}`) }))}</p></div>`;
}

/**
 * The look switcher (#1736): temporary, for reviewing era looks while the dev password isn't
 * deployed. A compact control in the header: previous, a menu of the nine looks and the game's own,
 * next. Kept in this browser, never in the save; off with the `look-switcher` ui feature.
 */
function lookSwitcher(a: AppState, always = false): string {
  // In the Menu (#1808) the era look is always there to choose; it's kept in this browser while the switcher's switch is on, as before.
  if (!switcherOn() && !always) return '';
  const game = lookOfGame(a);
  const opt = (v: string, label: string, on: boolean): string => `<option value="${v}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const options = opt('game', t('look.game', { look: t(`look.${game}`) }), lookPreview === null)
    + LOOK_IDS.map(id => opt(id, `${id} · ${t(`look.${id}`)}`, lookPreview === id)).join('');
  return `<span class="ctl lookswitch" role="group" aria-label="${esc(t('look.switch'))}" title="${esc(t('look.switch'))}">
    <button class="pill" data-lookstep="-1" aria-label="${esc(t('look.prev'))}">‹</button><span class="lsname">${esc(t('look.label'))}</span><select class="pill" data-lookselect aria-label="${esc(t('look.switch'))}">${options}</select><button class="pill" data-lookstep="1" aria-label="${esc(t('look.next'))}">›</button></span>`;
}

// ── The caravan road (#1252) ────────────────────────────────────────────────

// The Warden's view is opened from the header's icon and name (#1807), not from the tab row.
type RoadTab = 'road' | 'quests' | 'warden' | 'journal';
// Labels come from the catalog (`tab.<id>`).
const ROAD_TABS: readonly Exclude<RoadTab, 'warden'>[] = ['road', 'quests', 'journal'];
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

const roadJournal = (r: RoadState, limit: number): string => journalItems(r.log, limit, 'R', t);

function renderRoad(a: AppState, r: RoadState): void {
  root.classList.remove('winter');
  root.style.setProperty('--snow', '0');
  const body = roadTab === 'quests' ? `<section class="box">${questLog(r, false, t)}</section>`
    : roadTab === 'warden' ? wardenTab(wardenOnRoad(a, r), t, truths)
    // The road's journal carries the 📖 too (the owner: how to play is reachable from every journal).
    : roadTab === 'journal' ? `<section class="box">${jHead(t('head.roadJournal'), '', a, false)}<div class="log" style="border:0;margin:0;padding:0"><ul style="max-height:none">${roadJournal(r, 200)}</ul></div></section>`
    : r.outcome ? `<section class="box"><p class="eyebrow">${esc(t('head.roadLast'))}</p><div class="log" style="border:0;margin:0;padding:0"><ul>${roadJournal(r, 12)}</ul></div></section>` : roadView(r, roadUi, t);
  const meny = menyShown();
  const roadWarden = wardenButton({ name: r.character.name, portrait: r.character.portrait, rank: rankName(artificerRank(wardenOnRoad(a, r).sim, CRAFT_WORLD.concepts), t), open: roadTab === 'warden' && !meny, data: 'rtab' }, t);
  const end = r.outcome ? `${roadEnd(r, t)}<section class="box">${recordBox(a)}</section><div class="runbar" style="margin:12px 0"><button class="btn go" data-cmd="reset" title="${esc(t('btn.newWardenTip'))}">${esc(t('btn.newWarden'))}</button></div>` : '';
  root.innerHTML = `
    ${headerBlock(`<h1>${t('top.roadTitleHtml')}</h1>`, {
        warden: roadWarden,
        counters: `<span class="counter ctl">${esc(t('top.marks'))} <b>${r.marks}</b></span>
      <span class="counter ctl">${esc(t('top.roadDay'))} <b>${Math.min(r.day, ROAD_DAYS)}</b></span>`,
        week: weekChip(a), experiment: experimentChip(a), playAi: '', help: '', feedback: feedback.button(t),
      }, a, twoRowOn() ? wardenRow({ warden: roadWarden, vitals: [], day: r.day, shown: false }, t) : '')}
    ${menyOn() ? '' : featuresPanel(a)}
    ${routeStrip(r, t)}
    ${end}
    ${r.outcome ? '' : `${roadStatus(r, t)}${lastNews(r, t)}`}
    <nav class="tabbar" role="tablist">${ROAD_TABS.map(id => `<button class="tabbtn ${roadTab === id ? 'on' : ''}" role="tab" aria-selected="${roadTab === id}" data-rtab="${id}">${esc(t(`tab.${id}`))}</button>`).join('')}</nav>
    ${meny ? menyView(a) : body}
    ${encounterModal(r as unknown as AppState["sim"], encounterAfter, 0, t)}`;
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

// ── Feedback (#1773) ────────────────────────────────────────────────────────
// The 💬 panel: docked on the right on a desktop, a bottom sheet on a phone, never blocking the
// game (feedback-panel.ts). What it attaches is read from the page when it's shown or sent:
// always the Warden's id and the run's record id, the rest only as the player leaves it ticked.
// The intro beat showing (introWhere), or nothing outside the intro. Kept here, above the panel,
// because the panel may read what it attaches as soon as it's installed (a draft left open).
let introSpot: { stage: string; tab: string } | Record<string, never> = {};
const feedback = installFeedback({
  t: () => t,
  lang: () => lang,
  attachable: () => {
    const a = state;
    const onRoad = a.stage === 'road' && !!a.road;
    const name = (onRoad ? a.road!.character.name : a.sim.character.name) || undefined;
    let save: unknown = null;
    try { save = JSON.parse(serialize(a)) as unknown; } catch { /* nothing to attach */ }
    return {
      wardenId: a.sim.character.id,
      runId: logFor(a)?.sent?.gameId ?? null,
      build: { version: import.meta.env.VITE_GIT_SHA || 'dev', date: import.meta.env.VITE_BUILD_DATE || undefined, path: location.pathname },
      where: {
        seed: seedOf(a.sim.character.id), day: onRoad ? a.road!.day : a.sim.day, runNumber: runNumberFor(history, a.sim.character.id),
        stage: onRoad ? 'road' : 'camp', tab: onRoad ? roadTab : tab,
        // During the intro (#1845): which beat, "intro: pack", so confusing screens can be found.
        ...introSpot,
        look: shownLook(lookOfGame(a), lookPreview), lang, dev,
        features: Object.entries(featuresOf(a.sim.config.world.features)).filter(([, on]) => on).map(([id]) => id),
        viewport: { w: window.innerWidth, h: window.innerHeight },
        device: deviceOf(window.innerWidth, matchMedia('(pointer: coarse)').matches),
      },
      journal: onRoad ? lastJournal(a.road!.log, 'R') : lastJournal(a.sim.log),
      save,
      wardenName: name,
    };
  },
});

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
    if (!(k && k.log?.v === WEB_LOG_VERSION && Array.isArray(k.log.moves) && typeof k.log.start?.id === 'string' && !!k.measures && typeof k.measures === 'object')) return null;
    // The dev mark (#1735) is `true` or absent: anything else stored there is dropped.
    if (k.dev !== true) delete k.dev;
    return k;
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
  noteDevRun(a);
  saveKept();
}

/**
 * Mark this run's log as played in dev mode (#1735) when dev mode is on while the run is still being
 * played: turned on mid-run, a run begun with it on, or a reload with both. Its record then says
 * `dev: true`. Kept beside the log, not in the game or its save: dev mode never changes play.
 */
function noteDevRun(a: AppState = state): void {
  const next = markDev(kept, a, dev);
  if (next !== kept) { kept = next; saveKept(); }
}
// A first visit: a Warden made just now, with nothing behind it.
if (!saved) startLog(state, {}, null);
noteDevRun();

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
  /** The run's log as the day playing began, before its move went in: a stop (#1815) writes its own move in that one's place. */
  keptBefore: Kept | null;
  /** What each step of the day playing turned up, if it was a land trip (#1869, explore-finds.ts); all null with the switch off. */
  finds: (TripFinds | null)[];
  /** When (real ms) each step finished, so its finds come one at a time after it. */
  doneAt: number[];
  /** How many find lines the timer's log last showed, so it's redrawn only when another arrives. */
  shown: number;
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
  const pl: Playing = { plays, moveOf, day: 0, t: 0, last: null, frame: 0, drawn: -1, lock: null, keptBefore: kept, finds: [], doneAt: [], shown: 0 };
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
  pl.keptBefore = kept;
  kept = recordMove(kept, state, p.after, pl.moveOf(p));
  keep(p.after);
  pl.t = 0;
  pl.drawn = -1;
  startFinds(pl);
}

/** A day's finds (#1869): worked out from its steps, and kept for the journal at once, so Skip or leaving keeps them too. */
function startFinds(pl: Playing, done = 0): void {
  const p = pl.plays[pl.day];
  pl.finds = playFinds(p, findsOn());
  // Steps already shown (a stop, #1815, plays the day again from where it was) show their finds whole.
  pl.doneAt = Array.from({ length: done }, () => -Infinity);
  pl.shown = 0;
  if (pl.finds.some(Boolean)) storeTrips(p.before.sim.character.id, p, pl.finds);
}

/** How many of step `i`'s finds have shown by now: the first as it finishes, then one each `FIND_MS`. */
const findsNow = (pl: Playing, i: number, now: number): number => (pl.doneAt[i] === undefined ? 0 : findsShown(findCount(pl.finds[i] ?? null), now - pl.doneAt[i]));
/** Finds still to come (or the last just shown, still being read): the timer waits for them before the day ends. */
const findsPending = (pl: Playing, now: number): boolean =>
  pl.finds.some((f, i) => f && pl.doneAt[i] !== undefined && now - pl.doneAt[i] < (findCount(f) - 1) * FIND_MS + FIND_LINGER_MS);
/** How long the last find stays on the timer before the day's end takes it away (real ms). */
const FIND_LINGER_MS = 1500;
/** Every find line showing now, across the day's steps. */
const findsTotal = (pl: Playing, now: number): number => pl.finds.reduce((n, _f, i) => n + findsNow(pl, i, now), 0);

/**
 * Stop (#1815, `stop-action`): the action running ends now. The day is played again from its
 * morning with that action cut short, and that goes into the game (logged and saved) in place of
 * the day as it was going to be: the rest of the queue stays queued, the night doesn't come, and
 * the days after it in a whole-queue run never start. The timer plays on to the end of the cut
 * action (the walk home), from where it was stopped.
 */
function stopTimer(): void {
  const pl = playing;
  if (!pl) return;
  const p = pl.plays[pl.day];
  const m = momentOf(pl);
  const stop = stopPoint(p, m);
  if (!stop) return;
  const item = p.steps[stop.action].item;
  const cut = p.fromQueue ? playStopped(p.before, stop) : playActStopped(p.before, item, stop.hours);
  if (cut.after === p.before) return;
  const move: WebMove = p.fromQueue ? { plan: p.before.queue, stop } : { do: item, stop: { action: 0, hours: stop.hours } };
  kept = recordMove(pl.keptBefore, p.before, cut.after, move);
  keep(cut.after);
  pl.plays = [cut];
  pl.day = 0;
  pl.moveOf = () => move;
  pl.t = playTimeAt(cut, stop.action, m.frac * p.steps[stop.action].hours);
  pl.drawn = -1;
  startFinds(pl, stop.action);
  render(state);
}

function frame(pl: Playing, now: number): void {
  if (playing !== pl) return;
  if (pl.last !== null) pl.t += ((now - pl.last) * speed) / MS_PER_HOUR;
  pl.last = now;
  let m = momentOf(pl);
  // Each step that's finished starts its finds' clock (#1869).
  for (let i = 0; i < m.done; i++) if (pl.doneAt[i] === undefined) pl.doneAt[i] = now;
  // The finds still coming hold the day's end, so the last of them can be read.
  if (m.over && !findsPending(pl, now)) {
    if (pl.day + 1 >= pl.plays.length) { endTimer(); return; }
    pl.day += 1;
    startDay(pl);
    m = momentOf(pl);
  }
  // A step finished (or the night came): the page catches up, and its lines arrive.
  if (m.index !== pl.drawn) { pl.drawn = m.index; render(state); }
  else tickTimer(pl, now);
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

/** The timer's sheet, along the bottom of the screen: clock, the day's strip, the action's bar, what's happened. */
function timerPanel(): string {
  const pl = playing;
  if (!pl) return '';
  const p = pl.plays[pl.day];
  const m = momentOf(pl);
  const night = m.index >= p.steps.length;
  const days = pl.plays.length > 1 ? t('timer.days', { n: pl.day + 1, total: pl.plays.length }) : '';
  return `<section class="timer${night ? ' night' : ''}" aria-label="${esc(t('timer.label'))}">
    <div class="trow"><span class="tday">${esc(t('timer.day', { n: p.before.sim.day }) + days)}</span><span class="tclock" id="pb-clock">${esc(timerClock(p.before.sim, m.clock, t, dev))}</span>
      <span class="tspeed" role="group" aria-label="${esc(t('timer.speed'))}">${SPEEDS.map(x => `<button class="pill" data-speed="${x}" aria-pressed="${speed === x}">${x}×</button>`).join('')}</span>
      <button class="btn go tskip" data-pbskip title="${esc(t('timer.skipTip'))}">${esc(t('timer.skip'))}</button></div>
    <div class="tstrip" aria-hidden="true"><span class="tsfill" id="pb-day"></span></div>
    <div class="tnow"><span class="tname">${stepName(p, m, t)}</span><span class="tphase" id="pb-phase">${esc(phaseText(p, m, t, dev))}</span><span class="tcount">${night ? '' : `${m.index + 1} / ${p.steps.length}`}</span>${stopPoint(p, m) ? `<button class="btn tstop" data-pbstop title="${esc(t('timer.stopTip'))}">${esc(t('timer.stop'))}</button>` : ''}</div>
    <div class="tbar" role="progressbar" aria-label="${esc(t('timer.action'))}" aria-valuemin="0" aria-valuemax="100"><span class="tfill" id="pb-bar"></span></div>
    <ul class="tlog" id="pb-log" aria-live="polite">${timerLog(pl, performance.now())}</ul>
  </section>`;
}

/**
 * The timer's log: the day's journal lines as each step finishes and, a land trip's, its finds one
 * at a time after them (#1869). With the switch off there are no finds, and it's the lines as before.
 */
function timerLog(pl: Playing, now: number): string {
  const p = pl.plays[pl.day];
  const m = momentOf(pl);
  const night = m.index >= p.steps.length;
  pl.shown = findsTotal(pl, now);
  const lines = pl.finds.some(Boolean) ? timerLines(p, m.done, night, pl.finds, i => findsNow(pl, i, now), t) : linesAt(p, m.done, night).map(log => ({ log }));
  return lines.length
    ? lines.map(l => ('log' in l ? `<li class="${logClass(l.log)}">${esc(logText(l.log, t))}</li>` : `<li class="find">${esc(l.find)}</li>`)).join('')
    : '<li class="wait">…</li>';
}

/** The timer's log redrawn: lines that are already there stay put (so they don't fade in again), and only the new ones are added. */
function patchLog(el: HTMLElement, html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const next = [...tpl.content.children];
  const cur = [...el.children];
  if (cur.length <= next.length && cur.every((c, i) => c.outerHTML === next[i].outerHTML)) for (const n of next.slice(cur.length)) el.appendChild(n);
  else el.innerHTML = html;
}

/** Keep the newest line of the timer's log in view. */
function scrollTimerLog(): void {
  const log = document.getElementById('pb-log');
  if (log) log.scrollTop = log.scrollHeight;
}

/** Each frame: the clock, the bars and the trip's leg, without redrawing the page. */
function tickTimer(pl: Playing, now: number): void {
  const p = pl.plays[pl.day];
  const m = momentOf(pl);
  // The day has played out and waits for its last finds (#1869): nothing left to stop.
  if (m.over) document.querySelector('[data-pbstop]')?.remove();
  // Another find has come (#1869): only the log is redrawn.
  if (findsTotal(pl, now) !== pl.shown) {
    const log = document.getElementById('pb-log');
    if (log) { patchLog(log, timerLog(pl, now)); scrollTimerLog(); }
  }
  const clock = document.getElementById('pb-clock');
  if (clock) clock.textContent = timerClock(p.before.sim, m.clock, t, dev);
  const bar = document.getElementById('pb-bar');
  if (bar) {
    bar.style.width = `${Math.round(m.frac * 1000) / 10}%`;
    bar.dataset.phase = m.phase?.kind ?? '';
    bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(m.frac * 100)));
  }
  const strip = document.getElementById('pb-day');
  if (strip) strip.style.width = `${Math.min(100, Math.max(0, ((m.clock - DAY_START) / DAY_HOURS) * 100))}%`;
  // The backdrop lightens through the day (#1802): redrawn only when the part of the day changes.
  if (backdropTime !== null) {
    const now: BdTime = m.index >= p.steps.length ? 'dusk' : timeAt(p.before.sim.day, m.clock, p.before.sim.config.calendar);
    if (now !== backdropTime) drawBackdrop(shownNow(pl));
  }
  // The sound follows the clock and the walk out and back (#1828): mixed again only when either changes.
  if (sound.built) {
    const at = `${m.index}|${m.phase?.kind ?? ''}|${m.index >= p.steps.length ? 'dusk' : timeAt(p.before.sim.day, m.clock, p.before.sim.config.calendar)}`;
    if (at !== soundAt) { soundAt = at; updateSound(shownNow(pl)); }
  }
  const phase = document.getElementById('pb-phase');
  const text = phaseText(p, m, t, dev);
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
// A name is all BEGIN needs (#1728): fewer talents than allowed, or none, is a choice — each pick
// left unchosen adds to the difficulty multiplier, like a stat point left unspent.
const draftValid = (): boolean => draft.name.trim().length > 0;
/** What's in the pack on the packing screen (#1401): the leader's list for a new Warden, last time's for one carrying on. */
let draftPack: KitId[] = [...SUGGESTED_PACK];
// Which pack sections this viewer has opened or folded (#1727): a per-browser convenience, so
// storage that's blocked or empty just means every section starts as its default.
let packOpen: PackOpen = (() => { try { return readPackOpen(localStorage.getItem(PACK_OPEN_KEY)); } catch { return {}; } })();

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

/**
 * The world the Warden being packed for will start in (#1870): what makeWarden will make from the
 * player's switches when creation is done, so the pack screen offers the list that run will check.
 */
const packWorld = (): { features: Record<string, boolean> } => ({ features: ruleFeatures(loadChoices()) });

function startIntro(): void {
  draft = loadDraft() ?? blankDraft();
  draftPack = [...SUGGESTED_PACK];
  drawnBeat = -1;
  intro = { beats: introBeats(state.sim, t), i: 0 };
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
  introSpot = {};
  document.documentElement.classList.remove('intro-on');
  feedback.refresh();
  // Persist now, so a reload after the intro doesn't play it again — and only now let the draft go:
  // until the game is saved, a reload must bring back the same Warden-to-be (#1266).
  save(state);
  clearDraft();
  // A new Warden's first view (#1853): LAND, once per run, and only before anything has been done.
  if (startLandOn() && !began(state.sim) && claimStartLand(state.sim.character.id, startClaimed)) {
    tab = 'land';
    try { localStorage.setItem('artificer.tab', tab); } catch { /* per-browser convenience only */ }
    render(state);
  }
}

function advanceIntro(): void {
  if (!intro) return;
  if (intro.beats[intro.i].kind === 'create') { if (!draftValid()) return; commitCharacter(); }
  // Off we go (#1401): the pack chosen is the one the run starts with. (Skipping keeps the pack you had.)
  // Applied here too, so skipping the rest of the intro still starts with it; creation packs again (#1666).
  // The beats after it are told again from the run as packed: the compass line (#1846) says what you brought.
  if (intro.beats[intro.i].kind === 'pack') { applyPack(); render(state); intro = { ...intro, beats: introBeats(state.sim, t) }; }
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
  // A pick re-draws the beat; keep the form scrolled where it was (the stats sit below the fold on a phone).
  const scrolled = introEl.querySelector('.beat')?.scrollTop ?? 0;
  introEl.hidden = false;
  // The 💬 button rides along on every beat (#1845), and what the panel attaches says which beat.
  introSpot = introWhere(b);
  document.documentElement.classList.add('intro-on');
  introEl.innerHTML = introHtml({
    beat: b, i: intro.i, count: intro.beats.length, name: state.sim.character.name, t,
    form: b.kind === 'create' ? createForm(draft, t) : b.kind === 'pack' ? packForm(draftPack, t, truths, packOpen, offeredKit(packWorld().features)) : '',
    nextDisabled: b.kind === 'create' && !draftValid(),
    feedback: feedback.button(t),
  });
  feedback.refresh();
  const beatEl = introEl.querySelector('.beat');
  if (beatEl && drawnBeat === intro.i) beatEl.scrollTop = scrolled;
  // On the creation screen, start in the name field (unless a name is already typed).
  if (b.kind === 'create') saveDraft();
  if (b.kind === 'create' && !draft.name) introEl.querySelector<HTMLInputElement>('#wname')?.focus();
  else introEl.querySelector<HTMLButtonElement>('[data-intro="next"]')?.focus();
}

// Tap anywhere to advance (the tablet path); Skip ends it at once. On the creation
// screen only its own controls act, so a stray tap can't skip past your choices.
introEl.addEventListener('click', e => {
  const el = e.target as HTMLElement;
  // The 💬 button (#1845) opens the feedback panel beside the intro, and never counts as a tap to go on.
  if (el.closest('[data-cmd="feedback"]')) { feedback.toggle(); return; }
  const btn = el.closest<HTMLElement>('[data-intro], [data-talent], [data-stat], [data-age], [data-kit], [data-kitcmd], [data-kitgroup], [data-kitfold]');
  // On the creation and packing screens only their own controls act, so a stray tap can't skip past your choices.
  const creating = intro?.beats[intro.i].kind === 'create' || intro?.beats[intro.i].kind === 'pack';
  if (btn?.dataset.age) { draft.age = Number(btn.dataset.age); renderIntro(); return; }
  // A pack section's heading (#1727): fold or open it, and remember that. preventDefault stops the
  // browser toggling the <details> itself; the redraw sets `open` from packOpen instead.
  if (btn?.dataset.kitgroup) {
    e.preventDefault();
    const g = btn.dataset.kitgroup as KitGroup;
    packOpen = { ...packOpen, [g]: !sectionOpen(g, draftPack, packOpen) };
    try { localStorage.setItem(PACK_OPEN_KEY, JSON.stringify(packOpen)); } catch { /* this visit only */ }
    renderIntro(); return;
  }
  // "Open all" / "Close all" above the sections (#1801): every section the other way, remembered the same way.
  if (btn?.dataset.kitfold) {
    packOpen = setAllSections(!allSectionsOpen(draftPack, packOpen));
    try { localStorage.setItem(PACK_OPEN_KEY, JSON.stringify(packOpen)); } catch { /* this visit only */ }
    renderIntro(); return;
  }
  // Packing (#1401): tap to pack or take out; only what fits goes in.
  if (btn?.dataset.kit) {
    const id = btn.dataset.kit as KitId;
    if (draftPack.includes(id)) draftPack = draftPack.filter(x => x !== id);
    else if (validPack([...draftPack, id], packWorld())) draftPack = [...draftPack, id];
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
  // Keys meant for the feedback panel (typing a report, its buttons) or the 💬 button itself
  // (#1845) don't drive the intro: Enter in the report must not skip a screen.
  if ((e.target as HTMLElement).closest?.('.fbpanel, .fbpill, [data-cmd="feedback"]')) return;
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
  // A land trip that turned something up opens its ring on the LAND tab (#1730), even if it was shut.
  for (const r of ringsToOpen(state.sim, next.sim)) setFold(`land.ring.${r}`, true);
  state = next;
  save(state);
  saveKept();
}

// ── The status bar's focus picker (#1758) ───────────────────────────────────

/** The FOCUS chip on the page, if it's drawn. */
const chipEl = (): HTMLElement | null => root.querySelector<HTMLElement>('[data-cmd="focuspop"]');
/** What the keyboard can reach inside the open picker. */
const popTargets = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(`#${FOCUS_POP_ID} button:not([disabled])`)];

/**
 * Open or close the picker and redraw. Opening moves the keyboard into it (the current choice, or
 * the first one, or the close button when they're locked); closing gives it back to the chip.
 */
function setFocusPop(open: boolean): void {
  if (open === focusPopOpen) return;
  focusPopOpen = open;
  render(state);
  if (open) {
    const targets = popTargets();
    (targets.find(b => b.getAttribute('aria-pressed') === 'true') ?? targets.find(b => b.matches('.fchip')) ?? targets[0])?.focus();
  } else chipEl()?.focus();
}

// A tap outside the picker closes it (#1758). The tap still does what it was for (a tab, a button):
// the root's handler has already acted on it by the time it bubbles up here.
document.addEventListener('click', e => {
  if (!focusPopOpen) return;
  const target = e.target as HTMLElement;
  if (target.closest(`#${FOCUS_POP_ID}, [data-cmd="focuspop"]`)) return;
  focusPopOpen = focusPopAfter(true, 'outside');
  render(state);
});

// Esc closes it, and Tab stays inside it while it's open (a light focus trap).
document.addEventListener('keydown', e => {
  if (!focusPopOpen || !root.querySelector(`#${FOCUS_POP_ID}`)) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setFocusPop(focusPopAfter(true, 'escape')); return; }
  if (e.key !== 'Tab') return;
  const targets = popTargets();
  if (!targets.length) return;
  const i = targets.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (i <= 0 ? targets.length - 1 : i - 1) : (i === -1 || i === targets.length - 1 ? 0 : i + 1);
  e.preventDefault();
  targets[next].focus();
}, true);

// The distance chooser (#1814): a tap anywhere else shuts it without queueing, and so does Esc.
// The root's handler below has already acted on the tap (a chosen distance or ✕ shut it already).
document.addEventListener('click', e => {
  if (!ringPick || startPickTap) return;
  if ((e.target as HTMLElement).closest('.ringpick, [data-chooser]')) return;
  closeRingPick(false);
});
document.addEventListener('keydown', e => {
  if (!ringPick || e.key !== 'Escape' || !root.querySelector('.ringpick')) return;
  e.preventDefault();
  closeRingPick(true);
});

// The ⚙ Menu (#1808): Esc shuts it and puts focus back on the ⚙, unless something drawn over it
// (the map session, the distance chooser, the focus picker) takes the Esc first. An Esc inside the
// feedback panel never gets here (the panel stops it).
document.addEventListener('keydown', e => {
  if (!menyShown() || e.key !== 'Escape' || e.defaultPrevented || mapUi || ringPick || focusPopOpen) return;
  e.preventDefault();
  setMeny(false);
});

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
  // The weather box (#1788): "Got it" on the first time's card condenses it; the heading (or, when
  // condensed, anywhere on its row) opens or condenses it. Presentation only, so it acts mid-playback too.
  const wx = (e.target as HTMLElement).closest<HTMLElement>('[data-wxack], [data-wxfold]');
  if (wx) {
    wxFold = wx.dataset.wxack !== undefined ? ackWeather(wxFold) : toggleWeather(wxFold);
    saveWeatherFold(wxFold);
    // With the guide (#1792), acknowledging the weather is the first morning's first step.
    if (wx.dataset.wxack !== undefined && guide.active) keepGuide(markSeen(guideRec, ['weather']));
    wxRefocus = true;
    render(state);
    return;
  }
  // closest() finds the button even when the click lands on a child span.
  const el = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const d = el.dataset;
  // The guide (#1792): a line's OK, and its controls under the help. Presentation only, so mid-day too.
  if (d.guideok) { if (isGuideId(d.guideok)) guideSeen([d.guideok]); return; }
  if (d.guide === 'played') { const on = !(guideRec.run?.playedBefore ?? false); keepGuide(setPlayedBefore(guideRec, on)); render(state); root.querySelector<HTMLElement>('[data-guide="played"]')?.focus(); return; }
  // The backdrop's "Keep it still" (#1802): presentation only, so mid-day too.
  if (d.backdrop === 'still') { backdropStill = !backdropStill; saveStill(backdropStill); backdrop.setStill(backdropStill); render(state); root.querySelector<HTMLElement>('[data-backdrop="still"]')?.focus(); return; }
  // Sound (#1828): presentation only, so mid-day too. Turning it on is the gesture that starts the audio.
  if (d.sound === 'toggle') { sound.toggle(); render(state); root.querySelector<HTMLElement>('[data-sound="toggle"]')?.focus(); return; }
  if (d.guide === 'again') { keepGuide(showGuideAgain(guideRec)); render(state); root.querySelector<HTMLElement>('[data-guide="again"]')?.focus(); return; }
  // The 💬 button (#1773) works at any time, mid-day too: it only opens the panel beside the game.
  if (d.cmd === 'feedback') { feedback.toggle(); return; }
  // The phone's queue strip (#1826): unfold or fold it. Presentation only, so mid-day too.
  if (d.cmd === 'qstrip') { stripOpen = !stripOpen; render(state); root.querySelector<HTMLElement>('[data-cmd="qstrip"]')?.focus({ preventScroll: true }); return; }
  // While the day plays out (#1669), only the timer's own buttons, the tabs and help act: the game
  // already holds the day's end, so a move now would be made from a state the screen isn't showing.
  if (playing) {
    if (d.speed) { setSpeed(parseSpeed(d.speed)); return; }
    if (d.pbskip !== undefined) { skipTimer(); return; }
    if (d.pbstop !== undefined) { stopTimer(); return; }
    // The look switcher (#1736) only redraws; the ⚙ Menu (#1808) opens, shuts and copies, which change nothing in the game.
    if (!d.tab && !d.seeland && d.cmd !== 'help' && d.cmd !== 'notes' && d.cmd !== 'notesopen' && !d.lang && !d.lookstep && d.cmd !== 'meny' && d.cmd !== 'menyclose' && d.cmd !== 'copyid') return;
  }
  // Drawing your map (#1754): the session's own taps, and the action's button opens the session first.
  if (d.mapsel || d.mapcell || d.cmd === 'mapsession' || d.cmd === 'mapdraw' || d.cmd === 'mapclose' || (d.q === 'drawmap' && mapSessionOpen(state.sim))) { mapTap(d); return; }
  // The ⚙ Menu (#1808): open or shut it, and its own buttons.
  if (d.cmd === 'meny' || d.cmd === 'menyclose') { setMeny(d.cmd === 'meny' ? !menyOpen : false); return; }
  // The journal's notes (#1838): the 📖 opens and shuts them; the Menu's link shuts the Menu and
  // opens them in the journal. Presentation only, so mid-day too.
  if (d.cmd === 'notes' || d.cmd === 'notesopen') { openNotes(d.cmd === 'notesopen'); return; }
  if (d.cmd === 'newgame' || d.cmd === 'newgameno') {
    newGameAsk = d.cmd === 'newgame';
    render(state);
    root.querySelector<HTMLElement>(newGameAsk ? '.menyconfirm [data-cmd="reset"]' : '[data-cmd="newgame"]')?.focus();
    return;
  }
  if (d.cmd === 'copyid') {
    const id = state.sim.character.id;
    void navigator.clipboard?.writeText(id).then(() => { idCopied = true; render(state); root.querySelector<HTMLElement>('[data-cmd="copyid"]')?.focus(); }, () => undefined);
    return;
  }
  // A tab (or the Warden's button) leaves the Menu for that view.
  if (d.tab || d.rtab) menyOpen = false;
  // The start note's Explore (#1853): PLAN, with Explore highlighted and its chooser open (drawPage).
  // Before the guide's weather card is acknowledged it waits: the card is at the top, scrolled to.
  if (d.startexplore) {
    menyOpen = false;
    tab = startTarget().tab;
    try { localStorage.setItem('artificer.tab', tab); } catch { /* per-browser convenience only */ }
    startPending = true;
    render(state);
    if (startPending) window.scrollTo({ top: 0 });
    return;
  }
  if (d.tab) { tab = d.tab as Tab; try { localStorage.setItem('artificer.tab', tab); } catch { /* per-browser convenience only */ } render(state); }
  // "See the land →" on a land trip's line (#1730): the LAND tab, open at that ring. Only when tapped:
  // a queued day can run several trips, so the tab never changes on its own.
  else if (d.seeland) {
    const r = Number(d.seeland) as Ring;
    tab = 'land';
    try { localStorage.setItem('artificer.tab', tab); } catch { /* per-browser convenience only */ }
    setFold(`land.ring.${r}`, true);
    render(state);
    root.querySelector(`#land-ring-${r}`)?.scrollIntoView({ block: 'start' });
  }
  else if (d.cmd === 'help') { showHelp = !showHelp; render(state); }
  // The language switch in help (#1704): presentation only, so it's fine mid-day too.
  else if (d.lang) { const l = parseLang(d.lang); if (l) setLang(l); }
  else if (d.cmd === 'features') { showFeatures = !showFeatures; render(state); }
  else if (d.cmd === 'devgate') { devGateOpen = !devGateOpen; devGateNote = ''; render(state); if (devGateOpen) root.querySelector<HTMLInputElement>('#devpw')?.focus(); }
  else if (d.cmd === 'devleave') { setDev(false); render(state); }
  else if (d.cmd === 'deventer') { setDev(true); render(state); }
  // A look preview (#1719): presentation only, so it's fine mid-day too.
  else if (d.lookpick) setLookPreview(LOOK_IDS.find(id => id === d.lookpick) ?? null);
  // The look switcher's previous / next (#1736); focus stays on the button pressed, for the keyboard.
  else if (d.lookstep) { setLookPreview(stepLook(lookPreview, d.lookstep === '-1' ? -1 : 1)); root.querySelector<HTMLElement>(`[data-lookstep="${d.lookstep}"]`)?.focus(); }
  else if (d.feature) {
    // Flip one switch (#1579); a rule feature takes effect at the next new game.
    const choices = loadChoices();
    const f = FEATURES.find(x => x.id === d.feature);
    if (f) {
      saveChoices({ ...choices, [f.id]: !(typeof choices[f.id] === 'boolean' ? choices[f.id] : f.default) });
      if (f.id === LOOK_SWITCHER_FEATURE && !switcherOn()) { saveLookChoice(null); lookPreview = null; }
      render(state);
    }
  }
  // A land action's card (#1814) opens its distance chooser (or shuts it, tapped again); the
  // preselected distance takes the keyboard's focus, so Enter queues it there.
  else if (d.chooser) {
    ringPick = ringPick === d.chooser ? null : d.chooser as ActionId;
    exploreWay = 'here';
    render(state);
    root.querySelector<HTMLElement>(ringPick ? '.ringpick .rpopt.on:not([disabled])' : `[data-chooser="${d.chooser}"]`)?.focus();
  }
  else if (d.cmd === 'ringclose') closeRingPick(true);
  // Explore's compass (#1839): a way picked (tapped again, back to looking around); the distances then queue that way.
  else if (d.way && (WAYS as readonly string[]).includes(d.way)) {
    exploreWay = exploreWay === d.way ? 'here' : d.way as Way;
    render(state);
    root.querySelector<HTMLElement>(`.compass [data-way="${exploreWay}"]`)?.focus();
  }
  // A distance chosen: remembered for this action and Warden, then queued there, or (before
  // planning is learned, #1350) done now, as any tap on an action.
  else if (d.ringpick) {
    const id = d.pickfor as ActionId;
    // Explore that way (#1839): the entry carries its way, as a queued action's options do.
    const q = distanceItem({ q: d.ringpick as QueueId, way: d.pickway as Way | undefined });
    ringDefaults = rememberRing(ringDefaults, state.sim.character.id, id, Number(d.pickring) as Ring);
    saveRingDefaults(ringDefaults);
    ringPick = null;
    exploreWay = 'here';
    if (state.sim.canPlan) { update(enqueue(state, q)); root.querySelector<HTMLElement>(`[data-chooser="${id}"]`)?.focus(); }
    else playOut([playAct(state, q)], () => ({ do: q }));
  }
  // Pins (#1380): list a ring's places, let one go, or weigh it.
  else if (d.pinring) { const r = Number(d.pinring) as Ring; pinRing = pinRing === r ? null : r; render(state); }
  // Game moves go through play(), which writes them in the run's log (#1559); the plan's edits
  // (queueing, options, removing) are the page's own and aren't moves.
  else if (d.forget) play(forget(state, d.forget), { set: { forget: d.forget } });
  else if (d.interest) { const [id, n] = d.interest.split('|'); play(weighPin(state, id, Number(n) as 0 | 1 | 2 | 3), { set: { pin: d.interest } }); }
  // The status bar's focus picker (#1758): the chip toggles it, here on whatever tab is open.
  else if (d.cmd === 'focuspop') { setFocusPop(focusPopAfter(focusPopOpen, 'chip')); }
  else if (d.cmd === 'focuspopclose') { setFocusPop(focusPopAfter(focusPopOpen, 'escape')); }
  else if (d.focus) {
    // Chosen in the status bar's picker (#1758): it closes, and you stay on the tab you were on.
    const fromPop = focusPopOpen && !!el.closest(`#${FOCUS_POP_ID}`);
    if (fromPop) focusPopOpen = focusPopAfter(true, 'pick');
    const f = parseFocus(d.focus); play(chooseFocus(state, f), { set: { focus: focusKey(f) } });
    if (fromPop) chipEl()?.focus();
  }
  else if (d.cmd === 'eat') { const plan = EATING_PLANS[(EATING_PLANS.indexOf(state.sim.eating ?? 'full') + 1) % EATING_PLANS.length]; play(chooseEating(state, plan), { set: { eating: plan } }); }
  // The Warden view's Rations row (#1848): a plan chosen outright, the same move as the chip's.
  else if (d.eat && (EATING_PLANS as readonly string[]).includes(d.eat)) { const plan = d.eat as EatingPlan; play(chooseEating(state, plan), { set: { eating: plan } }); }
  else if (d.cmd === 'rationsok') { dismissRationsNote(state.sim.character.id); render(state); }
  // Before planning is learned (#1350), a tap does the thing now.
  else if (d.q) { const q = d.q as QueueId; if (state.sim.canPlan) update(enqueue(state, q)); else playOut([playAct(state, q)], () => ({ do: q })); }
  else if (d.cmd === 'endday') play(endTheDay(state), { endDay: true });
  else if (d.toggle !== undefined) { const i = Number(d.toggle); if (expanded.has(i)) expanded.delete(i); else expanded.add(i); render(state); }
  // Keep the menu open while choosing (it may have opened only because a choice was missing).
  else if (d.opt) { const [i, key, value] = d.opt.split('|'); expanded.add(Number(i)); update(setOption(state, Number(i), key, value)); }
  else if (d.x !== undefined) { expanded.clear(); update(dequeueAt(state, Number(d.x))); }
  // The compact queue's ▲ (#1826): a tap moves the task up one place, as ↑ on its grip does.
  else if (d.qup !== undefined) {
    const i = Number(d.qup);
    moveTask(i, i - 1, false);
    (root.querySelector<HTMLElement>(`[data-qup="${i - 1}"]`) ?? root.querySelector<HTMLElement>(`[data-grip="${i - 1}"]`))?.focus({ preventScroll: true });
  }
  // Camp as an action (#1732): a camp site's card makes camp there, as an action like any other.
  else if (d.camp) { const item = { q: 'camp' as QueueId, opts: { spot: d.camp } }; if (state.sim.canPlan) update(enqueue(state, item)); else playOut([playAct(state, item)], () => ({ do: item })); }
  else if (d.site) play(settle(state, d.site as SiteId), { set: { site: d.site } });
  // A day run from the plan is logged as that day's plan, as it stood.
  // On the timer (#1669): each day's actions play out, and each day is logged as its plan, as it stood.
  else if (d.cmd === 'day') playOut([playDay(state)], p => ({ plan: p.before.queue }));
  else if (d.cmd === 'all') playOut(playWholeQueue(state), p => ({ plan: p.before.queue }));
  else if (d.cmd === 'clear') update(clearQueue(state));
  // A new Warden (#1455): if this run is over, they find its tools; mid-run or with no run, nothing.
  else if (d.cmd === 'reset') { menyOpen = false; newGameAsk = false; newWarden(); clearDraft(); startIntro(); }
  // This week's world shuts the Menu once it has started (it keeps its own question, #1559).
  else if (d.cmd === 'weekly') void startWeekly().then(started => { if (started && menyOpen) { menyOpen = false; render(state); } });
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

// Using an element the guide revealed (#1792) counts as its line read: a tap anywhere inside it (an
// action, the FOCUS chip, a place to camp, Run the day) dismisses its line, as "OK" would. Caught on
// the way down (capture), so the tap's own redraw already leaves the line out; a tap that redraws
// nothing (on the vitals, say) gets a redraw of its own.
root.addEventListener('click', e => {
  if (!guide.active) return;
  const used: GuideId[] = [];
  for (let n = (e.target as HTMLElement).closest<HTMLElement>('[data-reveal]'); n; n = n.parentElement?.closest<HTMLElement>('[data-reveal]') ?? null) {
    for (const id of (n.dataset.reveal ?? '').split(' ')) if (isGuideId(id)) used.push(id);
  }
  const next = markSeen(guideRec, used);
  if (next === guideRec) return;
  const drawn = draws;
  keepGuide(next);
  // After the tap's own handler (a timeout, not a microtask: those run between listeners).
  setTimeout(() => { if (draws === drawn) render(state); }, 0);
}, true);

// ── Reordering the queue (#1743) ─────────────────────────────────────────────
// Drag a task by its grip (⋮⋮) to a new place. Pointer Events give mouse, touch and pen one code
// path (HTML5 drag-and-drop doesn't work on touch). Pointer capture keeps the moves coming to the
// grip even when the finger leaves it, and `touch-action: none` on the grip alone (style.css)
// stops the browser scrolling the page from there, while the rest of the row scrolls as usual.
// The decisions (where it lands, the gap) are pure, in queue-drag.ts; this only moves pixels.

/** A screen-reader line after a move: one live region kept outside `root`, so redraws don't replace it. */
const queueLive = document.createElement('p');
queueLive.className = 'sr-only';
queueLive.setAttribute('aria-live', 'polite');
document.body.appendChild(queueLive);

/** Move a task and keep the page's own state in step: an open options menu goes with its task. */
function moveTask(from: number, to: number, refocus: boolean): void {
  const next = moveQueued(state, from, to);
  if (next === state) return;
  const open = [...expanded].map(i => followMove(i, from, to));
  expanded.clear();
  open.forEach(i => expanded.add(i));
  const name = actionName(parseItem(state.queue[from]).id, t);
  update(next);
  queueLive.textContent = t('queue.moved', { name, n: to + 1, total: next.queue.length });
  if (refocus) root.querySelector<HTMLElement>(`[data-grip="${to}"]`)?.focus();
}

interface QueueDrag {
  pointerId: number; from: number; to: number; x0: number; y0: number;
  grip: HTMLElement; li: HTMLElement; ol: HTMLElement; rows: HTMLElement[]; rects: RowRect[];
  /** How far the other rows slide to open the gap: the dragged row's height plus the list's gap. */
  step: number;
  /** Past the threshold: until then a press is still a tap. */
  active: boolean;
}
let queueDrag: QueueDrag | null = null;

root.addEventListener('pointerdown', e => {
  const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-grip]');
  if (!grip || playing || queueDrag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const li = grip.closest<HTMLElement>('li[data-qi]');
  const ol = li?.parentElement;
  if (!li || !ol) return;
  // No text selection or native drag from a mouse press on the grip.
  e.preventDefault();
  const rows = [...ol.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.qi !== undefined);
  const rects = rows.map(r => { const b = r.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; });
  const from = Number(li.dataset.qi);
  const gap = parseFloat(getComputedStyle(ol).rowGap) || 0;
  grip.setPointerCapture(e.pointerId);
  queueDrag = { pointerId: e.pointerId, from, to: from, x0: e.clientX, y0: e.clientY, grip, li, ol, rows, rects, step: rects[from].bottom - rects[from].top + gap, active: false };
});

root.addEventListener('pointermove', e => {
  const g = queueDrag;
  if (!g || e.pointerId !== g.pointerId) return;
  if (!g.active) {
    if (!pastThreshold(g.x0, g.y0, e.clientX, e.clientY)) return;
    g.active = true;
    g.li.classList.add('lifted');
    g.ol.classList.add('sorting');
  }
  e.preventDefault();
  const dy = e.clientY - g.y0;
  g.li.style.transform = `translateY(${dy}px)`;
  // Where the dragged row's middle is now decides where it lands.
  const mid = (g.rects[g.from].top + g.rects[g.from].bottom) / 2 + dy;
  g.to = dropIndex(mid, g.rects, g.from);
  g.rows.forEach((r, i) => { if (i !== g.from) r.style.transform = `translateY(${gapShift(i, g.from, g.to, g.step)}px)`; });
});

function endQueueDrag(e: PointerEvent, drop: boolean): void {
  const g = queueDrag;
  if (!g || e.pointerId !== g.pointerId) return;
  queueDrag = null;
  if (g.grip.hasPointerCapture(e.pointerId)) g.grip.releasePointerCapture(e.pointerId);
  g.rows.forEach(r => { r.style.transform = ''; });
  g.li.classList.remove('lifted');
  g.ol.classList.remove('sorting');
  if (drop && g.active && g.to !== g.from && !playing) moveTask(g.from, g.to, false);
}
root.addEventListener('pointerup', e => endQueueDrag(e, true));
root.addEventListener('pointercancel', e => endQueueDrag(e, false));
root.addEventListener('lostpointercapture', e => endQueueDrag(e, false));

// The keyboard (#1743): ↑/↓ on a focused grip, or Alt+↑/↓ anywhere in a queue row, moves the task.
root.addEventListener('keydown', e => {
  if (playing || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  const el = e.target as HTMLElement;
  const onGrip = el.matches('[data-grip]');
  if (!onGrip && !e.altKey) return;
  const li = el.closest<HTMLElement>('.queue li[data-qi]');
  if (!li || (onGrip && (e.ctrlKey || e.metaKey || e.shiftKey))) return;
  e.preventDefault();
  const from = Number(li.dataset.qi);
  moveTask(from, from + (e.key === 'ArrowUp' ? -1 : 1), true);
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
      body: JSON.stringify(submitBody(k, claimOf(localRun(state, k)), ui.name)),
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

// The look switcher's menu (#1736): a choice from the list, by mouse or by the arrow keys.
root.addEventListener('change', e => {
  const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-lookselect]');
  if (!sel) return;
  setLookPreview(LOOK_IDS.find(id => id === sel.value) ?? null);
  root.querySelector<HTMLSelectElement>('select[data-lookselect]')?.focus();
});

// The nickname is kept as it's typed, so a redraw (the achievements coming in) doesn't lose it.
root.addEventListener('input', e => {
  const input = e.target as HTMLInputElement;
  if (input.id === 'runname' && recordUi) recordUi.name = input.value;
  // The volume (#1828): kept, and the mix follows, without a redraw (that would drop the slider mid-drag).
  if (input.dataset.sound === 'volume') { sound.setVolume(Number(input.value) / 100); updateSound(playing ? shownNow(playing) : state); }
});

// A fold opened or shut (#1730, fold.ts): remembered, so the next redraw writes it the same way.
// `toggle` doesn't bubble, so it's caught on its way down (the third argument, capture).
root.addEventListener('toggle', e => {
  const d = e.target as HTMLDetailsElement;
  if (d.dataset?.fold) setFold(d.dataset.fold, d.open);
}, true);

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
