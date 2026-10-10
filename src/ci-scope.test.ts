/**
 * Tests for #1533 — DevCycle 2 — CI runs only the jobs a PR's changes need.
 *
 * `.github/scripts/ci-scope.mjs` maps changed files to job flags; ci.yml runs each job (and the
 * build job's test steps) on its flag. The workflow itself always runs, because the merge gate and
 * the review chain wait for a successful CI run on the head commit.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { areaOf, scope, FLAGS } from '../.github/scripts/ci-scope.mjs';

/** Just the flags, without the log line. */
const flags = (files: string[], o?: { push?: boolean }) => {
  const { reason: _reason, ...rest } = scope(files, o);
  return rest;
};
const none = { game: false, artificer: false, engines: false, wiki: false, dev: false };
const all = { game: true, artificer: true, engines: true, wiki: true, dev: true };

describe('CI scope (#1533)', () => {
  it('runs only the Artificer checks for an Artificer-only change', () => {
    expect(flags(['src/artificer/region1.ts', 'src/artificer-app/main.ts', 'src/artificer-ai/observe.ts', 'src/artificer/content/concepts.json', 'artificer.html', 'tests/artificer-talents.spec.ts', 'scripts/ai-play.ts']))
      .toEqual({ ...none, artificer: true });
  });

  it("runs the game's checks for the rest of src/ (which cover Artificer's tests too)", () => {
    expect(flags(['src/scenes/HomesteadScene.ts'])).toEqual({ ...none, game: true });
    expect(flags(['public/macro-world/recipes.json', 'index.html', 'tests/game.spec.ts', 'macro-world/races.json'])).toEqual({ ...none, game: true });
    // A helper Artificer imports from outside its folders is game code, and the game's checks run Artificer's.
    expect(flags(['src/crafting/planner.ts', 'src/artificer/focus.ts'])).toEqual({ ...none, game: true, artificer: true });
  });

  it("runs the engines and the game's checks for an engines change (src/ imports them)", () => {
    expect(flags(['mapgen/SettlementGenerator.ts'])).toEqual({ ...none, engines: true, game: true });
    expect(flags(['storytelling/tick.ts'])).toEqual({ ...none, engines: true, game: true });
  });

  it('runs only the site build for a wiki or dev change, Markdown content included', () => {
    expect(flags(['wiki/src/pages/index.astro', 'wiki/src/content/lore/frost.md'])).toEqual({ ...none, wiki: true });
    expect(flags(['dev/src/content/blog/post.md'])).toEqual({ ...none, dev: true });
  });

  it('runs no jobs for docs only', () => {
    expect(flags(['docs/content-inventory.md', 'CLAUDE.md', '.agents/review.md', 'docs/screens/discovery-toast-stack.png'])).toEqual(none);
    expect(scope(['README.md']).reason).toBe('docs only: no jobs run');
    // Markdown inside a code area belongs to it: code could import it as text.
    expect(areaOf('src/crafting/notes.md')).toBe('game');
    expect(areaOf('macro-world/setting-corewarden.md')).toBe('game');
  });

  it('runs everything for a file no area knows, for a push, and when no files were found', () => {
    for (const f of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', '.github/workflows/ci.yml', '.github/scripts/ci-scope.mjs', 'scripts/content-inventory.ts', 'vercel.json']) {
      expect(areaOf(f), f).toBeNull();
      expect(flags(['src/artificer/region1.ts', f]), f).toEqual(all);
    }
    expect(scope(['vite.config.ts']).reason).toContain('vite.config.ts');
    expect(flags(['src/artificer/region1.ts'], { push: true })).toEqual(all);
    expect(flags([])).toEqual(all);
  });

  it('wires every flag into ci.yml, and the workflow always runs', () => {
    const ci = readFileSync(join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('node .github/scripts/ci-scope.mjs');
    for (const f of FLAGS) expect(ci, f).toContain(`needs.scope.outputs.${f}`);
    // No workflow-level path filter: that would stop CI running, and the merge gate would wait forever.
    expect(ci).not.toMatch(/^\s+paths(-ignore)?:/m);
  });
});
