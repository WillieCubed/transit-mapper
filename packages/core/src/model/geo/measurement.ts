import type { LngLat, Way } from "../system";
import { haversineMeters, toRad } from "./spherical";
import { resolveWayPath } from "./wayPath";

/** Total length of a polyline, in meters. */
export function pathLengthMeters(path: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineMeters(path[i - 1], path[i]);
  return total;
}

export function wayLengthMeters(way: Way): number {
  return pathLengthMeters(resolveWayPath(way));
}

/** Coordinate at normalized arc-length t ∈ [0,1] along a polyline. */
export function pointAtT(path: LngLat[], t: number): LngLat {
  if (path.length === 0) return [0, 0];
  if (path.length === 1) return path[0];
  const total = pathLengthMeters(path);
  if (total === 0) return path[0];
  const target = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = haversineMeters(path[i - 1], path[i]);
    if (acc + seg >= target) {
      const f = seg === 0 ? 0 : (target - acc) / seg;
      const a = path[i - 1];
      const b = path[i];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    acc += seg;
  }
  return path[path.length - 1];
}

export interface NearestOnPath {
  /** Normalized arc-length position [0,1] of the closest point. */
  t: number;
  coord: LngLat;
  distMeters: number;
}

/** The closest point on a polyline to a coordinate. */
export function nearestOnPath(path: LngLat[], coord: LngLat): NearestOnPath | null {
  if (path.length < 2) return null;
  const total = pathLengthMeters(path);
  let acc = 0;
  let best: NearestOnPath | null = null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const { point, f } = projectOnSegment(coord, a, b);
    const d = haversineMeters(coord, point);
    if (best === null || d < best.distMeters) {
      const seg = haversineMeters(a, b);
      const t = total === 0 ? 0 : (acc + seg * f) / total;
      best = { t, coord: point, distMeters: d };
    }
    acc += haversineMeters(a, b);
  }
  return best;
}

// Project a point onto a segment in a local planar approximation (good enough
// at city scale). Returns the closest point and its fraction f ∈ [0,1].
export function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): { point: LngLat; f: number } {
  const latScale = Math.cos(toRad((a[1] + b[1]) / 2));
  const ax = a[0] * latScale;
  const ay = a[1];
  const bx = b[0] * latScale;
  const by = b[1];
  const px = p[0] * latScale;
  const py = p[1];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let f = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  f = Math.max(0, Math.min(1, f));
  return { point: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], f };
}
