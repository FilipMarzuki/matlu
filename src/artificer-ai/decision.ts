/**
 * The AI player's decision format (#1226): one JSON object per day.
 *
 * The schema is written to be accepted by strict structured-output modes:
 * every object lists all its properties as required and forbids extras, and
 * free-form choices travel as `{key, value}` pairs rather than an open map.
 * `parseDecision` validates whatever comes back regardless — models served
 * without schema enforcement can still drift.
 */

import { ACTIONS, SITES, type ActionId, type QueueId, type QueueItem, type SiteId } from '../artificer/region1';
import type { Choice } from '../artificer/winter';

export interface Decision {
  thoughts: string;
  site: SiteId | null;
  exit: Choice | null;
  queue: QueueItem[];
}

const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
const SITE_IDS = Object.keys(SITES) as SiteId[];
const EXITS: Choice[] = ['caravan', 'solo', 'winter'];

/** JSON Schema for one decision (strict-mode friendly). */
export const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thoughts', 'site', 'exit', 'queue'],
  properties: {
    thoughts: { type: 'string', description: "One or two sentences: today's plan." },
    site: { anyOf: [{ type: 'string', enum: SITE_IDS }, { type: 'null' }], description: 'Settle or move camp before the day, or null.' },
    exit: { anyOf: [{ type: 'string', enum: EXITS }, { type: 'null' }], description: 'Take an exit now (only when open), or null.' },
    queue: {
      type: 'array',
      description: "The day's actions in order.",
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'ring', 'options'],
        properties: {
          action: { type: 'string', enum: ACTION_IDS },
          ring: { type: 'integer', minimum: 1, maximum: 3, description: '1, 2 or 3; always 1 for camp actions.' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'value'],
              properties: { key: { type: 'string' }, value: { type: 'string' } },
            },
          },
        },
      },
    },
  },
} as const;

export type ParseResult = { ok: true; decision: Decision } | { ok: false; errors: string[] };

/** Pull the first JSON object out of a reply (tolerates code fences or stray prose). */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through to a lenient search */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('no JSON object found');
}

/**
 * Validate a reply and turn it into queue items. Never throws: everything
 * wrong comes back as readable errors the model can be shown to correct.
 */
export function parseDecision(text: string): ParseResult {
  let raw: unknown;
  try { raw = extractJson(text); } catch (e) { return { ok: false, errors: [`reply is not valid JSON (${(e as Error).message})`] }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['reply must be a JSON object'] };
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];

  const thoughts = typeof o.thoughts === 'string' ? o.thoughts : '';
  let site: SiteId | null = null;
  if (o.site !== null && o.site !== undefined) {
    if (typeof o.site === 'string' && (SITE_IDS as string[]).includes(o.site)) site = o.site as SiteId;
    else errors.push(`site must be one of ${SITE_IDS.join(', ')} or null`);
  }
  let exit: Choice | null = null;
  if (o.exit !== null && o.exit !== undefined) {
    if (typeof o.exit === 'string' && (EXITS as string[]).includes(o.exit)) exit = o.exit as Choice;
    else errors.push(`exit must be one of ${EXITS.join(', ')} or null`);
  }

  const queue: QueueItem[] = [];
  if (!Array.isArray(o.queue)) errors.push('queue must be an array');
  else o.queue.forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null) { errors.push(`queue[${i}] must be an object`); return; }
    const e = entry as Record<string, unknown>;
    const id = e.action;
    if (typeof id !== 'string' || !(ACTION_IDS as string[]).includes(id)) { errors.push(`queue[${i}].action "${String(id)}" is not an action id`); return; }
    const def = ACTIONS[id as ActionId];
    const ring = e.ring === undefined || e.ring === null ? 1 : e.ring;
    if (ring !== 1 && ring !== 2 && ring !== 3) { errors.push(`queue[${i}].ring must be 1, 2 or 3`); return; }
    if (ring !== 1 && !def.ringed) { errors.push(`queue[${i}]: "${id}" happens at camp, so ring must be 1`); return; }
    const q = (ring === 1 ? id : `${id}@${ring}`) as QueueId;
    const opts: Record<string, string> = {};
    if (e.options !== undefined && e.options !== null) {
      if (!Array.isArray(e.options)) { errors.push(`queue[${i}].options must be an array`); return; }
      for (const kv of e.options) {
        if (typeof kv !== 'object' || kv === null || typeof (kv as Record<string, unknown>).key !== 'string' || typeof (kv as Record<string, unknown>).value !== 'string') {
          errors.push(`queue[${i}].options entries must be {"key": string, "value": string}`); return;
        }
        opts[(kv as { key: string }).key] = (kv as { value: string }).value;
      }
    }
    queue.push(Object.keys(opts).length ? { q, opts } : q);
  });

  return errors.length ? { ok: false, errors } : { ok: true, decision: { thoughts, site, exit, queue } };
}
