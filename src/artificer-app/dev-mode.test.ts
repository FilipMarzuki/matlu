/**
 * Dev mode behind a password (#1688) and the Camp tab that waits for a camp (#1691): the pure parts
 * the page uses — how dev mode is resolved, the password check, which tabs show, and the hidden costs.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { devMode, setDevMode, devPasswordMatches, sha256Hex, visibleTabs, tabToOpen, tabIsDev, vitalCostLabel, type TabDef } from './feature-choices';
import { hasCamp, withCampLine, CAMP_LINE } from './camp-view';
import { chooseSite, createRegion1, runAction, type LogEntry } from '../artificer/region1';

/** A stand-in for localStorage. */
const fakeStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => undefined };

describe('Dev mode is off for players and opens only with the password (#1688)', () => {
  it('is off by default, and ?dev or ?dev=truths alone never opens it', () => {
    const s = fakeStore();
    expect(devMode('', s)).toBe(false);
    expect(devMode('?dev', s)).toBe(false);
    expect(devMode('?dev=truths', s)).toBe(false);
    expect(devMode('', null)).toBe(false);
    expect(devMode('?dev', null)).toBe(false);
  });

  it('ignores the old artificer.dev key, so an earlier ?dev visit starts locked', () => {
    const s = fakeStore();
    s.setItem('artificer.dev', '1');
    expect(devMode('', s)).toBe(false);
  });

  it('remembers an unlock across reloads, until it is left (or ?dev=0)', () => {
    const s = fakeStore();
    setDevMode(true, s);
    expect(devMode('', s)).toBe(true);
    expect(devMode('?dev', s)).toBe(true);
    setDevMode(false, s);
    expect(devMode('', s)).toBe(false);
    setDevMode(true, s);
    expect(devMode('?dev=0', s)).toBe(false);
    expect(devMode('', s)).toBe(false); // ?dev=0 is remembered
  });

  it('survives storage that refuses: nothing kept, nothing thrown, dev mode shut', () => {
    expect(() => setDevMode(true, broken)).not.toThrow();
    expect(devMode('', broken)).toBe(false);
    expect(() => setDevMode(true, null)).not.toThrow();
  });
});

describe('The dev password is checked against a SHA-256 hash (#1688)', () => {
  // A test password and its hash: neither is the real one (that hash lives only in Vercel's settings).
  const TEST_PASSWORD = 'not-the-real-password';
  const TEST_HASH = createHash('sha256').update(TEST_PASSWORD).digest('hex');

  it('hashes like Node does, as lowercase hex', async () => {
    expect(await sha256Hex(TEST_PASSWORD)).toBe(TEST_HASH);
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('opens with the right password, and not with a wrong one', async () => {
    expect(await devPasswordMatches(TEST_PASSWORD, TEST_HASH)).toBe(true);
    expect(await devPasswordMatches(`  ${TEST_PASSWORD} `, TEST_HASH)).toBe(true); // a phone keyboard's stray space
    expect(await devPasswordMatches('guess', TEST_HASH)).toBe(false);
    expect(await devPasswordMatches('', TEST_HASH)).toBe(false);
    expect(await devPasswordMatches(TEST_PASSWORD, TEST_HASH.toUpperCase())).toBe(true); // hex in either case
  });

  it('never opens without a hash set, or with something that is no SHA-256', async () => {
    expect(await devPasswordMatches(TEST_PASSWORD, undefined)).toBe(false);
    expect(await devPasswordMatches(TEST_PASSWORD, '')).toBe(false);
    expect(await devPasswordMatches(TEST_PASSWORD, TEST_PASSWORD)).toBe(false);
    expect(await devPasswordMatches('', '')).toBe(false);
  });
});

describe('Which tabs show, by dev mode and camp (#1688, #1691)', () => {
  type T = 'plan' | 'camp' | 'history' | 'warden';
  const tabs: TabDef<T>[] = [{ id: 'plan', label: 'PLAN' }, { id: 'camp', label: 'CAMP', needsCamp: true }, { id: 'history', label: 'HISTORY', dev: true }, { id: 'warden', label: 'WARDEN' }];
  const ids = (dev: boolean, camp: boolean) => visibleTabs(tabs, { dev, camp }).map(t => t.id);

  it('hides HISTORY without dev mode and CAMP until camp is made', () => {
    expect(ids(false, false)).toEqual(['plan', 'warden']);
    expect(ids(false, true)).toEqual(['plan', 'camp', 'warden']);
  });

  it('shows everything in dev mode, CAMP early tagged DEV, HISTORY always tagged DEV', () => {
    expect(ids(true, false)).toEqual(['plan', 'camp', 'history', 'warden']);
    expect(ids(true, true)).toEqual(['plan', 'camp', 'history', 'warden']);
    const camp = tabs[1];
    expect(tabIsDev(camp, { dev: true, camp: false })).toBe(true);
    expect(tabIsDev(camp, { dev: true, camp: true })).toBe(false);
    expect(tabIsDev(tabs[2], { dev: true, camp: true })).toBe(true);
    expect(tabIsDev(tabs[0], { dev: true, camp: false })).toBe(false);
  });

  it('opens the first shown tab when the wanted one is hidden', () => {
    expect(tabToOpen('camp', tabs, { dev: false, camp: false })).toBe('plan');
    expect(tabToOpen('camp', tabs, { dev: false, camp: true })).toBe('camp');
    expect(tabToOpen('history', tabs, { dev: false, camp: true })).toBe('plan');
    expect(tabToOpen('history', tabs, { dev: true, camp: false })).toBe('history');
    expect(tabToOpen('warden', tabs, { dev: false, camp: false })).toBe('warden');
    expect(tabToOpen('nonsense', tabs, { dev: true, camp: true })).toBe('plan');
    expect(tabToOpen(null, tabs, { dev: false, camp: false })).toBe('plan');
  });
});

describe('An action’s Vigor/Clarity cost shows only in dev mode (#1688)', () => {
  it('is hidden for players, and named in dev mode', () => {
    expect(vitalCostLabel({ vigorRate: -3.5, clarityRate: -1 }, false)).toBeNull();
    expect(vitalCostLabel({ vigorRate: 2, clarityRate: 1 }, false)).toBeNull();
    expect(vitalCostLabel({ vigorRate: -3.5, clarityRate: -1 }, true)).toBe('vigor + clarity');
    expect(vitalCostLabel({ vigorRate: 1, clarityRate: -1 }, true)).toBe('clarity');
    expect(vitalCostLabel({ vigorRate: -1, clarityRate: 0 }, true)).toBe('vigor');
    expect(vitalCostLabel({ vigorRate: 2, clarityRate: 1 }, true)).toBe('restores');
  });
});

describe('The camp, and its journal line (#1691)', () => {
  it('has no camp in a new run, and one once a site is chosen; the journal then says so', () => {
    const fresh = runAction(createRegion1({}, undefined, { id: 'w-camp' }), 'scout');
    expect(hasCamp(fresh)).toBe(false);
    expect(withCampLine(fresh.log)).toBe(fresh.log);
    expect(withCampLine(fresh.log).some(l => l.text === CAMP_LINE)).toBe(false);
    const camped = chooseSite(fresh, 'cave');
    expect(hasCamp(camped)).toBe(true);
    const shown = withCampLine(camped.log);
    const at = shown.findIndex(l => l.text === CAMP_LINE);
    expect(at).toBeGreaterThan(0);
    expect(shown[at - 1].text).toMatch(/^Chose the .+ as your ground/);
    expect(shown[at].day).toBe(camped.day);
    // The sim's own log is untouched: the line is drawn, not played.
    expect(camped.log.some(l => l.text === CAMP_LINE)).toBe(false);
  });

  it('says it once, at the first camp, even after moving camp', () => {
    const log: LogEntry[] = [
      { day: 1, text: 'Scouted the near ring.', kind: 'action' },
      { day: 2, text: 'Chose the cave as your ground.', kind: 'action' },
      { day: 5, text: 'Chose the river bank as your ground — the old shelter is left behind.', kind: 'action' },
    ];
    const shown = withCampLine(log);
    expect(shown.map(l => l.text)).toEqual([log[0].text, log[1].text, CAMP_LINE, log[2].text]);
    expect(shown[2]).toEqual({ day: 2, text: CAMP_LINE, kind: 'milestone' });
  });
});
