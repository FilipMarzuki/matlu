// main.ts — entry point. Build the seed world, tick it N years, sift the log,
// and print a dated chronicle. The whole prototype's question is answered here:
// does the texture of the simulated history *read* like history?
//
//   npx tsx main.ts --years 200 --seed 42

import { renderChronicle, renderEpilogue } from "./render.js";
import { buildWorld } from "./seed.js";
import { sift } from "./sifter.js";
import { tick } from "./tick.js";

interface Args {
  years: number;
  seed: number;
  threshold: number;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { years: 200, seed: 42, threshold: 4, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--years") args.years = parseInt(argv[++i], 10);
    else if (a === "--seed") args.seed = parseInt(argv[++i], 10);
    else if (a === "--threshold") args.threshold = parseInt(argv[++i], 10);
    else if (a === "--verbose") args.verbose = true;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const world = buildWorld(args.seed);

  // Run the simulation. Nothing is rendered during the loop — we simulate
  // first, then sift, exactly as the brief insists: the LLM (or stub) never
  // holds canon, it only renders the log after the fact.
  for (let y = 0; y < args.years; y++) {
    tick(world);
  }

  const { chronicle } = sift(world, args.threshold);

  // Header.
  console.log("═".repeat(64));
  console.log("A CHRONICLE OF THE MATLU MULTIWORLD");
  console.log(
    `seed ${args.seed} · ${args.years} years (${chronicle[0]?.year ?? "?"}–${world.year}) · ${chronicle.length} events worth telling`,
  );
  console.log("═".repeat(64));

  console.log(renderChronicle(world, chronicle));
  console.log(renderEpilogue(world));

  if (args.verbose) {
    // Raw event-type tally to gauge the simulation's behaviour at a glance.
    const counts = new Map<string, number>();
    for (const ev of world.events) counts.set(ev.type, (counts.get(ev.type) ?? 0) + 1);
    console.log("\n" + "─".repeat(64));
    console.log("EVENT TALLY (all events, not just chronicled):");
    for (const [type, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type.padEnd(20)} ${n}`);
    }
  }
}

main();
