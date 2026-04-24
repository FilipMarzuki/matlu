/**
 * ExplorationMap — tracks which dungeon tiles the hero has "seen".
 *
 * This is AI-only state (no visual fog rendering). Each tick the hero
 * reveals tiles within a sight radius. The exploration BT node uses
 * `nearestUnexplored()` to pick the next destination — BFS guarantees
 * the closest unexplored floor tile in graph distance, which naturally
 * produces corridor-following behaviour.
 */

/** Maximum BFS nodes to visit when searching for unexplored tiles. */
const MAX_BFS = 1500;

export class ExplorationMap {
  private readonly explored: Uint8Array;
  private readonly cols: number;
  private readonly rows: number;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.explored = new Uint8Array(cols * rows); // all 0 = unexplored
  }

  /**
   * Mark all floor tiles within `radius` of tile (cx, cy) as explored.
   * Only floor tiles (grid value 0) are marked — walls stay unexplored.
   */
  reveal(cx: number, cy: number, radius: number, grid: ArrayLike<number>): void {
    const r2 = radius * radius;
    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(this.cols - 1, cx + radius);
    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(this.rows - 1, cy + radius);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        // Line-of-sight check: walk from (cx,cy) to (x,y) via Bresenham.
        // If any wall tile blocks the path, this tile is not visible.
        if (!this.hasLOS(cx, cy, x, y, grid)) continue;
        const idx = y * this.cols + x;
        if (grid[idx] === 0) this.explored[idx] = 1;
      }
    }
  }

  /**
   * Bresenham line-of-sight: returns false if any wall tile (grid=1)
   * lies on the line from (x0,y0) to (x1,y1). The target tile itself
   * is excluded from the wall check so walls adjacent to floor are
   * still revealed (you can see a wall face even if the wall cell is solid).
   */
  private hasLOS(
    x0: number, y0: number, x1: number, y1: number,
    grid: ArrayLike<number>,
  ): boolean {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = x0;
    let cy = y0;

    while (cx !== x1 || cy !== y1) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 <  dx) { err += dx; cy += sy; }
      // Stop before the target tile — only intermediate tiles block sight.
      if (cx === x1 && cy === y1) break;
      if (grid[cy * this.cols + cx] !== 0) return false; // wall blocks LOS
    }
    return true;
  }

  /** Force-mark a single tile as explored (e.g. unreachable tiles). */
  markExplored(tx: number, ty: number): void {
    if (tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows) {
      this.explored[ty * this.cols + tx] = 1;
    }
  }

  /** Check if a single tile has been explored. */
  isExplored(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return false;
    return this.explored[ty * this.cols + tx] === 1;
  }

  /**
   * BFS outward from (cx, cy) to find the nearest unexplored floor tile.
   * Returns tile coords or null if everything reachable is already explored.
   */
  nearestUnexplored(
    cx: number,
    cy: number,
    grid: ArrayLike<number>,
  ): { x: number; y: number } | null {
    const visited = new Uint8Array(this.cols * this.rows);
    // BFS distance per node — used to collect candidates at similar depth.
    const dist = new Uint16Array(this.cols * this.rows);
    const queue: number[] = [];
    const startIdx = cy * this.cols + cx;

    visited[startIdx] = 1;
    queue.push(startIdx);

    let count = 0;
    const DX = [1, -1, 0, 0];
    const DY = [0, 0, 1, -1];

    // Collect up to 5 candidates within 4 tiles of the nearest one,
    // then pick one randomly. This adds variety to exploration routes.
    const candidates: { x: number; y: number }[] = [];
    let firstDist = -1;

    while (queue.length > 0 && count < MAX_BFS) {
      const cur = queue.shift()!;
      count++;

      const curX = cur % this.cols;
      const curY = (cur - curX) / this.cols;

      if (this.explored[cur] === 0 && grid[cur] === 0) {
        if (firstDist < 0) firstDist = dist[cur];
        // Only collect candidates within 4 BFS steps of the nearest.
        if (dist[cur] - firstDist > 4) break;
        candidates.push({ x: curX, y: curY });
        if (candidates.length >= 5) break;
      }

      for (let d = 0; d < 4; d++) {
        const nx = curX + DX[d];
        const ny = curY + DY[d];
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const ni = ny * this.cols + nx;
        if (visited[ni] || grid[ni] !== 0) continue;
        visited[ni] = 1;
        dist[ni] = dist[cur] + 1;
        queue.push(ni);
      }
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}
