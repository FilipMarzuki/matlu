/**
 * The caravan road's screens (#1252) — presentation only, like the rest of the app:
 * state in, HTML out. The rules live in the sim (`src/artificer/road.ts` and friends);
 * this file only reads them and draws buttons that carry `data-road="<action id>"`.
 *
 * Unlike Region 1's planned queue, the road acts as you tap: a talk, a sale or a lesson
 * happens at once and the hours tick on, and "End the day" sleeps and moves the caravan.
 *
 * Drawn in the viewer's language (#1709): every view takes `t` (English by default, so tests that
 * check the English keep reading it). What people say comes from the catalog by id, or, when the
 * sim hands it over as finished English (an answer, a journal line), through `phrase`/`simLine`.
 */

import { healerTarget, HEAL_HOURS } from '../artificer/injuries';
import { ROUTE, ROAD_DAYS, ROAD_CRAFTS, WAGON_CRAFT_HOURS, HELP_HOURS, TEND_HOURS, peopleHere, legOf, daysLeftOnLeg, villageOf, questsHere, tradeTerms, lessonFee, healFee, questionPlace, journalNow, type RoadState } from '../artificer/road';
import { CLAIMED, HEARSAY, respondedOn, type JournalEntry } from '../artificer/journal';
import { liesOfRun } from '../artificer/claims';
import { asPlayed, peopleOf, personById, VILLAGES, TRAVELLERS, TALK_HOURS, LESSON_HOURS, APPRAISE_HOURS, CONTACT_TRUST, type Person, type Role } from '../artificer/villages';
import { questById, canComplete, OFFER_TRUST, QUESTS, type QuestTemplate } from '../artificer/quests';
import { sellPrice, buyPrice, isGood, localFactor, KIND_OF, TRADE_HOURS, friendly, WANTED } from '../artificer/trade';
import { DAY_HOURS, STUDY_CONCEPTS } from '../artificer/region1';
import { focusKey, parseFocus } from '../artificer/focus';
import { answerFor, tellsFor, TELLS, ASK_HOURS } from '../artificer/asks';
import { playFacts } from '../artificer/history-in-play';
import { pastAbout } from '../artificer/past-topics';
import { SIGNS } from '../artificer/notice';
import { QUESTION_CHARS } from '../artificer/free-questions';
import { answerQuestion, parseLoreKey } from '../artificer/knowledge-questions';
import { featureById, featureOn } from '../artificer/features';
import { feltWord, trueWord } from '../artificer/rapport';
import { makeT, type Key, type T } from '../artificer/i18n';
import { itemIcon } from './item-icons';
import { esc } from './html';
import { aboutKeyText, conceptName, focusInlineText, focusName, questionAboutText, simLine } from './sim-words';
import { cultureName, itemText, listText, marketText, needsText, peopleName, rapportLadder, rapportName, rewardText, roleName, techName } from './road-words';

/** English, for callers (and tests) that don't pass a language. */
const EN: T = makeT('en');

/**
 * What the road screen remembers between redraws: which villager's sheet is open, and the free
 * questions asked this stay (#1575), with what was said back. The words live only here, never in
 * the game's state or save: the game keeps only the topic they matched. `dev` is dev mode (#1579):
 * cards and sheets then show each person's true trust beside how they seem (#1578).
 */
export interface RoadUi { person: string | null; asked?: Record<string, { question: string; topic: string | null; reply: string }>; truths?: boolean }

const ROLE_ICON: Readonly<Record<Role, string>> = { trader: '⚖️', teacher: '📖', healer: '🌿', elder: '🕯️', smith: '⚒️', hunter: '🏹', caravaneer: '🛞', tinker: '🔧' };

const hoursLeft = (r: RoadState): number => Math.max(0, DAY_HOURS - r.hoursToday);
/** One or other of a plural pair (`.one`/`.other`), chosen by `n`. */
const plural = (t: T, key: string, n: number, vars: Record<string, string | number> = {}): string => t(`${key}.${n === 1 ? 'one' : 'other'}` as Key, { n, ...vars });
/** A sentence's first letter up ("the lost herald" → "The lost herald"). */
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A button that runs one road action, disabled (with the reason as its title) when the day is spent. */
function act(r: RoadState, id: string, label: string, hours: number, t: T, opts: { cls?: string; why?: string | null } = {}): string {
  const why = opts.why ?? (hoursLeft(r) <= 0 ? t('road.daySpent') : null);
  return `<button class="btn ${opts.cls ?? ''}" data-road="${esc(id)}" ${why ? `disabled title="${esc(why)}"` : ''}>${label}${hours ? ` <span class="h">${hours}h</span>` : ''}</button>`;
}

// ── Route strip ─────────────────────────────────────────────────────────────

/**
 * Greywind Reach → the villages → Mistheim, with the wagon where the caravan is. The days
 * left at this stop are the deadline here, the way the winter countdown was in the Reach.
 */
export function routeStrip(r: RoadState, t: T = EN): string {
  const villages = ROUTE.filter(l => l.kind === 'village');
  const stops = ['Greywind Reach', ...villages.map(v => (v.kind === 'village' ? v.name : '')), 'Mistheim'];
  // Where the wagon is: stop i, or between stops i and i+1 (travel leg).
  const villageIdx = (leg: number): number => ROUTE.slice(0, leg + 1).filter(l => l.kind === 'village').length;
  const leg = legOf(r);
  const pos = r.outcome?.kind === 'arrived' ? stops.length - 1
    : leg.kind === 'village' ? villageIdx(r.leg) : villageIdx(r.leg) + Math.min(0.85, (r.legDay - 0.5) / leg.days);
  const left = daysLeftOnLeg(r);
  const pct = (i: number): number => (i / (stops.length - 1)) * 100;
  const deadline = r.outcome ? t(r.outcome.kind === 'arrived' ? 'road.arrived' : 'road.ended')
    : leg.kind === 'village' ? (left === 1 ? t('road.rollsDawn') : plural(t, 'road.rollsIn', left - 1))
    : left === 1 ? t('road.onWagonTomorrow', { to: leg.to }) : plural(t, 'road.onWagon', left, { to: leg.to });
  return `<section class="box route"><p class="eyebrow">${esc(r.outcome ? t('road.eyebrowDone', { n: Math.min(r.day, ROAD_DAYS) }) : t('road.eyebrowDay', { n: r.day, total: ROAD_DAYS }))}</p>
    <div class="routeline" role="img" aria-label="${esc(t('road.routeLabel', { stops: stops.join(', '), where: deadline }))}">
      <div class="rl-track"></div><div class="rl-done" style="width:${pct(pos)}%"></div>
      ${stops.map((s, i) => `<div class="rl-stop ${i < pos ? 'past' : i === pos ? 'here' : ''}" style="left:${pct(i)}%"><span class="dot"></span><span class="nm">${esc(s)}</span></div>`).join('')}
      <div class="rl-wagon" style="left:${pct(pos)}%" title="${esc(t('road.caravan'))}">🛞</div>
    </div>
    <p class="deadline ${leg.kind === 'village' && left === 1 && !r.outcome ? 'urgent' : ''}">${esc(deadline)}</p></section>`;
}

// ── Status ──────────────────────────────────────────────────────────────────

/** Vitals, stores, marks and the day's hours, in one row. */
export function roadStatus(r: RoadState, t: T = EN): string {
  const v = r.vitals;
  const bar = (label: string, cur: number, cap: number, cls: string): string =>
    `<div class="rbar"><span class="rk">${esc(label)}</span><span class="track"><span class="fill ${cls}" style="width:${Math.max(0, Math.min(100, (cur / cap) * 100))}%"></span></span><span class="rv">${Math.round(cur)}</span></div>`;
  const st = r.stores;
  return `<section class="box rstatus">
    <div class="rbars">${bar(t('road.vigor'), v.vigor.current, v.vigor.cap, 'vig')}${bar(t('road.clarity'), v.clarity.current, v.clarity.cap, 'cla')}${bar(t('road.condition'), v.condition, 100, 'con')}</div>
    <div class="res"><span class="chip">${itemIcon('rawFood', { fallback: '🍖', alt: t('store.rawFood') })} ${esc(t('road.food', { n: st.rawFood + st.rations }))}</span><span class="chip">${itemIcon('water', { fallback: '💧', alt: t('store.water') })} ${esc(t('road.water', { n: st.water }))}</span><span class="chip">🪙&nbsp;${t('road.marksHtml', { n: r.marks })}</span><span class="chip">⏳ ${esc(t('road.hoursLeft', { n: hoursLeft(r) }))}</span></div>
  </section>`;
}

/** The latest thing that happened today — so a tap's result (or why it was refused) is right there. */
export function lastNews(r: RoadState, t: T = EN): string {
  const l = r.log.at(-1);
  if (!l) return '';
  return `<p class="news ${l.kind}">${esc(simLine(l.text, t))}</p>`;
}

// ── The wagon ───────────────────────────────────────────────────────────────

/** A travel day: your fellow travellers, rest, and plainly what has to wait for the next village. */
function wagonView(r: RoadState, ui: RoadUi, t: T): string {
  const leg = legOf(r);
  const to = leg.kind === 'travel' ? leg.to : '';
  const travellers = peopleHere(r);
  const open = travellers.find(p => p.id === ui.person) ?? null;
  return `<div class="cols">
    <section class="box wagon"><p class="eyebrow">${esc(t('road.onTheWagon'))}</p>
      <div class="wagonart" aria-hidden="true">🐂🐂 🛞━━🛞 <span>⛺</span> 🛞━━🛞</div>
      <p class="mood">${esc(t('road.wagonMood', { to }))}</p>
      ${r.owesHelp ? `<p class="owed">${plural(t, 'road.owesHtml', r.owesHelp, { where: esc(to === 'Hollowford' ? 'Hollowford' : t('road.nextVillage')) })}</p>` : ''}
      <p class="fgroup">${esc(t(tradeTerms(r) ? 'road.fellowTrade' : 'road.fellow'))}</p>
      <div class="people">${travellers.map(p => personCard(r, p, p === open, ui, t)).join('')}</div>
      ${open ? personSheet(r, open, ui, t) : ''}
      ${handsFree(r, true, t)}
      <div class="runbar" style="margin-top:12px">${act(r, 'rest', esc(t('road.rest')), 0, t)}<button class="btn go" data-cmd="roadday">${esc(t('road.endDay'))}</button></div>
    </section>
    <section class="box"><p class="eyebrow">${esc(t('road.notFromWagon'))}</p>
      <ul class="cant">
        <li>${t('road.cantWorkHtml')}</li>
        <li>${t('road.cantTradeHtml', { name: esc(tradeTerms(r)?.name ?? t('road.theMerchant')) })}</li>
        <li>${t('road.cantQuestHtml')}</li>
        <li>${t('road.cantLearnHtml')}</li>
        <li>${t('road.cantVillageHtml', { to: esc(to) })}</li>
      </ul>
      ${questLog(r, true, t)}
    </section></div>`;
}

// ── Villages ────────────────────────────────────────────────────────────────

/** Hands and mind free (#1245): craft what you know, study, mend — and on the wagon, help the caravan. */
function handsFree(r: RoadState, onWagon: boolean, t: T): string {
  const crafts = r.known.filter(id => ROAD_CRAFTS[id]);
  return `<div class="sheetpart"><p class="fgroup">${esc(t(onWagon ? 'road.handsFreeHelp' : 'road.handsFree'))}</p>
    <div class="lessons">${crafts.map(id => act(r, `craft:${id}`, `🛠 ${esc(itemText(id, t))}`, WAGON_CRAFT_HOURS, t)).join('')}</div>
    <div class="lessons">${STUDY_CONCEPTS(r).map(c => act(r, `study:${c}`, `📖 ${esc(conceptName(c, t).toLowerCase())}`, 3, t)).join('')}</div>
    <div class="lessons">${act(r, 'tend', esc(t('road.mend')), TEND_HOURS, t)}${onWagon ? act(r, 'help', esc(t('road.help')), HELP_HOURS, t) : ''}</div></div>`;
}

/** A villager's mark: a portrait-sized badge, their role's colour and icon. */
export const badge = (p: Person, size = 44): string =>
  `<span class="vbadge r-${p.role}" style="width:${size}px;height:${size}px" aria-hidden="true"><span>${esc(p.name[0])}</span><i>${ROLE_ICON[p.role]}</i></span>`;

/** Who sent you to `who` (#1497), as words: "Orrin", "Orrin and Tobin". Empty if no one did. */
function sentBy(r: RoadState, who: string, t: T): string {
  return listText([...new Set((r.leads ?? []).filter(l => l.who === who).map(l => personById(l.from)?.name ?? l.from))], t);
}

/**
 * How someone seems with you (#1578): a word, never the trust number or a bar, and it can be off
 * (rapport.ts). `?dev=truths` adds the truth, in the same amber as the skills' true level.
 */
function rapportTag(r: RoadState, p: Person, ui: RoadUi, t: T): string {
  const word = feltWord(r, p.id);
  const truth = ui.truths ? ` <span class="devtruth" title="${esc(t('road.trueTip'))}">${esc(t('road.true', { word: rapportName(trueWord(r, p.id), t), n: Math.round(r.trust[p.id] ?? 0) }))}</span>` : '';
  return `<span class="rapport rp-${word}" title="${esc(t('road.seemsTip', { name: p.name, ladder: rapportLadder(t) }))}">${esc(rapportName(word, t))}</span>${truth}`;
}

/** Who someone is, in a line: role · People · culture. */
const whoLine = (r: RoadState, p: Person, t: T): string =>
  `${esc(roleName(p.role, t))} · ${esc(peopleName(asPlayed(p, r.features).people, t))} · ${esc(cultureName(p.culture, t))}`;

/** One person's card: name, role, culture, how they seem with you, and what they have for you. Tap to open their sheet. */
function personCard(r: RoadState, p: Person, open: boolean, ui: RoadUi, t: T): string {
  const lore = (r.told[p.id] ?? 0) < p.lore.length;
  const quest = questsHere(r).find(q => q.giver === p.id) ?? Object.keys(r.quests).map(questById).find(q => q?.giver === p.id && r.quests[q.id] === 'active');
  const trades = !!tradeTerms(r) && tradeTerms(r)!.trader === p.id;
  // Signs you've noticed (#1496): what they showed of something you were turning over.
  const seen = (r.noticed?.[p.id] ?? []).map(k => SIGNS[p.id]?.[k]).filter((x): x is string => !!x).map(x => simLine(x, t));
  const sent = sentBy(r, p.id, t);
  const icons = [seen.length && `<span title="${esc(seen.join(' '))}">👁</span>`, lore && `<span title="${esc(t('road.moreToTell'))}">📜</span>`, quest && `<span title="${esc(t('road.hasQuest'))}">❗</span>`, p.teaches && `<span title="${esc(t('road.teaches', { skill: t(`skill.${p.teaches.skill}`).toLowerCase() }))}">🎓</span>`, trades && `<span title="${esc(t('road.trades'))}">⚖️</span>`].filter(Boolean).join('');
  return `<button class="pcard ${open ? 'on' : ''}" data-person="${esc(p.id)}" aria-expanded="${open}">
    ${badge(p)}<span class="pinfo"><b>${esc(p.name)}</b><span class="prole">${whoLine(r, p, t)}</span>
    <span class="tnum">${rapportTag(r, p, ui, t)}${r.contacts.includes(p.id) ? esc(t('road.remembers')) : ''}${sent ? esc(t('road.mentioned', { names: sent })) : ''}</span></span>
    <span class="picons">${icons}</span></button>`;
}

/** Their quest, from your side: on offer, or taken (and how close you are). */
function questBlock(r: RoadState, p: Person, t: T): string {
  const offered = questsHere(r).find(q => q.giver === p.id);
  const taken = Object.entries(r.quests).map(([id, st]) => ({ q: questById(id), st })).find(x => x.q?.giver === p.id);
  const title = (q: QuestTemplate): string => esc(t('road.quest', { title: t(`quest.${q.id}.title` as Key) }));
  if (offered) {
    return `<div class="sheetpart"><p class="fgroup">${title(offered)}</p><p class="say">“${esc(t(`quest.${offered.id}.offer` as Key))}”</p>
      <p class="mood">${esc(t('road.reward', { needs: needsText(offered, t), reward: rewardText(offered, t) }))}</p>${act(r, `accept:${offered.id}`, esc(t('road.takeIt')), 0, t, { cls: 'go', why: null })}</div>`;
  }
  if (taken?.q) {
    const q = taken.q;
    if (taken.st !== 'active') return `<div class="sheetpart"><p class="fgroup">${title(q)}</p><p class="mood">${esc(t(taken.st === 'done' ? 'road.questDone' : taken.st === 'failed' ? 'road.questFailed' : 'road.questExpired'))}</p></div>`;
    const why = q.needs.kind === 'deliver' ? t('road.onArrival') : canComplete(q, r);
    return `<div class="sheetpart"><p class="fgroup">${title(q)}</p><p class="mood">${esc(needsText(q, t))}${why ? ` · <span class="warn">${esc(q.needs.kind === 'deliver' ? why : simLine(why, t))}</span>` : ` · <span class="ok">${esc(t('road.ready'))}</span>`}</p>
      ${q.needs.kind === 'deliver' ? '' : act(r, `complete:${q.id}`, esc(t('road.complete')), questHours(q), t, { cls: 'go', why: why ? simLine(why, t) : undefined })}</div>`;
  }
  // Someone with a need who doesn't trust you enough yet to ask.
  const shy = QUESTS.some(q => q.giver === p.id && (!q.feature || featureOn(r.features, q.feature))) && (r.trust[p.id] ?? 0) < OFFER_TRUST;
  return shy ? `<div class="sheetpart"><p class="mood">${esc(t('road.shy', { name: p.name }))}</p></div>` : '';
}

const questHours = (q: QuestTemplate): number => (q.needs.kind === 'repair' ? q.needs.hours : q.needs.kind === 'scout' ? q.needs.hours + q.needs.walk : 1);

/** The trade panel: your goods at this trader's price (grade and wants shown), and their stock. */
function tradePanel(r: RoadState, t: T): string {
  const terms = tradeTerms(r);
  if (!terms) return '';
  const friend = friendly(terms);
  const wanted = (item: string): boolean => terms.wants.includes(KIND_OF[item]);
  // The village's own market (#1599): a tag on what's cheap or dear here.
  const here = (item: string): string => {
    const f = localFactor(item, terms.local);
    return f < 1 ? ` <span class="q">${esc(t('trade.plentiful'))}</span>` : f > 1 ? ` <span class="want">${esc(t('trade.scarce'))}</span>` : '';
  };
  const want = (item: string): string => (wanted(item) ? ` <span class="want">${esc(t('trade.wanted'))}</span>` : '');
  const goods = Object.entries(r.stores).filter(([k, n]) => n > 0 && isGood(k));
  const yours = [
    ...goods.map(([k, n]) => `<li><span class="it">${itemIcon(k, { alt: itemText(k, t) })}${esc(itemText(k, t))} <span class="q">×${n}</span>${want(k)}${here(k)}</span><span class="pr">${sellPrice(k, 'sound', 1, terms)}</span>${act(r, `sell:${k}`, esc(t('trade.sell1')), TRADE_HOURS, t)}</li>`),
    ...r.tools.filter(x => KIND_OF[x.item]).map(x => `<li><span class="it">${itemIcon(x.item, { alt: itemText(x.item, t) })}${esc(itemText(x.item, t))} <span class="g g-${x.grade}">${esc(t(`grade.${x.grade}`))}</span>${want(x.item)}${here(x.item)}</span><span class="pr">${sellPrice(x.item, x.grade, 1, terms)}</span>${act(r, `sell:${x.item}:${x.grade}`, esc(t('trade.sell')), TRADE_HOURS, t)}</li>`),
  ];
  const theirs = terms.sells.map(g => `<li><span class="it">${itemIcon(g, { alt: itemText(g, t) })}${esc(itemText(g, t))}${here(g)}</span><span class="pr">${buyPrice(g as never, 1, terms)}</span>${act(r, `buy:${g}:1`, esc(t('trade.buy1')), TRADE_HOURS, t, { why: r.marks < buyPrice(g as never, 1, terms) ? t('trade.noMarks') : undefined })}${act(r, `buy:${g}:5`, esc(t('trade.buy5')), 0, t, { why: r.marks < buyPrice(g as never, 5, terms) ? t('trade.five', { n: buyPrice(g as never, 5, terms) }) : undefined })}</li>`);
  return `<div class="sheetpart trade"><p class="fgroup">${esc(t('trade.head'))}${friend ? ` · <span class="ok">${esc(t('trade.friend'))}</span>` : ''}</p>
    <p class="mood">${esc(t('trade.wants', { name: terms.name, kinds: listText(terms.wants.map(k => t(`kind.${k}`)), t), x: WANTED }))}${terms.local ? ` ${esc(marketText(terms.local, t))}` : ''}</p>
    <div class="tcols"><div><p class="fgroup">${esc(t('trade.youSell'))}</p><ul class="tlist">${yours.join('') || `<li class="mood">${esc(t('trade.nothing'))}</li>`}</ul></div>
    <div><p class="fgroup">${esc(t('trade.theySell', { n: r.marks }))}</p><ul class="tlist">${theirs.join('')}</ul></div></div></div>`;
}

/** Lessons and an honest appraisal, from someone who teaches. */
function lessonPanel(r: RoadState, p: Person, t: T): string {
  const teach = p.teaches;
  if (!teach) return '';
  const fee = lessonFee(r, p.id);
  const why = fee > r.marks ? t('lesson.cost', { n: fee, have: r.marks }) : undefined;
  const things = [
    ...teach.techniques.map(id => ({ id, label: techName(id, t), known: r.techniques.includes(id), what: 'technique' })),
    ...teach.recipes.map(id => ({ id, label: itemText(id, t), known: r.known.includes(id), what: 'recipe' })),
    ...(teach.concept ? [{ id: teach.concept, label: conceptName(teach.concept, t).toLowerCase(), known: false, what: 'concept' }] : []),
  ];
  // A locked thing never says a number (#1578): "free for a friend", not the trust it takes.
  return `<div class="sheetpart"><p class="fgroup">${esc(t('lesson.head', { skill: t(`skill.${teach.skill}`).toLowerCase(), fee: fee ? t('lesson.fee', { n: fee }) : t('lesson.free') }))}</p>
    <div class="lessons">${things.map(x => (x.known ? `<span class="chip known">✓ ${esc(x.label)}</span>` : act(r, `learn:${p.id}:${x.id}`, `${x.what === 'technique' ? '🎓' : x.what === 'recipe' ? '📐' : '💡'} ${esc(x.label)}`, LESSON_HOURS, t, { why }))).join('')}</div>
    <div class="runbar">${act(r, `appraise:${p.id}`, esc(t('lesson.appraise')), APPRAISE_HOURS, t, { why: r.appraised.includes(p.id) ? t('lesson.appraised', { name: p.name }) : undefined })}</div></div>`;
}

/** A healer's care (#1394): what she'd tend, what it costs, and whether she'd set a grave injury. */
function healPanel(r: RoadState, p: Person, t: T): string {
  if (p.role !== 'healer') return '';
  const fee = healFee(r, p.id);
  const target = healerTarget(r.injuries, r.trust[p.id] ?? 0);
  const why = !target ? (r.character.harms?.length ? undefined : t('heal.nothing')) : fee > r.marks ? t('lesson.cost', { n: fee, have: r.marks }) : undefined;
  const label = target ? t('heal.tend', { what: t(`injury.${target.kind}`).toUpperCase() }) : r.character.harms?.length ? t('heal.oldWound') : t('heal.injury');
  // No numbers, and no telling whether she trusts you enough to set a bone (#1578): you find out when she does.
  return `<div class="sheetpart"><p class="fgroup">${esc(t('heal.head', { fee: fee ? t('heal.fee', { n: fee }) : t('lesson.free') }))}</p>
    <div class="runbar">${act(r, `heal:${p.id}`, esc(label), HEAL_HOURS, t, { why })}</div></div>`;
}

/** One thing they've told you: what it was about, and their words. */
const toldLine = (about: string, words: string): string => `<p class="mood told"><b>${esc(about)}</b> — “${esc(words)}”</p>`;

/**
 * A conversation (#1495): Chat (the lore line, as trust allows) and, with a focus on a topic, a
 * skill or a concept, Ask about it. What they've told you when asked stays on their sheet.
 */
function conversation(r: RoadState, p: Person, told: number, ui: RoadUi, t: T): string {
  const f = r.focus && r.focus.kind !== 'goal' ? r.focus : null;
  const answered = r.asked?.[p.id] ?? [];
  const ask = f ? act(r, `ask:${p.id}`, esc(t('talk.ask', { about: focusName(f, t).toUpperCase() })), ASK_HOURS, t, answered.includes(focusKey(f)) ? { why: t('talk.asked', { name: p.name, about: focusInlineText(f, t) }) } : {}) : '';
  const answers = answered.map(k => {
    // A lie told instead of an answer (#1580): it reads like any other, since that's what it was.
    if (k.startsWith(CLAIMED)) {
      const topic = k.slice(CLAIMED.length);
      const lie = liesOfRun(r)[p.id]?.find(l => l.about === topic);
      const about = parseFocus(topic);
      return lie ? toldLine(about ? focusName(about, t) : topic, simLine(lie.text, t)) : '';
    }
    // What you told them about (#1499): `deed:<id>`, answered by their tell.
    const deed = k.startsWith('deed:') ? k.slice(5) : '';
    const tell = deed ? TELLS[p.id]?.[deed] : undefined;
    if (tell) return toldLine(cap(t(`tell.${p.id}.${deed}.label` as Key)), t(`tell.${p.id}.${deed}.answer` as Key));
    // Their people's ways, told to a free question (#1611): kept as a lore key, said again as
    // they'd say it now (the words depend on trust, and the save keeps only the key).
    if (parseLoreKey(k)) {
      // In the same place as when they said it (#1619), so it reads the same.
      const lore = answerQuestion(p, k, r.trust[p.id] ?? 0, [], { place: questionPlace(r) });
      const label = questionAboutText(k, t);
      return lore.kind === 'told' ? toldLine(cap(label), simLine(lore.answer.text, t)) : '';
    }
    // The run's facts (#1656): with history-in-play on, what they told you of their village's past too.
    // News passed on (#1661, `hearsay:<topic>`) is the topic told with it; the topic after it, without.
    const topic = k.startsWith(HEARSAY) ? k.slice(HEARSAY.length) : k;
    const a = answerFor(p.id, topic, playFacts(r), topic === k && answered.includes(`${HEARSAY}${topic}`));
    // The past (#1656) by how a question names it, in the viewer's language (#1711: "Pesten", "Ätten Crowhelm").
    const past = pastAbout(topic) ? questionAboutText(topic, t) : null;
    return a ? toldLine(parseFocus(topic) ? focusName(parseFocus(topic), t) : past ? cap(past) : topic, simLine(a.text, t)) : '';
  }).join('');
  // What you did in the Reach that means something to them (#1499): one button per deed, greyed once told.
  const tells = tellsFor(p.id, r.deeds).map(x => {
    const what = t(`tell.${p.id}.${x.deed}.label` as Key);
    return act(r, `tell:${p.id}:${x.deed}`, esc(t('talk.tell', { what: what.toUpperCase() })), ASK_HOURS, t, answered.includes(`deed:${x.deed}`) ? { why: t('talk.told', { name: p.name, what }) } : {});
  }).join('');
  return `<div class="sheetpart"><p class="mood">${esc(t(told < p.lore.length ? 'talk.more' : 'talk.allTold'))}</p>
    <div class="runbar">${act(r, `talk:${p.id}`, esc(t('talk.chat')), TALK_HOURS, t)}${ask}${tells}</div>
    ${f ? '' : `<p class="mood">${esc(t('talk.setFocus'))}</p>`}
    ${freeQuestion(r, p, ui, t)}
    ${(r.noticed?.[p.id] ?? []).map(k => SIGNS[p.id]?.[k]).filter(Boolean).map(sign => `<p class="mood told">👁 ${esc(simLine(sign!, t))}</p>`).join('')}
    ${(r.leads ?? []).filter(l => l.who === p.id).map(l => `<p class="mood told">🧭 ${esc(t('talk.sentYou', { name: personById(l.from)?.name ?? l.from, about: aboutKeyText(l.about, t) }))}</p>`).join('')}
    ${answers ? `<p class="fgroup">${esc(t('talk.toldYou'))}</p>${answers}` : ''}</div>`;
}

/**
 * Ask anything (#1575): once per person per stay, a question in your own words, with the notice
 * under the box. main.ts matches what's typed to what they know (free-questions.ts) and plays it;
 * this draws the box, or, once asked, what you asked and what they said.
 */
function freeQuestion(r: RoadState, p: Person, ui: RoadUi, t: T): string {
  // A switchable feature (#1579): off in this run, no box; while it's an experiment, it says so.
  if (!featureOn(r.features, 'free-questions')) return '';
  const tag = featureById('free-questions')?.stage === 'experimental' ? ` <span class="exptag" title="${esc(t('freeq.experimentTip'))}">${esc(t('freeq.experiment'))}</span>` : '';
  const head = `<p class="fgroup">${esc(t('freeq.head'))}${tag}</p>`;
  if ((r.questioned ?? []).includes(p.id)) {
    const mine = ui.asked?.[p.id];
    if (!mine) return `${head}<p class="mood">${esc(t('freeq.asked', { name: p.name }))}</p>`;
    // An answer joins what they've told you, just below; anything else (a deflection, or with the
    // knowledge model a "not yet" or someone to ask instead, #1611) is shown here.
    const told = mine.topic !== null && respondedOn(r.asked?.[p.id], mine.topic);
    return `${head}<p class="mood told"><b>${esc(t('freeq.youAsked'))}</b> — “${esc(mine.question)}”</p>${told
      ? `<p class="mood">${esc(t('freeq.toldAbout', { name: p.name, about: parseFocus(mine.topic!) ? aboutKeyText(mine.topic!, t) : questionAboutText(mine.topic!, t) }))}</p>`
      : `<p class="say">${esc(simLine(mine.reply, t))}</p>`}`;
  }
  const why = hoursLeft(r) <= 0 ? t('road.daySpent') : null;
  return `${head}
    <form class="freeq" data-question="${esc(p.id)}">
      <input name="q" class="qin" maxlength="${QUESTION_CHARS}" autocomplete="off" placeholder="${esc(t('freeq.placeholder', { name: p.name }))}" aria-label="${esc(t('freeq.label', { name: p.name }))}" ${why ? 'disabled' : ''}>
      <button class="btn" type="submit" ${why ? `disabled title="${esc(why)}"` : ''}>${esc(t('freeq.ask'))} <span class="h">${ASK_HOURS}h</span></button>
    </form>
    <p class="mood qnote">${esc(t('freeq.notice'))}</p>`;
}

/** The open villager's sheet: talk, their quest, and trade or lessons if they offer them. */
function personSheet(r: RoadState, p: Person, ui: RoadUi, t: T): string {
  const told = r.told[p.id] ?? 0;
  const isTrader = tradeTerms(r)?.trader === p.id;
  return `<section class="box sheet"><div class="sheethead">${badge(p, 56)}<div><h3>${esc(p.name)}</h3><p class="prole">${whoLine(r, p, t)} · ${rapportTag(r, p, ui, t)}</p><p class="mood" style="margin:2px 0 0">${esc(t(`person.${p.id}.personality` as Key))}</p></div>
    <button class="pill" data-person="${esc(p.id)}" aria-label="${esc(t('road.close'))}">✕</button></div>
    ${conversation(r, p, told, ui, t)}
    ${questBlock(r, p, t)}${isTrader ? tradePanel(r, t) : ''}${lessonPanel(r, p, t)}${healPanel(r, p, t)}</section>`;
}

/** A village day: everyone in it, the open sheet, and the way to end the day. */
function villageView(r: RoadState, ui: RoadUi, t: T): string {
  const id = villageOf(r)!;
  const people = peopleOf(id);
  const open = people.find(p => p.id === ui.person) ?? null;
  return `<section class="box"><p class="eyebrow">${esc(t('road.villageHead', { name: VILLAGES[id].name.toUpperCase() }))}</p>
      <div class="people">${people.map(p => personCard(r, p, p === open, ui, t)).join('')}</div>
      ${handsFree(r, false, t)}
      <div class="runbar" style="margin-top:12px">${act(r, 'rest', esc(t('road.rest')), 0, t)}<button class="btn go" data-cmd="roadday">${esc(t('road.endDay'))}</button></div></section>
    ${open ? personSheet(r, open, ui, t) : ''}`;
}

// ── Quest log ───────────────────────────────────────────────────────────────

/** Every quest you've taken: what's still needed, and the deadline (before the caravan leaves). */
export function questLog(r: RoadState, compact = false, t: T = EN): string {
  const taken = Object.entries(r.quests).map(([id, st]) => ({ q: questById(id)!, st })).filter(x => x.q);
  const open = taken.filter(x => x.st === 'active');
  const closed = taken.filter(x => x.st !== 'active');
  const deadline = (q: QuestTemplate): string => {
    if (q.needs.kind === 'deliver') return t('qlog.onArrival', { where: VILLAGES[q.needs.to]?.name ?? q.needs.to });
    if (villageOf(r) !== q.village) return t('qlog.missed');
    const left = daysLeftOnLeg(r);
    return left === 1 ? t('qlog.today') : plural(t, 'qlog.left', left);
  };
  const row = (q: QuestTemplate): string => {
    const why = q.needs.kind === 'deliver' ? null : canComplete(q, r);
    return `<li><b>${esc(t(`quest.${q.id}.title` as Key))}</b> <span class="qwho">${esc(t('qlog.for', { name: personById(q.giver)?.name ?? '' }))}</span>
      <span class="need">${esc(needsText(q, t))}${why ? ` — <span class="warn">${esc(simLine(why, t))}</span>` : q.needs.kind === 'deliver' ? '' : ` — <span class="ok">${esc(t('qlog.readyIn'))}</span>`}</span>
      <span class="due">⏳ ${esc(deadline(q))}</span></li>`;
  };
  const head = `<p class="fgroup" style="margin-top:${compact ? 14 : 0}px">${esc(t('qlog.head'))}</p>`;
  if (!taken.length) return `${head}<p class="mood">${esc(t('qlog.none'))}</p>${leadLog(r, t)}${claimLog(r, t)}`;
  const status = (st: string): string => t(st === 'done' ? 'qlog.done' : st === 'failed' ? 'qlog.failed' : 'qlog.expired');
  return `${head}<ul class="qlog">${open.map(x => row(x.q)).join('') || `<li class="mood">${esc(t('qlog.nothingOpen'))}</li>`}</ul>
    ${leadLog(r, t)}${claimLog(r, t)}
    ${compact || !closed.length ? '' : `<p class="fgroup" style="margin-top:12px">${esc(t('qlog.finished'))}</p><ul class="qlog done">${closed.map(x => `<li><b>${esc(t(`quest.${x.q.id}.title` as Key))}</b> <span class="qwho">${esc(status(x.st))}</span></li>`).join('')}</ul>`}`;
}

/** Leads (#1497): who answers have sent you to, where, about what, and whether you've asked yet. */
function leadLog(r: RoadState, t: T): string {
  if (!r.leads?.length) return '';
  const row = (l: NonNullable<RoadState['leads']>[number]): string => {
    const asked = respondedOn(r.asked?.[l.who], l.about);
    return `<li><b>${esc(personById(l.who)?.name ?? l.who)}</b> <span class="qwho">${esc(l.where ? t('qlog.at', { where: VILLAGES[l.where]?.name ?? l.where }) : t('qlog.onRoad'))}</span>
      <span class="need">${esc(t('qlog.about', { about: aboutKeyText(l.about, t), name: personById(l.from)?.name ?? l.from }))}${asked ? ` — <span class="ok">${esc(t('qlog.askedOk'))}</span>` : ''}</span></li>`;
  };
  return `<p class="fgroup" style="margin-top:12px">${esc(t('qlog.leads'))}</p><ul class="qlog">${r.leads.map(row).join('')}</ul>`;
}

/** How each journal entry stands (#1580), as the page says it. */
const CLAIM_STATUS: Readonly<Record<JournalEntry['status'], { key: Key; cls: string }>> = {
  heard: { key: 'claim.heard', cls: '' }, corroborated: { key: 'claim.corroborated', cls: 'ok' }, contradicted: { key: 'claim.contradicted', cls: 'warn' }, checked: { key: 'claim.checked', cls: 'ok' },
};

/**
 * The journal of who said what (#1580): each thing people have made claims about, every account and
 * how sure it sounded, and whether they agree, clash or you've seen for yourself. Only with the
 * `rumours-and-lies` switch on (`journalNow` is null without it).
 *
 * The accounts themselves (what was claimed, the hedge it was said with, what you saw) are the
 * claims' own words, read through `phrase`: those not in the catalog yet stay English (#1709).
 */
function claimLog(r: RoadState, t: T): string {
  const journal = journalNow(r);
  if (!journal?.length) return '';
  const name = (id: string): string => personById(id)?.name ?? TRAVELLERS.find(x => x.id === id)?.name ?? id;
  const status = (e: JournalEntry): string => { const s = CLAIM_STATUS[e.status]; return s.cls ? `<span class="${s.cls}">${esc(t(s.key))}</span>` : esc(t(s.key)); };
  const row = (e: JournalEntry): string => `<li><b>${esc(simLine(e.label, t))}</b> <span class="qwho">${status(e)}</span>
    ${e.seen ? `<span class="need">${esc(simLine(e.seen, t))}</span>` : ''}
    ${e.claims.map(c => `<span class="need">${esc(name(c.person))}, “${esc(simLine(c.hedge, t))}”: ${esc(simLine(c.text, t))}${c.right === undefined ? '' : c.right ? ` <span class="ok">${esc(t('claim.so'))}</span>` : ` <span class="warn">${esc(t('claim.notSo'))}</span>`}</span>`).join('')}</li>`;
  return `<p class="fgroup" style="margin-top:12px">${esc(t('qlog.whoSaid'))}</p><ul class="qlog">${journal.map(row).join('')}</ul>`;
}

// ── The screen ──────────────────────────────────────────────────────────────

/** The road tab: the wagon on a travel day, the village otherwise. */
export const roadView = (r: RoadState, ui: RoadUi, t: T = EN): string => (villageOf(r) ? villageView(r, ui, t) : wagonView(r, ui, t));

/** Arrival (or the end on the road): how it went, and what the Warden carries on with. */
export function roadEnd(r: RoadState, t: T = EN): string {
  const o = r.outcome!;
  const done = Object.values(r.quests).filter(q => q === 'done').length;
  const friends = Object.entries(r.trust).filter(([, x]) => x >= CONTACT_TRUST).map(([id]) => personById(id)?.name ?? id);
  const head = t(o.kind === 'arrived' ? 'end.arrivedHead' : o.kind === 'died' ? 'end.diedHead' : 'end.cargoHead');
  const body = t(o.kind === 'arrived' ? 'end.arrived' : o.kind === 'died' ? 'end.died' : 'end.cargo');
  return `<section class="box arrive ${o.kind}"><p class="eyebrow">${esc(head)}</p><p class="mood">${esc(body)}</p>
    <div class="res"><span class="chip">🪙&nbsp;${t('road.marksHtml', { n: r.marks })}</span><span class="chip">${esc(plural(t, 'end.quests', done))}</span><span class="chip">${esc(plural(t, 'end.contacts', friends.length))}</span><span class="chip">${esc(plural(t, 'end.techniques', r.techniques.length))}</span></div>
    ${friends.length ? `<p class="mood">${esc(t('end.remember', { names: friends.join(', ') }))}</p>` : ''}</section>`;
}
