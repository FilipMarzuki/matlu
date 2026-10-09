/**
 * Acceptance tests for #1483 — the paid reviewers see the changed files in full, not only the diff.
 * Their verdicts gate medium- and high-risk merges (#1481), so a finding that comes from missing
 * context ("this output is never set" — it is, outside the diff) would hold a PR for nothing.
 */

import { describe, it, expect } from 'vitest';
import { skipReason, contextSection, FILE_CAP_BYTES } from '../.github/scripts/review-context.mjs';

const sha = 'c0243029abcdef';

describe('Changed files in full for the paid reviewers (#1483)', () => {
  // 1. A PR changing a workflow and a script: both attached in full at the head commit, after the diff.
  it('attaches every changed text file in full at the head commit', () => {
    const files = [
      { filename: '.github/workflows/auto-merge.yml', status: 'modified' },
      { filename: '.github/scripts/risk-score.mjs', status: 'modified' },
    ];
    expect(files.map(skipReason)).toEqual([null, null]);
    const text = contextSection(sha, [
      { path: '.github/workflows/auto-merge.yml', text: 'name: DevCycle 4 — Merge\n' },
      { path: '.github/scripts/risk-score.mjs', text: "fs.appendFileSync(process.env.GITHUB_OUTPUT, `head_sha=${headSha}\\n`);\n" },
    ]);
    expect(text).toMatch(/^## Changed files in full, at c024302/);
    expect(text).toContain('### .github/workflows/auto-merge.yml\n\n```yaml\nname: DevCycle 4 — Merge\n');
    expect(text).toContain('### .github/scripts/risk-score.mjs\n\n```js\n');
    expect(text).toContain('head_sha=${headSha}');
  });

  // 2. A file over the cap, a lockfile or a binary: named as left out, with the reason.
  it('names what it leaves out, and why', () => {
    expect(skipReason({ filename: 'package-lock.json', status: 'modified' })).toBe('lockfile');
    expect(skipReason({ filename: 'public/assets/sprites/fox/idle.png', status: 'added' })).toBe('binary');
    expect(skipReason({ filename: 'public/assets/sprite-manifest.json', status: 'modified' })).toBe('generated');
    const big = 'x'.repeat(FILE_CAP_BYTES + 1);
    const text = contextSection(sha, [
      { path: 'package-lock.json', skip: 'lockfile' },
      { path: 'src/huge.ts', text: big },
      { path: 'src/small.ts', text: 'export const a = 1;\n' },
    ]);
    expect(text).toContain('- `package-lock.json` — lockfile');
    expect(text).toMatch(/- `src\/huge\.ts` — \d+ KB, over the \d+ KB cap per file/);
    expect(text).not.toContain(big);
    expect(text).toContain('### src/small.ts');
    // The total cap: once it's spent, the rest are named instead of attached.
    const capped = contextSection(sha, [{ path: 'a.ts', text: 'aaaa' }, { path: 'b.ts', text: 'bbbb' }], { fileCap: 10, totalCap: 6 });
    expect(capped).toContain('### a.ts');
    expect(capped).toMatch(/- `b\.ts` — over the \d+ KB total for files in full/);
  });

  // 3. A removed file: only its diff.
  it('shows a removed file only in the diff', () => {
    expect(skipReason({ filename: 'macro-world/concepts.json', status: 'removed' })).toMatch(/^removed/);
  });

  it('fences a file that contains a fence', () => {
    const text = contextSection(sha, [{ path: 'docs/x.md', text: 'Run:\n```bash\nnpm test\n```\n' }]);
    expect(text).toContain('### docs/x.md\n\n````md\nRun:\n```bash');
    expect(text).toContain('```\n````');
  });

  it('adds nothing when no file changed', () => {
    expect(contextSection(sha, [])).toBe('');
  });
});
