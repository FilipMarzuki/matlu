/**
 * AStarGrid — re-exports the A* pathfinder from mapgen/astar.ts (#1179).
 *
 * The implementation moved to mapgen/ because SettlementPlacement (also
 * mapgen/) depends on it and mapgen must not import from src/. Kept here so
 * existing src/ imports (Tinkerer, HomesteadScene, BuildingForgeScene, ...)
 * don't need to change.
 */
export * from '../../mapgen/astar';
