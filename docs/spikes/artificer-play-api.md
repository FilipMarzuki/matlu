# Spike: play the Artificer over MCP, an HTTP API and a text console (#1553)

**Ask (owner, 2026-10-10):** make the Artificer playable as text by anyone's AI over the web, and by people, through an API or an MCP server. Publish the game testing data on a website, and later add achievements based on how you compare with others.

**Owner's answers while planning:**
- **Who:** external players, meaning anyone's AI over the web, and people. Not just our own agents.
- **Turn size for external players:** one action per call. It feels more like playing, and the player's own AI pays for the tokens.
- **Records:** all of the above. Every finished game counts, and results show on both the Artificer site and the dev site.

## What exists

The AI benchmark harness (`src/artificer-ai/`, `npm run ai:play`) already has most of the game side:

| Piece | Where | What it gives |
|---|---|---|
| The text a model sees | `observe.ts` | `RULES` (static, so prompts can be cached) and one view per phase: `observe`, `observeEncounter`, `observeMeeting`, `observeRoad`, `observePack`. Same information as the page shows a person. |
| What a model may do | `decision.ts` | JSON shapes and strict parsers for a day plan, a road day, an encounter choice, a pack. |
| The loop | `runner.ts` | observe → decide → apply through every phase: the Reach, encounters, the caravan meeting, the road. |
| The game itself | `src/artificer-app/controller.ts` | DOM-free and stage-aware: `act` (do one thing now), `choose`, `endTheDay`, `runQueuedDay`, the meeting, the road, plus `serialize`/`deserialize` (`SAVE_VERSION` 7). |

What's missing is **who calls whom.** Today our script calls the model. Here the model, or a person, calls the game.

## The approach

**Games run on our server.** The client holds a short game id; the state stays with us.
- **Nobody can peek:** the seed, and with it the future weather and encounters, never leaves the server.
- **Every finished game is trustworthy as a record.** Only runs from the main web page, where the sim runs in the browser, need checking (phase 6).

**One session core** (`src/artificer-play/session.ts`, phase 1) wraps the controller and the text views:

```
startGame({ seed?, name? })  → game
view(game)                   → { phase, text, status, moves }
apply(game, move)            → { game, ok, changed, view } | { ok: false, error, moves }
serialize(game) / deserialize(text), GAME_VERSION
```

- **Phases:** `day`, `encounter`, `meeting`, `road`, `road-encounter`, `ended`.
- **Moves are plain data:** `{ do }`, `{ endDay }`, `{ plan }`, `{ choose }`, `{ set }`.
- **Each move returns only what changed** (new journal lines and a status line), with the full view on demand. That keeps an AI player's context, and its owner's token bill, small.

**Three ways in, all over that core:**

1. **HTTP API** (phase 2). Vercel functions in the Artificer's project:
   - `POST /api/v1/games`, `GET /api/v1/games/:id`, `POST /api/v1/games/:id/moves`, `GET /api/v1/rules`.
   - Games are stored in Supabase (`artificer_games`). Only the server writes.
   - Per-IP limits on games started and moves made.
2. **Remote MCP server** (phase 3) at `artificer.corewarden.app/mcp`.
   - Anyone adds it in claude.ai as a custom connector, or in any client that speaks remote MCP.
   - Tools: `new_game`, `look`, `act`, `plan_day`, `choose`, `rules`.
3. **Text console for people** (phase 4) at `/console`. The same text game in the browser, played through the API.

**Run records** (phase 5): every finished game writes a row in `artificer_runs`.
- **Who:** player kind, model (self-reported) and client.
- **How and which game:** where it was played, and the game version.
- **The outcome and key measures.**

The nightly AI playtest uploads its runs too. Two pages read them live from Supabase, through the play API (`GET /api/v1/runs`, cached a minute at Vercel's edge): **Records** on the Artificer site for players, and an **AI page** on the dev site for progression and cost by model.

**Fair comparisons and achievements** (phase 6):
- **Web-game runs** are submitted with their seed and moves, and **re-simulated** on the server before they count. The sim is deterministic, so a replay is exact.
- **A weekly shared seed** means everyone plays the same world.
- **Achievements** are percentiles over the records.

## Decisions

| Decision | Why | Rejected alternative | Wrong if… |
|---|---|---|---|
| Games run and live on the server; clients hold an id | no peeking at the seed; finished games are trustworthy records without replay checks; short ids keep an AI's tool calls small | a stateless signed token (seed + moves) passed on every call | storage or function costs outgrow the free tiers at the traffic we get |
| One action per call for external play, with `plan_day` as an option | the owner's call: it feels like playing, and the player pays for their own tokens; it's also the base game, since planning a whole day is unlocked later | whole-day plans only, like the benchmark | players' AIs run out of context in a full year; then lean on `plan_day` and the compact deltas |
| Each move returns only what changed, plus a status line | an external AI's context and token bill stay small over a game of hundreds of moves | the full observation on every move | models play noticeably worse without the full view (measure with the bench) |
| One session core behind HTTP, MCP and the console | one place for the rules of play, and every way in writes the same records | building the MCP server straight on the controller | one surface needs something the others can't share |
| Live reads from Supabase for the records pages, through the play API (#1558) | new results never cost a deployment (the Vercel free tier allows 100 a day); the table stays server-only and no browser key is needed; the edge caches the list a minute | baking data into the site at build time; a public-read policy and the publishable key in each site | Supabase's free-tier reads or Vercel's function calls become the limit |
| No accounts, anonymous play, optional nickname | the audience includes kids; no personal data to protect | sign-in for players | abuse beats per-IP limits (then add a light challenge, not accounts) |

## Costs

- **Tokens:** an external player's AI runs on their side, through their subscription or API key. Our server only runs the game rules, a few milliseconds per call.
- **Hosting:** Vercel function calls and Supabase rows, both on the free tiers at hobby scale. Function calls aren't deployments, so they don't touch the 100-deployments-a-day limit.
- **Our own spend** doesn't change: the nightly AI playtest's OpenRouter budget.

## Phases (each its own issue)

1. **Game session core** (#1554), tests first.
2. **HTTP API and game storage** (#1555). Owner step: add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the `matlu-artificer` project's environment.
3. **Remote MCP server and a "Play with your AI" page** (#1556).
4. **Text console for people** (#1557).
5. **Run records, the Records page, the AI page on the dev site** (#1558).
6. **Web-run submission (re-simulated), a weekly seed, achievements** (#1559).

## Open questions (decide when the phase starts)

- **MCP SDK:** the official TypeScript SDK on a Vercel function, or the plain Streamable HTTP protocol by hand. The SDK unless it fights Vercel's function runtime.
- **Limits:** the exact per-IP numbers. Start strict (say 20 games and 5,000 moves a day per IP) and loosen with real traffic.
- **The model name on the board** is whatever the player reports, shown as "self-reported"; the MCP client's own name is recorded alongside it.
