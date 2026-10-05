# Region 1 — Greywind Reach — Design Document

**Issue:** #1201
**Date:** 2026-10-05
**Status:** Draft for review
**Builds on:** [`region-exploration-design.md`](region-exploration-design.md), [`vitality-system-design.md`](vitality-system-design.md)
**Prototype:** *Warden's Field Survey* (Claude Artifact) — the explore/site/vitality loop Region 1 is built from

---

## Summary

Region 1 is the game's opening region **and** its hidden tutorial. The Warden
arrives alone and with nothing in a fully fogged **Greywind Reach**, and the
goal is not to run down a timer but to **get established** — build a shelter,
secure food and water, and bring body and mind to a stable footing. A
**caravan passes through in a window** of a few days; by then the player
chooses how to leave — or whether to leave at all.

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

## 2. Goal: stability, not a timer

A bare "survive N days" is passive — you would just wait. The goal is to **reach
and hold stability**, which forces the player to actually build the loop:

| Pillar | What it requires | Systems it exercises |
|---|---|---|
| **Shelter** | Explore, read site ratings, pick a spot, build a basic shelter | fog, exploration, site/shelter rating, first build |
| **Food & water security** | A *repeatable* source — forage patch, snare line, stream — not one meal | gathering, the day loop, light crafting (snare, waterskin) |
| **Sound body & mind** | Vigor & Clarity capacity at/above baseline, Condition **Sound** | the vitality loop, recovery, capacity growth |

**Win state: stable for ~3 consecutive days.** A rolling check that proves a
*sustainable* system rather than a lucky scrape. It naturally sequences the
whole loop: explore → choose a site → build → secure food/water → settle into
the recover rhythm → hold.

By the end a well-played Warden leaves **slightly above baseline** — the reward
for good living is that you walk out stronger than you arrived (capacity model,
vitality §1).

---

## 3. The clock: a window, not a wall

The caravan passes **between ~Day 8 and ~Day 12** — a window, not a hard
deadline — so stability is urgent without a punishing fail:

- **Stable before it arrives** → you meet it rested and strong, with goods to
  trade, and choose freely.
- **Still scrambling** → you can still act, but ragged: lower capacity, maybe
  nursing an injury, nothing to trade.
- **The cold snap lands mid-window** as the exposure test. A bad shelter site
  (exposed Hilltop) risks **frostbite** — a gentle first taste of the
  permanent-injury stakes (vitality §3); a good site (Cave / Treeline) shrugs it
  off. This is where the site-rating choice finally bites.

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
3. **Stay and root** — keep building the Reach into a real home base. The caravan
   leaves a gift / a contact / a rumor, and the world opens differently: you're a
   settled artificer others may come *to*.

All three carry the same persistent character forward (vitality §11). The
recurring question of the game becomes **"wander or root?"**

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

- **Miss the caravan window** → it moves on; you're not stranded forever, but the
  next chance is later and worse (or you take the solo crossing in rougher
  shape). Not a game-over.
- **Attempt the crossing underprepared** → you turn back having spent Vigor/
  Clarity and Condition, possibly with a **cold injury** (permanent, vitality
  §3) — a real setback, never a restart.
- **Never stabilize** → the Reach grinds you down (Condition erosion); the game
  keeps going, just harder. The pressure is economic, not a fail screen.

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
| Hold stability | capacity growth — leave above baseline |
| Cold snap | exposure, and a light brush with permanent injury |
| Trade / prep | the crafting economy; nomad gear |
| The exit choice | wander-or-root; persistence |

---

## 9. Open questions

1. **Stability threshold** — is "3 consecutive stable days" the right bar, and
   what exactly counts (capacity ≥ baseline on both pools? Condition ≥ Sound? a
   stocked larder of N rations)?
2. **Window numbers** — are Day 8–12 and a mid-window cold snap the right pacing
   for a ~first-hour tutorial, or too long/short?
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
