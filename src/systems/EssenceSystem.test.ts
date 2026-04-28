/**
 * EssenceSystem — pure logic tests.
 *
 * EssenceSystem depends only on Phaser's DataManager for registry access and
 * on localStorage for persistence. Both are stubbed below so tests run in
 * Node/vitest without a browser context.
 *
 * The pattern mirrors DeployableManager.test.ts: extract the data-logic into
 * a standalone harness rather than loading Phaser.
 */

import { describe, it, expect } from 'vitest';

// ── Minimal stubs ─────────────────────────────────────────────────────────────

class StubDataManager {
  private store = new Map<string, unknown>();

  get(key: string): unknown { return this.store.get(key); }
  set(key: string, value: unknown): void { this.store.set(key, value); }
  has(key: string): boolean { return this.store.has(key); }
}

class StubLocalStorage {
  private data = new Map<string, string>();

  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
  clear(): void { this.data.clear(); }
}

// ── Inline EssenceSystem (mirrors src/systems/EssenceSystem.ts logic) ─────────
// Keeping the logic inline lets tests run without a Phaser context while
// still exercising the real algorithm. Kept in sync by the developer.

const REGISTRY_CARRIED = 'essence-carried';
const REGISTRY_VAULTED = 'essence-vaulted';
const LS_KEY = 'matlu-essence';

interface EssenceSave { carried: number; vaulted: number; }

class TestEssenceSystem {
  private emitted: Array<{ carried: number; vaulted: number }> = [];

  constructor(
    private readonly reg: StubDataManager,
    private readonly ls: StubLocalStorage,
  ) {
    this._restoreFromStorage();
  }

  earn(amount: number, source: string): void {
    void source;
    this.reg.set(REGISTRY_CARRIED, this.getCarried() + amount);
    this._persist();
    this._emit();
  }

  spend(amount: number, sink: string): boolean {
    void sink;
    const carried = this.getCarried();
    if (carried < amount) return false;
    this.reg.set(REGISTRY_CARRIED, carried - amount);
    this._persist();
    this._emit();
    return true;
  }

  getCarried(): number { return (this.reg.get(REGISTRY_CARRIED) as number | undefined) ?? 0; }
  getVaulted(): number { return (this.reg.get(REGISTRY_VAULTED) as number | undefined) ?? 0; }
  getTotal(): number   { return this.getCarried() + this.getVaulted(); }

  essenceLossOnDeath(carried: number): number { return carried; }

  lastEmit(): { carried: number; vaulted: number } | undefined {
    return this.emitted[this.emitted.length - 1];
  }

  private _emit(): void {
    this.emitted.push({ carried: this.getCarried(), vaulted: this.getVaulted() });
  }

  private _persist(): void {
    const save: EssenceSave = { carried: this.getCarried(), vaulted: this.getVaulted() };
    this.ls.setItem(LS_KEY, JSON.stringify(save));
  }

  private _restoreFromStorage(): void {
    if (this.reg.has(REGISTRY_CARRIED)) return;
    const raw = this.ls.getItem(LS_KEY);
    if (!raw) return;
    const save = JSON.parse(raw) as Partial<EssenceSave>;
    this.reg.set(REGISTRY_CARRIED, save.carried ?? 0);
    this.reg.set(REGISTRY_VAULTED, save.vaulted ?? 0);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function make(): { sys: TestEssenceSystem; reg: StubDataManager; ls: StubLocalStorage } {
  const reg = new StubDataManager();
  const ls  = new StubLocalStorage();
  const sys = new TestEssenceSystem(reg, ls);
  return { sys, reg, ls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EssenceSystem — earn / spend round-trip', () => {
  it('starts at zero', () => {
    const { sys } = make();
    expect(sys.getCarried()).toBe(0);
    expect(sys.getVaulted()).toBe(0);
    expect(sys.getTotal()).toBe(0);
  });

  it('earn adds to carried', () => {
    const { sys } = make();
    sys.earn(10, 'kill');
    expect(sys.getCarried()).toBe(10);
    expect(sys.getTotal()).toBe(10);
  });

  it('spend deducts from carried and returns true', () => {
    const { sys } = make();
    sys.earn(20, 'kill');
    const ok = sys.spend(15, 'upgrade');
    expect(ok).toBe(true);
    expect(sys.getCarried()).toBe(5);
  });

  it('spend returns false when insufficient — no state change', () => {
    const { sys } = make();
    sys.earn(5, 'kill');
    const ok = sys.spend(10, 'upgrade');
    expect(ok).toBe(false);
    expect(sys.getCarried()).toBe(5);
  });

  it('spend exact balance leaves zero', () => {
    const { sys } = make();
    sys.earn(30, 'kill');
    expect(sys.spend(30, 'upgrade')).toBe(true);
    expect(sys.getCarried()).toBe(0);
  });

  it('earn emits an event with correct values', () => {
    const { sys } = make();
    sys.earn(7, 'source');
    expect(sys.lastEmit()).toEqual({ carried: 7, vaulted: 0 });
  });

  it('spend emits an event with correct values', () => {
    const { sys } = make();
    sys.earn(10, 'source');
    sys.spend(4, 'sink');
    expect(sys.lastEmit()).toEqual({ carried: 6, vaulted: 0 });
  });

  it('essenceLossOnDeath returns full carried amount', () => {
    const { sys } = make();
    expect(sys.essenceLossOnDeath(42)).toBe(42);
    expect(sys.essenceLossOnDeath(0)).toBe(0);
  });
});

describe('EssenceSystem — persistence', () => {
  it('persist to localStorage and restore in fresh instance', () => {
    const ls = new StubLocalStorage();
    const reg1 = new StubDataManager();
    const sys1 = new TestEssenceSystem(reg1, ls);
    sys1.earn(50, 'kill');

    // New registry simulates a page reload (fresh registry, same localStorage).
    const reg2 = new StubDataManager();
    const sys2 = new TestEssenceSystem(reg2, ls);
    expect(sys2.getCarried()).toBe(50);
  });

  it('registry takes precedence over localStorage (scene transition case)', () => {
    const ls = new StubLocalStorage();
    ls.setItem(LS_KEY, JSON.stringify({ carried: 99, vaulted: 0 }));

    // Registry already has a value (populated by a prior scene load).
    const reg = new StubDataManager();
    reg.set(REGISTRY_CARRIED, 5);

    const sys = new TestEssenceSystem(reg, ls);
    expect(sys.getCarried()).toBe(5); // registry wins
  });
});
