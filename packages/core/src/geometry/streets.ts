// Street-geometry engine, stage 1: real per-lane geometry derived from a
// way's cross-section profile. Pure and network-free — the model stays
// topology (centerline + profile); everything drawable here is DERIVED on
// demand and memoized per way object, the same WeakMap pattern as
// geo.ts's resolveWayPath. Later stages (junction footprints, connector
// curves) build on these lane paths.
//
// Conventions (shared with the model): a profile's lanes run left-to-right
// as seen facing "forward" (increasing point index); a positive perpendicular
// offset is RIGHT of travel — so the first lane sits at the most negative
// offset. See model/system.ts CrossSection and geo.ts offsetPolyline.

import { laneKind } from "../model/catalog";
import { offsetPolyline, resolveWayPath } from "../model/geo";
import { profileWidthM } from "../model/profile";
import type { LaneDirection, LngLat, Way } from "../model/system";

/** One lane's drawable geometry: its centerline, offset from the way's. */
export interface LanePath {
  laneId: string;
  kindId: string;
  direction: LaneDirection;
  widthM: number;
  /** Signed perpendicular offset of the lane's center from the way
   *  centerline, meters; negative = left of forward travel. */
  offsetM: number;
  path: LngLat[];
}

/** A painted line between/beside lanes. */
export interface DividerPath {
  /** laneLine = dashed separator between same-direction lanes;
   *  centerLine = opposing-directions separator (the double yellow);
   *  edgeLine = solid edge of the directional roadway. */
  kind: "laneLine" | "centerLine" | "edgeLine";
  path: LngLat[];
}

/** Everything stage 1 derives for one way. */
export interface WayLaneGeometry {
  wayId: string;
  totalWidthM: number;
  lanes: LanePath[];
  dividers: DividerPath[];
  /** Directional lanes' paths oriented ALONG their travel direction —
   *  backward lanes come pre-reversed, so a symbol layer placing arrows
   *  along the line always points them the way traffic moves. Lanes with
   *  direction "both"/"none" aren't included. */
  arrows: LanePath[];
}

/** Crop a polyline by arc length: drop `fromM` meters off the start and
 *  `toM` meters off the end, interpolating the cut points. Returns the
 *  original array when nothing is cropped; an empty array when the crops
 *  consume the whole path. */
export function trimPath(path: LngLat[], fromM: number, toM: number): LngLat[] {
  if ((fromM <= 0 && toM <= 0) || path.length < 2) return path;
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const dLng = (path[i][0] - path[i - 1][0]) * 111320 * Math.cos((path[i][1] * Math.PI) / 180);
    const dLat = (path[i][1] - path[i - 1][1]) * 111320;
    cum.push(cum[i - 1] + Math.hypot(dLng, dLat));
  }
  const total = cum[cum.length - 1];
  const a = Math.max(0, fromM);
  const b = total - Math.max(0, toM);
  if (b - a < 0.05) return [];
  const at = (m: number): LngLat => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < m) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (m - cum[i - 1]) / seg;
    return [
      path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
      path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
    ];
  };
  const out: LngLat[] = [at(a)];
  for (let i = 0; i < path.length; i++) {
    if (cum[i] > a && cum[i] < b) out.push(path[i]);
  }
  out.push(at(b));
  return out;
}

// Cache: per way object, keyed by the trim pair (junction trims change
// independently of the way object when a NEIGHBOR way's profile widens).
const cache = new WeakMap<Way, Map<string, WayLaneGeometry>>();

/** Derive (memoized) the full lane-level geometry for one way, with its
 *  ends optionally trimmed back where they meet junction footprints. */
export function wayLaneGeometry(way: Way, trimStartM = 0, trimEndM = 0): WayLaneGeometry {
  let byTrim = cache.get(way);
  if (!byTrim) {
    byTrim = new Map();
    cache.set(way, byTrim);
  }
  const key = `${trimStartM.toFixed(2)}:${trimEndM.toFixed(2)}`;
  const cached = byTrim.get(key);
  if (cached) return cached;

  const center = trimPath(resolveWayPath(way), trimStartM, trimEndM);
  const lanes: LanePath[] = [];
  const dividers: DividerPath[] = [];
  const arrows: LanePath[] = [];
  const totalWidthM = profileWidthM(way.profile);

  if (center.length >= 2 && way.profile.lanes.length > 0) {
    // Lane centers: cumulative width from the left edge, re-centered on the
    // way centerline.
    let cum = 0;
    for (const lane of way.profile.lanes) {
      const offsetM = cum + lane.widthM / 2 - totalWidthM / 2;
      const path = offsetPolyline(center, offsetM);
      lanes.push({ laneId: lane.id, kindId: lane.kindId, direction: lane.direction, widthM: lane.widthM, offsetM, path });
      cum += lane.widthM;
    }

    // Painted lines at boundaries between adjacent DIRECTIONAL lanes (the
    // markings that make a roadway read as lanes): dashed white between
    // same-direction lanes, the "double yellow" where directions oppose.
    // Solid edge lines bound the directional block on each side.
    const specs = way.profile.lanes;
    for (let i = 1; i < specs.length; i++) {
      const prev = specs[i - 1];
      const cur = specs[i];
      {
        const b = specs.slice(0, i).reduce((s, l) => s + l.widthM, 0) - totalWidthM / 2;
        const prevDir = laneKind(prev.kindId).directional;
        const curDir = laneKind(cur.kindId).directional;
        if (prevDir && curDir) {
          const opposing =
            (prev.direction === "forward" && cur.direction === "backward") ||
            (prev.direction === "backward" && cur.direction === "forward");
          dividers.push({ kind: opposing ? "centerLine" : "laneLine", path: offsetPolyline(center, b) });
        } else if (prevDir !== curDir) {
          dividers.push({ kind: "edgeLine", path: offsetPolyline(center, b) });
        }
      }
    }

    // Direction arrows: one path per one-directional lane, oriented along
    // its travel so line-placed symbols point the right way.
    for (const lane of lanes) {
      if (!laneKind(lane.kindId).directional) continue;
      if (lane.direction === "forward") arrows.push(lane);
      else if (lane.direction === "backward") arrows.push({ ...lane, path: [...lane.path].reverse() });
    }
  }

  const result: WayLaneGeometry = { wayId: way.id, totalWidthM, lanes, dividers, arrows };
  byTrim.set(key, result);
  return result;
}

/** Quick bbox pre-check: does this way plausibly intersect the view? Padded
 *  by its own half-width so a wide road whose centerline sits just offscreen
 *  still renders. Cheap linear filter — fine for hand-drawn systems and a
 *  viewport's worth of OSM import; a grid index can slot in behind this
 *  signature if profiling ever demands it. */
export function wayIntersectsBounds(way: Way, bounds: [LngLat, LngLat], padDeg = 0.002): boolean {
  const [[west, south], [east, north]] = bounds;
  for (const [lng, lat] of way.points) {
    if (lng >= west - padDeg && lng <= east + padDeg && lat >= south - padDeg && lat <= north + padDeg) return true;
  }
  return false;
}
