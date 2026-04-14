#!/usr/bin/env node
// Shared Mermaid → PNG renderer.
// Used by generate-diagrams.js (FIL-204) and the roadmap-update agent (FIL-205).
//
// Programmatic:  import { renderDiagram } from './lib/mermaid-render.js'
//                const pngPath = renderDiagram('my-diagram', mmdString);
//
// CLI:           node mermaid-render.js <id> <path/to/file.mmd>
//                → prints the output png path to stdout on success
//                → exits 1 on failure

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const TMP_DIR = '/tmp/diagrams';

/**
 * Renders a Mermaid diagram string to a PNG file.
 *
 * @param {string} id         - Short identifier used as the filename stem (e.g. 'pipeline')
 * @param {string} mmdContent - Full Mermaid diagram source
 * @returns {string|null}     - Absolute path to the rendered PNG, or null on failure
 */
export function renderDiagram(id, mmdContent) {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const mmdPath = path.join(TMP_DIR, `${id}.mmd`);
  const pngPath = path.join(TMP_DIR, `${id}.png`);

  // Puppeteer needs --no-sandbox in CI (GitHub Actions has no user namespace isolation)
  const puppeteerCfg = path.join(TMP_DIR, 'puppeteer.json');
  fs.writeFileSync(puppeteerCfg, JSON.stringify({ args: ['--no-sandbox', '--disable-setuid-sandbox'] }));

  fs.writeFileSync(mmdPath, mmdContent, 'utf8');

  try {
    // Pin to @mermaid-js/mermaid-cli@10 — the last major release that supports
    // Node 20 and the --width flag. v11+ dropped --width and requires Node ≥22.
    execSync(
      `npx --yes @mermaid-js/mermaid-cli@10 mmdc -i "${mmdPath}" -o "${pngPath}" -b white --width 1400 --puppeteerConfigFile "${puppeteerCfg}"`,
      { stdio: 'inherit', timeout: 120_000 }
    );
    return pngPath;
  } catch (e) {
    console.warn(`renderDiagram(${id}) failed: ${e.message}`);
    return null;
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────────

// Only run when invoked directly (not when imported as a module)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, mmdFile] = process.argv.slice(2);
  if (!id || !mmdFile) {
    console.error('Usage: node mermaid-render.js <id> <file.mmd>');
    process.exit(1);
  }
  const content = fs.readFileSync(mmdFile, 'utf8');
  const png = renderDiagram(id, content);
  if (!png) process.exit(1);
  console.log(png); // caller captures this with $(node mermaid-render.js ...)
}
