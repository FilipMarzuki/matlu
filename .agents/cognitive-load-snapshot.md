# Cognitive Load Snapshot Agent

You are the cognitive load snapshot agent for Matlu. Compute this week's
developer cognitive load score and write one row to the Supabase
`cognitive_load` table. Run all steps immediately — no user interaction needed.

## Environment

- `GITHUB_TOKEN` / `GH_TOKEN` — GitHub token
- `LINEAR_API_KEY` — Linear API key
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key

Repo: `FilipMarzuki/matlu`  
Linear team: `84cc2660-9d7a-424a-99c6-3e858a67db4c`

---

## STEP 1 — Count open PRs and average age

```bash
PR_JSON=$(gh api "repos/FilipMarzuki/matlu/pulls?state=open&per_page=100" \
  --jq '[.[] | select(.draft == false) | .created_at]')

OPEN_PRS=$(echo "$PR_JSON" | jq 'length')

AVG_AGE=$(node -e "
const dates = $PR_JSON;
if (dates.length === 0) { console.log('0'); process.exit(0); }
const now = Date.now();
const total = dates.reduce((s, d) => s + (now - new Date(d).getTime()), 0);
console.log((total / dates.length / 86400000).toFixed(1));
")

echo "open_prs=$OPEN_PRS avg_pr_age_days=$AVG_AGE"
```

---

## STEP 2 — Count issues in progress

```bash
IN_PROGRESS=$(curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ issues(filter:{ team:{ id:{ eq:\"84cc2660-9d7a-424a-99c6-3e858a67db4c\" } }, state:{ type:{ eq:\"started\" } } }){ totalCount } }"}' \
  | jq '.data.issues.totalCount')

echo "issues_in_progress=$IN_PROGRESS"
```

---

## STEP 3 — Compute rework rate

Rework rate = % of files changed this week that were also changed in the prior
3 weeks. A high rate signals churn and instability.

```bash
git log --since="7 days ago"  --name-only --pretty=format: | grep -v '^$' | sort -u > /tmp/cl_recent.txt
git log --since="28 days ago" --until="7 days ago" --name-only --pretty=format: | grep -v '^$' | sort -u > /tmp/cl_prior.txt

RECENT=$(wc -l < /tmp/cl_recent.txt | tr -d ' ')
OVERLAP=$(comm -12 /tmp/cl_recent.txt /tmp/cl_prior.txt | wc -l | tr -d ' ')

REWORK_RATE=$(node -e "
const r = $RECENT, o = $OVERLAP;
console.log(r === 0 ? '0.00' : (o * 100 / r).toFixed(2));
")

echo "rework_rate=$REWORK_RATE% ($OVERLAP/$RECENT files)"
```

---

## STEP 4 — Compute composite score

Each factor contributes up to a fixed maximum so the total caps at 100:

| Factor | Weight | Cap |
| ------ | ------ | --- |
| open_prs × 8 | 40 pts | 5 PRs |
| avg_pr_age_days × 2 | 20 pts | 10 days |
| issues_in_progress × 7 | 28 pts | 4 issues |
| rework_rate × 0.12 | 12 pts | 100 % |

```bash
SCORE=$(node -e "
const a = Math.min($OPEN_PRS    *  8, 40);
const b = Math.min($AVG_AGE     *  2, 20);
const c = Math.min($IN_PROGRESS *  7, 28);
const d = Math.min($REWORK_RATE * 0.12, 12);
console.log(Math.min(100, Math.max(0, a + b + c + d)).toFixed(1));
")

echo "score=$SCORE"
```

---

## STEP 5 — Write to Supabase

Use the Sunday date of this week as `recorded_at` so each weekly snapshot has a
consistent anchor. The `on_conflict` parameter makes the upsert idempotent — re-
running on the same week overwrites instead of erroring.

```bash
# Sunday of the current ISO week (or today if today is Sunday)
WEEK_DATE=$(node -e "
const d = new Date();
const day = d.getUTCDay();           // 0 = Sunday
const diff = day === 0 ? 0 : 7 - day;
d.setUTCDate(d.getUTCDate() + diff);
console.log(d.toISOString().slice(0, 10));
")

HTTP=$(curl -s -o /tmp/cl_response.txt -w "%{http_code}" \
  -X POST "$SUPABASE_URL/rest/v1/cognitive_load?on_conflict=recorded_at" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "{
    \"recorded_at\": \"$WEEK_DATE\",
    \"score\": $SCORE,
    \"open_prs\": $OPEN_PRS,
    \"avg_pr_age_days\": $AVG_AGE,
    \"issues_in_progress\": $IN_PROGRESS,
    \"rework_rate\": $REWORK_RATE,
    \"details\": {
      \"rework_files_recent\": $RECENT,
      \"rework_files_overlap\": $OVERLAP
    }
  }")

if [[ "$HTTP" == 2* ]]; then
  echo "Supabase write OK ($HTTP)"
else
  echo "Supabase write FAILED ($HTTP): $(cat /tmp/cl_response.txt)"
fi
```

---

## STEP 6 — Report

Print a one-line summary:

```
cognitive_load week=<WEEK_DATE> score=<SCORE> open_prs=<N> avg_age=<N>d in_progress=<N> rework=<N>%  supabase=<OK|FAILED>
```
