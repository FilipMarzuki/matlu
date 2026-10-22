// Types for review-cost.mjs (#1654), so the TypeScript tests can import it.
import type { Review } from './risk-score.mjs';
export interface Usage { input: number; output: number; cached?: number; cost?: number }
export const OPENROUTER_MAX_TOKENS: number;
export function openRouterBody(o: { model: string; system: string; prompt: string }): {
  model: string; temperature: number; max_tokens: number; usage: { include: true };
  messages: { role: 'system' | 'user'; content: string }[];
};
export function openRouterUsage(u: unknown): Usage | undefined;
export function claudeUsage(u: unknown): Usage | undefined;
export function usageLine(usage: Usage | undefined): string;
export function reviewKey(o: { diff: string; model: string; instructions: string }): string;
export interface ParsedReview {
  focus: string | null; verdict: string; findings: number | null; high: number | null; key: string | null; usedModel: string;
  weak: string | null; from: string | null; pass: boolean; blocks: boolean;
}
export function parseReview(body?: string): ParsedReview | null;
export function carryOver<R extends Review>(o: { reviews: R[]; focus?: string | null; keys: (string | null | undefined)[]; headSha: string; bot?: string }):
  { review: R; parsed: ParsedReview; from: string; onHead: boolean } | null;
