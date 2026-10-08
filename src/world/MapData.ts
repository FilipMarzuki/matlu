/**
 * MapData — re-exports the LDtk map-ingestion types/parser from
 * mapgen/MapData.ts (#1179).
 *
 * The implementation moved to mapgen/ because SettlementMapEmitter.test.ts
 * (also mapgen/) depends on it and mapgen must not import from src/. Kept
 * here so existing src/ imports (CrafterScene, GameScene, SettlementScene,
 * crafting/mapSources, ...) don't need to change.
 */
export * from '../../mapgen/MapData';
