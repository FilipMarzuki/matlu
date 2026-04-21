// Static registry of all scheduled agents in the Matlu project.
// Keep in sync with CLAUDE.md "Scheduled agent workflows" table and
// .github/workflows/*.yml cron expressions.

export interface AgentDef {
  /** Short display name */
  name: string;
  /** Human-readable schedule (e.g. "Daily 02:00 UTC") */
  schedule: string;
  /** Raw cron expression, or null for event-triggered / manual */
  cron: string | null;
  /** Path to the prompt file in the repo */
  promptFile: string | null;
  /** One-sentence description of what the agent does */
  description: string;
}

const GITHUB_RAW = 'https://github.com/FilipMarzuki/matlu/blob/main';

export const agents: AgentDef[] = [
  {
    name: 'Nightly Dev Agent',
    schedule: 'Daily 02:00 UTC',
    cron: '0 2 * * *',
    promptFile: '.agents/per-issue.md',
    description: 'Picks up Linear issues labelled ready, implements them, opens PRs.',
  },
  {
    name: 'Triage / Backlog Refinement',
    schedule: 'Daily 22:00 UTC',
    cron: '0 22 * * *',
    promptFile: '.agents/triage.md',
    description: 'Sweeps un-triaged Linear issues, sets ready/needs-refinement/blocked labels.',
  },
  {
    name: 'Backlog Cleanup',
    schedule: 'After Triage',
    cron: null,
    promptFile: '.agents/hygiene.md',
    description: 'Marks Done if PR merged, splits too-large issues, enriches needs-refinement descriptions.',
  },
  {
    name: 'PR Grooming',
    schedule: 'After Nightly Agent',
    cron: null,
    promptFile: '.agents/pr-merge.md',
    description: 'Triages open PRs: closes superseded, merges clean, rebases dirty.',
  },
  {
    name: 'Better Stack Error Monitor',
    schedule: 'Daily 07:00 UTC',
    cron: '0 7 * * *',
    promptFile: '.agents/error-monitor.md',
    description: 'Checks Better Stack for unresolved errors, files Linear bugs.',
  },
  {
    name: 'Lore Auto-fill',
    schedule: 'Daily 14:00 UTC',
    cron: '0 14 * * *',
    promptFile: '.agents/lore-autofill.md',
    description: 'Expands thin lore entries and generates new ones in Notion.',
  },
  {
    name: 'Lore from Features',
    schedule: 'Daily 15:00 UTC',
    cron: '0 15 * * *',
    promptFile: '.agents/lore-features.md',
    description: 'Scans merged PRs for new game entities, creates Notion lore entries.',
  },
  {
    name: 'Entity Spec Fill',
    schedule: 'Daily 16:00 UTC',
    cron: '0 16 * * *',
    promptFile: '.agents/entity-spec-fill.md',
    description: 'Writes designNotes (sprite, animation, sound briefs) for entities missing them in entity-registry.json.',
  },
  {
    name: 'Weekly Learning Summary',
    schedule: 'Saturday 07:00 UTC',
    cron: '0 7 * * 6',
    promptFile: '.agents/learning-summary.md',
    description: 'Writes a learning summary from the week\'s PRs, posts to Notion.',
  },
  {
    name: 'Weekly Agent Dispatch',
    schedule: 'Saturday 09:00 UTC',
    cron: '0 9 * * 6',
    promptFile: '.agents/weekly-dispatch.md',
    description: 'Researches agentic dev topics and writes a weekly briefing to the Notion Weekly Dispatch database.',
  },
  {
    name: 'Weekly Architecture Review',
    schedule: 'Friday 17:00 UTC',
    cron: '0 17 * * 5',
    promptFile: '.agents/architecture-review.md',
    description: 'Updates ARCHITECTURE.md, flags architectural concerns, creates Linear issues.',
  },
  {
    name: 'Weekly Release Notes',
    schedule: 'After Weekly Engineering Stats',
    cron: null,
    promptFile: '.agents/release-notes.md',
    description: 'Writes release notes from merged PRs, posts to Notion.',
  },
  {
    name: 'Agent Performance Log',
    schedule: 'After Release Notes',
    cron: null,
    promptFile: '.agents/agent-perf-log.md',
    description: 'Queries Linear for agent:* outcome labels, creates weekly summary child page in Notion.',
  },
  {
    name: 'Sprite Credit Burn',
    schedule: 'Manual only',
    cron: null,
    promptFile: '.agents/sprite-credit-burn.md',
    description: 'Generates PixelLab sprites for all entities missing them; stops when credits run out.',
  },
];

export function promptUrl(promptFile: string): string {
  return `${GITHUB_RAW}/${promptFile}`;
}
