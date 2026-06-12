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
| `seed.ts` | Starting tableau: 8 provinces, 3 houses, ~28 chars |
| `tick.ts` | One year, in canonical order |
| `sifter.ts` | Story sifting (significance + shapes) |
| `render.ts` | Stub templated prose renderer |
| `main.ts` | CLI entry point |

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
