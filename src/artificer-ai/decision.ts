/**
 * The AI player's decision format (#1226): one JSON object per day.
 *
 * The schema is written to be accepted by strict structured-output modes:
 * every object lists all its properties as required and forbids extras, and
 * free-form choices travel as `{key, value}` pairs rather than an open map.
 * `parseDecision` validates whatever comes back regardless — models served
 * without schema enforcement can still drift.
 */

import { packProblem, type KitId } from '../artificer/kit';
import { ACTIONS, SITES, EATING_PLANS, type EatingPlan, type ActionId, type QueueId, type QueueItem, type SiteId } from '../artificer/region1';
import { FOCUS_KEYS } from '../artificer/focus';
import type { RoadActionId } from '../artificer/road';

export interface Decision {
  thoughts: string;
  /** A focus key ("goal:larder", "skill:hunting", "concept:joinery", "none"), or null to keep the current one (#1238). */
  focus?: string | null;
  /** How to eat from tonight (#1305): "full", "half" or "none"; null or absent keeps it. */
  eating?: EatingPlan | null;
  site: SiteId | null;
  queue: QueueItem[];
  /** A place to let go of, by pin id (#1381), before the day. */
  forget?: string;
  /** Interest to set on remembered places, ★ 1–3 or 0 to clear (#1381), as far as Memory allows. */
  interest?: { pin: string; stars: 0 | 1 | 2 | 3 }[];
}

const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
const SITE_IDS = Object.keys(SITES) as SiteId[];

/** JSON Schema for one decision (strict-mode friendly). */
export const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thoughts', 'focus', 'eating', 'site', 'forget', 'interest', 'queue'],
  properties: {
    thoughts: { type: 'string', description: "One or two sentences: today's plan." },
    focus: { anyOf: [{ type: 'string', enum: FOCUS_KEYS }, { type: 'null' }], description: 'Set what your mind works on (e.g. "goal:larder"), "none" to clear, or null to keep it.' },
    eating: { anyOf: [{ type: 'string', enum: EATING_PLANS }, { type: 'null' }], description: 'How to eat from tonight: "full", "half" (every other night) or "none" (fast), or null to keep it.' },
    site: { anyOf: [{ type: 'string', enum: SITE_IDS }, { type: 'null' }], description: 'Settle or move camp before the day, or null.' },
    forget: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'A remembered place to let go of, by its pin id (e.g. "deep-pool@2"), or null.' },
    interest: {
      type: 'array',
      description: 'Interest to set on remembered places (0 clears, 1–3 stars), once your Memory allows; [] for none.',
      items: { type: 'object', additionalProperties: false, required: ['pin', 'stars'], properties: { pin: { type: 'string' }, stars: { type: 'integer', minimum: 0, maximum: 3 } } },
    },
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
  let eating: EatingPlan | null = null;
  if (o.eating !== null && o.eating !== undefined) {
    if (typeof o.eating === 'string' && (EATING_PLANS as string[]).includes(o.eating)) eating = o.eating as EatingPlan;
    else errors.push(`eating must be one of ${EATING_PLANS.join(', ')} or null`);
  }
  let focus: string | null = null;
  if (o.focus !== null && o.focus !== undefined) {
    if (typeof o.focus === 'string' && FOCUS_KEYS.includes(o.focus)) focus = o.focus;
    else errors.push(`focus must be one of ${FOCUS_KEYS.join(', ')} or null`);
  }
  let site: SiteId | null = null;
  if (o.site !== null && o.site !== undefined) {
    if (typeof o.site === 'string' && (SITE_IDS as string[]).includes(o.site)) site = o.site as SiteId;
    else errors.push(`site must be one of ${SITE_IDS.join(', ')} or null`);
  }
  // Pins (#1381): their shape here; whether the pin exists and Memory allows the stars is the runner's check.
  let forget: string | null = null;
  if (o.forget !== null && o.forget !== undefined) {
    if (typeof o.forget === 'string') forget = o.forget;
    else errors.push('forget must be a pin id (a string) or null');
  }
  const interest: { pin: string; stars: 0 | 1 | 2 | 3 }[] = [];
  if (o.interest !== null && o.interest !== undefined) {
    if (!Array.isArray(o.interest)) errors.push('interest must be an array of {"pin": string, "stars": 0–3}');
    else o.interest.forEach((x, i) => {
      const e = x as Record<string, unknown> | null;
      if (!e || typeof e.pin !== 'string' || ![0, 1, 2, 3].includes(e.stars as number)) errors.push(`interest[${i}] must be {"pin": string, "stars": 0, 1, 2 or 3}`);
      else interest.push({ pin: e.pin, stars: e.stars as 0 | 1 | 2 | 3 });
    });
  }
  // There are no exits since winter is played (#1302): asking for one is a mistake worth telling the player about.
  if (o.exit !== null && o.exit !== undefined) errors.push('there are no exits — survive the winter until the thaw (leave "exit" out)');

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

  return errors.length ? { ok: false, errors } : { ok: true, decision: { thoughts, ...(focus ? { focus } : {}), ...(eating ? { eating } : {}), site, queue, ...(forget ? { forget } : {}), ...(interest.length ? { interest } : {}) } };
}

// ── The road (#1251) ────────────────────────────────────────────────────────

/** One road day's decision: what to do, in order, as road action ids. */
export interface RoadDecision { thoughts: string; actions: RoadActionId[] }

/** The shapes a road action can take (validated before the sim sees it; the sim then explains what it can't do). */
const ROAD_ACTION = /^(rest|wait|tend|help|(talk|ask|heal|accept|complete|appraise|craft|study):[\w-]+|(sell|buy):[\w-]+(:[\w-]+)?|learn:[\w-]+:[\w-]+)$/;

/** JSON Schema for a road day (strict-mode friendly). */
export const ROAD_DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thoughts', 'actions'],
  properties: {
    thoughts: { type: 'string', description: "One or two sentences: today's plan." },
    actions: {
      type: 'array',
      description: 'Road actions in order, e.g. "craft:waterskin", "study:joinery", "help", "tend", "talk:hf-maren", "ask:hf-orrin", "sell:cold-gear", "buy:rawFood:3", "accept:hf-forge-wood", "complete:hf-forge-wood", "learn:hf-orrin:seasoning", "appraise:hf-orrin", "heal:cv-ottilia", "rest", "wait".',
      items: { type: 'string' },
    },
  },
} as const;

/** Validate a road reply. Never throws: what's wrong comes back as errors the model can be shown. */
export function parseRoadDecision(text: string): { ok: true; decision: RoadDecision } | { ok: false; errors: string[] } {
  let raw: unknown;
  try { raw = extractJson(text); } catch (e) { return { ok: false, errors: [`reply is not valid JSON (${(e as Error).message})`] }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['reply must be a JSON object'] };
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];
  const actions: RoadActionId[] = [];
  if (o.queue !== undefined && o.actions === undefined) errors.push('on the road, reply with "actions" (a list of road action ids), not "queue"');
  else if (!Array.isArray(o.actions)) errors.push('actions must be an array of strings');
  else o.actions.forEach((a, i) => {
    if (typeof a !== 'string' || !ROAD_ACTION.test(a)) errors.push(`actions[${i}] "${String(a)}" is not a road action (rest, wait, help, tend, craft:<recipe>, study:<concept>, talk:<person>, ask:<person>, sell:<item>[:<qty|grade>], buy:<good>[:<qty>], accept:<quest>, complete:<quest>, learn:<teacher>:<thing>, appraise:<teacher>, heal:<healer>)`);
    else actions.push(a as RoadActionId);
  });
  return errors.length ? { ok: false, errors } : { ok: true, decision: { thoughts: typeof o.thoughts === 'string' ? o.thoughts : '', actions } };
}

// ── Encounters (#1348) ──────────────────────────────────────────────────────

/** A reply to an encounter that paused the day: which option to take. */
export interface EncounterDecision { thoughts: string; choice: string }

/** JSON Schema for an encounter reply (strict-mode friendly). */
export const ENCOUNTER_DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thoughts', 'choice'],
  properties: {
    thoughts: { type: 'string', description: 'One sentence: why this choice.' },
    choice: { type: 'string', description: 'The id of one available option, exactly as listed.' },
  },
} as const;

/**
 * Validate an encounter reply against the options on offer (`unmet` is why one can't be taken,
 * or null). Never throws: an unknown or unavailable choice comes back as an error the model can
 * be shown, naming the options it can take.
 */
export function parseEncounterDecision(text: string, options: readonly { id: string; unmet: string | null }[]): { ok: true; decision: EncounterDecision } | { ok: false; errors: string[] } {
  let raw: unknown;
  try { raw = extractJson(text); } catch (e) { return { ok: false, errors: [`reply is not valid JSON (${(e as Error).message})`] }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['reply must be a JSON object'] };
  const o = raw as Record<string, unknown>;
  const open = options.filter(x => !x.unmet).map(x => x.id);
  const listed = `choose one of: ${open.join(', ')}`;
  if (typeof o.choice !== 'string') return { ok: false, errors: [`"choice" must be an option id — ${listed}`] };
  const picked = options.find(x => x.id === o.choice);
  if (!picked) return { ok: false, errors: [`"${o.choice}" is not an option here — ${listed}`] };
  if (picked.unmet) return { ok: false, errors: [`"${o.choice}" isn't open to you (${picked.unmet}) — ${listed}`] };
  return { ok: true, decision: { thoughts: typeof o.thoughts === 'string' ? o.thoughts : '', choice: o.choice } };
}

// ── Packing for the hike (#1401) ────────────────────────────────────────────

export const PACK_DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thoughts', 'pack'],
  properties: {
    thoughts: { type: 'string', description: 'One or two sentences: what you packed and why.' },
    pack: { type: 'array', items: { type: 'string' }, description: 'The ids of the items you pack, exactly as listed.' },
  },
} as const;

export interface PackDecision { thoughts: string; pack: KitId[] }

/** Validate a packing reply: a list of known ids, none twice, within what the pack holds. Never throws. */
export function parsePackDecision(text: string): { ok: true; decision: PackDecision } | { ok: false; errors: string[] } {
  let raw: unknown;
  try { raw = extractJson(text); } catch (e) { return { ok: false, errors: [`reply is not valid JSON (${(e as Error).message})`] }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['reply must be a JSON object'] };
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.pack) || !o.pack.every(x => typeof x === 'string')) return { ok: false, errors: ['"pack" must be a list of item ids'] };
  const problem = packProblem(o.pack as string[]);
  if (problem) return { ok: false, errors: [`your pack won't do: ${problem}`] };
  return { ok: true, decision: { thoughts: typeof o.thoughts === 'string' ? o.thoughts : '', pack: [...(o.pack as KitId[])] } };
}
