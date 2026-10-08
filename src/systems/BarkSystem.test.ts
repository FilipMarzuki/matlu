import { describe, it, expect } from 'vitest';
import { BarkSystem } from './BarkSystem';
import npcBarks from '../data/npcBarks.json';
import type { NpcBarkEntry } from './BarkSystem';

const ENTRIES: NpcBarkEntry[] = [
  { npcId: 'blacksmith', barks: ['The forge never sleeps.', 'Need a blade sharpened?'] },
];

describe('BarkSystem', () => {
  it('given the player is within the proximity radius, when no prior bark, then returns a line from that NPC\'s list', () => {
    const sys = new BarkSystem(ENTRIES, 100, 30_000);
    const line = sys.tryBark('blacksmith', 50, 0);
    expect(line).not.toBeNull();
    expect(ENTRIES[0].barks).toContain(line);
  });

  it('given the player is outside the proximity radius, when tryBark is called, then returns null', () => {
    const sys = new BarkSystem(ENTRIES, 100, 30_000);
    const line = sys.tryBark('blacksmith', 150, 0);
    expect(line).toBeNull();
  });

  it('given a bark just fired, when tryBark is called again before the cooldown elapses, then returns null', () => {
    const sys = new BarkSystem(ENTRIES, 100, 30_000);
    expect(sys.tryBark('blacksmith', 50, 0)).not.toBeNull();
    expect(sys.tryBark('blacksmith', 50, 10_000)).toBeNull();
  });

  it('given the cooldown has fully elapsed, when tryBark is called again, then returns a line', () => {
    const sys = new BarkSystem(ENTRIES, 100, 30_000);
    expect(sys.tryBark('blacksmith', 50, 0)).not.toBeNull();
    expect(sys.tryBark('blacksmith', 50, 30_000)).not.toBeNull();
  });

  it('given an NPC with no bark data, when tryBark is called, then returns null', () => {
    const sys = new BarkSystem(ENTRIES, 100, 30_000);
    expect(sys.tryBark('unknown-npc', 10, 0)).toBeNull();
  });

  it('given a seeded rng, when tryBark selects randomly, then picks the line at the matching index', () => {
    const sys = new BarkSystem(ENTRIES, 100, 30_000);
    const line = sys.tryBark('blacksmith', 10, 0, () => 0.999);
    expect(line).toBe(ENTRIES[0].barks[1]);
  });

  it('given cooldowns are tracked per NPC, when one NPC is on cooldown, then a different NPC can still bark', () => {
    const entries: NpcBarkEntry[] = [
      { npcId: 'npc-a', barks: ['Line A'] },
      { npcId: 'npc-b', barks: ['Line B'] },
    ];
    const sys = new BarkSystem(entries, 100, 30_000);
    expect(sys.tryBark('npc-a', 10, 0)).toBe('Line A');
    expect(sys.tryBark('npc-a', 10, 1_000)).toBeNull();
    expect(sys.tryBark('npc-b', 10, 1_000)).toBe('Line B');
  });

  it('loads bark lines from npcBarks.json with at least 3 NPCs defined', () => {
    expect(npcBarks.length).toBeGreaterThanOrEqual(3);
    const sys = new BarkSystem(npcBarks as NpcBarkEntry[]);
    for (const entry of npcBarks as NpcBarkEntry[]) {
      expect(entry.barks.length).toBeGreaterThan(0);
      const line = sys.tryBark(entry.npcId, 0, 0);
      expect(entry.barks).toContain(line);
    }
  });
});
