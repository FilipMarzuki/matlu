# The Ether — design doc

Status: **design** (no engine code yet) · Issue: #1131

The Ether is the spirit realm, one of the worlds merging into the Matlu multiworld.
This doc covers what it is, the rules it follows, the events it adds to generated
histories, and how to build it into the story engine (`storytelling/`).

---

## 1. Where it happens: Mistheim is the base world

The unified multiworld uses **Mistheim as its base**. Every merging realm
(Spinolandet, the Ether, and any later ones) merges *into Mistheim*. Its events
happen to Mistheim's provinces, peoples, dynasties and Class system. There is no
separate Ether map, and no Ether history runs on its own.

In practice this means:

- The Ether has no provinces of its own. It is a **layer over Mistheim's
  provinces**, measured by one value per province: the veil (§3).
- Spirits are Mistheim's own dead. Ether events act on Mistheim characters.
- Ether Skills and abilities (§6) belong to Mistheim's Class system.

---

## 2. What the Ether is

> The Ether is the land made of what people remember about it.

It has the same hills, rivers and halls as Mistheim. A place people remember
well is solid there: a great hall is sharp down to the grain of its beams. A
forgotten village is fog with a path through it. Nothing in the Ether is built.
It *accumulates*.

The Ether holds three kinds of things:

- **The lingering dead.** These are the few who could not move on (§4).
- **Place-spirits.** A river, a mountain or an old grove, carrying the weight of
  everyone who ever depended on it. They are old, slow and not human-shaped.
  They are not sentient in the way people are, so the breach rules (§3) do not
  apply to them. Only their *influence* reaches Mistheim, as mood, weather and
  luck.
- **Weighted things.** Oaths, grudges, and stories told so often that they gained
  mass. They are not alive, but they can be *felt*. An oath sworn where the veil
  is thin is still there after the people who swore it are gone.

It is **not** the afterlife. The afterlife, whatever it is, lies somewhere past
the Ether. The Ether is only the waiting room, and most people pass straight
through it.

**No dead gods here.** Mistheim's dead gods belong to Mistheim's own deep past
(see `WORLD.md`). They are not in the Ether and cannot be reached through it.

### Spirits are not the undead

The undead are **bodies without a spirit**. Ghosts are **spirits without a
body**. The two can appear in the same history but are different things with
different causes. Undead come from necrotic corruption (`catastrophe.ts`);
ghosts come from anchors (§4). A spirit never animates its own corpse.

### The Ether's corruption: forgetting

Earth's corruption accelerates collapse, Spinolandet's simplifies, and
Mistheim's hollows things out. The Ether's corruption makes spirits **forget**.

A lingering spirit whose anchor can never be resolved slowly forgets everything
except the grievance that holds it: first its name, then who it loved, then
where it lived. What remains is a **wraith**, a grievance with a shape. When
many wraiths gather, the forgetting starts to spill into the living world
(§5.5).

---

## 3. The veil

### 3.1 The veil value

Each province gets one value, **`veil`**, from **1.0** (solid, sealed) down to
**0.0** (open). Mistheim starts with a high veil everywhere. After the
convergence (§5.1) it slowly drops everywhere, but it drops *faster* where
memory and death build up:

| Thins the veil | Why |
| --- | --- |
| A battle fought in the province | Many deaths in one place |
| Plague or famine deaths | Mass deaths remembered by everyone |
| Murder, especially of a ruler | A death that is talked about for generations |
| An old dynastic seat (long continuous rule) | Centuries of attention on one hall |
| Sacred groves, high mana (`manaDensity`) | Places already charged with meaning |

| Thickens the veil (slowly) | Why |
| --- | --- |
| Long peace and prosperity | People stop dwelling on the dead |
| A spirit moving on (§4) | The anchor holding the place open is gone |
| Deliberate sealing rites (later phase) | Wardens and priests closing thin places |

A province below about **0.35** is a **thin place**. Most Ether events require
one.

### 3.2 Seep, contact, breach

The most important rule: **the veil is a real wall**. A lot seeps through it,
some things touch through it, and almost nothing sentient crosses it.

| Tier | What happens | How often |
| --- | --- | --- |
| **Seep** | Cold, whispers, a mood settling over a valley, omens, place-spirits' influence on harvests and luck | Common in thin places |
| **Contact** | A lingering spirit is seen or heard. A listener hears through the veil. A dreamer meets the dead in sleep. **Nobody crosses.** | Rare, and only in thin places or through gifted people (§6) |
| **Breach** | A living sentient being physically enters the Ether, or a spirit takes a body or form in the world | **Legendary**: at most a handful of times per world, often never |

Breach events are **capped per world** (a hard cap, e.g. at most 1 of each
type), heavily gated, and scored very high by the sifter. A 200-year history
should usually contain **zero or one** breach. Its rarity is what makes it
matter.

---

## 4. The dead: linger or move on

**Most of the dead move on straight away, and once gone they are gone for
good.** They cannot be called back, questioned or summoned. There is no general
necromancy of spirits, no ancestor on call, and no séance that reaches a
peaceful grandmother. When the living talk to "the ancestors", they are almost
always talking to nobody.

A spirit **lingers** only when something **anchors** it. The check runs once,
at death:

| Anchor | Condition at death | What it leads to |
| --- | --- | --- |
| **Unavenged murder** | Killed by a scheme whose perpetrator is not exposed | `UNQUIET_DEAD` |
| **Grudge** | Dies holding a strong grudge against a living target | `GRUDGE_OUTLIVES` |
| **Broken oath** | Was betrayed by an oath sworn at a thin place | `OATHBREAKER_MARKED` |
| **Last of the house** | Their death makes the dynasty extinct | `HOUSE_GHOST` |
| **Unsettled house** | A founder or ruler dies while their house's hold on its title is in open dispute | `FOUNDER_LINGERS` |
| **Violent death in a thin place** | Dies in battle in a province with low veil | `GHOST_PARLEY` (as part of a host) |

Even when an anchor exists, lingering is a **probability** scaled by how thin the
veil is, not a certainty. In a sealed province, even the murdered usually move
on.

### Resolving an anchor

When an anchor is resolved, the spirit **moves on permanently**
(`SPIRIT_MOVES_ON`):

- Unavenged murder: the killer is exposed, dies, or confesses.
- Grudge: the target dies or is ruined, or the grudge is repaid by an heir.
- Broken oath: the oathbreaker makes amends or dies marked.
- Last of the house: the seat passes to someone who restores the house's name
  (e.g. an adoptive heir), or the hall falls.
- Unsettled house: the dispute ends, whichever way it ends.

These give story arcs a clean ending: the haunting ends and the dead rest.

### Unresolvable anchors become wraiths

If an anchor cannot be resolved (for example, the grudge target died *first*,
or the house can never be restored), the spirit starts forgetting (§2). After
decades it becomes a **wraith** (`SPIRIT_BECOMES_WRAITH`). A wraith can no
longer move on in the normal way. It can only be ended by a hero (§5.5).

---

## 5. Ether-dominated events

Every event below happens **in Mistheim** and requires the convergence (§5.1)
to have happened. The tier column is from §3.2.

### 5.1 The merging

| Event | Tier | Summary |
| --- | --- | --- |
| `VEIL_WHISPERS` | seep | Before the convergence: graves that hum, dreams everyone shares. These are omens and can live beside `specs/omens-events.ts`. |
| `ETHER_CONVERGENCE` | seep | Once per world. The Ether begins merging into Mistheim, and every province's veil starts to drop. It unlocks everything below. |
| `THIN_PLACE_RECOGNIZED` | seep | A province crosses the thin-place threshold. Pilgrims, shrines, fear. |
| `VEIL_THICKENS` | seep | A long-thin place seals again after its anchors resolve. |

### 5.2 The dead in politics (contact)

| Event | Summary | Engine hook |
| --- | --- | --- |
| `UNQUIET_DEAD` | A murder victim haunts the killer. The killer turns paranoid and the chance of exposure rises each year. | `schemes.ts` discovery, `perception.ts` (`paranoid`) |
| `GRUDGE_OUTLIVES` | The grudge passes onto the target's line as a curse. Heirs feel it: opinion drops and bad luck follows. | `Character.grudges`, `inheritance.ts` |
| `FOUNDER_LINGERS` | During a succession crisis, a lingering founder is seen backing one claimant. This boosts that claimant's legitimacy, and rivals call it a staged ghost. | `specs/succession-legitimacy.ts` |
| `HOUSE_GHOST` | The last of a house haunts its old seat. Each new holder is uneasy, and their rule is shorter and more troubled. | dynasty extinction |
| `TRIBUNAL_OF_THE_DEAD` | A kinslayer's lingering victim(s) stand in judgment at a thin place. The kinslayer is marked, loses claims, or breaks. | sifter "kinslaying" shape |
| `SPIRIT_MOVES_ON` | An anchor resolves and the spirit is gone. Closes the arc. | all of the above |
| `SPIRIT_BECOMES_WRAITH` | An unresolvable anchor has worn the spirit down to only its grievance. | §4 |

### 5.3 Meetings at thin places (contact)

| Event | Summary |
| --- | --- |
| `ETHER_MOOT` | Rulers of warring or feuding titles meet at a thin place. The lingering dead of both sides are present and watching. Violence there is unthinkable (like Mistheim's inns), and a truce is sworn. **The living stay on their side of the veil.** |
| `GHOST_PARLEY` | After a bloody war fought across a thin province, the fallen of both hosts are seen standing together. The war ends from shame or exhaustion. The peace resolves the host's anchor, and they move on together. |
| `OATH_WITNESSED` | A treaty or marriage is sworn at a thin place and gains weight in the Ether. |
| `OATHBREAKER_MARKED` | Someone breaks a witnessed oath. The mark follows them: allies drift away and the betrayed may linger. Hooks into `specs/betrayal-events.ts`. |

### 5.4 Bargains with place-spirits (seep)

Place-spirits are not sentient beings, so dealing with them needs no breach.
Their influence seeps through.

| Event | Summary |
| --- | --- |
| `SPIRIT_PACT` | A ruler makes a bargain with a river, mountain or grove for good harvests, protection or passage. The price is queued decades ahead (reusing the delayed-step queue from `catastrophe.ts`): a name, a child's gift, a tradition given up. |
| `PACT_PRICE_PAID` | The price comes due and is paid. The chronicle remembers what it cost. |
| `PACT_BROKEN` → `SPIRIT_WRATH` | The price is refused. Floods, failed harvests, a province turning cold for a generation. |

### 5.5 The Unremembering (catastrophe chain)

A new `CatastropheTemplate` in `catastrophe.ts`, flavoured by a new corruption
type, `"hollow"`:

1. **Wraiths gather.** A thin province holds several wraiths at once.
2. **The forgetting spills over.** The veil tears (`VEIL_TEARS`). Neighbouring
   provinces thin.
3. **Names are lost** (`NAMES_FORGOTTEN`). A dynasty loses its lineage memory,
   and claims based on ancestry weaken. Culture drift loses traditions, and
   language may lose words.
4. **Closing the tear.** A hero challenge (`challenges.ts`) to end the wraiths.
   Success gives `TEAR_CLOSED`, and the veil begins to thicken again.

### 5.6 Breach (legendary, capped per world)

| Event | Summary |
| --- | --- |
| `LOST_IN_THE_ETHER` | An army, caravan or royal party passes through a very thin place and vanishes. |
| `RETURNED_FROM_THE_ETHER` | Decades later they walk back out, **unaged**. A returned heir can press a claim nobody expected. This is the best story generator in the set. |
| `POSSESSION` | A lingering spirit takes a living body. The host's drives are overwritten and courtiers notice. It ends when the anchor resolves or the host dies. |
| `SPIRIT_TAKES_FORM` | A lingering spirit gains a body of its own in Mistheim and becomes a (very strange) character. Once per world, at most. |

---

## 6. Ether gifts: dreams and listening

Contact through people is **rare**. It comes from one of two sources, matching
how Mistheim works: as **innate gifts** some people are born with, or as
**Skills** unlocked on certain paths.

### 6.1 Innate gifts (manifest in some)

| Gift | How it appears |
| --- | --- |
| **Dreamer** | Rare at birth, and more likely for a child born in a thin place or during the convergence year (`ETHERBORN`). Their sleep sometimes brushes the Ether: they meet lingering spirits in dreams and wake knowing things they shouldn't. Contact only; the dreamer never crosses. |
| **Veil-sighted** | Sees lingering spirits while awake in thin places. Often mistaken for madness. |

The gift is recorded when it first shows (`GIFT_MANIFESTS`), which can happen
years after birth, often after a close death.

### 6.2 Skills (unlocked by circumstance or path)

These are Mistheim Class Skills, stored in the existing `Character.skills`
array. Each is earned by *what the character lived through*:

| Skill | Unlocked by |
| --- | --- |
| `[Dreamwalk]` | A **Dreamer** who reaches a level milestone after resolving a spirit's anchor. This lets them *seek out* a specific lingering spirit in sleep, instead of waiting to be visited. |
| `[Hear the Unquiet]` | Surviving a haunting (`UNQUIET_DEAD` or `HOUSE_GHOST`) without breaking. |
| `[Oathkeeper's Witness]` | Presiding over an `ETHER_MOOT` or `OATH_WITNESSED` whose oath was then kept for 20+ years. |
| `[Lay to Rest]` | Personally resolving anchors that let two or more spirits move on. This is the path of the spirit-tender. |
| `[Speak with the Place]` | Holding a `SPIRIT_PACT` and paying its price in full. |

Listening, dreaming and laying spirits to rest are **contact**. **No Skill grants
breach.** The breach events in §5.6 stay rare accidents of the world, not
abilities anyone can learn.

A new class, `spirit_tender`, can emerge in thin provinces (like `warden` and
the other rare classes). It is a *listener and closer*, not a traveller.

---

## 7. Story shapes for the sifter

New multi-event shapes for `sifter.ts`:

| Shape | Sequence |
| --- | --- |
| **The dead have their due** | undiscovered murder → `UNQUIET_DEAD` → killer exposed or dead → `SPIRIT_MOVES_ON` |
| **The king who returned** | `LOST_IN_THE_ETHER` → decades pass → `RETURNED_FROM_THE_ETHER` → claim pressed |
| **The pact's price** | `SPIRIT_PACT` → prosperity → `PACT_PRICE_PAID` / `SPIRIT_WRATH` |
| **The peace of the dead** | war → `GHOST_PARLEY` → treaty → the host moves on |
| **The unremembered house** | `HOUSE_GHOST` → anchor never resolves → wraith → `NAMES_FORGOTTEN` |

Arc grouping: haunting events share an arc key on the **spirit** (`S:<charId>`),
so a haunting reads as one thread from death to rest.

---

## 8. Engine plan

This follows the CLAUDE.md story-engine checklist. Everything is behind an
**`--ether`** flag (`World.etherEnabled`), the same way magic and catastrophes
work, so the default and frontier worlds stay byte-identical and **no golden
hashes change** while the flag is off.

| Layer | File | Change |
| --- | --- | --- |
| Data model | `types.ts` | `Province.veil`, `Character.spirit?` (`{ anchor, sinceYear, forgotten, wraith }`), `Character.gifts?`, `corruptionType: "hollow"`, `CharClass: "spirit_tender"`, new `EventType`s |
| Spec | `world-spec.ts` | Optional `veil` per province (default 1.0) |
| Seed | `seed.ts` | Initialise `veil` |
| Simulation | `tick.ts` + new `ether.ts` | Veil thinning/thickening pass; linger check on death; anchor resolution; forgetting |
| Psyche | `perception.ts` | Haunting pushes toward `paranoid`; dreamers get a bias |
| Culture | `culture-drift.ts` | Thin places push ancestor-veneration pressure; `NAMES_FORGOTTEN` erodes traditions |
| Catastrophe | `catastrophe.ts` | The Unremembering template; `"hollow"` corruption |
| Magic | `magic.ts` | `spirit_tender` class access in thin provinces; Ether Skills |
| Sifter | `sifter.ts` | Scores (breach events highest) + the shapes in §7 |
| Renderer | `render.ts` / specs | Prose for every event |
| Tests | `testkit.ts` | New `--ether` golden hash; invariants: breach cap respected, a moved-on spirit never reappears |

Most events can be single entries in a new **`specs/ether-events.ts`** using
the `EventSpec` pattern (`event-spec.ts`).

### Invariants (enforced by tests)

- A character whose spirit has moved on is **never** the actor of a later Ether
  event.
- Breach event counts never exceed their per-world caps.
- No Skill or class action produces a breach event.
- With `--ether` off, the event log is byte-identical to before.

### Phases

1. **Foundation**: `veil`, `ETHER_CONVERGENCE`, `THIN_PLACE_RECOGNIZED`, the
   linger-or-move-on check at death, `SPIRIT_MOVES_ON`.
2. **The dead in politics**: `UNQUIET_DEAD`, `GRUDGE_OUTLIVES`, `HOUSE_GHOST`,
   `FOUNDER_LINGERS`, plus the "dead have their due" shape.
3. **Meetings**: `ETHER_MOOT`, `GHOST_PARLEY`, `OATH_WITNESSED`,
   `OATHBREAKER_MARKED`.
4. **Gifts and Skills**: Dreamer / Veil-sighted, the §6.2 Skills,
   `spirit_tender`.
5. **Bargains**: `SPIRIT_PACT` and its price chain.
6. **Forgetting**: wraiths, the Unremembering, `"hollow"` corruption.
7. **Breach**: `LOST_IN_THE_ETHER` / `RETURNED_FROM_THE_ETHER`, `POSSESSION`,
   `SPIRIT_TAKES_FORM`, all capped.

Each phase is its own issue and PR.

---

## 9. Writing the Ether (lore guidance)

Follows `WORLD.md`: grounded first, then strange; spare prose.

- **Start from mourning, not from horror.** Unease starts with an empty chair
  at the table, a name nobody says, a cold spot where someone used to sit.
- **Ghosts want one thing.** A lingering spirit is defined by its anchor. It
  does not give prophecies or advice. It wants its killer named.
- **Rest is the reward.** The satisfying end of an Ether story is someone
  finally being gone.
- **Avoid:** friendly ancestor councils, summoning the dead on demand, portals
  anyone can walk through, and the Ether as a place to visit.
