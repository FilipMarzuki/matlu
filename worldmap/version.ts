/**
 * The `worldmap/` generator's version (#1900, hex world step 7).
 *
 * Bump this when a change moves world cells outside the Reach rectangle to different ground than
 * before (new noise streams, a changed blend, different rivers…): a save whose `worldGen` doesn't
 * match drops what it saw outside the Reach, since the land there changed shape under it. The Reach
 * itself never needs this — it's pinned by its own golden hashes and never moves.
 */
export const WORLDGEN_VERSION = 1;
