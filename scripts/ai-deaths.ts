/**
 * What kills the baselines (#1852): the scripted and random players over 20 seeds with today's
 * default rules, then with each recent rule switch off in turn. Local players only, no API.
 *
 *   npx tsx scripts/ai-deaths.ts [--seeds 20] [--player scripted|random] [--off id,id] [--rows]
 */

import { ruleFeatures } from '../src/artificer/features';
import { deathRows, summarize, summaryRow, SUMMARY_HEAD, BASELINES } from '../src/artificer-ai/deaths';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const seeds = Number(flag('seeds') ?? 20);
const players = (flag('player') ?? Object.keys(BASELINES).join(',')).split(',');
/** The rule switches that came this month, each turned off alone. */
const RECENT = (flag('off') ?? 'thermal-model,camp-as-action,stone-gathering,hunting-gear,stop-action,built-warmth,camp-builds-per-site,cold-pit-slows,map-learning,pack-extras,action-visibility').split(',').filter(id => id in ruleFeatures());

async function main(): Promise<void> {
  for (const p of players) {
    console.log(`\n### ${p}\n\n${SUMMARY_HEAD}`);
    for (const off of ['', ...RECENT]) {
      const rows = await deathRows(p, seeds, ruleFeatures(off ? { [off]: false } : {}));
      console.log(summaryRow(off ? `${off} off` : 'defaults', summarize(rows)));
      if (args.includes('--rows')) for (const r of rows) console.log(`    s${r.seed}: ${r.cause} day ${r.day} (hungry ${r.hungry}, thirsty ${r.thirsty}, cold ${r.cold})`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
