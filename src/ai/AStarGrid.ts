/**
 * AStarGrid — A* pathfinding on a flat tile grid.
 *
 * Operates in tile coordinates (not pixels). The grid uses 0 = passable,
 * 1 = wall. Returns an array of tile waypoints from start (exclusive) to
 * goal (inclusive), or null if no path exists.
 *
 * 4-directional movement only — diagonal moves are blocked because the
 * BSP dungeon's 3-tile-wide corridors would allow corner-cutting through
 * walls with 8-directional neighbours.
 *
 * The open list is a simple sorted array. With a 60×60 grid (3600 tiles)
 * this is more than fast enough — no binary heap needed.
 */

/** Tile-coordinate waypoint. */
export interface TilePoint {
  x: number;
  y: number;
}

/** Maximum nodes to visit before giving up — prevents freeze on unreachable goals. */
const MAX_VISITED = 2000;

/** 4-directional neighbour offsets. */
const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/**
 * Find the shortest path from (sx, sy) to (gx, gy) on the tile grid.
 *
 * @param grid   Flat array of tile values (0 = floor, 1 = wall), row-major.
 * @param cols   Grid width in tiles.
 * @param rows   Grid height in tiles.
 * @param sx     Start tile X.
 * @param sy     Start tile Y.
 * @param gx     Goal tile X.
 * @param gy     Goal tile Y.
 * @returns      Array of waypoints (start excluded, goal included), or null.
 */
export function aStarPath(
  grid: ArrayLike<number>,
  cols: number,
  rows: number,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
): TilePoint[] | null {
  if (sx === gx && sy === gy) return [];

  const idx = (x: number, y: number) => y * cols + x;
  const heuristic = (x: number, y: number) => Math.abs(x - gx) + Math.abs(y - gy);

  // gScore: cheapest known cost from start to each node.
  const gScore = new Float32Array(cols * rows).fill(Infinity);
  // fScore: gScore + heuristic estimate to goal.
  const fScore = new Float32Array(cols * rows).fill(Infinity);
  // cameFrom: parent index for path reconstruction.
  const cameFrom = new Int32Array(cols * rows).fill(-1);

  const startIdx = idx(sx, sy);
  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(sx, sy);

  // Open set — sorted by fScore ascending. Small grid, simple array is fine.
  const open: number[] = [startIdx];
  const inOpen = new Uint8Array(cols * rows);
  inOpen[startIdx] = 1;

  let visited = 0;

  while (open.length > 0 && visited < MAX_VISITED) {
    // Pop the node with lowest fScore.
    let bestI = 0;
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[bestI]]) bestI = i;
    }
    const current = open[bestI];
    open[bestI] = open[open.length - 1];
    open.pop();
    inOpen[current] = 0;
    visited++;

    const cx = current % cols;
    const cy = (current - cx) / cols;

    // Goal reached — reconstruct path.
    if (cx === gx && cy === gy) {
      const path: TilePoint[] = [];
      let node = current;
      while (node !== startIdx) {
        const nx = node % cols;
        const ny = (node - nx) / cols;
        path.push({ x: nx, y: ny });
        node = cameFrom[node];
      }
      path.reverse();
      return path;
    }

    // Expand neighbours.
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;

      const ni = idx(nx, ny);
      if (grid[ni] !== 0) continue; // wall

      const tentG = gScore[current] + 1;
      if (tentG >= gScore[ni]) continue;

      cameFrom[ni] = current;
      gScore[ni] = tentG;
      fScore[ni] = tentG + heuristic(nx, ny);

      if (!inOpen[ni]) {
        open.push(ni);
        inOpen[ni] = 1;
      }
    }
  }

  return null; // no path found
}
