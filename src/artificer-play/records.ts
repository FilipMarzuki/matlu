/**
 * Run records (#1558): one row per finished game in `artificer_runs`, in the same shape whoever
 * played and wherever: a person in the console, someone's AI over MCP or the HTTP API, or our own
 * nightly AI playtest. That shared shape is what lets the Records page put people and models side
 * by side, and what achievements will be worked out from later (#1559).
 *
 * This file is the shape, the nickname rule and how runs rank against each other: plain functions
 * with no game code, so the Records pages can use them without loading the sim. Building a record
 * from a finished game is record-of.ts.
 *
 * Nothing personal goes in a record. The audience includes kids, so a nickname is cut to one word
 * of letters (no digits: they could be an age, a birth year or a phone number) and dropped if it
 * holds a blocked word, and there's no address, account or free text.
 */

export type PlayerKind = 'person' | 'ai';
/** Where a game was played: the HTTP API, the MCP server, the console, the nightly playtest, or (#1559) the web game. */
export type Surface = 'api' | 'mcp' | 'console' | 'bench' | 'web';

/** A finished game, as the Records pages read it. */
export interface Run {
  playerKind: PlayerKind;
  /** The model playing, as the player reports it (or the playtest's model id). Never checked. */
  model: string | null;
  /** The client's own name: an MCP client's, `artificer-console`, `artificer-bench`… */
  client: string | null;
  surface: Surface;
  /** The game's version (session.ts GAME_VERSION): records compare like with like. */
  gameVersion: string;
  /** One word, or null: see `nicknameOf`. */
  nickname: string | null;
  /** How it ended: `died` or `collapsed` before the thaw, `survived`, or on the road `arrived`, `died`, `collapsed`. */
  outcome: string;
  /** How the Warden came through the winter, for a run that reached the thaw: hale, worn or broken. */
  grade: string | null;
  /** Where it ended: in the Reach, or on the caravan road after the thaw. */
  stage: 'reach' | 'road';
  /** The day it ended (the road's days count on from the thaw). */
  endDay: number;
  /** The day the Warden first became winter-ready, or null if never. */
  readyDay: number | null;
  /** Preserved rations in the larder on the morning of midwinter, or null if the run ended before it. */
  larderMidwinter: number | null;
  shelterTier: number;
  /** The sum of every skill's level, and of every concept's rank. */
  skillLevels: number;
  conceptRanks: number;
  recipes: number;
  milestones: number;
  /** Moves made (API, MCP, console) or days played (the playtest plans a day per turn). */
  moves: number;
  /** What the AI's tokens cost, when we paid and know it (the playtest); null otherwise. */
  costUsd: number | null;
  /** The rest, for the dev site's AI page and later achievements: tools, site, top concept, road… */
  detail: RunDetail;
}

export interface RunDetail {
  site: string | null;
  tools: string[];
  topConcept: { id: string; rank: number } | null;
  skills: Record<string, number>;
  road?: { villages: string[]; quests: number; marks: number };
}

/** A stored record: a Run plus its row id and when it was written. The game id never leaves the server. */
export interface StoredRun extends Run {
  id: string;
  createdAt: string;
}

// ── Nicknames ───────────────────────────────────────────────────────────────

/**
 * Blocked words, checked against the nickname with symbols squeezed out and look-alike digits read
 * as letters ("sh1t" → "shit"). Short on purpose: it catches what a kid shouldn't see on a public
 * board, and a false hit only costs the nickname (the run still counts, as "a Warden").
 *
 * Stems that never sit inside an ordinary name are blocked anywhere in it; short ones that do
 * ("Thora" holds "hora", "Peacock" holds "cock") only as the whole word, or its plural.
 */
const BLOCKED_ANYWHERE = [
  'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'pussy', 'penis', 'vagina', 'porn', 'nigg', 'retard', 'nazi',
  'hitler', 'suicid', 'wank', 'twat',
  // Swedish, since the owner is
  'fitta', 'knull', 'jävla', 'javla', 'helvete',
];
const BLOCKED_WORDS = ['dick', 'cock', 'sex', 'rape', 'kill', 'anal', 'boob', 'tit', 'tits', 'piss', 'fag', 'kkk', 'kuk', 'hora', 'neger', 'bög', 'mongo'];
const LOOK_ALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i' };
/** Long enough for a name, short enough not to be a message. */
const NICKNAME_CHARS = 16;

/**
 * A nickname fit for a public board, or null. Letters only, one word, at most 16 characters:
 * digits could be an age, a birth year or a phone number, and a first and last name together are
 * too easily someone's real name. "Warden" (the default) counts as no nickname.
 */
export function nicknameOf(raw: string | null | undefined): string | null {
  // Only the first word is kept, so only the first word is checked.
  const token = raw?.trim().split(/\s+/)[0] ?? '';
  const squeezed = token.toLowerCase().replace(/[0134578@$!]/g, c => LOOK_ALIKES[c] ?? c).replace(/[^\p{L}]/gu, '');
  if (BLOCKED_ANYWHERE.some(w => squeezed.includes(w)) || BLOCKED_WORDS.some(w => squeezed === w || squeezed === `${w}s`)) return null;
  const word = token.replace(/[^\p{L}'-]/gu, '').replace(/^['-]+|['-]+$/g, '').slice(0, NICKNAME_CHARS);
  return word && word.toLowerCase() !== 'warden' ? word : null;
}

// ── Ranking and comparing ───────────────────────────────────────────────────

/** How far a run got: 3 reached Mistheim, 2 lived to the thaw (whatever happened after), 1 didn't. */
export function tierOf(r: Pick<Run, 'outcome' | 'stage'>): 1 | 2 | 3 {
  if (r.outcome === 'arrived') return 3;
  return r.stage === 'road' || r.outcome === 'survived' ? 2 : 1;
}

const GRADE_ORDER: Record<string, number> = { hale: 3, worn: 2, broken: 1 };

type Rankable = Pick<Run, 'outcome' | 'stage' | 'endDay' | 'grade' | 'readyDay' | 'milestones'>;

/**
 * One number that orders runs, bigger is better: further (tier, then the day it ended), then how
 * well the winter went (grade), then readier sooner, then more milestones. Stored with each record
 * (`rank_key`), so the database can hand back the best runs of all time without reading them all.
 * Each part gets its own band of digits, so a later part never outweighs an earlier one.
 */
export function rankKey(r: Rankable): number {
  const day = Math.min(Math.max(Math.round(r.endDay), 0), 999);
  const grade = GRADE_ORDER[r.grade ?? ''] ?? 0;
  const ready = r.readyDay === null ? 0 : 100 - Math.min(Math.max(r.readyDay, 1), 99); // sooner is more
  const milestones = Math.min(Math.max(r.milestones, 0), 99);
  return (((tierOf(r) * 1000 + day) * 10 + grade) * 100 + ready) * 100 + milestones;
}

/** Best first, for sorting. Negative when `a` is the better run. */
export const compareRuns = (a: Rankable, b: Rankable): number => rankKey(b) - rankKey(a);

/** The share of `others` (0–100, rounded) that `run` did better than. Ties count as half. */
export function percentBeaten(run: Rankable, others: readonly Rankable[]): number | null {
  if (!others.length) return null;
  const score = others.reduce((n, o) => { const c = compareRuns(run, o); return n + (c < 0 ? 1 : c === 0 ? 0.5 : 0); }, 0);
  return Math.round((100 * score) / others.length);
}

/** A short line for how a run ended: "died on day 11", "survived the winter (hale)", "reached Mistheim". */
export function outcomeLine(r: Pick<Run, 'outcome' | 'stage' | 'grade' | 'endDay'>): string {
  if (r.outcome === 'arrived') return 'reached Mistheim';
  if (r.stage === 'road') return `${r.outcome} on the road, day ${r.endDay}`;
  if (r.outcome === 'survived') return `survived the winter${r.grade ? ` (${r.grade})` : ''}`;
  return `${r.outcome} on day ${r.endDay}`;
}

/** Who played, for grouping: people together, AIs by the model they named. */
export function groupOf(r: Pick<Run, 'playerKind' | 'model'>): string {
  return r.playerKind === 'person' ? 'People' : r.model ?? 'AI (model not given)';
}
