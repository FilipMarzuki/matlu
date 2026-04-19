---
title: "Hello World — Building Core Warden with AI Agents"
date: 2026-04-19
summary: "What this blog is about: building a game with a fleet of AI agents doing most of the implementation while the human steers the vision."
tags: ["meta", "agents", "core-warden"]
draft: false
---

**Core Warden** is a top-down action RPG set in the Matlu multiworld — a corrupted realm where a lone warden fights back waves of enemies and cleanses biomes one at a time. It's built in Phaser 4 + TypeScript and targets Android tablets (Chrome), with keyboard support. The tech stack is deliberately boring. The development process is not.

Most of the code here is written by Claude agents. A nightly implementation agent checks Linear for issues labelled `ready`, picks the highest-priority ones, and opens PRs — often 2–3 per night. A triage agent vets backlog issues each evening and decides which ones are shippable tomorrow. A PR grooming agent handles the merge queue, resolving conflicts when needed and moving Linear issues to Done. An error monitor queries Better Stack for new exceptions each morning and files bugs before the implementation agent starts its next cycle. The architecture review agent reads the codebase weekly and updates `ARCHITECTURE.md` if the reality has drifted from the description.

The human role in this loop is different from what you might expect. Not code review (mostly) — the PRs land clean. Not debugging — the error monitor catches regressions before they accumulate. The actual job is: write lore, steer creative direction, define what "done" looks like for each issue, and decide what goes on the roadmap next. This blog documents what's working, what's breaking, and what's genuinely surprising about building software this way. If you're building something similar — or wondering if you should — this is the field notes from someone who is.
