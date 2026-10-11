/**
 * Acceptance tests for knowledge slice C (#1610, design docs/knowledge-model-design.md): facts
 * written once for a scope (content/scope-facts.json, facts.ts SCOPE_FACTS), so road people can
 * answer village, road and trade questions, behind the `scope-facts` rule switch.
 *
 * - Every road person answers at least one village (villagers), road and role question at their scope.
 * - Elders reach deeper into their village than their neighbours.
 * - A guarded fact is held back below its gate, and never opens sooner than the canon it cites.
 * - Switch off, and in runs from before it: today's answers, word for word.
 * - Every fact is true, names a source that exists, and keeps to canon (no faiths).
 * - The free questions a player would ask (scope-questions.fixture.ts) match more often.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWERS, TELLS, answerFor, ask, topicsKnownBy } from './asks';
import { ALL_FACTS, FACTS, ROAD_REGION, SCOPE_FACTS, factsFor, knowerOf, resolve, scopeFactEntries } from './facts';
import { featureOn, ruleFeatures } from './features';
import { HINTS, matchQuestion } from './free-questions';
import { knows, SENSITIVITY_TRUST, type Fact, type ScopeKind } from './knowledge';
import { SKILLS, type SkillId } from './skills';
import { TOPICS, isTopicKind, mentionsIn, topicDef } from './topics';
import { VILLAGES, TRAVELLERS, type Person } from './villages';
import { NORTH_ROAD } from './world/regions';
import { SCOPE_QUESTIONS } from './scope-questions.fixture';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, ROUTE } from './road';

const root = join(__dirname, '..', '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

const VILLAGERS: readonly Person[] = Object.values(VILLAGES).flatMap(v => v.people);
const EVERYONE: readonly Person[] = [...VILLAGERS, ...TRAVELLERS];
const homeOf = (p: Person): string | undefined => Object.values(VILLAGES).find(v => v.people.includes(p))?.id;
const ENTRIES = scopeFactEntries();
const ON = ruleFeatures();

/** Every topic any scope fact answers. */
const TOPICS_OF_SCOPE = [...new Set(SCOPE_FACTS.flatMap(f => f.about))];

/** The fact `p` tells about `topic` to someone they trust completely, with the scope facts on. */
const toldBy = (p: Person, topic: string): Fact | undefined => {
  const r = resolve(p.id, topic, Infinity, { facts: ALL_FACTS });
  return r?.kind === 'told' ? r.fact : undefined;
};
/** The scope kinds `p` answers anything from, with the scope facts on. */
const scopesTold = (p: Person): Set<ScopeKind> =>
  new Set(TOPICS_OF_SCOPE.map(t => toldBy(p, t)?.scope.kind).filter((k): k is ScopeKind => k !== undefined));

// ── Canon checking, as culture-lore.test.ts does it ──────────────────────────

/** The text under a markdown heading, down to the next heading of the same or a higher level. */
function sectionOf(md: string, heading: string): string | null {
  const lines = md.split('\n');
  const level = (l: string): number => /^(#+)\s/.exec(l)?.[1].length ?? 0;
  const i = lines.findIndex(l => level(l) > 0 && l.replace(/^#+\s+/, '').trim() === heading);
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !(level(lines[j]) > 0 && level(lines[j]) <= level(lines[i]))) j++;
  return lines.slice(i, j).join('\n');
}

/** What's wrong with a source (`file § heading › label`, or `file › label`), or null. */
function sourceProblem(source: string): string | null {
  const [head, label] = source.split(' › ');
  const [file, heading] = head.split(' § ');
  if (!file || !existsSync(join(root, file))) return `no file "${file}"`;
  if (!label) return 'no label: say which line it rests on';
  const text = read(file);
  const section = heading ? sectionOf(text, heading) : text;
  if (section === null) return `no heading "${heading}" in ${file}`;
  if (!section.includes(label)) return `no "${label}" under ${heading ?? file}`;
  return null;
}

/**
 * The trust gate on the line a source cites, if it cites a lore line (villages.ts) or a
 * hand-written answer (answers.ts): a fact must never open sooner than the words it rests on.
 */
function citedGate(source: string): number | null {
  const [head, label] = source.split(' › ');
  if (!label) return null;
  const unescape = (s: string) => s.replace(/\\'/g, "'");
  if (head === 'src/artificer/villages.ts') {
    const line = EVERYONE.flatMap(p => p.lore).find(l => l.text.includes(unescape(label)));
    return line ? line.at : null;
  }
  if (head === 'src/artificer/answers.ts') {
    const a = Object.values(ANSWERS).flatMap(byKey => Object.values(byKey)).find(x => x.text.includes(unescape(label)));
    return a ? a.at : null;
  }
  return null;
}

// ── A road harness, as features.test.ts has it ───────────────────────────────

/** A thaw survivor whose world has `features`, on the road at its first village (Hollowford). */
function onTheRoad(features: Record<string, boolean> | undefined): ReturnType<typeof createRoad> {
  const s = createRegion1({}, undefined, { id: 'w-scope-facts', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = {
    ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10, rations: 6 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
    config: { ...s.config, world: { ...s.config.world, ...(features ? { features } : {}) } },
  };
  const village = ROUTE.findIndex(l => l.kind === 'village');
  let r = createRoad(from);
  for (let i = 0; i < 10 && r.leg < village; i++) r = endRoadDay(r);
  return r;
}

/** Ask Maren about Hollowford on the road, trusting her `trust`, in a run with `features`. */
function askMarenAboutHollowford(features: Record<string, boolean> | undefined, trust = 90): string | undefined {
  const r = onTheRoad(features);
  const before = { ...r, focus: { kind: 'place', id: 'hollowford' } as const, trust: { ...r.trust, 'hf-maren': trust } };
  return runRoadAction(before, 'ask:hf-maren').log.at(-1)?.text;
}

describe('Knowledge slice C: what a village, the road and a trade know (#1610)', () => {
  it('is written as the model reads it: scopes that exist, topics that exist, one plain line each', () => {
    const roles = new Set(EVERYONE.map(p => p.role));
    const taught = new Set(EVERYONE.flatMap(p => (p.teaches ? [p.teaches.skill] : [])));
    expect(new Set(ENTRIES.map(e => e.id)).size).toBe(ENTRIES.length);
    for (const e of ENTRIES) {
      const at = e.id;
      const { kind, id } = e.scope;
      if (kind === 'village') expect(VILLAGES[id!], at).toBeDefined();
      else if (kind === 'region') expect([ROAD_REGION, NORTH_ROAD], at).toContain(id);
      else if (kind === 'role') expect(roles.has(id as Person['role']), at).toBe(true);
      else if (kind === 'skill') expect(taught.has(id as SkillId), at).toBe(true);
      // People's and cultures' ways stay in culture-lore.ts; no one person's words go here either.
      else throw new Error(`${at}: a scope fact is for a village, the road, a role or a taught skill, not ${kind}`);
      expect(e.about.length, at).toBeGreaterThan(0);
      for (const key of e.about) {
        const [k, ...rest] = key.split(':');
        const tid = rest.join(':');
        const ok = isTopicKind(k) ? topicDef(k, tid) !== undefined : k === 'skill' && tid in SKILLS;
        expect(ok, `${at}: ${key} is a topic`).toBe(true);
      }
      expect(e.text, at).not.toMatch(/\n/);
      expect(e.text.length, at).toBeLessThanOrEqual(170);
      expect(['public', 'guarded', 'private', 'secret', undefined], at).toContain(e.sensitivity);
      expect([1, 2, 3, undefined], at).toContain(e.depth);
      if (e.lead) expect(EVERYONE.some(p => p.id === e.lead), at).toBe(true);
    }
    // Counts per scope, as the PR reports them.
    const per = (k: ScopeKind) => ENTRIES.filter(e => e.scope.kind === k).length;
    expect({ village: per('village'), region: per('region'), role: per('role'), skill: per('skill') }).toEqual({ village: 30, region: 21, role: 11, skill: 4 });
  });

  it('every road person answers a village question (villagers), a road question and a role question at their scope', () => {
    for (const p of EVERYONE) {
      const scopes = scopesTold(p);
      if (homeOf(p)) expect(scopes.has('village'), `${p.id}: a village fact`).toBe(true);
      expect(scopes.has('region'), `${p.id}: a road fact`).toBe(true);
      expect(scopes.has('role') || scopes.has('skill'), `${p.id}: a fact of their trade`).toBe(true);
      // And about their own role topic, everyone has something to say, theirs or their trade's.
      expect(toldBy(p, `role:${p.role}`), `${p.id} on role:${p.role}`).toBeDefined();
    }
  });

  it('every village has its trade, its people, its news and the road, and everyone on the road knows each village', () => {
    for (const v of Object.values(VILLAGES)) {
      const own = SCOPE_FACTS.filter(f => f.scope.kind === 'village' && f.scope.id === v.id);
      const topics = new Set(own.flatMap(f => f.about));
      // Who's who: every role in the village, and every one of its people, by name.
      for (const p of v.people) {
        expect(topics.has(`person:${p.id}`), `${v.id}: who ${p.name} is`).toBe(true);
        expect(topics.has(`role:${p.role}`), `${v.id}: who's the ${p.role}`).toBe(true);
      }
      // Its trade: what it lives on, and at least two goods.
      expect(own.some(f => f.about.some(t => t.startsWith('material:'))), `${v.id}: a good`).toBe(true);
      expect(own.filter(f => f.about.some(t => t.startsWith('material:'))).length).toBeGreaterThanOrEqual(2);
      // Everyone on the road can say something of each village.
      for (const p of EVERYONE) expect(toldBy(p, `place:${v.id}`) ?? answerFor(p.id, `place:${v.id}`), `${p.id} on ${v.id}`).toBeDefined();
    }
  });

  it('elders reach deeper into their village than their neighbours', () => {
    for (const v of Object.values(VILLAGES)) {
      const elder = v.people.find(p => p.role === 'elder')!;
      const deep = SCOPE_FACTS.filter(f => f.scope.kind === 'village' && f.scope.id === v.id && f.depth === 3);
      expect(deep.length, v.id).toBeGreaterThan(0);
      for (const f of deep) {
        expect(knows(knowerOf(elder.id)!, f), `${elder.id} knows ${f.id}`).toBe(true);
        for (const p of v.people.filter(x => x !== elder)) expect(knows(knowerOf(p.id)!, f), `${p.id} doesn't know ${f.id}`).toBe(false);
        // And asked about it, the elder answers with the deep fact; a neighbour without their own
        // words on it answers with the plain one, or not at all.
        const topic = f.about[0];
        expect(toldBy(elder, topic)?.id).toBe(f.id);
        for (const p of v.people.filter(x => x !== elder)) {
          const theirs = toldBy(p, topic);
          expect(theirs?.id, p.id).not.toBe(f.id);
          if (theirs && theirs.scope.kind !== 'person') expect(theirs.depth ?? 1, p.id).toBe(1);
        }
      }
    }
    // Maren on Hollowford: the ford, and this spring's news; Tobin: what it lives on.
    expect(toldBy(VILLAGES.hollowford.people[0], 'place:hollowford')?.id).toBe('scope:hollowford/news');
    expect(toldBy(VILLAGES.hollowford.people[1], 'place:hollowford')?.id).toBe('scope:hollowford/lives-on');
    // Traders and the caravan reach deeper into the road: Tobin knows where the caravan won't camp, Isa doesn't.
    expect(toldBy(VILLAGES.hollowford.people[1], 'place:north-road')?.id).toBe('scope:north-road/dangers');
    expect(toldBy(VILLAGES.hollowford.people[2], 'place:north-road')?.id).toBe('scope:north-road/stages');
  });

  it('holds a guarded fact back below its gate, and tells it at the gate', () => {
    const guarded = SCOPE_FACTS.filter(f => f.sensitivity !== 'public');
    expect(guarded.length).toBeGreaterThanOrEqual(8);
    for (const f of guarded) {
      const gate = SENSITIVITY_TRUST[f.sensitivity];
      for (const p of EVERYONE) {
        for (const topic of f.about) {
          if (toldBy(p, topic)?.id !== f.id) continue;
          expect(resolve(p.id, topic, gate - 1, { facts: ALL_FACTS })?.kind, `${p.id} on ${topic} below ${gate}`).toBe('not-yet');
          expect(resolve(p.id, topic, gate, { facts: ALL_FACTS })?.kind, `${p.id} on ${topic} at ${gate}`).toBe('told');
        }
      }
    }
    // Isa on the goblins in the quarry: a neighbourly secret, for someone she knows a little.
    expect(ask(VILLAGES.hollowford.people[2], 'group:compact', 'the Compact', 10, [], { facts: ALL_FACTS }).kind).toBe('not-yet');
    expect(ask(VILLAGES.hollowford.people[2], 'group:compact', 'the Compact', 25, [], { facts: ALL_FACTS }).kind).toBe('told');
  });

  it('never opens a fact sooner than the lore line or answer it rests on', () => {
    for (const e of ENTRIES) {
      const gate = citedGate(e.source);
      if (gate === null) continue;
      expect(SENSITIVITY_TRUST[e.sensitivity ?? 'public'], `${e.id} cites a line told at ${gate}`).toBeGreaterThanOrEqual(gate);
    }
  });

  it('nobody tells their village’s line about themself', () => {
    // Asked about themself, a person has no village or road fact to give…
    for (const p of EVERYONE) expect(toldBy(p, `person:${p.id}`), p.id).toBeUndefined();
    expect(topicsKnownBy('hf-tobin', ALL_FACTS)).not.toContain('person:hf-tobin');
    expect(topicsKnownBy('hf-tobin', ALL_FACTS)).toContain('person:hf-isa');
    // …and no fact naming someone is ever what that someone says, on any of its topics.
    for (const f of SCOPE_FACTS) {
      const named = mentionsIn(f.text).filter(k => k.startsWith('person:')).map(k => k.slice(7));
      for (const id of named) {
        const p = EVERYONE.find(x => x.id === id)!;
        for (const topic of f.about) expect(toldBy(p, topic)?.id, `${p.id} on ${topic}`).not.toBe(f.id);
      }
    }
  });

  it('has nothing written that no one would ever say', () => {
    const said = new Set(EVERYONE.flatMap(p => TOPICS_OF_SCOPE.map(t => toldBy(p, t)?.id)));
    expect(SCOPE_FACTS.filter(f => !said.has(f.id)).map(f => f.id)).toEqual([]);
  });
});

describe('Scope facts are a rules feature (#1610)', () => {
  it('registers as experimental, on in a new game, off for runs from before its switch', () => {
    expect(ON['scope-facts']).toBe(true);
    expect(featureOn(undefined, 'scope-facts')).toBe(false);
    expect(factsFor(undefined)).toBe(FACTS);
    expect(factsFor({ 'scope-facts': false })).toBe(FACTS);
    expect(factsFor(ON)).toBe(ALL_FACTS);
  });

  it('changes no answer anyone gave before: every one of today’s answers is the same with the scope facts', () => {
    for (const p of EVERYONE) {
      for (const key of topicsKnownBy(p.id)) expect([p.id, key, answerFor(p.id, key, ALL_FACTS)]).toEqual([p.id, key, answerFor(p.id, key)]);
      // Today's topics come first, in today's order.
      expect(topicsKnownBy(p.id, ALL_FACTS).slice(0, topicsKnownBy(p.id).length)).toEqual(topicsKnownBy(p.id));
    }
  });

  it('on the road: switch on, Maren tells you about Hollowford; off, or from before the switch, she doesn’t know', () => {
    expect(askMarenAboutHollowford(ON)).toMatch(/^Maren: "The ford is older than the village/);
    const today = 'Maren thinks, and shakes their head. "I don\'t know much about Hollowford."';
    expect(askMarenAboutHollowford({ ...ON, 'scope-facts': false, referrals: false })).toBe(today);
    expect(askMarenAboutHollowford(undefined)).toBe(today);
    // Guarded: below 25, not yet.
    expect(askMarenAboutHollowford(ON, 20)).toMatch(/Ask me again when I know you better/);
  });

  it('a road fact can send you on: off the road’s iron, a lead to Sabine', () => {
    const r = onTheRoad(ON);
    const before = { ...r, focus: { kind: 'material', id: 'iron' } as const, trust: { ...r.trust, 'hf-isa': 90 } };
    const after = runRoadAction(before, 'ask:hf-isa');
    expect(after.leads?.map(l => [l.who, l.about, l.from])).toEqual([['kg-sabine', 'material:iron', 'hf-isa']]);
    const off = runRoadAction({ ...before, features: { ...ON, 'scope-facts': false } }, 'ask:hf-isa');
    expect(off.leads ?? []).toEqual([]);
  });

  it('a free question with the switch on matches the new topics; off, as before', () => {
    expect(matchQuestion('hf-isa', 'Who is the elder here?', [], factsFor(ON))).toBe('role:elder');
    expect(matchQuestion('hf-isa', 'Who is the elder here?')).toBe(null);
    const r = runRoadAction({ ...onTheRoad(ON), trust: { ...onTheRoad(ON).trust, 'hf-isa': 50 } }, 'question:hf-isa:role:elder');
    expect(r.log.at(-1)?.text).toMatch(/Maren is our elder/);
  });
});

describe('Free questions the road can now answer (#1610)', () => {
  const villageQuestions = (v: string) => SCOPE_QUESTIONS.filter(q => q.village === v);

  it('has 20+ realistic questions per village', () => {
    for (const v of Object.keys(VILLAGES)) expect(villageQuestions(v).length, v).toBeGreaterThanOrEqual(20);
    for (const q of SCOPE_QUESTIONS) expect(VILLAGES[q.village].people.some(p => p.id === q.person), q.question).toBe(true);
  });

  it('answers many more of them with the switch on', () => {
    const counts = Object.keys(VILLAGES).map(v => {
      const qs = villageQuestions(v);
      const before = qs.filter(q => matchQuestion(q.person, q.question) !== null).length;
      const after = qs.filter(q => matchQuestion(q.person, q.question, [], factsFor(ON)) !== null).length;
      const rightBefore = qs.filter(q => q.want !== null && matchQuestion(q.person, q.question) === q.want).length;
      const right = qs.filter(q => q.want !== null && matchQuestion(q.person, q.question, [], factsFor(ON)) === q.want).length;
      return { v, n: qs.length, before, rightBefore, after, right };
    });
    // The numbers the PR reports (before → after, and how many matched the topic a good answer
    // comes from). Pinned, so a change to the facts or hints shows up here.
    expect(counts).toEqual([
      { v: 'hollowford', n: 25, before: 3, rightBefore: 1, after: 21, right: 19 },
      { v: 'saltmere', n: 25, before: 3, rightBefore: 0, after: 20, right: 18 },
      { v: 'kestrel-gate', n: 25, before: 4, rightBefore: 1, after: 23, right: 18 },
    ]);
  });

  it('keeps old matching unchanged: the new hints only point at topics nobody knows without the switch', () => {
    const NEW_HINTS = ['place:north-road', 'place:hollowford', 'place:saltmere', 'place:mistheim', 'role:elder', 'role:trader', 'role:healer', 'role:hunter', 'role:teacher', 'role:caravaneer', 'role:tinker', 'skill:firstaid'];
    for (const key of NEW_HINTS) {
      expect(HINTS[key], key).toBeDefined();
      for (const p of EVERYONE) expect(answerFor(p.id, key), `${p.id} on ${key} without the switch`).toBeUndefined();
    }
  });

  it('names the road only in new lines: no lore line, answer or tell before it makes it heard', () => {
    expect(TOPICS.place['north-road']).toBeDefined();
    const lines = [
      ...EVERYONE.flatMap(p => p.lore.map(l => l.text)),
      ...Object.values(ANSWERS).flatMap(byKey => Object.values(byKey).map(a => a.text)),
      ...Object.values(TELLS).flatMap(byDeed => Object.values(byDeed).map(t => t.answer.text)),
    ];
    expect(lines.filter(t => mentionsIn(t).includes('place:north-road'))).toEqual([]);
    expect(SCOPE_FACTS.some(f => mentionsIn(f.text).includes('place:north-road'))).toBe(true);
  });
});

describe('Every scope fact can be checked against canon (#1610)', () => {
  it('names a source for every fact: a file that exists, with its heading and the line it rests on', () => {
    expect(ENTRIES.map(e => sourceProblem(e.source) && `${e.id}: ${sourceProblem(e.source)}`).filter(Boolean)).toEqual([]);
  });

  it('holds only true facts (the canon rule is for true facts; rumours come with slice G)', () => {
    for (const e of ENTRIES) expect(e.truth, e.id).toBe('true');
    // Some were written for the game to fit canon rather than quoted from it; the owner reviewed
    // them and made them canon (2026-10-11), and each says when.
    expect(ENTRIES.filter(e => e.canonised).length).toBeGreaterThan(0);
    for (const e of ENTRIES) if (e.canonised) expect(e.canonised, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps to canon on faith: the gods are dead, so nobody worships them', () => {
    const texts = ENTRIES.map(e => e.text);
    expect(texts.filter(t => /\b(?:worship|temples?|priests?|shrines?|altars?|holy|blessings?|pray\w*|gods?)\b/i.test(t))).toEqual([]);
  });

  it('keeps the culture lore where it is: no People’s or culture’s ways repeated here', () => {
    for (const e of ENTRIES) expect(['people', 'culture'], e.id).not.toContain(e.scope.kind);
  });
});
