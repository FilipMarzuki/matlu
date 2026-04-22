/**
 * POST /api/creatures/create-lore-entry — alias for create-lore-page.
 * Creates a Notion lore page, stores lore_entry_id + lore_entry_url, transitions to 'lore-ready'.
 */
export { prerender, POST } from './create-lore-page';
