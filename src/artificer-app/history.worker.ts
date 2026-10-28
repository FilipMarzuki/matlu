/**
 * Tells the Reach's history off the main thread (#1540), and the wider world's beside it (#1906).
 *
 * The history engine takes a second or more to live through 150 years, and on the page's own
 * thread that would freeze the game while it ran. A Web Worker runs on a thread of its own: the
 * page posts it a seed, it runs the history and posts the result back as plain data (workers
 * can't share objects with the page, only copy them). Vite bundles this file and everything it
 * imports, the engine included, into a separate script, so the page's own bundle stays small.
 */

import { runHistory, HISTORY_YEARS } from '../artificer/world/history';
import { runOuterHistory } from '../artificer/world/outer-history';
import type { WorldOpts } from '../artificer/world/provinces';

self.onmessage = (e: MessageEvent<{ seed: number; outer?: boolean } & WorldOpts>) => {
  const { seed, roadAnchors, outer } = e.data;
  self.postMessage(outer ? runOuterHistory(seed, HISTORY_YEARS, { roadAnchors }) : runHistory(seed, HISTORY_YEARS, { roadAnchors }));
};
