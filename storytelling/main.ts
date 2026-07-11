// main.ts — entry point. Build the seed world, tick it N years, sift the log,
// and print a dated chronicle. The whole prototype's question is answered here:
// does the texture of the simulated history *read* like history?
//
//   npx tsx main.ts --years 200 --seed 42

import { readFileSync } from "node:fs";
import { extractArcs } from "./arcs.js";
import { magicInit } from "./magic.js";
import { generatePrehistory } from "./prehistory.js";
import { saveRun } from "./persist.js";
import { renderChronicle, renderEpilogue, renderLayeredChronicle } from "./render.js";
import { loadWorld } from "./seed.js";
import { sift } from "./sifter.js";
import { tick } from "./tick.js";
import { DEFAULT_SPEC, type WorldSpec } from "./world-spec.js";
import { FRONTIER_SPEC } from "./worlds/frontier.js";

// Built-in named worlds. `--world <name>` picks one; --spec <file> overrides.
const WORLDS: Record<string, WorldSpec> = {
  default: DEFAULT_SPEC,
  frontier: FRONTIER_SPEC,
};

// Bump when the sim's behaviour changes, so saved runs record what produced them.
const STORY_VERSION = "0.2";

interface Args {
  years: number;
  seed: number;
  threshold: number;
  verbose: boolean;
  magic: boolean;
  save: boolean;
  arcs: boolean;
  spec: string | null; // path to a WorldSpec JSON; overrides --world
  world: string; // a built-in named world (see WORLDS)
  flat: boolean; // flat chronicle (no temporal level-of-detail)
  living: number | undefined; // living-memory window (years)
  chronicle: number | undefined; // chronicle window (years)
  prehistory: boolean; // generate a mythic deep past before the sim
  prehistorySpan: number; // years of prehistory to reach back over
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    years: 200,
    seed: 42,
    threshold: 4,
    verbose: false,
    magic: false,
    save: false,
    arcs: false,
    spec: null,
    world: "default",
    flat: false,
    living: undefined,
    chronicle: undefined,
    prehistory: false,
    prehistorySpan: 800,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--years") args.years = parseInt(argv[++i], 10);
    else if (a === "--seed") args.seed = parseInt(argv[++i], 10);
    else if (a === "--threshold") args.threshold = parseInt(argv[++i], 10);
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--magic") args.magic = true;
    else if (a === "--save") args.save = true;
    else if (a === "--arcs") args.arcs = true;
    else if (a === "--spec") args.spec = argv[++i];
    else if (a === "--world") args.world = argv[++i];
    else if (a === "--flat") args.flat = true;
    else if (a === "--living") args.living = parseInt(argv[++i], 10);
    else if (a === "--chronicle") args.chronicle = parseInt(argv[++i], 10);
    else if (a === "--prehistory") {
      args.prehistory = true;
      const n = parseInt(argv[i + 1], 10); // optional span follows the flag
      if (!Number.isNaN(n)) {
        args.prehistorySpan = n;
        i++;
      }
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // Pick the world: an external JSON via --spec, a built-in named world via
  // --world, or the default tableau. (buildWorld === loadWorld(DEFAULT_SPEC).)
  const spec: WorldSpec = args.spec
    ? (JSON.parse(readFileSync(args.spec, "utf8")) as WorldSpec)
    : (WORLDS[args.world] ?? DEFAULT_SPEC);
  const world = loadWorld(spec, args.seed);

  // Opt into the magic / leveling layer. Off by default so the base chronicle
  // is unchanged; `--magic` turns on classes, levels, inherited capital, the
  // comfort governor, and lost arts.
  if (args.magic) {
    world.magicEnabled = true;
    magicInit(world);
  }

  // Optional deep past: manufacture a mythic prehistory (a golden age, a
  // cataclysm, lost arts, migrations) and leave residue — ancestral grudges —
  // in the starting world, so the present begins already freighted with history.
  if (args.prehistory) {
    generatePrehistory(world, args.prehistorySpan);
  }

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
    `seed ${args.seed} · ${args.years} years (${chronicle[0]?.year ?? "?"}–${world.year}) · ${chronicle.length} events worth telling${args.magic ? " · magic: on" : ""}${args.spec ? ` · world: ${args.spec.split("/").pop()}` : args.world !== "default" ? ` · world: ${args.world}` : ""}`,
  );
  console.log("═".repeat(64));

  // Group the significant events into story arcs (threads) — needed both for the
  // temporal level-of-detail renderer and for --arcs / --save.
  const arcs = extractArcs(world, chronicle);

  // Default view: a cone of detail (legend → chronicle → living memory), so
  // history reads sparse-and-mythic long ago, dense-and-detailed near the
  // present. --flat prints the old year-by-year chronicle instead.
  if (args.flat) {
    console.log(renderChronicle(world, chronicle));
  } else {
    console.log(
      renderLayeredChronicle(world, chronicle, arcs, {
        living: args.living,
        chronicle: args.chronicle,
      }),
    );
  }
  console.log(renderEpilogue(world));

  if (args.arcs) {
    console.log("\n" + "═".repeat(64));
    console.log("STORY ARCS (threads, biggest first)");
    console.log("─".repeat(64));
    for (const a of arcs.slice(0, 20)) {
      console.log(`  [${String(a.significance).padStart(3)}] ${a.title}  ·  ${a.eventIds.length} events`);
    }
    console.log(`(${arcs.length} arcs total)`);
  }

  if (args.save) {
    const dir = saveRun(
      world,
      { seed: args.seed, years: args.years, magic: args.magic, version: STORY_VERSION },
      arcs,
    );
    console.log(`\nSaved run to ${dir}/ (events.ndjson + meta.json).`);
  }

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
