// Types for review-context.mjs (#1483), so the TypeScript tests can import it.
export const FILE_CAP_BYTES: number;
export const TOTAL_CAP_BYTES: number;
export const MAX_FILES: number;
export const MAX_LISTED: number;
type Caps = { fileCap?: number; totalCap?: number; maxFiles?: number; maxListed?: number };
type Tally = { count: number; bytes: number };
export function noRoom(acc: Tally, caps?: Caps): string | null;
export function admit(acc: Tally, text: string, caps?: Caps): string | null;
export function skipReason(file: { filename: string; status?: string }): string | null;
export function contextSection(sha: string, entries: ({ path: string; text: string } | { path: string; skip: string })[], caps?: Caps): string;
