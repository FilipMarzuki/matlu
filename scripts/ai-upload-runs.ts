/**
 * Upload the AI playtest's games to the run records (#1558), so the Records page and the dev site's
 * AI page show them beside people's games.
 *
 *   npm run ai:upload -- --in ai-runs/nightly          # upload every model game in the folder
 *   npm run ai:upload -- --in ai-runs/nightly --dry    # print what would go up, upload nothing
 *
 * Only models' games go up (players `openrouter:…` and `claude:…`), and only finished ones: the
 * random and scripted baselines, and games the budget stopped mid-run, stay out. Each record is
 * keyed by a hash of its transcript, so running this twice on the same folder adds nothing new.
 *
 * Records carry the game version of this checkout (session.ts GAME_VERSION): run it in the same
 * checkout that played the games, as the nightly workflow does.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Without them it says so and uploads nothing,
 * but doesn't fail, so a playtest without those secrets still finishes.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseStore } from '../src/artificer-play/supabase-store';
import { isModelGame, runOfTranscript } from '../src/artificer-play/record-of';
import { outcomeLine } from '../src/artificer-play/records';
import { GAME_VERSION } from '../src/artificer-play/session';
import type { Transcript } from '../src/artificer-ai/report';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dir = flag('in') ?? 'ai-runs/nightly';
const dry = args.includes('--dry');

const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
const store = !dry && url && key ? supabaseStore(url, key) : null;
if (!dry && !store) {
  console.log('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set: no runs uploaded.');
  process.exit(0);
}

let uploaded = 0, already = 0, skipped = 0, failed = 0;
// The baselines' files (ai-play.ts names them <time>-random-…, <time>-scripted-…) are skipped by
// name: the nightly writes hundreds of them, and there's no point reading them to throw them away.
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
const baselines = files.filter(f => /-(random|scripted)-/.test(f));
skipped += baselines.length;
for (const file of files.filter(f => !baselines.includes(f)).sort()) {
  const raw = readFileSync(join(dir, file), 'utf8');
  let t: Transcript;
  try {
    t = JSON.parse(raw) as Transcript;
  } catch {
    skipped++;
    continue;
  }
  // Not a transcript (a report's data, say), a baseline, or a game that didn't finish.
  if (!t || typeof t.player !== 'string' || !Array.isArray(t.turns) || !isModelGame(t)) { skipped++; continue; }
  const run = runOfTranscript(t, { gameVersion: GAME_VERSION });
  if (!run) { skipped++; continue; }
  const source = `bench:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
  const line = `${run.model} · ${outcomeLine(run)} · ready ${run.readyDay ?? '—'} · ${run.costUsd === null ? 'cost ?' : `$${run.costUsd.toFixed(3)}`}`;
  if (dry) {
    console.log(`would upload ${file}: ${line}`);
    uploaded++;
    continue;
  }
  try {
    if (await store!.insertRun(source, run)) {
      console.log(`uploaded ${file}: ${line}`);
      uploaded++;
    } else {
      already++; // uploaded before: the same transcript, the same key
    }
  } catch (e) {
    // One bad record shouldn't stop the rest; the job shows the count at the end.
    console.error(`failed ${file}: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

console.log(`${dry ? 'Would upload' : 'Uploaded'} ${uploaded} run${uploaded === 1 ? '' : 's'} (game version ${GAME_VERSION}); ${already ? `${already} already there; ` : ''}skipped ${skipped}${failed ? `; ${failed} failed` : ''}.`);
if (failed) process.exitCode = 1;
