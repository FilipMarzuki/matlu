/**
 * Acceptance tests for #1136 — Phaser-free TinkerTray, plus the
 * "no Phaser under src/crafting" criterion (6–8 in the issue).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { TinkerTray, TRAY_PROGRESS_CHANGED, TRAY_DISCOVERY, type TrayCombo } from './TinkerTray';
import { MemoryStore, RecordingEmitter } from './testDoubles';

const COMBOS: { craftingExamples: TrayCombo[] } = {
  craftingExamples: [
    {
      tray: ['material:lumber', 'concept:binding'],
      possibleResults: [{ type: 'recipe', id: 'plank', hint: 'Lumber could be split and bound.' }],
    },
  ],
};

describe('TinkerTray (#1136 acceptance)', () => {
  it('6. given a valid combo in the tray, ticking to 100% emits increasing progress and exactly one discovery', () => {
    const emitter = new RecordingEmitter();
    const tray = new TinkerTray({ emitter, store: new MemoryStore() });
    tray.loadCombos(COMBOS);
    // Slots 0–1 only: the high slots (2+) can produce false conclusions.
    tray.setSlot(0, 'material:lumber');
    tray.setSlot(1, 'concept:binding');
    emitter.calls.length = 0;

    for (let i = 0; i < 50 && emitter.argsFor(TRAY_DISCOVERY).length === 0; i++) tray.tick();

    const progress = emitter.argsFor(TRAY_PROGRESS_CHANGED).map(a => a[0] as number);
    expect(progress.length).toBeGreaterThan(1);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThan(progress[i - 1]);
    expect(progress.at(-1)).toBe(1);

    const discoveries = emitter.argsFor(TRAY_DISCOVERY);
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0][0]).toMatchObject({ id: 'plank', isFalse: false });
  });

  it('7. given a tray with progress saved to a store, a new TinkerTray on that store has the same slots and progress', () => {
    const store = new MemoryStore();
    const tray = new TinkerTray({ emitter: new RecordingEmitter(), store });
    tray.setSlot(0, 'material:lumber');
    tray.setSlot(1, 'concept:binding');
    tray.tick();
    tray.tick();

    const reloaded = new TinkerTray({ emitter: new RecordingEmitter(), store });
    expect(reloaded.slots).toEqual(tray.slots);
    expect(reloaded.progress).toBeCloseTo(tray.progress);
    expect(reloaded.progress).toBeGreaterThan(0);
  });
});

describe('src/crafting (#1136 acceptance)', () => {
  it('8. no file under src/crafting imports phaser', () => {
    const dir = __dirname;
    const offenders = readdirSync(dir)
      .filter(f => f.endsWith('.ts'))
      .filter(f => /from\s+['"]phaser['"]|require\(\s*['"]phaser['"]\s*\)/.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
