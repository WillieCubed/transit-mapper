import type { LngLat, Way } from "../system";
import { haversineMeters } from "./spherical";
import { nearestOnPath, projectOnSegment } from "./measurement";
import { resolveWayPath, wayById } from "./wayPath";

export interface InsertionPoint {
  /** Index in the RAW `points` array to splice the new control point into. */
  index: number;
  coord: LngLat;
  distMeters: number;
}

/**
 * Where to splice a new control point into a way's RAW `points` array so it
 * lands on the segment nearest `coord` — unlike `nearestOnPath`/`snap`, which
 * operate on the curve-RESOLVED path, this always returns a real control-
 * point index, since forming a genuine junction requires inserting an actual
 * point into the target way, not just a coordinate that happens to sit on its
 * rendered curve.
 */
export function nearestInsertionPoint(points: LngLat[], coord: LngLat): InsertionPoint | null {
  if (points.length < 2) return null;
  let best: InsertionPoint | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const { point } = projectOnSegment(coord, points[i], points[i + 1]);
    const d = haversineMeters(coord, point);
    if (best === null || d < best.distMeters) best = { index: i + 1, coord: point, distMeters: d };
  }
  return best;
}

export interface Snap {
  wayId: string;
  t: number;
  coord: LngLat;
  distMeters: number;
}

/**
 * The best snap target across a set of ways: the nearest way whose path comes
 * within maxMeters of coord. The generalized snap engine everything routes
 * through — track↔station, way↔way endpoints, and so on — so snapping is the
 * default UX. An optional `exclude` set skips a way (e.g. the one being
 * drawn). An optional `typeId` restricts candidates to that exact way type —
 * used while drawing new geometry, since a shared node only makes physical
 * sense between ways of the same type (mirrors nearestOpenEndpoint's own
 * typeId filter below; a road has no business snapping onto a rail track a
 * screen's-width away). Left unset for station-anchoring snaps, where any
 * way type is a valid stop.
 *
 * Candidates are narrowed via the same segment grid servedWayIds uses
 * (below) before the exact nearestOnPath check runs — a brute-force scan of
 * every way here was the same class of problem servedWayIds already had to
 * solve at real-GTFS scale (station drag, way-endpoint join-detection while
 * drawing, and "adopt existing infrastructure" all route through this).
 */
export function snap(ways: Way[], coord: LngLat, maxMeters: number, exclude?: Set<string>, typeId?: string): Snap | null {
  const byId = wayById(ways);
  let best: Snap | null = null;
  for (const id of candidateWayIdsNear(coord, ways, maxMeters)) {
    if (exclude?.has(id)) continue;
    const way = byId.get(id);
    if (!way) continue;
    if (typeId && way.typeId !== typeId) continue;
    const near = nearestOnPath(resolveWayPath(way), coord);
    if (!near || near.distMeters > maxMeters) continue;
    if (best === null || near.distMeters < best.distMeters) {
      best = { wayId: way.id, t: near.t, coord: near.coord, distMeters: near.distMeters };
    }
  }
  return best;
}

// A uniform lat/lng grid over every SEGMENT (not whole way) of a given ways
// array, cached by that array's own reference — safe because buildFeatures
// recomputes `visibleWays` as a fresh array on every rebuild, so an old
// index is simply never looked up again and falls out of the WeakMap.
// Per-WAY bounding boxes turned out not to help here: a real bus route's
// Way can span the whole city, so its bbox rejects almost nothing. Bucketing
// by segment does — a station only ever needs the handful of segments in
// its own neighborhood, not the other ~120,000 points somewhere else on the
// map. Without this, buildFeatures's per-station interchange check (every
// station × every segment of every way) was O(stations × total way points):
// fine for a few dozen hand-drawn stations, but a real GTFS import
// (thousands of stations, hundreds of detailed street-following shapes,
// ~120,000 points total) turned that into ~460 million segment checks and
// froze the tab. Confirmed live against RTC Southern Nevada's real feed.
const CELL_DEG = 0.003; // ~300m at Vegas's latitude — a few INTERCHANGE_METERS-widths per cell keeps neighborhoods small without so many cells that a segment spanning a boundary gets missed.

interface GridSegment {
  wayId: string;
  a: LngLat;
  b: LngLat;
}

function cellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

// A degree of longitude covers cos(latitude) as many meters as a degree of
// latitude — 111,320m is only correct on the equator. Using it unadjusted for
// the longitude (dx) axis UNDERCOUNTS how many cells maxMeters actually spans
// east-west away from the equator (at Vegas's ~36°N, a longitude cell is only
// ~81% as wide in meters as a latitude cell), so a candidate segment within
// maxMeters could sit just outside the scanned dx range and never be found.
// Clamped so a near-pole latitude (cos → 0) can't blow this up into scanning
// an unbounded number of cells.
function lngCellRadius(maxMeters: number, latDeg: number): number {
  const metersPerDegLng = 111_320 * Math.max(Math.cos((latDeg * Math.PI) / 180), 0.01);
  return Math.ceil(maxMeters / metersPerDegLng / CELL_DEG) + 1;
}

function buildSegmentGrid(ways: Way[]): Map<string, GridSegment[]> {
  const grid = new Map<string, GridSegment[]>();
  for (const way of ways) {
    const path = resolveWayPath(way);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const cx0 = Math.floor(Math.min(a[0], b[0]) / CELL_DEG);
      const cx1 = Math.floor(Math.max(a[0], b[0]) / CELL_DEG);
      const cy0 = Math.floor(Math.min(a[1], b[1]) / CELL_DEG);
      const cy1 = Math.floor(Math.max(a[1], b[1]) / CELL_DEG);
      const seg: GridSegment = { wayId: way.id, a, b };
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = cellKey(cx, cy);
          const bucket = grid.get(key);
          if (bucket) bucket.push(seg);
          else grid.set(key, [seg]);
        }
      }
    }
  }
  return grid;
}

const segmentGridCache = new WeakMap<Way[], Map<string, GridSegment[]>>();

// Candidate way IDs for snap(): every way with a segment inside coord's
// cell-radius, reusing the same grid buildSegmentGrid/segmentGridCache
// already maintain for servedWayIds — no exact distance computed here (that
// happens once, per candidate, in snap()'s own nearestOnPath call below),
// just cheap cell-bucket membership.
function candidateWayIdsNear(coord: LngLat, ways: Way[], maxMeters: number): Set<string> {
  let grid = segmentGridCache.get(ways);
  if (!grid) {
    grid = buildSegmentGrid(ways);
    segmentGridCache.set(ways, grid);
  }
  const cellRadiusLat = Math.ceil(maxMeters / 111_320 / CELL_DEG) + 1;
  const cellRadiusLng = lngCellRadius(maxMeters, coord[1]);
  const cx = Math.floor(coord[0] / CELL_DEG);
  const cy = Math.floor(coord[1] / CELL_DEG);
  const ids = new Set<string>();
  for (let dx = -cellRadiusLng; dx <= cellRadiusLng; dx++) {
    for (let dy = -cellRadiusLat; dy <= cellRadiusLat; dy++) {
      const bucket = grid.get(cellKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (const seg of bucket) ids.add(seg.wayId);
    }
  }
  return ids;
}

/** IDs of every way whose path passes within maxMeters of a coordinate. */
export function servedWayIds(coord: LngLat, ways: Way[], maxMeters: number): string[] {
  let grid = segmentGridCache.get(ways);
  if (!grid) {
    grid = buildSegmentGrid(ways);
    segmentGridCache.set(ways, grid);
  }
  const cellRadiusLat = Math.ceil(maxMeters / 111_320 / CELL_DEG) + 1; // +1 cell of margin for anything straddling a boundary
  const cellRadiusLng = lngCellRadius(maxMeters, coord[1]);
  const cx = Math.floor(coord[0] / CELL_DEG);
  const cy = Math.floor(coord[1] / CELL_DEG);
  const bestByWay = new Map<string, number>();
  for (let dx = -cellRadiusLng; dx <= cellRadiusLng; dx++) {
    for (let dy = -cellRadiusLat; dy <= cellRadiusLat; dy++) {
      const bucket = grid.get(cellKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (const seg of bucket) {
        const { point } = projectOnSegment(coord, seg.a, seg.b);
        const d = haversineMeters(coord, point);
        const prev = bestByWay.get(seg.wayId);
        if (prev === undefined || d < prev) bestByWay.set(seg.wayId, d);
      }
    }
  }
  const ids: string[] = [];
  for (const [wayId, d] of bestByWay) if (d <= maxMeters) ids.push(wayId);
  return ids;
}

// A station within this distance of a way's path counts as served by it, so a
// station where services meet reads as a multimodal interchange.
export const INTERCHANGE_METERS = 90;

export interface OpenEndpoint {
  wayId: string;
  end: "start" | "end";
  coord: LngLat;
  distMeters: number;
}

/**
 * The nearest OPEN endpoint (a way's first or last control point) within
 * maxMeters of coord, optionally restricted to one way type. This is what
 * lets pressing near an already-drawn line's end continue that same line
 * (turnkey, SimCity-style) instead of always starting an unrelated new one —
 * distinct from `snap()`, which matches anywhere along a path, not just ends.
 */
export function nearestOpenEndpoint(ways: Way[], coord: LngLat, maxMeters: number, typeId?: string): OpenEndpoint | null {
  let best: OpenEndpoint | null = null;
  for (const way of ways) {
    if (typeId && way.typeId !== typeId) continue;
    if (way.points.length === 0) continue;
    const candidates: ["start" | "end", LngLat][] = [
      ["start", way.points[0]],
      ["end", way.points[way.points.length - 1]],
    ];
    for (const [end, pt] of candidates) {
      const distMeters = haversineMeters(coord, pt);
      if (distMeters <= maxMeters && (best === null || distMeters < best.distMeters)) {
        best = { wayId: way.id, end, coord: pt, distMeters };
      }
    }
  }
  return best;
}
