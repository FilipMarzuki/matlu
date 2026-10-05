# Crafting & Tools — Design Document

**Issue:** #1202
**Date:** 2026-10-05
**Status:** Draft for review
**Builds on:** [`vitality-system-design.md`](vitality-system-design.md), [`region-exploration-design.md`](region-exploration-design.md), [`region-1-design.md`](region-1-design.md)
**Registries:** `public/macro-world/{concepts,recipes,resources}.json` (the existing crafting tree)

---

## Summary

Crafting already has a deep skeleton in the registries. This document does **not**
redesign it — it wires that tree into the body/action/knowledge layers so
crafting becomes the artificer's core loop:

- **Craftables carry `effects`** — a crafted tool, structure or garment changes
  the *action economy*: it lowers the Vigor/Clarity/time cost of an action,
  raises a yield or a cap, or unlocks a capability you simply didn't have.
- **Crafting is itself an action** with a Vigor/Clarity/time cost, and its
  output **quality** depends on your mind, your station, your tools, and how
  well you know the concepts.
- **Knowledge is the mental half** — concepts rank up as you craft, study and
  observe; discovery spends Clarity through the mind-**Focus** mechanic.
- **Stations are your base** — the recipe tier ladder (field → workbench →
  station → master) *is* the build-out of your outpost.

The through-line: **you craft to make acting cheaper, richer, or possible at
all — and better tools lower the tax of the very work that made them.**

Design only; grounds in the real schema, adds no code.

---

## 1. What already exists (don't rebuild)

The registries already define a full production economy:

- **Concepts** (`concepts.json`) — a ranked principle web (`friction`,
  `tension`, `rotation`, `heat-treatment`, `bearings`…), each with `ranks`,
  `requires` prerequisites (e.g. `bearings` needs `friction:1`, `rotation:1`),
  `learnedFrom` items, and the recipes it `unlocks`.
- **Recipes** (`recipes.json`) — `inputs → output`, a **tier 0–5** (field →
  workbench → station → master → beyond), a `station`, a `discovery.method`
  (innate / taught / observation / experiment / reverse-engineer / memory), a
  `timeBase`, `batchable`, and the `concepts` a craft teaches.
- **Resources** (`resources.json`) — a real chain: `raw → refined → component →
  consumable / equipment / deployable / structure`, sourced by biome.
- **Stations** — campfire → cookpot → kiln → smelter → foundry → tannery →
  sawmill → workshop → smithy → mech-bay → **engine-works** (simple → advanced).

Everything below attaches to these fields; new concepts attach via the same
schema.

---

## 2. The core idea: craftables carry `effects` *(locked)*

Add an **`effects`** block to equipment / tools / structures (and anything whose
point is to change play). Four kinds:

| Kind | Example | What it does |
|---|---|---|
| **Cost modifier** | axe → gather-wood Vigor −35%; workbench → tinker Clarity −30%; sled → haul time −40% | lowers an action's Vigor / Clarity / time |
| **Yield / cap modifier** | snare → passive food trickle; good bedroll → +sleep recovery; larder → +food ceiling | raises what an action returns or a pool's ceiling |
| **Capability unlock** | waterskin → carry water on the road; cold gear → winter travel; boat → water-travel rings; surveyor's instruments → numeric readouts | lets you do something otherwise impossible |
| **Enabler / station** | workbench → tier-1 recipes; smithy → its recipe set | opens recipes (see §5) |

This is the loop's keystone: the output of crafting feeds straight back into the
cost of every other action (vitality §4's "tools reduce the cost of the action
they serve"), and into exploration reach (travel modes), recovery (bedroll,
shelter), and precision (instruments — "precision as a crafted capability").

**Open:** `effects` live on the **item** (so looted/traded items carry them too,
not just crafted ones); a recipe simply outputs an item that has them.

---

## 3. Quality grades *(locked)*

Every craft resolves to one of four **grades** that scale its `effects`:

**crude → sound → fine → masterwork**

- Grade multiplies the item's `effects` (a *masterwork* axe cuts gather cost far
  more than a *crude* one; a *crude* bedroll barely helps).
- Grade is set at craft time by the **quality model** (§4).
- Grades make better tools aspirational and give concept mastery a visible
  payoff — the same recipe, made better.

---

## 4. Crafting as an action: cost, quality, failure

Crafting is a first-class action in the vitality economy.

- **Cost = time + Clarity** (heavy builds also spend Vigor). Scale the Clarity
  drain off the recipe's existing `timeBase`; fine work is mental work.
- **Quality = f( Clarity band × station tier × tool-on-hand × highest relevant
  concept rank ).** Craft **Sharp**, at the right station, with the concept
  mastered → *fine/masterwork*; craft **Frayed**, improvising in the field →
  *crude*, or fail.
- **A station lowers cost and raises the quality ceiling** — the tool→action
  loop applied to the bench itself: a workbench makes tinkering cheaper and lets
  you reach *fine* where the field caps at *sound*.

### Failure & salvage *(locked)*

- A failed craft **wastes its inputs** — the real cost of overreaching (crafting
  above your Clarity/station/concept, or probing an unknown recipe).
- **Partial salvage** softens it: depending on the craft and the Warden's
  abilities (a relevant concept rank, a "careful hands" trait, a salvage tool),
  you recover *some* inputs rather than all being lost. Salvage fraction scales
  with those — so investment in knowledge/ability also buys resilience, not just
  quality.
- Consistent with the persistent save: failure is a real setback, never a hard
  stop.

---

## 5. Knowledge: concepts + discovery + the Focus mechanic

The `concepts` and `discovery.method` fields are the mental half of crafting.

- **Concepts rank up by use.** Crafting/observing/experimenting with recipes
  that carry a concept advances it; higher rank → access to higher recipe tiers
  *and* a higher quality ceiling.
- **Rank gates tier access** — concept rank 1 opens tier-2 recipes that use it,
  rank 2 → tier-3, and so on. Research visibly unlocks the tree.
- **Discovery spends Clarity through mind-Focus.** This is where Focus-the-verb
  and Clarity-the-pool meet the bench: you *concentrate* on a concept or an
  unknown recipe and burn Clarity to make insight happen.

### Discovery pacing — the "insight" model *(proposed, to confirm)*

Each concept rank needs an **insight threshold** (escalating: 1→2 cheap, 2→3
dearer). Insight accrues from:

| Source | Cost | Insight |
|---|---|---|
| **Passive — by doing** | none (you were crafting anyway) | small drip into a recipe's concepts, **scaled by output grade** (masterwork teaches most) |
| **Study / experiment** (active, mind-Focus) | ~⅓ of a fresh Clarity pool | large gain; experiments on *unknown* recipes can fail (waste inputs per §4) but still teach "what doesn't work" |
| **Observation** | cheap, situational | one-time burst the first time you *see* a thing in the world or a settlement |
| **Reverse-engineer** | consumes an item | big burst toward its concepts + a chance to reveal its recipe |

Self-pacing: study costs Clarity, so ~2–3 sessions fit between sleeps, and a soft
per-concept **daily diminishing return** (a saturated mind) stops marathons.
Passive drip means you always progress by playing — research is the accelerator,
never a chore.

---

## 6. Stations are your base — the bridge to shelter/outpost

The tier ladder doubles as the build-out of the outpost:

- **tier 0 — field** (anywhere, improvised, caps at low grade)
- **tier 1 — workbench** (your camp; Region 1's "build a shelter" unlocks this)
- **tier 2 — station buildings** (the smithy, tannery, kiln… you build and place)
- **tier 3+ — master stations** (upgraded, higher grade ceiling, master recipes)

So:
- Building stations **is** base-building; stations are structures in your outpost.
- On the road (nomad / solo exit) you have only field + a **portable workbench**
  — fewer, costlier, lower-grade recipes. The base you leave behind is largely
  your stations (region-1 §4b, §6).

---

## 7. Region 1 grounds tiers 0–1

The slice's actions already map onto real low-tier recipes:

- cordage / `trap-snare` → *first catch* (hunting)
- shelter → your first **workbench** (tier 1)
- preserve → `cookpot` / a smoker
- `waterskin` → carry water (a capability unlock)
- cold gear → `tannery` / weaving (winter-travel capability)

So Region 1 is secretly a tutorial for tiers 0–1 of this exact tree, and the
tools you make there are the first `effects`-carrying items.

---

## 8. Implementation sketch

Illustrative; attaches to the existing schema.

```ts
type Grade = "crude" | "sound" | "fine" | "masterwork";
const GRADE_MULT: Record<Grade, number> = { crude: 0.5, sound: 1, fine: 1.5, masterwork: 2.2 };

interface ItemEffects {
  actionCost?: { action: string; pool: "vigor" | "clarity" | "time"; mult: number }[]; // <1 = cheaper
  yield?: { action: string; add: number }[];
  cap?: { pool: "vigor" | "clarity"; add: number }[];
  unlock?: string[];     // capability ids: "carry-water", "winter-travel", "boat", "instruments:survey"
}
// effects live on the item; grade scales the magnitudes at use time.

// Quality at craft time → a grade.
function craftGrade(clarityBand: number, stationTier: number, toolBonus: number, conceptRank: number): Grade {
  const score = clarityBand + stationTier + toolBonus + conceptRank; // tune weights
  return score >= 9 ? "masterwork" : score >= 6 ? "fine" : score >= 3 ? "sound" : "crude";
}

// Failure wastes inputs; salvage recovers a fraction from ability/concept/tools.
function onFail(inputs: Stack[], salvageFrac: number) { /* return floor(qty * salvageFrac) of each */ }

// Discovery: insight per concept rank; passive drip + active study.
interface ConceptProgress { rank: number; insight: number; insightToNext: number; }
```

---

## 9. Open questions

1. **Discovery pacing numbers** — the insight thresholds, study Clarity cost, and
   daily diminishing-returns curve (§5) are proposed; confirm/tune.
2. **Grade weighting** — how much each factor (Clarity / station / tool / concept
   rank) contributes to grade, and whether masterwork needs *all* maxed or can be
   reached by a specialist with a weak station.
3. **Salvage sources** — which abilities/traits/tools grant salvage, and the
   fraction each gives.
4. **Tool wear** — do tools degrade with use (adding an upkeep/repair loop), or
   are they permanent once made? (Wear deepens the economy but adds fiddle.)
5. **Batch & time** — how `batchable` + `timeBase` interact with the per-time
   vitality cost (a big batch is a long, draining session).

---

## 10. Relationship to other systems

- **Vitality** — crafting spends Vigor/Clarity; tools lower other actions' costs;
  quality keys off Clarity; instruments unlock numeric readouts.
- **Exploration** — travel-mode craftables (boat, snowshoes) reshape the rings;
  observation during exploration feeds discovery.
- **Region 1** — teaches tiers 0–1; its first crafts are the first `effects` items.
- **Settlements / Region 2** — `taught` and `observation` discovery, and trade for
  recipes/components, are the crafting reasons to seek people.
