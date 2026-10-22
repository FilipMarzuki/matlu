/**
 * The Class registry (#1637): one canon list of Mistheim's [Classes], who holds them and where in
 * canon each comes from. The data is content/classes.json; this module types it and answers "which
 * Class is this name?". docs/class-registry.md explains the rules for adding one.
 *
 * Nothing in the sim reads it yet. It exists so lore agents can check a new Class against the old
 * ones before writing it, and so the game has one place to read Classes from when it needs them.
 */

import file from './content/classes.json';

/**
 * What sort of work a Class is. A small closed set so the registry stays sortable:
 * - craft: makes things (Runesmith, Shipwright, Tinkerer);
 * - field: works land, water or ruin (Farmer, Diver, Delver);
 * - trade: buys, sells or hosts (Merchant, Trader, Innkeeper);
 * - office: holds a post others answer to (Reeve, Harbourmaster, Herald);
 * - martial: fights or guards (Soldier, Knight, Scout);
 * - lore: keeps or makes knowledge (Keeper, Archivist, Cartographer);
 * - mystic: works Myst, Rasa or something stranger directly (Healer, Wind-Reader, Lich);
 * - art: moves people with performance (Bard).
 */
export const CLASS_KINDS = ['craft', 'field', 'trade', 'office', 'martial', 'lore', 'mystic', 'art'] as const;
export type ClassKind = (typeof CLASS_KINDS)[number];

export interface ClassEntry {
  /** kebab-case, from the name. */
  id: string;
  /** The singular name as WORLD.md brackets it, without the brackets. */
  name: string;
  kind: ClassKind;
  /** Peoples (content/peoples-lore.json ids) WORLD.md ties the Class to. */
  peoples: string[];
  /** Cultures (macro-world/cultures.json ids), when canon ties a Class to one. */
  cultures?: string[];
  /** Held across Peoples; `peoples` then lists only the ones canon names. */
  widespread?: boolean;
  /** Other spellings WORLD.md brackets for the same Class, beyond the plain `name + s` plural. */
  forms?: string[];
  /** A narrower Class built on another (Steppe Scout on Scout). */
  variantOf?: string;
  /** `WORLD.md § heading` for canon; `file › label` for a Class invented elsewhere. */
  source: string;
  /** What canon says about levels in it. */
  levels?: string;
  notes?: string;
  /** When the Class was made up for the game (YYYY-MM-DD). */
  invented?: string;
  /** When the owner made it canon (YYYY-MM-DD). */
  canonised?: string;
  /** The issue it came in with. */
  issue?: number;
}

interface ClassesFile {
  classes: ClassEntry[];
  storyEngine: Record<string, string | null>;
}

const data = file as ClassesFile;

export const CLASSES: readonly ClassEntry[] = data.classes;

/**
 * The story engine's classes (storytelling/types.ts CharClass) against the registry: the entry a
 * class stands for, or null for an engine-only class. Kept as data, not wired into the engine, so
 * the engine's behaviour (and its golden hashes) doesn't change.
 */
export const STORY_ENGINE_CLASSES: Readonly<Record<string, string | null>> = data.storyEngine;

/** Every name a Class answers to: its name, its plain plural, and its listed forms. */
export function classFormsOf(c: ClassEntry): string[] {
  return [c.name, `${c.name}s`, ...(c.forms ?? [])];
}

const BY_NAME = new Map<string, ClassEntry>();
for (const c of CLASSES) for (const f of classFormsOf(c)) if (!BY_NAME.has(f.toLowerCase())) BY_NAME.set(f.toLowerCase(), c);

/** The Class a bracketed name means (case-insensitive; plurals and forms count), if any. */
export function classByName(name: string): ClassEntry | undefined {
  return BY_NAME.get(name.replace(/^\[|\]$/g, '').trim().toLowerCase());
}

/** Bracketed words in WORLD.md that aren't Classes: they name the system itself. */
const NOT_CLASSES = new Set(['Classes']);

/**
 * The Class names WORLD.md brackets, in order of first appearance, each once. The rule: a
 * bracketed term in prose (outside ``` code blocks, which hold Runescript's syntax placeholders)
 * that starts with a capital letter, minus the words in NOT_CLASSES. WORLD.md brackets nothing
 * else (Skills are written plain: "the Sanctuary Skill"), so a capitalised bracket is a Class. A
 * bracket wrapped across lines is joined: "[Current-\nReader]" is Current-Reader.
 */
export function worldClassNames(world: string): string[] {
  let inFence = false;
  const prose = world.split('\n').filter(line => {
    if (line.trimStart().startsWith('```')) { inFence = !inFence; return false; }
    return !inFence;
  }).join('\n');
  const names: string[] = [];
  for (const m of prose.matchAll(/\[([^\]]+)\]/g)) {
    const name = m[1].replace(/-\s*\n\s*/g, '-').replace(/\s+/g, ' ').trim();
    if (!/^[A-Z]/.test(name) || NOT_CLASSES.has(name) || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}
