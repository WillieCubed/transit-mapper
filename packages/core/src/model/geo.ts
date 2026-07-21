import type { LngLat, Pattern, Service, TransitSystem, Way } from "./system";

const EARTH_RADIUS_M = 6371008.8;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Great-circle distance between two [lng,lat] points, in meters. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from `a` to `b`, in degrees clockwise from
 *  true north (0–360). */
export function bearingDegrees(a: LngLat, b: LngLat): number {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLng = toRad(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** "142° SE" — a bearing in degrees plus its nearest 16-point compass label. */
export function formatBearing(degrees: number): string {
  const point = COMPASS_POINTS[Math.round(degrees / 22.5) % 16];
  return `${Math.round(degrees)}° ${point}`;
}

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

/** Total length of a polyline, in meters. */
export function pathLengthMeters(path: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineMeters(path[i - 1], path[i]);
  return total;
}

export function wayLengthMeters(way: Way): number {
  return pathLengthMeters(resolveWayPath(way));
}

/** Every way a service touches across ALL its patterns, deduplicated — the
 *  right unit for "does this way carry this service" (rendering bundle/
 *  offset counts, interchange detection, …), where a service having two
 *  branches that share a trunk way must still count as ONE service on that
 *  way, not two. Use a pattern's own `wayIds` directly when you need one
 *  branch's ordered path specifically. */
export function serviceWayIds(service: Service): string[] {
  return [...new Set(service.patterns.flatMap((p) => p.wayIds))];
}

// Cached by the ways array's own reference (immutable-replacement
// convention, same as wayPathCache) — patternPath runs on every animation
// frame for every pattern (see map/vehicles.ts), so a linear ways.find per
// wayId adds up fast on a large imported system.
const wayByIdCache = new WeakMap<Way[], Map<string, Way>>();

function wayById(ways: Way[]): Map<string, Way> {
  let index = wayByIdCache.get(ways);
  if (index) return index;
  index = new Map(ways.map((w) => [w.id, w]));
  wayByIdCache.set(ways, index);
  return index;
}

/** The concatenated resolved path a single pattern (branch) actually
 *  traces — its ways, in order, stitched into one polyline. */
export function patternPath(ways: Way[], pattern: Pattern): LngLat[] {
  const byId = wayById(ways);
  const path: LngLat[] = [];
  for (const wayId of pattern.wayIds) {
    const way = byId.get(wayId);
    const seg = way ? resolveWayPath(way) : [];
    if (seg.length < 2) continue;
    path.push(...(path.length ? seg.slice(1) : seg));
  }
  return path;
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

export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

/** The bounding box of every point in the system — ways, stations (+
 *  footprints), facilities (+ polygon geometry), group footprints. Used to
 *  frame a "whole system" export/preview instead of whatever's currently on
 *  screen. Null for an empty system, so callers can fall back to the current
 *  viewport instead of fitting to nothing. */
export function systemBounds(system: TransitSystem): [LngLat, LngLat] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const grow = (c: LngLat) => {
    if (c[0] < minLng) minLng = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[0] > maxLng) maxLng = c[0];
    if (c[1] > maxLat) maxLat = c[1];
  };
  for (const w of system.ways) w.points.forEach(grow);
  for (const st of system.stations) {
    grow(st.coord);
    st.footprint?.forEach(grow);
    st.platforms?.forEach((p) => p.points.forEach(grow));
  }
  for (const f of system.facilities) {
    if (Array.isArray(f.geometry[0])) (f.geometry as LngLat[]).forEach(grow);
    else grow(f.geometry as LngLat);
  }
  for (const g of system.groups) g.footprint?.forEach(grow);
  if (minLng === Infinity) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}
