/**
 * Acceptance test for #1709 — the caravan road, its people and the journal have no hard-coded
 * English (phase 3 of #1685).
 *
 * How it checks, as camp-i18n.test.ts does for a day at camp: the road's views (road-view.ts), the
 * encounter and caravan screens, and the journal (journal-view.ts) are pure functions of the game
 * state and `t`, so this draws each of them in Swedish over a spread of states — every village with
 * each person's sheet open, quests offered and taken, trade, lessons and healing, the wagon, leads
 * and the journal of who said what, the end of the road — and plays a whole year and a whole road
 * through, drawing every journal line it wrote. Then it reads what a player would see (text,
 * tooltips, labels, placeholders) and looks for English words that have no business in Swedish.
 *
 * Since phase 4 (#1711) nothing is left out: every rule switch is on, the story engine's history
 * included (the villages' history in play, eyewitnesses and legends, old history bending with age,
 * the run's rumours of the past), and so are a people's and a culture's ways told to a free question.
 * The histories are told here as the server tells them (`tellHistoriesWith(runHistory)`), so the
 * road's people answer from them. history-i18n.test.ts checks the history's own views.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forgetHistories, tellHistoriesWith } from '../artificer/history-in-play';
import { runHistory } from '../artificer/world/history';
import { makeT, type T } from '../artificer/i18n';
import { createRegion1, chooseOption, endDay, runAction, setFocus, blockedReason, ACTIONS, FOCUS_OPEN, type ActionId, type QueueItem, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { ruleFeatures, type FeatureSwitches } from '../artificer/features';
import { createVitals } from '../artificer/vitality';
import { createRoad, endRoadDay, runRoadAction, chooseRoadOption, peopleHere, questsHere, tradeTerms, villageOf, setRoadFocus, ROUTE, type RoadState, type RoadActionId } from '../artificer/road';
import { encounterById, optionsFor, ENCOUNTERS } from '../artificer/encounters';
import { openMeeting, chooseInMeeting, boardingOf } from '../artificer/caravan-meeting';
import { topicsOpen } from '../artificer/topics';
import { parseFocus, GOAL_IDS } from '../artificer/focus';
import { SKILL_IDS } from '../artificer/skills';
import { QUESTS, OFFER_TRUST } from '../artificer/quests';
import { VILLAGES, TRAVELLERS } from '../artificer/villages';
import { SUGGESTED_PACK } from '../artificer/kit';
import { roadView, routeStrip, roadStatus, lastNews, questLog, roadEnd } from './road-view';
import { encounterModal } from './encounter-view';
import { meetingModal } from './caravan-view';
import { journalItems } from './journal-view';
import { simLine } from './sim-words';
import { wardenTab } from './warden-view';

const sv = makeT('sv');
const en = makeT('en');

/** What a player sees and hears of some HTML: its text, and the words in tooltips, labels and placeholders. */
function shown(html: string): string {
  const attrs = [...html.matchAll(/\b(title|aria-label|placeholder|alt)="([^"]*)"/g)].map(m => m[2]);
  const text = html.replace(/<[^>]*>/g, ' ');
  return [text, ...attrs].join(' ').replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/**
 * English words that would give away a line nobody translated. Whole words, any case. Chosen to be
 * English only: not "by", "bad", "gift", "rank", "hand", "land" or "ring", which are Swedish words too.
 */
const ENGLISH = [
  'the', 'you', 'your', 'and', 'with', 'of', 'not', 'yet', 'already', 'nothing', 'never', 'about', 'what', 'will', 'here',
  'food', 'water', 'stone', 'hides', 'rations', 'materials', 'firewood', 'marks', 'day', 'days', 'night', 'nights', 'hours',
  'trade', 'sell', 'sold', 'buy', 'bought', 'price', 'wanted', 'quest', 'quests', 'reward', 'lesson', 'lessons', 'healing',
  'trader', 'teacher', 'healer', 'elder', 'smith', 'hunter', 'tinker', 'wagon', 'caravan', 'road', 'village', 'travellers',
  'talk', 'chat', 'ask', 'tell', 'told', 'asked', 'knows', 'they', 'their', 'she', 'he', 'her', 'his', 'who', 'says', 'said',
  'trust', 'friend', 'friends', 'free', 'done', 'failed', 'leads', 'heard', 'seen', 'rest', 'end', 'mend', 'help', 'craft', 'study',
  'skipped', 'needs', 'gathered', 'fetched', 'cut', 'hunted', 'scouted', 'milestone', 'morning', 'hungry', 'thirsty',
  'wolves', 'bear', 'fire', 'light', 'snow', 'winter', 'thaw', 'cold', 'warm', 'dark', 'shelter', 'camp', 'pack',
];
const ENGLISH_RE = new RegExp(`(?<![\\p{L}])(${ENGLISH.join('|')})(?![\\p{L}])`, 'giu');

/** The English words found in what's shown (with a little context, so a failure says where). */
function englishIn(html: string): string[] {
  const text = shown(html);
  return [...text.matchAll(ENGLISH_RE)].map(m => text.slice(Math.max(0, m.index! - 40), m.index! + 40).replace(/\s+/g, ' ').trim());
}

/** The run's rule switches: all of them (#1711: the story engine's history too). */
const FEATURES: FeatureSwitches = ruleFeatures();

// The road's people answer from the run's told history (history-in-play.ts): tell it as the server does.
beforeAll(() => tellHistoriesWith(runHistory));
afterAll(() => { tellHistoriesWith(null); forgetHistories(); });

/** A tiny seeded stream, so the played runs are the same every time. */
function lcg(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
}

/** A Warden off the mountain at the thaw, well stocked, onto the wagon after meeting the caravan. */
function road(id = 'w-road-sv', features: FeatureSwitches = FEATURES): RoadState {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: true, features } }, undefined, { id, name: 'Vega', portrait: 'tinkerer', chosen: ['hardy', 'silverTongue'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = { ...s, day: 61, vitals, marks: 40, stores: { ...s.stores, rawFood: 30, water: 30, rations: 8, hides: 4, firewood: 10, materials: 8, stone: 6 }, tools: [...s.tools, { item: 'stone-knife', grade: 'fine' }, { item: 'waterskin', grade: 'sound' }], outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  let m = openMeeting(from);
  m = chooseInMeeting(from, m, 'hail');
  m = chooseInMeeting(from, m, 'work');
  return createRoad(from, boardingOf(m)!);
}

/** Ride on, resting, until the caravan is at leg `leg` of the route. */
function toLeg(r: RoadState, leg: number): RoadState {
  let s = r;
  for (let i = 0; i < 30 && s.leg < leg && !s.outcome; i++) s = s.pending ? chooseRoadOption(s, optionsFor(s as never, encounterById(s.pending.id)!)[0].option.id) : endRoadDay(s);
  return s;
}

/** Everything that can be said in a village: high trust, every quest taken, asks and tells answered, a hurt hand to tend. */
function busyVillage(leg: number): RoadState {
  let r = toLeg(road(), leg);
  const people = peopleHere(r);
  r = { ...r, trust: { ...r.trust, ...Object.fromEntries(people.map(p => [p.id, OFFER_TRUST + 50])) }, deeds: ['herald-owes-you', 'warmed-the-scholar', 'fed-the-stranger', 'heard-road-early'], injuries: [{ kind: 'hand', severity: 'serious', heal: 4 }] };
  for (const topic of ['material:iron', 'group:compact', 'place:kestrel-gate', 'skill:foraging', 'role:smith', 'material:salt', 'person:hf-orrin']) {
    const f = parseFocus(topic);
    if (!f) continue;
    r = setRoadFocus({ ...r, heard: [...new Set([...(r.heard ?? []), topic])] }, f);
    for (const p of people) r = { ...runRoadAction({ ...r, hoursToday: 0 }, `ask:${p.id}` as RoadActionId), hoursToday: 0 };
  }
  for (const p of people) {
    for (let i = 0; i < 5; i++) r = { ...runRoadAction({ ...r, hoursToday: 0 }, `talk:${p.id}` as RoadActionId), hoursToday: 0 };
    for (const deed of r.deeds ?? []) r = { ...runRoadAction({ ...r, hoursToday: 0 }, `tell:${p.id}:${deed}` as RoadActionId), hoursToday: 0 };
  }
  // Take every quest on offer but one, so a quest shows both offered and taken.
  const offered = questsHere(r);
  for (const q of offered.slice(1)) r = runRoadAction(r, `accept:${q.id}` as RoadActionId);
  return { ...r, hoursToday: 2 };
}

describe('The caravan road, in Swedish (#1709)', () => {
  it('draws every village with each sheet open, the trade, lessons, healing and quests, with no English', () => {
    const villageLegs = ROUTE.map((l, i) => (l.kind === 'village' ? i : -1)).filter(i => i >= 0);
    for (const leg of villageLegs) {
      const r = busyVillage(leg);
      expect(villageOf(r)).toBeTruthy();
      expect(englishIn(routeStrip(r, sv))).toEqual([]);
      expect(englishIn(roadStatus(r, sv))).toEqual([]);
      expect(englishIn(lastNews(r, sv))).toEqual([]);
      expect(englishIn(questLog(r, false, sv))).toEqual([]);
      expect(englishIn(roadView(r, { person: null }, sv))).toEqual([]);
      for (const p of peopleHere(r)) {
        expect(englishIn(roadView(r, { person: p.id, truths: true }, sv))).toEqual([]);
        // A spent day: every button greyed with its reason.
        expect(englishIn(roadView({ ...r, hoursToday: 12 }, { person: p.id }, sv))).toEqual([]);
      }
    }
    // The trade panel and a quest read as Swedish, not merely not-English.
    const hf = busyVillage(villageLegs[0]);
    const tobin = shown(roadView(hf, { person: 'hf-tobin' }, sv));
    expect(tobin).toContain('HANDEL — priser i marker');
    expect(tobin).toContain('DU SÄLJER');
    expect(shown(roadView(hf, { person: 'hf-orrin' }, sv))).toContain('Ved till smedjan');
  });

  it('draws answers from a village’s past and its people’s ways, and the journal of them, with no English (#1711)', () => {
    const villageLegs = ROUTE.map((l, i) => (l.kind === 'village' ? i : -1)).filter(i => i >= 0);
    const PAST = ['past:here', 'past:around', 'past:plague', 'past:famine', 'past:war', 'past:lord', 'past:murder'];
    let told = 0;
    for (const leg of villageLegs) {
      let r = busyVillage(leg);
      for (const p of peopleHere(r)) {
        // Their People's and culture's ways, on every topic, and a view of their neighbours.
        const lore = ['values', 'taboos', 'greeting', 'trade', 'mourning', 'debt'].flatMap(topic => [`group:${p.people}/${topic}`, `culture:${p.culture}/${topic}`])
          .concat(`group:${p.people}/view/group:Goblins`, `culture:${p.culture}/view/group:Bergfolk`);
        r = { ...r, asked: { ...r.asked, [p.id]: [...(r.asked?.[p.id] ?? []), ...PAST, ...lore] } };
        // One real free question each, so the journal has its line.
        r = { ...runRoadAction({ ...r, hoursToday: 0 }, `question:${p.id}:past:here` as RoadActionId), hoursToday: 0 };
      }
      for (const p of peopleHere(r)) {
        const html = roadView(r, { person: p.id }, sv);
        told += (html.match(/class="mood told"/g) ?? []).length;
        expect(englishIn(html)).toEqual([]);
      }
      expect(englishIn(journalItems(r.log, 1000, 'R', sv))).toEqual([]);
      expect(englishIn(questLog(r, false, sv))).toEqual([]);
    }
    expect(told).toBeGreaterThan(30);
  });

  it('draws the wagon, its travellers, the caravan meeting and the end of the road, with no English', () => {
    const r = road();
    expect(villageOf(r)).toBeNull();
    expect(englishIn(routeStrip(r, sv))).toEqual([]);
    for (const p of TRAVELLERS) expect(englishIn(roadView({ ...r, trust: { ...r.trust, [p.id]: 90 } }, { person: p.id }, sv))).toEqual([]);
    expect(shown(roadView(r, { person: null }, sv))).toContain('PÅ VAGNEN');
    // The WARDEN tab on the road (#1711), as main.ts draws it: the run's Warden with the road's skills, focus and topics,
    // and the road's vitals labelled under the rank (#1995).
    const s0 = createRegion1({ world: { ...FULL_WORLD, features: FEATURES } }, undefined, { id: 'w-road-sv' });
    const onRoad = { ...s0, vitals: r.vitals, stores: r.stores, tools: r.tools, concepts: r.concepts, character: r.character, skills: r.skills, techniques: r.techniques, manuals: r.manuals, known: r.known, focus: r.focus };
    const wardenHtml = wardenTab({ sim: onRoad, stage: 'road', road: { ...r, heard: ['material:iron', 'place:kestrel-gate', 'group:compact', 'person:hf-orrin'] } }, sv, false, '', true);
    expect(wardenHtml).toContain('<ul class="wvitals">');
    expect(englishIn(wardenHtml)).toEqual([]);
    // The meeting at the thaw, at each step, and once it's over.
    const s = createRegion1({ world: { ...FULL_WORLD, features: FEATURES } }, undefined, { id: 'w-meet-sv' });
    const reach: Region1State = { ...s, day: 61, marks: 2, stores: { ...s.stores, hides: 3 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals: s.vitals } };
    let m = openMeeting(reach);
    expect(englishIn(meetingModal(reach, m, sv))).toEqual([]);
    m = chooseInMeeting(reach, m, 'merchant');
    expect(englishIn(meetingModal(reach, m, sv))).toEqual([]);
    m = chooseInMeeting(reach, m, 'work');
    expect(englishIn(meetingModal(reach, m, sv))).toEqual([]);
    // The end: arrived, died, carried on as cargo.
    for (const kind of ['arrived', 'died', 'collapsed'] as const) {
      const end = { ...toLeg(r, 2), outcome: { kind, vitals: r.vitals }, quests: { 'hf-forge-wood': 'done' as const }, trust: { ...r.trust, 'cv-bodil': 80 } };
      expect(englishIn(roadEnd(end, sv))).toEqual([]);
      expect(englishIn(routeStrip(end, sv))).toEqual([]);
    }
  });

  it('draws every road encounter, waiting and answered, with no English', () => {
    const r = road();
    for (const e of ENCOUNTERS.filter(x => x.road)) {
      const waiting = { ...r, pending: { id: e.id, day: 2, hour: 8, ring: 1 as const, action: 'road', state: 'shaken' as const, perceived: e.threat, margin: 0 } };
      expect(englishIn(encounterModal(waiting as never, null, 0, sv))).toEqual([]);
      const o = optionsFor(waiting as never, e)[0].option;
      const after = chooseRoadOption(waiting, o.id);
      const fresh = after.log.slice(waiting.log.length).map(l => l.text);
      expect(englishIn(encounterModal(after as never, { kind: e.kind, scene: e.text, choice: o.label, text: fresh, died: !!after.outcome, truth: 'Looking back, it was never as bad as it looked.' }, 2, sv))).toEqual([]);
    }
  });

  it('plays a whole road through and draws its journal with no English', () => {
    for (const seed of [3, 11]) {
      const rnd = lcg(seed);
      const pick = <X>(xs: readonly X[]): X => xs[Math.floor(rnd() * xs.length)];
      let r: RoadState = road(`w-road-play-${seed}`);
      for (let guard = 0; guard < 400 && !r.outcome; guard++) {
        if (r.pending) { const e = encounterById(r.pending.id)!; const o = optionsFor(r as never, e).filter(x => !x.unmet); r = chooseRoadOption(r, pick(o.length ? o : optionsFor(r as never, e)).option.id); continue; }
        if (rnd() < 0.15) {
          const topics = topicsOpen(r);
          const k = rnd();
          const f = k < 0.5 && topics.length ? parseFocus(pick(topics)) : k < 0.75 ? { kind: 'skill' as const, id: pick(SKILL_IDS) } : k < 0.9 && FOCUS_OPEN(r).length ? { kind: 'concept' as const, id: pick(FOCUS_OPEN(r)) } : { kind: 'goal' as const, id: pick(GOAL_IDS) };
          r = setRoadFocus(r, f ?? null);
        }
        const acts: string[] = ['rest', 'tend', 'help', 'wait'];
        for (const p of peopleHere(r)) {
          acts.push(`talk:${p.id}`, `talk:${p.id}`, `ask:${p.id}`, `appraise:${p.id}`, `heal:${p.id}`, `question:${p.id}:${pick(topicsOpen(r).length ? topicsOpen(r) : [''])}`);
          for (const deed of ['herald-owes-you', 'fed-the-stranger']) acts.push(`tell:${p.id}:${deed}`);
          if (p.teaches) for (const x of [...p.teaches.techniques, ...p.teaches.recipes, ...(p.teaches.concept ? [p.teaches.concept] : [])]) acts.push(`learn:${p.id}:${x}`);
        }
        for (const q of questsHere(r)) acts.push(`accept:${q.id}`, `accept:${q.id}`);
        for (const q of QUESTS) if (r.quests[q.id] === 'active') acts.push(`complete:${q.id}`);
        const terms = tradeTerms(r);
        if (terms) { for (const g of terms.sells) acts.push(`buy:${g}:1`); for (const g of Object.keys(r.stores)) acts.push(`sell:${g}`); for (const x of r.tools) acts.push(`sell:${x.item}:${x.grade}`); }
        for (const k of r.known) acts.push(`craft:${k}`);
        for (const c of FOCUS_OPEN(r)) acts.push(`study:${c}`);
        r = r.hoursToday >= 12 || rnd() < 0.1 ? endRoadDay(r) : runRoadAction(r, pick(acts) as RoadActionId);
      }
      expect(r.log.length).toBeGreaterThan(60);
      expect(englishIn(journalItems(r.log, 1000, 'R', sv))).toEqual([]);
      // The quest log and the journal of who said what, as the road left them.
      expect(englishIn(questLog(r, false, sv))).toEqual([]);
    }
  });

  it('plays a year at camp and draws its journal, the LATEST list and the encounters, with no English', () => {
    const IDS = Object.keys(ACTIONS) as ActionId[];
    for (const seed of [1, 4, 9]) {
      const rnd = lcg(seed * 31);
      const pick = <X>(xs: readonly X[]): X => xs[Math.floor(rnd() * xs.length)];
      let s = createRegion1({ world: { ...FULL_WORLD, encounters: true, features: FEATURES } }, undefined, { id: `w-camp-sv-${seed}`, name: 'Vega', pack: [...SUGGESTED_PACK] });
      for (let guard = 0; guard < 1500 && !s.outcome; guard++) {
        if (s.pending) {
          const e = encounterById(s.pending.id)!;
          expect(englishIn(encounterModal(s, null, 2, sv))).toEqual([]);
          const opts = optionsFor(s, e).filter(o => !o.unmet);
          s = chooseOption(s, (opts.length ? pick(opts) : pick(optionsFor(s, e))).option.id);
          continue;
        }
        if (rnd() < 0.04) s = setFocus(s, rnd() < 0.5 ? { kind: 'skill', id: pick(SKILL_IDS) } : { kind: 'goal', id: pick(GOAL_IDS) });
        const open: QueueItem[] = [];
        for (const id of IDS) for (const ring of (ACTIONS[id].ringed ? [1, 2, 3] : [1]) as (1 | 2 | 3)[]) if (!blockedReason(s, id, ring)) open.push((ring === 1 ? id : `${id}@${ring}`) as QueueItem);
        s = s.hoursToday >= 12 || !open.length || rnd() < 0.08 ? endDay(s) : runAction(s, rnd() < 0.92 ? pick(open) : (pick(IDS) as QueueItem));
      }
      expect(englishIn(journalItems(s.log, 2000, 'D', sv))).toEqual([]);
    }
  });

  it('reads the road’s own run-rumours (ties and organisations) and their hedges in Swedish', () => {
    const lines = [
      'I heard it from Maren: Tobin lent Hedda eleven silver at the racks at Saltmere, and never once asked for it back. Mark what it does to prices on the road.',
      "Everyone's saying it: Gunnar and Anselm had words at the ford at Hollowford, and it took four neighbours to part them.",
      'I saw it myself: Arvid was seen meeting three strangers wearing the Compact\'s sign at the gate at Kestrel Gate, after dark, where nobody was meant to see.',
    ];
    for (const l of lines) expect(englishIn(simLine(l, sv))).toEqual([]);
    expect(simLine(lines[0], sv)).toBe('Jag hörde det från Maren: Tobin lånade Hedda elva silvermynt vid ställningarna i Saltmere, och har aldrig en enda gång bett om att få tillbaka dem. Se vad det gör med priserna längs vägen.');
  });

  it('keeps the English page exactly English', () => {
    const r = busyVillage(ROUTE.findIndex(l => l.kind === 'village'));
    const english = roadView(r, { person: 'hf-tobin' }, en);
    expect(shown(english)).toContain('TRADE — prices in marks');
    // (And the check would see it: the English page is full of the words it looks for.)
    expect(englishIn(english).length).toBeGreaterThan(5);
    // The journal in English is the sim's own lines, untouched.
    expect(journalItems(r.log, 5, 'R', en)).toContain(r.log.at(-1)!.text.replace(/&/g, '&#38;').replace(/'/g, '&#39;').replace(/"/g, '&#34;'));
    expect(Object.keys(VILLAGES)).toHaveLength(3);
  });
});

/** (Unused helper type, kept for the reader: what `t` the views take.) */
export type ViewT = T;
