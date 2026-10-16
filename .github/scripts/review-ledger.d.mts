// Types for review-ledger.mjs (#1779), so the TypeScript tests can import it.
import type { Review } from './risk-score.mjs';
export type Label = 'acted-on' | 'dismissed' | 'unclear';
export const LABELS: readonly Label[];
export const DEFAULT_FIXTURES: string;
export const DEFAULT_OVERRIDES: string;
export interface ApiReview extends Review { id: number; html_url?: string }
export interface PrFixture {
  pr: { number: number; title?: string; html_url?: string; state: string; merged_at: string | null; closed_at: string | null; created_at: string | null; labels?: { name: string }[] };
  comments: { id?: number; user?: { login?: string }; created_at?: string; html_url?: string; body: string }[];
  reviews: ApiReview[];
  commits: { sha: string; date: string | null; message?: string; parents?: number; files: string[] | null }[];
}
export interface Finding { text: string; files: string[] }
export interface ReviewEntry {
  id: number; commitId: string | null; at: string | null; url: string | null;
  kind: 'review-agent' | 'second-opinion' | 'lens'; reviewer: string; lens: string | null; model: string;
  verdict: string; findingsCount: number | null; findings: Finding[]; cost: number | null; weak: boolean; carried: boolean;
}
export interface LedgerFinding {
  id: string; reviewer: string; model: string; files: string[]; text: string; label: Label; auto: Label;
  reason: string; commit: string | null; overridden: boolean; note: string | null; url: string | null;
}
export interface PrLedger {
  number: number; title: string; url: string | null; state: string; closedAt: string | null; createdAt: string | null;
  tier: string; reviews: ReviewEntry[]; failures: string[]; findings: LedgerFinding[]; rounds: number; cost: number | null;
}
export interface ReviewerRow {
  reviewer: string; tier?: string; models: string[]; runs: number; carried: number; weak: number; failures: number;
  passes: number; unclearVerdicts: number; blocks: number; actedOn: number; dismissed: number; unclear: number;
  cost: number | null; hitRate: number | null; costPerActedOn: number | null;
}
export interface LedgerReport {
  generatedFrom: number; reviewers: ReviewerRow[]; byTier: ReviewerRow[];
  prs: (Omit<PrLedger, 'reviews' | 'closedAt' | 'createdAt'> & {
    reviews: { id: number; reviewer: string; model: string; verdict: string; commit: string | null; cost: number | null; weak: boolean; carried: boolean; url: string | null }[];
  })[];
}
export type Overrides = Record<string, string | { label: string; note?: string }>;
export function parseCost(body?: string): number | null;
export function parseRiskComment(body?: string): { tier: 'low' | 'medium' | 'high'; score: number } | null;
export function parseFailureComment(body?: string): ('second-opinion' | 'focused')[] | null;
export function namedFiles(text?: string): string[];
export function parseReviewEntry(r: ApiReview | null | undefined): ReviewEntry | null;
export function judgeFinding(f: { files?: string[]; commitId?: string | null; at?: string | null }, fixture: PrFixture): { label: Label; commit: string | null; reason: string };
export function ledgerForPr(fixture: PrFixture, overrides?: Overrides): PrLedger;
export function aggregate(prs: PrLedger[]): LedgerReport;
export function renderMarkdown(report: LedgerReport, o?: { since?: string | null }): string;
export function fixtureFromApi(o: { pr: unknown; comments: unknown[]; reviews: unknown[]; commits: unknown[]; commitFiles?: Record<string, string[]> }): PrFixture;
export function loadFixtures(dir: string): PrFixture[];
export function fetchFromApi(o: { repo: string; token: string; since: string; includeOpen?: boolean; log?: (s: string) => void; fetch?: typeof fetch }): Promise<PrFixture[]>;
