/**
 * Acceptance tests for #1713 — an optional `lang` for API, MCP and console games (phase 5 of #1685).
 *
 * A game started with `"lang": "sv"` answers in Swedish: its view, status, the moves' labels, what
 * changed and refusals, drawn by view-words.ts from the page's own views and catalog. The language
 * is kept with the stored game (beside the state in its session, never in it), so every later
 * request answers in it. It's presentation only: the same seed and moves play the same game.
 * Without `lang` (or with "en") a game reads exactly as before; an unknown `lang` is refused.
 *
 * "No English" is checked the way the app's i18n tests check the page (camp-i18n, road-i18n and
 * tabs-i18n .test.ts): their lists of English-only words, searched for as whole words. The
 * deliberate exceptions are what a player sends rather than reads: the moves in brackets
 * (`[do: rest]`, `[choose: help]`, `[endDay]`), the JSON in the legend and the refusals
 * (`{ "ask": … }`), quoted ids (`"explore"`) and the MCP tools' `game_id`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handle, memoryStore, type ApiRequest, type ApiResponse, type GameStore } from './api';
import { startGame, view, apply, serialize, deserialize, gameFrom, type Game, type Move, type MoveOption, type View } from './session';
import { hollowfordGame, thawApp } from './fixtures';
import { observe } from '../artificer-ai/observe';
import { forgetHistories, tellHistoriesWith } from '../artificer/history-in-play';
import { runHistory } from '../artificer/world/history';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { makeHandler } from './vercel-handler';
import { villageOf } from '../artificer/road';
import { fill, makeT } from '../artificer/i18n';
import { en as EN } from '../artificer/i18n/en';
import { matchRefusal, refusalText } from './view-words';

let n = 0;
const deps = { now: () => Date.parse('2026-10-14T12:00:00Z'), newId: () => `g${++n}`, newSeed: () => 's1' };
const post = (path: string, body: unknown): ApiRequest => ({ method: 'POST', path, body: JSON.stringify(body), ip: '203.0.113.7' });
const get = (path: string): ApiRequest => ({ method: 'GET', path, ip: '203.0.113.7' });

/** English words that give away an untranslated line: the app's i18n tests' lists, together. None is a Swedish word too. */
const ENGLISH = [...new Set([
  'the', 'you', 'your', 'and', 'with', 'of', 'not', 'yet', 'first', 'already', 'nothing', 'never', 'about', 'what', 'will', 'here', 'more', 'less',
  'food', 'water', 'fuel', 'stone', 'hides', 'rations', 'materials', 'firewood', 'timber', 'forage', 'routes', 'rings', 'near', 'distant', 'survey', 'explore', 'scouting',
  'camp', 'day', 'days', 'night', 'nights', 'hours', 'light', 'snow', 'winter', 'thaw', 'autumn', 'tools', 'known', 'recipes',
  'needs', 'tier', 'warm', 'cold', 'kept', 'exposed', 'deer', 'game', 'build', 'craft', 'gather', 'hunt', 'study',
  'sharp', 'steady', 'minutes', 'north', 'south', 'east', 'west', 'pack', 'empty', 'leader', 'choose', 'talents',
  'age', 'stats', 'points', 'left', 'costs', 'average', 'heavy', 'work', 'trip', 'walking', 'run', 'runs', 'complete',
  'ended', 'reached', 'shelter', 'cave', 'treeline', 'hilltop', 'riverbank', 'vigor', 'clarity',
  'trade', 'sell', 'sold', 'buy', 'bought', 'price', 'wanted', 'quest', 'quests', 'reward', 'lesson', 'lessons', 'healing',
  'trader', 'teacher', 'healer', 'elder', 'smith', 'hunter', 'tinker', 'wagon', 'caravan', 'road', 'village', 'travellers',
  'talk', 'chat', 'ask', 'tell', 'told', 'asked', 'knows', 'they', 'their', 'she', 'he', 'her', 'his', 'who', 'says', 'said',
  'trust', 'friend', 'friends', 'free', 'done', 'failed', 'leads', 'heard', 'seen', 'rest', 'end', 'mend', 'help',
  'skipped', 'gathered', 'fetched', 'cut', 'hunted', 'scouted', 'milestone', 'morning', 'hungry', 'thirsty',
  'wolves', 'bear', 'fire', 'dark', 'best', 'died', 'survived', 'collapsed', 'unknown', 'suspected', 'observed',
  'plenty', 'thinning', 'scarce', 'places', 'memory', 'interest', 'found', 'strain', 'carrying', 'gear', 'focus', 'goal', 'people', 'survival',
])];
const ENGLISH_RE = new RegExp(`(?<![\\p{L}])(${ENGLISH.join('|')})(?![\\p{L}])`, 'giu');

/** What a player sends rather than reads (see the header): moves in brackets, JSON, quoted ids. */
const sent = (text: string): string => text
  .replace(/\[[^\]\n]*\]/g, ' ')
  .replace(/\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ')
  .replace(/"[^"\n]*"/g, ' ')
  // The MCP tools' own parameter, named as the tools take it.
  .replace(/\bgame_id\b/g, ' ')
  // The road's refusal names its action ids, which are sent as they are: rest, wait, tend, help.
  .replace(/rest, wait, tend, help, eller talk:\/ask:\/tell:\/heal:\/sell:\/buy:\/accept:\/complete:\/learn:\/appraise:\/craft:\/study:/g, ' ');

/** The English words in some text, each with a little context, so a failure says where. */
function englishIn(text: string): string[] {
  const t = sent(text);
  return [...t.matchAll(ENGLISH_RE)].map(m => t.slice(Math.max(0, m.index! - 40), m.index! + 40).replace(/\s+/g, ' ').trim());
}

/** Everything a game body says that a player reads: the view, the status, the moves' labels, what changed. */
const bodyText = (b: Record<string, unknown>): string =>
  [b.text, b.status, ...((b.moves as MoveOption[] | undefined) ?? []).map(m => m.label), ...((b.changed as string[] | undefined) ?? []), b.error].filter(Boolean).join('\n');

/** A small seeded generator, so the policy below plays the same moves every run. */
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32; };
}

/**
 * The next move, from a game's body: a plain survival policy (water, food and wood when they run
 * low, the odd other action, the day ended once it's mostly spent), a random answer in an
 * encounter, and now and then a move that's refused (a far ring, a bad setting, a camp before the
 * ground is known), so refusals are compared too. It reads the status line in either language.
 */
function pick(body: Record<string, unknown>, i: number, r: () => number): Move {
  const moves = body.moves as MoveOption[];
  if (i % 23 === 7) return { do: 'hunt@3' };
  if (i % 41 === 11) return { set: { eating: 'feast' } };
  if (i % 13 === 3) return { set: { site: 'tree' } };
  const end = moves.find(m => 'endDay' in m.move);
  const rest = moves.filter(m => !('endDay' in m.move));
  if (body.phase !== 'day') return (rest.length ? rest[Math.floor(r() * rest.length)] : end ?? moves[0]).move;
  const status = String(body.status);
  const num = (re: RegExp): number => Number(re.exec(status)?.[1]?.replace(',', '.') ?? 0);
  const hours = num(/(\d+(?:[.,]\d+)?)\/14/), food = num(/(?:food|mat) (\d+)/), water = num(/(?:water|vatten) (\d+)/), wood = num(/(?:firewood|ved) (\d+)/);
  const open = (id: string): MoveOption | undefined => rest.find(m => 'do' in m.move && m.move.do === id);
  if (!rest.length || hours >= 10) return (end ?? moves[0]).move;
  const want = (water < 4 && open('water')) || (food < 4 && open('gather')) || (r() < 0.5 && open('build')) || (wood < 6 && open('wood')) || (r() < 0.25 && open('explore'));
  if (want) return want.move;
  if (end && r() < 0.15) return end.move;
  return rest[Math.floor(r() * rest.length)].move;
}

/**
 * Camp as a free setting, as before #1732: the policy above settles that way. And the site's
 * warmth ceilings, as before #1763, and the warmth fraction rather than the heat balance, as
 * before #1770: the games below are pinned to how this policy's run goes (where it ends, what
 * it's refused), and a warmer or colder camp changes that.
 */
const OLD_CAMP = { 'camp-as-action': false, 'built-warmth': false, 'thermal-model': false };
/**
 * …and the map drawn by itself, as before #1754: the policy picks among the moves open, so a
 * Draw your map move would send this seeded year down another path, longer than the loop allows.
 * Learning the map in both languages is map-learning-app.test.ts's. Quarrying from the first day
 * too, as before #1816: Gather stones in the moves would send the year down another path as well.
 */
const SAME_YEAR = { ...OLD_CAMP, 'map-learning': false, 'stone-gathering': false };

beforeAll(() => tellHistoriesWith(runHistory));
afterAll(() => forgetHistories());

describe('An optional lang for API, MCP and console games (#1713)', () => {
  it('same game in both languages: two API games with one seed and the same moves keep equal states and outcomes, and only their text differs', async () => {
    const store = memoryStore();
    // The policy below settles with the free "site" setting, so these games keep it (#1732's switch off);
    // Make camp as an action, in both languages, is camp-as-action.test.ts's and camp-i18n.test.ts's.
    const en = (await handle(post('/api/v1/games', { name: 'Vega', features: SAME_YEAR }), store, deps)).body;
    const sv = (await handle(post('/api/v1/games', { name: 'Vega', lang: 'sv', features: SAME_YEAR }), store, deps)).body;
    expect(sv.lang).toBe('sv');
    const ids = [String(en.id), String(sv.id)];
    let last: Record<string, unknown>[] = [en, sv];
    const r = rng(1713);
    let differ = 0, refused = 0;
    const phases = new Set<string>();
    for (let i = 0; i < 1500 && last[0].phase !== 'ended'; i++) {
      phases.add(String(last[0].phase));
      const move = pick(last[0], i, r);
      const [a, b] = await Promise.all(ids.map(id => handle(post(`/api/v1/games/${id}/moves`, { move }), store, deps)));
      expect(b.status).toBe(a.status);
      if (a.status === 422) { refused++; expect((b.body.moves as MoveOption[]).map(m => m.move)).toEqual((a.body.moves as MoveOption[]).map(m => m.move)); continue; }
      expect(a.status).toBe(200);
      // The same game: the same phase, the same moves open (and their hours), as many lines changed.
      expect(b.body.phase).toBe(a.body.phase);
      expect((b.body.moves as MoveOption[]).map(m => [m.move, m.hours])).toEqual((a.body.moves as MoveOption[]).map(m => [m.move, m.hours]));
      expect((b.body.changed as string[]).length).toBe((a.body.changed as string[]).length);
      if (b.body.text !== a.body.text) differ++;
      last = [a.body, b.body];
    }
    expect(last[0].phase).toBe('ended');
    // A year played out: encounters on the way and the caravan meeting at the thaw.
    expect([...phases]).toEqual(expect.arrayContaining(['day', 'encounter', 'meeting']));
    expect(refused).toBeGreaterThan(0);
    expect(differ).toBeGreaterThan(0);
    // The stored states are equal: the session differs only by the language beside the state.
    const [rowEn, rowSv] = ids.map(id => store.rows.get(id)!);
    const { lang, ...svSession } = JSON.parse(rowSv.session) as Record<string, unknown>;
    expect(lang).toBe('sv');
    expect(svSession).toEqual(JSON.parse(rowEn.session));
    expect(rowSv.moves).toEqual(rowEn.moves);
    expect(rowSv.measures).toEqual(rowEn.measures);
    // And the run records keep the same outcomes.
    const runs = [...store.runs.values()];
    expect(runs).toHaveLength(2);
    const outcome = (x: (typeof runs)[number]) => { const { id: _id, createdAt: _at, ...rest } = x; return rest; };
    expect(outcome(runs[1])).toEqual(outcome(runs[0]));
  }, 120_000);

  it('a Swedish game: what it returns has no English-only words, and a later request still answers in Swedish', async () => {
    const store = memoryStore();
    const start = await handle(post('/api/v1/games', { lang: 'sv', features: OLD_CAMP }), store, deps);
    expect(start.status).toBe(201);
    const id = String(start.body.id);
    const texts: string[] = [bodyText(start.body)];
    let body = start.body;
    const r = rng(5);
    const phases = new Set<string>();
    for (let i = 0; i < 1500 && body.phase !== 'ended'; i++) {
      phases.add(String(body.phase));
      const res = await handle(post(`/api/v1/games/${id}/moves`, { move: pick(body, i, r) }), store, deps);
      texts.push(bodyText(res.body));
      if (res.status === 200) body = res.body;
    }
    const seen = texts.join('\n');
    // It played a while, into the winter, with encounters on the way and refusals among the moves.
    expect([...phases]).toEqual(expect.arrayContaining(['day', 'encounter']));
    expect(seen).toMatch(/DAG [3-9]\d/);
    // A distance, not a ring (#1752, on by default): the number the move takes, after @.
    expect(seen).toContain('Kan inte jaga vid @3 nu');
    expect(englishIn(seen)).toEqual([]);

    // Later: the stored game still answers in Swedish.
    const later = await handle(get(`/api/v1/games/${id}`), store, deps);
    expect(later.status).toBe(200);
    expect(later.body.lang).toBe('sv');
    expect(later.body.text).toBe(body.text);
    expect(englishIn(bodyText(later.body))).toEqual([]);
    expect(JSON.parse(store.rows.get(id)!.session).lang).toBe('sv');
  }, 120_000);

  it('a Swedish game reads Swedish on the road, at the caravan meeting, on the wagon and at the end too', () => {
    const sv = (g: Game): Game => ({ ...g, lang: 'sv' });
    const texts: string[] = [];
    const say = (v: View) => texts.push([v.text, v.status, ...v.moves.map(m => m.label)].join('\n'));
    // The caravan meeting at the thaw, answered through to the road.
    let g = sv(gameFrom(thawApp(), 'play-thaw'));
    expect(view(g).phase).toBe('meeting');
    for (let i = 0; i < 6 && view(g).phase === 'meeting'; i++) {
      say(view(g));
      const r = apply(g, view(g).moves[0].move);
      if (!r.ok) throw new Error(r.error);
      texts.push(r.changed.join('\n'));
      g = r.game;
    }
    // A village, with everyone's sheet; the road's moves and refusals.
    const village = sv(hollowfordGame());
    say(view(village));
    for (const move of [{ do: 'talk:hf-maren' }, { do: 'teleport' }, { ask: { person: 'nobody', question: 'Hej?' } }, { set: { site: 'cave' } }] as Move[]) {
      const r = apply(village, move);
      texts.push(r.ok ? [r.changed.join('\n'), r.view.status].join('\n') : r.error);
    }
    // Ride on: wagon days, the next villages, and the end of the road.
    let road = village;
    for (let i = 0; i < 40 && view(road).phase !== 'ended'; i++) {
      const v = view(road);
      if (i % 3 === 0 || !villageOf(road.app.road!)) say(v);
      const r = apply(road, v.phase === 'road-encounter' ? v.moves[0].move : { endDay: true });
      if (!r.ok) throw new Error(r.error);
      texts.push(r.changed.join('\n'));
      road = r.game;
    }
    expect(view(road).phase).toBe('ended');
    say(view(road));
    const seen = texts.join('\n');
    expect(seen).toContain('KARAVANVÄGEN');
    expect(englishIn(seen)).toEqual([]);
    // And it's the same game as in English: the road ended the same way.
    let enRoad = hollowfordGame();
    for (let i = 0; i < 40 && view(enRoad).phase !== 'ended'; i++) {
      const v = view(enRoad);
      const r = apply(enRoad, v.phase === 'road-encounter' ? v.moves[0].move : { endDay: true });
      if (!r.ok) throw new Error(r.error);
      enRoad = r.game;
    }
    expect(road.app).toEqual(enRoad.app);
  }, 60_000);

  it('no lang: the game is today\'s English, its body has no "lang", and it\'s stored as before', async () => {
    const store = memoryStore();
    const plain = await handle(post('/api/v1/games', { name: 'Vega' }), store, deps);
    const english = await handle(post('/api/v1/games', { name: 'Vega', lang: 'en' }), store, deps);
    const { id: _a, ...p } = plain.body;
    const { id: _b, ...e } = english.body;
    // "en" is the default, said out loud: the same body, and neither says a language.
    expect(e).toEqual(p);
    expect('lang' in plain.body).toBe(false);
    // The text is the AI harness's observation, as it always was.
    const game = startGame({ seed: 's1', name: 'Vega' });
    expect(plain.body.text).toBe(observe(game.app.sim));
    expect(plain.body.text).toBe(view(game).text);
    // Stored exactly as a game from before: no language beside the state.
    const row = store.rows.get(String(plain.body.id))!;
    expect(row.session).toBe(serialize(game));
    expect(Object.keys(JSON.parse(row.session))).toEqual(['version', 'id', 'app']);
    // A move answers in English too.
    const moved = await handle(post(`/api/v1/games/${String(plain.body.id)}/moves`, { move: { do: 'explore' } }), store, deps);
    expect((moved.body.changed as string[]).join(' ')).toMatch(/Walked out and looked around/);
    expect('lang' in moved.body).toBe(false);
  });

  it('an unknown lang is refused (400) with a message naming the languages there are, and no game is started', async () => {
    const store: GameStore & { rows: Map<string, unknown> } = memoryStore();
    for (const lang of ['de', 'SV', 'english', '', 3, null, { sv: true }]) {
      const r: ApiResponse = await handle(post('/api/v1/games', { lang }), store, deps);
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toBe('"lang" is the language of the game\'s text: "en" or "sv". Leave it out for English.');
    }
    expect(store.rows.size).toBe(0);
  });

  it('every refusal the session gives has its Swedish (the api.no.* templates match the session\'s English exactly)', () => {
    const sv = makeT('sv');
    const errors = (g: Game, moves: Move[]): string[] => moves.map(m => { const r = apply(g, m); if (r.ok) throw new Error(`${JSON.stringify(m)} was played`); return r.error; });
    const day = startGame({ seed: 's1' });
    const village = hollowfordGame();
    const meeting = gameFrom(thawApp(), 'play-thaw');
    const dead = gameFrom({ ...day.app, sim: { ...day.app.sim, outcome: { choice: 'collapse', kind: 'died', vitals: day.app.sim.vitals } } }, day.id);
    const english = [
      ...errors(day, [{ do: 'teleport' }, { do: 'hunt@3' }, { do: 'rest@2' }, { do: 'treat' }, { do: { q: 'wood', hours: 99 } } as unknown as Move, { plan: ['water'] }, { choose: 'x' },
        { set: { focus: 'zz' } }, { set: { eating: 'x' } }, { set: { site: 'moon' } }, { ask: { person: 'hf-orrin', question: 'Hej?' } }]),
      ...errors(village, [{ do: 'teleport' }, { ask: { person: 'nobody', question: 'Hej?' } }, { ask: { person: 'hf-orrin', question: '   ' } }, { set: { eating: 'half' } }, { set: { site: 'cave' } }, { plan: ['water'] }]),
      ...errors(meeting, [{ do: 'scout' }, { choose: 'zz' }]),
      ...errors(dead, [{ endDay: true }]),
    ];
    for (const e of english) {
      const said = refusalText(e, sv);
      expect(said, e).not.toBe(e);
      expect(englishIn(said), e).toEqual([]);
      // Matched by a template, which gives back exactly what the session said: the two can't drift apart.
      const m = matchRefusal(e);
      expect(m, e).not.toBeNull();
      expect(fill(EN[m!.key], m!.vars)).toBe(e);
      // And an English game's refusals are the session's own words.
      expect(refusalText(e, makeT('en'))).toBe(e);
    }
  });

  it('the language travels with the saved session, beside the state, and a language we lack reads as English', () => {
    const g = startGame({ seed: 's1', lang: 'sv' });
    const raw = serialize(g);
    expect(JSON.parse(raw).lang).toBe('sv');
    expect(deserialize(raw)?.lang).toBe('sv');
    expect(JSON.parse(raw).app).toEqual(JSON.parse(serialize(startGame({ seed: 's1' }))).app);
    const unknown = deserialize(raw.replace('"lang":"sv"', '"lang":"xx"'))!;
    expect(unknown.lang).toBeUndefined();
    expect(view(unknown).text).toBe(observe(unknown.app.sim));
  });

  it('over MCP: new_game takes lang, and the game and the lines around it come back in Swedish; an unknown one is refused', async () => {
    const store = memoryStore();
    const server: Server = createServer(makeHandler({ PLAY_STORE: 'memory' }, { newSeed: () => 's1' }, store));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const client = new Client({ name: 'lang-test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)));
      const textOf = (r: unknown): string => ((r as { content: { text: string }[] }).content[0]?.text ?? '');
      const start = textOf(await client.callTool({ name: 'new_game', arguments: { name: 'Vega', lang: 'sv' } }));
      expect(start).toContain('Spelet har börjat. game_id:');
      expect(start).toContain('DAG 1');
      expect(start).toContain('DRAG NU');
      const id = /game_id: ([0-9a-f-]{36})/.exec(start)![1];
      const moved = textOf(await client.callTool({ name: 'act', arguments: { game_id: id, move: 'explore' } }));
      expect(moved).toContain('(look visar hela vyn');
      const refused = await client.callTool({ name: 'act', arguments: { game_id: id, move: 'hunt@3' } });
      expect(textOf(refused)).toMatch(/^Nekat: /);
      const looked = textOf(await client.callTool({ name: 'look', arguments: { game_id: id } }));
      expect(englishIn([start, moved, textOf(refused), looked].join('\n'))).toEqual([]);
      const bad = await client.callTool({ name: 'new_game', arguments: { lang: 'de' } });
      expect((bad as { isError?: boolean }).isError).toBe(true);
      expect(textOf(bad)).toContain('"lang" is the language of the game\'s text: "en" or "sv"');
      await client.close();
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
