/**
 * The bridge from the story engine's organisations to the road (#1587, knowledge slice B): where a
 * road village's province has a guild, an academy or a company in the generated history, the
 * village's people can belong to it, and its facts come from what the engine says it did.
 *
 * Tested on a told history written by hand (plain data, as the page keeps it): the Reach's 150
 * years found a guild in only a few seeds, and rarely in a road village's province.
 */

import { describe, it, expect } from 'vitest';
import { engineOrgs, ENGINE_GUILD_RANKS } from './organisations';
import type { HistoryOrg, ReachHistory } from './history-format';
import type { VillageRegion } from './regions';
import { answer, gateOf, knows, type Knower } from '../knowledge';
import { knowerOf } from '../facts';
import { runHistory } from './history';

const WHERE: VillageRegion[] = [
  { village: 'hollowford', province: { id: 'p2', name: 'Hollowford' }, region: 'north-road', crafted: true },
  { village: 'saltmere', province: { id: 'p5', name: 'Saltmere' }, region: 'north-road', crafted: true },
  { village: 'kestrel-gate', province: { id: 'p7', name: 'Kestrel Gate' }, region: 'north-road', crafted: true },
];

const guild = (over: Partial<HistoryOrg> = {}): HistoryOrg => ({
  id: 'g1', name: 'Guild of Kestrel Smiths', kind: 'guild', craft: 'smithing', province: 'p7', founded: 210, ended: null, members: 4, head: 'Ivar of Hedlund', monopoly: null, ...over,
});

const history = (orgs: HistoryOrg[]): ReachHistory => ({ version: 6, seed: 1, year: 300, provinces: [], regions: [], chronicle: '', logged: 0, told: 0, orgs });

describe('Organisations from the generated history (#1587)', () => {
  it('a guild seated in a road village’s province becomes an organisation with ranks, and the village’s smith belongs to it', () => {
    const r = engineOrgs(history([guild()]), WHERE);
    const id = 'history-g1';
    expect(r.orgs[id]).toMatchObject({ id, name: 'Guild of Kestrel Smiths', kind: 'guild', ranks: ENGINE_GUILD_RANKS, secrecy: 'guarded' });
    // Sabine is Kestrel Gate's smith: a journeyman (the engine's own guildmaster is the master).
    expect(r.members).toEqual({ 'kg-sabine': { [id]: 2 } });
  });

  it('its facts are what the engine says it did: founded, its master, its size, its monopoly', () => {
    const r = engineOrgs(history([guild({ monopoly: 'Ibiki brasswork' })]), WHERE);
    const texts = r.facts.map(f => f.text).join(' ');
    expect(texts).toMatch(/chartered in 210, 90 years ago/);
    expect(texts).toMatch(/Ivar of Hedlund/);
    expect(texts).toMatch(/4 masters/);
    expect(texts).toMatch(/Ibiki brasswork/);
    // Everyone in the village knows the guild has its hall there; only members know its business.
    const hall = r.facts.find(f => f.scope.kind === 'village')!;
    expect(hall.scope).toEqual({ kind: 'village', id: 'kestrel-gate' });
    expect(r.facts.filter(f => f.scope.kind === 'org').every(f => f.scope.id === 'history-g1')).toBe(true);
  });

  it('members know its facts as deep as their rank, and keep them at its secrecy', () => {
    const r = engineOrgs(history([guild({ monopoly: 'Ibiki brasswork' })]), WHERE);
    const sabine: Knower = { ...knowerOf('kg-sabine')!, orgs: r.members['kg-sabine'] };
    const veit: Knower = knowerOf('kg-veit')!;
    const master = r.facts.find(f => /Ivar of Hedlund/.test(f.text))!;
    expect(knows(sabine, master)).toBe(true);
    expect(knows(veit, master)).toBe(false);
    // A journeyman doesn't know what only the master does.
    const deepest = r.facts.filter(f => f.scope.kind === 'org').reduce((a, b) => ((b.depth ?? 1) > (a.depth ?? 1) ? b : a));
    expect(deepest.depth).toBe(3);
    expect(knows(sabine, deepest)).toBe(false);
    // Guarded: an outsider needs 25 even for what the guild says openly.
    const founded = r.facts.find(f => /chartered/.test(f.text))!;
    expect(gateOf(founded, r.orgs)).toBe(25);
    expect(answer(sabine, founded.about[0], 20, r.facts, r.orgs)).toMatchObject({ kind: 'not-yet', trust: 25 });
  });

  it('an academy takes the village’s teacher, at rank 1 (only guilds have ranks), and is open about itself', () => {
    const academy: HistoryOrg = { id: 'a1', name: 'Academy of Saltmere', kind: 'academy', craft: null, province: 'p5', founded: 250, ended: null, members: 6, head: 'Sigrid of Ask', monopoly: null };
    const r = engineOrgs(history([academy]), WHERE);
    expect(r.orgs['history-a1']).toMatchObject({ kind: 'academy', secrecy: 'open', reliability: 'careful' });
    expect(r.orgs['history-a1'].ranks).toBeUndefined();
    expect(r.members).toEqual({ 'sm-anselm': { 'history-a1': 1 } });
  });

  it('leaves out what isn’t standing, isn’t in a road village’s province, or has no one there to join', () => {
    const r = engineOrgs(history([
      guild({ id: 'g2', ended: 280 }),
      guild({ id: 'g3', province: 'p9' }),
      guild({ id: 'g4', craft: 'arcana', province: 'p2' }),
    ]), WHERE);
    expect(Object.keys(r.orgs)).toEqual(['history-g4']);
    expect(r.members).toEqual({});
    // Nobody belongs, but the village still knows the hall is there.
    expect(r.facts.map(f => f.scope.kind)).toEqual(['village']);
  });

  it('reads a history kept before organisations (no `orgs`) as none', () => {
    const { orgs: _, ...old } = history([guild()]);
    expect(engineOrgs(old as ReachHistory, WHERE)).toEqual({ orgs: {}, facts: [], members: {} });
  });

  it('the told history carries the engine’s organisations as plain data', () => {
    const h = runHistory(42);
    expect(Array.isArray(h.orgs)).toBe(true);
    for (const o of h.orgs ?? []) {
      expect(['guild', 'academy', 'company']).toContain(o.kind);
      expect(typeof o.name).toBe('string');
      expect(h.provinces.some(p => p.id === o.province)).toBe(true);
    }
  }, 30000);
});
