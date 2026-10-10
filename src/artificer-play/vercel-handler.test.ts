/**
 * The Vercel function for #1555, run as a real local HTTP server (the same `(req, res)` handler
 * Vercel calls), over an in-memory store.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeHandler, pathOf } from './vercel-handler';
import { LIMITS } from './api';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer(makeHandler({ PLAY_STORE: 'memory' }, { newSeed: () => 's1' }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

const call = (path: string, init?: RequestInit) => fetch(base + path, init);
const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('The play API as a Vercel function (#1555)', () => {
  it('plays over HTTP: start a game, make a move, read it back', async () => {
    const start = await postJson('/api/v1/games', { name: 'Ada' });
    expect(start.status).toBe(201);
    expect(start.headers.get('access-control-allow-origin')).toBe('*');
    expect(start.headers.get('cache-control')).toBe('no-store');
    const { id } = (await start.json()) as { id: string };
    const move = await postJson(`/api/v1/games/${id}/moves`, { move: { do: 'scout' } });
    expect(move.status).toBe(200);
    expect(((await move.json()) as { changed: string[] }).changed.join(' ')).toMatch(/Scouted/);
    const again = await call(`/api/v1/games/${id}`);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { status: string }).status).toMatch(/Day 1/);
  });

  it("lets Vercel's edge keep the run records for a minute, and only those (#1558)", async () => {
    const runs = await call('/api/v1/runs');
    expect(runs.status).toBe(200);
    expect(runs.headers.get('cache-control')).toMatch(/^public, max-age=0, s-maxage=60/);
    expect(await runs.json()).toEqual({ recent: [], best: [] });
    // Through Vercel's route too (/api/v1/runs arrives as /api/play?path=runs).
    expect((await call('/api/play?path=runs')).status).toBe(200);
  });

  it('answers a CORS preflight, and finds the path whether Vercel rewrote the URL or not', async () => {
    const pre = await call('/api/v1/games', { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    expect((await call('/api/play?path=rules')).status).toBe(200);
    expect(pathOf('/api/play?path=games/abc/moves')).toBe('/api/v1/games/abc/moves');
    expect(pathOf('/api/v1/games/abc?x=1')).toBe('/api/v1/games/abc');
  });

  it('counts games per address from the address Vercel sets, and refuses an oversized body with 413', async () => {
    // A fresh server, so the limit starts from zero, standing in for Vercel (which sets VERCEL=1).
    const s = createServer(makeHandler({ PLAY_STORE: 'memory', VERCEL: '1' }, { now: () => Date.now() }));
    await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1/games`;
    // x-vercel-forwarded-for is the one Vercel's edge writes; a client's own x-real-ip changes nothing.
    const start = (ip: string, forged = '203.0.113.99') => fetch(url, {
      method: 'POST', body: '{}',
      headers: { 'x-vercel-forwarded-for': ip, 'x-real-ip': forged },
    });
    try {
      for (let i = 0; i < LIMITS.gamesPerIpPerDay; i++) expect((await start('198.51.100.1', `203.0.113.${i}`)).status).toBe(201);
      expect((await start('198.51.100.1', '203.0.113.200')).status).toBe(429);
      expect((await start('198.51.100.2')).status).toBe(201);
      const big = await fetch(url, { method: 'POST', body: 'x'.repeat(LIMITS.bodyBytes * 4) });
      expect(big.status).toBe(413);
    } finally {
      await new Promise<void>(r => s.close(() => r()));
    }
  }, 30_000);

  it('off Vercel, ignores address headers a client sends and counts the connection itself', async () => {
    const s = createServer(makeHandler({ PLAY_STORE: 'memory' }));
    await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1/games`;
    try {
      for (let i = 0; i < LIMITS.gamesPerIpPerDay; i++) {
        const forged = `198.51.100.${i}`;
        const r = await fetch(url, { method: 'POST', body: '{}', headers: { 'x-vercel-forwarded-for': forged, 'x-forwarded-for': forged, 'x-real-ip': forged } });
        expect(r.status).toBe(201);
      }
      expect((await fetch(url, { method: 'POST', body: '{}', headers: { 'x-vercel-forwarded-for': '198.51.100.250' } })).status).toBe(429);
    } finally {
      await new Promise<void>(r => s.close(() => r()));
    }
  });

  it('answers 503, not a forgetful store, when no database is configured', async () => {
    const s = createServer(makeHandler({}));
    await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
    try {
      const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1/games`, { method: 'POST', body: '{}' });
      expect(r.status).toBe(503);
    } finally {
      await new Promise<void>(r => s.close(() => r()));
    }
  });
});
