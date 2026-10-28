/**
 * Prints two saves (artificer-app/controller.ts `serialize`) for the "where the day ends" browser
 * test (#1930), and the line the game's own code says for each, in English and Swedish:
 *
 * - `camp`: a day that ends back at camp in daylight (water and wood close by);
 * - `over`: a day over budget, more than the 14 waking hours, so it ends after dark (and its last
 *   task waits for tomorrow).
 *
 * Both from one run played the game's way: a Warden of 12 with INT 12 chosen (10 at that age), who
 * scouted, made camp at the first place found, and fetched wood and water three times each (enough,
 * at INT 10, to know both close by, so `forecasts` shows the numbers and the day forecast is open),
 * then slept. Also the keys the page keeps the save and the guide under. Run with tsx, which can
 * import the game's modules (Playwright's own loader can't import their JSON).
 */
import { enqueue, makeWarden, previewQueue, serialize, SAVE_KEY, type AppState } from '../../src/artificer-app/controller';
import { GUIDE_KEY } from '../../src/artificer-app/reveal';
import { dayEnd, dayEndText } from '../../src/artificer-app/day-forecast';
import { knownSpots } from '../../src/artificer/camp-sites';
import { makeT } from '../../src/artificer/i18n';
import { endDay, runAction, type QueueItem } from '../../src/artificer/region1';
import { DEFAULT_STATS } from '../../src/artificer/stats';

const a = makeWarden({ id: 'w-day-forecast', stats: { ...DEFAULT_STATS, int: 12 } });
let s = a.sim;
const step = (q: QueueItem): void => { s = runAction(s, q); if (s.hoursToday >= 11) s = endDay(s); };
for (const q of ['scout', 'survey', 'explore'] as QueueItem[]) step(q);
step({ q: 'camp', opts: { spot: knownSpots(s)[0].id } });
for (const q of ['wood', 'water', 'wood', 'water', 'wood', 'water'] as QueueItem[]) step(q);
if (s.hoursToday > 0) s = endDay(s);

function saved(queue: QueueItem[]): { save: string; en: string; sv: string } {
  const st = queue.reduce(enqueue, { ...a, sim: { ...s, canPlan: true } } as AppState);
  const p = previewQueue(st);
  const say = (lang: 'en' | 'sv'): string => {
    const t = makeT(lang);
    const e = dayEnd(st, p, true, t);
    if (!e) throw new Error(`no line for ${queue.join(', ')}`);
    return dayEndText(e, t);
  };
  return { save: serialize(st), en: say('en'), sv: say('sv') };
}

const camp = saved(['water', 'wood']);
const over = saved(['wood', 'water', 'wood', 'wood', 'water']);
// The screenshots have to show what the issue asks for, or they prove nothing.
if (!camp.en.startsWith('Back at camp') || /after dark/.test(camp.en)) throw new Error(`not back at camp in daylight: ${camp.en}`);
if (!over.en.startsWith('Back at camp after dark')) throw new Error(`not over budget: ${over.en}`);
process.stdout.write(JSON.stringify({ saveKey: SAVE_KEY, guideKey: GUIDE_KEY, camp, over }));
