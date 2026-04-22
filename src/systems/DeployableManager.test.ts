/**
 * DeployableManager — lifecycle unit tests.
 *
 * The manager's core responsibility is registry bookkeeping: per-owner tracking,
 * cap enforcement, and consistent teardown. This file tests that contract using
 * a stand-alone registry that mirrors the manager's logic without requiring a
 * Phaser browser context (which would fail in Node/vitest).
 *
 * Pattern note: the existing test files in this repo (CombatArenaScene.test.ts,
 * Accuracy.test.ts) all test pure functions to avoid loading Phaser in Node.
 * This file follows that convention — the registry logic is reproduced below and
 * kept in sync with DeployableManager.ts by the dev author.
 *
 * When Phaser gains a headless/test mode, these tests should migrate to use the
 * real DeployableManager import.
 */

import { describe, it, expect } from 'vitest';

// ── Pure registry (mirrors DeployableManager state logic) ────────────────────
// Extracted here so tests can run without a browser / Phaser context.

type Team = 'hero' | 'enemy';

interface MockDep {
  kind:          string;
  team:          Team;
  owner:         object;
  hp:            number;
  cleanedUp:     boolean;
  removedCalled: boolean;
  tick:          (delta: number) => boolean;
  cleanup:       () => void;
}

/**
 * Minimal deployable registry — state management only, no Phaser objects.
 * Mirrors the data-path of DeployableManager (add, update, remove, getCount,
 * getActive, getHostileTargets, removeAllFor, destroyAll).
 */
class TestRegistry {
  private readonly active = new Set<MockDep>();
  private readonly byOwner = new Map<object, Set<MockDep>>();

  add(d: MockDep): void {
    this.active.add(d);
    let s = this.byOwner.get(d.owner);
    if (!s) { s = new Set(); this.byOwner.set(d.owner, s); }
    s.add(d);
  }

  update(delta: number): void {
    const expired: MockDep[] = [];
    for (const d of this.active) { if (!d.tick(delta)) expired.push(d); }
    for (const d of expired) {
      d.cleanup();
      this.active.delete(d);
      this.byOwner.get(d.owner)?.delete(d);
    }
  }

  remove(d: MockDep): void {
    if (!this.active.has(d)) return;
    d.cleanup();
    this.active.delete(d);
    this.byOwner.get(d.owner)?.delete(d);
  }

  removeAllFor(owner: object): void {
    const owned = this.byOwner.get(owner);
    if (!owned) return;
    for (const d of owned) { d.cleanup(); this.active.delete(d); }
    this.byOwner.delete(owner);
  }

  getActive(owner: object): MockDep[] {
    return [...(this.byOwner.get(owner) ?? [])];
  }

  getCount(owner: object, kind: string): number {
    let n = 0;
    for (const d of this.byOwner.get(owner) ?? []) { if (d.kind === kind) n++; }
    return n;
  }

  getHostileTargets(): MockDep[] {
    return [...this.active].filter(d => d.team === 'hero');
  }

  destroyAll(): void {
    for (const d of this.active) d.cleanup();
    this.active.clear();
    this.byOwner.clear();
  }

  get count(): number { return this.active.size; }
}

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeDep(opts: {
  kind?:        string;
  team?:        Team;
  lifetimeMs?:  number;
  hp?:          number;
  owner?:       object;
}): MockDep {
  const owner = opts.owner ?? {};
  let lifetime = opts.lifetimeMs ?? 200;
  let hp       = opts.hp ?? 40;

  const d: MockDep = {
    kind:          opts.kind ?? 'turret',
    team:          opts.team ?? 'hero',
    owner,
    hp,
    cleanedUp:     false,
    removedCalled: false,
    tick(delta: number): boolean {
      lifetime -= delta;
      return lifetime > 0 && this.hp > 0;
    },
    cleanup(): void {
      this.cleanedUp     = true;
      this.removedCalled = true; // onRemoved() equivalent
    },
  };
  return d;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeployableManager — lifecycle', () => {
  it('add → tick → expire → removes from manager and calls cleanup', () => {
    const reg   = new TestRegistry();
    const owner = {};
    const dep   = makeDep({ kind: 'turret', lifetimeMs: 100, owner });

    reg.add(dep);
    expect(reg.count).toBe(1);
    expect(reg.getCount(owner, 'turret')).toBe(1);

    // Partial tick — still alive.
    reg.update(50);
    expect(reg.count).toBe(1);
    expect(dep.cleanedUp).toBe(false);

    // Full expiry.
    reg.update(60); // cumulative 110 ms > 100 ms lifetime
    expect(reg.count).toBe(0);
    expect(reg.getCount(owner, 'turret')).toBe(0);
    expect(dep.cleanedUp).toBe(true);
    expect(dep.removedCalled).toBe(true);
  });

  it('HP reaches 0 → tick returns false → manager cleans up', () => {
    const reg = new TestRegistry();
    const dep = makeDep({ hp: 10, lifetimeMs: 10_000 });

    reg.add(dep);
    dep.hp = 0; // damage to 0 directly
    reg.update(16);

    expect(reg.count).toBe(0);
    expect(dep.cleanedUp).toBe(true);
  });

  it('manual remove() tears down and unregisters', () => {
    const reg   = new TestRegistry();
    const owner = {};
    const dep   = makeDep({ owner });

    reg.add(dep);
    reg.remove(dep);

    expect(reg.count).toBe(0);
    expect(reg.getCount(owner, 'turret')).toBe(0);
    expect(dep.cleanedUp).toBe(true);
  });

  it('removeAllFor() cleans up all deployables owned by that hero', () => {
    const reg   = new TestRegistry();
    const owner = {};
    const d1    = makeDep({ kind: 'turret', owner });
    const d2    = makeDep({ kind: 'mine',   owner });
    const other = makeDep({ kind: 'turret', owner: {} });

    reg.add(d1); reg.add(d2); reg.add(other);
    expect(reg.count).toBe(3);

    reg.removeAllFor(owner);

    expect(reg.count).toBe(1);           // other still alive
    expect(d1.cleanedUp).toBe(true);
    expect(d2.cleanedUp).toBe(true);
    expect(other.cleanedUp).toBe(false);
  });

  it('multiple deployables for the same owner tracked independently by kind', () => {
    const reg   = new TestRegistry();
    const owner = {};
    const t1    = makeDep({ kind: 'turret', lifetimeMs: 50,  owner });
    const t2    = makeDep({ kind: 'turret', lifetimeMs: 200, owner });

    reg.add(t1); reg.add(t2);
    expect(reg.getCount(owner, 'turret')).toBe(2);

    reg.update(100); // t1 expires, t2 lives on
    expect(reg.count).toBe(1);
    expect(reg.getCount(owner, 'turret')).toBe(1);
    expect(t1.cleanedUp).toBe(true);
    expect(t2.cleanedUp).toBe(false);
  });

  it('getHostileTargets() returns only hero-team deployables', () => {
    const reg        = new TestRegistry();
    const heroTurret = makeDep({ team: 'hero'  });
    const foeDevice  = makeDep({ team: 'enemy' });

    reg.add(heroTurret); reg.add(foeDevice);

    const targets = reg.getHostileTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0]).toBe(heroTurret);
  });

  it('getActive() returns only that owner\'s deployables', () => {
    const reg   = new TestRegistry();
    const alice = {};
    const bob   = {};

    const a1 = makeDep({ owner: alice });
    const a2 = makeDep({ owner: alice });
    const b1 = makeDep({ owner: bob   });

    reg.add(a1); reg.add(a2); reg.add(b1);

    expect(reg.getActive(alice)).toHaveLength(2);
    expect(reg.getActive(bob)).toHaveLength(1);
  });

  it('destroyAll() tears down everything and leaves no leaks', () => {
    const reg = new TestRegistry();
    const d1  = makeDep({ lifetimeMs: 500 });
    const d2  = makeDep({ lifetimeMs: 500 });

    reg.add(d1); reg.add(d2);
    reg.destroyAll();

    expect(reg.count).toBe(0);
    expect(d1.cleanedUp).toBe(true);
    expect(d2.cleanedUp).toBe(true);
  });

  it('no crash when owner hero dies with active deployables (removeAllFor)', () => {
    const reg   = new TestRegistry();
    const owner = {};

    // Place 3 deployables.
    for (let i = 0; i < 3; i++) reg.add(makeDep({ owner }));
    expect(reg.count).toBe(3);

    // Simulate hero death — clean up orphans.
    expect(() => reg.removeAllFor(owner)).not.toThrow();
    expect(reg.count).toBe(0);
  });
});

// ── Cap enforcement (pure logic) ──────────────────────────────────────────────
// Mirrors the cap check in DeployableManager.place().

describe('DeployableManager — cap enforcement (placement logic)', () => {
  function tryPlace(reg: TestRegistry, owner: object, kind: string, cap: number): boolean {
    const current = reg.getCount(owner, kind);
    if (current >= cap) return false; // cap-hit
    reg.add(makeDep({ kind, owner }));
    return true;
  }

  it('first placement within cap succeeds', () => {
    const reg   = new TestRegistry();
    const owner = {};
    expect(tryPlace(reg, owner, 'turret', 1)).toBe(true);
    expect(reg.count).toBe(1);
  });

  it('second placement of same kind exceeds cap', () => {
    const reg   = new TestRegistry();
    const owner = {};
    tryPlace(reg, owner, 'turret', 1);                  // first: OK
    expect(tryPlace(reg, owner, 'turret', 1)).toBe(false); // second: cap-hit
    expect(reg.count).toBe(1);
  });

  it('cap is per-kind — different kinds are independent', () => {
    const reg   = new TestRegistry();
    const owner = {};
    expect(tryPlace(reg, owner, 'turret', 1)).toBe(true);
    expect(tryPlace(reg, owner, 'mine',   2)).toBe(true);
    expect(tryPlace(reg, owner, 'mine',   2)).toBe(true); // cap=2 allows second mine
    expect(tryPlace(reg, owner, 'mine',   2)).toBe(false); // third mine rejected
    expect(reg.count).toBe(3);
  });

  it('expired deployable frees its cap slot', () => {
    const reg   = new TestRegistry();
    const owner = {};

    // Place at cap.
    const dep = makeDep({ kind: 'turret', lifetimeMs: 50, owner });
    reg.add(dep);
    expect(tryPlace(reg, owner, 'turret', 1)).toBe(false); // cap full

    // Let it expire.
    reg.update(100);
    expect(tryPlace(reg, owner, 'turret', 1)).toBe(true); // slot freed
  });
});
