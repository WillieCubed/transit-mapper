// Routing over EXISTING infrastructure: the pure graph + shortest-path core
// behind (a) drawing a service line that snaps along already-built ways in
// the Network view, and (b) re-binding an already-sketched service onto the
// real street/track network ("adopt existing infrastructure").
//
// The graph is segment-level: each way contributes edges between its
// "anchor points" — its two endpoints plus every control point a junction
// Node references — so a route can turn at any junction, not just at way
// ends. A click in the middle of a block becomes a VIRTUAL anchor connected
// into its enclosing segment with partial costs; materializing the route
// (editor/store.ts) later inserts a real control point + splits there.
//
// Pure and network-free like the rest of model/: everything is testable
// data-in/data-out, and the store owns all mutation. This also makes the
// Dijkstra core a safe future candidate for moving off the main thread (a Web
// Worker) or server-side (apps/worker) if a real simulation ever needs to
// route at a scale that matters — nothing here touches store.ts, the DOM, or
// any other stateful context, so relocating it is a call-site change, not a
// rewrite.

import { haversineMeters, nearestInsertionPoint } from "./geo";
import type { LngLat, TransitSystem, Way } from "./system";

/** Where a route starts/ends: a way plus the raw-points insertion produced
 *  by projecting the clicked coordinate onto it (see anchorOnWay). */
export interface RouteAnchor {
  wayId: string;
  /** Insertion index into the way's RAW control points (nearestInsertionPoint). */
  insertIndex: number;
  coord: LngLat;
}

/** One traversed stretch of one way, in RAW control-point indexes. The route
 *  runs fromPoint→toPoint; fromPoint > toPoint means it traverses the way
 *  against its point order (fine for services — patterns are orientation-
 *  agnostic). Endpoints that landed mid-way carry the fractional coordinate
 *  so materialization can splice a real point in. */
export interface RouteSpan {
  wayId: string;
  fromPoint: number;
  toPoint: number;
  /** Set when the span's start is the route's mid-way start anchor. */
  fromCoord?: LngLat;
  /** Set when the span's end is the route's mid-way end anchor. */
  toCoord?: LngLat;
  /** Both anchors fell inside ONE segment of the way — the span is purely
   *  fractional (fromCoord→toCoord, no raw points between); `seg` is that
   *  segment's upper point index. fromPoint/toPoint are not meaningful. */
  noInterior?: boolean;
  seg?: number;
}

export interface RouteResult {
  spans: RouteSpan[];
  lengthM: number;
}

/** Project a map coordinate onto a way as a route anchor, or null when the
 *  way can't host one (fewer than 2 points). */
export function anchorOnWay(way: Way, coord: LngLat): RouteAnchor | null {
  const ins = nearestInsertionPoint(way.points, coord);
  if (!ins) return null;
  return { wayId: way.id, insertIndex: ins.index, coord: ins.coord };
}

// ---- graph construction -----------------------------------------------------

interface Vertex {
  key: string;
  coord: LngLat;
  edges: { to: string; costM: number; span: RouteSpan }[];
}

/** Anchor indexes on a way: endpoints + every junction-referenced point. */
function anchorIndexes(way: Way, nodesByWay: Map<string, number[]>): number[] {
  const set = new Set<number>([0, way.points.length - 1]);
  for (const idx of nodesByWay.get(way.id) ?? []) set.add(idx);
  return [...set].sort((a, b) => a - b);
}

function segmentCost(way: Way, from: number, to: number): number {
  let m = 0;
  for (let i = from; i < to; i++) m += haversineMeters(way.points[i], way.points[i + 1]);
  return m;
}

/** Vertex identity: the shared Node's id when a junction lives at this
 *  point (that's what joins ways together), else a way-local endpoint key. */
function vertexKeyAt(wayId: string, pointIndex: number, nodeAt: Map<string, string>): string {
  return nodeAt.get(`${wayId}:${pointIndex}`) ?? `e:${wayId}:${pointIndex}`;
}

export interface RouteGraphOptions {
  /** Only ways of these types participate (mode compatibility). */
  allowedTypeIds: Set<string>;
  /** Ways excluded entirely (e.g. a sketch being re-bound routes around itself). */
  excludeWayIds?: Set<string>;
  /** Corridor bias: edges far from this path cost proportionally more, so
   *  the route follows a sketched line instead of any equally-short detour. */
  biasPath?: LngLat[];
  biasWeight?: number;
}

const BIAS_SCALE_M = 300; // distance at which the bias multiplier ≈ 1+weight

function biasMultiplier(mid: LngLat, biasPath: LngLat[] | undefined, weight: number): number {
  if (!biasPath || biasPath.length === 0 || weight <= 0) return 1;
  let best = Infinity;
  // Sample against path vertices — the bias only needs to be roughly right.
  for (const p of biasPath) {
    const d = haversineMeters(mid, p);
    if (d < best) best = d;
  }
  return 1 + weight * Math.min(best / BIAS_SCALE_M, 4);
}

function buildGraph(system: TransitSystem, opts: RouteGraphOptions): { vertices: Map<string, Vertex>; nodeAt: Map<string, string> } {
  const vertices = new Map<string, Vertex>();
  const nodeAt = new Map<string, string>(); // "wayId:pointIndex" -> nodeId
  const nodesByWay = new Map<string, number[]>();
  for (const node of system.nodes) {
    for (const ref of node.refs) {
      nodeAt.set(`${ref.wayId}:${ref.pointIndex}`, node.id);
      const arr = nodesByWay.get(ref.wayId) ?? [];
      arr.push(ref.pointIndex);
      nodesByWay.set(ref.wayId, arr);
    }
  }

  const ensure = (key: string, coord: LngLat): Vertex => {
    let v = vertices.get(key);
    if (!v) {
      v = { key, coord, edges: [] };
      vertices.set(key, v);
    }
    return v;
  };

  const weight = opts.biasWeight ?? 0;
  for (const way of system.ways) {
    if (!opts.allowedTypeIds.has(way.typeId)) continue;
    if (opts.excludeWayIds?.has(way.id)) continue;
    if (way.points.length < 2) continue;
    const anchors = anchorIndexes(way, nodesByWay);
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      const keyA = vertexKeyAt(way.id, a, nodeAt);
      const keyB = vertexKeyAt(way.id, b, nodeAt);
      const mid = way.points[Math.floor((a + b) / 2)];
      const cost = segmentCost(way, a, b) * biasMultiplier(mid, opts.biasPath, weight);
      const va = ensure(keyA, way.points[a]);
      const vb = ensure(keyB, way.points[b]);
      va.edges.push({ to: keyB, costM: cost, span: { wayId: way.id, fromPoint: a, toPoint: b } });
      vb.edges.push({ to: keyA, costM: cost, span: { wayId: way.id, fromPoint: b, toPoint: a } });
    }
  }
  return { vertices, nodeAt };
}

// ---- shortest path ----------------------------------------------------------

/**
 * Shortest route between two anchors over existing infrastructure. Returns
 * null when no connected path exists. Mid-way anchors are handled as virtual
 * vertices spliced into their enclosing segment.
 */
export function routeBetween(system: TransitSystem, from: RouteAnchor, to: RouteAnchor, opts: RouteGraphOptions): RouteResult | null {
  // Both anchors on ONE way: the route is simply the stretch of that way
  // between them — the most common gesture (routing along a single street),
  // and one the vertex graph can't represent when both clicks land inside
  // the same block segment.
  if (from.wayId === to.wayId) {
    const way = system.ways.find((w) => w.id === from.wayId);
    if (!way || !opts.allowedTypeIds.has(way.typeId) || opts.excludeWayIds?.has(way.id) || way.points.length < 2) return null;
    const arcPos = (a: RouteAnchor): number => {
      const seg = Math.max(1, Math.min(a.insertIndex, way.points.length - 1));
      return segmentCost(way, 0, seg - 1) + haversineMeters(way.points[seg - 1], a.coord);
    };
    const posF = arcPos(from);
    const posT = arcPos(to);
    if (Math.abs(posF - posT) < 0.5) return null; // same spot
    const forward = posF < posT;
    const segF = Math.max(1, Math.min(from.insertIndex, way.points.length - 1));
    const segT = Math.max(1, Math.min(to.insertIndex, way.points.length - 1));
    if (segF === segT) {
      return {
        spans: [{ wayId: way.id, fromPoint: segF, toPoint: segF, fromCoord: from.coord, toCoord: to.coord, noInterior: true, seg: segF }],
        lengthM: Math.abs(posF - posT),
      };
    }
    const span: RouteSpan = forward
      ? { wayId: way.id, fromPoint: segF, toPoint: segT - 1, fromCoord: from.coord, toCoord: to.coord }
      : { wayId: way.id, fromPoint: segF - 1, toPoint: segT, fromCoord: from.coord, toCoord: to.coord };
    return { spans: [span], lengthM: Math.abs(posF - posT) };
  }

  const { vertices, nodeAt } = buildGraph(system, opts);
  const waysById = new Map(system.ways.map((w) => [w.id, w]));

  // Splice a virtual vertex for an anchor into its way's enclosing segment.
  const splice = (anchor: RouteAnchor, key: string, isFrom: boolean): boolean => {
    const way = waysById.get(anchor.wayId);
    if (!way || !opts.allowedTypeIds.has(way.typeId) || opts.excludeWayIds?.has(way.id) || way.points.length < 2) return false;
    const nodesByWay = new Map<string, number[]>();
    for (const node of system.nodes) {
      for (const ref of node.refs) {
        if (ref.wayId !== way.id) continue;
        const arr = nodesByWay.get(way.id) ?? [];
        arr.push(ref.pointIndex);
        nodesByWay.set(way.id, arr);
      }
    }
    const anchors = anchorIndexes(way, nodesByWay);
    // The anchor sits between raw points insertIndex-1 and insertIndex; find
    // the enclosing anchor pair [a, b].
    const seg = Math.max(1, Math.min(anchor.insertIndex, way.points.length - 1));
    let a = anchors[0];
    let b = anchors[anchors.length - 1];
    for (let i = 0; i < anchors.length - 1; i++) {
      if (anchors[i] <= seg - 1 && seg <= anchors[i + 1]) {
        a = anchors[i];
        b = anchors[i + 1];
        break;
      }
    }
    const v: Vertex = { key, coord: anchor.coord, edges: [] };
    // Partial cost: the fractional piece from the anchor to the nearer raw
    // point, plus the whole-point stretch onward to the target index.
    const costTo = (idx: number): number => {
      if (idx <= seg - 1) return haversineMeters(way.points[seg - 1], anchor.coord) + segmentCost(way, idx, seg - 1);
      return haversineMeters(anchor.coord, way.points[seg]) + segmentCost(way, seg, idx);
    };
    const keyA = vertexKeyAt(way.id, a, nodeAt);
    const keyB = vertexKeyAt(way.id, b, nodeAt);
    // Leaving the anchor toward a (behind it), the first raw point passed is
    // seg-1; toward b (ahead), it's seg — and mirrored when arriving.
    const spanA: RouteSpan = isFrom
      ? { wayId: way.id, fromPoint: seg - 1, toPoint: a, fromCoord: anchor.coord }
      : { wayId: way.id, fromPoint: a, toPoint: seg - 1, toCoord: anchor.coord };
    const spanB: RouteSpan = isFrom
      ? { wayId: way.id, fromPoint: seg, toPoint: b, fromCoord: anchor.coord }
      : { wayId: way.id, fromPoint: b, toPoint: seg, toCoord: anchor.coord };
    v.edges.push({ to: keyA, costM: costTo(a), span: spanA });
    v.edges.push({ to: keyB, costM: costTo(b), span: spanB });
    vertices.set(key, v);
    // Mirror edges from the segment ends toward the virtual vertex (needed
    // for the destination anchor, which is routed INTO).
    vertices.get(keyA)?.edges.push({ to: key, costM: costTo(a), span: isFrom ? spanA : { ...spanA } });
    vertices.get(keyB)?.edges.push({ to: key, costM: costTo(b), span: isFrom ? spanB : { ...spanB } });
    return true;
  };

  const FROM = "@from";
  const TO = "@to";
  if (!splice(from, FROM, true) || !splice(to, TO, false)) return null;

  // Plain Dijkstra — systems are a few thousand edges at most.
  const dist = new Map<string, number>();
  const prev = new Map<string, { key: string; span: RouteSpan; costM: number }>();
  const visited = new Set<string>();
  dist.set(FROM, 0);
  while (true) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [k, d] of dist) {
      if (!visited.has(k) && d < best) {
        best = d;
        cur = k;
      }
    }
    if (cur === null) return null; // exhausted without reaching TO
    if (cur === TO) break;
    visited.add(cur);
    const v = vertices.get(cur);
    if (!v) continue;
    for (const e of v.edges) {
      const nd = best + e.costM;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { key: cur, span: e.span, costM: e.costM });
      }
    }
  }

  // Walk back, then merge consecutive spans over the same way.
  const raw: RouteSpan[] = [];
  let cursor = TO;
  while (cursor !== FROM) {
    const p = prev.get(cursor);
    if (!p) return null;
    raw.unshift(p.span);
    cursor = p.key;
  }
  const spans: RouteSpan[] = [];
  for (const s of raw) {
    const last = spans[spans.length - 1];
    if (last && last.wayId === s.wayId && last.toPoint === s.fromPoint && !last.toCoord && !s.fromCoord) {
      last.toPoint = s.toPoint;
      last.toCoord = s.toCoord;
    } else {
      spans.push({ ...s });
    }
  }
  // A route that would traverse the same way in two separate spans is beyond
  // what materialization (split-based) can represent safely — reject it.
  const seen = new Set<string>();
  for (const s of spans) {
    if (seen.has(s.wayId)) return null;
    seen.add(s.wayId);
  }
  return { spans, lengthM: dist.get(TO) ?? 0 };
}

/** The route's drawable polyline (raw way points; fractional anchor ends). */
export function routePath(system: TransitSystem, spans: RouteSpan[]): LngLat[] {
  const waysById = new Map(system.ways.map((w) => [w.id, w]));
  const out: LngLat[] = [];
  for (const s of spans) {
    const way = waysById.get(s.wayId);
    if (!way) continue;
    if (s.noInterior) {
      if (s.fromCoord && s.toCoord) out.push(s.fromCoord, s.toCoord);
      continue;
    }
    const pts: LngLat[] = [];
    if (s.fromCoord) pts.push(s.fromCoord);
    const step = s.fromPoint <= s.toPoint ? 1 : -1;
    for (let i = s.fromPoint; step > 0 ? i <= s.toPoint : i >= s.toPoint; i += step) {
      if (way.points[i]) pts.push(way.points[i]);
    }
    if (s.toCoord) pts.push(s.toCoord);
    out.push(...pts);
  }
  return out;
}
