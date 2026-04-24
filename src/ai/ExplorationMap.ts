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
        const idx = y * this.cols + x;
        if (grid[idx] === 0) this.explored[idx] = 1;
      }
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
    const queue: number[] = [];
    const startIdx = cy * this.cols + cx;

    visited[startIdx] = 1;
    queue.push(startIdx);

    let count = 0;
    const DX = [1, -1, 0, 0];
    const DY = [0, 0, 1, -1];

    while (queue.length > 0 && count < MAX_BFS) {
      const cur = queue.shift()!;
      count++;

      const curX = cur % this.cols;
      const curY = (cur - curX) / this.cols;

      // Found an unexplored floor tile — return it.
      if (this.explored[cur] === 0 && grid[cur] === 0) {
        return { x: curX, y: curY };
      }

      for (let d = 0; d < 4; d++) {
        const nx = curX + DX[d];
        const ny = curY + DY[d];
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const ni = ny * this.cols + nx;
        if (visited[ni] || grid[ni] !== 0) continue;
        visited[ni] = 1;
        queue.push(ni);
      }
    }

    return null; // everything reachable is explored
  }
}
