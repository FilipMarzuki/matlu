/**
 * Bounded conversation history for AI players (#1448). A whole-year game plus the caravan road
 * runs to 100+ turns, and sending all of it every turn overflowed a 200k-token context (and cost
 * grew with every turn). Each observation already carries the full game state, so old turns only
 * hold the player's own past replies: keep a recent window.
 *
 * The window is trimmed in blocks, not slid one turn at a time. History grows to 2 × `keep`
 * exchanges and is then cut back to `keep`, so the prefix stays the same for `keep` turns in a
 * row and prompt caching (which matches on an unchanged prefix) keeps working between cuts.
 */

/** How many recent exchanges (a user turn and its reply) a player keeps by default. */
export const HISTORY_TURNS = 8;

/**
 * Trim `messages` in place before a new user turn is added. The first `head` messages (e.g. the
 * system prompt) always stay. Returns how many messages were dropped.
 */
export function trimHistory<T extends { role: string }>(messages: T[], keep = HISTORY_TURNS, head = 0): number {
  const exchanges = Math.floor((messages.length - head) / 2);
  if (keep <= 0 || exchanges <= 2 * keep) return 0;
  let drop = 2 * (exchanges - keep);
  // Never start the kept history on a reply: drop up to the next user turn.
  while (head + drop < messages.length && messages[head + drop].role !== 'user') drop++;
  messages.splice(head, drop);
  return drop;
}
