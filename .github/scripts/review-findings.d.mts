// Types for review-findings.mjs (#1780), so the TypeScript tests can import it.
export type Severity = 'high' | 'medium' | 'low';
export interface Finding {
  title: string; claimed: Severity; severity: Severity; failsWhen: string; evidence: string; downgraded: boolean; lines: string[];
}
export interface ParsedFindings {
  stated: number | null; findings: Finding[]; total: number | null; high: number | null; preamble: string[]; tail: string[];
}
export function parseFindings(text?: string): ParsedFindings;
export function secondOpinionVerdict(text?: string): {
  verdict: 'approve' | 'request-changes' | 'unclear'; total: number | null; high: number | null; findings: Finding[];
};
export function renderFindings(text?: string, parsed?: ParsedFindings): string;
