// Types for macro-sync-core.mjs (#1642), so the TypeScript tests can import it.
export type Kind = 'trait' | 'ancestry' | 'culture' | 'architecture' | 'fashion' | 'archetypes';
export type Entities = Record<Kind, Record<string, Record<string, unknown>>>;
export interface MacroFiles {
  raceAffinities?: unknown;
  cultures?: unknown;
  cultureTraits?: unknown;
  fashion?: unknown;
  populationArchetypes?: unknown;
  architecture?: unknown;
}
export type Diff = Record<Kind, { added: string[]; changed: string[]; removed: string[] }>;
export const MACRO_FILES: Record<keyof MacroFiles, string>;
export const MASTER_DOC: string;
export const KINDS: readonly Kind[];
export const AMBIENT: string;
export const LIVE_TABLES: readonly string[];
export function exportFromRows(rows: Record<string, Record<string, unknown>[]>, doc?: string): Required<MacroFiles> & { buildingRegistry: unknown };
export function entitiesFromFiles(files: MacroFiles): { entities: Entities; biomes: string[] };
export function sameValue(a: unknown, b: unknown): boolean;
export function diffEntities(base: Entities, head: Entities): Diff;
export function isEmptyDiff(diff: Diff): boolean;
export function compareEntities(repo: Entities, live: Entities): Record<Kind, { missingLive: string[]; differs: string[]; liveOnly: string[] }>;
export function lit(value: unknown, type: string): string;
export function generateSyncSql(head: Entities, opts?: { only?: Diff | null; allowDelete?: boolean; biomes?: string[]; header?: string[] }): string;
export function describeDiff(diff: Diff): string[];
export function liveDumpQuery(): string;
