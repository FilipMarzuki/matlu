/**
 * POST /api/creatures/balance — alias for update-balance.
 * Saves balance_tier / balance_notes / biome_affinity and transitions to 'balanced'.
 */
export { prerender, POST } from './update-balance';
