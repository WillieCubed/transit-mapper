// The transit-system domain model. A document is one *System* — a regional,
// multimodal network. It separates INFRASTRUCTURE from SERVICE:
//  - a Way is the physical carrier (a track, a road, a bike path, a gondola
//    span, a ferry route) — one unified type discriminated by a catalog
//    `typeId`, not a hardcoded union;
//  - a Service is a colored route that people ride, running over one or more
//    ways of any compatible type.
// Many services can share one way, which is why a way renders as parallel
// offset colored lines when it carries several. Kinds (way types, modes,
// grades, facility classes) live in catalog.ts.

import type { Grade } from "./catalog";
import type { ComponentMap } from "./components";

export type LngLat = [number, number];

// How a way's path is drawn between its control points.
export type LineGeometry = "straight" | "curved" | "freeform";

export interface Viewport {
  center: LngLat;
  zoom: number;
}

/** Which physical side of a two-way road forward-direction traffic keeps to
 *  — a regional/jurisdictional property, one value for the whole document
 *  (you don't mix driving sides within one contiguous network), never
 *  per-way. Defaults to "right" (Las Vegas; most of the world) so every
 *  existing document keeps behaving identically unless explicitly changed. */
export type DrivingSide = "left" | "right";

/**
 * Physical infrastructure: one alignment on the ground (or above/below it).
 * Unified across modes — a rail track, a road, a bike path, an aerial span —
 * distinguished by `typeId` into the way-type catalog. Carries services.
 */
/** Travel direction of a lane, relative to its way's point order. "both" is
 *  a bidirectional lane (center turn lane, single-track rail, a path);
 *  "none" is a lane nothing travels along (median, parking). */
export type LaneDirection = "forward" | "backward" | "both" | "none";

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

/** One way's control point that coincides with a junction. */
export interface WayPointRef {
  wayId: string;
  pointIndex: number;
}

/**
 * A junction: a coordinate genuinely shared by two or more ways' control
 * points (not just two paths that happen to cross visually). `refs` are kept
 * in sync with `Way.points` by every store mutation that inserts, deletes, or
 * moves a control point — see editor/store.ts's cascadeMove/shiftNodeRefsFor*.
 */
/** How traffic through a junction is controlled — rendering + (later)
 *  simulation semantics, not topology. */
export type NodeControl = "uncontrolled" | "signal" | "stop" | "roundabout";

/** One edge of a junction's lane-connectivity graph: a specific incoming
 *  lane continues into a specific outgoing lane. Turn arrows painted on
 *  approach lanes are derived from these, never stored separately. */
export interface LaneConnector {
  from: { wayId: string; laneId: string };
  to: { wayId: string; laneId: string };
}

/** A lane-level turn restriction: the specific Ways this lane may feed at
 *  its next junction, keyed by TARGET WAY IDENTITY — never by a geometric
 *  turn classification (left/straight/right). Angle-bucket classification
 *  is ambiguous at any junction with two arms in the same coarse bucket (a
 *  Y-split, a genuine 5-way) and meaningless at a roundabout; target-way
 *  identity has neither problem. An empty list means the lane is fully
 *  blocked from continuing past this point — how modal filters are
 *  expressed (no separate concept needed: restrict a lane kind to
 *  `allowedTargets: []` at an ordinary split point). Absent = unrestricted.
 *  Keyed by `${wayId}:${laneId}` — see components.ts's laneRefKey. */
export interface TurnRestriction {
  allowedTargets: string[];
}

export interface Node {
  id: string;
  coord: LngLat;
  refs: WayPointRef[];
  /** Traffic control at this junction. Undefined = uncontrolled. */
  control?: NodeControl;
  /** Explicit lane-connectivity graph — stored only once the user customizes
   *  turn lanes; otherwise connectors are derived by heuristic on demand. */
  connectors?: LaneConnector[];
}

/** Traffic control for one specific approach to a junction (e.g. a stop
 *  sign on the minor street only, a signal on one leg of an otherwise
 *  uncontrolled crossing) — one granularity finer than Node.control, which
 *  applies to the whole junction. Falls back to the node's whole-node
 *  control when unset. Keyed by `${wayId}:${end}` — see components.ts's
 *  armRefKey. */
export interface ApproachControl {
  control: NodeControl;
}

/**
 * A shared identity spanning several ways that are physically one named
 * facility — two one-way carriageways of Decatur Avenue, the paired tracks
 * of a rail line, a trail crossing many junction-split segments. What the
 * identity is *called* in the UI comes from the way family's catalog noun
 * ("Street" / "Line" / "Trail"), never hardcoded.
 */
export interface NamedWay {
  id: string;
  name: string;
  wayIds: string[];
}

/** The median (or other separator) between two carriageways of one
 *  NamedWay — captured when separateCarriageways splits a two-way profile,
 *  so its width/kind survive a later combine instead of combineProfiles
 *  falling back to a generic default. Keyed by NamedWay id. */
export interface Median {
  widthM: number;
  kindId: string;
}

/** One path a service runs — more than one on the same service models a
 *  branch/variant sharing that service's identity (name/color/mode), e.g. a
 *  trunk splitting into an airport branch and a downtown branch. */
export interface Pattern {
  id: string;
  /** Ordered ways this pattern runs over (its path; may span way types). */
  wayIds: string[];
  /** Optional label for a specific branch/variant, e.g. "via Airport". */
  name?: string;
}

/** Which days a SchedulePeriod runs. Deliberately coarse (not a specific
 *  weekday set or calendar) — this is a fantasy-system planning tool, not a
 *  GTFS calendar_dates.txt editor. */
export type ScheduleDayScope = "daily" | "weekday" | "weekend";

/** One named headway period within a service's full schedule — "Peak",
 *  "Off-Peak", "Weekend", etc. GTFS `frequencies.txt`-shaped (a headway +
 *  a time window), not explicit per-trip stop_times: real enough to plan
 *  around, without exploding into a per-stop timetable editor. */
export interface SchedulePeriod {
  id: string;
  label: string;
  days: ScheduleDayScope;
  /** First and last departure this period covers, 24h "HH:MM". */
  spanStart: string;
  spanEnd: string;
  /** Headway in minutes — how often a vehicle departs during this period. */
  frequencyMinutes: number;
}

/** A colored route that people ride, running over one or more patterns
 *  (paths) — a plain line has exactly one; a branch has two or more. */
export interface Service {
  id: string;
  name: string;
  /** Mode catalog id: "subway" | "bus" | "tram" | "gondola" | … */
  modeId: string;
  /** Hex color, e.g. "#e4572e". */
  color: string;
  patterns: Pattern[];
  /** Peak headway in minutes — how often a vehicle departs at the busiest
   *  time of day. Undefined = not yet specified. This is the quick,
   *  always-present control (Inspector's "Peak headway" field, and what
   *  vehicle animation falls back to); `schedule` below is the optional,
   *  more detailed alternative — when present, it supersedes this pair for
   *  anything schedule-aware, and the Inspector's simple fields become a
   *  read-only summary pointing at "Edit full schedule" instead. */
  frequencyMinutes?: number;
  /** Span of service — first and last departure, 24h "HH:MM". */
  spanStart?: string;
  spanEnd?: string;
  /** Optional detailed schedule — multiple named headway periods (e.g. Peak
   *  vs. Off-Peak vs. Weekend) instead of one flat headway+span. Undefined
   *  or empty = this service just uses frequencyMinutes/spanStart/spanEnd
   *  above. See ScheduleDialog.tsx. */
  schedule?: SchedulePeriod[];
}

// Where a station rides on a way: normalized arc-length position [0,1] along
// that way's resolved path. Recomputing the coord from this anchor is how a
// station follows its way when the alignment is reshaped.
export interface StationAnchor {
  wayId: string;
  t: number;
}

/** A platform's physical geometry inside a station (infrastructure view). */
export interface Platform {
  id: string;
  points: LngLat[];
  /** Number of platform edges that board (1 = side, 2 = island). */
  edges?: number;
}

export interface Station {
  id: string;
  name?: string;
  /** Position as a network node, snapped onto its way's path. */
  coord: LngLat;
  /** The way this station rides, if any (unsnapped stations are free). */
  anchor?: StationAnchor;
  /** Physical boundary polygon, drawn in the infrastructure view. */
  footprint?: LngLat[];
  /** Platform geometry inside the station (infrastructure view). */
  platforms?: Platform[];
  /** How long a vehicle sits here before departing, in seconds — boarding/
   *  alighting time for the ambient vehicle animation (map/vehicles.ts).
   *  Undefined uses that module's own default. */
  dwellSeconds?: number;
}

/** A catalog-typed point/area feature: bike dock, entrance, depot, … */
export interface Facility {
  id: string;
  /** Facility-type catalog id. */
  typeId: string;
  name?: string;
  /** A single point, or a polygon boundary. */
  geometry: LngLat | LngLat[];
}

/** Bundles any objects into one unit: a transfer complex, a line family, a
 *  facility complex (bus bays, platforms, entrances grouped under one real
 *  physical site — see the Facility tool). */
export interface Group {
  id: string;
  name?: string;
  memberIds: string[];
  /** Physical boundary polygon, drawn in the infrastructure view — what
   *  turns a plain logical group into a facility complex with a real site. */
  footprint?: LngLat[];
  /** A facility complex's own color (distinguishes it from other complexes
   *  on the map) — hex, e.g. "#e4572e". Plain (footprint-less) groups don't
   *  need one. */
  color?: string;
}

export interface TransitSystem {
  /** Schema version, for migrations. */
  version: 8;
  id: string;
  name: string;
  description?: string;
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
  ways: Way[];
  services: Service[];
  stations: Station[];
  facilities: Facility[];
  groups: Group[];
  /** Explicit junctions — coordinates genuinely shared by 2+ ways' control
   *  points. See Node. */
  nodes: Node[];
  /** Shared identities across ways ("Decatur Avenue"). See NamedWay. */
  namedWays: NamedWay[];
  /** Common colors for this system — offered in the color popover. */
  palette: string[];
  /** Which side of the road forward traffic keeps to — see DrivingSide. */
  drivingSide: DrivingSide;
  /** Per-lane turn restrictions — see TurnRestriction. */
  turnRestrictions: ComponentMap<TurnRestriction>;
  /** Medians/separators between a NamedWay's carriageways — see Median. */
  medians: ComponentMap<Median>;
  /** Per-approach traffic control overrides — see ApproachControl. */
  approachControls: ComponentMap<ApproachControl>;
}

// A new system frames the whole Las Vegas Valley — Strip, Henderson, North Las
// Vegas, Paradise — not a single downtown. Only a starting bookmark, never a
// constraint on where a system can be drawn.
export const DEFAULT_VIEWPORT: Viewport = {
  center: [-115.176, 36.13],
  zoom: 10.4,
};
