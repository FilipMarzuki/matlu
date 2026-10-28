/**
 * Prints a save (artificer-app/controller.ts `serialize`) for the day card's browser test (#1929):
 * a camp in the cave that has learned to plan, more raw food than a warm autumn night keeps, and
 * a short day queued, so the night that follows spoils some (the card's "anything spoiled"). Also
 * the keys the page keeps the save and the guide under. Run with tsx, which can import the game's
 * modules (Playwright's own loader can't import their JSON).
 */
import { enqueue, makeWarden, runQueuedDay, serialize, SAVE_KEY, type AppState } from '../../src/artificer-app/controller';
import { GUIDE_KEY } from '../../src/artificer-app/reveal';
import { chooseSite, runAction, type QueueItem } from '../../src/artificer/region1';

const a = makeWarden({ id: 'w-day-card' });
let s = runAction(a.sim, 'scout');
s = runAction(s, 'survey');
s = chooseSite(s, 'cave');
s = { ...s, canPlan: true, stores: { ...s.stores, rawFood: s.stores.rawFood + 14, water: s.stores.water + 4, firewood: s.stores.firewood + 10 } };
const st: AppState = (['water', 'wood', 'gather'] as QueueItem[]).reduce(enqueue, { ...a, sim: s });
// The night after this day must spoil food, or the screenshots don't show what the issue asks for.
const night = runQueuedDay(st).sim.log.slice(s.log.length).map(l => l.text);
if (!night.some(l => /went bad/.test(l))) throw new Error(`no spoilage the night after: ${night.join(' | ')}`);
process.stdout.write(JSON.stringify({ saveKey: SAVE_KEY, guideKey: GUIDE_KEY, save: serialize(st) }));
