# Storytelling Engine — v1 prototype

A simulation-driven storytelling engine for the Matlu multiworld: interconnected
character lives, dynasties, and intrigue over generations, designed to read like
real medieval-ish history.

**Core principle (non-negotiable):** a structured simulation is the source of
truth. The LLM is a RENDERER, never the system of record. We don't ask a model
to "write the next chapter" — we **simulate**, then **sift** the event log for
dramatically interesting shapes, then **render** only those. Coherence is
architectural, not hoped-for.

This v1 has **no LLM**. It uses a deterministic, templated STUB renderer so the
loop runs offline, free, and instantly — the only question v1 answers is whether
the *simulated history has the right texture*.

## Run it

```bash
npx tsx storytelling/main.ts --years 200 --seed 42
# or
npm run story
# flags: --years N  --seed N  --threshold N (drama cutoff)  --verbose (event tally)
```

Same seed ⇒ byte-identical chronicle (seeded RNG, no `Math.random`).

## The causal stack

History runs one loop; each layer feeds the next, so every dramatic event
traces back to a structural rule.

1. **Geography + scarcity** (`geography.ts`) — provinces have fertility/terrain.
   Carrying capacity caps population caps levy/wealth. Overpopulation = scarcity
   = the pressure that turns ambition into war.
2. **Natural phenomena** (`phenomena.ts`) — harvest variance, famine, and plague
   (spreads along rivers/coasts). Exogenous shocks that ripple UP: a plague that
   kills a king empties a throne.
3. **Goals / schemes** (`goals.ts`, `schemes.ts`) — drives + claims + scarcity
   generate GOALS, each with an OBSTACLE (the obstacle is the story). If one
   person blocks many goals, `ELIMINATE_RIVAL` emerges — no scripted murder.
   Blocked goals spawn multi-tick, discoverable SCHEMES; discovery mints GRUDGES
   that fuel future vengeance.
4. **Inheritance** (`inheritance.ts`) — titles carry succession laws
   (primogeniture / gavelkind / elective / seniority). Death transfers a title
   AND mints weaker CLAIMS in the losers, which become the next generation's
   `SEIZE_TITLE` goals. No heir ⇒ a succession crisis (the richest story
   generator). This is the engine of multigenerational war.

Plus a light **social-mobility** seam: when a vacant title has no noble claimant
left, the discontented pops can throw up a lowborn leader who seizes it and
founds a new house (`LOWBORN_RISE`).

## Tick order (`tick.ts`)

```
environment (regrow pops → harvest → plague) → resolve successions
  → mortality / birth → resolve successions
  → regenerate goals
  → spawn / advance schemes (murders) → resolve successions
  → resolve pressed claims (wars) → resolve successions → marriages
  → opinion drift
  → detect dynasty extinctions
```

Succession is re-resolved after every step that can kill someone, because deaths
arrive from many sources in one year (plague, age, murder, war).

## Sifting & rendering

- **`sifter.ts`** scores every event for dramatic significance and recognises
  multi-event SHAPES — *revenge fulfilled*, *kinslaying*, *usurpation*, *a throne
  taken by murder*, *an underdog victory*, *a house extinguished*. The chronicle
  is the events above a significance threshold. This is deliberately separate
  from rendering, so judgment and prose decouple.
- **`render.ts`** is the stub: a pure function from canonical events to prose.
  It invents no facts (that would corrupt canon); it only phrases what the sim
  recorded. Regnal numbers (`Brigid II of Corvane`) are added at render time.

## Files

| File | Role |
| ---- | ---- |
| `types.ts` | Canonical data model (the source of truth) |
| `rng.ts` | Seeded, reproducible PRNG (mulberry32) |
| `world.ts` | Live state + query helpers + event log |
| `geography.ts` | Carrying capacity, scarcity, population drift |
| `phenomena.ts` | Harvest / famine / plague; centralised death |
| `goals.ts` | Drives + circumstances → goals with obstacles |
| `schemes.ts` | Blocked goals → discoverable conspiracies |
| `inheritance.ts` | Succession laws, claims, succession crises |
| `people.ts` | Character / dynasty factories |
| `names.ts` | Name pools |
| `world-spec.ts` | `WorldSpec` schema + `DEFAULT_SPEC` (the world as DATA) |
| `seed.ts` | `loadWorld(spec)` — turn a WorldSpec into a live World |
| `tick.ts` | One year, in canonical order |
| `sifter.ts` | Story sifting (significance + shapes) |
| `arcs.ts` | Group significant events into story arcs (threads) |
| `render.ts` | Stub templated prose renderer |
| `persist.ts` | Save a run: `events.ndjson` (canon) + `meta.json` |
| `magic.ts` | Optional leveling / magic layer (see below) |
| `main.ts` | CLI entry point |

## Feeding in world data (`WorldSpec` / `--spec`)

The world is **data, not code**. `world-spec.ts` defines a `WorldSpec` — provinces
(terrain, fertility, coast/river, neighbors, population, **mana**), titles
(tier + succession law), dynasties, and characters (drives + relationships +
claims) — and `seed.ts`'s `loadWorld(spec, seed)` turns it into a live World. The
entire geographic surface the engine reads is the `Province` record; produce that
(plus the title/dynasty graph) and everything downstream (carrying capacity,
scarcity, plague spread, peril, the leveling ceiling) is derived.

Run a built-in named world, or feed in an external JSON `WorldSpec`:

```bash
npx tsx storytelling/main.ts --world frontier --seed 3 --magic --arcs   # or: npm run story:frontier
npx tsx storytelling/main.ts --spec my-world.spec.json --seed 42 --magic
```

**Built-in worlds** (`--world <name>`, in `worlds/`):
- `default` — the original three-realm tableau.
- `frontier` — the **Ibiki heartland** (a lush `meadow`+`forest` centre, the seat
  of the story) ringed by frontiers: an ocean coast (west), a mountain spine
  (north), an arid **steppe+desert** orc/human raider Horde (east) with a settled
  **Empire of Zafran** beyond it, and a **swamp+jungle** Mirewood (south). The
  heartland holds two rival Ibiki houses (royal Aeryn vs the elder-line Doriel,
  who claims the throne), so the densest intrigue is at home; the Horde presses
  in with claims on both a Zafran satrapy and an Ibiki meadow. Terrain now
  includes `meadow`/`steppe`/`desert`/`swamp`/`jungle`.

Authoring a world is just data — see `worlds/frontier.ts` as a worked example.

### The peoples layer (culture · race · faith)

A WorldSpec may define **cultures**, **races**, and **faiths** (all optional; the
default world uses none, so it stays byte-identical). They make a region read as
a distinct people *across generations*, not just at gen-0:

- **Culture** → a name pool (so Ibiki children stay Ibiki-named for 200 years,
  fixing the drift), a temperament (`driveBias` that newborns pull toward — the
  Horde stays hungry, Zafran pious), and a default succession law.
- **Race** (e.g. human / orc) → an inter-race opinion modifier, so the orc/human
  split inside the Horde is *mechanical* friction, not just flavour.
- **Faith** → hostility pairs (a holy-war / grudge axis — Sky Father vs Sun Lord,
  the swamp cult against all).

Wiring: `CultureSpec`/`RaceSpec`/`FaithSpec` on the WorldSpec, `culture`/`race`/
`faith` on each dynasty; naming and drive-bias are threaded through births in
`people.ts`, and the opinion modifier lives in `World.peoplesModifier`.

`mana` is **authored data** per province (no longer derived from terrain) — the
"second geography" you can drive from a corruption / ley overlay. To wire the real
Matlu world, write small adapters that emit a `WorldSpec`:

- **geography** ← the Azgaar export (`npm run worldgen:earth`: biomes → fertility,
  rivers/coast, temperature → harvest variance), **aggregated** to ~30 provinces;
- **mana** ← a corruption/ley overlay;
- **cultures** ← `macro-world/cultures.json` → succession law + name pools +
  drive/temperament biases (so regions read as *places*);
- **resources** ← `macro-world/resources.json`;
- **dynasties/characters** ← lore (WORLD.md / Notion).

The engine never changes — each new world is just a different `WorldSpec`. (That
spec is also the byte-stable "world bible" you'd freeze as the LLM's cached prefix.)

## Saving stories & the story model

The sim is **deterministic**, so the durable artifact has three layers, and only
the middle one is canon:

```
1. INPUTS      { seed, years, magic, version }      ← 8 bytes reproduce everything
2. EVENT LOG   WorldEvent[]   (append-only, no prose) ← THE canon / source of truth
3. DERIVED     state snapshots · sifted chronicle · arcs ← regenerate, never store as truth
```

A **story** is the ordered `WorldEvent[]`. The chronicle and the arcs are *views*
over it. Persist the log when you want to query or render a story without
re-running the sim:

```bash
npx tsx storytelling/main.ts --years 200 --seed 42 --magic --save --arcs
```

- `--save` writes `storytelling/runs/<seed-years[-magic]>/`:
  - `events.ndjson` — one `WorldEvent` per line (append-friendly, greppable, and
    diffable, so you can *see* how a code change altered history),
  - `meta.json` — inputs, a summary (kingdoms, surviving houses), and the arc index.
- `--arcs` prints the **story arcs** — threads of related significant events,
  biggest first. An arc shares a *focus*: a contested title (a multi-generation
  claim war), a pair of people (a feud), a house (its fall / a lost art), or a
  figure (a saga). Long focuses split on 40-year gaps, so you get "The Wars for
  Kingdom of Halvar (1024–1128)" rather than one 200-year blob. Arcs are the
  natural unit to hand the LLM later ("render *this thread* as a chapter").

The same shape maps 1:1 onto **Supabase** for productionizing (the project already
uses it): `story_runs(seed, config, version, summary jsonb)` +
`story_events(run_id, id, year, type, actor_id, …, data jsonb, significance)`.
That's the read source for the nightly Claude Message-Batches renderer — "give me
every murder in run X" or "feed this arc's events to Opus" become one query each.

## Magic / leveling layer (`--magic`)

An optional high-fantasy layer: classes, levels, inherited capital and lost arts.
**Off by default** so the base chronicle is byte-identical; turn it on with:

```bash
npx tsx storytelling/main.ts --years 200 --seed 42 --magic
```

The design question it answers: how do you add leveling to a dynastic history
*without* breaking the causal closure that makes it feel like history? The answer
is one positive loop and two negative loops, so power **breathes** instead of
running away or flat-lining:

- **(+) Matthew effect** — leveling is gated by **inherited capital** (a house's
  wealth, its rare class-rite, being landed). XP itself echoes the *sifter's*
  significance: you grow from doing dangerous, significant things. So power
  concentrates in the same houses that hold land — the aristocracy is high-level
  because it's *advantaged*, not born special.
- **(−) Comfort governor** — too many advantages remove the real risk leveling
  needs *and* the will to seek it. Safe training (`SHELTER`) buys levels only up
  to a plateau; past it the only way up is real, lethal peril (`TEMPER` / venture
  / war), and the cost rises exponentially. So entrenched houses **rot from
  within** — heirs plateau below the grandparents who built the house.
- **(−) Catastrophe** — war and plague cull the high-level tier and can sever the
  transmission of a rite, resetting the board (handled by `phenomena` +
  `maintainRites`).

Other pieces: **rare class-rites** live in houses and are **lost** if the last
master dies un-transmitted (`ART_LOST` — forgetting is the default); **frontier**
provinces are more perilous and breed higher-level houses than the soft interior;
**personal prowess feeds `power()`**, so a high-level landless cadet can out-fight
a soft king (the "overmighty subject"). Watch the epilogue's *Mightiest of the
age* and *Living arts*, and the chronicle's "mightiest soul of the age" beats.

Textures it produces unscripted: third-generation decline, the landless/frontier
out-levelling the crowned, low-born breakouts (`HERO_RISEN`), and — on some seeds
— a **dark age** where every rare art is forgotten.

Intellectual lineage: Merton's *Matthew Effect* + Bourdieu's *capital* (accrual),
Ibn Khaldun's *asabiyyah* decay + Scheidel's *Great Leveler* (the two governors),
Henrich on knowledge-loss, and The Wandering Inn / Cradle / Mistborn for flavor.

## v1 deliberately DEFERS

Each is a clean add once the core loop reads right:

- **Perception / madness** — characters acting on a subjective worldview;
  structured distortions (paranoid, megalomaniac, zealot) tied to inbreeding.
- **Mutable law** — a power-gated `REFORM` action that manufactures disinherited
  losers (the `REFORM` event type + `REFORM_LAW` goal are already stubbed in
  `types.ts`).
- **Multi-scale LOD** — one Actor interface at every scale
  (individual/band/settlement/faction/realm) with SPOTLIGHT/NAMED/ABSTRACT/
  STATISTICAL tiers and a frame-relative sifter.
- **Real Claude renderer** — replaces `render.ts` only.

## Wiring Claude later

- **Split models by job:** Opus for prose rendering & reflection; Haiku/Sonnet
  for cheap bulk "what happens next" sim-tick proposals.
- **Message Batches API** for overnight bulk generation (50% cost).
- **Prompt caching:** freeze the immutable world bible as a byte-stable cached
  prefix; volatile per-event content goes after the breakpoint.
- **Structured outputs** (JSON schema) for event proposals to keep canon clean;
  **adaptive thinking** for the sifter's reflection/judgment.

The event log the renderer reads is identical with or without the LLM, so this
swap touches `render.ts` and nothing else.
