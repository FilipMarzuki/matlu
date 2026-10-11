---
name: Systems (ATDD)
about: Game logic, mechanics or simulation work — built test-first from Given/When/Then criteria
title: ''
labels: systems, type:feature
---

<!--
Systems issues are built test-first: the nightly dev agent turns each
Given/When/Then scenario below into a failing unit test, then implements until
it passes. Every scenario must be checkable WITHOUT a browser or Phaser —
pure logic, seeded RNG, time passed in explicitly.

Change `type:feature` if this is a bug/refactor/etc. Use the "Visual /
exploration" template instead for art, UI or world look-and-feel work.
-->

## Context

<!-- Why this is needed. Link related issues/PRs. -->

## Scope

<!-- Files or modules expected to change, e.g. `src/crafting/actions.ts`. -->

## Acceptance criteria

<!--
One scenario per distinct behaviour. Use concrete values ("2–4 lumber",
"after 5 ticks"), never adjectives ("feels good", "balanced").
-->

1. **Given** an empty inventory and a pine node yielding lumber 2–4
   **When** "harvest pine" is resolved with a seeded rng
   **Then** the inventory has 2–4 lumber and the log contains "+N lumber"

2. **Given** …
   **When** …
   **Then** …

## Test location

<!-- Where the acceptance tests should live, e.g. `src/crafting/actions.test.ts`. -->

## Out of scope

-

## Effort

<!-- XS / S / M / L / XL -->
