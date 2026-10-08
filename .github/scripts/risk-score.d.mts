// Types for risk-score.mjs (#1431), so the TypeScript tests can import it.
export interface ChangedFile { filename: string; previous_filename?: string; additions?: number; deletions?: number }
export interface RiskRule { id: string; label: string; weight: number; lens?: string; paths: string[]; exclude?: string[] }
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
export function scoreRisk(files: ChangedFile[], config: RiskConfig): RiskResult;
export function loadRules(): RiskConfig;
export const CI_WORKFLOW: string;
export const HUMAN_LABEL: string;
export interface Approval { actor: string; actorType: string; at: string }
export function mergeGate(input: { tier: RiskResult['tier']; ciOk: boolean; approval: Approval | null; headAt?: string }): { merge: boolean; reason: string };
export function parseNumstatZ(text: string): ChangedFile[];
