/**
 * The "Play with your AI" page (#1556): how to add the Artificer's MCP server to an AI. The page
 * itself is static HTML (play-with-ai.html); this only styles it, wires the copy button, and
 * counts the visit the same way the game does (#1565).
 */

import './style.css';
import './play-with-ai.css';
import { inject } from '@vercel/analytics';

// As in main.ts: only a production build on the real domain reports to Vercel Web Analytics.
if (import.meta.env.PROD && location.hostname === 'artificer.corewarden.app') inject();

const button = document.querySelector<HTMLButtonElement>('#copy');
const url = document.querySelector('#mcp-url')?.textContent ?? '';
button?.addEventListener('click', () => {
  // Some browsers and embedded views refuse clipboard access; then select the text instead, so a
  // long-press or Ctrl+C still works.
  navigator.clipboard?.writeText(url).then(
    () => { button.textContent = 'COPIED'; },
    () => selectUrl(),
  ) ?? selectUrl();
});

function selectUrl(): void {
  const el = document.querySelector('#mcp-url');
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}
