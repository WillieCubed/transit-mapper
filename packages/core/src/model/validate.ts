import { serviceWayIds } from "./geo";
import type { LngLat, TransitSystem, Way } from "./system";

export interface Issue {
  id: string;
  message: string;
  /** What clicking this issue should select, if anything. */
  target?: { kind: "way"; id: string } | { kind: "station"; id: string } | { kind: "service"; id: string };
}

/**
 * The cheap half of validateSystem: ghost/orphan record checks, all a single
 * O(n) pass (the orphan-station check used to be O(stations × ways) via
 * `.some()` per station — fixed to a Set lookup). Safe to run reactively on
 * every store change, unlike crossing detection below — see validateSystem's
 * own note on why that one is NOT in this cheap tier.
 */
export function validateSystemQuick(system: TransitSystem): Issue[] {
  const issues: Issue[] = [];

  for (const way of system.ways) {
    if (way.points.length < 2) {
      issues.push({
        id: `ghost-way-${way.id}`,
        message: `A ${way.typeId} way has fewer than 2 points and won't render.`,
        target: { kind: "way", id: way.id },
      });
    }
  }

  for (const service of system.services) {
    if (serviceWayIds(service).length === 0) {
      issues.push({
        id: `ghost-service-${service.id}`,
        message: `"${service.name}" doesn't run over any way.`,
        target: { kind: "service", id: service.id },
      });
    }
  }

  const wayIds = new Set(system.ways.map((w) => w.id));
  for (const station of system.stations) {
    if (station.anchor && !wayIds.has(station.anchor.wayId)) {
      issues.push({
        id: `orphan-station-${station.id}`,
        message: `"${station.name || "A station"}" is anchored to a way that no longer exists.`,
        target: { kind: "station", id: station.id },
      });
    }
  }

  return issues;
}

/**
 * The full check: validateSystemQuick's cheap ghost/orphan checks, plus one
 * structural check — two ways whose alignments visibly cross without
 * actually meeting, which the junction primitive (Node) makes cheap to spot:
 * a genuine interior crossing between two ways that share no Node.
 *
 * Crossing detection is NOT part of validateSystemQuick because, even with
 * the spatial grid below, it's fundamentally expensive on a real transit
 * network: many routes genuinely run along the same shared street corridors,
 * so a real GTFS import's ~285 ways produced ~9-16 million candidate segment
 * pairs no amount of cell-size tuning got under a few million (confirmed by
 * benchmarking cell sizes from 1km down to 200m against RTC Southern
 * Nevada's real feed) — a multi-second cost inherent to the DATA, not an
 * implementation bug. Running that reactively on every store update (this
 * used to feed an always-mounted toolbar badge) is what froze the app during
 * normal use; see IssuesPopover for how this is now called explicitly
 * on-demand instead.
 */
export function validateSystem(system: TransitSystem): Issue[] {
  return [...validateSystemQuick(system), ...findCrossingsWithoutJoining(system)];
}

// Two ways sharing a Node are joined on purpose — never flagged, regardless
// of how their segments happen to fall.
function jointWayPairs(system: TransitSystem): Set<string> {
  const pairs = new Set<string>();
  for (const node of system.nodes) {
    const wayIds = [...new Set(node.refs.map((r) => r.wayId))];
    for (let i = 0; i < wayIds.length; i++) {
      for (let j = i + 1; j < wayIds.length; j++) pairs.add(pairKey(wayIds[i], wayIds[j]));
    }
  }
  return pairs;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ~100m at Vegas's latitude. Unlike geo.ts's INTERCHANGE grid (a fixed
// real-world proximity radius), this only needs to bound bbox-overlap tests:
// two segments can only cross if their bounding boxes overlap, and inserting
// each segment into every cell its bbox spans guarantees any truly
// overlapping pair shares at least one cell — no distance margin needed.
// Empirically the best of {1km, 300m, 100m, 50m, 20m} tried against RTC
// Southern Nevada's real feed — candidate pairs bottom out around here
// (finer cells add grid overhead without shrinking the candidate set
// further, since real routes densely share the same street corridors).
const CROSS_CELL_DEG = 0.001;

interface CrossSegment {
  wayId: string;
  typeId: string;
  a: LngLat;
  b: LngLat;
}

function crossCellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

function crossBboxCells(a: LngLat, b: LngLat): { cx0: number; cx1: number; cy0: number; cy1: number } {
  return {
    cx0: Math.floor(Math.min(a[0], b[0]) / CROSS_CELL_DEG),
    cx1: Math.floor(Math.max(a[0], b[0]) / CROSS_CELL_DEG),
    cy0: Math.floor(Math.min(a[1], b[1]) / CROSS_CELL_DEG),
    cy1: Math.floor(Math.max(a[1], b[1]) / CROSS_CELL_DEG),
  };
}

function buildCrossGrid(ways: Way[]): Map<string, CrossSegment[]> {
  const grid = new Map<string, CrossSegment[]>();
  for (const way of ways) {
    for (let i = 0; i < way.points.length - 1; i++) {
      const seg: CrossSegment = { wayId: way.id, typeId: way.typeId, a: way.points[i], b: way.points[i + 1] };
      const { cx0, cx1, cy0, cy1 } = crossBboxCells(seg.a, seg.b);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = crossCellKey(cx, cy);
          const bucket = grid.get(key);
          if (bucket) bucket.push(seg);
          else grid.set(key, [seg]);
        }
      }
    }
  }
  return grid;
}

function crossingIssuesForSegment(
  way: Way,
  a1: LngLat,
  a2: LngLat,
  grid: Map<string, CrossSegment[]>,
  joined: Set<string>,
  flagged: Set<string>,
): Issue[] {
  const issues: Issue[] = [];
  const { cx0, cx1, cy0, cy1 } = crossBboxCells(a1, a2);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const bucket = grid.get(crossCellKey(cx, cy));
      if (!bucket) continue;
      for (const other of bucket) {
        if (other.wayId === way.id) continue;
        const key = pairKey(way.id, other.wayId);
        if (flagged.has(key) || joined.has(key)) continue;
        if (!segmentsCross(a1, a2, other.a, other.b)) continue;
        flagged.add(key);
        issues.push({
          id: `crossing-${key}`,
          message: `A ${way.typeId} way crosses a ${other.typeId} way without joining — check whether they should share a junction.`,
          target: { kind: "way", id: way.id },
        });
      }
    }
  }
  return issues;
}

function crossingIssuesForWay(way: Way, grid: Map<string, CrossSegment[]>, joined: Set<string>, flagged: Set<string>): Issue[] {
  const issues: Issue[] = [];
  for (let i = 0; i < way.points.length - 1; i++) {
    issues.push(...crossingIssuesForSegment(way, way.points[i], way.points[i + 1], grid, joined, flagged));
  }
  return issues;
}

/**
 * A real GTFS/OSM import's ways are long, dense, street-following polylines
 * — hundreds of ways with hundreds of points each. The naive version here
 * (every way pair × every segment pair) is O(ways² × segments²), which
 * turned a few hundred real ways into ~100 million segment checks. A spatial
 * grid bounds each segment's candidate set to whatever shares its own
 * bounding-box cells, the same technique geo.ts uses for servedWayIds
 * against the identical class of problem — but even so, real routes sharing
 * street corridors keep the candidate-pair count in the millions (see the
 * CROSS_CELL_DEG note): a multi-second cost inherent to the data, not this
 * function. Synchronous, so only for tests (tiny fixture systems) and
 * validateSystem's own full-check contract — the live UI never calls this
 * directly, see crossingsWithoutJoiningChunked below for that.
 */
export function findCrossingsWithoutJoining(system: TransitSystem): Issue[] {
  const joined = jointWayPairs(system);
  const ways = system.ways.filter((w) => w.points.length >= 2);
  const grid = buildCrossGrid(ways);
  const flagged = new Set<string>();
  const issues: Issue[] = [];
  for (const way of ways) issues.push(...crossingIssuesForWay(way, grid, joined, flagged));
  return issues;
}

// Wall-clock budget per chunk, not a fixed way/segment count — a fixed
// count still let one chunk land entirely inside a dense shared-corridor
// hotspot (see findCrossingsWithoutJoining's note) and block for hundreds of
// ms; checking elapsed time between individual SEGMENTS instead bounds every
// chunk to roughly this budget regardless of how the work is distributed.
// Confirmed against RTC Southern Nevada's real feed: a fixed 6-ways-per-
// chunk version still produced a ~400ms chunk on a busy downtown corridor.
const CROSSING_CHUNK_BUDGET_MS = 8;

/**
 * Same crossing detection as findCrossingsWithoutJoining, but split into
 * time-budgeted chunks with a `setTimeout(0)` yield between them (not
 * `requestAnimationFrame` — rAF pauses indefinitely on a backgrounded tab,
 * the same reasoning as gtfsImport.ts's streamRtcGtfsBatches) — so
 * IssuesPopover's live badge stays accurate WITHOUT ever blocking a frame,
 * on a check that can otherwise run several seconds straight on a large real
 * import.
 *
 * Already Worker-shaped: an async generator yielding per-chunk is exactly
 * the pattern a Web Worker would use too (post a progress message per yield
 * instead of yielding to the event loop) — moving this off the main thread
 * later is a transport change around this same generator, not a rewrite of
 * the algorithm.
 */
export async function* crossingsWithoutJoiningChunked(system: TransitSystem): AsyncGenerator<Issue[]> {
  const joined = jointWayPairs(system);
  const ways = system.ways.filter((w) => w.points.length >= 2);
  const grid = buildCrossGrid(ways);
  const flagged = new Set<string>();
  let chunkIssues: Issue[] = [];
  let chunkStart = performance.now();
  for (const way of ways) {
    for (let i = 0; i < way.points.length - 1; i++) {
      chunkIssues.push(...crossingIssuesForSegment(way, way.points[i], way.points[i + 1], grid, joined, flagged));
      if (performance.now() - chunkStart < CROSSING_CHUNK_BUDGET_MS) continue;
      if (chunkIssues.length > 0) {
        yield chunkIssues;
        chunkIssues = [];
      }
      await new Promise((r) => setTimeout(r, 0));
      chunkStart = performance.now();
    }
  }
  if (chunkIssues.length > 0) yield chunkIssues;
}

/** One genuine interior crossing between two ways' control polylines. The
 *  indices are INSERTION points: splicing `coord` into a.points at `aIndex`
 *  (and b.points at `bIndex`) puts a real shared vertex at the crossing —
 *  the input formCrossingJunctions needs to form a junction there. */
export interface WayCrossing {
  coord: LngLat;
  aIndex: number;
  bIndex: number;
}

/** Every interior crossing between two ways, ordered along way `a`.
 *  Endpoint touches (already-joined junction vertices) are not crossings —
 *  same rule as the validation pass above. */
export function wayCrossings(a: Way, b: Way): WayCrossing[] {
  const crossings: WayCrossing[] = [];
  for (let i = 0; i < a.points.length - 1; i++) {
    for (let j = 0; j < b.points.length - 1; j++) {
      const hit = segmentCrossingPoint(a.points[i], a.points[i + 1], b.points[j], b.points[j + 1]);
      if (hit) crossings.push({ coord: hit, aIndex: i + 1, bIndex: j + 1 });
    }
  }
  return crossings;
}

/** The interior crossing point of two segments, or null. Same interior-only
 *  rule as segmentsCross. */
function segmentCrossingPoint(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): LngLat | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-15) return null;
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
  const EPS = 1e-9;
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return [p1[0] + t * d1x, p1[1] + t * d1y];
}

// True for a genuine interior crossing only — segments that merely touch at
// an endpoint (t or u exactly 0/1, which is what a real shared junction
// vertex looks like) are deliberately NOT a crossing.
function segmentsCross(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): boolean {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-15) return false; // parallel or collinear — not treated as a crossing
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
  const EPS = 1e-9;
  return t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
}
