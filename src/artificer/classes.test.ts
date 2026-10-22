/**
 * Acceptance tests for #1637 — the Class registry (src/artificer/content/classes.json).
 *
 * The owner (2026-10-11): "fine to invent classes. We should have a class registry." WORLD.md names
 * Mistheim's Classes in square brackets ([Watermaster], [Reeve], [Grove-Warden]…). The registry is
 * the one list of them: who holds each, what kind it is, and where in canon it comes from, so new
 * lore can check for clashes and the game can read them. docs/class-registry.md explains it.
 *
 * Given WORLD.md and the registry:
 * - When WORLD.md names a [Class], then the registry has it (by name, plural or listed form).
 * - When an entry cites `WORLD.md § heading`, then that heading exists in WORLD.md.
 * - When an entry isn't named in WORLD.md, then it says when it was invented.
 * - No two entries answer to the same name, so a new Class can't quietly clash with an old one.
 * - Every holder is one of the 18 Peoples (content/peoples-lore.json) or a culture id
 *   (macro-world/cultures.json).
 * - Every story-engine class (storytelling/types.ts CharClass) is mapped to a registry entry or
 *   marked as engine-only, so the two lists can't drift apart unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLASSES, CLASS_KINDS, STORY_ENGINE_CLASSES, classByName, classFormsOf, worldClassNames } from './classes';
import peoplesFile from './content/peoples-lore.json';

const root = join(__dirname, '..', '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');
const WORLD = read('WORLD.md');

/** Every heading text in WORLD.md, any level. */
const HEADINGS = new Set(WORLD.split('\n').filter(l => /^#{1,6} /.test(l)).map(l => l.replace(/^#+ /, '').trim()));

describe('the Class registry (#1637)', () => {
  it('reads the bracketed Classes out of WORLD.md prose, line wraps and all', () => {
    const names = worldClassNames(WORLD);
    // A handful from across the file, the Wildkin section (#1606) included.
    for (const n of ['Watermaster', 'Reeve', 'Dikemaster', 'Boundary-Singer', 'Grove-Warden', 'Knight', 'Keepers']) {
      expect(names).toContain(n);
    }
    expect(names).toContain('Current-Reader');
    // A bracket wrapped across two lines is one name (the Merfolk's [Current-Reader] once was).
    expect(worldClassNames('[Current-\nReader] and [Golem\nGuardian]')).toEqual(['Current-Reader', 'Golem Guardian']);
    // Runescript's syntax placeholders sit in code blocks and aren't Classes.
    expect(names).not.toContain('VERB-RUNE');
    expect(names).not.toContain('condition');
    // "There are no [Classes] here" names the system, not a Class.
    expect(names).not.toContain('Classes');
  });

  it('has every [Class] WORLD.md names', () => {
    const missing = worldClassNames(WORLD).filter(n => !classByName(n));
    expect(missing).toEqual([]);
  });

  it("fails for a Class WORLD.md names that the registry lacks", () => {
    const names = worldClassNames(`${WORLD}\n\nA [Tollwright] keeps the bridge.\n`);
    expect(names.filter(n => !classByName(n))).toEqual(['Tollwright']);
  });

  it('cites a WORLD.md heading that exists, or a file that exists', () => {
    const bad: string[] = [];
    for (const c of CLASSES) {
      const m = /^WORLD\.md § (.+)$/.exec(c.source);
      if (m) { if (!HEADINGS.has(m[1])) bad.push(`${c.id}: no heading "${m[1]}"`); continue; }
      const file = c.source.split(' › ')[0].split(' § ')[0];
      if (!existsSync(join(root, file))) bad.push(`${c.id}: no file ${file}`);
    }
    expect(bad).toEqual([]);
  });

  it('dates an entry WORLD.md does not name as invented', () => {
    const named = new Set(worldClassNames(WORLD).map(n => classByName(n)?.id));
    const undated = CLASSES.filter(c => !named.has(c.id) && !c.invented).map(c => c.id);
    expect(undated).toEqual([]);
  });

  it('keeps ids and names unique, so a new Class cannot clash with an old one', () => {
    const ids = CLASSES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const c of CLASSES) {
      for (const f of classFormsOf(c)) {
        const key = f.toLowerCase();
        const other = seen.get(key);
        if (other && other !== c.id) clashes.push(`${f}: ${other} and ${c.id}`);
        seen.set(key, c.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('gives every entry a kind, holders that exist, and well-formed dates and links', () => {
    const peoples = new Set(peoplesFile.peoples.map(p => p.id));
    const cultures = new Set((JSON.parse(read('macro-world/cultures.json')) as { cultures: { id: string }[] }).cultures.map(k => k.id));
    const ids = new Set(CLASSES.map(c => c.id));
    const bad: string[] = [];
    for (const c of CLASSES) {
      if (!CLASS_KINDS.includes(c.kind)) bad.push(`${c.id}: kind ${c.kind}`);
      if (c.peoples.length === 0 && !c.widespread) bad.push(`${c.id}: no holders`);
      for (const p of c.peoples) if (!peoples.has(p)) bad.push(`${c.id}: no People ${p}`);
      for (const k of c.cultures ?? []) if (!cultures.has(k)) bad.push(`${c.id}: no culture ${k}`);
      if (c.variantOf && !ids.has(c.variantOf)) bad.push(`${c.id}: variant of unknown ${c.variantOf}`);
      for (const d of [c.invented, c.canonised]) if (d !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(d)) bad.push(`${c.id}: date ${d}`);
    }
    expect(bad).toEqual([]);
  });

  it("maps every story-engine class to a registry entry or marks it engine-only", () => {
    const src = read('storytelling/types.ts');
    const union = /export type CharClass =([^;]+);/.exec(src)?.[1] ?? '';
    const engine = [...union.matchAll(/"([a-z]+)"/g)].map(m => m[1]);
    expect(engine.length).toBeGreaterThan(0);
    expect(Object.keys(STORY_ENGINE_CLASSES).sort()).toEqual([...engine].sort());
    for (const [k, id] of Object.entries(STORY_ENGINE_CLASSES)) {
      if (id !== null) expect(CLASSES.some(c => c.id === id), `${k} → ${id}`).toBe(true);
    }
  });
});
