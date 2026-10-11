/**
 * Acceptance tests for knowledge slice A (#1609, design docs/knowledge-model-design.md): the
 * knowledge model in the game. Today's hand-written answers (asks.ts `ANSWERS`, and a teacher's
 * answer about their own skill) are person-scope facts now, and every ask resolves through the
 * model: scope, the most specific fact, the trust gate, and who'd know instead.
 *
 * The first scenario is the promise that nothing a player reads changes: it holds every answer
 * up against a frozen copy of how answers were found before the model (`todaysAnswer`).
 */

import { describe, it, expect } from 'vitest';
import { ANSWERS, answerFor, ask, topicsKnownBy, type Answer } from './asks';
import { FACTS, knowerOf, nearbyOf, resolve } from './facts';
import { SKILLS, type SkillId } from './skills';
import { VILLAGES, TRAVELLERS, type Person } from './villages';
import type { Fact } from './knowledge';

const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
const byId = (id: string): Person => EVERYONE.find(p => p.id === id)!;

/** How a teacher answered their own skill before the model (asks.ts `teacherAnswer`, as merged before #1609). */
function todaysTeacherAnswer(p: Person, key: string): Answer | undefined {
  if (!p.teaches || key !== `skill:${p.teaches.skill}`) return undefined;
  const name = SKILLS[p.teaches.skill as SkillId]?.name ?? p.teaches.skill;
  const shows = p.teaches.techniques.length ? ` I can show you ${p.teaches.techniques.length === 1 ? 'one way' : `${p.teaches.techniques.length} ways`} to do it better.` : '';
  return { at: 0, text: `${name}? That's what I teach.${shows} Come and learn when you have the time.` };
}

/** How an answer was found before the model: the hand-written one, else the teacher's own skill. */
const todaysAnswer = (personId: string, key: string): Answer | undefined => {
  const p = EVERYONE.find(x => x.id === personId);
  return ANSWERS[personId]?.[key] ?? (p ? todaysTeacherAnswer(p, key) : undefined);
};

/** The topics a person answered before the model: hand-written order, a teacher's own skill last. */
const todaysTopics = (personId: string): string[] => {
  const p = EVERYONE.find(x => x.id === personId);
  const keys = Object.keys(ANSWERS[personId] ?? {});
  const taught = p?.teaches ? `skill:${p.teaches.skill}` : null;
  return taught && !keys.includes(taught) ? [...keys, taught] : keys;
};

/** Every (person, topic) answerable today: each hand-written answer, and each teacher's own skill. */
const ANSWERABLE: [string, string][] = [
  ...Object.entries(ANSWERS).flatMap(([pid, byKey]) => Object.keys(byKey).map(key => [pid, key] as [string, string])),
  ...EVERYONE.filter(p => p.teaches && !ANSWERS[p.id]?.[`skill:${p.teaches.skill}`]).map(p => [p.id, `skill:${p.teaches!.skill}`] as [string, string]),
];

/** Trusts either side of every gate the road uses. */
const TRUSTS = [0, 1, 10, 24, 25, 26, 49, 50, 51, 74, 75, 76, 100];

describe('Knowledge slice A: the fact model in the game (#1609)', () => {
  // Given any person and topic answerable today, when asked through the new model, then the reply
  // text and the trust gate are identical to today's.
  it('answers every topic answerable today with the same words, the same gate and the same effects', () => {
    expect(ANSWERABLE.length).toBeGreaterThan(30);
    for (const [pid, key] of ANSWERABLE) {
      const before = todaysAnswer(pid, key)!;
      // `answerFor` is now a thin wrapper over the model: the same Answer, field for field.
      expect([pid, key, answerFor(pid, key)]).toEqual([pid, key, before]);
      // The model itself: told at the gate and above, with the same words; not yet below it.
      for (const trust of TRUSTS) {
        const r = resolve(pid, key, trust);
        if (trust >= before.at) expect([pid, key, trust, r?.kind === 'told' && r.fact.text]).toEqual([pid, key, trust, before.text]);
        else expect([pid, key, trust, r?.kind]).toEqual([pid, key, trust, 'not-yet']);
      }
      // And the line the road writes, at every trust, is the one it wrote before.
      const p = byId(pid);
      for (const trust of TRUSTS) {
        const line = ask(p, key, 'it', trust, []).line;
        const was = trust < before.at ? `${p.name} looks at you a long moment. "Maybe. Ask me again when I know you better."` : `${p.name}: "${before.text}"`;
        expect([pid, key, trust, line]).toEqual([pid, key, trust, was]);
      }
    }
  });

  it('knows the same topics as before, in the same order, and nothing else', () => {
    for (const p of EVERYONE) expect([p.id, topicsKnownBy(p.id)]).toEqual([p.id, todaysTopics(p.id)]);
    // Asked about something no one answered before, they still don't know: same words.
    for (const p of EVERYONE) {
      for (const key of ['material:iron', 'group:compact', 'place:kestrel-gate', 'skill:foraging', 'group:dyprike']) {
        if (todaysAnswer(p.id, key)) continue;
        expect(answerFor(p.id, key)).toBeUndefined();
        expect(ask(p, key, 'it', 100, []).line).toBe(`${p.name} thinks, and shakes their head. "I don't know much about it."`);
      }
    }
  });

  it('keeps today’s answers as true, public-to-private person facts: the canon rule holds for them', () => {
    for (const f of FACTS) {
      expect(f.scope.kind).toBe('person');
      expect(f.truth).toBe('true');
      expect(['public', 'guarded', 'private']).toContain(f.sensitivity);
    }
  });

  // Given a fact at two scopes, when a person in both is asked, then the more specific one answers.
  it('answers with the more specific fact when one is known at two scopes', () => {
    const village: Fact = { id: 'hf-iron-scarce', about: ['material:iron'], scope: { kind: 'village', id: 'hollowford' }, sensitivity: 'public', truth: 'true', text: 'Iron is scarce in Hollowford.' };
    const facts = [village, ...FACTS];
    // Orrin is in both Hollowford's scope and his own: his own words win.
    const orrin = resolve('hf-orrin', 'material:iron', 100, { facts });
    expect(orrin).toMatchObject({ kind: 'told', fact: { scope: { kind: 'person', id: 'hf-orrin' } } });
    expect(orrin?.kind === 'told' && orrin.fact.text).toBe(ANSWERS['hf-orrin']['material:iron'].text);
    // Maren has no word of her own on iron, so the village's answers for her.
    expect(resolve('hf-maren', 'material:iron', 0, { facts })).toMatchObject({ kind: 'told', fact: { id: 'hf-iron-scarce' } });
    // And she only knows it because she lives there: Veit at the Gate doesn't.
    expect(resolve('kg-veit', 'material:iron', 100, { facts })).toMatchObject({ kind: 'unknown' });
  });

  // Given a sensitive fact above the asker's trust, then it's not told, and the person says they'd rather not yet.
  it('holds a sensitive fact above your trust, and says not yet', () => {
    const gate = ANSWERS['hf-tobin']['group:compact'].at;
    expect(gate).toBe(50);
    expect(resolve('hf-tobin', 'group:compact', gate - 1)).toMatchObject({ kind: 'not-yet', trust: gate });
    const r = ask(byId('hf-tobin'), 'group:compact', 'the Compact', gate - 1, []);
    expect(r.kind).toBe('not-yet');
    expect(r.line).toBe('Tobin looks at you a long moment. "Maybe. Ask me again when I know you better."');
    expect(r.line).not.toContain(ANSWERS['hf-tobin']['group:compact'].text);
  });

  // Given a topic the person doesn't know but someone nearby does, then they refer the asker.
  it('refers you to someone nearby who knows, when they don’t', () => {
    // Maren knows nothing of iron; Tobin, in her own village, does (and is the first there who does).
    expect(nearbyOf('hf-maren').map(k => k.id)).toEqual(expect.arrayContaining(['hf-tobin', 'hf-orrin', 'cv-pim']));
    expect(resolve('hf-maren', 'material:iron', 100)).toEqual({ kind: 'unknown', referral: 'hf-tobin' });
    // The road keeps the referral on the result for later slices; the line a player reads is today's.
    const r = ask(byId('hf-maren'), 'material:iron', 'iron', 100, []);
    expect(r).toMatchObject({ kind: 'unknown', referral: 'hf-tobin' });
    expect(r.line).toBe('Maren thinks, and shakes their head. "I don\'t know much about iron."');
    // Nobody nearby knows the Dyprike: no one to send you to.
    expect(resolve('hf-maren', 'group:dyprike', 100)).toEqual({ kind: 'unknown', referral: null });
  });

  it('builds a knower for everyone on the road, from who they are', () => {
    for (const p of EVERYONE) expect(knowerOf(p.id)).toMatchObject({ id: p.id, people: p.people, culture: p.culture, role: p.role });
    expect(knowerOf('hf-orrin')?.home).toBe('hollowford');
    expect(knowerOf('cv-bodil')?.home).toBeUndefined();
    expect(knowerOf('nobody')).toBeUndefined();
  });
});
