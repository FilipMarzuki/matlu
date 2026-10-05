# Vitality — Vigor, Clarity & Condition — Design Document

**Issue:** #1199
**Date:** 2026-10-05
**Status:** Draft for review
**Prototype:** *Warden's Field Survey* — exploration + vitality loop (Claude Artifact, not in repo)
**Companion:** [`region-exploration-design.md`](region-exploration-design.md)

---

## Summary

Every action in the artificer game — exploring, hunting, gathering, building,
tinkering, cooking — draws on the Warden's body and mind, and both must be
recovered. This document defines that economy:

- **Vigor** — physical energy. Shown as a coarse bar.
- **Clarity** — mental freshness. Shown as a coarse bar. *(Renamed from an
  earlier "Focus" to avoid colliding with the mind-**Focus** selection
  mechanic — see §7.)*
- **Condition** — a slow reserve of health/resilience. Semi-hidden. Only erodes
  when you overexert, slow to rebuild.
- **Will / Morale** — a hidden derived modifier (not a bar, not spent) that
  quietly makes everything cheaper or costlier.

The core idea is one unifying rule: **every activity is a per-unit-time vector
across Vigor and Clarity.** There is no separate "action economy" and "recovery
economy" — spending and recovering are the same mechanism with different signs.
Time is the multiplier, so a whole day exploring costs far more than a quick
look. Activities that tax the body let the mind settle, and vice versa, which
gives the natural rhythm: alternate body-work and mind-work, and sleep to reset
both.

No gameplay code is specified here — this is the model to implement against.

---

## 1. The two pools + the reserve

| Layer | Shown | Spent by | Restored by | Notes |
|---|---|---|---|---|
| **Vigor** | coarse bar | movement, hunting, gathering, building, hauling | food, rest, light/sedentary work, sleep | physical stamina |
| **Clarity** | coarse bar | tinkering, surveying/reading the land, planning, quality craft | sleep, calm, safe shelter, undemanding physical work | mental freshness |
| **Condition** | semi-hidden | *only* overexertion (time spent with a pool at empty) | slow — deep sleep + good food over days | injury / illness / burnout; the thing a run quietly loses |
| **Will / Morale** | hidden | — (derived) | — (derived) | rate modifier, §5 |

Two pools, not one, is deliberate: the interesting tension is being
**physically fine but mentally fried** (great time to haul timber, terrible time
to tinker) or the reverse. A single "energy" bar collapses that choice.

### Coarse bands

Each pool is read as a state, never a number (precision is unlockable — §6):

- **Vigor:** Fresh → Winded → Tired → Spent
- **Clarity:** Sharp → Foggy → Frayed → Burnt out

---

## 2. One rule: activities are per-time vectors

Model every activity as a **rate per unit of time** on each pool, multiplied by
how long you spend. There is no flat "action cost" — **duration is the cost.**

```
Δpool = rate_pool × hours × moraleMultiplier
```

This is what makes "spend the whole day exploring" cost more than "a quick look
and done" fall out for free — same rate, more hours.

An activity's vector can be **negative on one pool and positive on the other**.
That is the whole trick:

| Activity | Vigor / h | Clarity / h | Character |
|---|---|---|---|
| Explore / survey (on foot) | −− | − | drains both, body harder |
| Hunt | −− | − | physical, some focus |
| Gather / haul | −−− | ~0 | pure body |
| Build | −−− | − | heavy body, some planning |
| **Tinker / design in place** | **+** | **−−** | **mind drains, body rests** |
| Cook | − | ~0 | light |
| Rest (sit) | + | + (small) | gentle both |
| **Sleep** | **++** | **++** | the deep reset for both |

So after a session hunched over the workbench you're mentally spent but
**physically recovered and ready for heavy building or gathering** — exactly the
behaviour we want. "Recovery" isn't a special mode; it's just any activity whose
vector is net-positive on the pool you care about.

### Recovery paths don't compete, they specialise

- **Food** → refills Vigor, and sets its *ceiling* (underfed caps you low).
- **Sleep** → refills **both**, deeply; the one true reset. Quality scales with
  **shelter** (the Shelter/Safety factors from the site-rating doc feed straight
  in — a good outpost literally gives better sleep).
- **Rest** → slow trickle to both, free but costs time.
- **Cross-work** → mind-work tops up Vigor; body-work lets Clarity settle.

Because sleep refills both but the day-activities each lean one way, the player
naturally interleaves tasks during the day and sleeps to clear the deficit —
without ever micromanaging a recovery minigame.

---

## 3. Condition — the reserve and overexertion

Condition is **not spent directly.** You only touch it by pushing a pool past
empty: any time an activity would drive Vigor or Clarity below zero, the overage
is subtracted from Condition instead.

- Running on empty is **allowed** — "one more night" is always a choice — but it
  burns the reserve.
- Condition recovers **slowly**, only through real rest: deep sleep in shelter,
  good food, over days. You can't grind it back in an afternoon.
- Low Condition drags **Will** down (§5), which makes everything cost more — a
  gentle downward spiral that models exhaustion/illness without a hard failure
  state. In a run-based game, this is how a run erodes.

---

## 4. Soft-fail and couplings (why the pools matter)

Empty pools never hard-block an action. Instead they **degrade outcomes**, which
keeps player agency while making state meaningful:

- **Low Clarity → worse perception.** Exploring while Frayed yields
  lower-confidence tags and more misreads (this is the driver behind the
  "wrong-at-low-confidence" open question in the region doc). Crafting while
  Frayed drops quality and fails more often.
- **Low Vigor → worse throughput.** Slower movement, weaker hunts, smaller carry
  capacity, and rising injury risk (injury bites Condition).
- **Tools reduce the cost of the action they serve.** A proper axe lowers the
  Vigor rate of gathering; a workbench lowers the Clarity rate of tinkering. So
  crafting literally lowers the tax of crafting — progression you feel in the
  bars. This is the artificer fantasy expressed as an energy economy.

---

## 5. Will / Morale — hidden derived modifier

Will is **computed, never displayed, never spent:**

```
Will = f(Condition, traits, recent events)
```

- **Condition** is the dominant input — a worn body pulls morale down.
- **Traits** set each character's baseline and sensitivity (resilient vs.
  brittle).
- **Recent events** nudge it: a good meal, safe shelter, a discovery lift it;
  setbacks, failed crafts, isolation, injury pull it down.

It silently modulates:

- **Cost multiplier** — high Will makes Vigor/Clarity drains a little cheaper;
  low Will makes everything a slog.
- **Recovery rate** — high Will recovers more from the same sleep/food.
- **Outcome quality** — stacks on top of the Clarity/Vigor couplings (§4).

The player *feels* it ("today things flow / today everything's a slog") without
managing a gauge — the semi-hidden texture we're after. If ever surfaced, it
appears as **mood/flavour text**, never a bar.

---

## 6. Presentation — semi-hidden, precision as a crafted capability

Consistent with the region system's instruments idea:

- **Default: coarse bands + diegetic tells.** The two bars read as states
  (Fresh/Winded/…), reinforced by body language — heavier breathing, a shaky
  cursor, the screen desaturating as Clarity drops, slower steps when Vigor's
  low. Early game, the bars may not even be legible precisely.
- **Precision is crafted.** Numeric readouts (and *prediction* — "this hunt will
  cost ~30%") unlock when the Warden builds the instruments to measure
  themselves: a journal, a timepiece, later something biometric. Same
  progression that flips the region/site ratings from words to numbers.
- **Condition** stays the faintest readout — a thin reserve bar, numeric only
  with instruments.

---

## 7. Naming — Clarity vs. the Focus mechanic

"Focus" is reserved for the **mind-focus selection** mechanic (choosing to
concentrate on one or several concepts/tasks at once). The mental-energy pool is
therefore **Clarity**. The two interact cleanly rather than clash: you *focus*
on something, and doing so burns **Clarity**; when Clarity is low your Focus is
unreliable (you can still concentrate, you're just worse at it).

---

## 8. Tuning knobs & anti-chore guardrails

This system is spice, not a survival-sim chore. The levers:

- **Decay rates** — keep them slow and forgiving; the player should rarely feel
  nagged.
- **Recovery is mostly automatic** given resources — sleeping in a good shelter
  "just works"; attention goes to choices, not upkeep.
- **Positive buffs** — well-fed / well-rested grant small bonuses (cheaper
  rates, raised ceilings), so good prep is rewarded, not just neglect punished.
- **Pool caps** — food sets Vigor's ceiling, shelter/sleep sets Clarity's, so
  the world gates how much you can bank.

---

## 9. Implementation sketch

Illustrative, not final:

```ts
interface Vitals {
  vigor: number;      // 0..100, shown coarse
  clarity: number;    // 0..100, shown coarse
  condition: number;  // 0..100, reserve, semi-hidden
}

interface Activity {
  id: string;
  hours: number;                       // duration = the cost multiplier
  rate: { vigor: number; clarity: number }; // per hour; sign = drain/refill
  food?: number;                       // flat Vigor bump (eating)
  sleep?: boolean;                     // deep reset; quality scales with shelter
}

// One apply path for everything — spend and recover are the same op.
function apply(v: Vitals, a: Activity, ctx: { will: number; shelter: number }) {
  const drainMul = 1 + (0.6 - ctx.will) * K; // low Will costs more
  for (const pool of ['vigor', 'clarity'] as const) {
    let d = a.rate[pool] * a.hours;
    if (d < 0) d *= drainMul;                 // morale taxes drains, not refills
    if (a.sleep && d > 0) d *= (0.5 + 0.5 * ctx.shelter); // shelter → sleep quality
    const next = v[pool] + d;
    if (next < 0) { v.condition = clamp(v.condition + next * OVEREXERT, 0, 100); v[pool] = 0; }
    else v[pool] = clamp(next, 0, 100);
  }
}

const will = (v: Vitals, traits: number, events: number) =>
  clamp(0.35 + 0.4 * (v.condition / 100) + traits + events, 0.05, 1);
```

A single `apply()` handles exploring, building, tinkering, resting and sleeping
— they differ only in their vectors. Outcome couplings (§4) read the pool's
band at the moment the activity runs.

---

## 10. Open questions

1. **Time unit** — hours (as sketched) vs. abstract "effort points"? Hours make
   "a whole day" legible; confirm it fits the action-RPG moment-to-moment feel.
2. **Real-time vs. discrete** — do pools drain continuously while an activity
   plays out, or resolve as a lump when it completes? (The vector model supports
   both; the prototype resolves on completion for clarity of feel.)
3. **Trait system scope** — how many traits feed Will, and are they fixed per
   character or developed over a run?
4. **Does sleep ever fail to reset** — e.g. an unsafe site gives broken sleep
   that only partially clears Clarity? (Ties shelter Safety directly to the
   mental pool.)
5. **Surfacing Will** — stay fully hidden, or allow optional mood flavour text?

---

## 11. Relationship to existing systems

- **Region / exploration** ([`region-exploration-design.md`](region-exploration-design.md))
  — exploration actions are the headline Vigor/Clarity spenders, and the
  **site-rating Shelter/Safety factors feed sleep quality**, closing the loop:
  explore → find a good site → shelter → better recovery → explore further.
- **Crafting / recipes** — tools and workbenches lower activity rates (§4); the
  affordance table stays beside the recipe registry.
- **Focus mechanic** — untouched; Clarity is its fuel, not its replacement (§7).
- **Leaderboard / runs** — Condition erosion is the slow-burn failure vector for
  a run; worth wiring into run-end stats later.
