/**
 * Prints the saves the UI re-measure (#1997) loads into the page: a day-14 run played the game's
 * way, with the day's plan queued, and the keys the page keeps the save and the guide under.
 *
 * The run is the nightly playtest's scripted player (src/artificer-ai/players/scripted.ts) in the
 * game's own world, with every rule switch at its default, as a new Warden in the app gets them
 * (controller.ts `makeWarden`). On the morning of day 14 the player is asked for its plan, and that
 * plan is queued, unrun, so PLAN shows the cards, the queue and its footer as a player would see them.
 *
 *   npx tsx scripts/artificer-ui-saves.ts > saves.json
 *
 * Run with tsx, which can import the game's modules (Playwright's own loader can't import their JSON).
 */
import { enqueue, serialize, SAVE_KEY, type AppState } from '../src/artificer-app/controller';
import { GUIDE_KEY } from '../src/artificer-app/reveal';
import { ruleFeatures } from '../src/artificer/features';
import { queueId, type ActionId, type ActionOpts, type QueueItem, type Region1State } from '../src/artificer/region1';
import type { Ring } from '../src/artificer/exploration';
import { playRun, type Player } from '../src/artificer-ai/runner';
import { scriptedPlayer } from '../src/artificer-ai/players/scripted';

const DAY = Number(process.argv[2] ?? 14);

/** Thrown from inside the run to stop it on the morning we want, with the state and its plan. */
class Morning extends Error {
  constructor(readonly s: Region1State, readonly plan: QueueItem[]) { super(`day ${s.day}`); }
}

interface Entry { action: string; ring: number; options?: { key: string; value: string }[] }
const itemOf = (e: Entry): QueueItem => {
  const q = queueId(e.action as ActionId, e.ring as Ring);
  return e.options?.length ? { q, opts: Object.fromEntries(e.options.map(o => [o.key, o.value])) as ActionOpts } : q;
};

const inner = scriptedPlayer();
const player: Player = {
  ...inner,
  async decide(message, s) {
    const r = await inner.decide(message, s);
    if (s.day >= DAY) throw new Morning(s, (JSON.parse(r.text).queue as Entry[]).map(itemOf));
    return r;
  },
};

let morning: Morning | null = null;
try {
  await playRun(player, { features: ruleFeatures() });
} catch (e) {
  if (!(e instanceof Morning)) throw e;
  morning = e;
}
if (!morning) throw new Error(`the run ended before day ${DAY}`);
if (!morning.s.canPlan) throw new Error(`day ${DAY}: the Warden can't plan yet`);

const st = morning.plan.reduce(enqueue, { sim: morning.s, queue: [], stage: 'reach' } as AppState);
process.stdout.write(JSON.stringify({ saveKey: SAVE_KEY, guideKey: GUIDE_KEY, day: morning.s.day, queue: st.queue, save: serialize(st) }));
