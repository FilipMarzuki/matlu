/**
 * The session format's version. A stored game from another version doesn't load (it starts over
 * rather than misreading), and every run record carries it so results compare like with like.
 * Bump it with the app's SAVE_VERSION or when the meaning of a move changes.
 *
 * Its own file (session.ts re-exports it) so the web page can stamp a run's log with it (#1559,
 * web-log.ts) without bundling the session core and the AI's text views it would never use.
 */

import { SAVE_VERSION } from '../artificer-app/controller';

export const GAME_VERSION = `play-1/save-${SAVE_VERSION}`;
