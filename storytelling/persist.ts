// persist.ts — save a run to disk as the canonical event log + a meta file.
//
// Because the sim is deterministic, the seed alone reproduces a run; but
// materialising the event log lets us query/render a story without re-running.
// We write the canon (events) as NDJSON — one WorldEvent per line, append-
// friendly and diffable, so you can SEE how a code change altered history — plus
// a small meta.json with the inputs, a summary, and the extracted arcs.
//
// This is the file-based store for the prototype. The same shape maps 1:1 onto
// a Supabase schema later (story_runs + story_events, data as jsonb) for serving
// stories and feeding the nightly Claude batch renderer.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Arc } from "./arcs.js";
import type { World } from "./world.js";

export interface RunMeta {
  seed: number;
  years: number;
  magic: boolean;
  ether?: boolean;
  version: string;
}

// Returns the directory written, for the CLI to report.
export function saveRun(w: World, meta: RunMeta, arcs: Arc[]): string {
  const dir = join(
    "storytelling",
    "runs",
    `seed${meta.seed}-y${meta.years}${meta.magic ? "-magic" : ""}${meta.ether ? "-ether" : ""}`,
  );
  mkdirSync(dir, { recursive: true });

  // events.ndjson — the canon. One event per line; the file IS the story.
  const ndjson = w.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(dir, "events.ndjson"), ndjson);

  // meta.json — inputs + a derived summary + the arc index (titles only; the
  // arcs themselves are just views over events.ndjson via their eventIds).
  const kingdoms: Record<string, string> = {};
  for (const t of w.titles.values()) {
    if (t.tier !== "kingdom") continue;
    const h = w.char(t.holderId);
    kingdoms[t.name] = h ? `${h.name} of ${w.dynasty(h.dynastyId)?.name ?? "?"}` : "vacant";
  }
  const survivingHouses = [...new Set(
    [...w.dynasties.values()]
      .filter((dy) => dy.extinctYear === null && w.dynastyMembers(dy.id).length > 0)
      .map((dy) => dy.name),
  )];

  const metaOut = {
    ...meta,
    savedAt: new Date().toISOString(),
    finalYear: w.year,
    eventCount: w.events.length,
    characterCount: w.characters.size,
    dynastyCount: w.dynasties.size,
    kingdoms,
    survivingHouses,
    arcs: arcs.map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      startYear: a.startYear,
      endYear: a.endYear,
      eventCount: a.eventIds.length,
      eventIds: a.eventIds,
      significance: a.significance,
    })),
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(metaOut, null, 2));

  return dir;
}
