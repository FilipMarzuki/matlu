/**
 * Prints a save (artificer-app/controller.ts `serialize`) for Make camp's picker browser test
 * (#1986): a Warden who has scouted, surveyed and explored a little way out over two days, has
 * learned to plan and knows at least two places to camp, with nothing queued. Also the keys the page keeps the save and the guide
 * under. Run with tsx, which can import the game's modules (Playwright's own loader can't import
 * their JSON).
 */
import { makeWarden, serialize, SAVE_KEY, type AppState } from '../../src/artificer-app/controller';
import { GUIDE_KEY } from '../../src/artificer-app/reveal';
import { knownSpots } from '../../src/artificer/camp-sites';
import { endDay, runAction, type QueueItem } from '../../src/artificer/region1';

const a = makeWarden({ id: 'w-camp-picker' });
let s = a.sim;
// Close by, then a little further out (the second ring): the nights come as the days fill.
for (const q of ['scout', 'survey', 'explore', 'scout', 'explore', 'scout@2', 'explore@2'] as QueueItem[]) {
  s = runAction(s, q);
  if (s.hoursToday >= 12) s = endDay(s);
}
const st: AppState = { ...a, sim: { ...s, canPlan: true } };
// The picker has to have a choice in it, or the screenshots don't show what the issue asks for.
const spots = knownSpots(st.sim);
if (spots.length < 2) throw new Error(`only ${spots.length} place(s) to camp known`);
process.stdout.write(JSON.stringify({ saveKey: SAVE_KEY, guideKey: GUIDE_KEY, save: serialize(st), spots: spots.map(p => p.id) }));
