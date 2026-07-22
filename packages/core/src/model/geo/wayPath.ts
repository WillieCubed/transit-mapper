import type { LngLat, Way } from "../system";

const CORNER_SAMPLES = 10; // interpolated points per rounded corner.
// Each corner is cut back this fraction of its shorter adjacent segment before
// rounding — keeps a corner's cut point from ever reaching its neighbor's.
const CORNER_FRACTION = 0.25;

// Ways are immutably replaced on every change (see editor/store.ts) — an
// UNCHANGED way keeps the exact same object reference across renders, so
// caching by that reference is safe and needs no invalidation. This matters:
// buildFeatures() calls resolveWayPath for every way (and, per station, for
// every way again via servedWayIds) on every rebuild — during a drag that's
// once per animation frame, and without this cache it was once per raw
// mousemove event, recomputing curve geometry for the entire system each time.
const wayPathCache = new WeakMap<Way, LngLat[]>();

/**
 * The rendered polyline for a way, from its control points and geometry.
 * curved → straight segments with each interior vertex rounded into a corner
 * fillet; straight & freeform → the points as-is (freeform simply has many,
 * hand-drawn).
 */
export function resolveWayPath(way: Way): LngLat[] {
  const cached = wayPathCache.get(way);
  if (cached) return cached;
  const pts = way.points;
  const path = way.geometry === "curved" && pts.length >= 3 ? roundedCorners(pts, CORNER_FRACTION, CORNER_SAMPLES) : pts;
  wayPathCache.set(way, path);
  return path;
}

/**
 * Straight segments between control points, with each interior vertex rounded
 * off by a short quadratic-Bezier fillet computed ONLY from that vertex and
 * its immediate neighbors. Unlike a tangent-continuous spline (e.g. Catmull-
 * Rom), this has strictly bounded, local support: moving control point i can
 * only change the fillets at i-1, i, i+1 and the straight runs between them —
 * it never reshapes anything further down the line. No tangents are computed
 * or propagated between non-adjacent points.
 */
export function roundedCorners(points: LngLat[], cornerFraction: number, samples: number): LngLat[] {
  if (points.length < 3) return points;
  const out: LngLat[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const dPrev = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const dNext = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    const r = Math.min(dPrev, dNext) * cornerFraction;
    if (r < 1e-12) {
      out.push(cur);
      continue;
    }
    const cutIn: LngLat = lerpAt(cur, prev, r / dPrev);
    const cutOut: LngLat = lerpAt(cur, next, r / dNext);
    out.push(cutIn);
    appendQuadraticBezier(cutIn, cur, cutOut, samples, out);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Point a fraction `f` of the way from `a` toward `b`. */
function lerpAt(a: LngLat, b: LngLat, f: number): LngLat {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

function appendQuadraticBezier(p0: LngLat, control: LngLat, p2: LngLat, samples: number, out: LngLat[]): void {
  for (let s = 1; s <= samples; s++) {
    const t = s / samples;
    const u = 1 - t;
    const x = u * u * p0[0] + 2 * u * t * control[0] + t * t * p2[0];
    const y = u * u * p0[1] + 2 * u * t * control[1] + t * t * p2[1];
    out.push([x, y]);
  }
}

// Cached by the ways array's own reference (immutable-replacement
// convention, same as wayPathCache) — patternPath runs on every animation
// frame for every pattern (see map/vehicles.ts), so a linear ways.find per
// wayId adds up fast on a large imported system. Shared between servicePaths
// (patternPath) and snapIndex (snap) — both need way-by-id lookup, neither
// owns the concern more than the other, so it lives alongside the way-path
// cache it's structurally identical to.
const wayByIdCache = new WeakMap<Way[], Map<string, Way>>();

export function wayById(ways: Way[]): Map<string, Way> {
  let index = wayByIdCache.get(ways);
  if (index) return index;
  index = new Map(ways.map((w) => [w.id, w]));
  wayByIdCache.set(ways, index);
  return index;
}
