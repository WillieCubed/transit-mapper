import { createStore } from "zustand/vanilla";
import { LANE_KINDS, PROFILE_PRESETS, mode, modesForWayType, wayType, type Grade } from "../model/catalog";
import { buildProfile, cloneProfile, combineProfiles, directionalLanes, flipProfile, makeOneWay, profileWidthM, separateProfiles, withLaneCount } from "../model/profile";
import { modeRender } from "../style/catalogStyle";
import { haversineMeters, nearestInsertionPoint, nearestOnPath, offsetPolyline, patternPath, pointAtT, pointInPolygon, resolveWayPath, snap, squareFootprint } from "../model/geo";
import { anchorOnWay, routeBetween, type RouteAnchor, type RouteSpan } from "../model/routeGraph";
import { wayCrossings } from "../model/validate";
import { shortId } from "../model/ids";
import { createEmptySystem } from "../model/serialize";
import type {
  CrossSection,
  Facility,
  Group,
  LaneConnector,
  LineGeometry,
  LngLat,
  NamedWay,
  Node,
  NodeControl,
  Platform,
  SchedulePeriod,
  Service,
  Station,
  StationAnchor,
  TransitSystem,
  Viewport,
  Way,
} from "../model/system";

export type Tool = "select" | "way" | "station" | "facility";

// A freshly-drawn line should already be a "working" one — an ambient
// vehicle animating along it — without a trip to the Inspector first (both
// service-creation sites below use these). Mirrors the Inspector's own
// "10 min" / "6am–11pm" default preset chips, so the value never surprises
// once the panel IS opened.
const DEFAULT_FREQUENCY_MINUTES = 10;
const DEFAULT_SPAN_START = "06:00";
const DEFAULT_SPAN_END = "23:00";

export type Selection =
  | { kind: "way"; id: string }
  | { kind: "service"; id: string }
  | { kind: "station"; id: string }
  | { kind: "facility"; id: string }
  | { kind: "group"; id: string }
  | { kind: "node"; id: string }
  | null;

/** One member of a multi-select group — the "nudge this whole line" /
 *  "delete these five things together" set, kept separate from `Selection`
 *  (which stays one object, driving the Inspector) rather than trying to
 *  make one field do both jobs. */
export type MultiSelectItem = { kind: "way" | "station" | "facility"; id: string };

const FOOTPRINT_HALF_SIZE_M = 30;
// How far a drawn station footprint's center may sit from a way and still
// anchor onto it — generous, since a station box usually straddles its line.
const STATION_DRAW_ANCHOR_M = 60; // a ~60m default station footprint
const PLATFORM_HALF_SIZE_M = 12; // a ~24m default platform, sized to fit inside
const GROUP_FOOTPRINT_HALF_SIZE_M = 20; // a ~40m default facility-complex site

export interface SetSystemOptions {
  readOnly?: boolean;
}

export interface EditorState {
  system: TransitSystem;
  tool: Tool;
  selection: Selection;
  /** Bumped by selectAndFocus (never by plain select) — MapCanvas watches
   *  this, not `selection` itself, to know when to pan/fit the camera onto
   *  the newly selected thing. A direct map click already shows the user
   *  where it is; re-centering there would just be disorienting. Chrome-
   *  driven selection (the Objects list, keyboard nav, Inspector "jump to
   *  member" links, Issues) has no such context, so it asks for a focus. */
  cameraFocusToken: number;
  /** Bumped by addStation only — StationInspector watches this (alongside
   *  focusNameStationId, which the token pairs with) to know when to focus
   *  + select-all the name field: placing a station is the one moment a
   *  person's very next intent is almost always "name it right now," unlike
   *  simply re-selecting an existing one later. StationInspector calls
   *  consumeFocusName right after acting on it — this still needs that
   *  explicit clear (unlike cameraFocusToken, which nothing ever "consumes"
   *  the same way): switching from some OTHER selected object back to this
   *  same station later remounts StationInspector without the token itself
   *  changing, and an un-cleared focusNameStationId would still match. */
  focusNameToken: number;
  focusNameStationId: string | null;
  /** Shift-click builds this up alongside (and clears) `selection` — a set of
   *  ways/stations/facilities to move or delete together. See MultiSelectItem. */
  multiSelection: MultiSelectItem[];
  /** Way currently being drawn, or null. */
  activeWayId: string | null;
  draftWayTypeId: string;
  draftModeId: string;
  draftGeometry: LineGeometry;
  /** Color a newly drawn service takes. */
  draftColor: string;
  /** Grade a newly drawn way takes. */
  draftGrade: Grade;
  /** Facility class a newly drawn way takes, if its type has classes. */
  draftClassId: string | undefined;
  /** Profile preset a newly drawn way starts with ("4-lane arterial", …);
   *  null = the way type's default profile. Reset when the way type changes. */
  draftPresetId: string | null;
  /** Whether drawing a way also creates a service riding it. True is the
   *  Network-view "draw a line" experience; false draws BARE infrastructure —
   *  a plain street/track to run services over later (the Infrastructure
   *  view's Service picker offers "None", and roads default to it there). */
  draftServiceEnabled: boolean;
  /** True when newly drawn ways start ONE-WAY (travel = drawing direction)
   *  instead of the type's default two-way profile — the Direction toggle in
   *  the drawing tools, and what a right-clicked endpoint branch arms. */
  draftOneWay: boolean;
  /** Facility TYPE (catalog entrance/bikeDock/depot/…) the Facility tool places. */
  draftFacilityTypeId: string;
  /** True when the Facility tool is in COMPLEX mode (drawing a site boundary
   *  to build inside) instead of directly placing the selected facility type.
   *  Chosen from the tool's variant flyout, never a hidden default. */
  draftFacilityComplexMode: boolean;
  /** Non-null while armed to drop a new facility straight into this group's
   *  membership (the Inspector's "Place inside" flow) — the Facility tool's
   *  next click places-and-joins instead of starting a fresh complex. */
  placingFacilityForGroupId: string | null;
  /** Non-null while armed to add the next clicked station/facility to this
   *  group's membership (the Inspector's "Add existing" flow). */
  pickingMemberForGroupId: string | null;
  /** Non-null while armed to attach the next drawn way as a new pattern
   *  (branch) on this service (the Inspector's "Add branch" flow). */
  addingPatternForServiceId: string | null;
  /** True when viewing a shared snapshot — editing is disabled until forked. */
  readOnly: boolean;
  /** Whether there's a prior/later system snapshot to restore. Kept in state
   *  (rather than derived on read) purely so components can subscribe to it
   *  to enable/disable Undo/Redo controls. */
  canUndo: boolean;
  canRedo: boolean;

  // system lifecycle
  setSystem: (system: TransitSystem, opts?: SetSystemOptions) => void;
  newSystem: () => void;
  setName: (name: string) => void;
  setViewport: (viewport: Viewport) => void;

  // history — every action that changes `system` is one undo step, EXCEPT
  // calls made between beginHistoryCheckpoint()/commitHistoryCheckpoint(),
  // which coalesce into a single step (a drag gesture firing many moveXPoint
  // calls should undo in one press, not one per pixel of movement).
  undo: () => void;
  redo: () => void;
  /** For pointer-gesture code (see map/interactions.ts): call at gesture
   *  start, then commitHistoryCheckpoint() at gesture end (however it ends —
   *  a normal mouseup or an Escape-cancel). Safe/no-op if system ends up
   *  value-equal to how it started (e.g. a cancel that fully reverted, or a
   *  click that never actually moved anything). */
  beginHistoryCheckpoint: () => void;
  commitHistoryCheckpoint: () => void;

  // tools & selection
  setTool: (tool: Tool) => void;
  select: (selection: Selection) => void;
  /** Same as select(), but also bumps cameraFocusToken so MapCanvas pans/
   *  fits the camera onto it — see cameraFocusToken's own doc comment for
   *  when to reach for this instead of plain select(). */
  selectAndFocus: (selection: Selection) => void;
  /** Adds/removes one item from the multi-select group (Shift-click). */
  toggleMultiSelect: (item: MultiSelectItem) => void;
  /** Adds every given item to the multi-select group, deduplicated against
   *  what's already there (Shift-drag rubber-band select — see
   *  map/interactions.ts's startMarqueeSelect). Unlike toggleMultiSelect,
   *  this never REMOVES anything already selected; a marquee is a bulk-add
   *  gesture, not a bulk-toggle one — re-dragging a box over items you
   *  already had selected shouldn't silently drop them from the group. */
  addMultiSelection: (items: MultiSelectItem[]) => void;
  clearMultiSelection: () => void;
  /** Deletes every object currently in the multi-select group, as one undo step. */
  deleteMultiSelection: () => void;
  /** Translates the whole multi-select group by a fixed lng/lat delta —
   *  used by a group-drag gesture, called once per animation frame. */
  nudgeMultiSelection: (dx: number, dy: number) => void;
  setDraftWayType: (typeId: string) => void;
  setDraftMode: (modeId: string) => void;
  setDraftGeometry: (geometry: LineGeometry) => void;
  setDraftColor: (color: string) => void;
  setDraftGrade: (grade: Grade) => void;
  setDraftClassId: (classId: string | undefined) => void;
  setDraftPreset: (presetId: string | null) => void;
  setDraftServiceEnabled: (enabled: boolean) => void;
  setDraftOneWay: (on: boolean) => void;
  /** Start drawing a NEW one-way way branching off an existing way's open
   *  endpoint — the couplet gesture (right-click an endpoint): inherits the
   *  source way's cross-section (made one-way, travel = away from the
   *  branch point), type, grade, class, and shared street identity, and is
   *  joined to the source at that endpoint as a real junction. Returns the
   *  new way's id (it becomes the active draw). */
  beginOneWayBranch: (fromWayId: string, end: "start" | "end") => string | null;
  setDraftFacilityType: (typeId: string) => void;
  setDraftFacilityComplexMode: (on: boolean) => void;
  addPaletteColor: (color: string) => void;

  // way drawing (infrastructure, any type) — also creates a default service
  // when the way's type carries a mode-based service (rail/road/aerial/water).
  beginWay: (typeId?: string, geometry?: LineGeometry, color?: string) => string;
  // Resume drawing an existing, already-finished way (pressing near one of its
  // open endpoints) instead of starting an unrelated new one.
  resumeWay: (id: string) => void;
  addWayPoint: (wayId: string, coord: LngLat) => void;
  insertWayPoint: (wayId: string, index: number, coord: LngLat) => void;
  moveWayPoint: (wayId: string, index: number, coord: LngLat) => void;
  deleteWayPoint: (wayId: string, index: number) => void;
  /** Forms a real junction between (wayId, index) — already set to `coord` —
   *  and `targetWayId`: splices a genuine control point into the target way
   *  (or reuses one already there) and links both as one Node. */
  joinWayPointToWay: (wayId: string, index: number, targetWayId: string, coord: LngLat) => void;
  finishWay: () => void;
  setWayGeometry: (id: string, geometry: LineGeometry) => void;
  setWayGrade: (id: string, grade: Grade) => void;
  setWayClassId: (id: string, classId: string | undefined) => void;
  /** Physical capacity in the way type's unit (tracks/lanes/…) — drives the
   *  real cross-section fanned out in the Infrastructure view. */
  setWayCapacity: (id: string, capacity: number) => void;
  deleteWay: (id: string) => void;
  /** Splits a way in two at control point `index`, each half keeping the
   *  original's type/grade/class/capacity — see splitWay's doc comment. */
  splitWayAt: (wayId: string, index: number) => void;
  /** Append externally-produced ways (P4: OSM import) as bare infrastructure —
   *  no service is auto-created, since imported streets/rail are real physical
   *  context to draw services over, not a route in themselves. */
  importWays: (ways: Way[]) => void;

  // cross-sections (lane-level editing — see model/profile.ts)
  /** Replace a way's whole cross-section (the lane editor's setter). */
  setWayProfile: (id: string, profile: CrossSection) => void;
  /** Apply a catalog profile preset ("4-lane arterial", …) — also takes the
   *  preset's facility class when it declares one. */
  applyProfilePreset: (id: string, presetId: string) => void;

  // shared identity (NamedWay — "Decatur Avenue" across many way records)
  /** Name a way: joins an existing identity with that exact name, renames
   *  the identity the way already belongs to, or creates a new one. An empty
   *  name removes the way from its identity. */
  nameWay: (wayId: string, name: string) => void;
  renameNamedWay: (id: string, name: string) => void;

  // junction semantics (Node)
  setNodeControl: (nodeId: string, control: NodeControl | undefined) => void;
  /** Store an explicit lane-connectivity graph for a junction; undefined
   *  reverts it to heuristic-derived connectors. */
  setNodeConnectors: (nodeId: string, connectors: LaneConnector[] | undefined) => void;

  // road-network topology
  /** Form real junctions wherever this way crosses same-grade ways
   *  mid-segment — see formCrossingJunctions' doc comment. */
  formCrossingJunctions: (wayId: string) => void;
  /** End-to-end inverse of splitWayAt — see mergeWays' doc comment. */
  mergeWays: (keepWayId: string, otherWayId: string) => void;
  /** Split a two-way way into two one-way carriageway ways around a median
   *  gap, both under one shared identity. Returns the new (opposite-
   *  direction) way's id, or null when the way is one-way already. */
  separateCarriageways: (wayId: string) => string | null;
  /** Merge a shared identity's two one-way carriageways back into one
   *  two-way way (the forward carriageway's alignment wins). */
  combineCarriageways: (namedWayId: string) => void;

  // routing over existing infrastructure (Network view's snap-to-streets
  // line drawing, and re-binding a sketched service onto real ways)
  /** Live route-drawing state: mode being drawn, the last committed anchor,
   *  and the spans accumulated so far. Null when not route-drawing. */
  routeDraft: { modeId: string; lastAnchor: RouteAnchor; spans: RouteSpan[] } | null;
  startRouteDraft: (anchor: RouteAnchor) => void;
  /** Route from the last anchor to `anchor` along existing compatible ways
   *  and append it. Returns false (no state change) when no path exists or
   *  the extension would traverse a way twice. */
  extendRouteDraft: (anchor: RouteAnchor) => boolean;
  /** Materialize the drafted route into a new service riding those ways. */
  commitRouteDraft: () => string | null;
  cancelRouteDraft: () => void;
  /** Create a service over an explicit routed span list (commitRouteDraft's
   *  backend; exposed for tests). */
  createRoutedService: (spans: RouteSpan[], modeId?: string) => string | null;
  /** Re-bind every pattern of a sketched service onto EXISTING infrastructure:
   *  routes between the pattern's endpoints along compatible ways (biased to
   *  follow the sketch corridor), swaps the pattern onto them, re-anchors
   *  stations, and deletes the now-orphaned sketch ways. Returns how many
   *  patterns were rebound. */
  adoptExistingInfrastructure: (serviceId: string) => number;

  // services (colored routes over ways). Returns null when the way's type has
  // no compatible service modes (e.g. bike infrastructure carries no service).
  addServiceToWay: (wayId: string) => string | null;
  setServiceName: (id: string, name: string) => void;
  setServiceColor: (id: string, color: string) => void;
  setServiceMode: (id: string, modeId: string) => void;
  /** Peak headway in minutes — undefined clears it (not yet specified). */
  setServiceFrequency: (id: string, minutes: number | undefined) => void;
  /** Span of service — first/last departure, 24h "HH:MM"; undefined clears. */
  setServiceSpan: (id: string, start: string | undefined, end: string | undefined) => void;
  /** Replaces the full detailed schedule (see SchedulePeriod) in one shot —
   *  ScheduleDialog owns the add/edit/remove-row logic locally and commits
   *  the whole array here rather than the store exposing one action per
   *  row-level edit. undefined/[] reverts the service to its plain
   *  frequencyMinutes/spanStart/spanEnd pair. */
  setServiceSchedule: (id: string, periods: SchedulePeriod[] | undefined) => void;
  deleteService: (id: string) => void;
  /** Arm the Way tool so the next line drawn attaches as a new PATTERN
   *  (branch) on this service instead of spawning its own service. */
  startAddingPattern: (serviceId: string) => void;
  cancelAddingPattern: () => void;
  /** No-op if it's the service's only pattern — use deleteService instead. */
  deletePattern: (serviceId: string, patternId: string) => void;
  /** Turnkey "combine two lines into one branched corridor": every pattern
   *  from `sourceId` joins `targetId`'s own patterns (named after the source
   *  service if it doesn't already have its own pattern names, so the
   *  branch list stays legible), then the now-empty source service is
   *  deleted. No-op across different modes — a bus line and a rail line
   *  can't become branches of the same physical corridor. */
  mergeServiceInto: (sourceId: string, targetId: string) => void;

  // stations (ride on ways)
  addStation: (coord: LngLat, anchor?: StationAnchor) => string;
  /** The Station tool's DRAW gesture: a dragged-out footprint becomes a real
   *  station — coord at the footprint's center, anchored onto the nearest
   *  way it straddles (if any), footprint attached and ready for platforms.
   *  Click-to-place quick stops still go through addStation. */
  addDrawnStation: (footprint: LngLat[]) => string;
  /** Clears focusNameStationId once StationInspector has actually focused
   *  the name field for it — a no-op if it's already been consumed (or was
   *  never for this id), so it's safe to call unconditionally on mount. */
  consumeFocusName: (id: string) => void;
  moveStation: (id: string, coord: LngLat, anchor?: StationAnchor) => void;
  setStationName: (id: string, name: string) => void;
  /** How long a vehicle dwells here before departing, in seconds — undefined
   *  reverts to the animation's own default (see map/vehicles.ts). */
  setStationDwellSeconds: (id: string, seconds: number | undefined) => void;
  deleteStation: (id: string) => void;

  // station footprints & platforms (infrastructure-view physical planning) —
  // drawing starts from a default square the user drags into shape via the
  // same reshape-handle interaction as everything else.
  addStationFootprint: (stationId: string) => void;
  moveFootprintPoint: (stationId: string, index: number, coord: LngLat) => void;
  deleteStationFootprint: (stationId: string) => void;
  addPlatform: (stationId: string) => string;
  movePlatformPoint: (stationId: string, platformId: string, index: number, coord: LngLat) => void;
  deletePlatform: (stationId: string, platformId: string) => void;

  // facilities (catalog-typed point features: entrances, bike docks, depots, …)
  addFacility: (typeId: string, geometry: LngLat | LngLat[]) => string;
  moveFacility: (id: string, geometry: LngLat) => void;
  setFacilityName: (id: string, name: string) => void;
  deleteFacility: (id: string) => void;

  // groups (bundle any objects into one unit: a transfer complex, a line family, …)
  createGroup: (memberIds: string[], name?: string) => string;
  addGroupMember: (groupId: string, memberId: string) => void;
  removeGroupMember: (groupId: string, memberId: string) => void;
  renameGroup: (id: string, name: string) => void;
  setGroupColor: (id: string, color: string) => void;
  deleteGroup: (id: string) => void;

  // facility complexes — a Group with a physical footprint, built up by
  // placing new facilities inside it or grouping existing map objects
  // (see Toolbar's Facility tool + Inspector's GroupInspector).
  /** The Facility tool's drawn boundary (drag = rectangle, click-points =
   *  polygon — see map/interactions.ts) becomes a new complex's footprint,
   *  selected and ready for "Place inside". Assigns a color not already used
   *  by another complex, so complexes stay visually distinct on the map. */
  createFacilityComplex: (footprint: LngLat[]) => string;
  addGroupFootprint: (groupId: string) => void;
  moveGroupFootprintPoint: (groupId: string, index: number, coord: LngLat) => void;
  deleteGroupFootprint: (groupId: string) => void;
  /** Arm the Facility tool to place-and-join instead of starting a new complex. */
  startPlacingFacility: (groupId: string) => void;
  cancelPlacingFacility: () => void;
  placeFacilityInGroup: (groupId: string, typeId: string, coord: LngLat) => string;
  /** Arm Select to add the next clicked station/facility to this group. */
  startPickingMember: (groupId: string) => void;
  cancelPickingMember: () => void;
}

export type EditorStore = ReturnType<typeof createEditorStore>;

function centroidOf(ring: LngLat[]): LngLat {
  const cx = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
  const cy = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  return [cx, cy];
}

function touch(system: TransitSystem): TransitSystem {
  return { ...system, updatedAt: Date.now() };
}

// Recompute the coords of every station riding `wayId`, so they follow the
// way when its control points move.
function reanchorStations(system: TransitSystem, wayId: string): Station[] {
  const way = system.ways.find((w) => w.id === wayId);
  if (!way) return system.stations;
  const path = resolveWayPath(way);
  if (path.length < 2) return system.stations;
  return system.stations.map((s) => (s.anchor?.wayId === wayId ? { ...s, coord: pointAtT(path, s.anchor.t) } : s));
}

function updateWayPoints(system: TransitSystem, wayId: string, fn: (points: LngLat[]) => LngLat[]): TransitSystem {
  const ways = system.ways.map((w) => (w.id === wayId ? { ...w, points: fn(w.points) } : w));
  const withWays = { ...system, ways };
  return { ...withWays, stations: reanchorStations(withWays, wayId), updatedAt: Date.now() };
}

// Drop a way from every shared identity, and drop identities left empty.
function pruneNamedWays(namedWays: NamedWay[], wayId: string): NamedWay[] {
  return namedWays.map((n) => ({ ...n, wayIds: n.wayIds.filter((id) => id !== wayId) })).filter((n) => n.wayIds.length > 0);
}

// Drop lane connectors that reference a way (it's gone, or its lanes are).
function pruneConnectorsForWay(nodes: Node[], wayId: string): Node[] {
  return nodes.map((n) => {
    if (!n.connectors) return n;
    const connectors = n.connectors.filter((c) => c.from.wayId !== wayId && c.to.wayId !== wayId);
    return connectors.length === n.connectors.length ? n : { ...n, connectors: connectors.length > 0 ? connectors : undefined };
  });
}

// Remove a way, detach it from every service's patterns (dropping now-empty
// patterns, then now-patternless services), and delete the stations that rode it.
function removeWay(system: TransitSystem, wayId: string): TransitSystem {
  const services = system.services
    .map((s) => ({
      ...s,
      patterns: s.patterns.map((p) => ({ ...p, wayIds: p.wayIds.filter((id) => id !== wayId) })).filter((p) => p.wayIds.length > 0),
    }))
    .filter((s) => s.patterns.length > 0);
  return {
    ...system,
    ways: system.ways.filter((w) => w.id !== wayId),
    services,
    stations: system.stations.filter((s) => s.anchor?.wayId !== wayId),
    nodes: pruneConnectorsForWay(removeNodeRefsForWay(system.nodes, wayId), wayId),
    namedWays: pruneNamedWays(system.namedWays, wayId),
  };
}

// ---- junctions (Node) -----------------------------------------------------
// A Node records a control point genuinely shared by 2+ ways (see
// model/system.ts). Every mutation that inserts, deletes, or moves a way's
// control points must keep `refs` in sync, or a junction silently desyncs —
// the exact bug this primitive fixes (see the plan doc).

function shiftNodeRefsForInsert(nodes: Node[], wayId: string, atIndex: number): Node[] {
  return nodes.map((n) => ({
    ...n,
    refs: n.refs.map((r) => (r.wayId === wayId && r.pointIndex >= atIndex ? { ...r, pointIndex: r.pointIndex + 1 } : r)),
  }));
}

function shiftNodeRefsForDelete(nodes: Node[], wayId: string, index: number): Node[] {
  return nodes
    .map((n) => ({
      ...n,
      refs: n.refs
        .filter((r) => !(r.wayId === wayId && r.pointIndex === index))
        .map((r) => (r.wayId === wayId && r.pointIndex > index ? { ...r, pointIndex: r.pointIndex - 1 } : r)),
    }))
    .filter((n) => n.refs.length >= 2); // fewer than 2 refs isn't a junction anymore
}

function removeNodeRefsForWay(nodes: Node[], wayId: string): Node[] {
  return nodes.map((n) => ({ ...n, refs: n.refs.filter((r) => r.wayId !== wayId) })).filter((n) => n.refs.length >= 2);
}

// Moving a point that belongs to a Node must move EVERY way's coincident
// point, not just the one dragged — otherwise the junction desyncs.
function cascadeMove(system: TransitSystem, wayId: string, index: number, coord: LngLat): TransitSystem {
  const node = system.nodes.find((n) => n.refs.some((r) => r.wayId === wayId && r.pointIndex === index));
  if (!node) return updateWayPoints(system, wayId, (pts) => pts.map((p, i) => (i === index ? coord : p)));

  let ways = system.ways;
  for (const ref of node.refs) {
    ways = ways.map((w) => (w.id === ref.wayId ? { ...w, points: w.points.map((p, i) => (i === ref.pointIndex ? coord : p)) } : w));
  }
  const nodes = system.nodes.map((n) => (n.id === node.id ? { ...n, coord } : n));
  let next: TransitSystem = { ...system, ways, nodes };
  for (const ref of node.refs) next = { ...next, stations: reanchorStations(next, ref.wayId) };
  return { ...next, updatedAt: Date.now() };
}

// Existing control point on the target way this close to a snap coordinate is
// reused instead of inserting a near-duplicate point beside it.
const JOIN_REUSE_TOLERANCE_M = 0.75;

/**
 * Form a real junction: splice an actual control point into `targetWayId`'s
 * raw points (or reuse one already there) at `coord`, then link it and
 * (`wayId`, `index`) — which the caller must already have set to `coord` —
 * as refs of a shared Node. This is what makes two ways drawn to "meet" share
 * a literal coordinate on both sides, not just a coincidental-looking curve.
 */
function joinWayPointToWay(system: TransitSystem, wayId: string, index: number, targetWayId: string, coord: LngLat): TransitSystem {
  if (wayId === targetWayId) return system;
  const targetWay = system.ways.find((w) => w.id === targetWayId);
  if (!targetWay) return system;

  let targetIndex = targetWay.points.findIndex((p) => haversineMeters(p, coord) <= JOIN_REUSE_TOLERANCE_M);
  let ways = system.ways;
  let nodes = system.nodes;
  let exactCoord = coord;

  if (targetIndex === -1) {
    const insertion = nearestInsertionPoint(targetWay.points, coord);
    if (!insertion) return system; // target way has fewer than 2 points — nothing to join onto
    targetIndex = insertion.index;
    exactCoord = insertion.coord;
    ways = ways.map((w) =>
      w.id === targetWayId ? { ...w, points: [...w.points.slice(0, targetIndex), exactCoord, ...w.points.slice(targetIndex)] } : w,
    );
    nodes = shiftNodeRefsForInsert(nodes, targetWayId, targetIndex);
  } else {
    exactCoord = targetWay.points[targetIndex];
  }

  // Keep our own way's point exactly coincident even if the caller's snapped
  // coordinate (computed off the curve-resolved path) drifted slightly from
  // the target way's actual raw control point.
  ways = ways.map((w) => (w.id === wayId ? { ...w, points: w.points.map((p, i) => (i === index ? exactCoord : p)) } : w));

  const existingNode = nodes.find((n) => n.refs.some((r) => r.wayId === targetWayId && r.pointIndex === targetIndex));
  if (existingNode) {
    const alreadyLinked = existingNode.refs.some((r) => r.wayId === wayId && r.pointIndex === index);
    nodes = nodes.map((n) => (n.id === existingNode.id && !alreadyLinked ? { ...n, refs: [...n.refs, { wayId, pointIndex: index }] } : n));
  } else {
    nodes = [
      ...nodes,
      {
        id: shortId(),
        coord: exactCoord,
        refs: [
          { wayId: targetWayId, pointIndex: targetIndex },
          { wayId, pointIndex: index },
        ],
      },
    ];
  }

  let next: TransitSystem = { ...system, ways, nodes };
  next = { ...next, stations: reanchorStations(next, targetWayId) };
  next = { ...next, stations: reanchorStations(next, wayId) };
  return { ...next, updatedAt: Date.now() };
}

/**
 * Split a way into two at control point `index`: grade/class/capacity have
 * no way to change partway through an alignment otherwise (see the plan
 * doc). `wayId` keeps its id and becomes the first half (points[0..index]);
 * a new way becomes the second half (points[index..end]). Every riding
 * service now runs over both, in order — a fully drawn-through line still
 * looks and rides the same, just as two ways instead of one. The split point
 * becomes a real junction (a shared Node) even if it wasn't one already, and
 * every station that rode the original way is re-snapped onto whichever new
 * half its (unmoved) coordinate now actually sits on.
 */
function splitWay(system: TransitSystem, wayId: string, index: number, newWayId = shortId()): TransitSystem {
  const way = system.ways.find((w) => w.id === wayId);
  if (!way || index <= 0 || index >= way.points.length - 1) return system; // each half needs ≥2 points
  const wayA: Way = { ...way, points: way.points.slice(0, index + 1) };
  const wayB: Way = { ...way, id: newWayId, points: way.points.slice(index) };
  const ways = [...system.ways.map((w) => (w.id === wayId ? wayA : w)), wayB];

  // Refs before the split stay on A; the split point itself gets linked to
  // BOTH A (unchanged) and B (index 0); refs after it move to B, reindexed.
  let nodes = system.nodes.map((n) => ({
    ...n,
    refs: n.refs.flatMap((r) => {
      if (r.wayId !== wayId) return [r];
      if (r.pointIndex < index) return [r];
      if (r.pointIndex === index) return [r, { wayId: newWayId, pointIndex: 0 }];
      return [{ wayId: newWayId, pointIndex: r.pointIndex - index }];
    }),
  }));
  const splitAlreadyLinked = nodes.some(
    (n) => n.refs.some((r) => r.wayId === wayId && r.pointIndex === index) && n.refs.some((r) => r.wayId === newWayId && r.pointIndex === 0),
  );
  if (!splitAlreadyLinked) {
    nodes = [
      ...nodes,
      { id: shortId(), coord: way.points[index], refs: [{ wayId, pointIndex: index }, { wayId: newWayId, pointIndex: 0 }] },
    ];
  }

  const services = system.services.map((sv) => ({
    ...sv,
    patterns: sv.patterns.map((p) =>
      p.wayIds.includes(wayId) ? { ...p, wayIds: p.wayIds.flatMap((wid) => (wid === wayId ? [wayId, newWayId] : [wid])) } : p,
    ),
  }));

  const pathA = resolveWayPath(wayA);
  const pathB = resolveWayPath(wayB);
  const stations = system.stations.map((st) => {
    if (st.anchor?.wayId !== wayId) return st;
    const onA = nearestOnPath(pathA, st.coord);
    const onB = nearestOnPath(pathB, st.coord);
    if (!onA && !onB) return st;
    const useB = !!onB && (!onA || onB.distMeters < onA.distMeters);
    const best = (useB ? onB : onA)!;
    return { ...st, anchor: { wayId: useB ? newWayId : wayId, t: best.t } };
  });

  // Both halves keep the original's lane ids (the profile is shared), so a
  // junction connector that referenced the original way stays valid — it just
  // has to point at whichever half actually reaches that junction now.
  nodes = nodes.map((n) => {
    if (!n.connectors) return n;
    const stillHasA = n.refs.some((r) => r.wayId === wayId);
    if (stillHasA) return n;
    return {
      ...n,
      connectors: n.connectors.map((c) => ({
        from: c.from.wayId === wayId ? { ...c.from, wayId: newWayId } : c.from,
        to: c.to.wayId === wayId ? { ...c.to, wayId: newWayId } : c.to,
      })),
    };
  });

  // The second half inherits the first's shared identity — a street split by
  // an intersection is still the same street.
  const namedWays = system.namedWays.map((nw) => (nw.wayIds.includes(wayId) ? { ...nw, wayIds: [...nw.wayIds, newWayId] } : nw));

  return { ...system, ways, nodes, services, stations, namedWays, updatedAt: Date.now() };
}

/**
 * The inverse of splitWay: joins `otherId` onto `keepId` end-to-end into one
 * way (they must share an endpoint within tolerance and be the same type).
 * The merged way keeps `keepId`'s identity, orientation, and cross-section;
 * `otherId`'s point order is reversed when it ran the opposite direction.
 * Node refs are re-indexed onto the merged way (the seam node dissolves
 * unless a third way still meets there), services replace the pair with the
 * one way, and stations re-anchor by coordinate.
 */
function mergeWays(system: TransitSystem, keepId: string, otherId: string): TransitSystem {
  const a = system.ways.find((w) => w.id === keepId);
  const b = system.ways.find((w) => w.id === otherId);
  if (!a || !b || a.id === b.id || a.typeId !== b.typeId) return system;
  if (a.points.length < 2 || b.points.length < 2) return system;

  const aStart = a.points[0];
  const aEnd = a.points[a.points.length - 1];
  const bStart = b.points[0];
  const bEnd = b.points[b.points.length - 1];
  const aLen = a.points.length;
  const bLen = b.points.length;

  // The four ways two open polylines can meet end-to-end. Pick the closest.
  const combos = [
    { dist: haversineMeters(aEnd, bStart), key: "ab" },
    { dist: haversineMeters(aEnd, bEnd), key: "abR" },
    { dist: haversineMeters(aStart, bEnd), key: "ba" },
    { dist: haversineMeters(aStart, bStart), key: "bRa" },
  ].sort((x, y) => x.dist - y.dist);
  if (combos[0].dist > JOIN_REUSE_TOLERANCE_M) return system;

  const reversedB = [...b.points].reverse();
  let mergedPoints: LngLat[];
  let mapA: (i: number) => number;
  let mapB: (k: number) => number;
  switch (combos[0].key) {
    case "ab":
      mergedPoints = [...a.points, ...b.points.slice(1)];
      mapA = (i) => i;
      mapB = (k) => aLen - 1 + k;
      break;
    case "abR":
      mergedPoints = [...a.points, ...reversedB.slice(1)];
      mapA = (i) => i;
      mapB = (k) => aLen - 1 + (bLen - 1 - k);
      break;
    case "ba":
      mergedPoints = [...b.points, ...a.points.slice(1)];
      mapB = (k) => k;
      mapA = (i) => bLen - 1 + i;
      break;
    default: // "bRa"
      mergedPoints = [...reversedB, ...a.points.slice(1)];
      mapB = (k) => bLen - 1 - k;
      mapA = (i) => bLen - 1 + i;
      break;
  }

  const mergedWay: Way = { ...a, points: mergedPoints };
  const ways = system.ways.filter((w) => w.id !== otherId).map((w) => (w.id === keepId ? mergedWay : w));

  // Re-index every node ref onto the merged way, dedupe refs that now name
  // the same point (the seam), and drop nodes no longer joining 2+ refs.
  let nodes = system.nodes
    .map((n) => {
      const refs = n.refs.map((r) =>
        r.wayId === keepId
          ? { wayId: keepId, pointIndex: mapA(r.pointIndex) }
          : r.wayId === otherId
            ? { wayId: keepId, pointIndex: mapB(r.pointIndex) }
            : r,
      );
      const seen = new Set<string>();
      const deduped = refs.filter((r) => {
        const key = `${r.wayId}:${r.pointIndex}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { ...n, refs: deduped };
    })
    .filter((n) => n.refs.length >= 2);
  // The other way's lanes are gone (the merged way keeps `keepId`'s
  // cross-section), so connectors referencing them can't survive.
  nodes = pruneConnectorsForWay(nodes, otherId);

  // Services: the pair becomes the one merged way; collapse the adjacency.
  const services = system.services.map((sv) => ({
    ...sv,
    patterns: sv.patterns.map((p) => {
      const wayIds = p.wayIds
        .map((id) => (id === otherId ? keepId : id))
        .filter((id, i, arr) => i === 0 || !(id === keepId && arr[i - 1] === keepId));
      return { ...p, wayIds };
    }),
  }));

  const mergedPath = resolveWayPath(mergedWay);
  const stations = system.stations.map((st) => {
    if (st.anchor?.wayId !== keepId && st.anchor?.wayId !== otherId) return st;
    const on = nearestOnPath(mergedPath, st.coord);
    return on ? { ...st, anchor: { wayId: keepId, t: on.t } } : st;
  });

  const namedWays = pruneNamedWays(system.namedWays, otherId);

  return { ...system, ways, nodes, services, stations, namedWays, updatedAt: Date.now() };
}

/**
 * The SimCity moment: wherever `wayId` crosses another way of the SAME grade
 * mid-segment, form a real 4-arm junction — a shared vertex spliced into
 * both ways, linked as one Node, then both ways split there so every arm is
 * its own way (which is what per-arm lane connectors and per-arm profile
 * edits need). Different grades never join: an elevated freeway over a
 * surface street is an overpass, not an intersection. Newly created arms are
 * re-scanned, so a way crossing three streets forms all three junctions.
 */
function formCrossingJunctions(system: TransitSystem, wayId: string): TransitSystem {
  let next = system;
  const queue: string[] = [wayId];
  let guard = 0; // hard stop far above any real drawing's crossing count
  while (queue.length > 0 && guard++ < 400) {
    const aId = queue.shift()!;
    const a = next.ways.find((w) => w.id === aId);
    if (!a || a.points.length < 2) continue;

    let formed = false;
    for (const b of next.ways) {
      if (b.id === aId || b.grade !== a.grade || b.points.length < 2) continue;
      const crossings = wayCrossings(a, b);
      if (crossings.length === 0) continue;
      const { coord, aIndex } = crossings[0];

      // A real shared vertex on both ways, linked as one Node…
      const inserted = updateWayPoints(next, aId, (pts) => [...pts.slice(0, aIndex), coord, ...pts.slice(aIndex)]);
      next = { ...inserted, nodes: shiftNodeRefsForInsert(inserted.nodes, aId, aIndex) };
      next = joinWayPointToWay(next, aId, aIndex, b.id, coord);

      // …then split both ways there so each junction arm is its own way.
      const exact = next.ways.find((w) => w.id === aId)!.points[aIndex];
      const bWay = next.ways.find((w) => w.id === b.id)!;
      const bIndex = bWay.points.findIndex((p) => haversineMeters(p, exact) <= JOIN_REUSE_TOLERANCE_M);
      const aNewId = shortId();
      next = splitWay(next, aId, aIndex, aNewId);
      if (bIndex > 0 && bIndex < bWay.points.length - 1) next = splitWay(next, b.id, bIndex);

      queue.push(aId, aNewId);
      formed = true;
      break;
    }
    if (!formed) continue;
  }
  return next;
}

// ---- routing over existing infrastructure ----------------------------------
// The pure router (model/routeGraph.ts) returns RouteSpans — stretches of
// existing ways, possibly with fractional mid-way endpoints. Materializing a
// route turns those into a clean ordered wayId list a Pattern can ride:
// fractional endpoints become real control points, and partially-traversed
// ways are split so each span is exactly one whole way. All topology
// bookkeeping rides the same helpers as every other mutation.

function insertPointIntoWay(system: TransitSystem, wayId: string, index: number, coord: LngLat): TransitSystem {
  const next = updateWayPoints(system, wayId, (pts) => [...pts.slice(0, index), coord, ...pts.slice(index)]);
  return { ...next, nodes: shiftNodeRefsForInsert(next.nodes, wayId, index) };
}

// A fractional anchor closer than this to an existing control point reuses
// that point instead of inserting a near-duplicate beside it.
const ANCHOR_REUSE_M = 1;

function materializeRouteSpans(system: TransitSystem, spansIn: RouteSpan[]): { system: TransitSystem; wayIds: string[] } | null {
  let sys = system;
  const wayIds: string[] = [];
  for (const spanIn of spansIn) {
    const s = { ...spanIn };
    const way0 = sys.ways.find((w) => w.id === s.wayId);
    if (!way0) return null;

    // Purely-fractional span (both anchors inside one block segment): insert
    // both coords, ordered along the segment, then split around them.
    if (s.noInterior && s.fromCoord && s.toCoord && s.seg !== undefined) {
      const seg = s.seg;
      const base = way0.points[seg - 1];
      if (!base) return null;
      const [near, far] =
        haversineMeters(base, s.fromCoord) <= haversineMeters(base, s.toCoord) ? [s.fromCoord, s.toCoord] : [s.toCoord, s.fromCoord];
      sys = insertPointIntoWay(sys, s.wayId, seg, far);
      sys = insertPointIntoWay(sys, s.wayId, seg, near);
      s.fromPoint = seg;
      s.toPoint = seg + 1;
      s.fromCoord = undefined;
      s.toCoord = undefined;
      s.noInterior = undefined;
    }
    const forward = s.fromPoint <= s.toPoint;

    // Splice fractional anchors in as real control points (higher insertion
    // index first, so the second insert's shift is easy to account for).
    const inserts: { at: number; coord: LngLat; role: "from" | "to" }[] = [];
    if (s.fromCoord) inserts.push({ at: forward ? s.fromPoint : s.fromPoint + 1, coord: s.fromCoord, role: "from" });
    if (s.toCoord) inserts.push({ at: forward ? s.toPoint + 1 : s.toPoint, coord: s.toCoord, role: "to" });
    inserts.sort((x, y) => y.at - x.at);
    for (const ins of inserts) {
      const way = sys.ways.find((w) => w.id === s.wayId)!;
      const prev = way.points[ins.at - 1];
      const next = way.points[ins.at];
      if (prev && haversineMeters(prev, ins.coord) < ANCHOR_REUSE_M) {
        if (ins.role === "from") s.fromPoint = ins.at - 1;
        else s.toPoint = ins.at - 1;
        continue;
      }
      if (next && haversineMeters(next, ins.coord) < ANCHOR_REUSE_M) {
        if (ins.role === "from") s.fromPoint = ins.at;
        else s.toPoint = ins.at;
        continue;
      }
      sys = insertPointIntoWay(sys, s.wayId, ins.at, ins.coord);
      if (s.fromPoint >= ins.at) s.fromPoint += 1;
      if (s.toPoint >= ins.at) s.toPoint += 1;
      if (ins.role === "from") s.fromPoint = ins.at;
      else s.toPoint = ins.at;
    }

    // Isolate the traversed stretch as its own way via splits.
    const lo = Math.min(s.fromPoint, s.toPoint);
    const hi = Math.max(s.fromPoint, s.toPoint);
    if (lo === hi) return null; // degenerate (both anchors in one block segment)
    const way1 = sys.ways.find((w) => w.id === s.wayId)!;
    let spanWayId = s.wayId;
    if (hi < way1.points.length - 1) sys = splitWay(sys, s.wayId, hi); // [0..hi] keeps the id
    if (lo > 0) {
      const newId = shortId();
      sys = splitWay(sys, s.wayId, lo, newId); // [lo..hi] becomes newId
      spanWayId = newId;
    }
    wayIds.push(spanWayId);
  }
  return { system: sys, wayIds };
}

/**
 * Translates a whole multi-select group by a fixed lng/lat delta — "nudge
 * this whole line" without redrawing it point by point. A selected way's
 * points all shift together (and any station anchored to it follows for
 * free via updateWayPoints' own reanchorStations call); a selected station
 * or facility shifts directly UNLESS its anchor way is also in this same
 * group (already covered by the way's own shift, so shifting it again would
 * double the movement).
 */
function nudgeSelection(system: TransitSystem, items: MultiSelectItem[], dx: number, dy: number): TransitSystem {
  const wayIds = new Set(items.filter((i) => i.kind === "way").map((i) => i.id));
  let next = system;
  for (const id of wayIds) {
    next = updateWayPoints(next, id, (pts) => pts.map((p): LngLat => [p[0] + dx, p[1] + dy]));
  }

  const stationIds = new Set(items.filter((i) => i.kind === "station").map((i) => i.id));
  if (stationIds.size > 0) {
    next = {
      ...next,
      stations: next.stations.map((st) => {
        if (!stationIds.has(st.id) || (st.anchor && wayIds.has(st.anchor.wayId))) return st;
        return { ...st, coord: [st.coord[0] + dx, st.coord[1] + dy] };
      }),
    };
  }

  const facilityIds = new Set(items.filter((i) => i.kind === "facility").map((i) => i.id));
  if (facilityIds.size > 0) {
    next = {
      ...next,
      facilities: next.facilities.map((f) => {
        if (!facilityIds.has(f.id)) return f;
        const geometry: LngLat | LngLat[] = Array.isArray(f.geometry[0])
          ? (f.geometry as LngLat[]).map((p): LngLat => [p[0] + dx, p[1] + dy])
          : ([(f.geometry as LngLat)[0] + dx, (f.geometry as LngLat)[1] + dy] as LngLat);
        return { ...f, geometry };
      }),
    };
  }

  return { ...next, updatedAt: Date.now() };
}

// Adopt-existing-infrastructure tuning: how far a sketch endpoint may sit
// from real infrastructure and still bind to it; how strongly the route is
// pulled toward the sketched corridor; how far a station may hop onto the
// adopted ways.
const ADOPT_SNAP_M = 500;
const ADOPT_BIAS_WEIGHT = 2;
const ADOPT_STATION_REANCHOR_M = 300;

const HISTORY_LIMIT = 100;

export function createEditorStore() {
  let nextLineNumber = 1;

  // Undo history. Kept out of reactive state (only canUndo/canRedo booleans
  // are) since these can hold many TransitSystem references — structural
  // sharing from the existing immutable-update pattern keeps that cheap, but
  // there's no reason to run it through Zustand's equality/subscriber machinery.
  let past: TransitSystem[] = [];
  let future: TransitSystem[] = [];
  // True while a `system` change shouldn't be recorded as an undo step:
  // setSystem/newSystem/undo/redo applying their own swap, and setViewport
  // (camera pan/zoom is persisted on the system for sharing, but it's not
  // content — it shouldn't be undo-able, or every pan would bury real edits
  // under viewport noise in the history stack).
  let skipHistory = false;
  // Non-null while a pointer gesture is in progress (see beginHistoryCheckpoint):
  // the system snapshot from right before it started, pushed as ONE history
  // entry when the gesture ends, instead of once per intermediate set() call.
  let checkpointBefore: TransitSystem | null = null;

  function resetHistory() {
    past = [];
    future = [];
  }

  const editor = createStore<EditorState>()((set, get) => ({
    system: createEmptySystem(),
    tool: "select",
    selection: null,
    cameraFocusToken: 0,
    focusNameToken: 0,
    focusNameStationId: null,
    multiSelection: [],
    activeWayId: null,
    draftWayTypeId: "lightRail",
    draftModeId: "lightRail",
    draftGeometry: "curved",
    draftColor: modeRender("lightRail").color,
    draftGrade: "atGrade",
    draftClassId: wayType("lightRail").defaultClassId,
    draftPresetId: null,
    draftServiceEnabled: true,
    routeDraft: null,
    draftOneWay: false,
    draftFacilityTypeId: "entrance",
    draftFacilityComplexMode: false,
    placingFacilityForGroupId: null,
    pickingMemberForGroupId: null,
    addingPatternForServiceId: null,
    readOnly: false,
    canUndo: false,
    canRedo: false,

    setSystem: (system, opts) => {
      skipHistory = true;
      set({ system, readOnly: opts?.readOnly === true, selection: null, multiSelection: [], activeWayId: null, tool: "select" });
      skipHistory = false;
      resetHistory();
      set({ canUndo: false, canRedo: false });
    },

    undo: () => {
      if (past.length === 0) return;
      const prev = past.pop()!;
      future.push(get().system);
      skipHistory = true;
      set({ system: prev, selection: null, multiSelection: [], activeWayId: null, canUndo: past.length > 0, canRedo: true });
      skipHistory = false;
    },

    redo: () => {
      if (future.length === 0) return;
      const next = future.pop()!;
      past.push(get().system);
      skipHistory = true;
      set({ system: next, selection: null, multiSelection: [], activeWayId: null, canUndo: true, canRedo: future.length > 0 });
      skipHistory = false;
    },

    beginHistoryCheckpoint: () => {
      if (checkpointBefore !== null) return; // defensive: already mid-checkpoint
      checkpointBefore = get().system;
    },

    commitHistoryCheckpoint: () => {
      const before = checkpointBefore;
      checkpointBefore = null;
      if (before === null) return;
      const after = get().system;
      if (after === before) return; // e.g. a click that never moved anything
      // A cancelled gesture (Escape) reverts by calling the same actions
      // again with the original values — same content, new object identity —
      // so a reference check alone can't tell "reverted" from "changed".
      // updatedAt is excluded: every mutating action bumps it via touch(),
      // so it always differs even when nothing else does.
      if (JSON.stringify({ ...before, updatedAt: 0 }) === JSON.stringify({ ...after, updatedAt: 0 })) return;
      past.push(before);
      if (past.length > HISTORY_LIMIT) past.shift();
      future = [];
      set({ canUndo: true, canRedo: false });
    },

    newSystem: () => {
      skipHistory = true;
      set({ system: createEmptySystem(), readOnly: false, selection: null, multiSelection: [], activeWayId: null, tool: "way" });
      skipHistory = false;
      resetHistory();
      set({ canUndo: false, canRedo: false });
    },

    setName: (name) => set((s) => ({ system: touch({ ...s.system, name }) })),
    // Camera position, not content — see the skipHistory comment above.
    setViewport: (viewport) => {
      skipHistory = true;
      set((s) => ({ system: { ...s.system, viewport } }));
      skipHistory = false;
    },

    setTool: (tool) => {
      get().finishWay();
      set({ tool });
    },

    select: (selection) => set({ selection, multiSelection: [] }),

    selectAndFocus: (selection) => set((s) => ({ selection, multiSelection: [], cameraFocusToken: s.cameraFocusToken + 1 })),

    toggleMultiSelect: (item) =>
      set((s) => {
        const exists = s.multiSelection.some((i) => i.kind === item.kind && i.id === item.id);
        const multiSelection = exists
          ? s.multiSelection.filter((i) => !(i.kind === item.kind && i.id === item.id))
          : [...s.multiSelection, item];
        return { multiSelection, selection: null };
      }),

    addMultiSelection: (items) =>
      set((s) => {
        const has = (item: MultiSelectItem) => s.multiSelection.some((i) => i.kind === item.kind && i.id === item.id);
        const additions = items.filter((item) => !has(item));
        return additions.length === 0 ? {} : { multiSelection: [...s.multiSelection, ...additions], selection: null };
      }),
    clearMultiSelection: () => set({ multiSelection: [] }),
    deleteMultiSelection: () =>
      set((s) => {
        let system = s.system;
        for (const item of s.multiSelection) {
          if (item.kind === "way") system = removeWay(system, item.id);
          else if (item.kind === "station") system = { ...system, stations: system.stations.filter((st) => st.id !== item.id) };
          else system = { ...system, facilities: system.facilities.filter((f) => f.id !== item.id) };
        }
        return { system: touch(system), multiSelection: [] };
      }),
    nudgeMultiSelection: (dx, dy) => set((s) => ({ system: nudgeSelection(s.system, s.multiSelection, dx, dy) })),

    setDraftWayType: (typeId) =>
      set((s) => {
        const compatible = modesForWayType(typeId);
        const modeId = compatible.some((m) => m.id === s.draftModeId) ? s.draftModeId : (compatible[0]?.id ?? s.draftModeId);
        return {
          draftWayTypeId: typeId,
          draftModeId: modeId,
          draftColor: modeRender(modeId).color,
          draftClassId: wayType(typeId).defaultClassId,
          draftPresetId: null,
        };
      }),
    // Symmetric to setDraftWayType: picking a mode (the "Line type" picker in
    // Network view — see Toolbar.tsx) picks a compatible way type too,
    // keeping the current one if it's still valid (e.g. switching between
    // lightRail and tram while staying on a road alignment) and otherwise
    // falling back to the mode's own preferred/default carrier. Without this
    // a mode-first pick would leave a stale, possibly-incompatible way type
    // behind for beginWay to silently resolve some other way.
    setDraftMode: (modeId) =>
      set((s) => {
        const m = mode(modeId);
        const wayTypeId = m.wayTypeIds.includes(s.draftWayTypeId) ? s.draftWayTypeId : (m.wayTypeIds[0] ?? s.draftWayTypeId);
        return {
          draftModeId: modeId,
          draftWayTypeId: wayTypeId,
          draftColor: modeRender(modeId).color,
          draftClassId: wayType(wayTypeId).defaultClassId,
          // Explicitly picking a mode means "draw a line" — always re-enables
          // service creation, whatever the bare-infrastructure toggle said.
          draftServiceEnabled: true,
        };
      }),
    setDraftGeometry: (geometry) => set({ draftGeometry: geometry }),
    setDraftColor: (color) => set({ draftColor: color }),
    setDraftGrade: (grade) => set({ draftGrade: grade }),
    setDraftClassId: (classId) => set({ draftClassId: classId }),
    // A preset also carries a facility class; picking it keeps them in sync.
    setDraftPreset: (presetId) => {
      const preset = presetId ? PROFILE_PRESETS[presetId] : undefined;
      set((s) => ({
        draftPresetId: preset ? presetId : null,
        draftClassId: preset?.classId ?? s.draftClassId,
      }));
    },
    setDraftServiceEnabled: (enabled) => set({ draftServiceEnabled: enabled }),
    setDraftOneWay: (on) => set({ draftOneWay: on }),
    setDraftFacilityType: (typeId) => set({ draftFacilityTypeId: typeId, draftFacilityComplexMode: false }),
    setDraftFacilityComplexMode: (on) => set({ draftFacilityComplexMode: on }),

    addPaletteColor: (color) =>
      set((s) => (s.system.palette.includes(color) ? s : { system: touch({ ...s.system, palette: [...s.system.palette, color] }) })),

    beginWay: (typeId, geometry, color) => {
      const st = get();
      const resolvedTypeId = typeId ?? st.draftWayTypeId;
      const resolvedGeometry = geometry ?? st.draftGeometry;
      const wayId = shortId();
      // The draft class only applies as-is when it belongs to the resolved type
      // (the normal case: the Way tool keeps them in sync via setDraftWayType).
      // A caller passing an explicit typeId that diverges from the current draft
      // falls back to that type's own default class, never a stale one.
      const classId = resolvedTypeId === st.draftWayTypeId ? st.draftClassId : wayType(resolvedTypeId).defaultClassId;
      // The armed draft preset ("4-lane arterial", …) shapes the new way's
      // cross-section when it belongs to the resolved type; otherwise the
      // type's own default profile applies.
      const preset = st.draftPresetId ? PROFILE_PRESETS[st.draftPresetId] : undefined;
      const presetApplies = preset && preset.wayTypeId === resolvedTypeId;
      // The armed Direction toggle: one-way ways travel the direction
      // they're drawn in (flip later with D).
      const baseProfile = buildProfile(presetApplies ? preset.lanes : wayType(resolvedTypeId).defaultProfile);
      const way: Way = {
        id: wayId,
        typeId: resolvedTypeId,
        points: [],
        geometry: resolvedGeometry,
        grade: st.draftGrade,
        profile: st.draftOneWay ? makeOneWay(baseProfile, "forward") : baseProfile,
        classId: presetApplies && preset.classId ? preset.classId : classId,
      };
      const modeId = modesForWayType(resolvedTypeId).some((m) => m.id === st.draftModeId) ? st.draftModeId : modesForWayType(resolvedTypeId)[0]?.id;
      // While "add branch" is armed, this way becomes a new PATTERN on the
      // target service once drawing finishes (see finishWay) instead of
      // spawning its own separate service.
      const addingBranch = !!st.addingPatternForServiceId;
      const service: Service | null =
        modeId && !addingBranch && st.draftServiceEnabled
          ? {
              id: shortId(),
              name: `Line ${nextLineNumber++}`,
              modeId,
              color: color ?? st.draftColor,
              patterns: [{ id: shortId(), wayIds: [wayId] }],
              frequencyMinutes: DEFAULT_FREQUENCY_MINUTES,
              spanStart: DEFAULT_SPAN_START,
              spanEnd: DEFAULT_SPAN_END,
            }
          : null;
      set((s) => ({
        system: touch({
          ...s.system,
          ways: [...s.system.ways, way],
          services: service ? [...s.system.services, service] : s.system.services,
        }),
        activeWayId: wayId,
        selection: service ? { kind: "service", id: service.id } : addingBranch ? s.selection : { kind: "way", id: wayId },
      }));
      return wayId;
    },

    resumeWay: (id) => set({ activeWayId: id }),

    beginOneWayBranch: (fromWayId, end) => {
      const st = get();
      const src = st.system.ways.find((w) => w.id === fromWayId);
      if (!src || src.points.length < 2) return null;
      const branchPoint = end === "start" ? src.points[0] : src.points[src.points.length - 1];
      const wayId = shortId();
      const way: Way = {
        id: wayId,
        typeId: src.typeId,
        points: [branchPoint],
        geometry: st.draftGeometry,
        grade: src.grade,
        // Continue the street's own cross-section, made one-way with travel
        // AWAY from the branch point (the direction it's about to be drawn).
        profile: makeOneWay(cloneProfile(src.profile), "forward"),
        classId: src.classId,
      };
      set((s) => {
        let system: TransitSystem = { ...s.system, ways: [...s.system.ways, way] };
        // A real junction at the branch point.
        system = joinWayPointToWay(system, wayId, 0, fromWayId, branchPoint);
        // The branch continues the same street identity, if there is one.
        const identity = system.namedWays.find((n) => n.wayIds.includes(fromWayId));
        if (identity) {
          system = { ...system, namedWays: system.namedWays.map((n) => (n.id === identity.id ? { ...n, wayIds: [...n.wayIds, wayId] } : n)) };
        }
        return {
          system: touch(system),
          activeWayId: wayId,
          selection: { kind: "way", id: wayId },
          draftOneWay: true, // the Direction toggle arms so follow-up segments match
        };
      });
      return wayId;
    },

    addWayPoint: (wayId, coord) => set((s) => ({ system: updateWayPoints(s.system, wayId, (pts) => [...pts, coord]) })),

    insertWayPoint: (wayId, index, coord) =>
      set((s) => ({
        system: {
          ...updateWayPoints(s.system, wayId, (pts) => [...pts.slice(0, index), coord, ...pts.slice(index)]),
          nodes: shiftNodeRefsForInsert(s.system.nodes, wayId, index),
        },
      })),

    moveWayPoint: (wayId, index, coord) => set((s) => ({ system: cascadeMove(s.system, wayId, index, coord) })),

    deleteWayPoint: (wayId, index) =>
      set((s) => ({
        system: {
          ...updateWayPoints(s.system, wayId, (pts) => pts.filter((_, i) => i !== index)),
          nodes: shiftNodeRefsForDelete(s.system.nodes, wayId, index),
        },
      })),

    joinWayPointToWay: (wayId, index, targetWayId, coord) =>
      set((s) => ({ system: joinWayPointToWay(s.system, wayId, index, targetWayId, coord) })),

    finishWay: () => {
      const { activeWayId, addingPatternForServiceId } = get();
      if (!activeWayId) return;
      const finishedWayId = activeWayId;
      set((s) => {
        const way = s.system.ways.find((w) => w.id === activeWayId);
        if (way && way.points.length < 2) {
          // The stub way (and its default service, if any) is discarded.
          return { activeWayId: null, addingPatternForServiceId: null, system: touch(removeWay(s.system, activeWayId)), selection: null };
        }
        if (addingPatternForServiceId) {
          const services = s.system.services.map((sv) =>
            sv.id === addingPatternForServiceId ? { ...sv, patterns: [...sv.patterns, { id: shortId(), wayIds: [activeWayId] }] } : sv,
          );
          return {
            activeWayId: null,
            addingPatternForServiceId: null,
            system: touch({ ...s.system, services }),
            selection: { kind: "service", id: addingPatternForServiceId },
          };
        }
        return { activeWayId: null };
      });
      // The SimCity moment, wired to every commit path (double-click, Enter,
      // tool switch): a newly finished way crossing same-grade ways forms
      // real junctions there. The stub-discard path above removed the way,
      // so the existence check makes this a no-op for it.
      if (get().system.ways.some((w) => w.id === finishedWayId)) {
        get().formCrossingJunctions(finishedWayId);
      }
    },

    setWayGeometry: (id, geometry) =>
      set((s) => {
        const withGeom = { ...s.system, ways: s.system.ways.map((w) => (w.id === id ? { ...w, geometry } : w)) };
        return { system: { ...withGeom, stations: reanchorStations(withGeom, id), updatedAt: Date.now() } };
      }),

    setWayGrade: (id, grade) =>
      set((s) => ({ system: touch({ ...s.system, ways: s.system.ways.map((w) => (w.id === id ? { ...w, grade } : w)) }) })),

    setWayClassId: (id, classId) =>
      set((s) => ({ system: touch({ ...s.system, ways: s.system.ways.map((w) => (w.id === id ? { ...w, classId } : w)) }) })),

    // Capacity is derived from the cross-section, so stepping it adds or
    // removes primary travel lanes (drive/track) via profile.ts.
    setWayCapacity: (id, capacity) =>
      set((s) => ({
        system: touch({
          ...s.system,
          ways: s.system.ways.map((w) => (w.id === id ? { ...w, profile: withLaneCount(w.profile, w.typeId, capacity) } : w)),
        }),
      })),

    deleteWay: (id) =>
      set((s) => ({
        system: touch(removeWay(s.system, id)),
        selection: s.selection?.kind === "way" && s.selection.id === id ? null : s.selection,
        activeWayId: s.activeWayId === id ? null : s.activeWayId,
      })),

    splitWayAt: (wayId, index) => set((s) => ({ system: splitWay(s.system, wayId, index) })),

    importWays: (ways) =>
      set((s) => ({ system: touch({ ...s.system, ways: [...s.system.ways, ...ways] }) })),

    setWayProfile: (id, profile) =>
      set((s) => {
        // Lanes that vanished from the profile take their junction connectors
        // with them.
        const way = s.system.ways.find((w) => w.id === id);
        if (!way) return s;
        const laneIds = new Set(profile.lanes.map((l) => l.id));
        const nodes = s.system.nodes.map((n) => {
          if (!n.connectors) return n;
          const connectors = n.connectors.filter(
            (c) => (c.from.wayId !== id || laneIds.has(c.from.laneId)) && (c.to.wayId !== id || laneIds.has(c.to.laneId)),
          );
          return connectors.length === n.connectors.length ? n : { ...n, connectors: connectors.length > 0 ? connectors : undefined };
        });
        return { system: touch({ ...s.system, ways: s.system.ways.map((w) => (w.id === id ? { ...w, profile } : w)), nodes }) };
      }),

    applyProfilePreset: (id, presetId) => {
      const preset = PROFILE_PRESETS[presetId];
      if (!preset) return;
      const profile = buildProfile(preset.lanes);
      const st = get();
      const way = st.system.ways.find((w) => w.id === id);
      if (!way) return;
      st.setWayProfile(id, profile);
      if (preset.classId) st.setWayClassId(id, preset.classId);
    },

    nameWay: (wayId, name) =>
      set((s) => {
        const trimmed = name.trim();
        const current = s.system.namedWays.find((n) => n.wayIds.includes(wayId));
        if (!trimmed) {
          if (!current) return s;
          return { system: touch({ ...s.system, namedWays: pruneNamedWays(s.system.namedWays, wayId) }) };
        }
        let namedWays: NamedWay[];
        if (current) {
          // Renaming through any member renames the shared identity — that's
          // the point of it being shared.
          namedWays = s.system.namedWays.map((n) => (n.id === current.id ? { ...n, name: trimmed } : n));
        } else {
          const existing = s.system.namedWays.find((n) => n.name === trimmed);
          namedWays = existing
            ? s.system.namedWays.map((n) => (n.id === existing.id ? { ...n, wayIds: [...n.wayIds, wayId] } : n))
            : [...s.system.namedWays, { id: shortId(), name: trimmed, wayIds: [wayId] }];
        }
        return { system: touch({ ...s.system, namedWays }) };
      }),

    renameNamedWay: (id, name) =>
      set((s) => ({
        system: touch({ ...s.system, namedWays: s.system.namedWays.map((n) => (n.id === id ? { ...n, name: name.trim() } : n)) }),
      })),

    setNodeControl: (nodeId, control) =>
      set((s) => ({
        system: touch({ ...s.system, nodes: s.system.nodes.map((n) => (n.id === nodeId ? { ...n, control } : n)) }),
      })),

    setNodeConnectors: (nodeId, connectors) =>
      set((s) => ({
        system: touch({ ...s.system, nodes: s.system.nodes.map((n) => (n.id === nodeId ? { ...n, connectors } : n)) }),
      })),

    formCrossingJunctions: (wayId) => set((s) => ({ system: formCrossingJunctions(s.system, wayId) })),

    mergeWays: (keepWayId, otherWayId) =>
      set((s) => ({
        system: mergeWays(s.system, keepWayId, otherWayId),
        selection: s.selection?.kind === "way" && s.selection.id === otherWayId ? { kind: "way", id: keepWayId } : s.selection,
      })),

    separateCarriageways: (wayId) => {
      const st = get();
      const way = st.system.ways.find((w) => w.id === wayId);
      if (!way || way.points.length < 2) return null;
      const sep = separateProfiles(way.profile);
      if (!sep) return null;

      // Gap between the carriageways: the profile's own median if it had one,
      // else the catalog default — measured center-to-center below.
      const medianWidth = way.profile.lanes.filter((l) => l.kindId === "median").reduce((m, l) => Math.max(m, l.widthM), 0);
      const gap = Math.max(medianWidth, LANE_KINDS.median.defaultWidthM);
      const d = profileWidthM(sep.forward) / 2 + gap + profileWidthM(sep.backward) / 2;

      // The original way keeps its alignment (and every junction on it) and
      // becomes the forward carriageway; the backward carriageway is a new
      // way offset to the LEFT of travel. Both live under one identity.
      const newId = shortId();
      const newWay: Way = { ...way, id: newId, points: offsetPolyline(way.points, -d), profile: sep.backward };
      set((s) => {
        const ways = [...s.system.ways.map((w) => (w.id === wayId ? { ...w, profile: sep.forward } : w)), newWay];
        const current = s.system.namedWays.find((n) => n.wayIds.includes(wayId));
        const namedWays = current
          ? s.system.namedWays.map((n) => (n.id === current.id ? { ...n, wayIds: [...n.wayIds, newId] } : n))
          : [...s.system.namedWays, { id: shortId(), name: "", wayIds: [wayId, newId] }];
        return { system: touch({ ...s.system, ways, namedWays }) };
      });
      return newId;
    },

    combineCarriageways: (namedWayId) =>
      set((s) => {
        const nw = s.system.namedWays.find((n) => n.id === namedWayId);
        if (!nw || nw.wayIds.length !== 2) return s;
        const x = s.system.ways.find((w) => w.id === nw.wayIds[0]);
        const y = s.system.ways.find((w) => w.id === nw.wayIds[1]);
        if (!x || !y || x.typeId !== y.typeId || x.points.length < 2 || y.points.length < 2) return s;

        // The forward carriageway's alignment survives as the combined
        // centerline (symmetric with separateCarriageways, which kept the
        // original alignment for the forward half).
        const runsForward = (w: Way) => directionalLanes(w.profile).every((l) => l.direction === "forward");
        const keeper = runsForward(x) ? x : runsForward(y) ? y : x;
        const other = keeper === x ? y : x;

        // The other carriageway's profile expressed in the keeper's frame:
        // flip it when it geometrically runs the opposite direction (two
        // independently drawn one-ways); keep it as-is when it came from
        // separateCarriageways (same point orientation, backward lanes).
        const sameDir =
          haversineMeters(keeper.points[0], other.points[0]) +
            haversineMeters(keeper.points[keeper.points.length - 1], other.points[other.points.length - 1]) <=
          haversineMeters(keeper.points[0], other.points[other.points.length - 1]) +
            haversineMeters(keeper.points[keeper.points.length - 1], other.points[0]);
        const backHalf = sameDir ? other.profile : flipProfile(other.profile);
        const combined = combineProfiles(backHalf, keeper.profile);

        let system = removeWay(s.system, other.id);
        system = { ...system, ways: system.ways.map((w) => (w.id === keeper.id ? { ...w, profile: combined } : w)) };
        return {
          system: touch(system),
          selection: { kind: "way", id: keeper.id },
        };
      }),

    startRouteDraft: (anchor) => {
      const st = get();
      set({ routeDraft: { modeId: st.draftModeId, lastAnchor: anchor, spans: [] } });
    },

    extendRouteDraft: (anchor) => {
      const st = get();
      const rd = st.routeDraft;
      if (!rd) return false;
      const allowed = new Set(mode(rd.modeId).wayTypeIds);
      const res = routeBetween(st.system, rd.lastAnchor, anchor, { allowedTypeIds: allowed });
      if (!res || res.spans.length === 0) return false;

      // Consecutive legs share their boundary anchor; when the new leg
      // continues straight through the same way, merge the seam into one
      // span. Doubling back over a way already in the route is beyond what
      // split-based materialization can represent — refuse the extension.
      const spans = rd.spans.map((s) => ({ ...s }));
      let rest = res.spans;
      const last = spans[spans.length - 1];
      const first = res.spans[0];
      if (last && first.wayId === last.wayId) {
        if (last.noInterior || first.noInterior) return false; // seam direction is undefined for fractional spans
        const dirPrev = Math.sign(last.toPoint - last.fromPoint);
        const dirNext = Math.sign(first.toPoint - first.fromPoint);
        if (last.toCoord && first.fromCoord && dirPrev === dirNext) {
          last.toPoint = first.toPoint;
          last.toCoord = first.toCoord;
          rest = res.spans.slice(1);
        } else {
          return false;
        }
      }
      const seen = new Set(spans.map((s) => s.wayId));
      for (const s of rest) {
        if (seen.has(s.wayId)) return false;
        seen.add(s.wayId);
      }
      set({ routeDraft: { ...rd, lastAnchor: anchor, spans: [...spans, ...rest.map((s) => ({ ...s }))] } });
      return true;
    },

    commitRouteDraft: () => {
      const rd = get().routeDraft;
      if (!rd) return null;
      if (rd.spans.length === 0) {
        set({ routeDraft: null });
        return null;
      }
      const id = get().createRoutedService(rd.spans, rd.modeId);
      set({ routeDraft: null });
      return id;
    },

    cancelRouteDraft: () => set({ routeDraft: null }),

    createRoutedService: (spans, modeId) => {
      const st = get();
      const resolvedModeId = modeId ?? st.draftModeId;
      const mat = materializeRouteSpans(st.system, spans);
      if (!mat || mat.wayIds.length === 0) return null;
      const id = shortId();
      const service: Service = {
        id,
        name: `Line ${nextLineNumber++}`,
        modeId: resolvedModeId,
        color: st.draftColor,
        patterns: [{ id: shortId(), wayIds: mat.wayIds }],
        frequencyMinutes: DEFAULT_FREQUENCY_MINUTES,
        spanStart: DEFAULT_SPAN_START,
        spanEnd: DEFAULT_SPAN_END,
      };
      set(() => ({
        system: touch({ ...mat.system, services: [...mat.system.services, service] }),
        selection: { kind: "service", id },
      }));
      return id;
    },

    adoptExistingInfrastructure: (serviceId) => {
      const st = get();
      const service = st.system.services.find((sv) => sv.id === serviceId);
      if (!service) return 0;
      const allowed = new Set(mode(service.modeId).wayTypeIds);
      let sys = st.system;
      let rebound = 0;

      for (const pattern of service.patterns) {
        const oldWayIds = [...new Set(pattern.wayIds)];
        const sketchPath = patternPath(sys.ways, pattern);
        if (sketchPath.length < 2) continue;
        const exclude = new Set(oldWayIds);
        const candidates = sys.ways.filter((w) => allowed.has(w.typeId) && !exclude.has(w.id));
        const sA = snap(candidates, sketchPath[0], ADOPT_SNAP_M);
        const sB = snap(candidates, sketchPath[sketchPath.length - 1], ADOPT_SNAP_M);
        if (!sA || !sB) continue;
        const wayA = sys.ways.find((w) => w.id === sA.wayId);
        const wayB = sys.ways.find((w) => w.id === sB.wayId);
        if (!wayA || !wayB) continue;
        const from = anchorOnWay(wayA, sA.coord);
        const to = anchorOnWay(wayB, sB.coord);
        if (!from || !to) continue;
        const res = routeBetween(sys, from, to, {
          allowedTypeIds: allowed,
          excludeWayIds: exclude,
          biasPath: sketchPath,
          biasWeight: ADOPT_BIAS_WEIGHT,
        });
        if (!res) continue;
        const mat = materializeRouteSpans(sys, res.spans);
        if (!mat || mat.wayIds.length === 0) continue;
        sys = mat.system;

        // Swap the pattern onto the adopted ways.
        sys = {
          ...sys,
          services: sys.services.map((sv) =>
            sv.id === serviceId
              ? { ...sv, patterns: sv.patterns.map((p) => (p.id === pattern.id ? { ...p, wayIds: mat.wayIds } : p)) }
              : sv,
          ),
        };

        // Stations that rode the sketch follow the service onto the adopted
        // ways (nearest within tolerance); too far away, they detach but
        // survive as free stations rather than being deleted.
        const newWays = sys.ways.filter((w) => mat.wayIds.includes(w.id));
        sys = {
          ...sys,
          stations: sys.stations.map((stn) => {
            if (!stn.anchor || !exclude.has(stn.anchor.wayId)) return stn;
            let best: StationAnchor | undefined;
            let bestD = ADOPT_STATION_REANCHOR_M;
            for (const nw of newWays) {
              const on = nearestOnPath(resolveWayPath(nw), stn.coord);
              if (on && on.distMeters < bestD) {
                bestD = on.distMeters;
                best = { wayId: nw.id, t: on.t };
              }
            }
            return { ...stn, anchor: best };
          }),
        };

        // Sketch geometry nothing rides anymore is redundant — but never
        // silently delete anything imported or deliberately named.
        for (const oldId of oldWayIds) {
          const w = sys.ways.find((x) => x.id === oldId);
          if (!w || w.source) continue;
          const ridden = sys.services.some((sv) => sv.patterns.some((p) => p.wayIds.includes(oldId)));
          const named = sys.namedWays.some((n) => n.wayIds.includes(oldId));
          if (!ridden && !named) sys = removeWay(sys, oldId);
        }
        rebound++;
      }

      if (rebound > 0) set({ system: touch(sys) });
      return rebound;
    },

    addServiceToWay: (wayId) => {
      const st = get();
      const way = st.system.ways.find((w) => w.id === wayId);
      const compatible = modesForWayType(way?.typeId ?? st.draftWayTypeId);
      if (compatible.length === 0) return null; // this way type carries no service (e.g. bike)
      const id = shortId();
      const modeId = compatible.some((m) => m.id === st.draftModeId) ? st.draftModeId : compatible[0].id;
      const usedColors = new Set(st.system.services.map((s) => s.color.toLowerCase()));
      // Offer a color that isn't already on this system, falling back to the mode default.
      const color = st.system.palette.find((c) => !usedColors.has(c.toLowerCase())) ?? modeRender(modeId).color;
      // A freshly-drawn line gets a working default schedule immediately —
      // "drag a line, see a system running" shouldn't require a trip to the
      // Inspector first. DEFAULT_FREQUENCY_MINUTES/DEFAULT_SPAN mirror the
      // Inspector's own "10 min" / "6am–11pm" preset chips (see
      // ServiceInspector) so the value a fresh line starts at is never a
      // surprise once you do open the panel.
      const service: Service = {
        id,
        name: `Line ${nextLineNumber++}`,
        modeId,
        color,
        patterns: [{ id: shortId(), wayIds: [wayId] }],
        frequencyMinutes: DEFAULT_FREQUENCY_MINUTES,
        spanStart: DEFAULT_SPAN_START,
        spanEnd: DEFAULT_SPAN_END,
      };
      set((s) => ({ system: touch({ ...s.system, services: [...s.system.services, service] }), selection: { kind: "service", id } }));
      return id;
    },

    setServiceName: (id, name) =>
      set((s) => ({ system: touch({ ...s.system, services: s.system.services.map((sv) => (sv.id === id ? { ...sv, name } : sv)) }) })),
    setServiceColor: (id, color) =>
      set((s) => ({ system: touch({ ...s.system, services: s.system.services.map((sv) => (sv.id === id ? { ...sv, color } : sv)) }) })),
    setServiceMode: (id, modeId) =>
      set((s) => ({ system: touch({ ...s.system, services: s.system.services.map((sv) => (sv.id === id ? { ...sv, modeId } : sv)) }) })),
    setServiceFrequency: (id, minutes) =>
      set((s) => ({
        system: touch({ ...s.system, services: s.system.services.map((sv) => (sv.id === id ? { ...sv, frequencyMinutes: minutes } : sv)) }),
      })),
    setServiceSpan: (id, start, end) =>
      set((s) => ({
        system: touch({ ...s.system, services: s.system.services.map((sv) => (sv.id === id ? { ...sv, spanStart: start, spanEnd: end } : sv)) }),
      })),
    setServiceSchedule: (id, periods) =>
      set((s) => ({
        system: touch({
          ...s.system,
          services: s.system.services.map((sv) => (sv.id === id ? { ...sv, schedule: periods && periods.length > 0 ? periods : undefined } : sv)),
        }),
      })),

    deleteService: (id) =>
      set((s) => ({
        system: touch({ ...s.system, services: s.system.services.filter((sv) => sv.id !== id) }),
        selection: s.selection?.kind === "service" && s.selection.id === id ? null : s.selection,
      })),

    startAddingPattern: (serviceId) => set({ addingPatternForServiceId: serviceId, tool: "way" }),
    cancelAddingPattern: () => set({ addingPatternForServiceId: null }),
    deletePattern: (serviceId, patternId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          services: s.system.services.map((sv) =>
            sv.id === serviceId && sv.patterns.length > 1 ? { ...sv, patterns: sv.patterns.filter((p) => p.id !== patternId) } : sv,
          ),
        }),
      })),

    mergeServiceInto: (sourceId, targetId) =>
      set((s) => {
        const source = s.system.services.find((sv) => sv.id === sourceId);
        const target = s.system.services.find((sv) => sv.id === targetId);
        if (!source || !target || source.id === target.id || source.modeId !== target.modeId) return {};
        // Each carried-over pattern keeps its own name if it already had one
        // (a source that was itself already branched); otherwise it's named
        // after the service it came from, so the merged list still reads as
        // "which physical line did this branch used to be."
        const carried = source.patterns.map((p) => ({ ...p, name: p.name ?? source.name }));
        return {
          system: touch({
            ...s.system,
            services: s.system.services
              .filter((sv) => sv.id !== sourceId)
              .map((sv) => (sv.id === targetId ? { ...sv, patterns: [...sv.patterns, ...carried] } : sv)),
          }),
          selection: s.selection?.kind === "service" && s.selection.id === sourceId ? { kind: "service", id: targetId } : s.selection,
        };
      }),

    addStation: (coord, anchor) => {
      const id = shortId();
      const station: Station = { id, coord, ...(anchor ? { anchor } : {}) };
      set((s) => ({
        system: touch({ ...s.system, stations: [...s.system.stations, station] }),
        selection: { kind: "station", id },
        focusNameToken: s.focusNameToken + 1,
        focusNameStationId: id,
      }));
      return id;
    },

    consumeFocusName: (id) =>
      set((s) => (s.focusNameStationId === id ? { focusNameStationId: null } : {})),

    addDrawnStation: (footprint) => {
      const id = shortId();
      const cx = footprint.reduce((sum, p) => sum + p[0], 0) / footprint.length;
      const cy = footprint.reduce((sum, p) => sum + p[1], 0) / footprint.length;
      let coord: LngLat = [cx, cy];
      const hit = snap(get().system.ways, coord, STATION_DRAW_ANCHOR_M);
      if (hit) coord = hit.coord;
      const station: Station = {
        id,
        coord,
        ...(hit ? { anchor: { wayId: hit.wayId, t: hit.t } } : {}),
        footprint,
      };
      set((s) => ({ system: touch({ ...s.system, stations: [...s.system.stations, station] }), selection: { kind: "station", id } }));
      return id;
    },

    moveStation: (id, coord, anchor) =>
      set((s) => ({
        system: touch({ ...s.system, stations: s.system.stations.map((st) => (st.id === id ? { ...st, coord, anchor: anchor ?? undefined } : st)) }),
      })),

    setStationName: (id, name) =>
      set((s) => ({ system: touch({ ...s.system, stations: s.system.stations.map((st) => (st.id === id ? { ...st, name } : st)) }) })),

    setStationDwellSeconds: (id, seconds) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) => (st.id === id ? { ...st, dwellSeconds: seconds } : st)),
        }),
      })),

    deleteStation: (id) =>
      set((s) => ({
        system: touch({ ...s.system, stations: s.system.stations.filter((st) => st.id !== id) }),
        selection: s.selection?.kind === "station" && s.selection.id === id ? null : s.selection,
      })),

    addStationFootprint: (stationId) =>
      set((s) => {
        const station = s.system.stations.find((st) => st.id === stationId);
        if (!station || station.footprint) return s;
        const footprint = squareFootprint(station.coord, FOOTPRINT_HALF_SIZE_M);
        return {
          system: touch({ ...s.system, stations: s.system.stations.map((st) => (st.id === stationId ? { ...st, footprint } : st)) }),
        };
      }),

    moveFootprintPoint: (stationId, index, coord) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) =>
            st.id === stationId && st.footprint ? { ...st, footprint: st.footprint.map((p, i) => (i === index ? coord : p)) } : st,
          ),
        }),
      })),

    deleteStationFootprint: (stationId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) => (st.id === stationId ? { ...st, footprint: undefined, platforms: undefined } : st)),
        }),
      })),

    addPlatform: (stationId) => {
      const platformId = shortId();
      set((s) => {
        const station = s.system.stations.find((st) => st.id === stationId);
        if (!station) return s;
        const platform: Platform = { id: platformId, points: squareFootprint(station.coord, PLATFORM_HALF_SIZE_M), edges: 1 };
        return {
          system: touch({
            ...s.system,
            stations: s.system.stations.map((st) => (st.id === stationId ? { ...st, platforms: [...(st.platforms ?? []), platform] } : st)),
          }),
        };
      });
      return platformId;
    },

    movePlatformPoint: (stationId, platformId, index, coord) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) =>
            st.id === stationId
              ? {
                  ...st,
                  platforms: (st.platforms ?? []).map((p) =>
                    p.id === platformId ? { ...p, points: p.points.map((pt, i) => (i === index ? coord : pt)) } : p,
                  ),
                }
              : st,
          ),
        }),
      })),

    deletePlatform: (stationId, platformId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) =>
            st.id === stationId ? { ...st, platforms: (st.platforms ?? []).filter((p) => p.id !== platformId) } : st,
          ),
        }),
      })),

    addFacility: (typeId, geometry) => {
      const id = shortId();
      const facility: Facility = { id, typeId, geometry };
      set((s) => {
        let system: TransitSystem = { ...s.system, facilities: [...s.system.facilities, facility] };
        // THE BASE CONCEPT: a station's drawn border defines its land and
        // identity. A structure placed ON that land belongs to the station —
        // it joins the station's complex automatically (creating one if this
        // is the first structure), instead of floating as an unrelated
        // object the user must group by hand.
        const at: LngLat = Array.isArray(geometry[0]) ? centroidOf(geometry as LngLat[]) : (geometry as LngLat);
        const host = system.stations.find((st) => st.footprint && pointInPolygon(at, st.footprint));
        if (host) {
          const existing = system.groups.find((g) => g.memberIds.includes(host.id));
          system = existing
            ? { ...system, groups: system.groups.map((g) => (g.id === existing.id ? { ...g, memberIds: [...g.memberIds, id] } : g)) }
            : {
                ...system,
                groups: [...system.groups, { id: shortId(), name: host.name ? `${host.name} complex` : undefined, memberIds: [host.id, id] }],
              };
        }
        return { system: touch(system), selection: { kind: "facility", id } };
      });
      return id;
    },

    moveFacility: (id, geometry) =>
      set((s) => ({ system: touch({ ...s.system, facilities: s.system.facilities.map((f) => (f.id === id ? { ...f, geometry } : f)) }) })),

    setFacilityName: (id, name) =>
      set((s) => ({ system: touch({ ...s.system, facilities: s.system.facilities.map((f) => (f.id === id ? { ...f, name } : f)) }) })),

    deleteFacility: (id) =>
      set((s) => ({
        system: touch({ ...s.system, facilities: s.system.facilities.filter((f) => f.id !== id) }),
        selection: s.selection?.kind === "facility" && s.selection.id === id ? null : s.selection,
      })),

    createGroup: (memberIds, name) => {
      const id = shortId();
      const group: Group = { id, name, memberIds: [...new Set(memberIds)] };
      set((s) => ({ system: touch({ ...s.system, groups: [...s.system.groups, group] }), selection: { kind: "group", id } }));
      return id;
    },

    addGroupMember: (groupId, memberId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          groups: s.system.groups.map((g) => (g.id === groupId && !g.memberIds.includes(memberId) ? { ...g, memberIds: [...g.memberIds, memberId] } : g)),
        }),
      })),

    removeGroupMember: (groupId, memberId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          groups: s.system.groups.map((g) => (g.id === groupId ? { ...g, memberIds: g.memberIds.filter((m) => m !== memberId) } : g)),
        }),
      })),

    renameGroup: (id, name) =>
      set((s) => ({ system: touch({ ...s.system, groups: s.system.groups.map((g) => (g.id === id ? { ...g, name } : g)) }) })),
    setGroupColor: (id, color) =>
      set((s) => ({ system: touch({ ...s.system, groups: s.system.groups.map((g) => (g.id === id ? { ...g, color } : g)) }) })),

    deleteGroup: (id) =>
      set((s) => ({
        system: touch({ ...s.system, groups: s.system.groups.filter((g) => g.id !== id) }),
        selection: s.selection?.kind === "group" && s.selection.id === id ? null : s.selection,
      })),

    createFacilityComplex: (footprint) => {
      const id = shortId();
      const st = get();
      const usedColors = new Set(st.system.groups.filter((g) => g.color).map((g) => g.color!.toLowerCase()));
      const color = st.system.palette.find((c) => !usedColors.has(c.toLowerCase())) ?? st.system.palette[0];
      const group: Group = { id, memberIds: [], footprint, color };
      set((s) => ({ system: touch({ ...s.system, groups: [...s.system.groups, group] }), selection: { kind: "group", id } }));
      return id;
    },

    addGroupFootprint: (groupId) =>
      set((s) => {
        const group = s.system.groups.find((g) => g.id === groupId);
        if (!group || group.footprint) return s;
        const center = s.system.viewport.center; // no single coord to anchor a plain group; center on the view
        const footprint = squareFootprint(center, GROUP_FOOTPRINT_HALF_SIZE_M);
        return { system: touch({ ...s.system, groups: s.system.groups.map((g) => (g.id === groupId ? { ...g, footprint } : g)) }) };
      }),

    moveGroupFootprintPoint: (groupId, index, coord) =>
      set((s) => ({
        system: touch({
          ...s.system,
          groups: s.system.groups.map((g) =>
            g.id === groupId && g.footprint ? { ...g, footprint: g.footprint.map((p, i) => (i === index ? coord : p)) } : g,
          ),
        }),
      })),

    deleteGroupFootprint: (groupId) =>
      set((s) => ({
        system: touch({ ...s.system, groups: s.system.groups.map((g) => (g.id === groupId ? { ...g, footprint: undefined } : g)) }),
      })),

    startPlacingFacility: (groupId) => set({ placingFacilityForGroupId: groupId, pickingMemberForGroupId: null, tool: "facility" }),
    cancelPlacingFacility: () => set({ placingFacilityForGroupId: null }),

    placeFacilityInGroup: (groupId, typeId, coord) => {
      const id = shortId();
      const facility: Facility = { id, typeId, geometry: coord };
      set((s) => ({
        system: touch({
          ...s.system,
          facilities: [...s.system.facilities, facility],
          groups: s.system.groups.map((g) => (g.id === groupId ? { ...g, memberIds: [...g.memberIds, id] } : g)),
        }),
        selection: { kind: "group", id: groupId },
        placingFacilityForGroupId: null,
        tool: "select",
      }));
      return id;
    },

    startPickingMember: (groupId) => set({ pickingMemberForGroupId: groupId, placingFacilityForGroupId: null, tool: "select" }),
    cancelPickingMember: () => set({ pickingMemberForGroupId: null }),
  }));

  // The single place that turns "system changed" into "record an undo step" —
  // every action above stays a plain, unmodified `set(...)` call; this just
  // observes the store the same way any other subscriber would.
  editor.subscribe((state, prevState) => {
    if (state.system === prevState.system || skipHistory || checkpointBefore !== null) return;
    past.push(prevState.system);
    if (past.length > HISTORY_LIMIT) past.shift();
    future = [];
    editor.setState({ canUndo: true, canRedo: false });
  });

  return editor;
}
