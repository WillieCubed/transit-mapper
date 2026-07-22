import type { FeatureCollection, Feature, LineString, Point, Polygon } from "geojson";
import { wayType } from "@transitmapper/core/model/catalog";
import { facilityRender, gradeFlags, laneRender, modeRender, showWayWhenServed, wayRender } from "../../style/catalogStyle";
import { INTERCHANGE_METERS, resolveWayPath, serviceWayIds, servedWayIds } from "@transitmapper/core/model/geo";
import { directionalLanes, isOneWay, wayCapacity } from "@transitmapper/core/model/profile";
import { wayIntersectsBounds, wayLaneGeometry } from "@transitmapper/core/geometry/streets";
import { collectWayTrims, connectorCurves, junctionGeometry, type JunctionGeometry, type WayTrims } from "@transitmapper/core/geometry/junctions";
import { iconName } from "../icons";
import type { Selection } from "../../editor/store";
import type { LngLat, Service, TransitSystem } from "@transitmapper/core/model/system";
import { HANDLE_ICON, widthPxAtZ14 } from "./constants";

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
