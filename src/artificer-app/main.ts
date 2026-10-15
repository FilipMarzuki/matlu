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
import { repack, CRAFT_WORLD, PLANNING_UNLOCKED, survivalLockOf, ACTIONS, DAY_HOURS, winterReady, tonightsFright, type TripLoad, parseItem, queueHours, type QueueId, type SiteId } from '../artificer/region1';
import { type Ring } from '../artificer/exploration';
import { type GearItem, type Haul } from '../artificer/load';
import { heirloomsOf, runNumberFor, type RunRecord } from '../artificer/legacy';
import { seasonOf } from '../artificer/winter';
import { DAY_START } from '../artificer/clock';
import { CAP_CEIL } from '../artificer/vitality';
import { skillLevel } from '../artificer/skills';
import { introBeats, fillName, type Beat } from './intro';
import { focusKey, parseFocus } from '../artificer/focus';
import { TALENT_PICKS, talentOffer, seedOf, type TalentId } from '../artificer/talents';
import { generateReach, type Reach } from '../artificer/world/reach';
import { provincesOf, type Provinces } from '../artificer/world/provinces';
import { settlementOf, TIER_NAME, type Settlement } from '../artificer/world/settlements';
import { cultureName } from '../artificer/world/peoples';
import { keptHistory, type ReachHistory } from '../artificer/world/history-format';
import { painOf } from '../artificer/pain';
import { injuryView } from '../artificer/injuries';
import { SUGGESTED_PACK, validPack, type KitGroup, type KitId } from '../artificer/kit';
import { DEFAULT_AGE, START_AGES } from '../artificer/growing';
import { DEFAULT_STATS, canRaise, canLower, statEffects, validStats, type Stats, type StatId } from '../artificer/stats';
import { artificerRank } from '../artificer/rank';
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
import { APP_TABS, devMode, devTruths, devPasswordMatches, keptTab, loadChoices, saveChoices, setDevMode, tabIsDev, tabToOpen, visibleTabs, type AppTab, type TabView } from './feature-choices';
import { hasCamp, withCampLine } from './camp-view';
import { journalItems, logClass, logText } from './journal-view';
import { injuryChip, nightTip, painTip, pinNoteText, uneaseText } from './queue-words';
import { ROAD_DAYS, type RoadState } from '../artificer/road';
import { encounterModal, type EncounterAfter } from './encounter-view';
import { wardenTab } from './warden-view';
import { landTab, seeLandLink, tripNews } from './land-view';
import { landNews, landSeen, mergeNews, ringsToOpen, storedSeen, storeSeen, tripRing, type LandNews } from './land-news';
import { drawnMapBlock, reachMapSection } from './map-view';
import { setFold } from './fold';
import { progressTab, outlookWarnings } from './progress-view';
import { historyTab as historyView, provinceInfo as provinceInfoView } from './history-view';
import { meetingModal } from './caravan-view';
import { truthLine } from '../artificer/panic';
import { encounterById, stepOf } from '../artificer/encounters';
import { respondedOn } from '../artificer/journal';
import { choose, carryOn, forget, weighPin, roadChoose, endTheDay, queueLocked, makeWarden, newGame, legacyFor, currentRun, rideCaravan, meetCaravan, meetingChoose, stayBehind, roadAct, roadEndDay, newCharacterId, chooseFocus, chooseEating, recordRun, serializeHistory, deserializeHistory, HISTORY_KEY, enqueue, dequeueAt, clearQueue, setOption, settle, previewQueue, todayHours, serialize, deserialize, SAVE_KEY, type AppState } from './controller';
import { playAct, playDay, playWholeQueue, momentAt, shownAt, linesAt, clockText, parseSpeed, worthPlaying, MS_PER_HOUR, SPEEDS, type DayPlay, type Moment, type Speed } from './playback';
import { inject } from '@vercel/analytics';
import { LANGS, makeT, parseLang, type Key, type Lang, type T } from '../artificer/i18n';
import { pickerNeeded, storedLang, storeLang } from './lang';
import { itemIcon } from './item-icons';
import { esc, hrs, pct, band, portraitEl } from './html';
import { ICON, haulWord, paletteBlock, weatherBox, seasonChip, storesRow, coldBlock, vitalsBlock, sitesBlock, toolsBlock, firstJournalLine, stepName, phaseText, outcomeCard, type Preview } from './camp-blocks';
import { packForm, createForm, sectionOpen, readPackOpen, PACK_OPEN_KEY, type PackOpen } from './opening-view';
import { LOOKS, LOOK_IDS, applyLook, installLooks, lookFromQuery, lookOfGame, shownLook, type LookId } from './looks';
import { actionName, focusName, lockText, optionGroupLabel, optionLabel, rankName, recipeName, ringName, simLine } from './sim-words';

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
let t: T = makeT(lang);
document.documentElement.lang = lang;

// ── Presentation-only data (wording lives here, rules live in the sim) ──────

// ── Rendering ───────────────────────────────────────────────────────────────
// The opening's forms and a day at camp are drawn by opening-view.ts and camp-blocks.ts (#1707),
// in the viewer's language; the helpers (esc, hrs...) are html.ts's.

// The PROGRESS tab (season, outlook, milestones, past runs) is drawn by progress-view.ts (#1711).

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
  const news = landNewsNow(a.sim);
  if (mode === 'described') return landTab(a.sim, t, pinRing, { news });
  const r = reachFor(a.sim.character.id);
  if (mapSeed !== r.seed) { mapSeed = r.seed; mapSettlement = null; settlementPick = null; mapCell = null; }
  if (mapSettlement) return settlementView(a, mapSettlement);
  const world = { reach: r, provinces: provincesFor(a.sim.character.id) };
  const ui = { cell: mapCell, provinceInfo: (x: number, y: number) => provinceInfo(a, x, y) };
  return landTab(a.sim, t, pinRing, { news, map: mode === 'drawn' ? drawnMapBlock(a.sim, t, ui, world) : reachMapSection(a.sim, t, ui, world) });
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
function loadBar(l: TripLoad): string {
  const left = haulText(l.left);
  // Overload costs only on a walk home (#1292): near camp, a heavy load is just heavy.
  const word = left ? t('load.over', { left }) : t(l.ratio <= 1 ? 'load.ok' : !l.walk ? 'load.near' : l.ratio <= 1.5 ? 'load.heavy' : l.ratio <= 2 ? 'load.stagger' : 'load.barely');
  const cls = left ? 'over' : l.ratio <= 1 || !l.walk ? 'ok' : l.ratio <= 1.5 ? 'heavy' : 'stagger';
  const help = l.wouldHelp.length && (left || (l.ratio > 1 && l.walk)) ? t('load.help', { gear: gearName(l.wouldHelp[0]) }) : '';
  return `<div class="loadrow ${cls}" title="${esc(t('load.tip', { n: Math.round(l.cumbersome), max: Math.round(l.max), c: Math.round(l.comfortable) }))}">`
    + `<span class="lhaul">↩ ${esc(haulText(l.haul))}</span>`
    + `<span class="lbar"><span class="lfill" style="width:${pct(l.cumbersome / l.max)}%"></span><span class="lcomf" style="left:${pct(l.comfortable / l.max)}%"></span></span>`
    + `<span class="lword">${esc(word)}${esc(help)}</span></div>`;
}

/** Status-bar focus chip (#1238): the focus, or SURVIVAL in red with the reason when locked. Opens the Warden tab. */
function focusChip(s: AppState['sim']): string {
  const lock = survivalLockOf(s);
  if (lock) return `<button class="focuschip locked" data-tab="warden" title="${esc(t('status.survivalTip'))}">${esc(t('status.focus'))} <b>${esc(t('status.survival'))}</b> <span>${esc(lockText(lock, t))}</span></button>`;
  // Willpower moves the line where focus frays (#1256).
  const below = statEffects(s.character.stats).unreliableBelow;
  const frayed = s.focus && s.vitals.clarity.current < below;
  return `<button class="focuschip ${s.focus ? '' : 'none'}" data-tab="warden" title="${esc(frayed ? t('status.frayedTip', { n: below }) : t('status.focusTip'))}">${esc(t('status.focus'))} <b>${esc(focusName(s.focus, t))}</b>${frayed ? ` <span>${esc(t('status.frayed'))}</span>` : ''}</button>`;
}

/** The eating plan (#1305): tap to cycle full → half → none. */
function eatingChip(s: AppState['sim']): string {
  const plan = s.eating ?? 'full';
  const label = t(plan === 'full' ? 'status.full' : plan === 'half' ? 'status.half' : 'status.none');
  const tip = t(plan === 'full' ? 'status.fullTip' : plan === 'half' ? 'status.halfTip' : 'status.noneTip');
  return `<button class="focuschip ${plan === 'full' ? 'none' : ''}" data-cmd="eat" title="${esc(t('status.tapToChange', { tip }))}">${esc(t('status.rations'))} <b>${esc(label)}</b></button>`;
}

// The WARDEN tab is drawn by warden-view.ts (#1711).

function journal(a: AppState, limit: number): string {
  // The camp's line (#1691) is added as the journal is drawn, not by the sim: see camp-view.ts.
  // Each line in the viewer's language (#1709, journal-view.ts): the log itself stays the sim's English.
  // A land trip's line links to its ring on the LAND tab (#1730).
  const seeLand = (l: { text: string }): string => { const r = tripRing(l.text); return r ? ` ${seeLandLink(r, t)}` : ''; };
  return journalItems(withCampLine(a.sim.log), limit, 'D', t, seeLand) || `<li style="color:var(--faint);font-style:italic">${esc(firstJournalLine(a.sim, t))}</li>`;
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
      <div class="qtot"><span>${esc(t('queue.todayHours'))} <b>${hrs(s.hoursToday, t)} / ${DAY_HOURS}h</b></span>${spent ? `<span>${esc(t('queue.spent'))}</span>` : ''}</div>
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
    const chosen = groups.map(g => { const c = g.choices.find(x => x.value === g.value && x.value !== 'usual' && x.value !== 'none'); return c ? optionLabel(g, c, t) : ''; }).filter(Boolean).join(' · ');
    const toggle = groups.length ? `<button class="tog" data-toggle="${i}" aria-expanded="${open}" aria-label="${esc(t('queue.options'))}">${open ? '▾' : '▸'}</button>` : '';
    const menu = open ? `<div class="opts">${groups.map(g => `<div class="optgroup"><span class="optlabel">${esc(optionGroupLabel(g, t).toUpperCase())}</span><div class="optchoices">${g.choices.map(c => {
      const note = simLine(c.blocked ?? c.note, t);
      return `<button class="opt ${g.value === c.value ? 'on' : ''}" data-opt="${i}|${g.key}|${c.value}" ${c.blocked ? 'disabled' : ''} title="${esc(note)}">`
        + `<b>${esc(optionLabel(g, c, t))}</b><span>${esc(note)}</span></button>`;
    }).join('')}</div></div>`).join('')}</div>` : '';
    return `<li class="${why ? 'skip' : ''} ${open ? 'expanded' : ''}"><div class="row">${toggle}<span class="dayn">${esc(d === 0 ? t('queue.today') : t('queue.day', { n: s.day + d }))}</span>`
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
      + `<span class="meta">${hrs(queueHours(item, preview.before[i]), t)}h</span><button class="x" data-x="${i}" aria-label="${esc(t('queue.remove'))}">×</button></div>${preview.loads[i] ? loadBar(preview.loads[i]!) : ''}${menu}</li>`;
  }).join('');
  const days = a.queue.length ? (preview.dayOffset.at(-1) ?? 0) + 1 : 0;
  return `<div class="queue ${fresh ? 'fresh' : ''}">
      <p class="eyebrow" style="color:var(--gold);margin-bottom:8px">${esc(t(fresh ? 'head.queueNew' : 'head.queue'))}</p>
      <ol>${items || `<li class="empty">${esc(t('queue.empty', { hours: DAY_HOURS }))}</li>`}</ol>
      <div class="qtot"><span>${esc(t('queue.todayHours'))} <b>${hrs(todayHours(a, preview), t)} / ${DAY_HOURS}h</b></span><span>${t(days === 1 ? 'queue.spans.one' : 'queue.spans.other', { n: days })}</span></div>
      <div class="runbar">
        <button class="btn go" data-cmd="day" ${resolved ? 'disabled' : ''}>${esc(t(a.queue.length ? 'btn.runDay' : 'btn.passDay'))}</button>
        <button class="btn" data-cmd="all" ${resolved || !a.queue.length ? 'disabled' : ''}>${esc(t('btn.runAll'))}</button>
        <button class="btn" data-cmd="clear" ${a.queue.length ? '' : 'disabled'}>${esc(t('btn.clear'))}</button>
      </div>
    </div>`;
}

/** Where we are in the season, in a few words (for the header chip): in words until the calendar is earned (#1729, camp-blocks.ts). */
const phaseChip = (a: AppState): string => seasonChip(a.sim, t, { dev });

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
    return img ? img.replace('<img ', `<img title="${esc(name)}" `) : emoji;
  };
  const ready = winterReady(s);
  return `<div class="statusbar">
    <div class="minis">${mini(t('status.vig'), s.vitals.vigor.current, s.vitals.vigor.cap, CAP_CEIL)}${mini(t('status.cla'), s.vitals.clarity.current, s.vitals.clarity.cap, CAP_CEIL)}${mini(t('status.res'), s.vitals.condition, 100, 100)}</div>
    <div class="sstores"><span class="${st.rawFood < 1 ? 'low' : ''}">${sIcon('rawFood', '🍖', t('store.rawFood'))}${st.rawFood}${a.sim.deprivation.hungry ? ` <i class="streak" title="${esc(t('status.hungryTip'))}">${esc(t('status.hungry'))} ×${a.sim.deprivation.hungry}</i>` : ''}</span><span class="${st.water < 1 ? 'low' : ''}">${sIcon('water', '💧', t('store.water'))}${st.water}${a.sim.deprivation.thirsty ? ` <i class="streak" title="${esc(t('status.thirstyTip'))}">${esc(t('status.thirsty'))} ×${a.sim.deprivation.thirsty}</i>` : ''}</span><span>${sIcon('firewood', '🪵', t('store.firewood'))}${st.firewood}</span><span>${sIcon('materials', '🪨', t('store.materials'))}${st.materials}</span><span>${sIcon('rations', '🧂', t('store.rations'))}${st.rations}</span></div>
    ${focusChip(s)}${eatingChip(s)}${nightChip(s)}${painChip(s)}${injuryChips(s)}
    <span class="shours">${esc(t('status.today'))} <b>${hrs(todayHours(a, preview), t)}/${DAY_HOURS}H</b></span>
    ${outlookTag(s, ready)}
  </div>`;
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
 * Dev mode (#1688): off for players; the password in the help panel's faint ⚙ opens it (remembered in
 * this browser), "Leave dev mode" shuts it. It only shows views: the features panel, the HISTORY tab,
 * the CAMP tab before camp is made, actions' vital costs, and the `?dev=truths` extras. `let`: it flips.
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
let lookPreview: LookId | null = lookFromQuery(location.search, dev || import.meta.env.DEV);
/** The open tab — a per-browser convenience, so storage failures just mean "Plan". */
// Which tabs show depends on the run too (no CAMP tab before camp, #1691), so drawPage settles the
// open tab against what shows each time it draws (`tabToOpen`).
let tab: Tab = (() => { try { const t = keptTab(localStorage.getItem('artificer.tab')); return (TABS.some(x => x.id === t) ? t : 'plan') as Tab; } catch { return 'plan'; } })();
let showHelp = false;

/**
 * Before camp is made (#1691) there's no CAMP tab, but choosing a site is how camp is made, so the
 * site picker sits on the Plan tab until then (with the tools you've made so far, which the Camp tab
 * shows later). Vitals and stores are always in the status bar.
 */
function beforeCamp(a: AppState): string {
  return `<div class="camp-scene" style="margin-top:16px"><p class="eyebrow">${esc(t('head.makeCamp'))}</p>${sitesBlock(a.sim, t)}
    <p class="eyebrow" style="margin-top:14px">${esc(t('head.tools'))}</p>${toolsBlock(a.sim, t)}</div>`;
}

function tabBody(a: AppState, preview: Preview): string {
  switch (tab) {
    case 'plan':
      return `<section class="box seasonbox">${weatherBox(a.sim, t, { dev })}</section><div class="plan">
        <section class="box"><p class="eyebrow">${esc(t(a.sim.canPlan ? 'head.actionsQueue' : 'head.actionsNow'))}</p>${paletteBlock(a, preview, { ring: focusRing, dev, t })}</section>
        <section class="box planside">${queueBlock(a, preview)}
          <div class="log"><p class="eyebrow" style="color:var(--faint);margin-bottom:7px">${esc(t('head.latest'))}</p><ul>${journal(a, 6)}</ul></div>${hasCamp(a.sim) ? '' : beforeCamp(a)}</section>
      </div>`;
    case 'camp':
      return `<div class="cols">
        <section class="box"><p class="eyebrow">${esc(t('head.warden'))}</p>${vitalsBlock(a.sim, t)}
          <p class="eyebrow" style="margin-top:14px">${esc(t('head.stores'))}</p>${storesRow(a.sim, t)}${coldBlock(a.sim, t)}
          <p class="eyebrow" style="margin-top:14px">${esc(t('head.tools'))}</p>${toolsBlock(a.sim, t)}</section>
        <section class="box camp-scene"><p class="eyebrow">${esc(t('head.site'))}</p>${sitesBlock(a.sim, t)}</section>
      </div>`;
    case 'land':
      return landBody(a);
    case 'history':
      return historyTab(a);
    case 'warden':
      return wardenTab(a, t, truths);
    case 'progress':
      return progressTab(a.sim, history, journal(a, 200), t);
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
}

function drawPage(a: AppState): void {
  // Start telling this run's history in the background if it isn't told yet (#1540). On the road
  // too: its people answer from it (#1656), so a run reloaded there needs it back.
  chronicleFor(a.sim.character.id);
  applyLook(shownLook(lookOfGame(a), lookPreview));
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
  // What's new on the land is judged against what the viewer last saw (#1730): a run's first draw sets that baseline, and leaving the LAND tab ends a visit's marks.
  if (!storedSeen(a.sim.character.id)) storeSeen(a.sim.character.id, landSeen(a.sim));
  if (tab !== 'land') landVisit = null;
  root.innerHTML = `
    <header>
      <h1>❄ GREYWIND <span class="mark">REACH</span></h1>
      ${phaseChip(a)}
      <span class="spacer"></span>
      ${a.sim.character.name ? `<button class="who" data-tab="warden" title="${esc(t('top.yourWarden'))}">${portraitEl(a.sim.character.portrait, 26)}<span><b>${esc(a.sim.character.name)}</b> · ${esc(rankName(artificerRank(a.sim, CRAFT_WORLD.concepts), t))}</span></button>` : ''}
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
    ${encounterModal(a.sim, encounterAfter, a.queue.length, t)}
    ${meetingModal(a.sim, a.meeting, t)}
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
  truths = on && devTruths('');
  roadUi.truths = truths;
  if (!on) { showFeatures = false; lookPreview = null; }
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

const roadJournal = (r: RoadState, limit: number): string => journalItems(r.log, limit, 'R', t);

function renderRoad(a: AppState, r: RoadState): void {
  root.classList.remove('winter');
  root.style.setProperty('--snow', '0');
  const body = roadTab === 'quests' ? `<section class="box">${questLog(r, false, t)}</section>`
    : roadTab === 'warden' ? wardenTab(wardenOnRoad(a, r), t, truths)
    : roadTab === 'journal' ? `<section class="box"><p class="eyebrow">${esc(t('head.roadJournal'))}</p><div class="log" style="border:0;margin:0;padding:0"><ul style="max-height:none">${roadJournal(r, 200)}</ul></div></section>`
    : r.outcome ? `<section class="box"><p class="eyebrow">${esc(t('head.roadLast'))}</p><div class="log" style="border:0;margin:0;padding:0"><ul>${roadJournal(r, 12)}</ul></div></section>` : roadView(r, roadUi, t);
  const end = r.outcome ? `${roadEnd(r, t)}<section class="box">${recordBox(a)}</section><div class="runbar" style="margin:12px 0"><button class="btn go" data-cmd="reset" title="${esc(t('btn.newWardenTip'))}">${esc(t('btn.newWarden'))}</button></div>` : '';
  root.innerHTML = `
    <header>
      <h1>${t('top.roadTitleHtml')}</h1>
      <span class="spacer"></span>
      ${r.character.name ? `<button class="who" data-rtab="warden" title="${esc(t('top.yourWarden'))}">${portraitEl(r.character.portrait, 26)}<span><b>${esc(r.character.name)}</b> · ${esc(rankName(artificerRank(wardenOnRoad(a, r).sim, CRAFT_WORLD.concepts), t))}</span></button>` : ''}
      <span class="counter ctl">${esc(t('top.marks'))} <b>${r.marks}</b></span>
      <span class="counter ctl">${esc(t('top.roadDay'))} <b>${Math.min(r.day, ROAD_DAYS)}</b></span>
      ${weekChip(a)}
      ${experimentChip(a)}
      <span class="ctl"><button class="pill" data-cmd="weekly" title="${esc(t('top.weekTip'))}">${esc(t('top.week'))}</button></span>
      ${featuresButton()}
      <span class="ctl"><button class="pill" data-cmd="reset">${esc(t('top.newSave'))}</button></span>
    </header>
    ${featuresPanel(a)}
    ${routeStrip(r, t)}
    ${end}
    ${r.outcome ? '' : `${roadStatus(r, t)}${lastNews(r, t)}`}
    <nav class="tabbar" role="tablist">${ROAD_TABS.map(id => `<button class="tabbtn ${roadTab === id ? 'on' : ''}" role="tab" aria-selected="${roadTab === id}" data-rtab="${id}">${esc(t(`tab.${id}`))}</button>`).join('')}</nav>
    ${body}
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
    <div class="tnow"><span class="tname">${stepName(p, m, t)}</span><span class="tphase" id="pb-phase">${esc(phaseText(p, m, t))}</span><span class="tcount">${night ? '' : `${m.index + 1} / ${p.steps.length}`}</span></div>
    <div class="tbar" role="progressbar" aria-label="${esc(t('timer.action'))}" aria-valuemin="0" aria-valuemax="100"><span class="tfill" id="pb-bar"></span></div>
    <ul class="tlog" aria-live="polite">${lines.length ? lines.map(l => `<li class="${logClass(l)}">${esc(logText(l, t))}</li>`).join('') : '<li class="wait">…</li>'}</ul>
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
  const text = phaseText(p, m, t);
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
  const lines = b.lines.map((l, n) => `<p style="--n:${n}">${esc(fillName(l, state.sim.character.name, t))}</p>`).join('')
    + (b.kind === 'create' ? createForm(draft, t) : b.kind === 'pack' ? packForm(draftPack, t, truths, packOpen) : '');
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

// Tap anywhere to advance (the tablet path); Skip ends it at once. On the creation
// screen only its own controls act, so a stray tap can't skip past your choices.
introEl.addEventListener('click', e => {
  const el = e.target as HTMLElement;
  const btn = el.closest<HTMLElement>('[data-intro], [data-talent], [data-stat], [data-age], [data-kit], [data-kitcmd], [data-kitgroup]');
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
  // A land trip that turned something up opens its ring on the LAND tab (#1730), even if it was shut.
  for (const r of ringsToOpen(state.sim, next.sim)) setFold(`land.ring.${r}`, true);
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
    if (!d.tab && !d.seeland && d.cmd !== 'help' && !d.lang) return;
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
  // A look preview (#1719): presentation only, so it's fine mid-day too.
  else if (d.lookpick) { lookPreview = d.lookpick === 'game' ? null : LOOK_IDS.find(id => id === d.lookpick) ?? null; render(state); }
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
