/**
 * Prints a save (artificer-app/controller.ts `serialize`) for a run that has learned to plan, with
 * a few tasks queued, and the keys the page keeps the save and the guide under: what
 * artificer-side-queue.spec.ts loads into the page. Run with tsx, which can import the game's
 * modules (Playwright's own loader can't import their JSON).
 */
import { enqueue, makeWarden, serialize, SAVE_KEY, type AppState } from '../../src/artificer-app/controller';
import { GUIDE_KEY } from '../../src/artificer-app/reveal';
import { runAction, type QueueItem } from '../../src/artificer/region1';

const a = makeWarden({ id: 'w-side-queue' });
let s = runAction(a.sim, 'scout');
s = runAction(s, 'survey');
const st: AppState = { ...a, sim: { ...s, canPlan: true } };
process.stdout.write(JSON.stringify({ saveKey: SAVE_KEY, guideKey: GUIDE_KEY, save: serialize((['water', 'wood', 'gather', 'rest'] as QueueItem[]).reduce(enqueue, st)) }));
