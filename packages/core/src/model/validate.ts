import { serviceWayIds } from "./geo";
import type { LngLat, TransitSystem, Way } from "./system";

export interface Issue {
  id: string;
  message: string;
  /** What clicking this issue should select, if anything. */
  target?: { kind: "way"; id: string } | { kind: "station"; id: string } | { kind: "service"; id: string };
}

/**
 * Pure sanity check over a system: catches records the editor accepts
 * silently but that don't actually do anything (a sub-2-point way, a service
 * with no patterns/ways, a station anchored to a way that's gone) plus one
 * structural check — two ways whose alignments visibly cross without
 * actually meeting, which the junction primitive (Node) makes cheap to spot:
 * a genuine interior crossing between two ways that share no Node.
 */
export function validateSystem(system: TransitSystem): Issue[] {
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

  for (const station of system.stations) {
    if (station.anchor && !system.ways.some((w) => w.id === station.anchor!.wayId)) {
      issues.push({
        id: `orphan-station-${station.id}`,
        message: `"${station.name || "A station"}" is anchored to a way that no longer exists.`,
        target: { kind: "station", id: station.id },
      });
    }
  }

  issues.push(...findCrossingsWithoutJoining(system));

  return issues;
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

function findCrossingsWithoutJoining(system: TransitSystem): Issue[] {
  const joined = jointWayPairs(system);
  const issues: Issue[] = [];
  const ways = system.ways.filter((w) => w.points.length >= 2);
  for (let i = 0; i < ways.length; i++) {
    for (let j = i + 1; j < ways.length; j++) {
      const a = ways[i];
      const b = ways[j];
      if (joined.has(pairKey(a.id, b.id))) continue;
      if (!waysCross(a.points, b.points)) continue;
      issues.push({
        id: `crossing-${pairKey(a.id, b.id)}`,
        message: `A ${a.typeId} way crosses a ${b.typeId} way without joining — check whether they should share a junction.`,
        target: { kind: "way", id: a.id },
      });
    }
  }
  return issues;
}

function waysCross(pointsA: LngLat[], pointsB: LngLat[]): boolean {
  for (let i = 0; i < pointsA.length - 1; i++) {
    for (let j = 0; j < pointsB.length - 1; j++) {
      if (segmentsCross(pointsA[i], pointsA[i + 1], pointsB[j], pointsB[j + 1])) return true;
    }
  }
  return false;
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
