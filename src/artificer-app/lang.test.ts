import { describe, expect, it } from 'vitest';
import { LANG_KEY, pickerNeeded, storeLang, storedLang, type LangStore } from './lang';

/** A little in-memory storage, the shape of localStorage. */
function memory(init: Record<string, string> = {}): LangStore & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

/** Storage that refuses everything (a private window with site data blocked). */
const refusing: LangStore = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};

// #1704 acceptance: the stored choice is read back, and a bad or missing value means the picker shows.
describe('the viewer’s language (#1704)', () => {
  it('reads back the stored choice, and then the picker does not show', () => {
    const store = memory();
    storeLang('sv', store);
    expect(store.data[LANG_KEY]).toBe('sv');
    expect(storedLang(store)).toBe('sv');
    expect(pickerNeeded(store)).toBe(false);
    storeLang('en', store);
    expect(storedLang(store)).toBe('en');
  });

  it('shows the picker for a missing or bad value, or with no storage at all', () => {
    expect(pickerNeeded(memory())).toBe(true);
    for (const bad of ['', 'de', 'SV', 'svenska', '"sv"', 'null']) {
      expect(storedLang(memory({ [LANG_KEY]: bad }))).toBeNull();
      expect(pickerNeeded(memory({ [LANG_KEY]: bad }))).toBe(true);
    }
    expect(pickerNeeded(refusing)).toBe(true);
    expect(pickerNeeded(null)).toBe(true);
    // Writing to storage that refuses doesn't throw: the choice just isn't remembered.
    expect(() => storeLang('sv', refusing)).not.toThrow();
  });
});
