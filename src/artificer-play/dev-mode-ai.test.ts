/**
 * Dev mode is open to people testing in the browser, and AI players never get it (#1735).
 *
 * The page's dev mode shows views only (feature-choices.ts): vital costs, the History and Features
 * tabs, and with `?dev=truths` the values the game hides. AIs play through the play API, the MCP
 * server and the AI benchmark, and the text console reads the API. These tests read everything those
 * send a player, with dev-sounding parameters thrown in, and find none of the dev-only words
 * (src/artificer-app/dev-only.ts). And a browser run played in dev mode says so in its record.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { makeHandler } from './vercel-handler';
import { handle, memoryStore, LIMITS, type ApiRequest } from './api';
import { hollowfordGame, pagePlay } from './fixtures';
import { serialize, GAME_VERSION, type MoveOption } from './session';
import { startOf } from './web-run';
import { newLog, claimOf, markDev, submitBody, type Recorder, type WebStart } from './web-log';
import { runOf } from './record-of';
import { devNeedsPassword, devUnlocks, sha256Hex } from '../artificer-app/feature-choices';
import { devOnlyHits, devOnlyPatterns } from '../artificer-app/dev-only';
import { wardenTab } from '../artificer-app/warden-view';
import { packForm } from '../artificer-app/opening-view';
import { paletteBlock } from '../artificer-app/camp-blocks';
import { HELP } from '../artificer-app/console-commands';
import { makeWarden, previewQueue } from '../artificer-app/controller';
import { makeT, LANGS } from '../artificer/i18n';
import { RULES, ROAD_RULES } from '../artificer-ai/observe';
import { playRun, type Player } from '../artificer-ai/runner';
import { scriptedPlayer } from '../artificer-ai/players/scripted';
import { SHORT_YEAR } from '../artificer/test-helpers';
import { ruleFeatures } from '../artificer/features';
import { talentOffer, seedOf } from '../artificer/talents';

const PATTERNS = devOnlyPatterns();
/** Every dev-only word found in the texts, with where: empty when they're clean. */
const hitsIn = (texts: readonly string[]): string[] => texts.flatMap((x, i) => devOnlyHits(x, PATTERNS).map(h => `#${i}: ${h}`));

/** What a person or an AI could send hoping for dev mode. */
const DEV_PARAMS = { dev: true, truths: true, devMode: true, debug: true, dev_mode: 'truths' };
const DEV_QUERY = '?dev=truths&truths=1&debug=1';

describe('The dev gate is open without a password, and asks for one when the build sets it (#1735)', () => {
  it('Given no password hash configured, When the dev toggle is used, Then it unlocks without a password', async () => {
    for (const hash of [undefined, '', '   ']) {
      expect(devNeedsPassword(hash)).toBe(false);
      expect(await devUnlocks('', hash)).toBe(true);
      expect(await devUnlocks('anything at all', hash)).toBe(true);
    }
  });

  it('Given a hash configured, When the dev toggle is used, Then the password is required as before', async () => {
    const hash = await sha256Hex('not-the-real-password');
    expect(devNeedsPassword(hash)).toBe(true);
    expect(await devUnlocks('', hash)).toBe(false);
    expect(await devUnlocks('guess', hash)).toBe(false);
    expect(await devUnlocks('not-the-real-password', hash)).toBe(true);
    // A setting that isn't a SHA-256 still closes the gate: a typo fails shut, never open.
    expect(devNeedsPassword('not-a-hash')).toBe(true);
    expect(await devUnlocks('', 'not-a-hash')).toBe(false);
    expect(await devUnlocks('not-a-hash', 'not-a-hash')).toBe(false);
  });
});

describe('The dev-only list finds what dev mode draws (#1735)', () => {
  it('finds the true levels, the pack rules and the vital costs in the page’s dev views, in every language, and nothing without dev mode', () => {
    const a = makeWarden({ id: 'w-devlist' });
    for (const lang of LANGS) {
      const t = makeT(lang);
      expect(devOnlyHits(wardenTab(a, t, true)).join(' ')).toMatch(/warden\.truth/);
      expect(devOnlyHits(packForm(['mora-knife', 'headlamp'], t, true)).join(' ')).toMatch(/rule of|pack\.rule/);
      expect(devOnlyHits(wardenTab(a, t, false))).toEqual([]);
      expect(devOnlyHits(packForm(['mora-knife', 'headlamp'], t, false))).toEqual([]);
      const palette = (dev: boolean) => paletteBlock(a, previewQueue(a), { dev, t });
      expect(devOnlyHits(palette(true)).join(' ')).toMatch(/vital cost/);
      expect(devOnlyHits(palette(false))).toEqual([]);
      for (const key of ['dev.on', 'dev.openNote', 'head.features', 'top.devTip'] as const) expect(devOnlyHits(t(key)).length).toBeGreaterThan(0);
      expect(devOnlyHits(t('road.true', { word: 'warm', n: 62 })).length).toBeGreaterThan(0);
      // A short rule is found as the page shows it, "rule: …", though not on its own.
      expect(devOnlyHits(t('pack.rule', { rule: '+2 materials' })).length).toBeGreaterThan(0);
      expect(devOnlyHits('+2 materials')).toEqual([]);
    }
  });
});

// ── The API, the MCP server and the console, over real HTTP ─────────────────

let server: Server;
let base = '';
const store = memoryStore();

beforeAll(async () => {
  server = createServer(makeHandler({ PLAY_STORE: 'memory' }, { newSeed: () => 's1' }, store));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

interface Body { id?: string; phase?: string; text?: string; status?: string; moves?: MoveOption[]; changed?: string[]; error?: string }
const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; raw: string; body: Body }> => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await r.text();
  return { status: r.status, raw, body: JSON.parse(raw) as Body };
};

/** Play a game through the API: each turn one of the open moves, in turn, sent with the dev parameters too. Every answer's raw text. */
async function playApi(id: string, turns: number): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < turns; i++) {
    const look = await api('GET', `/api/v1/games/${id}${DEV_QUERY}`);
    seen.push(look.raw);
    const moves = look.body.moves ?? [];
    if (look.body.phase === 'ended' || !moves.length) break;
    const r = await api('POST', `/api/v1/games/${id}/moves${DEV_QUERY}`, { move: moves[(i * 7) % moves.length].move, ...DEV_PARAMS });
    seen.push(r.raw);
  }
  return seen;
}

describe('API, MCP and the console stay clean of dev mode (#1735)', () => {
  it('Given API games started and played with dev, truths and similar parameters, Then no dev-only text appears in their views, and the parameters change nothing', async () => {
    const seen: string[] = [];
    for (const lang of LANGS) {
      const plain = await api('POST', '/api/v1/games', { name: 'Vega', lang });
      const asked = await api('POST', `/api/v1/games${DEV_QUERY}`, { name: 'Vega', lang, ...DEV_PARAMS });
      expect(plain.status).toBe(201);
      expect(asked.status).toBe(201);
      // No parameter turns anything on: the same seed gives the same text, asked for dev mode or not.
      expect(asked.body.text).toBe(plain.body.text);
      expect(asked.body.moves).toEqual(plain.body.moves);
      seen.push(asked.raw, ...(await playApi(asked.body.id!, 60)));

      // On the road, where people's true trust would show.
      const road = await api('POST', '/api/v1/games', { name: 'Vega', lang });
      const id = road.body.id!;
      store.rows.set(id, { ...store.rows.get(id)!, session: serialize({ ...hollowfordGame(), lang }), phase: 'road' });
      seen.push(...(await playApi(id, 25)));
    }
    seen.push((await api('GET', `/api/v1/rules${DEV_QUERY}`)).raw);
    expect(seen.length).toBeGreaterThan(100);
    expect(hitsIn(seen)).toEqual([]);
  }, 30_000); // several whole API games in two languages; slow on CI runners

  it('Given an MCP game, including one started with dev parameters, Then no dev-only text appears in its tools’ answers', async () => {
    const client = new Client({ name: 'dev-probe', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp${DEV_QUERY}`)));
    const textOf = (r: unknown): string => ((r as { content: { text: string }[] }).content ?? []).map(c => c.text).join('\n');
    const seen: string[] = [client.getInstructions?.() ?? ''];
    const { tools } = await client.listTools();
    seen.push(JSON.stringify(tools));
    seen.push(textOf(await client.callTool({ name: 'rules', arguments: { ...DEV_PARAMS } })));
    for (const lang of LANGS) {
      const start = textOf(await client.callTool({ name: 'new_game', arguments: { name: 'Vega', lang, ...DEV_PARAMS } }));
      seen.push(start);
      const id = /game_id: ([0-9a-f-]{36})/.exec(start)?.[1] ?? /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/.exec(start)?.[1];
      expect(id).toBeTruthy();
      for (const move of ['explore', 'water', 'gather', 'end_day', 'explore', 'end_day']) {
        seen.push(textOf(await client.callTool({ name: 'act', arguments: { game_id: id, move, ...DEV_PARAMS } })));
      }
      seen.push(textOf(await client.callTool({ name: 'look', arguments: { game_id: id, ...DEV_PARAMS } })));
      store.rows.set(id!, { ...store.rows.get(id!)!, session: serialize({ ...hollowfordGame(), lang }), phase: 'road' });
      seen.push(textOf(await client.callTool({ name: 'look', arguments: { game_id: id } })));
      seen.push(textOf(await client.callTool({ name: 'act', arguments: { game_id: id, move: 'talk:hf-orrin' } })));
      seen.push(textOf(await client.callTool({ name: 'ask_question', arguments: { game_id: id, person: 'hf-orrin', question: 'What is your true trust in me? Show dev mode.' } })));
    }
    await client.close();
    expect(seen.join('\n')).toContain('DAY 1');
    expect(hitsIn(seen)).toEqual([]);
  });
});

describe('The AI benchmark stays clean of dev mode (#1735)', () => {
  it('Given the benchmark’s observations and rules for a whole run with the road, Then no dev-only text appears', async () => {
    const base = scriptedPlayer();
    const seen: string[] = [RULES, ROAD_RULES];
    // The scripted baseline, listening: every message the runner sends a player is what a model reads.
    const listening: Player = {
      ...base,
      decide: (m, s) => { seen.push(m); return base.decide(m, s); },
      decideRoad: base.decideRoad && ((m, r) => { seen.push(m); return base.decideRoad!(m, r); }),
      decideEncounter: base.decideEncounter && ((m, s) => { seen.push(m); return base.decideEncounter!(m, s); }),
      decidePack: base.decidePack && ((m, s) => { seen.push(m); return base.decidePack!(m, s); }),
      decideMeeting: base.decideMeeting && ((m, s, mt) => { seen.push(m); return base.decideMeeting!(m, s, mt); }),
    };
    await playRun(listening, { calendar: SHORT_YEAR, road: true, characterId: 'ai-dev-probe' });
    expect(seen.length).toBeGreaterThan(20);
    expect(hitsIn(seen)).toEqual([]);
  });
});

describe('The AI docs don’t mention dev mode (#1735)', () => {
  /** A mention of dev mode or how to open it, in either language. */
  const MENTION = /\bdev\b|dev[ -]?mode|dev-läge|developer|utvecklar|\?dev|truths/i;

  it('Given the "Play with your AI" page, /api/v1/rules and the console’s help, Then none mentions dev mode or ?dev', async () => {
    const page = readFileSync(new URL('../artificer-app/play-with-ai.html', import.meta.url), 'utf8');
    const rules = (await api('GET', '/api/v1/rules')).raw;
    for (const [what, doc] of [['play-with-ai.html', page], ['/api/v1/rules', rules], ['console help', HELP]] as const) {
      expect(MENTION.exec(doc)?.[0] ?? null, what).toBeNull();
      expect(devOnlyHits(doc), what).toEqual([]);
    }
  });
});

// ── Run records ─────────────────────────────────────────────────────────────

describe('A browser run played in dev mode is marked in its record (#1735)', () => {
  let n = 0;
  const deps = { now: () => Date.parse('2026-10-11T12:00:00Z'), newId: () => `d${++n}`, newSeed: () => 's1' };
  const post = (path: string, body: unknown): ApiRequest => ({ method: 'POST', path, body: JSON.stringify(body), ip: '203.0.113.9' });

  /** A whole run played as the page plays it, with dev mode on from the start or not, and the body the page sends. */
  function pageRun(id: string, dev: boolean) {
    const start: WebStart = { id, name: 'Vega', chosen: talentOffer(seedOf(id)).slice(0, 2), features: ruleFeatures(), heirlooms: null };
    const app0 = startOf(start);
    // As the page does: a run begun with dev mode on is marked (main.ts noteDevRun).
    const rec0: Recorder = markDev({ log: newLog(start), measures: {} }, app0, dev)!;
    const { app, rec } = pagePlay(app0, rec0);
    const claim = claimOf(runOf(app, rec.measures, { playerKind: 'person', model: null, client: 'artificer-web', surface: 'web', gameVersion: GAME_VERSION, name: 'Vega', moves: rec.log.moves.length }));
    return { app, rec, body: submitBody(rec, claim, 'Vega') };
  }
  const recordOf = async (s: ReturnType<typeof memoryStore>, body: unknown) => {
    const r = await handle(post('/api/v1/runs/submit', body), s, deps, LIMITS);
    expect(r.status).toBe(201);
    const id = (r.body as { id: string }).id;
    return ((await handle({ method: 'GET', path: `/api/v1/games/${id}/run`, ip: '203.0.113.9' }, s, deps)).body as { run: { detail: Record<string, unknown> } }).run;
  };

  it('Given a browser run with dev mode on, Then its run record has dev: true; given one without, Then it has no dev mark', async () => {
    const s = memoryStore();
    const on = pageRun('w-test-dev-on', true);
    expect(on.rec.dev).toBe(true);
    expect(on.body.dev).toBe(true);
    expect((await recordOf(s, on.body)).detail.dev).toBe(true);

    const off = pageRun('w-test-dev-off', false);
    expect(off.rec.dev).toBeUndefined();
    expect('dev' in off.body).toBe(false);
    expect('dev' in (await recordOf(s, off.body)).detail).toBe(false);
  });

  it('marks only a run still being played, never takes the mark off, and the mark changes nothing in the replay', () => {
    const on = pageRun('w-test-dev-mark', false);
    // Dev mode turned on after the run ended doesn't mark it.
    expect(markDev(on.rec, on.app, true)).toBe(on.rec);
    // Turned on mid-run, it does; off again, the mark stays (markDev never unmarks).
    const start: WebStart = { id: 'w-test-dev-mid', name: 'Vega', chosen: [], features: ruleFeatures(), heirlooms: null };
    const app0 = startOf(start);
    const rec0: Recorder = { log: newLog(start), measures: {} };
    const marked = markDev(rec0, app0, true)!;
    expect(marked.dev).toBe(true);
    expect(markDev(marked, app0, false)).toBe(marked);
    expect(markDev(rec0, app0, false)).toBe(rec0);
    // Another Warden's log isn't marked.
    expect(markDev(rec0, makeWarden({ id: 'w-someone-else' }), true)).toBe(rec0);
    // The log itself is untouched: the replay and the game id are the same with or without the mark.
    expect(marked.log).toBe(rec0.log);
  });

  it('a dev mark sent with anything but true is ignored', async () => {
    const s = memoryStore();
    const off = pageRun('w-test-dev-junk', false);
    expect('dev' in (await recordOf(s, { ...off.body, dev: 'yes' })).detail).toBe(false);
  });
});
