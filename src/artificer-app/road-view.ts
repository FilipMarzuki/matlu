/**
 * The caravan road's screens (#1252) — presentation only, like the rest of the app:
 * state in, HTML out. The rules live in the sim (`src/artificer/road.ts` and friends);
 * this file only reads them and draws buttons that carry `data-road="<action id>"`.
 *
 * Unlike Region 1's planned queue, the road acts as you tap: a talk, a sale or a lesson
 * happens at once and the hours tick on, and "End the day" sleeps and moves the caravan.
 */

import { healerTarget, INJURY_NAME, HEAL_HOURS, FRIEND_HEAL, SET_BONE_TRUST } from '../artificer/injuries';
import { ROUTE, ROAD_DAYS, ROAD_CRAFTS, WAGON_CRAFT_HOURS, HELP_HOURS, TEND_HOURS, peopleHere, legOf, daysLeftOnLeg, villageOf, questsHere, tradeTerms, lessonFee, healFee, type RoadState } from '../artificer/road';
import { peopleOf, personById, VILLAGES, TALK_HOURS, LESSON_HOURS, APPRAISE_HOURS, FRIEND_LESSON, CONTACT_TRUST, type Person, type Role } from '../artificer/villages';
import { questById, canComplete, OFFER_TRUST, QUESTS, type QuestTemplate } from '../artificer/quests';
import { sellPrice, buyPrice, isGood, KIND_OF, TRADE_HOURS, FRIEND_TRUST, WANTED } from '../artificer/trade';
import { techniqueById } from '../artificer/techniques';
import { DAY_HOURS, STUDY_CONCEPTS } from '../artificer/region1';
import { focusKey, focusLabel, focusInline, parseFocus } from '../artificer/focus';
import { answerFor, ASK_HOURS } from '../artificer/asks';

const esc = (t: string | number): string => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

/** What the road screen remembers between redraws: which villager's sheet is open. */
export interface RoadUi { person: string | null }

const ROLE_ICON: Readonly<Record<Role, string>> = { trader: '⚖️', teacher: '📖', healer: '🌿', elder: '🕯️', smith: '⚒️', hunter: '🏹', caravaneer: '🛞', tinker: '🔧' };
/** Store goods by their screen names. */
const GOOD_NAME: Readonly<Record<string, string>> = { rawFood: 'food', water: 'water', firewood: 'firewood', materials: 'materials', rations: 'rations', stone: 'stone', hides: 'hides' };
const itemName = (id: string): string => GOOD_NAME[id] ?? id.replace(/-/g, ' ');
/** A culture id as words ("caravan-folk" → "caravan folk"). */
const cultureName = (id: string): string => id.replace(/-/g, ' ');

const hoursLeft = (r: RoadState): number => Math.max(0, DAY_HOURS - r.hoursToday);
/** A button that runs one road action, disabled (with the reason as its title) when the day is spent. */
function act(r: RoadState, id: string, label: string, hours: number, opts: { cls?: string; why?: string | null } = {}): string {
  const why = opts.why ?? (hoursLeft(r) <= 0 ? 'The day is spent — end it' : null);
  return `<button class="btn ${opts.cls ?? ''}" data-road="${esc(id)}" ${why ? `disabled title="${esc(why)}"` : ''}>${label}${hours ? ` <span class="h">${hours}h</span>` : ''}</button>`;
}

// ── Route strip ─────────────────────────────────────────────────────────────

/**
 * Greywind Reach → the villages → Mistheim, with the wagon where the caravan is. The days
 * left at this stop are the deadline here, the way the winter countdown was in the Reach.
 */
export function routeStrip(r: RoadState): string {
  const villages = ROUTE.filter(l => l.kind === 'village');
  const stops = ['Greywind Reach', ...villages.map(v => (v.kind === 'village' ? v.name : '')), 'Mistheim'];
  // Where the wagon is: stop i, or between stops i and i+1 (travel leg).
  const villageIdx = (leg: number): number => ROUTE.slice(0, leg + 1).filter(l => l.kind === 'village').length;
  const leg = legOf(r);
  const pos = r.outcome?.kind === 'arrived' ? stops.length - 1
    : leg.kind === 'village' ? villageIdx(r.leg) : villageIdx(r.leg) + Math.min(0.85, (r.legDay - 0.5) / leg.days);
  const left = daysLeftOnLeg(r);
  const pct = (i: number): number => (i / (stops.length - 1)) * 100;
  const deadline = r.outcome ? (r.outcome.kind === 'arrived' ? 'Through the gates of Mistheim.' : 'The road ends here.')
    : leg.kind === 'village' ? (left === 1 ? 'The caravan rolls out at dawn.' : `The caravan rolls out in ${plural(left - 1, 'day')}.`)
    : `On the wagon to ${leg.to} — ${left === 1 ? 'arriving tomorrow' : `${plural(left, 'day')} to go`}.`;
  return `<section class="box route"><p class="eyebrow">THE CARAVAN ROAD — ${r.outcome ? `${Math.min(r.day, ROAD_DAYS)} DAYS ON THE ROAD` : `DAY ${r.day} OF ${ROAD_DAYS}`}</p>
    <div class="routeline" role="img" aria-label="Route: ${esc(stops.join(', '))}; the caravan is ${esc(deadline)}">
      <div class="rl-track"></div><div class="rl-done" style="width:${pct(pos)}%"></div>
      ${stops.map((s, i) => `<div class="rl-stop ${i < pos ? 'past' : i === pos ? 'here' : ''}" style="left:${pct(i)}%"><span class="dot"></span><span class="nm">${esc(s)}</span></div>`).join('')}
      <div class="rl-wagon" style="left:${pct(pos)}%" title="The caravan">🛞</div>
    </div>
    <p class="deadline ${leg.kind === 'village' && left === 1 && !r.outcome ? 'urgent' : ''}">${esc(deadline)}</p></section>`;
}

// ── Status ──────────────────────────────────────────────────────────────────

/** Vitals, stores, marks and the day's hours, in one row. */
export function roadStatus(r: RoadState): string {
  const v = r.vitals;
  const bar = (label: string, cur: number, cap: number, cls: string): string =>
    `<div class="rbar"><span class="rk">${label}</span><span class="track"><span class="fill ${cls}" style="width:${Math.max(0, Math.min(100, (cur / cap) * 100))}%"></span></span><span class="rv">${Math.round(cur)}</span></div>`;
  const st = r.stores;
  return `<section class="box rstatus">
    <div class="rbars">${bar('VIGOR', v.vigor.current, v.vigor.cap, 'vig')}${bar('CLARITY', v.clarity.current, v.clarity.cap, 'cla')}${bar('CONDITION', v.condition, 100, 'con')}</div>
    <div class="res"><span class="chip">🍖 ${st.rawFood + st.rations} food</span><span class="chip">💧 ${st.water} water</span><span class="chip">🪙&nbsp;<b>${r.marks}</b>&nbsp;marks</span><span class="chip">⏳ ${hoursLeft(r)}h left today</span></div>
  </section>`;
}

/** The latest thing that happened today — so a tap's result (or why it was refused) is right there. */
export function lastNews(r: RoadState): string {
  const l = r.log.at(-1);
  if (!l) return '';
  return `<p class="news ${l.kind}">${esc(l.text)}</p>`;
}

// ── The wagon ───────────────────────────────────────────────────────────────

/** A travel day: your fellow travellers, rest, and plainly what has to wait for the next village. */
function wagonView(r: RoadState, ui: RoadUi): string {
  const leg = legOf(r);
  const to = leg.kind === 'travel' ? leg.to : '';
  const travellers = peopleHere(r);
  const open = travellers.find(p => p.id === ui.person) ?? null;
  return `<div class="cols">
    <section class="box wagon"><p class="eyebrow">ON THE WAGON</p>
      <div class="wagonart" aria-hidden="true">🐂🐂 🛞━━🛞 <span>⛺</span> 🛞━━🛞</div>
      <p class="mood">The caravan rolls on towards ${esc(to)}. The barrels water everyone on the road; the nights are mild.</p>
      ${r.owesHelp ? `<p class="owed">🐂 You owe Bodil <b>${r.owesHelp} day${r.owesHelp === 1 ? '' : 's'}' help</b> for your passage — before ${esc(to === 'Hollowford' ? 'Hollowford' : 'the next village')}. Help drive &amp; pitch camp below.</p>` : ''}
      <p class="fgroup">FELLOW TRAVELLERS — TAP TO TALK${tradeTerms(r) ? ' OR TRADE' : ''}</p>
      <div class="people">${travellers.map(p => personCard(r, p, p === open)).join('')}</div>
      ${open ? personSheet(r, open) : ''}
      ${handsFree(r, true)}
      <div class="runbar" style="margin-top:12px">${act(r, 'rest', '☕ REST A WHILE', 0)}<button class="btn go" data-cmd="roadday">☾ END THE DAY</button></div>
    </section>
    <section class="box"><p class="eyebrow">NOT FROM THE WAGON</p>
      <ul class="cant">
        <li>🪓 <b>Gathering, felling, building, scouting</b> — the wagon keeps rolling.</li>
        <li>⚖️ <b>Village trade</b> — on the wagon only ${esc(tradeTerms(r)?.name ?? 'the merchant')} trades; every village has its own trader.</li>
        <li>❗ <b>Quests</b> — people ask for help once they trust you.</li>
        <li>📖 <b>Lessons</b> and <b>appraisals</b> — teachers live in the villages.</li>
        <li>💬 <b>Villagers</b> — only your fellow travellers ride with you until ${esc(to)}.</li>
      </ul>
      ${questLog(r, true)}
    </section></div>`;
}

// ── Villages ────────────────────────────────────────────────────────────────

/** Hands and mind free (#1245): craft what you know, study, mend — and on the wagon, help the caravan. */
function handsFree(r: RoadState, onWagon: boolean): string {
  const crafts = r.known.filter(id => ROAD_CRAFTS[id]);
  return `<div class="sheetpart"><p class="fgroup">HANDS FREE — CRAFT · STUDY · MEND${onWagon ? ' · HELP' : ''}</p>
    <div class="lessons">${crafts.map(id => act(r, `craft:${id}`, `🛠 ${esc(itemName(id))}`, WAGON_CRAFT_HOURS)).join('')}</div>
    <div class="lessons">${STUDY_CONCEPTS(r).map(c => act(r, `study:${c}`, `📖 ${esc(c)}`, 3)).join('')}</div>
    <div class="lessons">${act(r, 'tend', '🧵 MEND GEAR', TEND_HOURS)}${onWagon ? act(r, 'help', '🐂 HELP DRIVE &amp; PITCH CAMP', HELP_HOURS) : ''}</div></div>`;
}

/** A villager's mark: a portrait-sized badge, their role's colour and icon. */
export const badge = (p: Person, size = 44): string =>
  `<span class="vbadge r-${p.role}" style="width:${size}px;height:${size}px" aria-hidden="true"><span>${esc(p.name[0])}</span><i>${ROLE_ICON[p.role]}</i></span>`;

/** One person's card: name, role, culture, trust, and what they have for you. Tap to open their sheet. */
function personCard(r: RoadState, p: Person, open: boolean): string {
  const trust = Math.round(r.trust[p.id] ?? 0);
  const lore = (r.told[p.id] ?? 0) < p.lore.length;
  const quest = questsHere(r).find(q => q.giver === p.id) ?? Object.keys(r.quests).map(questById).find(q => q?.giver === p.id && r.quests[q.id] === 'active');
  const trades = !!tradeTerms(r) && tradeTerms(r)!.trader === p.id;
  const icons = [lore && '<span title="Has more to tell">📜</span>', quest && '<span title="Has a quest for you">❗</span>', p.teaches && `<span title="Teaches ${esc(p.teaches.skill)}">🎓</span>`, trades && '<span title="Trades">⚖️</span>'].filter(Boolean).join('');
  return `<button class="pcard ${open ? 'on' : ''}" data-person="${esc(p.id)}" aria-expanded="${open}">
    ${badge(p)}<span class="pinfo"><b>${esc(p.name)}</b><span class="prole">${esc(p.role)} · ${esc(p.people)} · ${esc(cultureName(p.culture))}</span>
    <span class="tbar" title="Trust ${trust}/100"><span style="width:${trust}%" class="${trust >= CONTACT_TRUST ? 'friend' : ''}"></span></span><span class="tnum">trust ${trust}${r.contacts.includes(p.id) ? ' · remembers you' : ''}</span></span>
    <span class="picons">${icons}</span></button>`;
}

/** Their quest, from your side: on offer, or taken (and how close you are). */
function questBlock(r: RoadState, p: Person): string {
  const offered = questsHere(r).find(q => q.giver === p.id);
  const taken = Object.entries(r.quests).map(([id, st]) => ({ q: questById(id), st })).find(x => x.q?.giver === p.id);
  if (offered) {
    return `<div class="sheetpart"><p class="fgroup">QUEST — ${esc(offered.title)}</p><p class="say">“${esc(offered.offer)}”</p>
      <p class="mood">${esc(needsText(offered))} · reward ${esc(rewardText(offered))}</p>${act(r, `accept:${offered.id}`, '✓ TAKE IT ON', 0, { cls: 'go', why: null })}</div>`;
  }
  if (taken?.q) {
    const q = taken.q;
    if (taken.st !== 'active') return `<div class="sheetpart"><p class="fgroup">QUEST — ${esc(q.title)}</p><p class="mood">${taken.st === 'done' ? '✓ Done.' : taken.st === 'failed' ? '✗ Failed.' : '✗ Left undone.'}</p></div>`;
    const why = q.needs.kind === 'deliver' ? 'completes on arrival' : canComplete(q, r);
    return `<div class="sheetpart"><p class="fgroup">QUEST — ${esc(q.title)}</p><p class="mood">${esc(needsText(q))}${why ? ` · <span class="warn">${esc(why)}</span>` : ' · <span class="ok">ready</span>'}</p>
      ${q.needs.kind === 'deliver' ? '' : act(r, `complete:${q.id}`, '✓ COMPLETE', questHours(q), { cls: 'go', why: why ?? undefined })}</div>`;
  }
  // Someone with a need who doesn't trust you enough yet to ask.
  const shy = QUESTS.some(q => q.giver === p.id) && (r.trust[p.id] ?? 0) < OFFER_TRUST;
  return shy ? `<div class="sheetpart"><p class="mood">${esc(p.name)} doesn't know you well enough to ask for anything yet.</p></div>` : '';
}

const questHours = (q: QuestTemplate): number => (q.needs.kind === 'repair' ? q.needs.hours : q.needs.kind === 'scout' ? q.needs.hours + q.needs.walk : 1);

function needsText(q: QuestTemplate): string {
  const n = q.needs;
  switch (n.kind) {
    case 'fetch': return `Bring ${n.qty} ${itemName(n.item)}`;
    case 'craft': return `Hand over a ${n.grade} or better ${itemName(n.item)}`;
    case 'repair': return `Needs ${n.concept} rank ${n.rank} and ${n.hours}h of work`;
    case 'scout': return `${n.hours}h out and ${n.walk}h of walking${n.minScouting ? ' — for a practised scout' : ''}`;
    case 'deliver': return `Carry ${n.qty} ${itemName(n.item)} to ${personById(n.recipient)?.name ?? n.recipient} in ${VILLAGES[n.to]?.name ?? n.to}`;
  }
}
const rewardText = (q: QuestTemplate): string =>
  [`${q.reward.marks} marks`, q.reward.item && `${q.reward.item.qty} ${itemName(q.reward.item.item)}`, q.reward.recipe && `the ${itemName(q.reward.recipe)} recipe`].filter(Boolean).join(', ');

/** The trade panel: your goods at this trader's price (grade and wants shown), and their stock. */
function tradePanel(r: RoadState): string {
  const t = tradeTerms(r);
  if (!t) return '';
  const friend = t.trust >= FRIEND_TRUST;
  const wanted = (item: string): boolean => t.wants.includes(KIND_OF[item]);
  const goods = Object.entries(r.stores).filter(([k, n]) => n > 0 && isGood(k));
  const yours = [
    ...goods.map(([k, n]) => `<li><span class="it">${esc(itemName(k))} <span class="q">×${n}</span>${wanted(k) ? ' <span class="want">wanted</span>' : ''}</span><span class="pr">${sellPrice(k, 'sound', 1, t)}</span>${act(r, `sell:${k}`, 'SELL 1', TRADE_HOURS)}</li>`),
    ...r.tools.filter(x => KIND_OF[x.item]).map(x => `<li><span class="it">${esc(itemName(x.item))} <span class="g g-${x.grade}">${x.grade}</span>${wanted(x.item) ? ' <span class="want">wanted</span>' : ''}</span><span class="pr">${sellPrice(x.item, x.grade, 1, t)}</span>${act(r, `sell:${x.item}:${x.grade}`, 'SELL', TRADE_HOURS)}</li>`),
  ];
  const theirs = t.sells.map(g => `<li><span class="it">${esc(itemName(g))}</span><span class="pr">${buyPrice(g as never, 1, t)}</span>${act(r, `buy:${g}:1`, 'BUY 1', TRADE_HOURS, { why: r.marks < buyPrice(g as never, 1, t) ? 'Not enough marks' : undefined })}${act(r, `buy:${g}:5`, '×5', 0, { why: r.marks < buyPrice(g as never, 5, t) ? `5 cost ${buyPrice(g as never, 5, t)} marks` : undefined })}</li>`);
  return `<div class="sheetpart trade"><p class="fgroup">TRADE — prices in marks${friend ? ' · <span class="ok">friend’s rate</span>' : ''}</p>
    <p class="mood">${esc(t.name)} wants ${t.wants.join(' and ')} goods, and pays ×${WANTED} for them. Grade sets the price.</p>
    <div class="tcols"><div><p class="fgroup">YOU SELL</p><ul class="tlist">${yours.join('') || '<li class="mood">Nothing to sell.</li>'}</ul></div>
    <div><p class="fgroup">THEY SELL · you have ${r.marks}</p><ul class="tlist">${theirs.join('')}</ul></div></div></div>`;
}

/** Lessons and an honest appraisal, from someone who teaches. */
function lessonPanel(r: RoadState, p: Person): string {
  const t = p.teaches;
  if (!t) return '';
  const fee = lessonFee(r, p.id);
  const why = fee > r.marks ? `${fee} marks — you have ${r.marks}` : undefined;
  const things = [
    ...t.techniques.map(id => ({ id, label: techniqueById(id)?.name ?? id, known: r.techniques.includes(id), what: 'technique' })),
    ...t.recipes.map(id => ({ id, label: itemName(id), known: r.known.includes(id), what: 'recipe' })),
    ...(t.concept ? [{ id: t.concept, label: t.concept, known: false, what: 'concept' }] : []),
  ];
  return `<div class="sheetpart"><p class="fgroup">LESSONS — ${esc(t.skill)} · ${fee ? `${fee} marks each` : 'free between friends'}${fee && (r.trust[p.id] ?? 0) < FRIEND_LESSON ? ` (free at trust ${FRIEND_LESSON})` : ''}</p>
    <div class="lessons">${things.map(x => (x.known ? `<span class="chip known">✓ ${esc(x.label)}</span>` : act(r, `learn:${p.id}:${x.id}`, `${x.what === 'technique' ? '🎓' : x.what === 'recipe' ? '📐' : '💡'} ${esc(x.label)}`, LESSON_HOURS, { why }))).join('')}</div>
    <div class="runbar">${act(r, `appraise:${p.id}`, '⚖ HOW GOOD AM I, REALLY?', APPRAISE_HOURS, { why: r.appraised.includes(p.id) ? `${p.name} has told you already` : undefined })}</div></div>`;
}

/** A healer's care (#1394): what she'd tend, what it costs, and whether she'd set a grave injury. */
function healPanel(r: RoadState, p: Person): string {
  if (p.role !== 'healer') return '';
  const trust = r.trust[p.id] ?? 0;
  const fee = healFee(r, p.id);
  const target = healerTarget(r.injuries, trust);
  const why = !target ? (r.character.harms?.length ? undefined : 'Nothing to tend') : fee > r.marks ? `${fee} marks — you have ${r.marks}` : undefined;
  const label = target ? `🌿 TEND MY ${INJURY_NAME[target.kind].toUpperCase()}` : r.character.harms?.length ? '🌿 ASK ABOUT AN OLD WOUND' : '🌿 TEND AN INJURY';
  return `<div class="sheetpart"><p class="fgroup">HEALING — ${fee ? `${fee} marks` : 'free between friends'}${fee ? ` (free at trust ${FRIEND_HEAL})` : ''}${trust >= SET_BONE_TRUST ? ' · she will set a grave injury properly' : ` · sets a grave injury properly at trust ${SET_BONE_TRUST}`}</p>
    <div class="runbar">${act(r, `heal:${p.id}`, label, HEAL_HOURS, { why })}</div></div>`;
}

/**
 * A conversation (#1495): Chat (the lore line, as trust allows) and, with a focus on a topic, a
 * skill or a concept, Ask about it. What they've told you when asked stays on their sheet.
 */
function conversation(r: RoadState, p: Person, told: number): string {
  const f = r.focus && r.focus.kind !== 'goal' ? r.focus : null;
  const answered = r.asked?.[p.id] ?? [];
  const ask = f ? act(r, `ask:${p.id}`, `❓ ASK ABOUT ${esc(focusLabel(f).toUpperCase())}`, ASK_HOURS, answered.includes(focusKey(f)) ? { why: `${p.name} has told you what they know about ${focusInline(f)}` } : {}) : '';
  const answers = answered.map(k => {
    const a = answerFor(p.id, k);
    const about = parseFocus(k);
    return a ? `<p class="mood told"><b>${esc(about ? focusLabel(about) : k)}</b> — “${esc(a.text)}”</p>` : '';
  }).join('');
  return `<div class="sheetpart"><p class="mood">${told < p.lore.length ? 'They have more to tell, as they come to trust you.' : 'They have told you all they know — but time together still builds trust.'}</p>
    <div class="runbar">${act(r, `talk:${p.id}`, '💬 CHAT', TALK_HOURS)}${ask}</div>
    ${f ? '' : '<p class="mood">Set a focus on a topic, a skill or a concept, and you\'ll have something to ask them about.</p>'}
    ${answers ? `<p class="fgroup">WHAT THEY'VE TOLD YOU WHEN ASKED</p>${answers}` : ''}</div>`;
}

/** The open villager's sheet: talk, their quest, and trade or lessons if they offer them. */
function personSheet(r: RoadState, p: Person): string {
  const told = r.told[p.id] ?? 0;
  const isTrader = tradeTerms(r)?.trader === p.id;
  return `<section class="box sheet"><div class="sheethead">${badge(p, 56)}<div><h3>${esc(p.name)}</h3><p class="prole">${esc(p.role)} · ${esc(p.people)} · ${esc(cultureName(p.culture))} · trust ${Math.round(r.trust[p.id] ?? 0)}</p><p class="mood" style="margin:2px 0 0">${esc(p.personality)}</p></div>
    <button class="pill" data-person="${esc(p.id)}" aria-label="Close">✕</button></div>
    ${conversation(r, p, told)}
    ${questBlock(r, p)}${isTrader ? tradePanel(r) : ''}${lessonPanel(r, p)}${healPanel(r, p)}</section>`;
}

/** A village day: everyone in it, the open sheet, and the way to end the day. */
function villageView(r: RoadState, ui: RoadUi): string {
  const id = villageOf(r)!;
  const people = peopleOf(id);
  const open = people.find(p => p.id === ui.person) ?? null;
  return `<section class="box"><p class="eyebrow">${esc(VILLAGES[id].name.toUpperCase())} — TAP SOMEONE TO TALK, TRADE OR LEARN</p>
      <div class="people">${people.map(p => personCard(r, p, p === open)).join('')}</div>
      ${handsFree(r, false)}
      <div class="runbar" style="margin-top:12px">${act(r, 'rest', '☕ REST A WHILE', 0)}<button class="btn go" data-cmd="roadday">☾ END THE DAY</button></div></section>
    ${open ? personSheet(r, open) : ''}`;
}

// ── Quest log ───────────────────────────────────────────────────────────────

/** Every quest you've taken: what's still needed, and the deadline (before the caravan leaves). */
export function questLog(r: RoadState, compact = false): string {
  const taken = Object.entries(r.quests).map(([id, st]) => ({ q: questById(id)!, st })).filter(x => x.q);
  const open = taken.filter(x => x.st === 'active');
  const closed = taken.filter(x => x.st !== 'active');
  const deadline = (q: QuestTemplate): string => {
    if (q.needs.kind === 'deliver') return `on arrival in ${VILLAGES[q.needs.to]?.name ?? q.needs.to}`;
    if (villageOf(r) !== q.village) return 'missed — the caravan left';
    const left = daysLeftOnLeg(r);
    return left === 1 ? 'today — the caravan leaves at dawn' : `${plural(left, 'day')} — before the caravan leaves`;
  };
  const row = (q: QuestTemplate): string => {
    const why = q.needs.kind === 'deliver' ? null : canComplete(q, r);
    return `<li><b>${esc(q.title)}</b> <span class="qwho">for ${esc(personById(q.giver)?.name ?? '')}</span>
      <span class="need">${esc(needsText(q))}${why ? ` — <span class="warn">${esc(why)}</span>` : q.needs.kind === 'deliver' ? '' : ' — <span class="ok">ready to hand in</span>'}</span>
      <span class="due">⏳ ${esc(deadline(q))}</span></li>`;
  };
  const head = `<p class="fgroup" style="margin-top:${compact ? 14 : 0}px">QUEST LOG</p>`;
  if (!taken.length) return `${head}<p class="mood">No quests yet. People ask for help once they trust you (${OFFER_TRUST}+).</p>`;
  return `${head}<ul class="qlog">${open.map(x => row(x.q)).join('') || '<li class="mood">Nothing open.</li>'}</ul>
    ${compact || !closed.length ? '' : `<p class="fgroup" style="margin-top:12px">FINISHED</p><ul class="qlog done">${closed.map(x => `<li><b>${esc(x.q.title)}</b> <span class="qwho">${x.st === 'done' ? '✓ done' : x.st === 'failed' ? '✗ failed' : '✗ left undone'}</span></li>`).join('')}</ul>`}`;
}

// ── The screen ──────────────────────────────────────────────────────────────

/** The road tab: the wagon on a travel day, the village otherwise. */
export const roadView = (r: RoadState, ui: RoadUi): string => (villageOf(r) ? villageView(r, ui) : wagonView(r, ui));

/** Arrival (or the end on the road): how it went, and what the Warden carries on with. */
export function roadEnd(r: RoadState): string {
  const o = r.outcome!;
  const done = Object.values(r.quests).filter(q => q === 'done').length;
  const friends = Object.entries(r.trust).filter(([, t]) => t >= CONTACT_TRUST).map(([id]) => personById(id)?.name ?? id);
  const head = o.kind === 'arrived' ? '🏰 MISTHEIM' : o.kind === 'died' ? '✝ THE ROAD ENDS HERE' : '✝ CARRIED ON AS CARGO';
  const body = o.kind === 'arrived'
    ? 'The walls of Mistheim rise out of the morning mist, and the caravan rolls through the gate. You made it out of the Reach — and you are not arriving with nothing.'
    : o.kind === 'died' ? 'The road was one hardship too many. There is no one to carry on.'
    : 'Your body gave out on the road. The caravan brings you the rest of the way, but this journey is over.';
  return `<section class="box arrive ${o.kind}"><p class="eyebrow">${head}</p><p class="mood">${esc(body)}</p>
    <div class="res"><span class="chip">🪙&nbsp;<b>${r.marks}</b>&nbsp;marks</span><span class="chip">❗ ${plural(done, 'quest')} done</span><span class="chip">🤝 ${plural(friends.length, 'contact')}</span><span class="chip">🎓 ${plural(r.techniques.length, 'technique')}</span></div>
    ${friends.length ? `<p class="mood">Who'll remember you: ${esc(friends.join(', '))}.</p>` : ''}</section>`;
}
