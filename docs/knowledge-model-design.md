# What people know — the knowledge model (design)

**Date:** 2026-10-11 · **Status:** proposal from the spike (#1577), for the owner to decide · **Prototype:** `src/artificer/knowledge.ts` + `knowledge.test.ts` (not read by the game yet)
**Builds on:** asks (#1495), noticing (#1496), leads (#1497), tells (#1499), free questions (#1575), feature switches (#1579)
**Feeds:** AI answers for free questions (#1574 v1), rapport (#1578), rumours, confidence and lies (#1580)

## The idea

People know things **because of who they are**: where they live, what they do, who they belong to,
and what happened to them. A smith knows iron because smiths do; an elder knows the village's past
because she's lived it; a goblin of the Compact knows Compact business and won't tell you; a Pandor
must tell you, because the Compact of Knowing obliges it. Ask someone about a topic and they answer
from the **most specific** thing they know (their own life before their guild's, before the
village's, before what everyone says), **if you've earned it**. Knowing nothing, they send you to
someone who would.

Today every answer is written by hand, per person, per topic. That can't grow to what players will
ask. The model lets most knowledge be written **once, for a scope**, and reach everyone in it, while
the few hand-written lines that give a person their voice stay exactly as they are.

## What exists today

- **Answers** are `ANSWERS[personId][topicKey]` in `asks.ts`: 13 people, six topic keys in use
  (iron, smiths, Kestrel Gate, the Compact, Tobin's hides quest, foraging). Teachers answer their
  own skill by rule (`teacherAnswer`). Each answer has a trust gate (0 / 25 / 50) and optional
  effects (insight, a lead).
- **People** (`villages.ts`, 17 in all: 13 villagers in 3 villages, 4 on the caravan) have `role`,
  `people`, `culture`, `personality`, `need`, trust-gated `lore`, and `teaches` / `concept`.
  **No organisation membership**: the Compact, the Pandor's Compact of Knowing, the Vidde Accords,
  the Dyprike and the Bergfolk holds live only in lore lines, signs (`notice.ts`) and comments.
  Villages have **no region field**.
- **The world generator already holds regional history**, unread. `world/provinces.ts` seats
  Hollowford, Saltmere and Kestrel Gate at generated provinces (`placeAnchors`), and
  `world/history.ts` runs 150 seeded years of the storytelling engine. Each province keeps a title,
  a holder and up to three dated events (`ProvinceHistory`), with a `LIVING_MEMORY` of 40 years.
  Today only the app's map reads it.
- **Cultures** (`macro-world/cultures.json`) hold layout only, no lore or values. The Reach's own
  culture specs (`world/peoples.ts`) carry drives and biases.
- **Perception vs truth is already a pattern**: skills' felt level (Dunning–Kruger, `skills.ts`),
  read vs real threat (`panic.ts`), how much of an injury you can see (`injuries.ts` `KNOWS`),
  exploration's unknown / suspected / observed / detailed.
- **One rule changes:** `villages.ts` promises that *what they tell you is true of the world*. The
  owner's call for #1580 is that people can be wrong and can lie. The model keeps the truth of
  every claim, so the game always knows; only what people *say* stops being guaranteed true.

## What players ask

Free questions (#1575) went live with #1576, and every question is kept in `artificer_questions`.
**None had been asked yet when this was written** (0 questions, 0 games on 2026-10-11). Re-read
this section against real questions once they come in:

```sql
select person, question, created_at from artificer_questions_unmatched limit 100;
select person, coalesce(topic, '(none)') as topic, questions, answered from artificer_question_counts order by questions desc;
```

Questions likely early on, and the scope that would answer each:

| Question | Who's asked | Answered from |
|---|---|---|
| "What happened to the mill?" | Maren (elder) | village fact, deep (elders) |
| "Who rules here?" | anyone in Hollowford | regional history: the province's holder and title |
| "Is the road to Mistheim safe?" | Bodil (caravan) | role: caravaneer, regional |
| "What do the Bergfolk believe?" | Orrin (Bergfolk) | people fact |
| "Where can I learn smithing?" | anyone | role: smith → a referral to Sabine |
| "Are you married?" | anyone | personal, private |
| "What is the Compact?" | Tobin / Anselm | organisation: secret / bound to tell |

## Design

### 1. Facts and scopes

A **fact** is one thing someone could say:

| Field | Meaning |
|---|---|
| `about` | the topic keys it answers (`material:iron`, `place:hollowford`, `group:compact`…) |
| `text` | what's said (a person's voice can override it, §6) |
| `scope` | who can know it (below) |
| `sensitivity` | `public` · `guarded` · `private` · `secret`: the trust it takes (0 / 25 / 50 / 75) |
| `truth` | `true` · `rumour` · `false`: what the world says. Never shown; claims are checked against it |
| `depth` | 1 everyone in the scope knows it, 2 most do, 3 only the best-placed |
| `lead` | someone it sends you to |

| Scope | Who's in it | From |
|---|---|---|
| `world` | everyone | — |
| `region:<id>` | everyone living or travelling there | a new `region` on villages (the road's region); the Reach's provinces |
| `village:<id>` | its people | `VILLAGES` |
| `people:<id>` / `culture:<id>` | members of a People / culture | `Person.people`, `Person.culture` |
| `org:<id>` | members, with a rank | **new** `Person.orgs` (§4) |
| `role:<id>` / `skill:<id>` | the job; the skill they teach | `Person.role`, `Person.teaches` |
| `person:<id>` | them alone | the person's sheet (§5) |

### 2. Who knows what: belonging and reach

A person knows a fact when they **belong to its scope** and **reach deep enough**. Reach is 1 unless
their place says otherwise: an elder reaches 3 into their village; a trader 3 into the region (they
hear the road's news); an organisation's depth is a member's **rank**. So not every villager knows
everything about their village, and the newest member of the Compact doesn't know what an old hand
does. No randomness is needed. If "some do, some don't" is wanted later, a hash of person and fact
ids gives it without touching any RNG stream.

### 3. Answering

Asked about a topic, with your trust:

1. **A lie, if they'd rather not say** (#1580): they say something else, for a reason, until trust
   reaches the point they'd stop. The game records it as a lie; the player hears an answer.
2. **The most specific fact they know**, in the order *person → org → role → skill → village →
   culture → people → region → world* (Morrowind's "first match wins" filter order, by scope).
3. **Gated:** told if trust reaches its gate, else *not yet*. An organisation lifts its facts'
   gates to its secrecy toward outsiders; one *bound to tell* (the Pandor's Compact of Knowing)
   opens every gate.
4. **Knowing nothing, a referral:** the person who holds the most specific fact about it
   (*transactive memory*: groups remember who knows what). That's a lead (#1497), now generated
   instead of hand-written, and a leads chain grows from the data.

Answer kinds stay those players already know (*told*, *not yet*, *doesn't know*), plus the hidden
*lied*. **The gate is always decided in code**, never by an AI voicing the answer.

### 4. Organisations

A small registry: id, name, **secrecy toward outsiders** (`open`, `guarded`, `secret`,
`bound-to-tell`), and later a **reliability as a source** and the Warden's **standing** with it
(#1578). Members are listed on people (`orgs: { compact: 2 }`), so a person can belong to several.

| Organisation | Secrecy | Members today (from lore and signs) |
|---|---|---|
| The Compact (goblin bands) | secret | Tobin, Arvid, Pim |
| The Pandor's Compact of Knowing | bound to tell | Anselm |
| The Vidde Accords | open | Yrsa; the Viddfolk heralds; cv-runa |
| The Dyprike | guarded | none known (only Orrin speaks of it) |
| A Bergfolk hold | guarded | Orrin (left), kg-runa, Sabine (hold-trained) |
| The caravan | open | Bodil, Pim, Ottilia, cv-runa |

Lore in brackets ([Keeper], [Heralds], [Watermaster], [Delvers]) reads as ranks or offices within
organisations, which fits rank-as-depth.

### 5. Personal knowledge

The hardest layer, and the one that makes people people. A **person sheet** of four parts:

- **Their life:** already partly there (`personality`, `need`, `lore`). Facts at `private`.
- **Ties:** family, friends, grudges, as a small graph between people (Orrin's sister's girl
  hunts the high streams). Ties also give **opinions** of each other, which can be wrong.
- **Secrets:** one to three hand-written per person, at `secret`.
- **What happened to them**, including deeds they witnessed: the hunter by the stream (#1499)
  becomes a fact Orrin's family knows, not only a hand-written tell.

Everything else a person knows comes from their scopes. The writing load is a short sheet per
person, not a table of every topic.

### 6. Where facts come from, and how they sound

- **Hand-written, per scope**, in content files beside the people. Most new knowledge goes here,
  guided by the unmatched questions.
- **Generated from the world:** each anchored province's history becomes **regional facts**:
  who holds it, its title, its last events, with years. Events within `LIVING_MEMORY` are
  `true` and depth 1–2 (people remember them); older ones are depth 3 and `rumour` (legends drift).
  This needs the history in the sim (it runs in a worker today), so it's its own slice.
- **Voice:** one line per fact to start. A person's own line overrides it (today's `ANSWERS`
  become person-scope facts, word for word). Per-People wording templates can come later.

### 7. Claims, confidence, rumours and lies (the hook for #1580)

The model carries what #1580 needs from the start: each fact's `truth`, and a **hedge** from where
it sits (*"I saw it myself"* for personal, *"Everyone says"* for regional and world, *"I heard"* for
a rumour). A person can hold a `false` fact and say it with full confidence. Lies are on the person,
with a reason and the trust at which they stop. #1580 adds the player's journal of who said what,
corroboration, drift as facts travel, and reading a lie (weakly: people manage about 54%).

### 8. How each part of the game reads it

| Reader | Today | With the model |
|---|---|---|
| Ask about your focus (#1495) | `ANSWERS` lookup | `answer(person, focusKey, trust)`; same outcomes, more people know more |
| Free questions (#1575) | matches the keys in `ANSWERS` | matches the topics the person **knows facts about**; coverage grows with every fact written |
| AI answers (#1574 v1) | — | the prompt is the person's sheet + the facts they know about the matched topics **that pass the gate** + who they'd refer you to. The model only voices them; the gate is code, so it can't leak or invent |
| Leads (#1497) | hand-written on answers | also generated from referrals |
| Noticing (#1496) | `SIGNS` per person | signs of organisation membership come from `orgs` |
| Rapport (#1578) | trust gates per answer | sensitivity tiers are the gates; the felt word never changes a gate |

## The prototype

`src/artificer/knowledge.ts` (pure, about 150 lines) with `knowledge.test.ts` (7 tests), using data
kept in the test so the game is untouched: seven facts across world, region, village, role,
organisation and person scopes, and four people. It shows:

- the most specific fact winning (Orrin's smith's craft over the road's rumour about iron);
- a guarded fact held until trust opens it, and a private one at 50;
- someone confidently wrong (Maren repeats the road's false rumour: `truth: 'false'`);
- a lie with a reason (Tobin on the Compact, until trust 50), then the Compact's secrecy still
  holding until 75;
- an organisation bound to tell (Anselm on the Compact, at trust 0);
- reach (the elder knows the mill's history; the trader passing through doesn't, and sends you
  to her);
- referrals to the most specific knower, and to no one when nobody here knows.

## Rules the build must keep

- **Pure and deterministic.** No new RNG draws; anything per-person-varied uses a hash of ids.
- **Gates in code.** An AI voices answers; it never decides what's revealed.
- **Saves don't change.** What's been told stays a list of topic keys per person (`asked`).
- **Today's answers keep their words.** `ANSWERS` become person-scope facts unchanged, so nothing a
  player has read changes.
- **The truth is always known to the game**, even when what's said isn't.

## Slices (each its own issue)

| | Slice | Kind |
|---|---|---|
| A | The fact model and resolution in the game; `ANSWERS` and teacher answers moved into it with no change in what anyone says | systems |
| B | Organisations: registry, `Person.orgs` with ranks, secrecy, the Pandor bound to tell | systems |
| C | Scope content: village, region, People and role facts, written against the unmatched questions | lore |
| D | Person sheets: ties, opinions, secrets | lore + systems |
| E | Free questions match the model's topics; AI answers (#1574 v1) voice its facts | systems |
| F | Regional facts from the generated provinces' history (the history into the sim) | systems |
| G | Claims and confidence, the journal, drift, reading lies (#1580) | systems + ui |

A first, then B and C together; E as soon as A lands.

## Questions for the owner

1. **Truth vs rumour:** how often should people be confidently wrong, and how often lie? (The
   prototype has one of each among four people.)
2. **Voice:** one line per fact, or per-People wording from the start?
3. **Regional facts:** generated from the world's history (slice F), hand-written, or both?
4. **Organisations:** which get ranks, and can the Warden join one?
5. **The road's region:** do the three villages share one region (the north road), or each sit in
   their generated province's region?
6. **Changing the promise:** `villages.ts` says what people tell you is true of the world. With
   #1580 it isn't always. Is the lore pass's canon rule ("nothing they say should contradict canon")
   kept for *true* facts only?

## Research

The full list, with sources, is in #1577. The short version:
- **Morrowind**: most specific answer wins, by scope.
- **Talk of the Town** (Ryan et al., 2015): beliefs with source and confidence that spread and
  mutate.
- **Social penetration theory** (Altman and Taylor, 1973): sensitivity tiers.
- **Transactive memory** (Wegner, 1985): referrals.
- **Cultural consensus theory** (Romney, Weller and Batchelder, 1986): shared vs personal
  knowledge, and some people know more.
- **Tacit vs explicit knowledge** (Polanyi; Nonaka and Takeuchi): answers vs lessons.
- **Weak ties** (Granovetter, 1973): travellers carry news.
- **Lie detection** (Bond and DePaulo, 2006): about 54%.
