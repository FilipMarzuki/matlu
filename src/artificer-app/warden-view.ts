/**
 * The WARDEN tab in the viewer's language (#1711, phase 4 of #1685): who you are — portrait, name,
 * rank, focus, stats, carrying, the pack, old wounds, talents, quirks, the road's marks and
 * contacts, skills and concepts.
 *
 * Moved out of main.ts so it can be drawn in a unit test (warden-progress-i18n.test.ts), like
 * camp-blocks.ts and road-view.ts before it: a pure function of the game state and `t`. Every word
 * is the catalog's (`warden.*`, i18n/en/tabs.ts) or a name by id (sim-words.ts); the sim's own
 * English, which the AI and the API read, is untouched.
 */

import type { Key, T } from '../artificer/i18n';
import { numText } from '../artificer/i18n';
import { CRAFT_WORLD, FOCUS_OPEN, survivalLockOf, type Region1State } from '../artificer/region1';
import { maxLoad, comfortableLoad, strainRecovery, GEAR_ITEMS, EXHAUSTED_DRAIN, type GearItem } from '../artificer/load';
import { SKILL_IDS, LEVELS, MAX_LEVEL, perceivedProgress, isSupernatural, skillLevel } from '../artificer/skills';
import { TECHNIQUES, type Technique } from '../artificer/techniques';
import { GOALS, GOAL_IDS, FOCUS_COST, CONCEPT_PER_HOUR, focusKey, parseFocus, type Focus } from '../artificer/focus';
import { topicsOpen } from '../artificer/topics';
import { isYoung } from '../artificer/growing';
import { STAT_IDS, statEffects, type Stats } from '../artificer/stats';
import { artificerRank, conceptRanks } from '../artificer/rank';
import { kitSupplies } from '../artificer/kit';
import { DARK_FADES } from '../artificer/panic';
import { isFear, FEAR_FADES, FEAR_OF } from '../artificer/quirks';
import { CONTACT_TRUST, personById } from '../artificer/villages';
import { feltWord } from '../artificer/rapport';
import { roadLockOf, type RoadState } from '../artificer/road';
import { esc, pct, portraitEl } from './html';
import { itemIcon } from './item-icons';
import { packTitle } from './opening-view';
import { actionName, conceptName, focusName, kitName, lockText, rankName, recipeName, statNoteText, topicText } from './sim-words';
import { rapportName, roleName } from './road-words';

/** What the Warden tab draws from: the run, and the road once the Warden rides with the caravan. */
export interface WardenOf { sim: Region1State; stage?: 'reach' | 'road'; road?: RoadState }

/** A word or line by key, or its fallback when the catalog has none (an id from newer content). */
const tOr = (t: T, key: string, fallback: string): string => { const s = t(key as Key); return s === key ? fallback : s; };
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (t: T, key: string, n: number, vars: Record<string, string | number> = {}): string => t(`${key}.${n === 1 ? 'one' : 'other'}` as Key, { n, ...vars });

/** A piece of carrying gear by name (its recipe's), lower case. */
const gearName = (item: GearItem | 'waterskin', t: T): string => recipeName(item, t).toLowerCase();

/** The WARDEN tab's carrying panel (#1296): what you can lift, your gear, and how strained you are. */
export function carryingBlock(s: Region1State, t: T): string {
  const st = s.character.stats;
  const gear = s.tools.filter(x => (GEAR_ITEMS as readonly string[]).includes(x.item));
  const chips = gear.length ? gear.map(x => `<span class="r tool ${x.grade}">${itemIcon(x.item)}${esc(gearName(x.item as GearItem, t))} <b>${esc(t(`grade.${x.grade}` as Key).toUpperCase())}</b></span>`).join('')
    : `<span class="mood" style="margin:0">${esc(t('warden.noGear'))}</span>`;
  const strain = s.strain ?? 0;
  const status = s.today.exhausted ? `<p class="lockbanner">${esc(t('warden.exhausted', { n: Math.round((EXHAUSTED_DRAIN - 1) * 100) }))}</p>`
    : strain >= 0.5 ? `<p class="mood warn">${esc(t('warden.aching', { n: numText(strain, t, 1), m: Math.round((1 - strainRecovery(strain)) * 100) }))}</p>`
      : `<p class="mood ok">${esc(t('warden.fresh'))}</p>`;
  return `<div class="carrystats"><span>${t('warden.maxHtml', { n: maxLoad(st) })}</span><span>${t('warden.comfortableHtml', { n: Math.round(comfortableLoad(st)) })}</span></div>
    <div class="res" style="margin-top:6px">${chips}</div>${status}`;
}

/** Topic kinds as the Warden tab groups them (#1495). */
const TOPIC_GROUPS: readonly (readonly [string, Key])[] = [['material', 'focus.material'], ['place', 'focus.place'], ['group', 'focus.group'], ['person', 'focus.person'], ['quest', 'focus.quest'], ['role', 'focus.job']];

/** How the focus picker is drawn: the Warden tab's as it always was; the status bar's (#1758) disabled while locked. */
export interface FocusBlockOpts { disableWhenLocked?: boolean }

/**
 * The focus picker (#1238): goals, skills, concepts; the lock banner when survival overrides. On
 * the road (#1479) the chips set the road's focus, and the note says what a focus does there.
 */
export function focusBlock(s: Region1State, t: T, road?: RoadState, opts: FocusBlockOpts = {}): string {
  const lock = road ? roadLockOf(road) : survivalLockOf(s);
  const cur = focusKey(s.focus);
  // The status bar's picker (#1758) greys the choices out while survival holds the mind.
  const off = opts.disableWhenLocked && lock ? ' disabled' : '';
  const chip = (key: string, label: string, note: string) =>
    `<button class="fchip" data-focus="${key}" aria-pressed="${cur === key}" title="${esc(note)}"${off}>${esc(label)}</button>`;
  const name = (f: Focus): string => focusName(f, t);
  // On the road (#1479) a goal has no work to help: the chip says so instead of its Reach effect.
  const goals = GOAL_IDS.map(g => chip(`goal:${g}`, name({ kind: 'goal', id: g }), road ? t('warden.focus.idle') : t('warden.focus.goalTip', { actions: GOALS[g].actions.map(a => actionName(a, t)).join(', ') }))).join('');
  const skills = SKILL_IDS.map(k => chip(`skill:${k}`, name({ kind: 'skill', id: k }), t(road ? 'warden.focus.skillRoad' : 'warden.focus.skillTip'))).join('');
  // The concepts open to this Warden and not yet mastered (#1478): the six, and the web as it opens.
  const concepts = FOCUS_OPEN(s).map(c => chip(`concept:${c}`, conceptName(c, t), t(road ? 'warden.focus.conceptRoad' : 'warden.focus.conceptTip', { n: numText(CONCEPT_PER_HOUR, t) }))).join('');
  // Topics (#1494, #1495): on the road, what you've come across, grouped by kind. Something to ask about; no work.
  const open = road ? topicsOpen(road) : [];
  const topics = TOPIC_GROUPS.map(([kind, label]) => {
    const chips = open.filter(k => k.startsWith(`${kind}:`)).map(k => (parseFocus(k) ? chip(k, topicText(k, t), t('warden.focus.topicTip')) : '')).join('');
    return chips ? `<p class="fgroup">${esc(t(label))}</p><div class="fchips">${chips}</div>` : '';
  }).join('');
  const below = statEffects(s.character.stats).unreliableBelow;
  const note = road ? t('warden.focus.noteRoad', { n: FOCUS_COST, below }) : t('warden.focus.note', { n: FOCUS_COST, below });
  return `${lock ? `<p class="lockbanner">${esc(t(road ? 'warden.lockRoad' : 'warden.lock', { why: lockText(lock, t) }))}</p>` : ''}
    <p class="mood" style="margin-top:0">${esc(note)}</p>
    <p class="fgroup">${esc(t('focus.goal'))}</p><div class="fchips">${goals}</div>
    <p class="fgroup">${esc(t('focus.skill'))}</p><div class="fchips">${skills}</div>
    <p class="fgroup">${esc(t('focus.concept'))}</p><div class="fchips">${concepts}</div>${topics}
    <div class="fchips" style="margin-top:6px">${chip('none', t('focus.none'), t('warden.focus.noneTip'))}</div>`;
}

/** The Warden tab (#1239): who you are — portrait, name, rank, focus, stats, talents, skills, concepts. */
export function wardenTab(a: WardenOf, t: T, truths = false): string {
  const c = a.sim.character;
  // Talents (#1263): the known ones by name; a hidden one only as a hint that it exists. Tiers are never shown.
  const hidden = c.talents.filter(x => !x.known).length;
  const talents = c.talents.length
    ? c.talents.filter(x => x.known).map(x => `<div class="trait"><b>${esc(t(`talent.${x.id}` as Key))}</b><span class="up">+ ${esc(t(`talent.${x.id}.blurb` as Key))}</span>${x.signs !== undefined ? `<span class="found">${esc(t('warden.discovered'))}</span>` : ''}${x.id === 'tough' && c.lastStandUsed ? `<span class="note">${esc(t('warden.lastStand'))}</span>` : ''}</div>`).join('')
      + (hidden ? `<div class="trait hidden"><b>${esc(t('warden.hiddenGift'))}</b><span class="note">${esc(t('warden.hiddenGiftNote'))}</span></div>` : '')
    : `<p class="mood">${esc(t('warden.noTalents'))}</p>`;
  const concepts = Object.entries(a.sim.concepts).filter(([, p]) => p.rank > 0 || p.insight > 0);
  const ranks = conceptRanks(a.sim);
  return `<div class="cols">
    <section class="box"><div class="idcard">${portraitEl(c.portrait, 120)}<div><p class="eyebrow">${esc(t('head.artificer'))}</p><h2 class="wname">${esc(c.name || t('warden.unnamed'))}</h2>
      <p class="wrank">${esc(t('head.rank'))}: ${esc(rankName(artificerRank(a.sim, CRAFT_WORLD.concepts), t).toUpperCase())} <span>· ${esc(plural(t, 'warden.conceptRanks', ranks))}</span></p></div></div>
      <p class="eyebrow" style="margin-top:16px">${esc(t('head.focus'))}</p>${focusBlock(a.sim, t, a.stage === 'road' ? a.road : undefined)}
      <p class="eyebrow" style="margin-top:16px">${esc(c.age !== undefined ? t(isYoung(c.age) ? 'head.statsAge' : 'head.statsGrown', { age: c.age }) : t('head.stats'))}</p>${statsBlock(c.stats, t, c.adult)}
      <p class="eyebrow" style="margin-top:16px">${esc(t('head.carrying'))}</p>${carryingBlock(a.sim, t)}
      ${packBlock(a.sim, t, truths)}
      ${harmsBlock(a.sim, t)}
      <p class="eyebrow" style="margin-top:16px">${esc(t('head.talents'))}</p><div class="traits">${talents}</div>
      <p class="eyebrow" style="margin-top:16px">${esc(t('head.quirks'))}</p><div class="traits">${quirksBlock(c, t)}</div>${roadKeepsBlock(a, t)}</section>
    <section class="box"><p class="eyebrow">${esc(t('head.skills'))}</p>${skillsBlock(a.sim, t, truths)}
      <p class="eyebrow" style="margin-top:16px">${esc(t('head.concepts'))}</p>
      ${concepts.length ? `<ul class="concepts">${concepts.map(([id, p]) => `<li><b>${esc(conceptName(id, t))}</b> ${esc(t('warden.conceptRank', { n: p.rank }))} <span>· ${esc(t('warden.insight', { n: numText(p.insight, t, 1) }))}</span></li>`).join('')}</ul>` : `<p class="mood">${esc(t('warden.noConcepts'))}</p>`}</section>
  </div>`;
}

/**
 * Quirks (#1364): the ones you know, by name and what they do; hidden ones only as a hint; and
 * any fears, with how far you've come in facing them.
 */
export function quirksBlock(c: Region1State['character'], t: T): string {
  const qs = c.quirks ?? [];
  const known = qs.filter(q => q.known && !isFear(q.id)).map(q => `<div class="trait quirk"><b>${esc(tOr(t, `quirk.${q.id}`, q.id))}</b><span class="note">${esc(tOr(t, `quirk.${q.id}.blurb`, ''))}</span></div>`);
  const fears = qs.filter(q => isFear(q.id)).map(q => {
    const tag = q.id.slice(5), fades = tag === 'dark' ? DARK_FADES : FEAR_FADES;
    const what = tOr(t, `w.fear.${tag}`, tag);
    // English agrees with the fear ("heights look", "the dark looks"); the key is chosen by the English words.
    const many = (FEAR_OF[tag] ?? tag).endsWith('s') ? 'many' : 'one';
    return `<div class="trait fear"><b>${esc(t('warden.fearOf', { what }))}</b><span class="down">− ${esc(t(`warden.fearWorse.${many}`, { what }))}</span><span class="note">${esc(t(`warden.fearFace.${many}`, { n: q.faced ?? 0, m: fades }))}</span></div>`;
  });
  const hidden = qs.filter(q => !q.known).length;
  const hint = hidden ? `<div class="trait hidden"><b>${esc(t(hidden === 1 ? 'warden.unknownSelf.one' : 'warden.unknownSelf.other'))}</b><span class="note">${esc(t('warden.unknownSelfNote'))}</span></div>` : '';
  return known.join('') + fears.join('') + hint || `<p class="mood">${esc(t('warden.nothingKnown'))}</p>`;
}

/** Marks and contacts (#1252): what the road earned, and what carries to the next road. */
export function roadKeepsBlock(a: WardenOf, t: T): string {
  const marks = a.road?.marks ?? a.sim.marks ?? 0;
  const contacts = a.road ? [...new Set([...a.road.contacts, ...Object.entries(a.road.trust).filter(([, n]) => n >= CONTACT_TRUST).map(([id]) => id)])] : a.sim.contacts ?? [];
  if (!a.road && !marks && !contacts.length) return '';
  return `<p class="eyebrow" style="margin-top:16px">${esc(t('head.roadKeeps'))}</p>
    <div class="res"><span class="chip">🪙&nbsp;<b>${marks}</b>&nbsp;${esc(t('warden.marks'))}</span></div>
    ${contacts.length ? `<ul class="contacts">${contacts.map(id => { const p = personById(id); return `<li><b>${esc(p?.name ?? id)}</b> <span>${esc(p ? roleName(p.role, t) : '')}${a.road && a.road.trust[id] !== undefined ? ` · ${esc(rapportName(feltWord(a.road, id), t))}` : ''}</span></li>`; }).join('')}</ul>` : `<p class="mood">${esc(t('warden.noContacts'))}</p>`}`;
}

/** What's left of what runs out in the pack (kit.ts kitSupplies), in words. */
function suppliesText(s: Region1State, t: T): string[] {
  const k = s.kit;
  if (!k) return [];
  const out: string[] = [];
  const d = s.dressings ?? 0;
  // The same order and conditions as kitSupplies, which the English page shows as it is.
  if (k.items.includes('first-aid-kit')) out.push(plural(t, 'warden.left.dressings', d));
  if (k.items.includes('headlamp')) out.push(t('warden.left.lamp', { n: numText(k.lamp, t) }));
  if (k.items.includes('matches')) out.push(plural(t, 'warden.left.matches', k.matches));
  if (k.items.includes('thermos')) out.push(k.thermos ? plural(t, 'warden.left.thermos', k.thermos) : t('warden.left.thermosEmpty'));
  if (k.items.includes('trangia')) out.push(k.stove ? plural(t, 'warden.left.stove', k.stove) : t('warden.left.stoveOut'));
  if (k.items.includes('sweets')) out.push(t(k.sweets ? 'warden.left.sweets' : 'warden.left.sweetsEaten'));
  if (k.items.includes('comic')) out.push(t(k.comic ? 'warden.left.comic' : 'warden.left.comicRead'));
  return out.length === kitSupplies(k, d).length ? out : kitSupplies(k, d);
}

/** The hike pack (#1400): what you brought, each with what it's for, and what's left of what runs out. */
export function packBlock(s: Region1State, t: T, truths = false): string {
  if (!s.kit) return '';
  const left = suppliesText(s, t);
  return `<p class="eyebrow" style="margin-top:16px">${esc(t('head.pack'))}</p>
    <div class="packlist">${s.kit.items.map(id => `<span class="packitem" title="${esc(packTitle(id, t, truths))}">${itemIcon(id)}${esc(kitName(id, t))}</span>`).join('')}</div>
    ${left.length ? `<p class="mood" style="margin:6px 0 0">${esc(t('warden.left', { list: left.join(' · ') }))}</p>` : ''}`;
}

/**
 * Stats (#1256, #1258), shown exactly — unlike skills, you know your own body and mind. While
 * young (#1399), each shows what it grows to.
 */
export function statsBlock(st: Stats, t: T, adult?: Stats): string {
  return `<div class="statgrid">${STAT_IDS.map(id => `<div class="stat ${st[id] > 10 ? 'hi' : st[id] < 10 ? 'lo' : ''}" title="${esc(t(`stat.${id}.blurb` as Key))}">`
    + `<span class="sk">${esc(t(`stat.${id}.short` as Key))}</span><span class="sv">${st[id]}</span>${adult && adult[id] !== st[id] ? `<span class="sg">${esc(t('warden.growsTo', { n: adult[id] }))}</span>` : '<span></span>'}`
    + `<span class="sd">${esc(statNoteText(id, st[id], t))}</span></div>`).join('')}</div>`;
}

/** How a technique (#1243) is learned, as a hint for one you don't know yet. */
const LEARN_HINT: Record<Technique['difficulty'], Key> = { easy: 'warden.tech.easy', hard: 'warden.tech.hard', teacher: 'warden.tech.teacher' };

/** One technique: named once known; otherwise a hint at how it's learned. Each is typical of a level, not locked to it. */
const techChip = (s: Region1State, t: T) => (x: Technique): string => {
  const level = t(`level.${x.level}` as Key);
  return s.techniques.includes(x.id)
    ? `<span class="tech known" title="${esc(t('warden.tech.knownTip', { how: tOr(t, `tech.${x.id}.how`, x.how), level }))}">${esc(tOr(t, `tech.${x.id}`, x.name))}</span>`
    : `<span class="tech ${x.difficulty}" title="${esc(t('warden.tech.hintTip', { level, how: t(LEARN_HINT[x.difficulty]) }))}">? ${esc(t(x.difficulty === 'teacher' ? 'warden.tech.taughtOnly' : x.difficulty === 'easy' ? 'warden.tech.easyShort' : 'warden.tech.hardShort'))}</span>`;
};

/**
 * Skills (#1236, #1241) as the Warden sees them: a *self-assessed* level and how close it feels to
 * the next. The true level is hidden (Dunning–Kruger) — you feel it in the work instead.
 */
export function skillsBlock(s: Region1State, t: T, truths = false): string {
  return `<p class="mood" style="margin-top:0">${t('warden.skillsNoteHtml')}</p><div class="skills">${SKILL_IDS.map(id => {
    const seems = perceivedProgress(s.skills[id] ?? 0);
    const lvl = Math.floor(seems);
    const name = t(`level.${lvl}` as Key);
    // Dev mode (#1579) shows the true level the game hides.
    const truth = truths ? ` <span class="devtruth" title="${esc(t('warden.truthTip'))}">${esc(t('warden.truth', { level: t(`level.${skillLevel(s.skills, id)}` as Key) }))}</span>` : '';
    return `<div class="skill" title="${esc(t('warden.skillTip', { blurb: tOr(t, `skill.${id}.blurb`, '') }))}"><span class="sn">${esc(t(`skill.${id}` as Key))}</span>`
      + `<span class="sl ${isSupernatural(lvl) ? 'super' : ''}">${isSupernatural(lvl) ? '✦ ' : ''}${esc(name)}${truth}</span><div class="track"><div class="fill" style="width:${pct(lvl >= MAX_LEVEL ? 1 : seems - lvl)}%"></div></div>`
      + `<div class="techs">${TECHNIQUES.filter(x => x.skill === id).map(techChip(s, t)).join('')}</div></div>`;
  }).join('')}</div>${s.manuals.length ? `<p class="mood">${t('warden.manualsHtml', { list: s.manuals.map(m => `<b>${esc(cap(tOr(t, `w.manual.${m}`, m)))}</b>`).join(', ') })}</p>` : ''}`;
}

/** Old wounds (#1395): what grave injuries left behind, and what each does — for good. */
export function harmsBlock(s: Region1State, t: T): string {
  const harms = s.character.harms ?? [];
  if (!harms.length) return '';
  return `<p class="eyebrow" style="margin-top:16px">${esc(t('head.wounds'))}</p>
    <ul class="harms">${harms.map(h => `<li><b>${esc(cap(t(`w.harm.${h}` as Key)))}</b> <span>${esc(t(`w.harm.${h}.does` as Key))}</span></li>`).join('')}</ul>`;
}

/** (The levels' English names, kept for the reader: `level.<i>` in the catalog is LEVELS[i].) */
export const LEVEL_COUNT = LEVELS.length;
