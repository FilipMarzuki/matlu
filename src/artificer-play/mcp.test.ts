/**
 * The MCP server (#1556), played by the official MCP client over real HTTP: a local server runs
 * the same Vercel handler, over an in-memory store, and the client speaks both protocol eras:
 * 2025 (`initialize`, the default) and 2026-07-28 (pinned).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { makeHandler } from './vercel-handler';
import { memoryStore, type GameRecord } from './api';
import { clientFromSessionId, sessionIdFor, toMove } from './mcp';

let server: Server;
let base = '';
const store = memoryStore();

beforeAll(async () => {
  // The store is passed in through PLAY_STORE=memory's place: a handler over this test's store.
  server = createServer(makeHandler({ PLAY_STORE: 'memory' }, { newSeed: () => 's1' }, store));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

type Era = 'legacy' | 'modern';
async function connect(era: Era, name = `test-${era}`): Promise<Client> {
  const client = new Client({ name, version: '1.0.0' }, era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {});
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}

const textOf = (r: unknown): string => ((r as { content: { text: string }[] }).content[0]?.text ?? '');
const isError = (r: unknown): boolean => Boolean((r as { isError?: boolean }).isError);
const idIn = (t: string): string => /game_id: ([0-9a-f-]{36})/.exec(t)?.[1] ?? '';
const rowFor = (id: string): GameRecord => store.rows.get(id)!;

describe('The Artificer over MCP (#1556)', () => {
  for (const era of ['legacy', 'modern'] as const) {
    it(`${era}: lists the six tools, each with a description and an input schema`, async () => {
      const client = await connect(era);
      const { tools } = await client.listTools();
      expect(tools.map(t => t.name).sort()).toEqual(['act', 'choose', 'look', 'new_game', 'plan_day', 'rules']);
      for (const t of tools) {
        expect(t.description?.length).toBeGreaterThan(40);
        expect(t.inputSchema.type).toBe('object');
      }
      await client.close();
    });

    it(`${era}: plays from new_game to the second morning, and the game remembers the client and model`, async () => {
      const client = await connect(era, `player-${era}`);
      const start = await client.callTool({ name: 'new_game', arguments: { name: 'Vega', model: 'some-model' } });
      const t = textOf(start);
      expect(t).toContain('DAY 1');
      expect(t).toContain('MOVES NOW');
      const id = idIn(t);
      expect(rowFor(id).client).toBe(`player-${era}`);
      expect(rowFor(id).model).toBe('some-model');

      const scout = await client.callTool({ name: 'act', arguments: { game_id: id, move: 'scout' } });
      expect(isError(scout)).toBe(false);
      expect(textOf(scout)).toMatch(/Scouted/);
      expect(textOf(scout)).toMatch(/Day 1 · [\d.]+\/14h/);

      // A move object exactly as the moves list shows it works too.
      expect(isError(await client.callTool({ name: 'act', arguments: { game_id: id, move: { do: 'water' } } }))).toBe(false);
      const night = await client.callTool({ name: 'act', arguments: { game_id: id, move: 'end_day' } });
      expect(isError(night)).toBe(false);
      const look = await client.callTool({ name: 'look', arguments: { game_id: id } });
      expect(textOf(look)).toContain('DAY 2');
      expect(rowFor(id).moves).toEqual([{ do: 'scout' }, { do: 'water' }, { endDay: true }]);
      await client.close();
    });
  }

  it('refuses an illegal move with the reason and the open moves, and changes nothing', async () => {
    const client = await connect('legacy');
    const id = idIn(textOf(await client.callTool({ name: 'new_game', arguments: {} })));
    const r = await client.callTool({ name: 'act', arguments: { game_id: id, move: 'teleport' } });
    expect(isError(r)).toBe(true);
    expect(textOf(r)).toMatch(/^Refused: .*teleport/);
    expect(textOf(r)).toContain('MOVES NOW');
    expect(rowFor(id).moves).toEqual([]);
    // Planning a day is refused until the Warden has learned to plan.
    const plan = await client.callTool({ name: 'plan_day', arguments: { game_id: id, actions: ['scout', 'water'] } });
    expect(isError(plan)).toBe(true);
    expect(textOf(plan)).toMatch(/plan/i);
    await client.close();
  });

  it('answers an unknown game as an error, and serves the rules', async () => {
    const client = await connect('modern');
    const nope = await client.callTool({ name: 'look', arguments: { game_id: '00000000-0000-0000-0000-000000000000' } });
    expect(isError(nope)).toBe(true);
    expect(textOf(nope)).toMatch(/404/);
    expect(textOf(await client.callTool({ name: 'rules', arguments: {} }))).toContain('Greywind Reach');
    await client.close();
  });

  it('answers a browser preflight for /mcp, exposing the session header', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-headers')).toMatch(/Mcp-Session-Id/);
    expect(r.headers.get('access-control-expose-headers')).toMatch(/Mcp-Session-Id/);
  });

  it('reads moves the way a model writes them, and carries a client name in the session id', () => {
    expect(toMove('end_day')).toEqual({ endDay: true });
    expect(toMove('End the day')).toEqual({ endDay: true });
    expect(toMove(' gather@2 ')).toEqual({ do: 'gather@2' });
    expect(toMove({ set: { eating: 'half' } })).toEqual({ set: { eating: 'half' } });
    expect(clientFromSessionId(sessionIdFor('Claude Desktop'))).toBe('Claude Desktop');
    expect(clientFromSessionId('someone-elses-id')).toBeNull();
    expect(clientFromSessionId(null)).toBeNull();
  });
});
