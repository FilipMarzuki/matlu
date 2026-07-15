// event-spec.ts — the scalable event catalog.
//
// The engine already has TWO proven data-driven event catalogs:
//   • CatastropheTemplate (catastrophe.ts) — 8 rows of exogenous shock chains
//   • ChallengeKindSpec  (challenges.ts)   — 10 rows of hero-attemptable trials
//
// EventSpec is the same idea generalised to ALL simple state-conditional
// events. Adding a new event becomes ONE record in ONE file that carries:
//   • its base sifter score + optional context bonus
//   • its render prose
//   • its arc grouping
//   • its trigger (reactive to another event, or ambient scan of the world)
//
// This is BACKWARD-COMPATIBLE with the existing hand-written events. sifter,
// render, and arcs check SPEC_REGISTRY first; if there's no spec they fall
// back to the existing switch/BASE table. Existing 89 events keep working.
//
// Once the pattern is proven, the hand-written events can migrate to specs
// incrementally with no behaviour change — but that's not in this commit.

import type {
  ArcKind,
  Character,
  Dynasty,
  EventType,
  Province,
  Title,
  WorldEvent,
} from "./types.js";
import type { World } from "./world.js";

// A single spec describes ONE event type end-to-end.
export interface EventSpec {
  type: EventType;                                    // union member
  base: number;                                       // sifter BASE score
  scoreBoost?: (ev: WorldEvent, w: World) => number;  // additive contextual bonus
  render: (ev: WorldEvent, w: World) => string;       // chronicle prose
  arc?: (ev: WorldEvent) => { key: string; kind: ArcKind } | null;
  // Trigger — set one of onEvent or ambient (or neither for "fired manually").
  onEvent?: OnEventSpec;
  ambient?: AmbientSpec;
}

// Reactive trigger: after event X of a certain type fires this year, roll to
// spawn our event in response. Handler receives the source event.
export interface OnEventSpec {
  source: EventType;
  prob: (w: World, e: WorldEvent) => number;
  fire: (w: World, e: WorldEvent) => void;
}

// Ambient trigger: scan a collection (chars/provinces/titles/dynasties) each
// tick, gate by predicate, prob-roll, fire.
export interface AmbientSpec {
  scan: "chars" | "provinces" | "titles" | "dynasties";
  gate: (w: World, item: AmbientItem) => boolean;
  prob: (w: World, item: AmbientItem) => number;
  fire: (w: World, item: AmbientItem) => void;
  // Dedupe policy — if set, we won't fire again per key.
  once?: "per-actor" | "per-province" | "world";
  // Optional max total firings per tick (default: 1). Set > 1 for e.g.
  // per-province checks that should be allowed to fire in several places.
  maxPerTick?: number;
}

export type AmbientItem = Character | Province | Title | Dynasty;

export const SPEC_REGISTRY = new Map<EventType, EventSpec>();

// Register a spec. Idempotent — later registrations of the same type replace.
export function registerSpec(s: EventSpec): void {
  SPEC_REGISTRY.set(s.type, s);
}

// Bulk register — convenient for domain files that export many specs.
export function registerSpecs(specs: EventSpec[]): void {
  for (const s of specs) registerSpec(s);
}

// ---------------------------------------------------------------------------
// Per-tick execution
// ---------------------------------------------------------------------------

// Built once per tick. Contains "which per-key firings have already happened"
// so once-dedupe is O(1) per candidate.
interface SpecContext {
  firedOnce: Map<EventType, Set<string>>;
}

function buildSpecContext(w: World): SpecContext {
  const firedOnce = new Map<EventType, Set<string>>();
  for (const spec of SPEC_REGISTRY.values()) {
    if (!spec.ambient?.once) continue;
    const set = new Set<string>();
    const policy = spec.ambient.once;
    for (const e of w.events) {
      if (e.type !== spec.type) continue;
      const key =
        policy === "per-actor"    ? (e.actorId ?? "")
      : policy === "per-province" ? (e.provinceId ?? "")
      : /* world */                 "*";
      set.add(key);
    }
    firedOnce.set(spec.type, set);
  }
  return { firedOnce };
}

// Public entry: called from tick.ts after runFate.
export function runSpecs(w: World): void {
  if (SPEC_REGISTRY.size === 0) return;
  const ctx = buildSpecContext(w);
  for (const spec of SPEC_REGISTRY.values()) {
    if (spec.onEvent) runOnEventSpec(w, spec);
    if (spec.ambient) runAmbientSpec(w, spec, ctx);
  }
}

// Walk THIS year's events; when a matching source event fires, prob-roll our
// spec against it. IMPORTANT: skip the RNG call entirely when prob is 0 —
// otherwise gate-and-return-0 patterns would still consume an RNG value and
// break the hash of worlds that never have this spec's preconditions.
function runOnEventSpec(w: World, spec: EventSpec): void {
  const trig = spec.onEvent!;
  for (let i = w.events.length - 1; i >= 0; i--) {
    const e = w.events[i];
    if (e.year !== w.year) break; // this-year events are at the tail
    if (e.type !== trig.source) continue;
    const p = trig.prob(w, e);
    if (p <= 0) continue;
    if (!w.rng.chance(p)) continue;
    trig.fire(w, e);
  }
}

function runAmbientSpec(w: World, spec: EventSpec, ctx: SpecContext): void {
  const amb = spec.ambient!;
  const items = pickItems(w, amb.scan);
  const alreadyFired = ctx.firedOnce.get(spec.type) ?? new Set<string>();
  const maxPerTick = amb.maxPerTick ?? 1;
  let firedThisTick = 0;
  // World-once: if a firing exists at all in the log, never fire again.
  if (amb.once === "world" && alreadyFired.size > 0) return;
  for (const item of items) {
    if (firedThisTick >= maxPerTick) return;
    const key =
      amb.once === "per-actor"    ? (item as { id: string }).id
    : amb.once === "per-province" ? (item as { id: string }).id
    : amb.once === "world"        ? "*"
    :                                "";
    if (amb.once && alreadyFired.has(key)) continue;
    if (!amb.gate(w, item)) continue;
    const p = amb.prob(w, item);
    if (p <= 0) continue; // same RNG-consumption guard as onEvent
    if (!w.rng.chance(p)) continue;
    amb.fire(w, item);
    if (amb.once) alreadyFired.add(key);
    firedThisTick++;
  }
  if (amb.once) ctx.firedOnce.set(spec.type, alreadyFired);
}

function pickItems(w: World, scan: AmbientSpec["scan"]): AmbientItem[] {
  switch (scan) {
    case "chars":     return w.living();
    case "provinces": return [...w.provinces.values()];
    case "titles":    return [...w.titles.values()];
    case "dynasties": return [...w.dynasties.values()];
  }
}
