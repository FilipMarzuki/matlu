/**
 * Acceptance tests for #1575 (plan #1574): free questions, from outside the page. Over the console,
 * MCP and the API they're a move, `{ ask: { person, question } }`, matched and played on the
 * server, which keeps the question. The web game plays on the page and keeps its questions through
 * POST /api/v1/questions. Every question is kept cleaned, with nothing identifying, within limits.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { answerFor } from '../artificer/asks';
import { villageOf } from '../artificer/road';
import { view, apply, gameFrom, serialize, GAME_VERSION, type Game, type Move } from './session';
import { handle, memoryStore, LIMITS, type ApiRequest, type GameRecord } from './api';
import { cleanQuestion, QUESTION_CHARS } from './questions';

const must = (g: Game, m: Move): Game => {
  const r = apply(g, m);
  if (!r.ok) throw new Error(`${JSON.stringify(m)} refused: ${r.error}`);
  return r.game;
};

/** A game that's reached Hollowford on the caravan road (the session test's thaw survivor, ridden on). */
function atHollowford(): Game {
  const s = createRegion1({}, undefined, { id: 'play-thaw', name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  const sim: Region1State = { ...s, day: 61, vitals, tools: [], stores: { ...s.stores, rawFood: 10, water: 10, materials: 6, hides: 0, rations: 0 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  let g = gameFrom({ sim, queue: [], stage: 'reach' }, 'play-thaw');
  for (let i = 0; i < 6 && view(g).phase === 'meeting'; i++) g = must(g, view(g).moves[0].move);
  for (let i = 0; i < 20 && view(g).phase !== 'ended' && (view(g).phase === 'road-encounter' || !villageOf(g.app.road!)); i++) {
    g = must(g, view(g).phase === 'road-encounter' ? view(g).moves[0].move : { endDay: true });
  }
  expect(villageOf(g.app.road!)).toBe('hollowford');
  return g;
}

describe('Cleaning a question to keep (#1575)', () => {
  it('cuts it to the length cap, and drops control and invisible characters', () => {
    const c = cleanQuestion(`  Where\u0000 is​ the\nsmith?  ${'a'.repeat(300)}`)!;
    expect([...c.text!].length).toBeLessThanOrEqual(QUESTION_CHARS);
    expect(c.text!.startsWith('Where is the smith?')).toBe(true);
    expect(c.blocked).toBe(false);
  });

  it('cuts out runs of digits, email addresses and links: anything about the player', () => {
    expect(cleanQuestion('call me on 070-123 45 67 ok?')!.text).toBe('call me on … ok?');
    expect(cleanQuestion('I was born in 2014, is that old?')!.text).toBe('I was born in …, is that old?');
    expect(cleanQuestion('mail kid@example.com or see https://example.com/me')!.text).toBe('mail … or see …');
    // Small numbers are part of ordinary questions.
    expect(cleanQuestion('Is day 45 midwinter?')!.text).toBe('Is day 45 midwinter?');
  });

  it('keeps a question with a blocked word as blocked, without its text; a fair word in a survival game passes', () => {
    expect(cleanQuestion('what the fuck is iron')).toEqual({ text: null, blocked: true });
    expect(cleanQuestion('sh1t!')).toEqual({ text: null, blocked: true });
    expect(cleanQuestion('How do I kill a wolf?')).toEqual({ text: 'How do I kill a wolf?', blocked: false });
  });

  it('has no question in nothing', () => {
    expect(cleanQuestion('   ')).toBeNull();
    expect(cleanQuestion('5551234567')).toBeNull();
    expect(cleanQuestion(42)).toBeNull();
  });
});

describe('A free question as a move (#1575): console, MCP and the API', () => {
  it('matches, answers past the gates, and plays as the topic it matched, never the words', () => {
    const g = atHollowford();
    expect(view(g).text).toMatch(/Free questions:.*Orrin \(hf-orrin\)/s);
    const r = apply(g, { ask: { person: 'hf-orrin', question: 'Where do people round here get ore?' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.played).toEqual({ do: 'question:hf-orrin:material:iron' });
    expect(r.asked).toMatchObject({ person: 'hf-orrin', text: 'Where do people round here get ore?', blocked: false, topic: 'material:iron' });
    expect(r.changed.join(' ')).toContain(answerFor('hf-orrin', 'material:iron')!.text);
    // Asked once this stay: no longer offered, and a second is refused, changing nothing.
    expect(view(r.game).text).not.toMatch(/Not asked yet:.*Orrin/);
    const again = apply(r.game, { ask: { person: 'hf-orrin', question: 'And smiths?' } });
    expect(again.ok).toBe(false);
  });

  it('deflects what it can’t match, and a blocked question, which is played without a topic', () => {
    const g = atHollowford();
    const r = apply(g, { ask: { person: 'hf-maren', question: 'what the fuck is iron' } });
    expect(r.ok && r.played).toEqual({ do: 'question:hf-maren' });
    expect(r.ok && r.asked).toMatchObject({ text: null, blocked: true, topic: null });
    const odd = apply(g, { ask: { person: 'hf-tobin', question: 'What is the meaning of life?' } });
    expect(odd.ok && odd.asked?.topic).toBeNull();
    expect(odd.ok && odd.changed.join(' ')).toMatch(/Tobin thinks it over/);
  });

  it('is refused off the road, to someone not here, or with no question in it', () => {
    const reach = gameFrom({ sim: createRegion1({}, undefined, { id: 'play-q', name: 'Vega' }), queue: [], stage: 'reach' }, 'play-q');
    expect(apply(reach, { ask: { person: 'hf-orrin', question: 'Iron?' } }).ok).toBe(false);
    const g = atHollowford();
    expect(apply(g, { ask: { person: 'kg-sabine', question: 'Iron?' } }).ok).toBe(false);
    expect(apply(g, { ask: { person: 'hf-orrin', question: '   ' } }).ok).toBe(false);
  });
});

describe('Keeping questions through the API (#1575)', () => {
  let n = 0;
  const deps = { now: () => Date.parse('2026-10-11T12:00:00Z'), newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, salt: 'pepper' };
  const post = (path: string, body: unknown, ip = '203.0.113.7'): ApiRequest => ({ method: 'POST', path, body: JSON.stringify(body), ip });

  /** A stored API game at Hollowford. */
  function stored(store: ReturnType<typeof memoryStore>, surface: GameRecord['surface'] = 'console'): string {
    const g = atHollowford();
    const id = deps.newId();
    const at = new Date(deps.now()).toISOString();
    store.rows.set(id, { id, version: GAME_VERSION, session: serialize(g), moves: [], phase: 'road', name: 'Vega', client: null, model: null, ipKey: 'f00dfeedcafe1234f00dfeedcafe1234', surface, player: 'person', measures: {}, createdAt: at, updatedAt: at });
    return id;
  }

  it('keeps an ask move’s question, cleaned and with nothing identifying, and stores the move as played', async () => {
    const store = memoryStore();
    const id = stored(store);
    const r = await handle(post(`/api/v1/games/${id}/moves`, { move: { ask: { person: 'hf-isa', question: 'Which mushrooms can I eat? My number is 0701234567' } } }), store, deps);
    expect(r.status).toBe(200);
    expect(store.rows.get(id)!.moves).toEqual([{ do: 'question:hf-isa:skill:foraging' }]);
    expect(store.questions).toEqual([{
      question: 'Which mushrooms can I eat? My number is …', blocked: false, person: 'hf-isa', topic: 'skill:foraging', answered: true,
      trust: expect.any(Number), gameVersion: GAME_VERSION, surface: 'console',
    }]);
    // No address, hash, game id or seed in what's kept.
    const kept = JSON.stringify(store.questions);
    for (const s of [id, '203.0.113.7', 'play-thaw', store.rows.get(id)!.ipKey]) expect(kept).not.toContain(s);
  });

  it('won’t take the road action a question plays as, sent on its own: questions come in words', async () => {
    const store = memoryStore();
    const id = stored(store);
    const r = await handle(post(`/api/v1/games/${id}/moves`, { move: { do: 'question:hf-orrin:material:iron' } }), store, deps);
    expect(r.status).toBe(400);
    expect(store.questions).toEqual([]);
  });

  it('keeps the web game’s questions through the store-only endpoint, checking who and what', async () => {
    const store = memoryStore();
    const ok = await handle(post('/api/v1/questions', { person: 'hf-orrin', question: 'Where is iron?', topic: 'material:iron', trust: 31.6 }), store, deps);
    expect(ok.status).toBe(201);
    expect(store.questions[0]).toMatchObject({ person: 'hf-orrin', topic: 'material:iron', answered: true, trust: 32, surface: 'web', gameVersion: GAME_VERSION });
    // A topic the person doesn't know is kept as none.
    await handle(post('/api/v1/questions', { person: 'hf-maren', question: 'Where is iron?', topic: 'material:iron' }), store, deps);
    expect(store.questions[1]).toMatchObject({ topic: null, answered: false });
    // Nobody the road has, or no question: refused, nothing kept.
    expect((await handle(post('/api/v1/questions', { person: 'zz-nobody', question: 'Hi?' }), store, deps)).status).toBe(400);
    expect((await handle(post('/api/v1/questions', { person: 'hf-orrin', question: '' }), store, deps)).status).toBe(400);
    expect(store.questions).toHaveLength(2);
  });

  it('holds the limits: per address per day, then everyone’s together', async () => {
    const store = memoryStore();
    const limits = { ...LIMITS, questionsPerIpPerDay: 3, questionsPerDay: 5 };
    const ask = (ip: string) => handle(post('/api/v1/questions', { person: 'hf-orrin', question: 'Iron?' }, ip), store, deps, limits);
    for (let i = 0; i < 3; i++) expect((await ask('203.0.113.7')).status).toBe(201);
    expect((await ask('203.0.113.7')).status).toBe(429);
    // Another address still can, until the day's total is reached.
    expect((await ask('198.51.100.1')).status).toBe(201);
    expect((await ask('198.51.100.2')).status).toBe(201);
    expect((await ask('198.51.100.3')).status).toBe(429);
    expect(store.questions).toHaveLength(5);
  });

  it('plays an ask move past the limits, but keeps no more questions', async () => {
    const store = memoryStore();
    const id = stored(store, 'mcp');
    const limits = { ...LIMITS, questionsPerIpPerDay: 0 };
    const r = await handle(post(`/api/v1/games/${id}/moves`, { move: { ask: { person: 'hf-orrin', question: 'Iron?' } } }), store, deps, limits);
    expect(r.status).toBe(200);
    expect(store.rows.get(id)!.moves).toEqual([{ do: 'question:hf-orrin:material:iron' }]);
    expect(store.questions).toEqual([]);
  });
});
