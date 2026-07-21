// Street-geometry engine, stages 2–3: real junction footprints and lane
// connector curves. Follows the A/B Street approach: thicken each arm of a
// junction to its full cross-section width, intersect adjacent arms' edges
// to find how far each carriageway must TRIM BACK from the shared vertex,
// and fill the area between the trim lines as the junction polygon. Lane
// connectors (stored on the Node, or derived by heuristic) then become
// Bézier curves from each incoming lane's trimmed endpoint to its outgoing
// lane's start — the drawable turn guides and, later, routing edges.
//
// Pure and network-free like streets.ts. Junction geometry is cheap (a few
// µs per node) and viewport-scoped by the caller, so it recomputes per
// render rather than caching across frames.

import { laneKind } from "../model/catalog";
import { metersFromOrigin, offsetMeters, resolveWayPath } from "../model/geo";
import { profileWidthM } from "../model/profile";
import type { LaneConnector, LaneSpec, LngLat, Node, Way } from "../model/system";
import { trimPath, wayLaneGeometry, type LanePath } from "./streets";

type Vec = [number, number];

const rot90ccw = (v: Vec): Vec => [-v[1], v[0]];
const rot90cw = (v: Vec): Vec => [v[1], -v[0]];

/** One way-end meeting a junction. `dir` points AWAY from the node along the
 *  way, in local meters. */
export interface JunctionArm {
  wayId: string;
  /** Which end of the way meets the node. */
  end: "start" | "end";
  dir: Vec;
  halfWidthM: number;
  /** How far this way's lane geometry pulls back from the shared vertex. */
  trimM: number;
}

export interface JunctionGeometry {
  nodeId: string;
  coord: LngLat;
  arms: JunctionArm[];
  /** Footprint ring (closed by the renderer); empty for a seamless 2-arm
   *  straight-through joint, which needs no visible junction at all. */
  polygon: LngLat[];
}

/** Trims per way end, aggregated across every junction in view — what
 *  stage 1 (wayLaneGeometry) consumes so carriageways stop at footprints. */
export type WayTrims = Map<string, { start: number; end: number }>;

const MIN_ANGLE_SIN = 0.15; // arms within ~9° of collinear don't trim each other
const TRIM_CAP_FRACTION = 0.45; // a trim never eats more than 45% of its way

/** Derive one junction's arms, trim distances, and footprint polygon.
 *  Returns null when fewer than 2 way-ends actually meet the node (e.g. a
 *  node whose refs are all interior pass-throughs). */
export function junctionGeometry(node: Node, waysById: Map<string, Way>): JunctionGeometry | null {
  const arms: JunctionArm[] = [];
  const seen = new Set<string>();
  for (const ref of node.refs) {
    const way = waysById.get(ref.wayId);
    if (!way || way.points.length < 2) continue;
    const isStart = ref.pointIndex === 0;
    const isEnd = ref.pointIndex === way.points.length - 1;
    if (!isStart && !isEnd) continue; // pass-through: the way just runs across the junction
    const key = `${way.id}:${isStart ? "start" : "end"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const neighbor = way.points[isStart ? 1 : way.points.length - 2];
    const d = metersFromOrigin(node.coord, neighbor);
    const len = Math.hypot(d[0], d[1]);
    if (len < 0.01) continue;
    arms.push({
      wayId: way.id,
      end: isStart ? "start" : "end",
      dir: [d[0] / len, d[1] / len],
      halfWidthM: profileWidthM(way.profile) / 2,
      trimM: 0,
    });
  }
  if (arms.length < 2) return null;

  arms.sort((a, b) => Math.atan2(a.dir[1], a.dir[0]) - Math.atan2(b.dir[1], b.dir[0]));

  // Adjacent arms (CCW order): intersect arm i's CCW-side edge with arm j's
  // CW-side edge; the intersection parameters are how far each carriageway
  // must pull back so their corners meet instead of overlapping.
  for (let i = 0; i < arms.length; i++) {
    const j = (i + 1) % arms.length;
    const a = arms[i];
    const b = arms[j];
    const cross = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
    if (Math.abs(cross) < MIN_ANGLE_SIN) continue; // near-collinear pair
    const ca = rot90ccw(a.dir).map((v) => v * a.halfWidthM) as Vec;
    const cb = rot90cw(b.dir).map((v) => v * b.halfWidthM) as Vec;
    // Solve ca + t·a.dir = cb + s·b.dir.
    const rx = cb[0] - ca[0];
    const ry = cb[1] - ca[1];
    const t = (rx * b.dir[1] - ry * b.dir[0]) / cross;
    const s = (rx * a.dir[1] - ry * a.dir[0]) / cross;
    if (t > 0) a.trimM = Math.max(a.trimM, t);
    if (s > 0) b.trimM = Math.max(b.trimM, s);
  }

  // Cap trims so a short block between two junctions can't invert.
  for (const arm of arms) {
    const way = waysById.get(arm.wayId)!;
    const path = resolveWayPath(way);
    let len = 0;
    for (let i = 1; i < path.length; i++) {
      const d = metersFromOrigin(path[i - 1], path[i]);
      len += Math.hypot(d[0], d[1]);
    }
    arm.trimM = Math.min(arm.trimM, len * TRIM_CAP_FRACTION);
  }

  // A plain 2-arm straight-through joint (a way resumed/merged mid-street)
  // needs no visible junction.
  if (arms.length === 2) {
    const dot = arms[0].dir[0] * arms[1].dir[0] + arms[0].dir[1] * arms[1].dir[1];
    if (dot < -0.98) return { nodeId: node.id, coord: node.coord, arms, polygon: [] };
  }

  // Footprint: each arm contributes its two trimmed edge corners; walking
  // arms in CCW order yields a chamfered polygon (the degenerate corner
  // fillet — real arcs can refine this later without changing the contract).
  const polygon: LngLat[] = [];
  for (const arm of arms) {
    const left = rot90ccw(arm.dir);
    const right = rot90cw(arm.dir);
    const t = Math.max(arm.trimM, 0.5); // give even untrimmed arms a sliver of footprint
    polygon.push(
      offsetMeters(node.coord, right[0] * arm.halfWidthM + arm.dir[0] * t, right[1] * arm.halfWidthM + arm.dir[1] * t),
      offsetMeters(node.coord, left[0] * arm.halfWidthM + arm.dir[0] * t, left[1] * arm.halfWidthM + arm.dir[1] * t),
    );
  }

  return { nodeId: node.id, coord: node.coord, arms, polygon };
}

/** Aggregate junction trims into per-way-end trim distances for stage 1. */
export function collectWayTrims(junctions: JunctionGeometry[]): WayTrims {
  const trims: WayTrims = new Map();
  for (const j of junctions) {
    for (const arm of j.arms) {
      const t = trims.get(arm.wayId) ?? { start: 0, end: 0 };
      if (arm.end === "start") t.start = Math.max(t.start, arm.trimM);
      else t.end = Math.max(t.end, arm.trimM);
      trims.set(arm.wayId, t);
    }
  }
  return trims;
}

// ---- Lane connectors --------------------------------------------------------

/** Signed turn angle (radians, CCW-positive = left) from an incoming arm to
 *  an outgoing arm. Incoming heading is INTO the node (-in.dir). */
function turnAngle(inArm: JunctionArm, outArm: JunctionArm): number {
  const hx = -inArm.dir[0];
  const hy = -inArm.dir[1];
  return Math.atan2(hx * outArm.dir[1] - hy * outArm.dir[0], hx * outArm.dir[0] + hy * outArm.dir[1]);
}

export type TurnClass = "left" | "straight" | "right" | "uturn";

export function classifyTurn(angleRad: number): TurnClass {
  const deg = (angleRad * 180) / Math.PI;
  if (Math.abs(deg) <= 35) return "straight";
  if (Math.abs(deg) >= 150) return "uturn";
  return deg > 0 ? "left" : "right";
}

/** A way-end's directional lanes that travel INTO the node ("end" arm →
 *  forward lanes; "start" arm → backward lanes; "both" counts either way),
 *  ordered left-to-right in TRAVEL frame (start arms reverse the profile). */
export function incomingLanes(way: Way, end: "start" | "end"): LaneSpec[] {
  const lanes = way.profile.lanes.filter((l) => {
    if (!laneKind(l.kindId).directional) return false;
    if (l.direction === "both") return true;
    return end === "end" ? l.direction === "forward" : l.direction === "backward";
  });
  return end === "end" ? lanes : [...lanes].reverse();
}

/** Same, for lanes traveling OUT of the node. */
export function outgoingLanes(way: Way, end: "start" | "end"): LaneSpec[] {
  const lanes = way.profile.lanes.filter((l) => {
    if (!laneKind(l.kindId).directional) return false;
    if (l.direction === "both") return true;
    return end === "end" ? l.direction === "backward" : l.direction === "forward";
  });
  return end === "end" ? [...lanes].reverse() : lanes;
}

/**
 * Default lane connectivity for a junction, derived when the user hasn't
 * customized it: every incoming approach connects straight-through by lane
 * index where a straight arm exists, its leftmost lane additionally turns
 * left, and its rightmost lane turns right. Deliberately simple — the
 * junction editor's explicit connectors override all of this.
 */
export function defaultConnectors(node: Node, waysById: Map<string, Way>): LaneConnector[] {
  const g = junctionGeometry(node, waysById);
  if (!g) return [];
  const out: LaneConnector[] = [];
  for (const inArm of g.arms) {
    const inWay = waysById.get(inArm.wayId)!;
    const inbound = incomingLanes(inWay, inArm.end);
    if (inbound.length === 0) continue;
    for (const outArm of g.arms) {
      if (outArm === inArm) continue;
      const outWay = waysById.get(outArm.wayId)!;
      const outbound = outgoingLanes(outWay, outArm.end);
      if (outbound.length === 0) continue;
      const turn = classifyTurn(turnAngle(inArm, outArm));
      if (turn === "straight") {
        const n = Math.min(inbound.length, outbound.length);
        for (let i = 0; i < n; i++) {
          // Align rightmost-to-rightmost so a wider street's extra lanes drop on the left.
          const src = inbound[inbound.length - n + i];
          const dst = outbound[outbound.length - n + i];
          out.push({ from: { wayId: inWay.id, laneId: src.id }, to: { wayId: outWay.id, laneId: dst.id } });
        }
      } else if (turn === "left") {
        out.push({ from: { wayId: inWay.id, laneId: inbound[0].id }, to: { wayId: outWay.id, laneId: outbound[0].id } });
      } else if (turn === "right") {
        out.push({
          from: { wayId: inWay.id, laneId: inbound[inbound.length - 1].id },
          to: { wayId: outWay.id, laneId: outbound[outbound.length - 1].id },
        });
      }
      // u-turns are never defaulted; the junction editor can add them.
    }
  }
  return out;
}

/** The connectors in effect at a node: stored ones if the user customized
 *  the junction, else the derived defaults. */
export function effectiveConnectors(node: Node, waysById: Map<string, Way>): LaneConnector[] {
  return node.connectors ?? defaultConnectors(node, waysById);
}

// ---- Connector curves -------------------------------------------------------

export interface ConnectorCurve {
  nodeId: string;
  from: { wayId: string; laneId: string };
  to: { wayId: string; laneId: string };
  path: LngLat[];
}

const CURVE_SAMPLES = 10;

/** The node-side endpoint (and inward tangent) of one lane's trimmed path. */
function laneEndAt(lane: LanePath, end: "start" | "end", trimM: number): { p: LngLat; tangent: Vec } | null {
  const path = end === "start" ? trimPath(lane.path, trimM, 0) : trimPath(lane.path, 0, trimM);
  if (path.length < 2) return null;
  const p = end === "start" ? path[0] : path[path.length - 1];
  const q = end === "start" ? path[1] : path[path.length - 2];
  const d = metersFromOrigin(p, q); // points AWAY from the node
  const len = Math.hypot(d[0], d[1]) || 1;
  return { p, tangent: [-d[0] / len, -d[1] / len] }; // toward the node
}

/** Bézier turn guides through a junction, one per effective lane connector. */
export function connectorCurves(node: Node, waysById: Map<string, Way>, trims: WayTrims): ConnectorCurve[] {
  const g = junctionGeometry(node, waysById);
  if (!g) return [];
  const curves: ConnectorCurve[] = [];
  for (const c of effectiveConnectors(node, waysById)) {
    const fromWay = waysById.get(c.from.wayId);
    const toWay = waysById.get(c.to.wayId);
    if (!fromWay || !toWay) continue;
    // A way with both ends on one node (a loop) has two arms — pick the arm
    // where this specific lane actually travels the right direction.
    const fromArm =
      g.arms.find((a) => a.wayId === c.from.wayId && incomingLanes(fromWay, a.end).some((l) => l.id === c.from.laneId)) ??
      g.arms.find((a) => a.wayId === c.from.wayId);
    const toArm =
      g.arms.find((a) => a.wayId === c.to.wayId && outgoingLanes(toWay, a.end).some((l) => l.id === c.to.laneId)) ??
      g.arms.find((a) => a.wayId === c.to.wayId);
    if (!fromArm || !toArm) continue;
    const fromLane = wayLaneGeometry(fromWay).lanes.find((l) => l.laneId === c.from.laneId);
    const toLane = wayLaneGeometry(toWay).lanes.find((l) => l.laneId === c.to.laneId);
    if (!fromLane || !toLane) continue;
    const fromTrims = trims.get(fromWay.id) ?? { start: 0, end: 0 };
    const toTrims = trims.get(toWay.id) ?? { start: 0, end: 0 };
    const a = laneEndAt(fromLane, fromArm.end, fromArm.end === "start" ? fromTrims.start : fromTrims.end);
    const b = laneEndAt(toLane, toArm.end, toArm.end === "start" ? toTrims.start : toTrims.end);
    if (!a || !b) continue;
    const [dx, dy] = metersFromOrigin(a.p, b.p);
    const k = Math.max(Math.hypot(dx, dy) / 3, 1);
    const p1 = offsetMeters(a.p, a.tangent[0] * k, a.tangent[1] * k);
    const p2 = offsetMeters(b.p, b.tangent[0] * k, b.tangent[1] * k);
    const path: LngLat[] = [];
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const t = i / CURVE_SAMPLES;
      const mt = 1 - t;
      path.push([
        mt * mt * mt * a.p[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * b.p[0],
        mt * mt * mt * a.p[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * b.p[1],
      ]);
    }
    curves.push({ nodeId: node.id, from: c.from, to: c.to, path });
  }
  return curves;
}
