/**
 * Tells the Reach's history off the main thread (#1540).
 *
 * The history engine takes a second or more to live through 150 years, and on the page's own
 * thread that would freeze the game while it ran. A Web Worker runs on a thread of its own: the
 * page posts it a seed, it runs the history and posts the result back as plain data (workers
 * can't share objects with the page, only copy them). Vite bundles this file and everything it
 * imports, the engine included, into a separate script, so the page's own bundle stays small.
 */

import { runHistory } from '../artificer/world/history';

self.onmessage = (e: MessageEvent<{ seed: number }>) => {
  self.postMessage(runHistory(e.data.seed));
};
