// Types for ci-scope.mjs (#1533), so the TypeScript tests can import it.
export type Flag = 'game' | 'artificer' | 'engines' | 'wiki' | 'dev';
export const FLAGS: readonly Flag[];
export const AREAS: readonly [string, readonly RegExp[]][];
export function areaOf(file: string): Flag | 'docs' | null;
export function scope(files: readonly string[], o?: { push?: boolean }): Record<Flag, boolean> & { reason: string };
