// Types for review-fallback.mjs (#1509), so the TypeScript tests can import it.
import type { Usage } from './review-cost.mjs';
export const FALLBACK_MODEL: string;
export const CLAUDE_MAX_TOKENS: number;
type Reviewed = { text: string; usedModel: string; usage?: Usage };
export function reviewWithFallback(o: {
  openRouter: () => Promise<Reviewed>;
  claude: () => Promise<Reviewed>;
  hasOpenRouter: boolean;
  hasClaude: boolean;
  log?: (msg: string) => void;
}): Promise<(Reviewed & { weak: string | null }) | null>;
export function claudeReview(o: { prompt: string; system: string; model?: string; key: string; fetch?: typeof fetch }): Promise<Reviewed>;
export function reviewBody(o: {
  focus?: string | null; usedModel: string; verdict: string; findings?: string; text?: string; weak?: string | null;
  key?: string | null; usage?: Usage; carried?: { from: string; url: string } | null;
}): string;
