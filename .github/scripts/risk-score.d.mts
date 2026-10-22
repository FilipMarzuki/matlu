// Types for risk-score.mjs (#1431), so the TypeScript tests can import it.
export interface ChangedFile { filename: string; previous_filename?: string; additions?: number; deletions?: number; patch?: string }
/** A content pattern (#1781): `line` is a regex on a changed line, `within` one on its enclosing top-level declaration. */
export interface ContentPattern { line?: string; within?: string; $comment?: string }
export interface ContentRule { paths: string[]; exclude?: string[]; patterns: ContentPattern[]; $comment?: string }
export interface RiskRule { id: string; label: string; weight: number; lens?: string; paths: string[]; exclude?: string[]; content?: ContentRule }
export interface RiskConfig {
  tiers: { medium: number; high: number };
  rules: RiskRule[];
  size: { lines: number; weight: number }[];
  untested: { label: string; weight: number; codePaths: string[]; testPaths: string[] };
  lowRisk: { label: string; paths: string[] };
  defaultLens?: string;
}
export interface RiskResult { score: number; tier: 'low' | 'medium' | 'high'; reasons: string[]; lenses: string[] }
export const RULES_PATH: string;
export const TIERS: readonly ['low', 'medium', 'high'];
export function globToRegex(glob: string): RegExp;
export function contentCovers(file: string, content: ContentRule | undefined): boolean;
export function contentHits(patch: string, patterns: ContentPattern[]): string[];
export function scoreRisk(files: ChangedFile[], config: RiskConfig): RiskResult;
export function loadRules(): RiskConfig;
export const CI_WORKFLOW: string;
export const REVIEW_BOT: string;
export interface Review { commit_id: string; state?: string; submitted_at?: string; body?: string | null; user?: { login?: string; type?: string } | null }
export interface TierReviews { agent: 'approved' | 'changes-requested' | null; second: string | null; focused: Record<string, number | null> }
export function tierReviews(reviews: Review[], headSha: string): TierReviews;
export function mergeGate(input: { tier: RiskResult['tier']; ciOk: boolean; open?: boolean; sameRepo?: boolean; lenses?: string[]; reviews?: TierReviews }): { merge: boolean; reason: string };
export function parseNumstatZ(text: string): ChangedFile[];
