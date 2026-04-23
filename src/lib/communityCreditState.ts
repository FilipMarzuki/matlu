/**
 * Persists which community creature submissions the player has already been
 * credited for (first on-screen encounter). Keyed by creature_submissions.id
 * — matches entity-registry.json attribution.creature_submission_id.
 *
 * Clears naturally if the player wipes browser storage for the game (same
 * pattern as fog-of-war and opened chests).
 */
const SEEN_COMMUNITY_LS_KEY = 'matlu_seen_community_entities';

let cachedSeen: Set<string> | null = null;

function loadSeen(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(SEEN_COMMUNITY_LS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function getSeenSet(): Set<string> {
  if (!cachedSeen) cachedSeen = loadSeen();
  return cachedSeen;
}

export function hasSeenCommunitySubmission(submissionId: string): boolean {
  return getSeenSet().has(submissionId);
}

export function markSeenCommunitySubmission(submissionId: string): void {
  const s = getSeenSet();
  if (s.has(submissionId)) return;
  s.add(submissionId);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SEEN_COMMUNITY_LS_KEY, JSON.stringify([...s]));
  }
}
