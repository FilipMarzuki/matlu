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
import { createRegion1, survivalLockOf, ACTIONS, SITES, BUILD_COST, DAY_HOURS, REGION1_MILESTONES, readinessInput, warmth, winterReady, routeKnown, parseItem, HIDE_PARKA_RECIPE, DISCOVERIES, queueId, queueHours, type ActionId, type QueueId, type LogEntry, type SiteId } from '../artificer/region1';
import { RINGS, RING_NAME, TRAVEL_HOURS, FINDS, LEVEL_NAME, domainsOf, level, reachable, scouted, tripYield, hasFind, type Domain, type Ring } from '../artificer/exploration';
import { modifiersFor } from '../artificer/crafting';
import { pillars, type PillarKey } from '../artificer/readiness';
import { bestRun, canContinue, runNumberFor, type RunRecord } from '../artificer/legacy';
import { availableChoices, crossingPrepared, phaseOf, CROSSING_NEEDS, type Choice, type OutcomeKind } from '../artificer/winter';
import { BASELINE, CAP_CEIL, morale, type Pool } from '../artificer/vitality';
import { SKILLS, SKILL_IDS, LEVELS, MAX_LEVEL, perceivedProgress, isSupernatural } from '../artificer/skills';
import { TECHNIQUES, manualById, type Technique } from '../artificer/techniques';
import { introBeats, fillName, type Beat, type IntroKind } from './intro';
import { PORTRAITS, portraitById, portraitStyle } from './portraits';
import { GOALS, GOAL_IDS, FOCUS_CONCEPTS, FOCUS_COST, CONCEPT_PER_HOUR, focusLabel, focusKey, parseFocus } from '../artificer/focus';
import { TRAITS, TRAIT_IDS, TRAIT_COUNT, type TraitId } from '../artificer/traits';
import { STATS, STAT_IDS, DEFAULT_STATS, POINT_BUDGET, canRaise, canLower, raiseCost, pointsLeft, statNote, statEffects, validStats, type Stats, type StatId } from '../artificer/stats';
import { artificerRank, conceptRanks } from '../artificer/rank';
import { newGame, newRun, newCharacterId, chooseFocus, recordRun, serializeHistory, deserializeHistory, HISTORY_KEY, enqueue, dequeueAt, clearQueue, setOption, runQueuedDay, runWholeQueue, settle, takeExit, previewQueue, serialize, deserialize, SAVE_KEY, type AppState } from './controller';

// ── Presentation-only data (wording lives here, rules live in the sim) ──────

const GROUPS: { title: string; ids: ActionId[] }[] = [
  { title: 'EXPLORE', ids: ['scout', 'survey', 'track', 'lookout'] },
  { title: 'PROVISION', ids: ['gather', 'hunt', 'water', 'wood', 'quarry', 'preserve'] },
  { title: 'BUILD', ids: ['build', 'coldGear'] },
  { title: 'CRAFT TOOLS', ids: ['knife', 'snare', 'waterskin', 'bedroll', 'shovel'] },
  { title: 'THINK & RECOVER', ids: ['study', 'tinker', 'rest'] },
];

const ICON: Record<ActionId, string> = {
  scout: '🥾', survey: '📐', track: '🐾', gather: '🌿', hunt: '🏹', water: '💧',
  wood: '🪵', quarry: '⛰️', preserve: '🧂', build: '⛺', coldGear: '🧥', tinker: '🛠️', rest: '☕',
  lookout: '🔭', study: '📖', knife: '🔪', snare: '🪤', waterskin: '🫗', bedroll: '🛏️', shovel: '⛏️',
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
  preserve: () => '2 raw → 1 ration · smoke ×3 or dry ×2',
  build: s => (s.tier < 2 ? `tier ${s.tier + 1} from ${BUILD_COST[s.tier as 0 | 1]} mat · choose site & design in the queue` : 'winterized'),
  coldGear: () => 'needed to cross solo · fiber or hide',
  knife: () => 'hunt −15% vigor, quicker preserving',
  snare: () => '+1 food every night',
  waterskin: () => '+1 water per trip · takes a hide',
  bedroll: () => '+6 clarity overnight',
  shovel: () => 'build −20% vigor · needs a roof',
  tinker: () => 'rests body, spends mind',
  rest: () => 'recovers a little',
};

const PILLAR_NAME: Record<PillarKey, string> = { larder: 'LARDER', shelter: 'SHELTER', fuel: 'FUEL', body: 'BODY & MIND' };

const SITE_NOTE: Record<SiteId, string> = {
  cave: 'Dry rock at your back. The warmest ground.',
  tree: 'Windbreak and wood close by (+1 fuel per trip).',
  river: 'Water at hand (+2 per trip), but the damp chills.',
  hill: 'A fine view and nothing to stop the wind.',
};

const OUTCOME: Record<OutcomeKind, { head: string; body: string }> = {
  thrive: { head: 'YOU RIDE OUT WITH THE CARAVAN', body: 'You climb aboard rested and provisioned, trading surplus rations for a corner of the wagon and word of the road ahead. Region 2 opens already half-known to you.' },
  ragged: { head: 'YOU SCRAMBLE ABOARD THE CARAVAN', body: 'You leave a half-built camp behind. The traders share what they can, but you spend the first leg recovering. You reach the next region alive — just thin.' },
  crossed: { head: 'YOU STRIKE OUT ALONE', body: 'Cold gear cinched, rations packed, a route in your head — you walk out into the white. It is brutal and slow, but you make it through on what you built, beholden to no one.' },
  turnedBack: { head: 'THE ROAD TURNS YOU BACK', body: 'You push into the winter stretch underprepared. The cold finds every gap; days in, you turn back carrying a lasting mark: frostbite, a permanent injury.' },
  wintered: { head: 'YOU WINTER OVER IN THE REACH', body: 'The snows close the Reach in, but your shelter holds warm, the larder lasts and the fire never dies. When thaw comes, the Reach is yours.' },
  collapsed: { head: 'YOU COLLAPSE', body: 'Worked past the end of yourself, your body simply stops. Passing traders find you days later and carry you out, barely alive. You keep what you learned — and the lesson about limits.' },
  died: { head: 'THE REACH TAKES YOU', body: 'Without water or food the body fails faster than the will. You lie down one night and do not get up. Your story ends here — what you learned dies with you. Another Warden will have to begin again.' },
  grim: { head: 'A GRIM WINTER', body: 'You hunker down on too little. The larder runs thin, the shelter leaks heat, and the cold grinds at you week after week. You limp into spring weaker than you started.' },
};

// ── Small helpers ───────────────────────────────────────────────────────────

/** Escape text for innerHTML — sim text is ours today, but a save could be edited. */
const esc = (t: string | number): string => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
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
  const last = cal.winterDay + 3;
  // Day d sits at the left edge of its slot; slots are 1/last wide.
  const x = (d: number): number => ((d - 1) / last) * 100;
  return `<div class="timeline">`
    + `<div class="season autumn" style="width:${x(cal.winterDay)}%"></div>`
    + `<div class="season winter" style="width:${100 - x(cal.winterDay)}%"></div>`
    + `<div class="van" style="left:${x(cal.caravanOpen)}%;width:${x(cal.caravanClose + 1) - x(cal.caravanOpen)}%"></div>`
    + `<span class="lbl" style="left:0">AUTUMN</span>`
    + `<span class="lbl" style="left:${x(cal.caravanOpen)}%">CARAVAN</span>`
    + `<span class="lbl" style="left:${x(cal.winterDay)}%">WINTER</span>`
    + `<div class="today" style="left:${Math.min(99.5, x(a.sim.day + 0.5))}%"></div></div>`
    + `<div class="tl-legend"><span><b>Autumn</b> — prep time</span><span><b>Caravan</b> — days ${cal.caravanOpen}–${cal.caravanClose}</span><span><b>Winter</b> — day ${cal.winterDay}+</span></div>`;
}

/** The body pillar's status: Condition when all is well, otherwise the check that's failing. */
function bodyStatus(v: AppState['sim']['vitals'], minCondition: number): string {
  const fl = (x: number): number => Math.floor(x + 1e-9);
  if (v.vigor.cap < BASELINE) return `VIG CAP ${fl(v.vigor.cap)} / ${BASELINE}`;
  if (v.clarity.cap < BASELINE) return `CLA CAP ${fl(v.clarity.cap)} / ${BASELINE}`;
  return `COND ${fl(v.condition)}${v.condition < minCondition ? ` / ${minCondition}` : ''}`;
}

function readiness(a: AppState): string {
  const s = a.sim;
  const t = s.config.thresholds;
  const status: Record<PillarKey, string> = {
    larder: `${s.stores.rations} / ${t.larder}`,
    // Round down, so a value just under a threshold never displays as meeting it (#1230).
    shelter: `${Math.floor(warmth(s) * 100)}% / ${Math.round(t.warmth * 100)}%`,
    fuel: `${s.stores.firewood} / ${t.fuel}`,
    body: bodyStatus(s.vitals, t.condition),
  };
  const rows = pillars(readinessInput(s), t).map(p =>
    `<div class="pillar"><span class="pn">${PILLAR_NAME[p.key]}</span>`
    + `<div class="track"><div class="fill ${p.done ? 'done' : ''}" style="width:${pct(p.progress)}%"></div></div>`
    + `<span class="st ${p.done ? 'done' : ''}">${status[p.key]}</span></div>`).join('');
  const ready = winterReady(s);
  return rows + `<div class="verdict-row"><span class="tag ${ready ? 'yes' : 'no'}">${ready ? 'WINTER-READY' : 'NOT READY'}</span>`
    + `<span style="color:var(--dim);font-family:var(--body);font-size:11px;letter-spacing:0">${ready ? 'You could winter over here, or leave in good shape.' : 'Keep laying in stores and warming the shelter.'}</span></div>`;
}

/** Queue entries whose options menu is open (UI-only; reset when the queue shifts). */
const expanded = new Set<number>();

/** Which ring the palette's land actions aim at (UI-only; not saved). */
let focusRing: Ring = 1;

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
      const label = lv === 0 ? '???' : lv === 1 ? `~${DOMAIN_LABEL[d]}` : DOMAIN_LABEL[d];
      return `<span class="chip l${lv}" title="${DOMAIN_LABEL[d]}: ${LEVEL_NAME[lv]}${e.worked[r][d] ? ` · worked ${e.worked[r][d]}×` : ''}">${label}</span>`;
    }).join('');
    const finds = domainsOf(r).filter(d => hasFind(e, r, d)).map(d => `<span class="chip find">★ ${FINDS[d]?.name}</span>`).join('');
    const pass = r === 3 && routeKnown(a.sim) ? '<span class="chip find">★ The pass</span>' : '';
    return `${head}<div class="res">${chips}${finds}${pass}</div>`;
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

/** The Warden tab (#1239): who you are — portrait, name, rank, traits, skills, concepts. */
function wardenTab(a: AppState): string {
  const c = a.sim.character;
  const traits = c.traits.length
    ? c.traits.map(t => `<div class="trait"><b>${esc(TRAITS[t].name)}</b><span class="up">+ ${esc(TRAITS[t].upside)}</span><span class="cost">− ${esc(TRAITS[t].cost)}</span>${t === 'tough' ? `<span class="note">${c.lastStandUsed ? 'last stand used this run' : 'last stand ready'}</span>` : ''}</div>`).join('')
    : '<p class="mood">No traits — a quick-start Warden. Start a fresh Warden to choose two.</p>';
  const concepts = Object.entries(a.sim.concepts).filter(([, p]) => p.rank > 0 || p.insight > 0);
  return `<div class="cols">
    <section class="box"><div class="idcard">${portraitEl(c.portrait, 120)}<div><p class="eyebrow">ARTIFICER</p><h2 class="wname">${esc(c.name || 'Unnamed Warden')}</h2>
      <p class="wrank">RANK: ${artificerRank(a.sim).toUpperCase()} <span>· ${conceptRanks(a.sim)} concept rank${conceptRanks(a.sim) === 1 ? '' : 's'}</span></p></div></div>
      <p class="eyebrow" style="margin-top:16px">FOCUS</p>${focusBlock(a.sim)}
      <p class="eyebrow" style="margin-top:16px">STATS — what you're built for</p>${statsBlock(c.stats)}
      <p class="eyebrow" style="margin-top:16px">TRAITS</p><div class="traits">${traits}</div></section>
    <section class="box"><p class="eyebrow">SKILLS — improve by doing, faster with focus; techniques come by practice or teaching</p>${skillsBlock(a.sim)}
      <p class="eyebrow" style="margin-top:16px">CONCEPTS — deepen by study and craft</p>
      ${concepts.length ? `<ul class="concepts">${concepts.map(([id, p]) => `<li><b>${esc(id[0].toUpperCase() + id.slice(1))}</b> rank ${p.rank} <span>· ${p.insight.toFixed(1)} insight</span></li>`).join('')}</ul>` : '<p class="mood">Nothing studied yet. Study a concept, or craft, to start.</p>'}</section>
  </div>`;
}

/** Stats (#1256, #1258), shown exactly — unlike skills, you know your own body and mind. */
function statsBlock(st: Stats): string {
  return `<div class="statgrid">${STAT_IDS.map(id => `<div class="stat ${st[id] > 10 ? 'hi' : st[id] < 10 ? 'lo' : ''}" title="${esc(STATS[id].blurb)}">`
    + `<span class="sk">${STATS[id].short}</span><span class="sv">${st[id]}</span><span class="sd">${esc(statNote(id, st[id]))}</span></div>`).join('')}</div>`;
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
    + `<div class="d">${SITE_NOTE[id]}${s.site === id ? ` Shelter tier ${s.tier}/2${s.shelterGrade ? ` (${s.shelterGrade})` : ''} · ${Math.round(warmth(s) * 100)}% warm.` : ''}</div></button>`).join('');
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
    const why = def.gate?.(preview.projected, r, {}) ?? null;
    const spends = [def.vigorRate < 0 ? 'vigor' : '', def.clarityRate < 0 ? 'clarity' : ''].filter(Boolean).join(' + ') || 'restores';
    return `<button class="act ${why ? 'soft' : ''}" data-q="${q}" ${resolved ? 'disabled' : ''} title="${why ? esc(`Would be skipped: ${why}`) : ''}">`
      + `<div class="t">${ICON[id]} ${def.name.toUpperCase()}<span class="h">${queueHours(q, preview.projected)}H</span></div>`
      + `<div class="y">${why ? `<span class="gate">${esc(why)}</span>` : `<span class="yield">${YIELD[id](preview.projected, r)}</span> · <span class="vc">${spends}</span>`}</div></button>`;
  }).join('')}</div></div>`).join('');
}

/** Today's planned hours (only entries that would run today and not be skipped). */
const todayHours = (a: AppState, preview: Preview): number =>
  a.queue.reduce((h, item, i) => h + (preview.dayOffset[i] === 0 && !preview.warnings[i] ? queueHours(item, preview.before[i]) : 0), a.sim.hoursToday);

function queueBlock(a: AppState, preview: Preview): string {
  const s = a.sim;
  const resolved = s.outcome !== null;
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
      + `<span class="meta">${queueHours(item, preview.before[i])}h</span><button class="x" data-x="${i}" aria-label="Remove">×</button></div>${menu}</li>`;
  }).join('');
  const days = a.queue.length ? (preview.dayOffset.at(-1) ?? 0) + 1 : 0;
  return `<div class="queue">
      <p class="eyebrow" style="color:var(--gold);margin-bottom:8px">THE QUEUE</p>
      <ol>${items || `<li class="empty">Empty — tap actions to plan. A day is ${DAY_HOURS} waking hours; the queue spills into the next day and you sleep between.</li>`}</ol>
      <div class="qtot"><span>Today <b>${todayHours(a, preview)} / ${DAY_HOURS}h</b></span><span>Spans <b>${days}</b> day${days === 1 ? '' : 's'}</span></div>
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
  const ph = phaseOf(d, cal);
  if (ph === 'prep') { const n = cal.caravanOpen - d; return `<span class="phase">AUTUMN · CARAVAN IN ${n} DAY${n === 1 ? '' : 'S'}</span>`; }
  if (ph === 'caravan') return `<span class="phase gold">CARAVAN HERE · UNTIL DAY ${cal.caravanClose}</span>`;
  if (ph === 'postCaravan') return '<span class="phase">CARAVAN GONE</span>';
  return '<span class="phase ice">WINTER</span>';
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
    ${focusChip(s)}
    <span class="shours">TODAY <b>${todayHours(a, preview)}/${DAY_HOURS}H</b></span>
    <span class="tag ${ready ? 'yes' : 'no'}">${ready ? 'WINTER-READY' : 'NOT READY'}</span>
  </div>`;
}

const OUTCOME_SHORT: Record<RunRecord['kind'], string> = { thrive: 'Thrived — caravan', ragged: 'Ragged — caravan', crossed: 'Crossed alone', turnedBack: 'Turned back', wintered: 'Wintered well', grim: 'Grim winter', collapsed: 'Collapsed', died: 'Died' };

/** The history of finished runs (newest first), with the best one marked. */
function pastRuns(): string {
  if (!history.length) return '<p class="mood">No finished runs yet. Take an exit when the caravan comes, and it will be recorded here.</p>';
  const best = bestRun(history);
  return `<ol class="runs">${history.map(r => `<li class="${r === best ? 'best' : ''}"><span class="rn">${r.characterName ? `${esc(r.characterName)} · ` : ''}RUN ${r.run}</span>`
    + `<span class="rk k-${r.kind}">${OUTCOME_SHORT[r.kind]}${r.injury ? ' · frostbite' : ''}</span>`
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
      return `<div class="plan">
        <section class="box"><p class="eyebrow">ACTIONS — tap to add to the queue</p>${paletteBlock(a, preview)}</section>
        <section class="box planside">${queueBlock(a, preview)}
          <div class="log"><p class="eyebrow" style="color:var(--faint);margin-bottom:7px">LATEST</p><ul>${journal(a, 6)}</ul></div></section>
      </div>`;
    case 'camp':
      return `<div class="cols">
        <section class="box"><p class="eyebrow">THE WARDEN</p>${vitalsBlock(a)}
          <p class="eyebrow" style="margin-top:14px">STORES</p>${storesRow(a.sim)}
          <p class="eyebrow" style="margin-top:14px">TOOLS &amp; KNOWLEDGE</p>${toolsBlock(a)}</section>
        <section class="box"><p class="eyebrow">SITE &amp; SHELTER</p>${sitesBlock(a)}</section>
      </div>`;
    case 'land':
      return `<section class="box"><p class="eyebrow">THE LAND — what you know, ring by ring</p>${land(a)}${LAND_LEGEND}
        <p class="mood">Scout for the overview, survey to firm it up, and work the land for the detail. The near ring runs thin as you work it; push outward for richer ground.</p></section>`;
    case 'warden':
      return wardenTab(a);
    case 'progress':
      return `<div class="cols">
        <section class="box"><p class="eyebrow ice">THE SEASON</p>${timeline(a)}
          <p class="eyebrow" style="margin-top:16px">WINTER READINESS</p>${readiness(a)}
          <p class="eyebrow" style="margin-top:16px">MILESTONES</p>${milesBlock(a)}
          <p class="eyebrow" style="margin-top:16px">PAST RUNS</p>${pastRuns()}</section>
        <section class="box log"><p class="eyebrow" style="color:var(--faint);margin-bottom:7px">JOURNAL</p><ul class="full">${journal(a, 200)}</ul></section>
      </div>`;
  }
}

function resolvePanel(a: AppState): string {
  const s = a.sim;
  if (s.outcome) {
    const o = OUTCOME[s.outcome.kind];
    const r = history[0];
    const facts = r ? `<ul class="runfacts">
        <li>${r.choice === 'collapse' ? 'Ended' : 'Left'} on <b>day ${r.day}</b>${r.readyDay ? ` · winter-ready on <b>day ${r.readyDay}</b>` : ' · never winter-ready'}</li>
        <li>${r.site ? `${esc(SITES[r.site].name)}, shelter tier ${r.tier}${r.shelterGrade ? ` (${r.shelterGrade})` : ''}` : 'No camp'} · ${r.tools.length} tool${r.tools.length === 1 ? '' : 's'} · ${r.recipes} recipes · ${r.milestones} milestones</li>
      </ul>` : '';
    return `<div class="resolve"><h3>${s.outcome.choice === 'collapse' ? `✝ RUN ${r?.run ?? ''} ENDED` : `❄ REGION 1 COMPLETE — RUN ${r?.run ?? ''}`}</h3><div class="outcome"><span class="head">${o.head}</span>${o.body}</div>${facts}`
      // Only a living Warden goes on (#1242): after a death, the only way forward is someone new.
      + `<div class="runbar" style="margin-top:12px">${canContinue(s)
        ? `<button class="btn go" data-cmd="carry" title="The same Warden goes on: recipes, concept ranks and skills carry over">↻ ${s.character.name ? `CONTINUE AS ${esc(s.character.name.toUpperCase())}` : 'NEW RUN'} — KEEP WHAT YOU LEARNED</button>`
        : ''}<button class="btn ${canContinue(s) ? '' : 'go'}" data-cmd="reset" title="A new person, starting from nothing">✦ ${canContinue(s) ? 'FRESH WARDEN' : 'NEW WARDEN'}</button></div></div>`;
  }
  const open = availableChoices(s.day, s.config.calendar);
  if (open.length === 0) return '';

  const ready = winterReady(s);
  const canCross = crossingPrepared({ coldGear: s.coldGear, rations: s.stores.rations, vitals: s.vitals });
  const card: Record<Choice, string> = {
    caravan: `<button class="choice" data-exit="caravan"><div class="t">🐂 RIDE OUT WITH THE CARAVAN</div><div class="d">The easy door. Travel on with help${ready ? ' — and goods to trade' : ''}.</div><div class="req ${ready ? 'met' : 'unmet'}">${ready ? 'you leave strong' : 'you can still board, but ragged'}</div></button>`,
    solo: `<button class="choice" data-exit="solo"><div class="t">🎒 BRAVE THE CROSSING ALONE</div><div class="d">Walk out across the winter stretch. No help, no dependence.</div><div class="req ${canCross ? 'met' : 'unmet'}">cold gear · ${CROSSING_NEEDS.rations}+ rations · condition ${CROSSING_NEEDS.condition}+ · vigor cap ${CROSSING_NEEDS.vigorCap}+ — ${canCross ? "you're prepared" : 'not yet prepared'}</div></button>`,
    winter: `<button class="choice" data-exit="winter"><div class="t">🏠 HUNKER DOWN &amp; WINTER OVER</div><div class="d">Outlast the cold in the home you've made.</div><div class="req ${ready ? 'met' : 'unmet'}">${ready ? 'winter-ready' : 'not winter-ready — this will hurt'}</div></button>`,
  };
  const snow = phaseOf(s.day, s.config.calendar) === 'winter';
  const title = snow ? 'THE SNOW HAS COME' : open.includes('caravan') ? 'A CARAVAN CRESTS THE RIDGE' : 'THE CARAVAN HAS MOVED ON';
  const blurb = snow
    ? 'The first real snow is falling. Keep going a day at a time, or commit.'
    : open.includes('caravan')
      ? `Traders bound for the lowlands, camped until day ${s.config.calendar.caravanClose}. They'll take you — or strike out alone, or stay and winter over. You can keep preparing first.`
      : 'Now it is the road alone, or wintering here.';
  return `<div class="resolve ${snow ? 'ice' : ''}"><h3>${title}</h3><p>${blurb}</p><div class="choices">${open.map(c => card[c]).join('')}</div></div>`;
}

function render(a: AppState): void {
  const preview = previewQueue(a);
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
      working the land teaches you its detail. A caravan passes just before the snow: ride out with it, brave the crossing alone, or winter over.
      Progress saves in this browser.</p>` : ''}
    ${statusBar(a, preview)}
    ${resolvePanel(a)}
    <nav class="tabbar" role="tablist">${TABS.map(t => `<button class="tabbtn ${tab === t.id ? 'on' : ''}" role="tab" aria-selected="${tab === t.id}" data-tab="${t.id}">${t.label}</button>`).join('')}</nav>
    ${tabBody(a, preview)}`;
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
let draft: { name: string; portrait: string; traits: TraitId[]; stats: Stats } = { name: '', portrait: PORTRAITS[0].id, traits: [], stats: { ...DEFAULT_STATS } };
const draftValid = (): boolean => draft.name.trim().length > 0 && draft.traits.length === TRAIT_COUNT;

function startIntro(kind: IntroKind): void {
  draft = { name: '', portrait: PORTRAITS[0].id, traits: [], stats: { ...DEFAULT_STATS } };
  drawnBeat = -1;
  intro = { beats: introBeats(kind, state.sim, runNumberFor(history, state.sim.character.id)), i: 0 };
  renderIntro();
}

/** Leaving the creation screen: the Warden is made with the chosen name, portrait and traits. */
function commitCharacter(): void {
  state = { sim: createRegion1({}, undefined, { id: newCharacterId(), name: draft.name.trim().slice(0, 24), portrait: draft.portrait, traits: draft.traits, stats: validStats(draft.stats) ? draft.stats : { ...DEFAULT_STATS } }), queue: [] };
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
    + (b.kind === 'create' ? createForm() : '');
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
      <button class="btn go" data-intro="next" ${b.kind === 'create' && !draftValid() ? 'disabled' : ''}>${last ? 'BEGIN ▸' : 'CONTINUE ▸'}</button>
    </div>`;
  const beatEl = introEl.querySelector('.beat');
  if (beatEl && drawnBeat === intro.i) beatEl.scrollTop = scrolled;
  // On the creation screen, start in the name field (unless a name is already typed).
  if (b.kind === 'create' && !draft.name) introEl.querySelector<HTMLInputElement>('#wname')?.focus();
  else introEl.querySelector<HTMLButtonElement>('[data-intro="next"]')?.focus();
}

/** The creation form: name, portrait, two traits. Choices live in `draft` until Continue. */
function createForm(): string {
  const portraits = PORTRAITS.map(p => `<button class="pchoice" data-portrait="${p.id}" aria-pressed="${draft.portrait === p.id}">${portraitEl(p.id, 64)}<span>${esc(p.label)}</span></button>`).join('');
  const traits = TRAIT_IDS.map(t => `<button class="tchoice" data-trait="${t}" aria-pressed="${draft.traits.includes(t)}"><b>${esc(TRAITS[t].name)}</b><span class="up">+ ${esc(TRAITS[t].upside)}</span><span class="cost">− ${esc(TRAITS[t].cost)}</span></button>`).join('');
  return `<form class="create" onsubmit="return false">
    <label class="clabel" for="wname">NAME</label>
    <input id="wname" class="cname" maxlength="24" autocomplete="off" spellcheck="false" placeholder="What are you called?" value="${esc(draft.name)}">
    <p class="clabel">PORTRAIT</p><div class="pchoices">${portraits}</div>
    <p class="clabel">TRAITS — choose ${TRAIT_COUNT} <span>(${draft.traits.length}/${TRAIT_COUNT})</span></p><div class="tchoices">${traits}</div>
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
    return `<div class="srow"><div class="sname"><b>${esc(STATS[id].name)}</b><span>${esc(STATS[id].blurb)}</span><span class="snote ${v > 10 ? 'up' : v < 10 ? 'cost' : ''}">${esc(statNote(id, v))}</span></div>`
      + `<div class="sstep"><button type="button" class="pill" data-stat="${id}" data-delta="-1" aria-label="Lower ${esc(STATS[id].name)}" ${canLower(draft.stats, id) ? '' : 'disabled'}>−</button>`
      + `<span class="sval">${v}</span>`
      + `<button type="button" class="pill${dear}" data-stat="${id}" data-delta="1" aria-label="Raise ${esc(STATS[id].name)} (costs ${raiseCost(v)})" title="${v >= 13 ? 'costs 2 points' : 'costs 1 point'}" ${canRaise(draft.stats, id) ? '' : 'disabled'}>+</button></div></div>`;
  }).join('');
  return `<p class="clabel">STATS — spend ${POINT_BUDGET} points <span>(${left} left${left > 0 ? ' · unspent points are wasted' : ''}) · above 13 costs 2 · lower one to 7 to buy more</span></p>
    <div class="schoices">${rows}</div>`;
}

// Tap anywhere to advance (the tablet path); Skip ends it at once. On the creation
// screen only its own controls act, so a stray tap can't skip past your choices.
introEl.addEventListener('click', e => {
  const el = e.target as HTMLElement;
  const btn = el.closest<HTMLElement>('[data-intro], [data-portrait], [data-trait], [data-stat]');
  const creating = intro?.beats[intro.i].kind === 'create';
  if (btn?.dataset.portrait) { draft.portrait = btn.dataset.portrait; renderIntro(); return; }
  if (btn?.dataset.stat) {
    // A step up or down, only if point-buy allows it (the buttons are disabled otherwise, but check anyway).
    const id = btn.dataset.stat as StatId;
    const up = btn.dataset.delta === '1';
    if (up ? canRaise(draft.stats, id) : canLower(draft.stats, id)) draft.stats = { ...draft.stats, [id]: draft.stats[id] + (up ? 1 : -1) };
    renderIntro(); return;
  }
  if (btn?.dataset.trait) {
    const t = btn.dataset.trait as TraitId;
    // Toggle; picking a third replaces the earliest pick.
    draft.traits = draft.traits.includes(t) ? draft.traits.filter(x => x !== t) : [...draft.traits, t].slice(-TRAIT_COUNT);
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
  else if (!typing && (e.key === ' ' || e.key === 'ArrowRight') && intro.beats[intro.i].kind !== 'create') { e.preventDefault(); advanceIntro(); }
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
  else if (d.focus) update(chooseFocus(state, parseFocus(d.focus)));
  else if (d.q) update(enqueue(state, d.q as QueueId));
  else if (d.toggle !== undefined) { const i = Number(d.toggle); if (expanded.has(i)) expanded.delete(i); else expanded.add(i); render(state); }
  // Keep the menu open while choosing (it may have opened only because a choice was missing).
  else if (d.opt) { const [i, key, value] = d.opt.split('|'); expanded.add(Number(i)); update(setOption(state, Number(i), key, value)); }
  else if (d.x !== undefined) { expanded.clear(); update(dequeueAt(state, Number(d.x))); }
  else if (d.site) update(settle(state, d.site as SiteId));
  else if (d.exit) update(takeExit(state, d.exit as Choice));
  else if (d.cmd === 'day') update(runQueuedDay(state));
  else if (d.cmd === 'all') update(runWholeQueue(state));
  else if (d.cmd === 'clear') update(clearQueue(state));
  else if (d.cmd === 'reset') { update(newGame()); startIntro('fresh'); }
  else if (d.cmd === 'carry' && canContinue(state.sim)) { update(newRun(state.sim)); startIntro('carry'); }
});

render(state);
if (!saved) startIntro('fresh');
