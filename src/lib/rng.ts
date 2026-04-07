/**
 * Mulberry32 — fast, high-quality 32-bit seeded PRNG.
 * Returns a function that produces values in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * Bridson's Poisson disk sampling — returns up to `maxPoints` points where
 * no two points are closer than `minDist` to each other.
 *
 * ## Why Poisson disk instead of pure random scatter?
 * Uniform random produces clustering by chance — some areas get crowded while
 * others are empty. Poisson disk guarantees a minimum distance between every
 * pair of points, giving natural-looking even spread (like trees in a real
 * forest, or animals in a herd that maintain personal space).
 *
 * ## Algorithm (Bridson 2007, O(n))
 * 1. Place a seed point; add it to the active list.
 * 2. While the active list is non-empty:
 *    a. Pick a random active point.
 *    b. Try up to `k` (default 30) candidate points in the annulus [r, 2r].
 *    c. Accept a candidate if no existing point is within `minDist` of it.
 *    d. If no candidate is accepted after k tries, remove from active list.
 *
 * The background grid (cell size = minDist / √2) makes neighbour lookups O(1).
 *
 * @param rng       Seeded PRNG — pass mulberry32(seed) for determinism
 * @param areaW     Width of the sampling area in pixels
 * @param areaH     Height of the sampling area in pixels
 * @param minDist   Minimum distance between any two points
 * @param maxPoints Hard cap on output size (algorithm may return fewer)
 * @param k         Candidates per active point before retiring it (default 30)
 */
export function poissonDisk(
  rng: () => number,
  areaW: number,
  areaH: number,
  minDist: number,
  maxPoints: number,
  k = 30,
): Array<{ x: number; y: number }> {
  const cellSize = minDist / Math.SQRT2;
  const cols = Math.ceil(areaW / cellSize);
  const rows = Math.ceil(areaH / cellSize);

  // Background grid: stores index into `points` array, or -1 if empty
  const grid = new Int32Array(cols * rows).fill(-1);

  const points: Array<{ x: number; y: number }> = [];
  const active: number[] = []; // indices into `points`

  const gridIdx = (x: number, y: number): number =>
    Math.floor(y / cellSize) * cols + Math.floor(x / cellSize);

  const tooClose = (x: number, y: number): boolean => {
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    // Check the 5×5 neighbourhood — only cells within 2 grid cells can be within minDist
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const idx = grid[nr * cols + nc];
        if (idx === -1) continue;
        const p = points[idx];
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < minDist * minDist) return true;
      }
    }
    return false;
  };

  const addPoint = (x: number, y: number): void => {
    const idx = points.length;
    points.push({ x, y });
    active.push(idx);
    grid[gridIdx(x, y)] = idx;
  };

  // Seed point near centre
  addPoint(areaW * 0.4 + rng() * areaW * 0.2, areaH * 0.4 + rng() * areaH * 0.2);

  while (active.length > 0 && points.length < maxPoints) {
    // Pick a random active point
    const ai = Math.floor(rng() * active.length);
    const pi = active[ai];
    const p = points[pi];

    let found = false;
    for (let attempt = 0; attempt < k; attempt++) {
      // Random point in the annulus [minDist, 2*minDist] around p
      const angle = rng() * Math.PI * 2;
      const dist  = minDist * (1 + rng()); // [minDist, 2*minDist]
      const cx = p.x + Math.cos(angle) * dist;
      const cy = p.y + Math.sin(angle) * dist;

      if (cx < 0 || cx >= areaW || cy < 0 || cy >= areaH) continue;
      if (tooClose(cx, cy)) continue;

      addPoint(cx, cy);
      found = true;
      if (points.length >= maxPoints) break;
    }

    if (!found) {
      // This point is surrounded — retire it from the active list
      active.splice(ai, 1);
    }
  }

  return points;
}
