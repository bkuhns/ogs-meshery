require('./babel-hook');

// mesh.worker.js's triangulatePiece() uses `poisson-disk-sampling` without
// passing it a seeded RNG, so it falls back to Math.random() internally.
// That makes which Steiner points get sampled non-deterministic run to run
// — harmless for the real app, but it means two harness runs of otherwise
// *identical* code can report different vertex counts, surface areas, and
// (via digMesh's edge-distance-based height offset) even different mean
// heights, especially for small shapes where a few differing samples move
// the average noticeably. Seeding Math.random per worker-thread spawn make
// every run reproducible, so perf:check's comparisons reflect actual code
// changes rather than sampling noise. This only affects this harness's
// worker process, never the real app.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(0xc0ffee);

require('../../src/lib/workers/mesh.worker.js');
