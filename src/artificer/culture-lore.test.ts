/**
 * Acceptance tests for #1590 — world lore: what each People and each road culture values, shames,
 * does and believes about the others, as claims the knowledge model (#1577) can be given, each
 * checkable against canon.
 *
 * Coverage rule: all 18 Peoples (the first 15 of WORLD.md, the Wildkin, #1606, and the two human Peoples,
 * the Riksfolk and the Strandfolk, #1623), and every culture the
 * caravan road uses (each villager's and traveller's `culture`, and each village's `cultures`).
 * Every People holds a view of every other People; every road culture a view of every other road
 * culture and of every People.
 *
 * The owner's answers of 2026-10-11 are pinned here too: how openly a view is voiced depends on the
 * culture's candour, the belief's strength and the trust; a culture's custom wins over the People's;
 * cultures hold views of Peoples, and an outsider answers from their culture's view first.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANDOURS, CUSTOM_KINDS, PEOPLES, STRENGTHS, allCultureLore, allPeopleLore, allScopedClaims, cultureLore, matchLore,
  parseLoreQuestion, peopleLore, scopedClaims, voiceOf, voicedAt, voicingGates, type CultureLore, type GroupLore,
  type LoreClaim, type Saying, type ScopedClaim,
} from './culture-lore';
import { TRAVELLERS, VILLAGES, personById, type Person } from './villages';
import { REACH_CULTURES } from './world/peoples';

const root = join(__dirname, '..', '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

/** The Peoples table in docs/peoples-and-races.md, ids as code uses them ("Merfolk (Djupvolk)" → Merfolk). */
const DOC_PEOPLES = read('docs/peoples-and-races.md').split('\n')
  .map(l => /^\| (\d+) \| ([^|]+?) \|/.exec(l))
  .filter((m): m is RegExpExecArray => m !== null)
  .map(m => m[2].replace(/\s*\(.*\)$/, '').trim());
/**
 * The canon Peoples: the doc's table, plus the Wildkin if it doesn't list them yet. The owner made
 * them the 16th People on 2026-10-11 (#1606); #1604 adds them to the doc's table as #16. Until it
 * merges, this branch's copy has 15, so the test takes either.
 */
const CANON_PEOPLES = DOC_PEOPLES.includes('Wildkin') ? DOC_PEOPLES : [...DOC_PEOPLES, 'Wildkin'];

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
    ...Object.entries((g as Partial<CultureLore>).peopleViews ?? {}).flatMap(([of, cs]) => cs.map((c, i) => ({ at: `${g.id} peopleViews.${of}[${i}]`, c }))),
  ];
}
/** Every view, with who holds it (for the strength check). */
const viewsIn = (g: GroupLore): LoreClaim[] => [...Object.values(g.views), ...Object.values((g as Partial<CultureLore>).peopleViews ?? {})].flat();
const sayingsOf = (g: GroupLore): { at: string; s: Saying }[] =>
  [{ at: `${g.id} voice`, s: g.voice }, ...g.sayings.map((s, i) => ({ at: `${g.id} sayings[${i}]`, s }))];

const GROUPS: readonly GroupLore[] = [...allPeopleLore(), ...allCultureLore()];
const ALL_CLAIMS = GROUPS.flatMap(claimsOf);
const ALL_SAYINGS = GROUPS.flatMap(sayingsOf);

const orrin = personById('hf-orrin')!;
const maren = personById('hf-maren')!;
const yrsa = personById('sm-yrsa')!;
const veit = personById('kg-veit')!;
const runa = personById('kg-runa')!;

describe('World lore covers every People and road culture (#1590)', () => {
  it('has lore for exactly the 18 Peoples, the Wildkin and the human Peoples among them, under the canon ids code uses', () => {
    expect(DOC_PEOPLES.length).toBeGreaterThanOrEqual(15);
    expect(CANON_PEOPLES).toHaveLength(18);
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

  it('gives each People a view of every other People, and each culture a view of every other road culture and every People', () => {
    for (const p of allPeopleLore()) {
      expect(Object.keys(p.views).sort(), p.id).toEqual(PEOPLES.filter(x => x !== p.id).sort());
      for (const [of, cs] of Object.entries(p.views)) expect(cs.length, `${p.id} of ${of}`).toBeGreaterThan(0);
    }
    for (const c of allCultureLore()) {
      expect(Object.keys(c.views).sort(), c.id).toEqual(ROAD_CULTURES.filter(x => x !== c.id));
      for (const [of, cs] of Object.entries(c.views)) expect(cs.length, `${c.id} of ${of}`).toBeGreaterThan(0);
      // Item 4 (owner, 2026-10-11): cultures hold views of Peoples too, all 18.
      expect(Object.keys(c.peopleViews), c.id).toEqual([...PEOPLES]);
      for (const [of, cs] of Object.entries(c.peopleViews)) expect(cs.length, `${c.id} of ${of}`).toBeGreaterThan(0);
    }
  });

  it('gives every culture a candour, and every wrong or half-true view a strength', () => {
    for (const c of allCultureLore()) expect(CANDOURS, c.id).toContain(c.candour);
    // Some of each, so the rule has something to tell apart.
    for (const k of CANDOURS) expect(allCultureLore().some(c => c.candour === k), k).toBe(true);
    for (const g of GROUPS) {
      for (const v of viewsIn(g)) {
        if (v.truth === 'true') expect(v.strength, `${g.id}: ${v.text}`).toBeUndefined();
        else expect(STRENGTHS, `${g.id}: ${v.text}`).toContain(v.strength);
      }
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
    expect(ridge.find(c => c.id === 'culture:ridgefolk/view:Goblins/0')).toMatchObject({ of: { kind: 'people', id: 'Goblins' }, about: ['group:Goblins', 'lore:view'] });
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

  it('answers a question about themself from their culture first, then their People (item 3: the culture’s custom wins)', () => {
    const m = matchLore('What do you do when someone dies?', orrin)!;
    expect(m.claims.map(c => c.id)).toEqual(['culture:ridgefolk/mourning/0', 'people:Bergfolk/mourning/0']);
    // "Your people" asks after the People first.
    expect(matchLore('How do your people mourn?', orrin)!.claims[0].id).toBe('people:Bergfolk/mourning/0');
    // Veit is Steinfolk in a wallborn town: the wall's custom comes before the Femhörn's stone.
    expect(matchLore('How do you greet a stranger?', veit)!.claims.map(c => c.id)).toEqual(['culture:wallborn/greeting/0', 'people:Steinfolk/greeting/0']);
  });

  it('answers what they think of another People from their culture’s view; "your people" from their People’s, prejudice included', () => {
    const m = matchLore('What do you think of goblins?', orrin)!;
    expect(m.query).toMatchObject({ subject: null, of: { kind: 'people', id: 'Goblins' }, topic: 'view' });
    expect(m.claims.map(c => c.id)).toEqual(['culture:ridgefolk/view:Goblins/0']);
    const people = matchLore('What do your people think of goblins?', orrin)!;
    expect(people.claims[0]).toMatchObject({ scope: { id: 'Bergfolk' }, of: { id: 'Goblins' }, truth: 'false' });
  });

  it('falls back to their People’s view when their culture has none (item 4, owner 2026-10-11)', () => {
    // A Bergfolk of a culture with no lore (ikibeki isn't on the road): the Bergfolk's view.
    const offRoad = { people: 'Bergfolk', culture: 'ikibeki' };
    expect(matchLore('What do you think of goblins?', offRoad)!.claims.every(c => c.scope.id === 'Bergfolk' && c.of?.id === 'Goblins')).toBe(true);
    // Never both: a culture with a view speaks alone.
    expect(matchLore('What do you think of goblins?', orrin)!.claims.every(c => c.scope.id === 'ridgefolk')).toBe(true);
  });

  it('has an outsider answer with what their culture thinks, and never speak for another group', () => {
    const m = matchLore('What do the Bergfolk believe?', maren)!;
    expect(m.claims.map(c => c.id)).toEqual(['culture:fieldborn/view:Bergfolk/0']);
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

describe('How openly a view is voiced: candour, strength and trust (#1590, owner 2026-10-11)', () => {
  /** A made-up wrong view, to read the rule off without the data. */
  const wrong = (strength: ScopedClaim['strength'], sensitivity: ScopedClaim['sensitivity'] = 'public') =>
    ({ topic: 'view' as const, truth: 'false' as const, sensitivity, strength });

  it('says a wrong view from 75 − 25 × openness, plainly from 25 more, on the knowledge model’s trust levels', () => {
    // openness = candour (blunt 2, plain 1, guarded 0) + strength (firm 2, held 1, loose 0).
    expect(voicingGates(wrong('firm'), 'blunt')).toEqual({ said: 0, plain: 0 });       // 4
    expect(voicingGates(wrong('held'), 'blunt')).toEqual({ said: 0, plain: 25 });      // 3
    expect(voicingGates(wrong('firm'), 'plain')).toEqual({ said: 0, plain: 25 });      // 3
    expect(voicingGates(wrong('held'), 'plain')).toEqual({ said: 25, plain: 50 });     // 2
    expect(voicingGates(wrong('held'), 'guarded')).toEqual({ said: 50, plain: 75 });   // 1
    expect(voicingGates(wrong('loose'), 'guarded')).toEqual({ said: 75, plain: 75 });  // 0
    // A claim's own sensitivity is a floor.
    expect(voicingGates(wrong('firm', 'private'), 'blunt')).toEqual({ said: 50, plain: 50 });
  });

  it('names how it comes out: held back, hedged, plain, or only to a close friend', () => {
    expect([0, 25, 50, 75].map(t => voicedAt(wrong('held'), 'guarded', t))).toEqual(['held-back', 'held-back', 'hedged', 'plain']);
    expect([0, 25, 50, 75].map(t => voicedAt(wrong('loose'), 'guarded', t))).toEqual(['held-back', 'held-back', 'held-back', 'close']);
    expect([0, 25, 50, 75].map(t => voicedAt(wrong('firm'), 'blunt', t))).toEqual(['plain', 'plain', 'plain', 'plain']);
  });

  it('leaves true views and every other claim to their sensitivity alone', () => {
    const custom = { topic: 'mourning' as const, truth: 'true' as const, sensitivity: 'guarded' as const };
    for (const c of CANDOURS) expect([0, 25].map(t => voicedAt(custom, c, t))).toEqual(['held-back', 'plain']);
    const trueView = { topic: 'view' as const, truth: 'true' as const, sensitivity: 'public' as const };
    expect(voicedAt(trueView, 'guarded', 0)).toBe('plain');
    // A secret is said to close friends only.
    expect(voicedAt({ ...trueView, sensitivity: 'secret' }, 'blunt', 75)).toBe('close');
  });

  it('has a blunt culture say a firm prejudice plainly to a stranger, and a guarded one keep it back', () => {
    // Runa (mountainhold, blunt) firmly believes goblins steal; she says so at trust 0.
    const blunt = matchLore('What do you think of goblins?', runa, 0)!;
    expect(blunt.claims.map(c => c.id)).toEqual(['culture:mountainhold/view:Goblins/0']);
    expect(blunt).toMatchObject({ voicing: { 'culture:mountainhold/view:Goblins/0': 'plain' }, holdingBack: false });
    // Veit (wallborn, guarded) holds his wrong view of goblins back until 50, hedges it, and says it plainly at 75.
    const q = 'What do you think of goblins?';
    expect(matchLore(q, veit, 0)).toMatchObject({ claims: [], holdingBack: true, opensAt: 50 });
    expect(matchLore(q, veit, 50)!.voicing).toEqual({ 'culture:wallborn/view:Goblins/0': 'hedged' });
    expect(matchLore(q, veit, 75)!.voicing).toEqual({ 'culture:wallborn/view:Goblins/0': 'plain' });
    // Isa (grovekin, guarded) half believes beastkin change shape: only a close friend hears it.
    expect(matchLore('What do you think of the beastkin?', personById('hf-isa')!, 50)).toMatchObject({ claims: [], opensAt: 75 });
    expect(matchLore('What do you think of the beastkin?', personById('hf-isa')!, 75)!.voicing).toEqual({ 'culture:grovekin/view:Wildkin/0': 'close' });
  });

  it('holds back guarded claims below their trust, and says what it would at 25', () => {
    const at0 = matchLore('What shames the Bergfolk?', undefined, 0)!;
    expect(at0.claims).toHaveLength(2);
    expect(at0).toMatchObject({ holdingBack: true, opensAt: 25 });
    const at25 = matchLore('What shames the Bergfolk?', undefined, 25)!;
    expect(at25.claims).toHaveLength(3);
    expect(at25.holdingBack).toBe(false);
  });

  it('keeps its old answer when no trust is given', () => {
    const m = matchLore('What do you think of goblins?', veit)!;
    expect(m.claims.map(c => c.id)).toEqual(['culture:wallborn/view:Goblins/0']);
    expect(m.voicing).toBeUndefined();
    expect(m.holdingBack).toBeUndefined();
  });
});

describe('The Wildkin, the 16th People (#1606)', () => {
  const wildkin = peopleLore('Wildkin')!;
  const canon = /^macro-world\/(?:setting-corewarden\.md|race-affinities\.json)/;

  it('rests on Core Warden’s setting bible and the Wildkin race lore it points to', () => {
    const own = [...wildkin.values, ...wildkin.taboos, ...CUSTOM_KINDS.map(k => wildkin.customs[k]), wildkin.voice, ...wildkin.sayings];
    expect(own.filter(c => !canon.test(c.source)).map(c => c.text)).toEqual([]);
    expect(own.filter(c => c.source.startsWith('macro-world/setting-corewarden.md')).length).toBeGreaterThanOrEqual(5);
  });

  it('holds a view of every other People, and every People and road culture holds one of them', () => {
    expect(Object.keys(wildkin.views)).toEqual(PEOPLES.filter(p => p !== 'Wildkin'));
    for (const p of allPeopleLore()) if (p.id !== 'Wildkin') expect(p.views.Wildkin?.length, p.id).toBeGreaterThan(0);
    for (const c of allCultureLore()) expect(c.peopleViews.Wildkin?.length, c.id).toBeGreaterThan(0);
  });

  it('is found by the matcher under its own names', () => {
    expect(matchLore('What do the beastkin value?')!.claims.map(c => c.id)).toEqual(['people:Wildkin/values/0', 'people:Wildkin/values/1', 'people:Wildkin/values/2']);
    expect(matchLore('How do the Wildkin mourn?')!.claims[0].text).toMatch(/dead stay dead/);
    expect(matchLore('What do the Pandor think of the beastkin?')!.claims[0].id).toBe('people:Pandor/view:Wildkin/0');
  });
});

describe('Humans and orcs: the Markfolk are orcs, humans are their own Peoples (#1623)', () => {
  const RACES = JSON.parse(read('macro-world/race-affinities.json')) as { races: { id: string; name: string; description: string }[] };
  const PREFS = Object.fromEntries((JSON.parse(read('macro-world/cultures.json')) as { cultures: { id: string; racePreferences: Record<string, number> }[] })
    .cultures.map(c => [c.id, c.racePreferences]));
  const world = read('WORLD.md');

  it('names the Markfolk as orcs and two human Peoples in the canon list, each with a WORLD.md section', () => {
    expect(peopleLore('Markfolk')!.names).toContain('orcs');
    expect(CANON_PEOPLES.slice(-2)).toEqual(['Riksfolk', 'Strandfolk']);
    expect(sectionOf(world, 'The Markfolk — orcs of the southern plains')).not.toBeNull();
    expect(sectionOf(world, 'The Riksfolk — humans of the Realm')).not.toBeNull();
    expect(sectionOf(world, 'The Strandfolk — humans of the harbour coast')).not.toBeNull();
  });

  it('gives the Wildkin border to the Riksfolk, not the Markfolk', () => {
    const border = /West March|Alå|Stone Line|fence-folk/;
    const markfolkLines = [...Object.values(peopleLore('Markfolk')!.views).flat(), ...peopleLore('Wildkin')!.views.Markfolk];
    expect(markfolkLines.filter(c => border.test(c.text) || c.source.includes('West March')).map(c => c.text)).toEqual([]);
    expect(peopleLore('Riksfolk')!.views.Wildkin.some(c => c.source.includes('The West March and the Wildkin border'))).toBe(true);
    expect(peopleLore('Wildkin')!.views.Riksfolk.some(c => /fence-folk/.test(c.text))).toBe(true);
    // The West March section sits under the Riksfolk, not the Markfolk.
    expect(sectionOf(world, 'The Markfolk — orcs of the southern plains')).not.toMatch(/West March/);
    expect(sectionOf(world, 'The Riksfolk — humans of the Realm')).toMatch(/#### The West March and the Wildkin border/);
  });

  it('maps the human ancestry to the human Peoples, and the orcs to their own', () => {
    const human = RACES.races.find(r => r.id === 'human')!;
    expect(human.name).toBe('Humans');
    expect(human.description).toMatch(/Riksfolk.*Strandfolk/);
    expect(RACES.races.find(r => r.id === 'markfolk')?.name).toBe('Markfolk');
    expect(RACES.races.find(r => r.id === 'riksfolk')?.name).toBe('Riksfolk');
    expect(RACES.races.find(r => r.id === 'strandfolk')?.name).toBe('Strandfolk');
  });

  it('puts a human People back in every culture that was human before #709', () => {
    for (const id of ['coastborn', 'ridgefolk', 'fieldborn', 'wallborn', 'harborfolk']) {
      expect((PREFS[id].Riksfolk ?? 0) + (PREFS[id].Strandfolk ?? 0), id).toBeGreaterThan(0);
      expect(Object.values(PREFS[id]).reduce((a, b) => a + b, 0), id).toBeLessThanOrEqual(1.0001);
    }
  });

  it('is found by the matcher under its own names', () => {
    expect(matchLore('What do the fence-folk value?')!.claims[0].id).toBe('people:Riksfolk/values/0');
    expect(matchLore('What do the Strandfolk think of the Merfolk?')!.claims[0].id).toBe('people:Strandfolk/view:Merfolk/0');
    expect(matchLore('What do the beastkin think of the Riksfolk?')!.claims[0].text).toMatch(/fence-folk/);
  });
});
