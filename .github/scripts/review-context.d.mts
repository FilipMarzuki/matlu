// Types for review-context.mjs (#1483), so the TypeScript tests can import it.
export const FILE_CAP_BYTES: number;
export const TOTAL_CAP_BYTES: number;
export function skipReason(file: { filename: string; status?: string }): string | null;
export function contextSection(sha: string, entries: ({ path: string; text: string } | { path: string; skip: string })[], caps?: { fileCap?: number; totalCap?: number }): string;
