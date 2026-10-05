# Region, Site Rating & Exploration — Design Document

**Issue:** #1198
**Date:** 2026-10-05
**Status:** Draft for review
**Prototype:** *Warden's Field Survey* — interactive fog-of-war loop (Claude Artifact, not in repo)

---

## Summary

This document defines three linked systems for the artificer game:

1. **Coarse region model** — how a region is *described* to the player: as a
   feel plus the resources available, not as a precise tile map.
2. **Site / shelter rating** — how candidate locations for an outpost or
   building are scored, so the player can choose *where* to settle.
3. **Fog of war + exploration** — how region knowledge is *earned*. A region
   starts unknown; explicit exploration actions reveal its tags with growing
   confidence.

The guiding idea: **the artificer doesn't see a map — they build an
understanding of a place.** Information is coarse on purpose, uncertain until
investigated, and gets sharper as the player crafts better instruments. This
keeps the fantasy ("I am reading the land") intact and gives exploration a real
cost and payoff.

No gameplay code is specified here — this is the model to implement against.

---

## 1. Design principles

| Principle | What it means | Why |
|---|---|---|
| **Coarse by default** | A region is a short feel + a handful of resource tags, shown as text and icons over a simple map. Never a surveyed tile grid. | The interesting decision is "what is this place and what can I make here?", not "where is pixel (37, 12)?". Keeps the UI readable on a tablet. |
| **Confidence, not binary reveal** | Every piece of knowledge has a confidence level, not just known/unknown. The player can *suspect* high winds before they *confirm* them. | Models real scouting — you get hints before facts. Makes partial exploration useful instead of all-or-nothing. |
| **Precision is a crafted capability** | Early game: ratings are coarse words (low → high). Later: the same ratings read as numbers (0–10) once the artificer has built the instruments to measure them. | Ties the map system to the crafting progression. Advancement = *seeing the world more precisely*, which is a satisfying, on-theme reward. |
| **Exploration costs time** | Each exploration action advances a day counter. | Gives fog-clearing weight; forces the player to prioritise what to learn. |

---

## 2. The region knowledge model

A region is a bag of **tags**. Each tag is one fact about the place. The key
data structure is uniform across every tag type:

```ts
interface RegionTag {
  key: string;            // e.g. "wind", "water", "ore", "predators"
  category: 'condition' | 'resource' | 'sign';
  value: TagValue;        // the underlying truth (set at worldgen)
  known: boolean;         // has the player discovered this tag exists at all?
  confidence: 0 | 1 | 2 | 3; // how sure the player is of its value
  source?: string;        // which action revealed/confirmed it (for the log)
}
```

- **`value`** is the ground truth, fixed when the region is generated. The
  player never sees it directly — they see it *filtered through confidence*.
- **`known`** gates whether the tag appears in the UI at all. An unknown tag
  renders as a placeholder (`???`), not as absent.
- **`confidence`** drives how the value is presented (see §3).

### Tag categories

| Category | Examples | Revealed mainly by |
|---|---|---|
| **condition** | wind, rainfall/exposure, temperature, terrain | Scout, Survey |
| **resource** | timber, ore, clay, stone, fresh water, forage | Prospect, Survey |
| **sign** | predator tracks, game trails, paths, roads, old ruins | Track, Climb & Look Out |

This single-structure approach means the renderer, the fog logic, and the
exploration actions all operate on one list — no special-casing per tag type.

---

## 3. Rendering: text + icons + confidence

A region is shown three ways *simultaneously*, all driven by the same tag list:

1. **Feel sentence** — a generated one-liner from the highest-confidence
   condition tags: *"Mostly forested plains, high winds, some fresh streams."*
2. **Icon chips** — one chip per tag, icon + short label.
3. **Coarse map** — a simple shape/zone, not a detailed grid.

Confidence is expressed visually, *not* by hiding information:

| Confidence | State | Rendering | Reads as |
|---|---|---|---|
| `0` | Unknown | `???`, muted | "No idea" |
| `1` | Suspected | `~guess`, dashed border, italic | "There might be…" |
| `2` | Observed | solid chip, normal | "There is…" |
| `3` | Confirmed | solid chip, accent highlight | "Definitely, measured" |

A value can also be *wrong* at low confidence — a suspected tag can read
"~some ore?" when the region actually has none, resolving only when confidence
climbs. (Optional for v1; flagged in §8.)

---

## 4. Exploration actions

Fog clears through explicit actions. Each costs **time** (days) and raises the
`known`/`confidence` of a subset of tags. Actions are deliberately *overlapping
but specialised* — none reveals everything, so the player chooses an order.

| Action | Primarily reveals | Cost (days) | Notes |
|---|---|---|---|
| **Scout** | Broad condition tags (terrain, wind) at low confidence | 1 | Cheap first pass — gives the "feel" fast but fuzzy. |
| **Survey** | Terrain + water conditions to higher confidence; some resources | 2 | The workhorse. Confirms what Scout suspected. |
| **Prospect** | Resource tags (ore, clay, stone, forage) | 2 | The only way to firm up extractable resources. |
| **Track** | Sign tags: animals/predators, game trails | 1 | Reveals the **Safety** axis (animal threat). |
| **Climb & Look Out** | Paths, roads, ruins; +1 confidence across everything visible | 2 | Needs high ground; sharpens the whole picture. |

Mechanic: an action bumps confidence by a step (and sets `known = true`) for the
tags in its domain, capped per action. Repeating an action has diminishing
returns once its tags hit their cap, so the player is pushed to diversify.

**These verbs are a starting proposal** — see open questions §8 on whether
Scout/Survey should merge.

### Exploration range — concentric day-radius layers

Exploration isn't only *what kind* of thing you look for (the verbs above) but
*how far out* you look. Think of the region as **concentric rings measured in
travel time from your position / base:**

- the **1-day radius** (there and back in a day),
- the **2-day radius**, the **3-day radius**, and so on.

You can fully work a nearer ring before the farther ones are reachable, and each
outer ring **costs more** (the action spends the travel time to get there and
back, so its Vigor/Clarity and day cost scale with the ring) and **reveals more
distant things:** far resources, candidate sites beyond the immediate area, the
roads and passes out, and the first hints of **neighbouring regions** (the
`adjacent` tag).

This layers cleanly onto everything above:

- **Each ring is its own fog to lift.** A tag carries not just confidence but a
  *distance band*; the near ring resolves first and cheapest, the far rings stay
  `???` until you can afford the trip.
- **Range is a capability, like precision.** Early on you can only work the
  1-day ring; reaching farther takes conditioning (capacity/Condition buffer to
  spend on the round trip), better gear, or a forward camp. So the map grows
  outward as the Warden grows — and a far ring explored from a *forward camp*
  costs from there, rewarding setting one up.
- **It gives exploration a natural arc.** Settle the near ring (home, food,
  water), then push a ring out for better resources and the routes onward — the
  same push that, in Region 1, uncovers the crossing out of the Reach (route
  knowledge for the solo exit) and the neighbours beyond it.

### Range is shaped by how you travel

The rings above are a **walker's** map — roughly circular, overland, slow. The
mode of travel redraws them:

- **On foot** — the default: even rings, blocked or slowed by terrain (a ridge,
  a marsh, deep snow costs extra), reaching inland as readily as anywhere.
- **By boat** — a different map entirely. A day's reach **stretches along rivers
  and coastline and across open water**, putting islands, far shores and
  downstream regions inside a single-day band that no walker could touch — while
  adding *nothing* inland. Water becomes a fast lane and a barrier both: the
  same strait that's a day's sail is impassable on foot.
- Later modes (a mount, a cart, a frozen river you can cross in winter but not in
  thaw) each warp the rings their own way.

So **what's reachable depends on what you can craft and where you settle.** A
coastal or riverbank base plus a built boat explodes the explorable map along the
water; an inland base keeps you to the walker's rings until you find another
mode. This is the same thread as Region 1's **sail exit** (settle the coast,
build a boat, and the crossing — and a whole different set of neighbours — opens
by water instead of by the winter road).

Open: the exact ring count and spacing, whether rings are literal distance or an
abstract "reach" stat, how forward camps bank progress in an outer ring, and how
many travel modes exist and how each reshapes reach (and its upkeep/risk — a boat
needs water and has its own weather).

---

## 5. Site / shelter rating

Within a known region the player picks a **site** to place a shelter or
building. Each candidate site (e.g. Cave, Riverbank, Hilltop, Treeline) is
scored on independent **factors**:

| Factor | Measures | Driven by |
|---|---|---|
| **Shelter** | Protection from weather (wind, rain, exposure) | Site type + region condition tags |
| **Safety** | Protection from animals (later: people) | Site type + predator/sign tags |
| **Water** | Proximity to fresh water | Region water tags + site position |
| **Resources** | Proximity to extractable materials | Region resource tags + site position |
| **Defensible** *(deferred)* | Defensibility against attack | — shown greyed as "later"; see combat note |

### Scoring model

```
siteFactor = clamp( regionBaseline(factor) + siteModifier(type, factor) )
```

- **`regionBaseline`** comes from the region's tags (a windy region lowers every
  site's Shelter baseline).
- **`siteModifier`** is the site type's intrinsic bias (a Cave adds Shelter and
  Safety; a Riverbank adds Water but lowers Shelter).

A site factor only resolves once the **region tags it depends on are known** —
so site ratings de-fog *as a consequence of* exploration, not independently.
Prospect first and the Resources bars fill in; Track first and the Safety bars
fill in. This makes the two systems feel like one loop.

### Coarse now, numeric later

Factor output is a single scale presented two ways, toggled by the artificer's
current instruments:

- **Early (no instruments):** coarse bands — `low` / `medium` / `high`.
- **Later (crafted instruments):** the same scale as `0–10` numbers.

This is the concrete payoff for the "precision as a crafted capability"
principle: building, say, an anemometer or a surveyor's level upgrades the
*entire rating UI* from words to numbers. (Which instrument unlocks which
factor's numeric readout is TBD — §8.)

---

## 6. Region feel → crafting affordances

The point of reading a region is to know **what you can build there**. The feel
tags map to crafting/building affordances, surfaced as hints:

| Region tag | Affordance hint |
|---|---|
| High winds | Windmill / wind-powered workshop |
| Fresh water stream | Water mill, tanning, irrigation |
| Timber-rich | Charcoal, construction, bows |
| Ore / stone | Smelting, masonry |
| Game trails | Hunting, hides, bone/sinew crafts |

These are *hints*, not hard gates — they tell the player why a region matters
for their artificer goals. The exact affordance table should live alongside the
recipe registry so it stays in sync with craftable items.

---

## 7. Combat note (deferred)

Combat is planned but **out of scope for this system**: animals first, people
later. Two hooks are pre-wired so combat slots in without reworking the model:

- **Safety factor** already represents animal threat and is driven by the
  predator/sign tags. When combat ships, this becomes the input to encounter
  risk.
- **Defensible factor** is specified in the site rating but shown greyed as
  "later". It activates when human/faction threat exists.

No encounter, damage, or AI logic is designed here.

---

## 8. Open questions

1. **Action verbs** — are five actions (Scout / Survey / Prospect / Track /
   Climb & Look Out) the right set, or should Scout and Survey merge into one
   action with scaling depth?
2. **Blended vs. factored site score** — always show the five factors
   separately (current proposal), or also offer a single blended "site score"
   for quick comparison?
3. **Instrument → precision mapping** — one instrument that flips *all* ratings
   to numeric, or per-factor instruments (anemometer → Shelter numbers,
   surveyor's level → terrain, etc.)?
4. **Wrong-at-low-confidence** — do we ship mis-readings that correct themselves
   (richer, riskier) or keep low confidence merely vague (simpler)?
5. **Time budget** — is "days" the right cost unit, and does exploration compete
   with other day-spending activities (crafting, building)?

---

## 9. Implementation sketch

A minimal data layer to build against — names illustrative, not final:

```ts
type Confidence = 0 | 1 | 2 | 3;

interface Region {
  id: string;
  name: string;
  tags: RegionTag[];                    // §2
  sites: SiteCandidate[];
}

interface SiteCandidate {
  id: string;
  type: 'cave' | 'riverbank' | 'hilltop' | 'treeline';
  factors: Record<FactorKey, SiteFactor>;
}

type FactorKey = 'shelter' | 'safety' | 'water' | 'resources' | 'defensible';

interface SiteFactor {
  dependsOn: string[];   // tag keys that must be `known` before this resolves
  score: number;         // 0–10 truth; presented coarse or numeric
}

interface ExplorationAction {
  id: string;
  label: string;
  costDays: number;
  reveals: { category?: TagCategory; keys?: string[]; confidenceStep: Confidence };
}
```

Rendering, fog state, and site resolution all read from this one `Region`
object — consistent with the prototype. The prototype (*Warden's Field Survey*)
is the reference for interaction feel; this doc is the reference for the model.

---

## 10. Relationship to existing systems

- **Crafting / recipes** — the affordance table (§6) should be derived from or
  live beside the recipe registry in `public/macro-world/`, so region hints and
  craftable items never drift.
- **Settlements** — per CLAUDE.md, procedural settlement generation lives in
  Mistheim. This system is about the *player's own* outpost placement, which is
  a separate, player-driven layer and does not touch the culture/settlement
  worldgen.
- **Worldgen** — region tags are set at generation time; this doc assumes a
  generator exists that can stamp condition/resource/sign tags onto a region. It
  does not design that generator.
