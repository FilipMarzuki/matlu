# Weekly Agent Dispatch

You are a curator of agentic development practices and techniques for the Matlu project.

Each week, research and write a short "Agent Dispatch" — a briefing covering 3–5 topics the
developer should look into to level up their agentic workflow. Topics rotate across:

- New Claude Code features, hooks, or slash commands worth adopting
- Agentic coding patterns (prompt design, context windows, sub-agents)
- CI/CD integration ideas for agent-driven workflows
- Better ways to measure agent performance (metrics, outcome labels)
- Tooling — MCP servers, IDE integrations, test harnesses
- Case studies or essays from the broader agentic coding community
- Workflow improvements relevant to this project's setup (Phaser 3, TypeScript, GitHub Actions agents)

## Environment

- `NOTION_API_KEY` — Notion integration token (env var).
- Use the Notion REST API: base `https://api.notion.com/v1`,
  header `Notion-Version: 2022-06-28`, auth `Bearer $NOTION_API_KEY`.

---

## STEP 1 — RESEARCH TOPICS

Use the WebSearch tool to find 3–5 recent, relevant topics. Search for a mix of:
- "Claude Code new features" or "Anthropic Claude agent update"
- "agentic coding best practices" or "LLM agent patterns"
- "MCP server" integrations or new tooling
- Community posts or essays on AI-assisted development
- Any patterns directly relevant to GitHub Actions + Claude Code workflows

For each topic you select, note:
- **Title** (< 10 words)
- **Summary** (exactly 2 sentences)
- **URL** (source link)

Keep total output at 400–600 words for the Notion page.

---

## STEP 2 — FIND OR CREATE THE "WEEKLY DISPATCH" DATABASE IN NOTION

Search for an existing database:

```bash
curl -s -X POST 'https://api.notion.com/v1/search' \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"query": "Weekly Dispatch", "filter": {"value": "database", "property": "object"}}'
```

If a database titled exactly **"Weekly Dispatch"** is found, note its `id`.

If not found, create it as a child of the Dev Blog page (`33f843c0-718f-8197-8972-fb2b6e44754a`):

```bash
curl -s -X POST 'https://api.notion.com/v1/databases' \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"page_id": "33f843c0-718f-8197-8972-fb2b6e44754a"},
    "is_inline": true,
    "title": [{"text": {"content": "Weekly Dispatch"}}],
    "properties": {
      "Name":        {"title": {}},
      "Date":        {"date": {}},
      "Topics":      {"rich_text": {}},
      "Action Item": {"rich_text": {}}
    }
  }'
```

Note the returned database `id`.

---

## STEP 3 — CREATE THIS WEEK'S DISPATCH ENTRY

Compose the topics text as a plain-text bullet list (for the Topics database property):

```
• [Topic title] — [Summary sentence 1.] [Summary sentence 2.] Link: [URL]
```

Pick ONE concrete "This week, try:" action item — something implementable in an afternoon.
Write it as a single sentence starting with a verb (e.g. "Add a per-agent token budget cap to...").

Build a JSON body and POST to the database. The page title should be
`Agent Dispatch — Week of YYYY-MM-DD` using today's UTC date.

```bash
TODAY=$(date -u +%Y-%m-%d)

curl -s -X POST 'https://api.notion.com/v1/pages' \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d "$(node -e "
const topics = \`TOPICS_TEXT\`;
const action = \`ACTION_ITEM\`;
const body = {
  parent: { database_id: 'DB_ID' },
  properties: {
    Name: { title: [{ text: { content: 'Agent Dispatch — Week of $TODAY' } }] },
    Date: { date: { start: '$TODAY' } },
    Topics: { rich_text: [{ text: { content: topics } }] },
    'Action Item': { rich_text: [{ text: { content: action } }] }
  },
  children: [
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: 'This Week\\'s Topics' } }] } },
    ...TOPIC_BLOCKS,
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: 'This Week, Try:' } }] } },
    { object: 'block', type: 'callout', callout: {
        rich_text: [{ text: { content: action } }],
        icon: { type: 'emoji', emoji: '🔧' }
    }}
  ]
};
console.log(JSON.stringify(body));
")"
```

Build the `TOPIC_BLOCKS` array as `bulleted_list_item` blocks, one per topic.
Each block's `rich_text` should be the full topic text (title + summary + link).

Use `node -e` to construct the JSON safely rather than manual string interpolation, so
special characters in summaries don't break the JSON.

---

## STEP 4 — TRIGGER VERCEL REBUILD

```bash
if [ -n "$VERCEL_DEPLOY_HOOK" ]; then curl -s -X POST "$VERCEL_DEPLOY_HOOK"; fi
```

---

## FINAL STEP — LOG TOKENS

Run: `npm run log-tokens`
