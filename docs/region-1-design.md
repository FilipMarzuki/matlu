# Region 1 — Greywind Reach — Design Document

**Issue:** #1201
**Date:** 2026-10-05
**Status:** Draft for review
**Builds on:** [`region-exploration-design.md`](region-exploration-design.md), [`vitality-system-design.md`](vitality-system-design.md)
**Prototype:** *Warden's Field Survey* (Claude Artifact) — the explore/site/vitality loop Region 1 is built from

---

## Summary

Region 1 is the game's opening region **and** its hidden tutorial. The Warden
arrives alone and with nothing in a fully fogged **Greywind Reach**, and
**winter is coming.** The goal is not to run down a timer but to **be ready for
it** — a winterized shelter, a stocked larder, fuel for warmth, and a sound body
and mind to enter the cold on. A **caravan passes through just before the snow**;
by then the player chooses how to leave — or whether to let it pass and winter
over in the home they've prepared.

The region teaches every core system in order (fog → exploration → site rating →
shelter → the Vigor/Clarity loop → Condition → first crafting → a light brush
with permanent injury) under one legible human goal, and ends on the choice that
defines the whole game: **wander or root.**

Design only — no gameplay code here. Combat is deferred (animals first); the
caravan encounter is non-combat.

---

## 1. Setup & fiction

The Warden arrives in the Reach alone, with nothing — washed up / exiled /
waking after the corruption (exact hook TBD). The region is all `???`. A quiet
pressure hangs over it: **the season is turning** — winds rising, a cold snap
coming — and there is one chance to move on before the Reach closes in. The
player learns the weather is turning *by exploring* (Lookout, survey), not from a
popup.

---

## 2. Goal: be ready for winter

A bare "survive N days" is passive — you would just wait. The organizing
pressure is concrete and diegetic: **winter is coming, and you must be prepared
before it lands.** Readiness is a set of stockpiles and a state, not a timer —
which forces the player to actually build the loop and, crucially, to *stockpile
ahead* rather than live hand-to-mouth:

| Pillar | What it requires | Systems it exercises |
|---|---|---|
| **A winter larder** | *Stored, preserved* food + water laid in for the cold months — not just today's meal | gathering, preservation crafting (smoke/dry/salt, waterskins) |
| **A winterized shelter** | A built shelter at a site that breaks the weather, warm enough to hold through the cold | fog, exploration, site/shelter rating, first build |
| **Warmth & fuel** | Firewood / a hearth / cold-weather gear to keep Clarity recovering through the freeze | gathering, crafting, the warmth gate on recovery |
| **A sound body & mind** | Vigor & Clarity capacity at/above baseline, Condition **Sound**, to *enter* winter on | the vitality loop, recovery, capacity growth |

**Win state: winter-ready** — larder stocked to a threshold, shelter winterized,
fuel in, body & mind sound. That readiness check naturally sequences the whole
loop: explore → choose a site → build → secure *and store* food/water → lay in
fuel → settle the recover rhythm. The proof, if you stay, is **making it through
the first hard stretch of winter** on what you laid by.

By the end a well-played Warden enters winter **at or above baseline** — the
reward for good preparation is that you meet the cold stronger than you arrived
(capacity model, vitality §1).

### Milestones — a first-win ladder

Because Region 1 is the tutorial, the winter-ready goal is scaffolded by a
**ladder of milestones** — discrete first-time wins that light up as the player
hits them, breaking the abstract goal into legible steps and quietly teaching
the order of operations:

*get your bearings* (scout) → *stake a claim* (choose a site) → *water secured*
→ *first forage* → *fire & timber* → *a roof overhead* (raise a shelter) →
*read the tracks* → *first catch* (hunt) → *the larder begins* (preserve) →
*winterized* → *larder stocked* / *fuel laid in* → **winter-ready**.

Early rungs are "first time you do X" (guidance); the later ones are the
readiness thresholds themselves (shelter winter-warm, larder/fuel full). The
ladder is a teaching aid and a progress readout, not a hard gate — the player
can tackle steps in any order, and the milestones simply celebrate and signpost.
(Prototyped in the *Greywind Reach* slice.)

---

## 3. The clock: winter is the deadline

Winter itself is the deadline, and the **caravan passes just before it sets in**
(~Day 8–12) — the last easy way out before the snow. A window, not a hard wall:

- **Winter-ready before the caravan** → you meet it prepared, with surplus goods
  to trade, and choose freely: leave with it, leave solo, or let it pass and
  winter over in a base you've made warm.
- **Still scrambling when it comes** → you can still board or cross, but ragged:
  lower capacity, maybe nursing an injury, nothing to trade — and no larder to
  fall back on if you then try to stay.
- **The first cold snap is winter's leading edge**, and the exposure test. A bad
  shelter site (exposed Hilltop) risks **frostbite** — a gentle first taste of
  the permanent-injury stakes (vitality §3); a warm, well-sited shelter shrugs it
  off. This is where the site-rating and fuel choices finally bite.

---

## 4. The two exits

Region 1 has two ways out, teaching two different lessons. Neither is a hard
wall — the solo path is **costly, not blocked**.

### 4a. The caravan — the assisted door

A traveller/caravan passing through, bound for a settlement (Mistheim — ties to
the cultures/settlement layer). It is the **easy, safe exit**: hand-off to
Region 2 with help. Interacting with it is non-combat and offers:

- **Tag along** — travel with them; fast, safe; your conditioning carries
  (persistent save), and they can hand you a leg-up: a tool, a companion, or
  **partial intel on Region 2** (arrive less fogged).
- **Trade** — your first use of the crafting economy: sell crafted goods for
  supplies or next-region knowledge, whether or not you board.

### 4b. Solo overland / sea crossing — the hard door

A prepared Warden can always **walk or sail out** alone. The distance is long
enough — a **winter stretch** — that it demands real **nomad-survival
capability** first. Hard but not impossible: prepare and you make it; don't and
you turn back or get hurt. This is the "cost" that replaces a hard lock.

Leaving the fixed outpost behind means sustaining the vitality loop **on the
move** — a travel variant of everything learned so far (see §6).

The **sail** variant opens if the player settled the coast/riverbank and built
or found a boat: a different route with its own hazards (weather at sea), tied to
the site they chose.

---

## 5. The ending branch — wander or root

The exit is the first expression of the persistent, player-authored world, and a
reusable template for *every* future region boundary:

1. **Leave with the caravan** — assisted; help in hand; the Reach outpost becomes
   a claimable node you could return to.
2. **Leave solo** — the hard crossing (§4b); no help, but no dependence; you
   arrive in Region 2 on your own terms (and your own supplies).
3. **Let it pass and winter over** — stay and ride out the cold in the home
   you've prepared, then keep building the Reach into a real base. Only viable if
   you're genuinely winter-ready (§2); the caravan leaves a gift / a contact / a
   rumor, and the world opens differently: you're a settled artificer others may
   come *to*. Wintering over successfully is itself the proof of preparation.

All three carry the same persistent character forward (vitality §11). The
recurring question of the game becomes **"wander or root?"** — framed here as
*flee the winter with help, brave it alone on the road, or hunker down and
outlast it.*

---

## 6. Nomad survival — the travel variant of the vitality loop

The solo exit (and later long-distance travel) runs the Vigor/Clarity loop
**without a fixed shelter**. It's the same economy with the supports removed, so
Region 1 is where the player must have *built* these first:

| Need | On a fixed base | On the road (nomad) |
|---|---|---|
| **Shelter** | A built outpost → deep sleep | **Portable** tent/lean-to you carry → thinner sleep, slower Clarity recovery |
| **Food / water** | Repeatable local source | **Preserved** rations + water you stockpiled (crafting: smoking/drying/salting, waterskins) |
| **Warmth** | The site breaks the weather | **Crafted cold-weather gear** cuts exposure drain & frostbite risk |
| **Recovery** | Full nightly reset | Partial — so you must **leave with a capacity/Condition buffer** and spend it down over the crossing |
| **Direction** | n/a | **Route knowledge** — scout/Lookout the region edge to reveal the pass/road/coast; an unknown route is harder |

This is why **stability-first matters even for the solo path**: the crossing
spends a buffer you can only build by getting established. It also seeds a
reusable "expedition" mode for later regions.

---

## 7. Failure & soft-fail

Consistent with the no-hard-death persistent save:

- **Miss the caravan window** → it moves on; you're not stranded forever, but
  your easy exit is gone: winter is now either braved solo on the road or waited
  out in place, both on whatever you managed to lay in. Not a game-over.
- **Attempt the crossing underprepared** → you turn back having spent Vigor/
  Clarity and Condition, possibly with a **cold injury** (permanent, vitality
  §3) — a real setback, never a restart.
- **Winter over underprepared** (thin larder, cold shelter, no fuel) → the cold
  grinds you down: Condition erodes, capacity drifts below baseline, frostbite
  risk climbs. You survive, but limp out of winter weaker — the pressure is
  economic and bodily, not a fail screen.

---

## 8. Tutorial beat mapping (one lesson at a time)

| Beat | System introduced |
|---|---|
| Arrive fogged | the region knowledge/fog model |
| First Scout | the five explore actions, confidence |
| Read the Reach | region feel + resources |
| Pick a site | site/shelter rating (Shelter/Safety/Water/Resources) |
| Build shelter | first craft/build; sleep quality → recovery |
| A day's work | the Vigor/Clarity per-time loop, the day rhythm |
| Overdo it | Condition reserve, soft-fail |
| Lay in stores | stockpiling vs. hand-to-mouth; preservation crafting; capacity growth |
| Cold snap / winter | exposure, warmth gate, and a light brush with permanent injury |
| Trade / prep | the crafting economy; nomad gear |
| The exit choice | wander-or-root (flee / brave / hunker); persistence |

---

## 9. Open questions

1. **Winter-readiness threshold** — what exactly counts as "ready"? A larder of
   N rations (how many?), a shelter at/above some warmth tier, X units of fuel,
   capacity ≥ baseline on both pools, Condition ≥ Sound — and is it a hard
   checklist or a soft score?
2. **Window & winter length** — are Day 8–12 (caravan) and the winter that
   follows the right pacing for a ~first-hour tutorial? How long is winter itself
   if you stay, and does it have its own internal beats (deep-freeze, thaw)?
3. **Arrival hook** — washed up / exiled / waking? This sets tone and whether the
   Warden has *any* starting kit.
4. **Caravan generosity** — how much of a leg-up (tool? companion? Region-2
   intel?) without trivialising Region 2.
5. **Solo-crossing difficulty curve** — how steep is the prep gate, and what's
   the exact turn-back/injury rule so "hard but not impossible" lands fairly?
6. **Does the Reach persist** if you leave — a returnable node, or narratively
   closed behind you?

---

## 10. Relationship to other systems

- **Region / exploration** — Region 1 *is* the exploration loop with a goal and a
  deadline wrapped around it; Greywind Reach is the prototype's example region.
- **Vitality** — stability is defined in Vigor/Clarity/Condition terms; the cold
  snap introduces permanent injury; the solo exit is the travel variant of the
  loop; the player leaves with grown capacity.
- **Crafting** — first builds (shelter, snare, waterskin), preservation and
  cold-weather gear for the crossing, and trade goods for the caravan.
- **Settlements / Mistheim** — the caravan is bound for civilisation, grounding
  Region 2 as the step from solo survival toward people and trade (and,
  eventually, people-combat).
