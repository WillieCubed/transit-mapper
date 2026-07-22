import type { LngLat } from "../system";
import { EARTH_RADIUS_M, toRad } from "./spherical";

/** A coordinate `dxMeters` east and `dyMeters` north of `center` (flat-earth
 *  approximation — good enough at station-footprint scale). */
export function offsetMeters(center: LngLat, dxMeters: number, dyMeters: number): LngLat {
  const latRad = toRad(center[1]);
  const dLng = ((dxMeters / (EARTH_RADIUS_M * Math.cos(latRad))) * 180) / Math.PI;
  const dLat = ((dyMeters / EARTH_RADIUS_M) * 180) / Math.PI;
  return [center[0] + dLng, center[1] + dLat];
}

/** Inverse of offsetMeters: how far east/north `coord` sits from `center`, in
 *  meters (same flat-earth approximation). */
export function metersFromOrigin(center: LngLat, coord: LngLat): [dx: number, dy: number] {
  const latRad = toRad(center[1]);
  const dx = toRad(coord[0] - center[0]) * EARTH_RADIUS_M * Math.cos(latRad);
  const dy = toRad(coord[1] - center[1]) * EARTH_RADIUS_M;
  return [dx, dy];
}

/**
 * A copy of `points` shifted `offsetM` meters perpendicular to the line's
 * local direction — positive to the RIGHT of travel (increasing index),
 * negative to the left. Interior vertices use the miter of their two
 * adjacent segment normals (clamped so near-hairpin corners can't shoot the
 * offset point off to infinity). The basis for carriageway separation and
 * for per-lane centerlines in the street geometry engine.
 */
export function offsetPolyline(points: LngLat[], offsetM: number): LngLat[] {
  if (points.length < 2 || offsetM === 0) return points.map((p) => [...p] as LngLat);
  const origin = points[0];
  const local = points.map((p) => metersFromOrigin(origin, p));

  // Unit normal (right of travel) of each segment: direction (dx,dy) → (dy,-dx).
  const normals: [number, number][] = [];
  for (let i = 0; i < local.length - 1; i++) {
    const dx = local[i + 1][0] - local[i][0];
    const dy = local[i + 1][1] - local[i][1];
    const len = Math.hypot(dx, dy) || 1;
    normals.push([dy / len, -dx / len]);
  }

  const MITER_LIMIT = 3; // clamp sharp corners to 3× the offset distance
  const out: LngLat[] = [];
  for (let i = 0; i < local.length; i++) {
    const nPrev = normals[Math.max(0, i - 1)];
    const nNext = normals[Math.min(normals.length - 1, i)];
    let mx = nPrev[0] + nNext[0];
    let my = nPrev[1] + nNext[1];
    const mLen = Math.hypot(mx, my);
    if (mLen < 1e-9) {
      // ~180° hairpin: fall back to the previous segment's plain normal.
      mx = nPrev[0];
      my = nPrev[1];
    } else {
      mx /= mLen;
      my /= mLen;
      // Miter length grows as 1/cos(θ/2) = 1/dot(miter, segment normal); clamp it.
      const cosHalf = mx * nNext[0] + my * nNext[1];
      const scale = Math.min(MITER_LIMIT, 1 / Math.max(cosHalf, 1 / MITER_LIMIT));
      mx *= scale;
      my *= scale;
    }
    out.push(offsetMeters(origin, local[i][0] + mx * offsetM, local[i][1] + my * offsetM));
  }
  return out;
}

/** Ray-casting point-in-polygon (ring open or closed) — e.g. "does this
 *  structure sit on this station's land?". */
export function pointInPolygon(point: LngLat, ring: LngLat[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** A default square polygon of the given half-size, centered on `center` —
 *  the starting point for a station footprint or platform before the user
 *  drags its corners to fit the real site. */
export function squareFootprint(center: LngLat, halfSizeMeters: number): LngLat[] {
  return [
    offsetMeters(center, -halfSizeMeters, -halfSizeMeters),
    offsetMeters(center, halfSizeMeters, -halfSizeMeters),
    offsetMeters(center, halfSizeMeters, halfSizeMeters),
    offsetMeters(center, -halfSizeMeters, halfSizeMeters),
  ];
}
