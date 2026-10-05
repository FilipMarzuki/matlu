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
import { ACTIONS, SITES, BUILD_COST, DAY_HOURS, REGION1_MILESTONES, readinessInput, warmth, winterReady, routeKnown, parseQueueId, queueId, queueHours, type ActionId, type QueueId, type LogEntry, type SiteId } from '../artificer/region1';
import { RINGS, RING_NAME, TRAVEL_HOURS, FINDS, LEVEL_NAME, domainsOf, level, reachable, scouted, tripYield, hasFind, type Domain, type Ring } from '../artificer/exploration';
import { modifiersFor } from '../artificer/crafting';
import { pillars, type PillarKey } from '../artificer/readiness';
import { availableChoices, crossingPrepared, phaseOf, CROSSING_NEEDS, type Choice, type OutcomeKind } from '../artificer/winter';
import { BASELINE, CAP_CEIL, morale, type Pool } from '../artificer/vitality';
import { newGame, enqueue, dequeueAt, clearQueue, runQueuedDay, runWholeQueue, settle, takeExit, previewQueue, serialize, deserialize, SAVE_KEY, type AppState } from './controller';

// ── Presentation-only data (wording lives here, rules live in the sim) ──────

const GROUPS: { title: string; ids: ActionId[] }[] = [
  { title: 'EXPLORE', ids: ['scout', 'survey', 'track'] },
  { title: 'PROVISION', ids: ['gather', 'hunt', 'water', 'wood', 'quarry', 'preserve'] },
  { title: 'BUILD', ids: ['build', 'coldGear'] },
  { title: 'CRAFT TOOLS', ids: ['knife', 'snare', 'waterskin', 'bedroll', 'shovel'] },
  { title: 'RECOVER', ids: ['tinker', 'rest'] },
];

const ICON: Record<ActionId, string> = {
  scout: '🥾', survey: '📐', track: '🐾', gather: '🌿', hunt: '🏹', water: '💧',
  wood: '🪵', quarry: '⛰️', preserve: '🧂', build: '⛺', coldGear: '🧥', tinker: '🛠️', rest: '☕',
  knife: '🔪', snare: '🪤', waterskin: '🫗', bedroll: '🛏️', shovel: '⛏️',
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
  gather: (s, r) => `+${ty(s, r, 'forage', 3, 2) + bonus(s, 'gather')} raw food${fb(s, r, 'forage') ? ' +2 fiber' : ''}`,
  hunt: (s, r) => `+${ty(s, r, 'game', 7, 0) + bonus(s, 'hunt') + fb(s, r, 'game')} raw food`,
  water: (s, r) => `+${ty(s, r, 'water', 4, 1) + (s.site === 'river' && r === 1 ? 2 : 0) + bonus(s, 'water') + fb(s, r, 'water')} water`,
  wood: (s, r) => `+${ty(s, r, 'timber', 4, 1) + (s.site === 'tree' && r === 1 ? 1 : 0) + fb(s, r, 'timber')} fuel, +${ty(s, r, 'timber', 2, 1)} mat`,
  quarry: (s, r) => `+${ty(s, r, 'stone', 3, 1) + fb(s, r, 'stone')} materials`,
  preserve: () => '2 raw → 1 ration (×3)',
  build: s => (s.tier < 2 ? `tier ${s.tier + 1} · ${BUILD_COST[s.tier as 0 | 1]} mat · grade sets warmth` : 'winterized'),
  coldGear: () => 'needed to cross solo · crude won\'t do',
  knife: () => 'hunt −15% vigor, quicker preserving',
  snare: () => '+1 food every night',
  waterskin: () => '+1 water per trip',
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

function readiness(a: AppState): string {
  const s = a.sim;
  const t = s.config.thresholds;
  const status: Record<PillarKey, string> = {
    larder: `${s.stores.rations} / ${t.larder}`,
    shelter: `${Math.round(warmth(s) * 100)}% / ${Math.round(t.warmth * 100)}%`,
    fuel: `${s.stores.firewood} / ${t.fuel}`,
    body: `COND ${Math.round(s.vitals.condition)}`,
  };
  const rows = pillars(readinessInput(s), t).map(p =>
    `<div class="pillar"><span class="pn">${PILLAR_NAME[p.key]}</span>`
    + `<div class="track"><div class="fill ${p.done ? 'done' : ''}" style="width:${pct(p.progress)}%"></div></div>`
    + `<span class="st ${p.done ? 'done' : ''}">${status[p.key]}</span></div>`).join('');
  const ready = winterReady(s);
  return rows + `<div class="verdict-row"><span class="tag ${ready ? 'yes' : 'no'}">${ready ? 'WINTER-READY' : 'NOT READY'}</span>`
    + `<span style="color:var(--dim);font-family:var(--body);font-size:11px;letter-spacing:0">${ready ? 'You could winter over here, or leave in good shape.' : 'Keep laying in stores and warming the shelter.'}</span></div>`;
}

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

function warden(a: AppState): string {
  const s = a.sim;
  const st = s.stores;
  const r = (icon: string, label: string, n: number, low = false): string => `<span class="r ${low ? 'low' : ''}">${icon} ${label} <b>${n}</b></span>`;
  const sites = (Object.keys(SITES) as SiteId[]).map(id =>
    `<button class="siteopt ${s.site === id ? 'chosen' : ''}" data-site="${id}" ${scouted(s.explore, 1) && !s.outcome ? '' : 'disabled'}>`
    + `<div class="t">${SITES[id].name.toUpperCase()}<span class="warm" style="margin-left:auto">MAX ${Math.round(SITES[id].warmth * 100)}% WARM</span></div>`
    + `<div class="d">${SITE_NOTE[id]}${s.site === id ? ` Shelter tier ${s.tier}/2${s.shelterGrade ? ` (${s.shelterGrade})` : ''} · ${Math.round(warmth(s) * 100)}% warm.` : ''}</div></button>`).join('');
  // Tool names come from the craft actions that make them (output item → action).
  const toolName = (item: string): string => (Object.values(ACTIONS).find(a => a.recipe?.output.item === item)?.recipe?.name ?? item);
  const tools = s.tools.map(t => `<span class="r tool ${t.grade}">${esc(toolName(t.item))} <b>${t.grade.toUpperCase()}</b></span>`).join('');
  const concepts = Object.entries(s.concepts).filter(([, p]) => p.rank > 0 || p.insight > 0)
    .map(([id, p]) => `<span class="r concept">${esc(id)} <b>R${p.rank}</b></span>`).join('');
  const miles = REGION1_MILESTONES.map(m => {
    const done = s.milestones.includes(m.id);
    return `<li class="${done ? 'done' : ''}"><span class="mk">${done ? '✓' : '·'}</span><span class="mn">${esc(m.name.toUpperCase())}</span></li>`;
  }).join('');
  return `<section class="box" aria-label="Warden and stores">
    <p class="eyebrow">THE WARDEN</p>
    <div class="vitals">${poolRow('VIGOR', s.vitals.vigor)}${poolRow('CLARITY', s.vitals.clarity)}
      <div class="vital"><span class="vn">RESERVE</span><div class="track"><div class="fill ${band(s.vitals.condition / 100)}" style="width:${pct(s.vitals.condition / 100)}%"></div></div><span class="vs ${band(s.vitals.condition / 100)}">${Math.round(s.vitals.condition)}%</span></div>
    </div>
    <p class="mood">${moodLine(a)}</p>
    <p class="eyebrow" style="margin-top:14px">STORES</p>
    <div class="res">${r('🍖', 'Food', st.rawFood, st.rawFood < 1)}${r('💧', 'Water', st.water, st.water < 1)}${r('🪵', 'Fuel', st.firewood)}${r('🪨', 'Mat', st.materials)}${r('🧂', 'Rations', st.rations)}</div>
    <p class="eyebrow" style="margin-top:14px">SITE &amp; SHELTER</p>
    <div class="sites">${sites}</div>
    ${scouted(s.explore, 1) ? '' : '<p class="mood">Scout first to find somewhere to settle.</p>'}
    <p class="eyebrow" style="margin-top:14px">THE LAND</p>
    ${land(a)}
    <p class="eyebrow" style="margin-top:14px">TOOLS &amp; KNOWLEDGE</p>
    <div class="res">${tools || '<span class="mood" style="margin:0">No tools yet — craft some once you have materials.</span>'}</div>
    ${concepts ? `<div class="res" style="margin-top:6px">${concepts}</div>` : ''}
    <p class="eyebrow" style="margin-top:14px">MILESTONES</p>
    <ol class="miles">${miles}</ol>
  </section>`;
}

function planner(a: AppState): string {
  const s = a.sim;
  const preview = previewQueue(a);
  const resolved = s.outcome !== null;

  // Gates are judged against the state *after* the queue so far, so you can
  // plan "scout, then gather" in one go. Blocked actions stay clickable (a
  // skipped action costs nothing) but are dashed and say why.
  // Land actions go to the ring picked in the tabs; everything else happens at camp.
  const tabs = `<div class="rings">${RINGS.map(r => {
    const open = reachable(preview.projected.explore, r);
    return `<button class="ringtab ${focusRing === r ? 'on' : ''} ${open ? '' : 'locked'}" data-ring="${r}" title="${open ? '' : 'Scout the ring inside it first'}">`
      + `${RING_NAME[r].toUpperCase()}<span>${TRAVEL_HOURS[r] ? `+${TRAVEL_HOURS[r]}h travel` : 'home ground'}</span></button>`;
  }).join('')}</div>`;
  const palette = tabs + GROUPS.map(g => `<div class="group"><h4>${g.title}${g.title === 'EXPLORE' || g.title === 'PROVISION' ? ` <span class="ringnote">· ${RING_NAME[focusRing].toLowerCase()} ring</span>` : ''}</h4><div class="acts">${g.ids.map(id => {
    const def = ACTIONS[id];
    const r: Ring = def.ringed ? focusRing : 1;
    const q = queueId(id, r);
    const why = def.gate?.(preview.projected, r) ?? null;
    const spends = [def.vigorRate < 0 ? 'vigor' : '', def.clarityRate < 0 ? 'clarity' : ''].filter(Boolean).join(' + ') || 'restores';
    return `<button class="act ${why ? 'soft' : ''}" data-q="${q}" ${resolved ? 'disabled' : ''} title="${why ? esc(`Would be skipped: ${why}`) : ''}">`
      + `<div class="t">${ICON[id]} ${def.name.toUpperCase()}<span class="h">${queueHours(q)}H</span></div>`
      + `<div class="y">${why ? `<span class="gate">${esc(why)}</span>` : `<span class="yield">${YIELD[id](preview.projected, r)}</span> · <span class="vc">${spends}</span>`}</div></button>`;
  }).join('')}</div></div>`).join('');

  const items = a.queue.map((q, i) => {
    const { id, ring } = parseQueueId(q);
    const d = preview.dayOffset[i];
    const why = preview.warnings[i];
    return `<li class="${why ? 'skip' : ''}"><span class="dayn">${d === 0 ? 'TODAY' : `DAY ${s.day + d}`}</span>`
      + `<span class="n">${ICON[id]} ${ACTIONS[id].name.toUpperCase()}${ring > 1 ? ` <span class="ringtag">${RING_NAME[ring].toUpperCase()}</span>` : ''}</span>`
      + (why ? `<span class="why">skips: ${esc(why)}</span>` : '')
      + `<span class="meta">${queueHours(q)}h</span><button class="x" data-x="${i}" aria-label="Remove">×</button></li>`;
  }).join('');
  const todayHours = a.queue.reduce((h, q, i) => h + (preview.dayOffset[i] === 0 && !preview.warnings[i] ? queueHours(q) : 0), s.hoursToday);
  const days = a.queue.length ? (preview.dayOffset.at(-1) ?? 0) + 1 : 0;

  const log = [...s.log].reverse().slice(0, 80).map((l: LogEntry) => {
    const cls = l.kind === 'hardship' ? 'bad' : l.kind === 'milestone' || l.kind === 'outcome' ? 'good' : l.kind === 'skip' ? 'skip' : '';
    return `<li class="${cls}"><span class="d">D${l.day}</span>${esc(l.text)}</li>`;
  }).join('') || '<li style="color:var(--faint);font-style:italic">Day 1 in the Reach. Scout before anything else — you don\'t yet know where food, water or wood are.</li>';

  return `<section class="box" aria-label="The day's plan">
    <p class="eyebrow">PLAN THE DAY — build a queue, then run it</p>
    ${palette}
    <div class="queue">
      <p class="eyebrow" style="color:var(--gold);margin-bottom:8px">THE QUEUE</p>
      <ol>${items || `<li class="empty">Empty — click actions above to plan. A day is ${DAY_HOURS} waking hours; the queue spills into the next day and you sleep between.</li>`}</ol>
      <div class="qtot"><span>Today <b>${todayHours} / ${DAY_HOURS}h</b></span><span>Spans <b>${days}</b> day${days === 1 ? '' : 's'}</span></div>
      <div class="runbar">
        <button class="btn go" data-cmd="day" ${resolved ? 'disabled' : ''}>${a.queue.length ? '▶ RUN THE DAY' : '☾ PASS THE DAY'}</button>
        <button class="btn" data-cmd="all" ${resolved || !a.queue.length ? 'disabled' : ''}>⏭ RUN WHOLE QUEUE</button>
        <button class="btn" data-cmd="clear" ${a.queue.length ? '' : 'disabled'}>CLEAR</button>
      </div>
    </div>
    <div class="log"><p class="eyebrow" style="color:var(--faint);margin-bottom:7px">JOURNAL</p><ul>${log}</ul></div>
  </section>`;
}

function resolvePanel(a: AppState): string {
  const s = a.sim;
  if (s.outcome) {
    const o = OUTCOME[s.outcome.kind];
    return `<div class="resolve"><h3>❄ REGION 1 COMPLETE</h3><div class="outcome"><span class="head">${o.head}</span>${o.body}</div>`
      + `<button class="btn go" data-cmd="reset">↺ NEW SAVE — PLAY AGAIN</button></div>`;
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
  root.innerHTML = `
    <header>
      <h1>❄ GREYWIND <span class="mark">REACH</span> — REGION 1</h1>
      <span class="spacer"></span>
      <span class="counter ctl">DAY <b>${a.sim.day}</b></span>
      <span class="ctl"><button class="pill" data-cmd="reset">↺ NEW SAVE</button></span>
    </header>
    <p class="lede">You arrive alone with almost nothing, and <b>winter is coming</b>. Lay in a <b>larder</b>, build a
      <b>winter-proof shelter</b>, stock <b>fuel</b> and keep body &amp; mind sound. Plan each day as a <b>queue of actions</b>
      and run it. A caravan passes just before the snow — then ride out with it, brave the crossing alone, or winter over.</p>
    <div class="strip">
      <section class="box"><p class="eyebrow ice">THE SEASON</p>${timeline(a)}</section>
      <section class="box"><p class="eyebrow">WINTER READINESS</p>${readiness(a)}</section>
    </div>
    ${resolvePanel(a)}
    <main>${warden(a)}${planner(a)}</main>
    <footer><b>The queue is the game.</b> Each action costs <b>hours</b> and spends <b>Vigor</b> (body) / <b>Clarity</b> (mind).
      Scout first, then push outward: the near ring runs thin as you work it, and working any patch teaches you its detail. Sleep recovers more in a warmer shelter. Eat and drink daily or you fade.
      <b>Preserve</b> raw food into rations — that's the winter larder, not today's meals. Progress saves in this browser.</footer>`;
}

// ── Save / load (browser storage can be missing or blocked — never fatal) ───

function load(): AppState {
  try { return deserialize(localStorage.getItem(SAVE_KEY)) ?? newGame(); } catch { return newGame(); }
}

function save(a: AppState): void {
  try { localStorage.setItem(SAVE_KEY, serialize(a)); } catch { /* private mode etc. — play on unsaved */ }
}

// ── Wiring ──────────────────────────────────────────────────────────────────

const root = document.getElementById('app') as HTMLElement;
let state = load();

function update(next: AppState): void {
  state = next;
  save(state);
  render(state);
}

root.addEventListener('click', e => {
  // closest() finds the button even when the click lands on a child span.
  const el = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const d = el.dataset;
  if (d.ring) { focusRing = Number(d.ring) as Ring; render(state); }
  else if (d.q) update(enqueue(state, d.q as QueueId));
  else if (d.x !== undefined) update(dequeueAt(state, Number(d.x)));
  else if (d.site) update(settle(state, d.site as SiteId));
  else if (d.exit) update(takeExit(state, d.exit as Choice));
  else if (d.cmd === 'day') update(runQueuedDay(state));
  else if (d.cmd === 'all') update(runWholeQueue(state));
  else if (d.cmd === 'clear') update(clearQueue(state));
  else if (d.cmd === 'reset') update(newGame());
});

render(state);
