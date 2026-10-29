/**
 * Prints the save the UI re-measure (#1997) loads into the page: a day-14 run played the game's way,
 * with the day's plan queued, and the keys the page keeps its state under.
 *
 * The run is the nightly playtest's scripted player (src/artificer-ai/players/scripted.ts) in the
 * game's own world, with every rule switch at its default, as a new Warden in the app gets them
 * (controller.ts `makeWarden`). On the morning of day 14 the player is asked for its plan; the run
 * stops there, and the plan is applied as the runner applies one (focus, eating, places, site) and
 * queued, unrun, so PLAN shows the cards, the queue and its footer as a player would see them.
 *
 *   npx tsx scripts/artificer-ui-saves.ts [day] > saves.json
 *
 * Run with tsx, which can import the game's modules (Playwright's own loader can't import their JSON).
 */
import { enqueue, serialize, SAVE_KEY, type AppState } from '../src/artificer-app/controller';
import { GUIDE_KEY } from '../src/artificer-app/reveal';
import { LANG_KEY } from '../src/artificer-app/lang';
import { WEATHER_FOLD_KEY } from '../src/artificer-app/weather-fold';
import { ruleFeatures } from '../src/artificer/features';
import { parseFocus } from '../src/artificer/focus';
import { chooseSite, setEating, setFocus, type Region1State } from '../src/artificer/region1';
import { applyPinOrders, playRun, type Player } from '../src/artificer-ai/runner';
import { parseDecision, type Decision } from '../src/artificer-ai/decision';
import { scriptedPlayer } from '../src/artificer-ai/players/scripted';

const DAY = Number(process.argv[2] ?? 14);

/** Thrown from inside the run to stop it on the morning we want, with the state and the day's plan. */
class Morning extends Error {
  constructor(readonly s: Region1State, readonly plan: Decision) { super(`day ${s.day}`); }
}

const inner = scriptedPlayer();
const player: Player = {
  ...inner,
  async decide(message, s) {
    const r = await inner.decide(message, s);
    if (s.day < DAY) return r;
    const p = parseDecision(r.text);
    if (!p.ok) throw new Error(`day ${s.day}: the scripted plan didn't parse: ${p.errors.join('; ')}`);
    throw new Morning(s, p.decision);
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

// The plan's settings, as the runner applies them before the day's queue (runner.ts `playRun`).
const d = morning.plan;
let s = morning.s;
if (d.focus) s = setFocus(s, parseFocus(d.focus));
if (d.eating) s = setEating(s, d.eating);
s = applyPinOrders(s, d);
if (d.site && d.site !== s.site) s = chooseSite(s, d.site);

const st = d.queue.reduce(enqueue, { sim: s, queue: [], stage: 'reach' } as AppState);
// `enqueue` leaves the queue as it was for an item it refuses: a short queue would be a different page.
if (st.queue.length !== d.queue.length) throw new Error(`day ${DAY}: queued ${st.queue.length} of the plan's ${d.queue.length} tasks`);
process.stdout.write(JSON.stringify({
  keys: { save: SAVE_KEY, guide: GUIDE_KEY, lang: LANG_KEY, weatherFold: WEATHER_FOLD_KEY },
  day: s.day, queue: st.queue, save: serialize(st),
}));
