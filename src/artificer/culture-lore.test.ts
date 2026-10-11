/**
 * Acceptance tests for #1590 — world lore: what each People and each road culture values, shames,
 * does and believes about the others, as claims the knowledge model (#1577) can be given, each
 * checkable against canon.
 *
 * Coverage rule: all 15 Peoples, and every culture the caravan road uses (each villager's and
 * traveller's `culture`, and each village's `cultures`). Every People holds a view of every other
 * People; every road culture a view of every other road culture.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CUSTOM_KINDS, PEOPLES, allCultureLore, allPeopleLore, allScopedClaims, cultureLore, matchLore, parseLoreQuestion,
  peopleLore, scopedClaims, voiceOf, type GroupLore, type LoreClaim, type Saying,
} from './culture-lore';
import { TRAVELLERS, VILLAGES, personById, type Person } from './villages';
import { REACH_CULTURES } from './world/peoples';

const root = join(__dirname, '..', '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

/** The Peoples table in docs/peoples-and-races.md, ids as code uses them ("Merfolk (Djupvolk)" → Merfolk). */
const CANON_PEOPLES = read('docs/peoples-and-races.md').split('\n')
  .map(l => /^\| (\d+) \| ([^|]+?) \|/.exec(l))
  .filter((m): m is RegExpExecArray => m !== null)
  .map(m => m[2].replace(/\s*\(.*\)$/, '').trim());

/** Every culture on the road: each person's (villagers and travellers) and each village's. */
const ROAD_CULTURES = [...new Set([
  ...Object.values(VILLAGES).flatMap(v => [...v.cultures, ...v.people.map(p => p.culture)]),
  ...TRAVELLERS.map(p => p.culture),
])].sort();

const CULTURES_JSON = JSON.parse(read('macro-world/cultures.json')) as { cultures: { id: string; name: string }[] };

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

/** What's wrong with a source (`file § heading › label`), or null: the file, heading and label must all be there. */
function sourceProblem(source: string): string | null {
  const [head, label] = source.split(' › ');
  const [file, heading] = head.split(' § ');
  if (!file || !existsSync(join(root, file))) return `no file "${file}"`;
  const text = read(file);
  const section = heading ? sectionOf(text, heading) : text;
  if (section === null) return `no heading "${heading}" in ${file}`;
  if (label && !section.includes(label)) return `no "${label}" under ${heading ?? file}`;
  return null;
}

/** Every claim written for a People or culture, with where it sits (for messages). */
function claimsOf(g: GroupLore): { at: string; c: LoreClaim }[] {
  return [
    ...g.values.map((c, i) => ({ at: `${g.id} values[${i}]`, c })),
    ...g.taboos.map((c, i) => ({ at: `${g.id} taboos[${i}]`, c })),
    ...CUSTOM_KINDS.map(k => ({ at: `${g.id} customs.${k}`, c: g.customs[k] })),
    ...Object.entries(g.views).flatMap(([of, cs]) => cs.map((c, i) => ({ at: `${g.id} views.${of}[${i}]`, c }))),
  ];
}
const sayingsOf = (g: GroupLore): { at: string; s: Saying }[] =>
  [{ at: `${g.id} voice`, s: g.voice }, ...g.sayings.map((s, i) => ({ at: `${g.id} sayings[${i}]`, s }))];

const GROUPS: readonly GroupLore[] = [...allPeopleLore(), ...allCultureLore()];
const ALL_CLAIMS = GROUPS.flatMap(claimsOf);
const ALL_SAYINGS = GROUPS.flatMap(sayingsOf);

const orrin = personById('hf-orrin')!;
const maren = personById('hf-maren')!;
const yrsa = personById('sm-yrsa')!;

describe('World lore covers every People and road culture (#1590)', () => {
  it('has lore for exactly the 15 Peoples, under the canon ids code uses', () => {
    expect(CANON_PEOPLES).toHaveLength(15);
    expect([...PEOPLES]).toEqual(CANON_PEOPLES);
    expect(allPeopleLore().map(p => p.id)).toEqual(CANON_PEOPLES);
    for (const p of allPeopleLore()) expect(p.name).toBe(p.id);
  });

  it('has lore for exactly the cultures the road uses, under cultures.json ids and names', () => {
    // The Reach's own cultures (world/peoples.ts) are all on the road too.
    for (const c of REACH_CULTURES) expect(ROAD_CULTURES).toContain(c.id);
    expect(allCultureLore().map(c => c.id).sort()).toEqual(ROAD_CULTURES);
    for (const c of allCultureLore()) {
      const canon = CULTURES_JSON.cultures.find(x => x.id === c.id);
      expect(canon, `${c.id} is in macro-world/cultures.json`).toBeDefined();
      expect(c.name).toBe(canon!.name);
    }
  });

  it('gives each People and culture values, taboos, all four customs, a voice and sayings', () => {
    for (const g of GROUPS) {
      expect(g.values.length, `${g.id} values`).toBeGreaterThanOrEqual(2);
      expect(g.taboos.length, `${g.id} taboos`).toBeGreaterThanOrEqual(2);
      for (const k of CUSTOM_KINDS) expect(g.customs[k]?.text, `${g.id} ${k}`).toBeTruthy();
      expect(g.voice.text, `${g.id} voice`).toBeTruthy();
      expect(g.sayings.length, `${g.id} sayings`).toBeGreaterThanOrEqual(3);
      expect(g.names, `${g.id} can be named`).toContain(g.id);
    }
  });

  it('gives each People a view of every other People, and each culture a view of every other road culture', () => {
    for (const p of allPeopleLore()) {
      expect(Object.keys(p.views).sort(), p.id).toEqual(PEOPLES.filter(x => x !== p.id).sort());
      for (const [of, cs] of Object.entries(p.views)) expect(cs.length, `${p.id} of ${of}`).toBeGreaterThan(0);
    }
    for (const c of allCultureLore()) {
      expect(Object.keys(c.views).sort(), c.id).toEqual(ROAD_CULTURES.filter(x => x !== c.id));
      for (const [of, cs] of Object.entries(c.views)) expect(cs.length, `${c.id} of ${of}`).toBeGreaterThan(0);
    }
  });

  it('has every People met on the road hold at least one belief that is wrong or only half true', () => {
    const onRoad = new Set([...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS].map(p => p.people));
    expect(onRoad.size).toBeGreaterThanOrEqual(8);
    for (const id of onRoad) {
      const wrong = Object.values(peopleLore(id)!.views).flat().filter(c => c.truth !== 'true');
      expect(wrong.length, `${id} holds a prejudice or a wrong belief`).toBeGreaterThan(0);
    }
  });
});

describe('Every lore line can be checked against canon (#1590)', () => {
  it('names a source for every claim, saying and correction: a file that exists, with its heading and label', () => {
    const problems = [
      ...ALL_CLAIMS.flatMap(({ at, c }) => [
        sourceProblem(c.source) && `${at}: ${sourceProblem(c.source)}`,
        c.actually && sourceProblem(c.actually.source) && `${at} actually: ${sourceProblem(c.actually.source)}`,
      ]),
      ...ALL_SAYINGS.map(({ at, s }) => sourceProblem(s.source) && `${at}: ${sourceProblem(s.source)}`),
    ].filter(Boolean);
    expect(problems).toEqual([]);
  });

  it('says what is actually so for every rumour or false belief, and only for those', () => {
    for (const { at, c } of ALL_CLAIMS) {
      expect(['true', 'rumour', 'false'], at).toContain(c.truth);
      if (c.truth === 'true') expect(c.actually, at).toBeUndefined();
      else expect(c.actually?.text, at).toBeTruthy();
    }
    // There's real prejudice in here, not just a token line.
    expect(ALL_CLAIMS.filter(({ c }) => c.truth === 'false').length).toBeGreaterThanOrEqual(15);
    expect(ALL_CLAIMS.filter(({ c }) => c.truth === 'rumour').length).toBeGreaterThanOrEqual(8);
  });

  it('keeps every line short: a line or two, for a game kids play', () => {
    const long = [...ALL_CLAIMS.flatMap(({ at, c }) => [{ at, text: c.text }, ...(c.actually ? [{ at: `${at} actually`, text: c.actually.text }] : [])]),
      ...ALL_SAYINGS.map(({ at, s }) => ({ at, text: s.text }))].filter(x => x.text.length > 170);
    expect(long).toEqual([]);
  });

  it('keeps to canon on faith: the gods are dead, so nobody worships them', () => {
    const lines = [...ALL_CLAIMS.map(({ at, c }) => ({ at, text: c.text })), ...ALL_SAYINGS.map(({ at, s }) => ({ at, text: s.text }))];
    expect(lines.filter(l => /\b(?:worship|temples?|priests?|shrines?|altars?|holy|blessings?)\b/i.test(l.text))).toEqual([]);
    expect(lines.filter(l => /\bgods?\b/i.test(l.text) && !/\bdead\b/i.test(l.text))).toEqual([]);
    expect(lines.filter(l => /\bpray/i.test(l.text) && !/\bno prayers\b/i.test(l.text))).toEqual([]);
  });

  it('only uses the knowledge model’s sensitivities', () => {
    for (const { at, c } of ALL_CLAIMS) if (c.sensitivity) expect(['public', 'guarded', 'private', 'secret'], at).toContain(c.sensitivity);
  });
});

describe('Lore as scoped claims for the knowledge model (#1590, feeds #1577 slice C)', () => {
  it('turns a People’s lore into claims scoped to it, with topics and truth carried over', () => {
    const berg = scopedClaims({ kind: 'people', id: 'Bergfolk' });
    const values = berg.filter(c => c.topic === 'values');
    expect(values.map(c => c.text)).toEqual(peopleLore('Bergfolk')!.values.map(c => c.text));
    expect(values[0]).toMatchObject({ scope: { kind: 'people', id: 'Bergfolk' }, about: ['group:Bergfolk', 'lore:values'], truth: 'true', sensitivity: 'public', depth: 1, invented: false });
    const goblins = berg.filter(c => c.topic === 'view' && c.of?.id === 'Goblins');
    expect(goblins[0]).toMatchObject({ of: { kind: 'people', id: 'Goblins' }, about: ['group:Goblins', 'lore:view'], truth: 'false' });
    expect(goblins[0].actually?.text).toMatch(/upper levels/);
    expect(berg.filter(c => c.topic === 'mourning')).toHaveLength(1);
  });

  it('scopes a culture’s lore to the culture, and gives every claim a unique id', () => {
    const ridge = scopedClaims({ kind: 'culture', id: 'ridgefolk' });
    expect(ridge.every(c => c.scope.kind === 'culture' && c.scope.id === 'ridgefolk')).toBe(true);
    expect(ridge.find(c => c.topic === 'mourning')?.about).toEqual(['culture:ridgefolk', 'lore:mourning']);
    const all = allScopedClaims();
    expect(all).toHaveLength(ALL_CLAIMS.length);
    expect(new Set(all.map(c => c.id)).size).toBe(all.length);
    expect(scopedClaims({ kind: 'people', id: 'Humans' })).toEqual([]);
  });

  it('keeps voice apart from claims: how a People or culture sounds, and their sayings', () => {
    expect(voiceOf({ kind: 'people', id: 'Viddfolk' })?.sayings.map(s => s.text)).toContain("We don't take sides. We take the road.");
    expect(voiceOf({ kind: 'culture', id: 'wallborn' })?.voice.text).toMatch(/toll/);
    expect(cultureLore('nestborne')).toBeUndefined();
  });
});

describe('Matching a question to lore (#1590)', () => {
  it('answers "What do the Bergfolk believe?" asked of Orrin from the Bergfolk’s own values', () => {
    const m = matchLore('What do the Bergfolk believe?', orrin)!;
    expect(m.query).toMatchObject({ subject: { kind: 'people', id: 'Bergfolk' }, topic: 'values' });
    expect(m.claims.length).toBeGreaterThan(0);
    expect(m.claims.every(c => c.scope.id === 'Bergfolk' && c.topic === 'values')).toBe(true);
  });

  it('answers a mourning question about a road culture with that culture’s custom', () => {
    const asked = matchLore('What do ridgefolk do when someone dies?', orrin)!;
    expect(asked.claims.map(c => c.id)).toEqual(['culture:ridgefolk/mourning/0']);
    expect(asked.claims[0].text).toBe(cultureLore('ridgefolk')!.customs.mourning.text);
    // The same with nobody in particular asked.
    expect(matchLore('What do ridgefolk do when someone dies?')!.claims.map(c => c.id)).toEqual(['culture:ridgefolk/mourning/0']);
  });

  it('answers a question about themself from their culture first, then their People', () => {
    const m = matchLore('What do you do when someone dies?', orrin)!;
    expect(m.claims.map(c => c.id)).toEqual(['culture:ridgefolk/mourning/0', 'people:Bergfolk/mourning/0']);
    // "Your people" asks after the People first.
    expect(matchLore('How do your people mourn?', orrin)!.claims[0].id).toBe('people:Bergfolk/mourning/0');
  });

  it('answers what they think of another People with their People’s view, prejudice included', () => {
    const m = matchLore('What do you think of goblins?', orrin)!;
    expect(m.query).toMatchObject({ subject: null, of: { kind: 'people', id: 'Goblins' }, topic: 'view' });
    expect(m.claims[0]).toMatchObject({ scope: { id: 'Bergfolk' }, of: { id: 'Goblins' }, truth: 'false' });
  });

  it('has an outsider answer with what their own People thinks, and never speak for another group', () => {
    const m = matchLore('What do the Bergfolk believe?', maren)!;
    expect(m.claims.every(c => c.scope.id === 'Markfolk' && c.topic === 'view' && c.of?.id === 'Bergfolk')).toBe(true);
    expect(matchLore('What do the goblins think of the Bergfolk?', orrin)).toBeNull();
    expect(matchLore('What do the goblins think of the Bergfolk?')!.claims[0].scope.id).toBe('Goblins');
  });

  it('knows the Peoples and cultures by other names, and the topics by many words', () => {
    expect(matchLore('What do dwarves value most?')!.claims[0].id).toBe('people:Bergfolk/values/0');
    expect(matchLore('How do the Viddfolk greet each other?', yrsa)!.claims.map(c => c.id)).toEqual(['people:Viddfolk/greeting/0']);
    expect(matchLore('Is it rude to touch a smith’s tools in the holds?')!.claims[0].scope).toEqual({ kind: 'culture', id: 'mountainhold' });
    expect(matchLore('How do harbour folk settle a debt?')!.claims.map(c => c.id)).toEqual(['culture:harborfolk/debt/0']);
    expect(matchLore('What do the elves think of the dwarves?')!.claims[0].id).toBe('people:Lövfolk/view:Bergfolk/0');
    // A culture named for a People is the culture, not the People.
    expect(matchLore('What happens at a funeral in the Viddfolk Camps?')!.claims[0].scope).toEqual({ kind: 'culture', id: 'steppe-camp' });
    expect(parseLoreQuestion('What do the Bergfolk believe about goblins?')).toMatchObject({ subject: { id: 'Bergfolk' }, of: { id: 'Goblins' }, topic: 'view' });
  });

  it('matches nothing when no People, culture or lore topic is asked about', () => {
    expect(matchLore('What is your favourite colour?', orrin)).toBeNull();
    expect(matchLore('Where can I find iron?', orrin)).toBeNull();
    expect(matchLore('   ')).toBeNull();
  });

  it('is the same every time: no randomness, nothing but the words', () => {
    const q = 'What do the Steinfolk think of the Bergfolk?';
    expect(matchLore(q)).toEqual(matchLore(q));
    const asker: Person = TRAVELLERS.find(p => p.id === 'cv-pim')!;
    expect(matchLore('What do you think of the Pandor?', asker)).toEqual(matchLore('What do you think of the Pandor?', asker));
  });
});
