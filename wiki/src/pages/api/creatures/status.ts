/**
 * POST /api/creatures/status — alias for transition.
 * Moves a creature to the next valid pipeline status; validated by the FSM.
 */
export { prerender, POST } from './transition';
