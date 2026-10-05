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
import { ACTIONS, SITES, BUILD_COST, DAY_HOURS, REGION1_MILESTONES, readinessInput, warmth, winterReady, type ActionId, type LogEntry, type SiteId } from '../artificer/region1';
import { pillars, type PillarKey } from '../artificer/readiness';
import { availableChoices, crossingPrepared, phaseOf, CROSSING_NEEDS, type Choice, type OutcomeKind } from '../artificer/winter';
import { BASELINE, CAP_CEIL, morale, type Pool } from '../artificer/vitality';
import { newGame, enqueue, dequeueAt, clearQueue, runQueuedDay, runWholeQueue, settle, takeExit, previewQueue, serialize, deserialize, SAVE_KEY, type AppState } from './controller';

// ── Presentation-only data (wording lives here, rules live in the sim) ──────

const GROUPS: { title: string; ids: ActionId[] }[] = [
  { title: 'EXPLORE', ids: ['scout', 'survey', 'track'] },
  { title: 'PROVISION', ids: ['gather', 'hunt', 'water', 'wood', 'preserve'] },
  { title: 'BUILD & CRAFT', ids: ['build', 'coldGear'] },
  { title: 'RECOVER', ids: ['tinker', 'rest'] },
];

const ICON: Record<ActionId, string> = {
  scout: '🥾', survey: '📐', track: '🐾', gather: '🌿', hunt: '🏹', water: '💧',
  wood: '🪵', preserve: '🧂', build: '⛺', coldGear: '🧥', tinker: '🛠️', rest: '☕',
};

/** One-line "what you get" per action. Numbers mirror region1.ts yields. */
const YIELD: Record<ActionId, (s: AppState['sim']) => string> = {
  scout: () => 'reveals the land',
  survey: () => 'richer yields',
  track: () => 'enables hunting',
  gather: s => `+${s.knowledge.surveyed ? 5 : 3} raw food`,
  hunt: () => '+7 raw food',
  water: s => `+${(s.knowledge.surveyed ? 5 : 4) + (s.site === 'river' ? 2 : 0)} water`,
  wood: s => `+${(s.knowledge.surveyed ? 5 : 4) + (s.site === 'tree' ? 1 : 0)} fuel, +${s.knowledge.surveyed ? 3 : 2} mat`,
  preserve: () => '2 raw → 1 ration (×3)',
  build: s => (s.tier < 2 ? `tier ${s.tier + 1} · ${BUILD_COST[s.tier as 0 | 1]} mat` : 'winterized'),
  coldGear: () => 'needed to cross solo',
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

function warden(a: AppState): string {
  const s = a.sim;
  const st = s.stores;
  const r = (icon: string, label: string, n: number, low = false): string => `<span class="r ${low ? 'low' : ''}">${icon} ${label} <b>${n}</b></span>`;
  const sites = (Object.keys(SITES) as SiteId[]).map(id =>
    `<button class="siteopt ${s.site === id ? 'chosen' : ''}" data-site="${id}" ${s.knowledge.scouted && !s.outcome ? '' : 'disabled'}>`
    + `<div class="t">${SITES[id].name.toUpperCase()}<span class="warm" style="margin-left:auto">MAX ${Math.round(SITES[id].warmth * 100)}% WARM</span></div>`
    + `<div class="d">${SITE_NOTE[id]}${s.site === id ? ` Shelter tier ${s.tier}/2.` : ''}</div></button>`).join('');
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
    <div class="res">${r('🍖', 'Food', st.rawFood, st.rawFood < 1)}${r('💧', 'Water', st.water, st.water < 1)}${r('🪵', 'Fuel', st.firewood)}${r('🪨', 'Mat', st.materials)}${r('🧂', 'Rations', st.rations)}${s.coldGear ? '<span class="r">🧥 Cold gear</span>' : ''}</div>
    <p class="eyebrow" style="margin-top:14px">SITE &amp; SHELTER</p>
    <div class="sites">${sites}</div>
    ${s.knowledge.scouted ? '' : '<p class="mood">Scout first to find somewhere to settle.</p>'}
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
  const palette = GROUPS.map(g => `<div class="group"><h4>${g.title}</h4><div class="acts">${g.ids.map(id => {
    const def = ACTIONS[id];
    const why = def.gate?.(preview.projected) ?? null;
    const spends = [def.vigorRate < 0 ? 'vigor' : '', def.clarityRate < 0 ? 'clarity' : ''].filter(Boolean).join(' + ') || 'restores';
    return `<button class="act ${why ? 'soft' : ''}" data-q="${id}" ${resolved ? 'disabled' : ''} title="${why ? esc(`Would be skipped: ${why}`) : ''}">`
      + `<div class="t">${ICON[id]} ${def.name.toUpperCase()}<span class="h">${def.hours}H</span></div>`
      + `<div class="y">${why ? `<span class="gate">${esc(why)}</span>` : `<span class="yield">${YIELD[id](preview.projected)}</span> · <span class="vc">${spends}</span>`}</div></button>`;
  }).join('')}</div></div>`).join('');

  const items = a.queue.map((id, i) => {
    const d = preview.dayOffset[i];
    const why = preview.warnings[i];
    return `<li class="${why ? 'skip' : ''}"><span class="dayn">${d === 0 ? 'TODAY' : `DAY ${s.day + d}`}</span>`
      + `<span class="n">${ICON[id]} ${ACTIONS[id].name.toUpperCase()}</span>`
      + (why ? `<span class="why">skips: ${esc(why)}</span>` : '')
      + `<span class="meta">${ACTIONS[id].hours}h</span><button class="x" data-x="${i}" aria-label="Remove">×</button></li>`;
  }).join('');
  const todayHours = a.queue.reduce((h, id, i) => h + (preview.dayOffset[i] === 0 && !preview.warnings[i] ? ACTIONS[id].hours : 0), s.hoursToday);
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
      Scout first; Survey for better yields. Sleep recovers more in a warmer shelter. Eat and drink daily or you fade.
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
  if (d.q) update(enqueue(state, d.q as ActionId));
  else if (d.x !== undefined) update(dequeueAt(state, Number(d.x)));
  else if (d.site) update(settle(state, d.site as SiteId));
  else if (d.exit) update(takeExit(state, d.exit as Choice));
  else if (d.cmd === 'day') update(runQueuedDay(state));
  else if (d.cmd === 'all') update(runWholeQueue(state));
  else if (d.cmd === 'clear') update(clearQueue(state));
  else if (d.cmd === 'reset') update(newGame());
});

render(state);
