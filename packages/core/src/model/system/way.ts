import type { Grade } from "../catalog";
import type { LaneDirection, LineGeometry, LngLat } from "./valueTypes";

/** One way's control point that coincides with a junction. */
export interface WayPointRef {
  wayId: string;
  pointIndex: number;
}

/** One element of a way's cross-section: a drive lane, a track, a median, a
 *  sidewalk. `kindId` references the lane-kind catalog. The id is stable so
 *  junction lane connectors can reference a specific lane. */
export interface LaneSpec {
  id: string;
  kindId: string;
  widthM: number;
  direction: LaneDirection;
}

/** A way's full cross-section: lanes ordered left-to-right as seen facing
 *  "forward" (the direction of increasing point index) — the osm2streets
 *  convention. Constant along the way; where a street's section changes
 *  (a turn pocket appears, a lane drops), the way is split and the pieces
 *  share identity through a NamedWay. */
export interface CrossSection {
  lanes: LaneSpec[];
}

/**
 * Physical infrastructure: one alignment on the ground (or above/below it).
 * Unified across modes — a rail track, a road, a bike path, an aerial span —
 * distinguished by `typeId` into the way-type catalog. Carries services.
 */
export interface Way {
  id: string;
  /** Way-type catalog id: "rail" | "road" | "bike" | "aerial" | "water" | … */
  typeId: string;
  /** Control vertices that define the alignment. */
  points: LngLat[];
  /** How the path is drawn between control points. */
  geometry: LineGeometry;
  /** Vertical alignment: below ground, at grade, or elevated. */
  grade: Grade;
  /** The cross-section. Capacity (lanes/tracks) is DERIVED from it — see
   *  model/profile.ts laneCapacity(). */
  profile: CrossSection;
  /** Facility class within the type (road arterial, bike protected, …). */
  classId?: string;
  /** Provenance marker — set when imported (e.g. "osm") rather than drawn. */
  source?: string;
}
