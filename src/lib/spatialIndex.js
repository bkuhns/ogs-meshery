// Spatial acceleration for the polygon-ring and point-set queries used
// throughout mesh generation. Every one of these was previously a linear
// O(ring length) scan (isPointInPolygon/distanceToPolygonEdge in
// mesh.worker.js) or an O(n^2) unindexed neighbor search
// (preserveBoundaryAndDedupe), repeated once per generated mesh sample —
// for a long/thin/winding polygon with a fine sample spacing (e.g. a
// river), that product is what made mesh generation catastrophically slow.
//
// No DOM/Node-only APIs are used here (plain arithmetic, Map, arrays) so
// this loads safely inside the threads/worker sandboxes in mesh.worker.js.

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  const xx = x1 + t * dx, yy = y1 + t * dy;
  return Math.hypot(px - xx, py - yy);
}

function cellKey(cx, cy) {
  return cx + ',' + cy;
}

// Indexes a single ring for accelerated containsPoint (even-odd ray cast,
// same semantics as pointInRing in src/lib/workers/utils.js) and
// distanceToEdge (nearest-segment distance, same semantics as
// distanceToPolygonEdge in mesh.worker.js).
class RingIndex {
  constructor(ring, cellSize) {
    this.ring = ring;
    this.n = ring.length;
    this.cellSize = cellSize > 0 ? cellSize : 1;

    // Ray casting only needs edges whose y-range overlaps the query point's
    // horizontal strip.
    this.yBuckets = new Map(); // stripIndex -> [edgeEndIdx, ...]
    // Nearest-edge distance only needs edges near the query point.
    this.grid = new Map(); // "cx,cy" -> [edgeEndIdx, ...]

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];

      minX = Math.min(minX, xi); maxX = Math.max(maxX, xi);
      minY = Math.min(minY, yi); maxY = Math.max(maxY, yi);

      const minStrip = Math.floor(Math.min(yi, yj) / this.cellSize);
      const maxStrip = Math.floor(Math.max(yi, yj) / this.cellSize);
      for (let s = minStrip; s <= maxStrip; s++) {
        if (!this.yBuckets.has(s)) this.yBuckets.set(s, []);
        this.yBuckets.get(s).push(i);
      }

      const minCx = Math.floor(Math.min(xi, xj) / this.cellSize);
      const maxCx = Math.floor(Math.max(xi, xj) / this.cellSize);
      const minCy = Math.floor(Math.min(yi, yj) / this.cellSize);
      const maxCy = Math.floor(Math.max(yi, yj) / this.cellSize);
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const key = cellKey(cx, cy);
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(i);
        }
      }
    }

    this.bboxDiagonal = ring.length ? Math.hypot(maxX - minX, maxY - minY) : 0;
  }

  containsPoint(point) {
    const [x, y] = point;
    const strip = Math.floor(y / this.cellSize);
    const edgeEnds = this.yBuckets.get(strip);
    if (!edgeEnds) return false;

    const ring = this.ring;
    const n = this.n;
    let inside = false;
    for (const i of edgeEnds) {
      const j = (i - 1 + n) % n;
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect =
        ((yi > y) !== (yj > y)) &&
        x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  distanceToEdge(point) {
    const [px, py] = point;
    const ring = this.ring;
    const n = this.n;
    const cx0 = Math.floor(px / this.cellSize);
    const cy0 = Math.floor(py / this.cellSize);

    let best = Infinity;
    // Expanding ring of cells (Chebyshev shells) around the query point,
    // visiting only each shell's perimeter (O(radius) cells) rather than the
    // full (2*radius+1)^2 square — the earlier full-square version made a
    // query far from the ring (radius growing into the hundreds/thousands)
    // cost O(radius^3) instead of O(radius^2), which is worse than useless.
    // Correctness: once `best` is <= the distance from the point to the
    // nearest edge of the unscanned shell (radius * cellSize, conservatively),
    // no unscanned cell can contain a closer edge.
    //
    // Cap how far we expand: a query point legitimately far from this ring
    // (e.g. deep inside a wide lake, or deep in a large bbox for a
    // thin/winding polygon) would otherwise cost O(radius^2) — 4*radius^2
    // Map lookups, most into empty cells — before ever reaching the
    // fallback below. Capping small keeps that wasted-expansion cost
    // bounded (4*16^2 = 1024 lookups) regardless of how far away the point
    // turns out to be; the brute-force fallback (O(ring length), same as
    // today's uncached scan) is cheap enough that giving up early and
    // falling back is strictly better than a large cap once a query is
    // going to need the fallback anyway.
    const maxRadius = Math.min(16, Math.ceil(this.bboxDiagonal / this.cellSize) + 1);

    const visitCell = (cx, cy) => {
      const edgeEnds = this.grid.get(cellKey(cx, cy));
      if (!edgeEnds) return;
      for (const i of edgeEnds) {
        const j = (i - 1 + n) % n;
        const d = pointToSegmentDist(px, py, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
        if (d < best) best = d;
      }
    };

    for (let radius = 0; radius <= maxRadius; radius++) {
      if (radius === 0) {
        visitCell(cx0, cy0);
      } else {
        for (let dx = -radius; dx <= radius; dx++) {
          visitCell(cx0 + dx, cy0 - radius);
          visitCell(cx0 + dx, cy0 + radius);
        }
        for (let dy = -radius + 1; dy <= radius - 1; dy++) {
          visitCell(cx0 - radius, cy0 + dy);
          visitCell(cx0 + radius, cy0 + dy);
        }
      }
      if (best !== Infinity && best <= radius * this.cellSize) break;
    }

    // Fallback for a query point far enough from the ring that the capped
    // expansion above didn't converge — brute force stays correct, it just
    // isn't accelerated for that one query.
    if (best === Infinity || best > maxRadius * this.cellSize) {
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const d = pointToSegmentDist(px, py, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
        if (d < best) best = d;
      }
    }
    return best;
  }
}

export function buildRingIndex(ring, cellSize) {
  return new RingIndex(ring, cellSize);
}

// Outer ring + holes, matching isPointInPolygon/distanceToPolygonEdge's
// semantics: inside outer AND not inside any hole; distance is the min
// across the outer ring and every hole.
export function buildPolygonIndex(polygon, holes, cellSize) {
  const outer = new RingIndex(polygon, cellSize);
  const holeIndexes = (holes || []).map(h => new RingIndex(h, cellSize));

  return {
    isInside(point) {
      if (!outer.containsPoint(point)) return false;
      for (const h of holeIndexes) {
        if (h.containsPoint(point)) return false;
      }
      return true;
    },
    distanceToBoundary(point) {
      let min = outer.distanceToEdge(point);
      for (const h of holeIndexes) {
        const d = h.distanceToEdge(point);
        if (d < min) min = d;
      }
      return min;
    },
  };
}

// Bucket-per-cell point set for O(1)-amortized neighbor queries, replacing
// unindexed O(n) / O(n^2) neighbor scans over a growing point list.
export class PointGrid {
  constructor(cellSize) {
    this.cellSize = cellSize > 0 ? cellSize : 1;
    this.grid = new Map();
  }

  _cellOf(x, y) {
    return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
  }

  insert(point) {
    const [cx, cy] = this._cellOf(point[0], point[1]);
    const key = cellKey(cx, cy);
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key).push(point);
  }

  hasNeighborWithin(point, minDist) {
    const [x, y] = point;
    const minDistSq = minDist * minDist;
    const [cx, cy] = this._cellOf(x, y);
    const cellRadius = Math.ceil(minDist / this.cellSize);
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const pts = this.grid.get(cellKey(cx + dx, cy + dy));
        if (!pts) continue;
        for (const p of pts) {
          const ddx = p[0] - x, ddy = p[1] - y;
          if (ddx * ddx + ddy * ddy < minDistSq) return true;
        }
      }
    }
    return false;
  }

  queryRadius(point, radius) {
    const [x, y] = point;
    const r2 = radius * radius;
    const [cx, cy] = this._cellOf(x, y);
    const cellRadius = Math.ceil(radius / this.cellSize);
    const results = [];
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const pts = this.grid.get(cellKey(cx + dx, cy + dy));
        if (!pts) continue;
        for (const p of pts) {
          const ddx = p[0] - x, ddy = p[1] - y;
          if (ddx * ddx + ddy * ddy <= r2) results.push(p);
        }
      }
    }
    return results;
  }
}

export { pointToSegmentDist };
