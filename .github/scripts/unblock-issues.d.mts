// Types for unblock-issues.mjs (#1934), so the TypeScript tests can import it.
export const BLOCKED_LABEL: string;
export interface BlockerState { state: string; stateReason?: string | null }
export interface Decision {
  unblock: boolean; reason: string; blockers: number[]; notPlanned: number[]; open: number[]; unknown: number[];
}
export function parseBlockers(body: string | null | undefined): number[];
export function decide(
  issue: { number: number; body?: string | null; labels?: (string | { name: string })[] },
  blockerStates: Record<number, BlockerState | null | undefined>,
): Decision;
export function unblockComment(blockers: number[]): string;
