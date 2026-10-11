/**
 * One ladder, two systems (#1457): the artificer's concept-mastery rank
 * (`src/artificer/rank.ts`) and the crafter's guild automation level
 * (`GUILD_RANKS`, `src/crafting/planner.ts`) both climb Apprentice →
 * Journeyman → Master → Artificer. Shared here so the two can't drift back
 * into different names.
 */
export const RANK_NAMES = ['Apprentice', 'Journeyman', 'Master', 'Artificer'] as const;
export type RankName = (typeof RANK_NAMES)[number];
