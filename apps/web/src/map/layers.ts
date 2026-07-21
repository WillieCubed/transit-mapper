import type { FeatureCollection, Feature, LineString, Point, Polygon } from "geojson";
import type { LayerSpecification, Map as MLMap } from "maplibre-gl";
import { FACILITY_TYPE_ORDER, wayType } from "@transitmapper/core/model/catalog";
import {
  CENTER_LINE_COLOR,
  FOOTPRINT_FILL,
  FOOTPRINT_FILL_OPACITY,
  FOOTPRINT_STROKE,
  LANE_ARROW_COLOR,
  LANE_LINE_COLOR,
  PLATFORM_FILL,
  PLATFORM_FILL_OPACITY,
  PLATFORM_STROKE,
  facilityRender,
  gradeFlags,
  laneRender,
  modeRender,
  showWayWhenServed,
  wayRender,
} from "../style/catalogStyle";
import { INTERCHANGE_METERS, resolveWayPath, serviceWayIds, servedWayIds } from "@transitmapper/core/model/geo";
import { directionalLanes, isOneWay, wayCapacity } from "@transitmapper/core/model/profile";
import { wayIntersectsBounds, wayLaneGeometry } from "@transitmapper/core/geometry/streets";
import { collectWayTrims, connectorCurves, junctionGeometry, type JunctionGeometry, type WayTrims } from "@transitmapper/core/geometry/junctions";
import { ensureIcon, iconName } from "./icons";
import type { Selection } from "../editor/store";
import type { LngLat, Service, TransitSystem } from "@transitmapper/core/model/system";

// Reshape/physical handles are always this one color+glyph (a solid square —
// the standard vector-editor "this is a control point" shape) regardless of
// what they're attached to, so they read as one consistent tool affordance
// and never as a real object like a station or facility.
const HANDLE_INK = "#191a17";
export const HANDLE_ICON = iconName("square", HANDLE_INK);

export const SRC_WAYS = "tm-ways";
export const SRC_SERVICES = "tm-services";
export const SRC_STATIONS = "tm-stations";
export const SRC_HANDLES = "tm-handles";
export const SRC_PREVIEW = "tm-preview";
export const SRC_FOOTPRINTS = "tm-footprints";
export const SRC_PLATFORMS = "tm-platforms";
export const SRC_FACILITIES = "tm-facilities";
export const SRC_PHYSICAL_HANDLES = "tm-physical-handles";
export const SRC_VEHICLES = "tm-vehicles";
export const SRC_MARQUEE = "tm-marquee";
export const SRC_ENDPOINT_HINT = "tm-endpoint-hint";
export const SRC_LANES = "tm-lanes";
export const SRC_LANE_MARKINGS = "tm-lane-markings";
export const SRC_LANE_ARROWS = "tm-lane-arrows";
export const SRC_JUNCTIONS = "tm-junctions";
export const SRC_CONNECTORS = "tm-connectors";
export const SRC_WAY_LABELS = "tm-way-labels";
export const SRC_LANDMARKS = "tm-landmarks";

export const LYR_WAYS_SOLID = "tm-ways-solid";
export const LYR_WAYS_DASHED = "tm-ways-dashed";
export const LYR_WAY_SELECTED = "tm-way-selected";
export const LYR_SERVICES_ELEVATED = "tm-services-elevated";
export const LYR_SERVICE_SELECTED = "tm-service-selected";
export const LYR_SERVICES_SOLID = "tm-services-solid";
export const LYR_SERVICES_UNDERGROUND = "tm-services-underground";
export const LYR_STATIONS = "tm-stations";
export const LYR_STATION_SELECTED = "tm-station-selected";
export const LYR_VEHICLES = "tm-vehicles";
export const LYR_STATION_LABELS = "tm-station-labels";
export const LYR_FACILITY_LABELS = "tm-facility-labels";
export const LYR_HANDLES = "tm-handles";
export const LYR_WAY_ENDPOINTS = "tm-way-endpoints";
export const LYR_PREVIEW = "tm-preview";
export const LYR_FOOTPRINTS_FILL = "tm-footprints-fill";
export const LYR_FOOTPRINTS_STROKE = "tm-footprints-stroke";
export const LYR_PLATFORMS_FILL = "tm-platforms-fill";
export const LYR_PLATFORMS_STROKE = "tm-platforms-stroke";
export const LYR_FACILITIES = "tm-facilities";
export const LYR_FACILITY_SELECTED = "tm-facility-selected";
export const LYR_PHYSICAL_HANDLES = "tm-physical-handles";
export const LYR_ENDPOINT_HINT = "tm-endpoint-hint";
export const LYR_MARQUEE_FILL = "tm-marquee-fill";
export const LYR_MARQUEE_STROKE = "tm-marquee-stroke";
export const LYR_LANE_SURFACES = "tm-lane-surfaces";
export const LYR_LANE_LINES = "tm-lane-lines";
export const LYR_CENTER_LINES = "tm-center-lines";
export const LYR_EDGE_LINES = "tm-edge-lines";
export const LYR_LANE_TRACKS = "tm-lane-tracks";
export const LYR_LANE_ARROWS = "tm-lane-arrows";
export const LYR_JUNCTIONS = "tm-junctions";
export const LYR_JUNCTION_SELECTED = "tm-junction-selected";
export const LYR_CONNECTORS = "tm-connectors";
export const LYR_WAY_LABELS = "tm-way-labels";
export const LYR_LANDMARKS = "tm-landmarks";
export const LYR_LANDMARK_LABELS = "tm-landmark-labels";

// Lane-level street rendering only exists at zooms where a lane is at least
// a few pixels wide; below this the Infrastructure view keeps its cheap
// offset-fan rendering, and the whole-valley view never derives lane
// geometry at all (the LOD gate that keeps big imports fast).
export const LANE_DETAIL_MIN_ZOOM = 15;

// meters-per-pixel at zoom 14 on a 512px-tile web-mercator map; lane widths
// are stored in meters, so each feature carries its z14 pixel width and the
// layer scales it exponentially (base 2 — exact for mercator) with zoom.
const MPP_Z14_EQUATOR = 40075016.686 / (512 * 2 ** 14);
function widthPxAtZ14(widthM: number, lat: number): number {
  return widthM / (MPP_Z14_EQUATOR * Math.cos((lat * Math.PI) / 180));
}
const LANE_WIDTH_EXPR = ["interpolate", ["exponential", 2], ["zoom"], 14, ["get", "w14"], 22, ["*", 256, ["get", "w14"]]];

const NEUTRAL_STATION = "#4b5563";
// A dedicated-guideway/aerial/water way with no service riding it yet reads as
// unassigned infrastructure — a faint dashed placeholder, not its real color.
// Roads and bike ways are real surfaces independent of any service, so they
// always show their actual catalog style, served or not.
const UNASSIGNED_COLOR = "#b9b9b2";
const UNASSIGNED_WIDTH = 2;
const UNASSIGNED_FAMILIES = new Set(["guideway", "aerial", "water"]);
const BUNDLE_SPACING_PX = 5; // perpendicular gap between parallel services
const LANE_SPACING_PX = 3; // perpendicular gap between a way's own capacity lanes/tracks

export interface SystemFeatures {
  ways: FeatureCollection<LineString>;
  services: FeatureCollection<LineString>;
  stations: FeatureCollection<Point>;
  handles: FeatureCollection<Point>;
  footprints: FeatureCollection<Polygon>;
  platforms: FeatureCollection<Polygon>;
  facilities: FeatureCollection<Point>;
  physicalHandles: FeatureCollection<Point>;
  /** Lane-detail street rendering (Infrastructure view at high zoom only —
   *  see LANE_DETAIL_MIN_ZOOM): lane surfaces, painted markings, direction
   *  arrows. Empty collections otherwise. */
  lanes: FeatureCollection<LineString>;
  laneMarkings: FeatureCollection<LineString>;
  laneArrows: FeatureCollection<LineString>;
  junctions: FeatureCollection<Polygon>;
  connectors: FeatureCollection<LineString>;
  /** Shared-identity (NamedWay) name labels along their member ways. */
  wayLabels: FeatureCollection<LineString>;
}

function closeRing(points: LngLat[]): LngLat[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

export interface ViewOptions {
  /** Network = stylized, service-focused, grade hidden. Infrastructure =
   *  physical, catalog-styled, grade shown (real cross-sections are P2).
   *  Diagram = schematic/octolinear, same physical-detail-hidden behavior as
   *  Network but fed a geometrically transformed system (see
   *  model/diagramLayout.ts) instead of the real one. */
  viewMode: "network" | "infrastructure" | "diagram";
  /** Mode ids currently shown; a service whose mode isn't in this set is hidden. */
  visibleModes: Set<string>;
  /** Way-type ids currently shown; a way whose type isn't in this set is hidden. */
  visibleWayTypes: Set<string>;
  /** True at lane-detail zooms in the Infrastructure view — ways in view
   *  render as real per-lane geometry instead of the offset fan. */
  laneDetail?: boolean;
  /** Current viewport (with margin), so lane geometry only derives for ways
   *  actually on screen. Only consulted when laneDetail is set. */
  bounds?: [LngLat, LngLat];
}

/** Project the system into GeoJSON. Ways carrying multiple services are
 *  emitted as several offset service features so MapLibre draws parallel
 *  colored lines; the infra line itself is styled from the way-type/class
 *  catalog (style/catalogStyle.ts) and hidden under exclusive-use services.
 *  `view` narrows what's drawn (per-mode/per-type filters) and how (Network
 *  shows only clean bundled service lines with grade hidden; Infrastructure
 *  also shows bare/unassigned infrastructure and grade styling). */
export function buildFeatures(
  system: TransitSystem,
  selection: Selection,
  handleWayIds: string[],
  view: ViewOptions,
  /** The station whose footprint/platform vertices should render as
   *  draggable handles right now (its own edit context, not tied to
   *  `selection` directly since a platform can be mid-edit independently). */
  physicalHandleStationId: string | null = null,
  /** Same, for a group's (facility-complex's) own footprint vertices. */
  physicalHandleGroupId: string | null = null,
): SystemFeatures {
  const selId = selection?.id ?? null;
  // Diagram inherits Network's schematic behavior (grade/footprints/
  // facilities hidden, capacity collapsed to one line) — only Infrastructure
  // wants the physical-planning detail.
  const network = view.viewMode !== "infrastructure";
  // Built once, unconditionally (same order as work this function already
  // does unconditionally elsewhere) — reused everywhere below that used to
  // do a fresh `system.ways.find(...)` scan per lookup: the laneDetail
  // junction pass, the wayLabels loop, and the handle-ways loop.
  const waysById = new Map(system.ways.map((w) => [w.id, w]));

  // services per way, in stable (creation) order — pre-filtered by visible
  // mode. Deduplicated across a service's own patterns: two branches sharing
  // a trunk way still count as ONE service on that way, so the trunk renders
  // as a single line and only forks visually past the branch point.
  const byWay = new Map<string, Service[]>();
  for (const svc of system.services) {
    if (!view.visibleModes.has(svc.modeId)) continue;
    for (const wid of serviceWayIds(svc)) {
      const arr = byWay.get(wid) ?? [];
      arr.push(svc);
      byWay.set(wid, arr);
    }
  }

  // A way's own infra line, fanned out into `way.capacity` parallel lanes/
  // tracks in the Infrastructure view — a real physical cross-section instead
  // of one representative line. Network view always collapses to one line
  // (capacity is physical-planning detail, out of place on the schematic map).
  const emitCrossSection = (
    way: TransitSystem["ways"][number],
    path: LngLat[],
    color: string,
    width: number,
    dashed: boolean,
  ) => {
    const lanes = network ? 1 : Math.max(1, wayCapacity(way));
    const laneWidth = lanes > 1 ? Math.max(1.5, width / lanes + 0.75) : width;
    const selectedWay = selection?.kind === "way" && selId === way.id;
    for (let i = 0; i < lanes; i++) {
      ways.push({
        type: "Feature",
        properties: {
          id: way.id,
          color,
          width: laneWidth,
          dashed,
          offset: (i - (lanes - 1) / 2) * LANE_SPACING_PX,
          selected: selectedWay,
        },
        geometry: { type: "LineString", coordinates: path },
      });
    }
  };

  const ways: Feature<LineString>[] = [];
  const services: Feature<LineString>[] = [];
  const lanes: Feature<LineString>[] = [];
  const laneMarkings: Feature<LineString>[] = [];
  const laneArrows: Feature<LineString>[] = [];

  // True-scale per-lane rendering for one way: lane surfaces at their real
  // metric widths (w14 + the exponential zoom expression in LANE_WIDTH_EXPR),
  // painted dividers, thin-line lanes (tracks), and direction arrows. Replaces
  // the emitCrossSection fan for that way at lane-detail zooms.
  const emitLaneDetail = (way: TransitSystem["ways"][number]) => {
    // wayTrims is populated by the junction pass below before any call here.
    const trims = wayTrims.get(way.id) ?? { start: 0, end: 0 };
    const g = wayLaneGeometry(way, trims.start, trims.end);
    const lat = way.points[0]?.[1] ?? 36;
    for (const lane of g.lanes) {
      const r = laneRender(lane.kindId);
      if (r.surface) {
        lanes.push({
          type: "Feature",
          properties: { id: way.id, kindId: lane.kindId, color: r.color, w14: widthPxAtZ14(lane.widthM, lat) },
          geometry: { type: "LineString", coordinates: lane.path },
        });
      } else {
        laneMarkings.push({
          type: "Feature",
          properties: { kind: "thinLane", color: r.color },
          geometry: { type: "LineString", coordinates: lane.path },
        });
      }
    }
    for (const d of g.dividers) {
      laneMarkings.push({ type: "Feature", properties: { kind: d.kind }, geometry: { type: "LineString", coordinates: d.path } });
    }
    for (const a of g.arrows) {
      laneArrows.push({ type: "Feature", properties: { id: way.id }, geometry: { type: "LineString", coordinates: a.path } });
    }
    if (selection?.kind === "way" && selId === way.id) {
      // The selection halo normally rides the fan features — emit one
      // centerline stand-in so a lane-rendered way still glows when selected.
      ways.push({
        type: "Feature",
        properties: { id: way.id, color: "#191a17", width: 10, dashed: false, offset: 0, selected: true, haloOnly: true },
        geometry: { type: "LineString", coordinates: resolveWayPath(way) },
      });
    }
  };

  // A way renders at lane detail when we're zoomed in enough (view.laneDetail),
  // it's on screen, and it isn't a tunnel (underground stays a dashed fan —
  // drawing asphalt for a bored tube would misread).
  const wantsLaneDetail = (way: TransitSystem["ways"][number]) =>
    !network &&
    view.laneDetail === true &&
    way.grade !== "underground" &&
    way.profile.lanes.length > 0 &&
    (!view.bounds || wayIntersectsBounds(way, view.bounds));

  // Junctions among lane-detailed ways: real footprint polygons whose trim
  // distances pull every arm's lane geometry back so carriageways stop at
  // the junction edge instead of overlapping through it (stage 2 feeding
  // stage 1 — see geometry/junctions.ts). Connector curves are the per-lane
  // turn guides through each footprint.
  const junctionFeatures: Feature<Polygon>[] = [];
  const connectorFeatures: Feature<LineString>[] = [];
  let wayTrims: WayTrims = new Map();
  if (!network && view.laneDetail === true) {
    const laneNodes: { node: TransitSystem["nodes"][number]; g: JunctionGeometry }[] = [];
    for (const node of system.nodes) {
      const relevant = node.refs.some((r) => {
        const w = waysById.get(r.wayId);
        return !!w && wantsLaneDetail(w);
      });
      if (!relevant) continue;
      const g = junctionGeometry(node, waysById);
      if (!g) continue;
      laneNodes.push({ node, g });
    }
    wayTrims = collectWayTrims(laneNodes.map((x) => x.g));
    for (const { node, g } of laneNodes) {
      if (g.polygon.length >= 3) {
        junctionFeatures.push({
          type: "Feature",
          properties: { nodeId: node.id, selected: selection?.kind === "node" && selId === node.id },
          geometry: { type: "Polygon", coordinates: [closeRing(g.polygon)] },
        });
      }
      for (const c of connectorCurves(node, waysById, wayTrims, system.turnRestrictions)) {
        connectorFeatures.push({
          type: "Feature",
          properties: { nodeId: node.id },
          geometry: { type: "LineString", coordinates: c.path },
        });
      }
    }
  }

  for (const way of system.ways) {
    if (!view.visibleWayTypes.has(way.typeId)) continue;
    const path = resolveWayPath(way);
    if (path.length < 2) continue;
    const bundle = byWay.get(way.id) ?? [];
    const base = wayRender(way.typeId, way.classId);
    const laneDetail = wantsLaneDetail(way);

    if (bundle.length === 0) {
      // Network view is service-focused — bare/unassigned infrastructure with
      // no rider only makes sense as physical-planning context (Infrastructure).
      if (network) continue;
      if (laneDetail) {
        emitLaneDetail(way);
        continue;
      }
      const unassigned = UNASSIGNED_FAMILIES.has(wayType(way.typeId).family);
      emitCrossSection(
        way,
        path,
        unassigned ? UNASSIGNED_COLOR : base.color,
        unassigned ? UNASSIGNED_WIDTH : base.width,
        unassigned ? true : !!base.dashed,
      );
      continue;
    }

    if (laneDetail) {
      emitLaneDetail(way);
    } else if (!network && showWayWhenServed(way.typeId)) {
      emitCrossSection(way, path, base.color, base.width, !!base.dashed);
    }

    // One-way infrastructure reads as one-way in the SCHEMATIC too:
    // chevrons along the served line, pointing with travel — otherwise
    // Network view silently hides direction, and a one-way couplet looks
    // like two ordinary parallel lines.
    if (network && isOneWay(way.profile)) {
      const backward = directionalLanes(way.profile).every((l) => l.direction === "backward");
      laneArrows.push({
        type: "Feature",
        properties: { id: way.id },
        geometry: { type: "LineString", coordinates: backward ? [...path].reverse() : path },
      });
    }

    const n = bundle.length;
    // Network view is the clean schematic map — grade (tunnel/viaduct styling)
    // is physical-alignment detail that belongs to the Infrastructure view.
    const { underground, elevated } = network ? { underground: false, elevated: false } : gradeFlags(way.grade);
    bundle.forEach((svc, i) => {
      services.push({
        type: "Feature",
        properties: {
          serviceId: svc.id,
          wayId: way.id,
          color: svc.color,
          width: modeRender(svc.modeId).width,
          underground,
          elevated,
          offset: (i - (n - 1) / 2) * BUNDLE_SPACING_PX,
          // A selected WAY also lights up any service riding it — most
          // guideway types (rail, monorail) never draw their own bare line
          // when served (see showWayWhenServed/emitCrossSection above), so
          // the service line is the ONLY thing on screen to highlight for a
          // way selection there; for road/bike, this just adds to the
          // way's own LYR_WAY_SELECTED glow rather than replacing it.
          selected: (selection?.kind === "service" && selId === svc.id) || (selection?.kind === "way" && selId === way.id),
        },
        geometry: { type: "LineString", coordinates: path },
      });
    });
  }

  const visibleWays = system.ways.filter((w) => view.visibleWayTypes.has(w.typeId));
  const stations: Feature<Point>[] = system.stations.map((s) => {
    // `byWay` already maps a way to the (visible-mode) services riding it —
    // built once above for the way-rendering loop, so reuse it here instead
    // of re-deriving each service's way ids per station: on a large GTFS
    // import (thousands of stations) that recomputation showed up as real,
    // measured main-thread time, unlike this Map-lookup version.
    const nearWays = servedWayIds(s.coord, visibleWays, INTERCHANGE_METERS);
    const servingServiceSet = new Set<Service>();
    for (const wid of nearWays) for (const sv of byWay.get(wid) ?? []) servingServiceSet.add(sv);
    const servingServices = [...servingServiceSet];
    const anchorServices = s.anchor ? (byWay.get(s.anchor.wayId) ?? []) : [];
    const color = anchorServices[0]?.color ?? servingServices[0]?.color ?? NEUTRAL_STATION;
    return {
      type: "Feature",
      properties: {
        id: s.id,
        color,
        interchange: servingServices.length > 1,
        selected: selection?.kind === "station" && selId === s.id,
        name: s.name ?? "",
      },
      geometry: { type: "Point", coordinates: s.coord },
    };
  });

  // A way's first/last control point is marked `endpoint` — it renders and
  // behaves differently from an interior reshape handle (see LYR_WAY_ENDPOINTS):
  // dragging it extends the way with a new point instead of moving it in place.
  const handles: Feature<Point>[] = [];
  for (const wid of handleWayIds) {
    const way = waysById.get(wid);
    way?.points.forEach((p, i) => {
      const endpoint = i === 0 || i === way.points.length - 1;
      handles.push({ type: "Feature", properties: { wayId: wid, index: i, endpoint, icon: HANDLE_ICON }, geometry: { type: "Point", coordinates: p } });
    });
  }

  // Physical planning detail (footprints, platforms, facilities) belongs to
  // the Infrastructure view — Network stays the clean schematic map.
  const footprints: Feature<Polygon>[] = [];
  const platforms: Feature<Polygon>[] = [];
  const physicalHandles: Feature<Point>[] = [];
  if (!network) {
    for (const st of system.stations) {
      if (st.footprint) {
        footprints.push({
          type: "Feature",
          properties: { stationId: st.id },
          geometry: { type: "Polygon", coordinates: [closeRing(st.footprint)] },
        });
      }
      for (const pf of st.platforms ?? []) {
        platforms.push({
          type: "Feature",
          properties: { stationId: st.id, platformId: pf.id },
          geometry: { type: "Polygon", coordinates: [closeRing(pf.points)] },
        });
      }
      if (st.id === physicalHandleStationId) {
        st.footprint?.forEach((p, i) => {
          physicalHandles.push({ type: "Feature", properties: { kind: "footprint", stationId: st.id, index: i, icon: HANDLE_ICON }, geometry: { type: "Point", coordinates: p } });
        });
        for (const pf of st.platforms ?? []) {
          pf.points.forEach((p, i) => {
            physicalHandles.push({
              type: "Feature",
              properties: { kind: "platform", stationId: st.id, platformId: pf.id, index: i, icon: HANDLE_ICON },
              geometry: { type: "Point", coordinates: p },
            });
          });
        }
      }
    }

    // Group footprints (facility complexes) share the same footprint
    // fill/stroke/handle rendering as a station's, except a complex carries
    // its own color (so several complexes on one map stay visually distinct)
    // — falls back to the shared default style when absent.
    for (const g of system.groups) {
      if (g.footprint) {
        footprints.push({
          type: "Feature",
          properties: { groupId: g.id, ...(g.color ? { color: g.color } : {}) },
          geometry: { type: "Polygon", coordinates: [closeRing(g.footprint)] },
        });
      }
      if (g.id === physicalHandleGroupId) {
        g.footprint?.forEach((p, i) => {
          physicalHandles.push({
            type: "Feature",
            properties: { kind: "groupFootprint", groupId: g.id, index: i, icon: HANDLE_ICON },
            geometry: { type: "Point", coordinates: p },
          });
        });
      }
    }
  }

  // NamedWay (street/line/trail) name labels along every member way — the
  // shared identity reads as ONE named street across junction-split segments
  // and separated carriageways. Infrastructure view only, like all physical
  // naming detail; MapLibre's own collision keeps repeats sparse.
  const wayLabels: Feature<LineString>[] = [];
  if (!network) {
    for (const nw of system.namedWays) {
      if (!nw.name) continue;
      for (const wid of nw.wayIds) {
        const w = waysById.get(wid);
        if (!w || !view.visibleWayTypes.has(w.typeId)) continue;
        const path = resolveWayPath(w);
        if (path.length < 2) continue;
        wayLabels.push({ type: "Feature", properties: { name: nw.name }, geometry: { type: "LineString", coordinates: path } });
      }
    }
  }

  const facilities: Feature<Point>[] = network
    ? []
    : system.facilities.map((f) => {
        const r = facilityRender(f.typeId);
        const coord: LngLat = Array.isArray(f.geometry[0]) ? (f.geometry as LngLat[])[0] : (f.geometry as LngLat);
        return {
          type: "Feature",
          properties: {
            id: f.id,
            typeId: f.typeId,
            color: r.color,
            radius: r.radius,
            icon: iconName(r.icon, r.color),
            selected: selection?.kind === "facility" && selId === f.id,
            name: f.name ?? "",
          },
          geometry: { type: "Point", coordinates: coord },
        };
      });

  return {
    ways: { type: "FeatureCollection", features: ways },
    services: { type: "FeatureCollection", features: services },
    stations: { type: "FeatureCollection", features: stations },
    footprints: { type: "FeatureCollection", features: footprints },
    platforms: { type: "FeatureCollection", features: platforms },
    facilities: { type: "FeatureCollection", features: facilities },
    physicalHandles: { type: "FeatureCollection", features: physicalHandles },
    handles: { type: "FeatureCollection", features: handles },
    lanes: { type: "FeatureCollection", features: lanes },
    laneMarkings: { type: "FeatureCollection", features: laneMarkings },
    laneArrows: { type: "FeatureCollection", features: laneArrows },
    junctions: { type: "FeatureCollection", features: junctionFeatures },
    connectors: { type: "FeatureCollection", features: connectorFeatures },
    wayLabels: { type: "FeatureCollection", features: wayLabels },
  };
}

export const LAYER_SPECS: LayerSpecification[] = [
  // Paint order, bottom-up: reference landmarks first (fixed context, not
  // system data — must sit under everything the user actually draws), then
  // the lane-detail STREET SURFACE (junction fills + lane asphalt +
  // markings — it's the ground), then station/complex footprints and
  // platforms ON TOP of it (a station area overlays the road it straddles —
  // painting streets later buried footprints, the "station boundaries are
  // invisible" bug), then ways/services/stations above those.
  {
    // Hand-placed reference points (the Strip, UNLV, downtown, the airport,
    // …) — static context, not user data (see map/landmarks.ts). Muted and
    // small so a real drawn system always reads as the foreground.
    id: LYR_LANDMARKS,
    type: "circle",
    source: SRC_LANDMARKS,
    paint: { "circle-radius": 3, "circle-color": "#9a9a92", "circle-opacity": 0.7 },
  },
  {
    id: LYR_LANDMARK_LABELS,
    type: "symbol",
    source: SRC_LANDMARKS,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["literal", ["Noto Sans Regular"]],
      "text-size": 11,
      "text-variable-anchor": ["top", "bottom", "right", "left"],
      "text-radial-offset": 0.6,
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: { "text-color": "#9a9a92", "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
  },
  {
    // Junction footprints: the shared asphalt where lane-detailed ways meet.
    // Painted BENEATH the lane surfaces so each arm's trimmed carriageway
    // butts cleanly against the footprint.
    id: LYR_JUNCTIONS,
    type: "fill",
    source: SRC_JUNCTIONS,
    paint: { "fill-color": "#7d8188", "fill-opacity": 0.9 },
  },
  {
    id: LYR_JUNCTION_SELECTED,
    type: "line",
    source: SRC_JUNCTIONS,
    filter: ["get", "selected"],
    paint: { "line-color": "#191a17", "line-width": 2.5, "line-opacity": 0.7 },
  },
  {
    // Lane surfaces: each lane's centerline drawn at its true metric width
    // (w14 × exponential zoom scaling), so a 5-lane arterial reads as real
    // asphalt at high zoom. Only populated at lane-detail zooms.
    id: LYR_LANE_SURFACES,
    type: "line",
    source: SRC_LANES,
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": LANE_WIDTH_EXPR as never, "line-opacity": 0.9 },
  },
  {
    // Thin-line lanes (rail tracks embedded in or beside a street) — a track
    // is a pair of rails, not a slab, so it draws as a fixed thin line.
    id: LYR_LANE_TRACKS,
    type: "line",
    source: SRC_LANE_MARKINGS,
    filter: ["==", ["get", "kind"], "thinLane"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 2.5 },
  },
  {
    // Dashed white separator between same-direction lanes.
    id: LYR_LANE_LINES,
    type: "line",
    source: SRC_LANE_MARKINGS,
    filter: ["==", ["get", "kind"], "laneLine"],
    paint: { "line-color": LANE_LINE_COLOR, "line-width": 1.2, "line-dasharray": [3, 3], "line-opacity": 0.9 },
  },
  {
    // Solid edge line where the directional roadway meets sidewalk/parking.
    id: LYR_EDGE_LINES,
    type: "line",
    source: SRC_LANE_MARKINGS,
    filter: ["==", ["get", "kind"], "edgeLine"],
    paint: { "line-color": LANE_LINE_COLOR, "line-width": 1.2, "line-opacity": 0.75 },
  },
  {
    // The center line where directions oppose — solid yellow.
    id: LYR_CENTER_LINES,
    type: "line",
    source: SRC_LANE_MARKINGS,
    filter: ["==", ["get", "kind"], "centerLine"],
    paint: { "line-color": CENTER_LINE_COLOR, "line-width": 1.8, "line-opacity": 0.95 },
  },
  {
    // Per-lane turn guides through a junction (from the lane-connectivity
    // graph — stored connectors or the derived defaults). Faint dashes, so
    // they read as guidance rather than paint.
    id: LYR_CONNECTORS,
    type: "line",
    source: SRC_CONNECTORS,
    layout: { "line-cap": "round" },
    paint: { "line-color": LANE_LINE_COLOR, "line-width": 1.2, "line-dasharray": [1.5, 2], "line-opacity": 0.55 },
  },
  {
    // Direction arrows along each one-way lane, pointing with travel (the
    // geometry engine pre-reverses backward lanes' paths).
    id: LYR_LANE_ARROWS,
    type: "symbol",
    source: SRC_LANE_ARROWS,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 90,
      "text-field": "▶",
      "text-size": 10,
      "text-keep-upright": false,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": LANE_ARROW_COLOR, "text-opacity": 0.9 },
  },
  {
    id: LYR_FOOTPRINTS_FILL,
    type: "fill",
    source: SRC_FOOTPRINTS,
    // A facility complex with its own color reads more clearly with a
    // slightly stronger fill than the shared monochrome default — a station
    // footprint (no color property) keeps the original subtle tint.
    paint: {
      "fill-color": ["coalesce", ["get", "color"], FOOTPRINT_FILL],
      "fill-opacity": ["case", ["has", "color"], 0.14, FOOTPRINT_FILL_OPACITY],
    },
  },
  {
    id: LYR_FOOTPRINTS_STROKE,
    type: "line",
    source: SRC_FOOTPRINTS,
    paint: { "line-color": ["coalesce", ["get", "color"], FOOTPRINT_STROKE], "line-width": 1.5, "line-dasharray": [3, 2] },
  },
  {
    id: LYR_PLATFORMS_FILL,
    type: "fill",
    source: SRC_PLATFORMS,
    paint: { "fill-color": PLATFORM_FILL, "fill-opacity": PLATFORM_FILL_OPACITY },
  },
  {
    id: LYR_PLATFORMS_STROKE,
    type: "line",
    source: SRC_PLATFORMS,
    paint: { "line-color": PLATFORM_STROKE, "line-width": 1.5 },
  },
  {
    // A selected bare/infra way gets the same soft dark halo a selected
    // service does (LYR_SERVICE_SELECTED below) — without this, selecting a
    // way via the Objects list (kind:"way", not "service") drew nothing
    // different at all, since only service features ever carried a
    // `selected` flag before.
    id: LYR_WAY_SELECTED,
    type: "line",
    source: SRC_WAYS,
    filter: ["get", "selected"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#191a17",
      "line-width": ["+", ["get", "width"], 7],
      "line-opacity": 0.18,
      "line-offset": ["get", "offset"],
    },
  },
  {
    // A way with capacity > 1 fans out into several offset lane/track
    // features (see emitCrossSection) — line-offset is what actually spaces
    // them apart on screen into a real physical cross-section.
    id: LYR_WAYS_SOLID,
    type: "line",
    source: SRC_WAYS,
    // haloOnly features exist purely for LYR_WAY_SELECTED (a lane-rendered
    // way's selection glow) — they must never paint as a solid line.
    filter: ["all", ["!", ["get", "dashed"]], ["!", ["to-boolean", ["get", "haloOnly"]]]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": 0.85, "line-offset": ["get", "offset"] },
  },
  {
    id: LYR_WAYS_DASHED,
    type: "line",
    source: SRC_WAYS,
    filter: ["get", "dashed"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-dasharray": [2, 2], "line-opacity": 0.85, "line-offset": ["get", "offset"] },
  },
  {
    // Elevated ways get a dark casing beneath — reads as a viaduct.
    id: LYR_SERVICES_ELEVATED,
    type: "line",
    source: SRC_SERVICES,
    filter: ["get", "elevated"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#191a17", "line-width": ["+", ["get", "width"], 3.5], "line-opacity": 0.32, "line-offset": ["get", "offset"] },
  },
  {
    id: LYR_SERVICE_SELECTED,
    type: "line",
    source: SRC_SERVICES,
    filter: ["get", "selected"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#191a17",
      "line-width": ["+", ["get", "width"], 7],
      "line-opacity": 0.18,
      "line-offset": ["get", "offset"],
    },
  },
  {
    id: LYR_SERVICES_SOLID,
    type: "line",
    source: SRC_SERVICES,
    filter: ["!", ["get", "underground"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-offset": ["get", "offset"] },
  },
  {
    // Underground ways render dashed, like a tunnel.
    id: LYR_SERVICES_UNDERGROUND,
    type: "line",
    source: SRC_SERVICES,
    filter: ["get", "underground"],
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-dasharray": [2.5, 2], "line-offset": ["get", "offset"] },
  },
  {
    id: LYR_STATION_SELECTED,
    type: "circle",
    source: SRC_STATIONS,
    filter: ["get", "selected"],
    paint: { "circle-radius": ["case", ["get", "interchange"], 12, 10], "circle-color": "#191a17", "circle-opacity": 0.18 },
  },
  {
    id: LYR_STATIONS,
    type: "circle",
    source: SRC_STATIONS,
    paint: {
      "circle-radius": ["case", ["get", "interchange"], 7, 5],
      "circle-color": "#ffffff",
      "circle-stroke-width": 3,
      "circle-stroke-color": ["case", ["get", "interchange"], "#111827", ["get", "color"]],
    },
  },
  {
    // One dot per service, driven by map/vehicles.ts's own rAF loop directly
    // pushing to SRC_VEHICLES — bypasses the store entirely (ambient motion,
    // never a system mutation), so its data is never touched by buildFeatures.
    id: LYR_VEHICLES,
    type: "circle",
    source: SRC_VEHICLES,
    paint: {
      "circle-radius": 5,
      "circle-color": ["get", "color"],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  },
  {
    // Named stations only (empty-name ones — a common work-in-progress
    // state — stay unlabeled rather than showing a placeholder). Anchor
    // varies (not a fixed offset) so MapLibre's own collision resolution can
    // slide a label around its station when neighbors are dense, same idea
    // as real transit-map label placement.
    id: LYR_STATION_LABELS,
    type: "symbol",
    source: SRC_STATIONS,
    filter: ["!=", ["get", "name"], ""],
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["case", ["get", "interchange"], ["literal", ["Noto Sans Bold"]], ["literal", ["Noto Sans Regular"]]],
      "text-size": 12,
      "text-variable-anchor": ["top", "bottom", "right", "left"],
      "text-radial-offset": 0.7,
      "text-justify": "auto",
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: { "text-color": "#191a17", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
  },
  {
    // Street/line/trail names along their ways — classic map street labels,
    // only at zooms where the name is about THIS street, not clutter.
    id: LYR_WAY_LABELS,
    type: "symbol",
    source: SRC_WAY_LABELS,
    minzoom: 13,
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "name"],
      "text-font": ["literal", ["Noto Sans Regular"]],
      "text-size": 12,
      "text-letter-spacing": 0.05,
    },
    paint: { "text-color": "#191a17", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
  },
  {
    id: LYR_PREVIEW,
    type: "line",
    source: SRC_PREVIEW,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#191a17", "line-width": 2, "line-dasharray": [1.5, 1.5], "line-opacity": 0.5 },
  },
  {
    // Way tool, not yet drawing, hovering near an existing way's open end:
    // a big soft ring signals "clicking here resumes/extends this way"
    // (see map/interactions.ts's onHoverMove + nearestOpenEndpoint) — clearly
    // bigger and softer than the plain endpoint dot (LYR_WAY_ENDPOINTS)
    // itself, which only ever renders for the active/selected way anyway and
    // wasn't visible at all for the arbitrary other way you're about to snap
    // onto.
    id: LYR_ENDPOINT_HINT,
    type: "circle",
    source: SRC_ENDPOINT_HINT,
    paint: {
      "circle-radius": 13,
      "circle-color": "#191a17",
      "circle-opacity": 0.16,
      "circle-stroke-width": 2.5,
      "circle-stroke-color": "#191a17",
      "circle-stroke-opacity": 0.85,
    },
  },
  {
    // Interior control points: reshape only (drag repositions the point). A
    // solid square, not a circle — the standard vector-editor "control
    // point" shape, so it can never be mistaken for a station or facility
    // (both of which stay circular/pictogram markers).
    id: LYR_HANDLES,
    type: "symbol",
    source: SRC_HANDLES,
    filter: ["!", ["get", "endpoint"]],
    layout: { "icon-image": ["get", "icon"], "icon-size": 0.28, "icon-allow-overlap": true, "icon-ignore-placement": true },
  },
  {
    // A way's open ends: drag to EXTEND (adds a new point), not reshape —
    // deliberately inverted (ink fill / light ring) so it never reads as a
    // regular handle or, worse, a station stop.
    id: LYR_WAY_ENDPOINTS,
    type: "circle",
    source: SRC_HANDLES,
    filter: ["get", "endpoint"],
    paint: { "circle-radius": 7, "circle-color": "#191a17", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" },
  },
  {
    id: LYR_FACILITY_SELECTED,
    type: "circle",
    source: SRC_FACILITIES,
    filter: ["get", "selected"],
    paint: { "circle-radius": ["+", ["get", "radius"], 5], "circle-color": "#191a17", "circle-opacity": 0.18 },
  },
  {
    // Catalog-typed point facilities (entrances, bike docks, depots, …) —
    // each type gets its own pictogram (map/icons.ts, rasterized from the
    // same glyph set as the React UI) so they read as distinct real-world
    // things instead of interchangeable colored dots.
    id: LYR_FACILITIES,
    type: "symbol",
    source: SRC_FACILITIES,
    layout: { "icon-image": ["get", "icon"], "icon-size": 0.4, "icon-allow-overlap": true, "icon-ignore-placement": true },
  },
  {
    // Named facilities only — most stay unlabeled (an "entrance" pictogram
    // is usually self-explanatory), but a named depot/yard or parking lot
    // reads much better with its name on the map.
    id: LYR_FACILITY_LABELS,
    type: "symbol",
    source: SRC_FACILITIES,
    filter: ["!=", ["get", "name"], ""],
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["literal", ["Noto Sans Regular"]],
      "text-size": 11,
      "text-variable-anchor": ["bottom", "top", "right", "left"],
      "text-radial-offset": 0.9,
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: { "text-color": "#191a17", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
  },
  {
    // Footprint/platform vertices of the station currently being edited —
    // same reshape affordance/style as way handles (same verb, same look).
    id: LYR_PHYSICAL_HANDLES,
    type: "symbol",
    source: SRC_PHYSICAL_HANDLES,
    layout: { "icon-image": ["get", "icon"], "icon-size": 0.28, "icon-allow-overlap": true, "icon-ignore-placement": true },
  },
  {
    // Shift-drag rubber-band select (see map/interactions.ts's
    // startMarqueeSelect) — last in paint order so it always draws above
    // everything else while the drag is live.
    id: LYR_MARQUEE_FILL,
    type: "fill",
    source: SRC_MARQUEE,
    paint: { "fill-color": "#191a17", "fill-opacity": 0.08 },
  },
  {
    id: LYR_MARQUEE_STROKE,
    type: "line",
    source: SRC_MARQUEE,
    paint: { "line-color": "#191a17", "line-width": 1.5, "line-dasharray": [2, 2] },
  },
];

/** Registers every icon image the symbol layers above can reference — the
 *  handle square plus one pictogram per catalog facility type. Call once,
 *  after the map's style has loaded (map.addImage needs a ready style). */
export function registerMapIcons(map: MLMap): void {
  ensureIcon(map, "square", HANDLE_INK, { fill: true });
  for (const typeId of FACILITY_TYPE_ORDER) {
    const r = facilityRender(typeId);
    ensureIcon(map, r.icon, r.color);
  }
}
