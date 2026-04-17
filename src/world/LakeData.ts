/**
 * LakeData — BFS flood-fill classifier for inland water bodies (FIL-260).
 *
 * ## Problem
 * The elevation grid treats all tiles below 0.25 as water.  Tiles that touch
 * the map edge belong to the ocean; disconnected low-elevation pockets inland
 * are lakes.  Without explicit classification the terrain bake cannot tell them
 * apart, so every inland pond is rendered and animated as ocean.
 *
 * ## Solution: BFS from the map border
 * We seed a BFS from every tile on the four border edges.  Any water tile
 * (`elev < 0.25`) reachable from the edge is ocean and stays 0.  Any water tile
 * not reached by the BFS is inland — it becomes 1 in the returned grid.
 *
 * The algorithm is a standard connected-component flood-fill using 4-connectivity
 * (N / E / S / W neighbours).  Diagonal connectivity is intentionally excluded so
 * very narrow one-tile passages between the ocean and an inland pocket are still
 * counted as connected — i.e. we err on the side of "ocean" rather than
 * manufacturing spurious lakes at map edges.
 *
 * ## Why a separate file?
 * Mirror the pattern of `RiverData.ts`: pure data-transform functions with no
 * Phaser dependency, easy to unit-test and import anywhere.
 */

/**
 * Classify water tiles as lake (1) or ocean (0).
 *
 * @param elevGrid  Flat row-major Float32Array, one value per tile (0–1 range).
 *                  Use `computeNaturalElevGrid()` — **not** the baked elevation
 *                  that forces river tiles to 0.15.  River tiles in low-lying
 *                  coastal depressions would otherwise be mis-classified as lakes.
 * @param tilesX    Number of tiles along the X axis.
 * @param tilesY    Number of tiles along the Y axis.
 * @returns         Uint8Array of the same length.  1 = inland lake tile, 0 = not.
 */
export function buildLakeTileGrid(
  elevGrid: Float32Array,
  tilesX:   number,
  tilesY:   number,
): Uint8Array {
  const total   = tilesX * tilesY;
  const visited = new Uint8Array(total); // 1 = ocean-reachable (border BFS touched it)
  const queue: number[] = [];

  // Seed BFS from every border tile that is water.
  const enqueue = (idx: number): void => {
    if (visited[idx] === 0 && elevGrid[idx] < 0.25) {
      visited[idx] = 1;
      queue.push(idx);
    }
  };

  for (let tx = 0; tx < tilesX; tx++) {
    enqueue(tx);                           // top row
    enqueue((tilesY - 1) * tilesX + tx);   // bottom row
  }
  for (let ty = 1; ty < tilesY - 1; ty++) {
    enqueue(ty * tilesX);                  // left column
    enqueue(ty * tilesX + tilesX - 1);    // right column
  }

  // BFS — 4-connected flood fill.
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const ty  = Math.floor(idx / tilesX);
    const tx  = idx % tilesX;

    // N
    if (ty > 0)            enqueue(idx - tilesX);
    // S
    if (ty < tilesY - 1)   enqueue(idx + tilesX);
    // W
    if (tx > 0)            enqueue(idx - 1);
    // E
    if (tx < tilesX - 1)   enqueue(idx + 1);
  }

  // Any water tile the BFS never reached is an inland lake.
  const isLakeTile = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (elevGrid[i] < 0.25 && visited[i] === 0) {
      isLakeTile[i] = 1;
    }
  }

  return isLakeTile;
}
