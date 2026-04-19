# Creature Queue Priority

The sprite credit-burn workflow (`agent-sprite-credit-burn.yml`) drains the queue in priority
order — lowest score first. This document explains how the score is computed, what weights to
tune, and a worked example.

## Formula

```
queue_priority =
    (graphics_difficulty ?? 3) × 1000     -- easier sprites first
  − days_since_approved                   -- oldest submissions first (1 pt per day)
  − 50  (if lore_entry_id IS NOT NULL)    -- lore already written
  − 100 (if first creature for submitter) -- encourage new contributors
```

Implemented as `public.creature_queue_priority(c creature_submissions)` in Postgres (STABLE
SQL function, reusable in queries and triggers).

## Component breakdown

### 1. Graphics difficulty base (weight 1000)

| `graphics_difficulty` | Base score |
|----------------------:|-----------|
| 1 — Very simple       | 1 000     |
| 2 — Simple            | 2 000     |
| 3 — Medium (default)  | 3 000     |
| 4 — Complex           | 4 000     |
| 5 — Very complex      | 5 000     |

NULL is treated as 3 (medium). The weight of 1 000 ensures difficulty dominates, so a very
simple creature always ranks above a very complex one, regardless of other bonuses.

### 2. Age bonus (−1 per day since `approved_at`)

Prevents old submissions from sitting in the queue indefinitely. A creature approved 30 days
ago gets −30 vs. one approved today. The cap is 0 (no negative age for future timestamps).

### 3. Lore bonus (−50)

A creature with a linked Notion lore entry (`lore_entry_id IS NOT NULL`) costs less overall
production effort: the lore auto-fill agent has already done its part. A −50 nudge prioritises
these ready-to-ship creatures over lore-incomplete ones at the same difficulty level.

### 4. First-submission bonus (−100)

The submitter's first creature to reach the `queued / spriting / in-game` stages gets an
extra −100. This rewards new contributors and keeps the queue from being monopolised by
prolific submitters. The check uses `creator_name`; once accounts land (FIL-331), it will
switch to `user_id`.

## Worked example

| Creature           | difficulty | days_since_approved | lore | first | score |
|--------------------|:----------:|:-------------------:|:----:|:-----:|------:|
| Simple + old lore  | 1          | 14                  | yes  | no    | 1000 − 14 − 50 = **936** |
| Simple + no lore   | 1          | 2                   | no   | yes   | 1000 − 2 − 100 = **898** |
| Medium, brand new  | 3          | 0                   | no   | yes   | 3000 − 0 − 100 = **2900** |
| Complex, 5 days    | 5          | 5                   | no   | no    | 5000 − 5 = **4995** |

The simple creature with lore already written and a long wait (936) beats the complex creature
(4995) by a wide margin.

## Tuning the weights

Edit `public.creature_queue_priority` directly in Supabase SQL editor or via a new migration,
then backfill:

```sql
-- After editing the function, recompute all queued rows:
update public.creature_submissions
set    graphics_difficulty = graphics_difficulty  -- touches the column, fires the trigger
where  status = 'queued';
```

The `creature_queue_update` trigger recomputes `queue_priority` on every UPDATE that touches
`graphics_difficulty`, `lore_entry_id`, or `status`, so the queue re-sorts automatically when
data changes.

## Indexes

```sql
-- Partial index used by the sprite workflow SELECT:
create index creature_submissions_queue_idx
  on public.creature_submissions (queue_priority asc)
  where status = 'queued';
```

The sprite agent drains the queue with:

```sql
select * from creature_submissions
where  status = 'queued'
order  by queue_priority asc
limit  N;
```

This hits the partial index and is O(log n) even with a large submission backlog.
