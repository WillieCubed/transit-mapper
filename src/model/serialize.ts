import { shortId } from "./ids";
import { LINE_COLORS } from "../style/catalogStyle";
import { laneKind } from "./catalog";
import { defaultProfileFor } from "./profile";
import {
  DEFAULT_VIEWPORT,
  type CrossSection,
  type LaneConnector,
  type LaneSpec,
  type LngLat,
  type NamedWay,
  type Node,
  type NodeControl,
  type Pattern,
  type ScheduleDayScope,
  type SchedulePeriod,
  type Service,
  type Station,
  type TransitSystem,
  type Way,
  type WayPointRef,
} from "./system";

export function createEmptySystem(now = Date.now()): TransitSystem {
  return {
    version: 7, // v7 adds Service.schedule (optional multi-period headway schedule)
    id: shortId(),
    name: "Untitled system",
    viewport: { ...DEFAULT_VIEWPORT },
    createdAt: now,
    updatedAt: now,
    ways: [],
    services: [],
    stations: [],
    facilities: [],
    groups: [],
    nodes: [],
    namedWays: [],
    palette: [...LINE_COLORS],
  };
}

function isLngLat(v: unknown): v is LngLat {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

function coords(v: unknown): LngLat[] {
  return Array.isArray(v) ? (v.filter(isLngLat) as LngLat[]) : [];
}

const GEOMETRIES = new Set(["straight", "curved", "freeform"]);
const GRADES = new Set(["underground", "atGrade", "elevated"]);
const strings = (v: unknown): string[] => (Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : []);

const geometryOf = (v: unknown) => (typeof v === "string" && GEOMETRIES.has(v) ? v : "straight") as Way["geometry"];
const gradeOf = (v: unknown) => (typeof v === "string" && GRADES.has(v) ? v : "atGrade") as Way["grade"];

// v2 had one flat "corridor" concept with no way-type distinction; the way
// type a migrated corridor gets is inferred from the mode of a service riding
// it (heavy rail vs. light rail vs. monorail are separate, incompatible way
// types in v3 — see model/catalog.ts). Falls back to "lightRail" when no
// service (or an unrecognized mode) claims the corridor.
const LEGACY_MODE_WAY_TYPE: Record<string, string> = {
  subway: "heavyRail",
  commuterRail: "heavyRail",
  lightRail: "lightRail",
  tram: "lightRail",
  monorail: "monorail",
  brt: "road",
  bus: "road",
};

/**
 * Validate untrusted input into a TransitSystem, migrating older shapes:
 *  - v3 stores ways (unified infrastructure) and services (colored routes);
 *  - v2 stored corridors (rail-only, mode-agnostic) and roads separately —
 *    each corridor becomes a heavyRail/lightRail/monorail way inferred from
 *    a riding service's mode, each road becomes a "road" way (class
 *    preserved), and each service's corridorIds becomes wayIds;
 *  - v1 stored `lines` (alignment + color together) — each becomes one way
 *    (typed from its own mode) plus one service running over it.
 */
export function parseSystem(input: unknown): TransitSystem {
  if (!input || typeof input !== "object") throw new Error("System is not an object");
  const o = input as Record<string, unknown>;

  if (Array.isArray(o.ways) || (typeof o.version === "number" && o.version >= 3)) return parseV3(o);
  return migrateFromV2(o);
}

const LANE_DIRECTIONS = new Set(["forward", "backward", "both", "none"]);
const NODE_CONTROLS = new Set(["uncontrolled", "signal", "stop", "roundabout"]);

/** Parse a stored cross-section (v6+); null when absent/invalid so the
 *  caller can fall back to a capacity-derived default profile. Unknown lane
 *  kinds are kept only if they parse structurally — laneKind() tolerates
 *  unknown ids at render time. */
function parseProfile(raw: unknown): CrossSection | null {
  if (!raw || typeof raw !== "object") return null;
  const lanesRaw = (raw as Record<string, unknown>).lanes;
  if (!Array.isArray(lanesRaw)) return null;
  const lanes: LaneSpec[] = [];
  for (const l of lanesRaw) {
    const r = l as Record<string, unknown>;
    if (typeof r.kindId !== "string") continue;
    const widthM =
      typeof r.widthM === "number" && Number.isFinite(r.widthM) && r.widthM > 0
        ? r.widthM
        : laneKind(r.kindId).defaultWidthM;
    lanes.push({
      id: typeof r.id === "string" ? r.id : shortId(),
      kindId: r.kindId,
      widthM,
      direction: (typeof r.direction === "string" && LANE_DIRECTIONS.has(r.direction) ? r.direction : "both") as LaneSpec["direction"],
    });
  }
  return lanes.length > 0 ? { lanes } : null;
}

// Coordinates are compared to this many decimal places (~0.11m at the
// equator) when deriving junctions from raw coincidence — matches the
// precision snap()/joinWayPointToWay actually produce, so two points meant to
// be the same junction always land in the same bucket.
const NODE_COORD_PRECISION = 6;

function coordKey(c: LngLat): string {
  return `${c[0].toFixed(NODE_COORD_PRECISION)},${c[1].toFixed(NODE_COORD_PRECISION)}`;
}

/** A v3 system (or any system saved without an explicit `nodes` field) has no
 *  junction records — derive them from raw coordinate coincidence across
 *  every way's control points. Anything shared by 2+ control points becomes a
 *  Node. */
function deriveNodesFromWays(ways: Way[]): Node[] {
  const groups = new Map<string, { coord: LngLat; refs: WayPointRef[] }>();
  for (const w of ways) {
    w.points.forEach((p, i) => {
      const key = coordKey(p);
      const g = groups.get(key) ?? { coord: p, refs: [] };
      g.refs.push({ wayId: w.id, pointIndex: i });
      groups.set(key, g);
    });
  }
  const nodes: Node[] = [];
  for (const g of groups.values()) {
    if (g.refs.length < 2) continue;
    nodes.push({ id: shortId(), coord: g.coord, refs: g.refs });
  }
  return nodes;
}

/** Validate persisted nodes (v4+) against the ways actually loaded — drops
 *  refs pointing at a missing way or an out-of-range point index, and drops
 *  any node left with fewer than 2 valid refs (no longer a real junction). */
function parseNodes(raw: unknown[], ways: Way[]): Node[] {
  const wayPointCounts = new Map(ways.map((w) => [w.id, w.points.length]));
  const nodes: Node[] = [];
  for (const n of raw) {
    const r = n as Record<string, unknown>;
    if (typeof r.id !== "string" || !isLngLat(r.coord) || !Array.isArray(r.refs)) continue;
    const refs: WayPointRef[] = (r.refs as unknown[])
      .map((ref) => ref as Record<string, unknown>)
      .filter((ref) => typeof ref.wayId === "string" && typeof ref.pointIndex === "number")
      .map((ref) => ({ wayId: ref.wayId as string, pointIndex: ref.pointIndex as number }))
      .filter((ref) => {
        const count = wayPointCounts.get(ref.wayId);
        return count !== undefined && ref.pointIndex >= 0 && ref.pointIndex < count;
      });
    if (refs.length < 2) continue;
    const control =
      typeof r.control === "string" && NODE_CONTROLS.has(r.control) ? (r.control as NodeControl) : undefined;
    const connectors = parseConnectors(r.connectors, ways, refs);
    nodes.push({
      id: r.id,
      coord: r.coord,
      refs,
      ...(control ? { control } : {}),
      ...(connectors ? { connectors } : {}),
    });
  }
  return nodes;
}

/** Validate stored lane connectors (v6+): each endpoint must name a way that
 *  is part of this junction and a lane present in that way's profile. Returns
 *  undefined when nothing valid remains (junction reverts to heuristic
 *  connectors). */
function parseConnectors(raw: unknown, ways: Way[], refs: WayPointRef[]): LaneConnector[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const junctionWayIds = new Set(refs.map((ref) => ref.wayId));
  const laneIdsByWay = new Map(ways.map((w) => [w.id, new Set(w.profile.lanes.map((l) => l.id))]));
  const validEnd = (v: unknown): v is { wayId: string; laneId: string } => {
    const e = v as Record<string, unknown> | undefined;
    return (
      typeof e?.wayId === "string" &&
      typeof e?.laneId === "string" &&
      junctionWayIds.has(e.wayId) &&
      (laneIdsByWay.get(e.wayId)?.has(e.laneId) ?? false)
    );
  };
  const connectors: LaneConnector[] = [];
  for (const c of raw) {
    const r = c as Record<string, unknown>;
    if (validEnd(r.from) && validEnd(r.to)) {
      connectors.push({
        from: { wayId: (r.from as { wayId: string; laneId: string }).wayId, laneId: (r.from as { wayId: string; laneId: string }).laneId },
        to: { wayId: (r.to as { wayId: string; laneId: string }).wayId, laneId: (r.to as { wayId: string; laneId: string }).laneId },
      });
    }
  }
  return connectors.length > 0 ? connectors : undefined;
}

/** Validate stored named ways (v6+) — drops references to missing ways and
 *  identities left with no members. */
function parseNamedWays(raw: unknown, ways: Way[]): NamedWay[] {
  if (!Array.isArray(raw)) return [];
  const wayIds = new Set(ways.map((w) => w.id));
  const named: NamedWay[] = [];
  for (const n of raw) {
    const r = n as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string") continue;
    const memberIds = strings(r.wayIds).filter((id) => wayIds.has(id));
    if (memberIds.length > 0) named.push({ id: r.id, name: r.name, wayIds: memberIds });
  }
  return named;
}

/** v5 stores a service's own `patterns` array (one path per branch); pre-v5
 *  systems stored a single flat `wayIds` directly on the service — that
 *  becomes its one pattern. A service with genuinely nothing (empty/missing
 *  both) parses to `patterns: []`, same "ghost record" shape a pre-v5
 *  `wayIds: []` service was — validateSystem flags it, parsing doesn't drop it. */
function parsePatterns(raw: unknown, legacyWayIds: unknown): Pattern[] {
  if (Array.isArray(raw)) {
    return raw
      .map((p): Pattern | null => {
        const r = p as Record<string, unknown>;
        if (typeof r.id !== "string") return null;
        return { id: r.id, wayIds: strings(r.wayIds), name: typeof r.name === "string" ? r.name : undefined };
      })
      .filter((p): p is Pattern => p !== null);
  }
  const wayIds = strings(legacyWayIds);
  return wayIds.length > 0 ? [{ id: shortId(), wayIds }] : [];
}

const SCHEDULE_DAY_SCOPES = new Set(["daily", "weekday", "weekend"]);

/** v7+ stores a service's optional detailed `schedule` (see system.ts's
 *  SchedulePeriod comment); absent on anything older, which just keeps
 *  using frequencyMinutes/spanStart/spanEnd directly. A malformed period
 *  (missing/bad fields) is dropped rather than defaulted — a half-broken
 *  period is worse than a shorter list. */
function parseSchedule(raw: unknown): SchedulePeriod[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const periods = raw
    .map((p): SchedulePeriod | null => {
      const r = p as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.label !== "string") return null;
      if (typeof r.spanStart !== "string" || typeof r.spanEnd !== "string") return null;
      if (typeof r.frequencyMinutes !== "number" || r.frequencyMinutes <= 0) return null;
      const days = typeof r.days === "string" && SCHEDULE_DAY_SCOPES.has(r.days) ? (r.days as ScheduleDayScope) : "daily";
      return { id: r.id, label: r.label, days, spanStart: r.spanStart, spanEnd: r.spanEnd, frequencyMinutes: r.frequencyMinutes };
    })
    .filter((p): p is SchedulePeriod => p !== null);
  return periods.length > 0 ? periods : undefined;
}

function parseV3(o: Record<string, unknown>): TransitSystem {
  const rawWays = Array.isArray(o.ways) ? o.ways : [];
  const rawServices = Array.isArray(o.services) ? o.services : [];
  const rawStations = Array.isArray(o.stations) ? o.stations : [];
  const rawFacilities = Array.isArray(o.facilities) ? o.facilities : [];
  const rawGroups = Array.isArray(o.groups) ? o.groups : [];

  const ways: Way[] = rawWays.map((w) => {
    const r = w as Record<string, unknown>;
    if (typeof r.id !== "string") throw new Error("Bad way");
    const typeId = typeof r.typeId === "string" ? r.typeId : "rail";
    // v6 stores the cross-section; v3–v5 stored a scalar capacity — migrate
    // it into an equivalent default profile (lane split per profile.ts).
    const profile =
      parseProfile(r.profile) ?? defaultProfileFor(typeId, typeof r.capacity === "number" ? r.capacity : undefined);
    return {
      id: r.id,
      typeId,
      points: coords(r.points),
      geometry: geometryOf(r.geometry),
      grade: gradeOf(r.grade),
      profile,
      classId: typeof r.classId === "string" ? r.classId : undefined,
      source: typeof r.source === "string" ? r.source : undefined,
    };
  });

  const services: Service[] = rawServices.map((s) => {
    const r = s as Record<string, unknown>;
    if (typeof r.id !== "string") throw new Error("Bad service");
    return {
      id: r.id,
      name: typeof r.name === "string" ? r.name : "Service",
      modeId: typeof r.modeId === "string" ? r.modeId : "bus",
      color: typeof r.color === "string" ? r.color : "#2ea44f",
      patterns: parsePatterns(r.patterns, r.wayIds),
      frequencyMinutes: typeof r.frequencyMinutes === "number" ? r.frequencyMinutes : undefined,
      spanStart: typeof r.spanStart === "string" ? r.spanStart : undefined,
      spanEnd: typeof r.spanEnd === "string" ? r.spanEnd : undefined,
      schedule: parseSchedule(r.schedule),
    };
  });

  const stations: Station[] = rawStations.map((s) => parseStation(s));

  const facilities = rawFacilities.map((f) => {
    const r = f as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.typeId !== "string") throw new Error("Bad facility");
    const geometry = isLngLat(r.geometry) ? r.geometry : coords(r.geometry);
    return { id: r.id, typeId: r.typeId, name: typeof r.name === "string" ? r.name : undefined, geometry };
  });

  const groups = rawGroups.map((g) => {
    const r = g as Record<string, unknown>;
    if (typeof r.id !== "string") throw new Error("Bad group");
    const footprint = Array.isArray(r.footprint) ? coords(r.footprint) : undefined;
    return {
      id: r.id,
      name: typeof r.name === "string" ? r.name : undefined,
      memberIds: strings(r.memberIds),
      ...(footprint && footprint.length > 0 ? { footprint } : {}),
      color: typeof r.color === "string" ? r.color : undefined,
    };
  });

  const nodes: Node[] = Array.isArray(o.nodes) ? parseNodes(o.nodes, ways) : deriveNodesFromWays(ways);
  const namedWays = parseNamedWays(o.namedWays, ways);

  return finish(o, { ways, services, stations, facilities, groups, nodes, namedWays });
}

function parseStation(s: unknown): Station {
  const r = s as Record<string, unknown>;
  if (typeof r.id !== "string" || !isLngLat(r.coord)) throw new Error("Bad station");
  // wayId (v3), corridorId (v2), lineId (v1) all name the same anchor target.
  const a = r.anchor as Record<string, unknown> | undefined;
  const anchorId =
    typeof a?.wayId === "string" ? a.wayId : typeof a?.corridorId === "string" ? a.corridorId : typeof a?.lineId === "string" ? a.lineId : undefined;
  const anchor = anchorId && typeof a?.t === "number" ? { wayId: anchorId, t: a.t } : undefined;
  const footprint = Array.isArray(r.footprint) ? coords(r.footprint) : undefined;
  const platforms = Array.isArray(r.platforms)
    ? (r.platforms as unknown[]).map((p) => {
        const pr = p as Record<string, unknown>;
        return { id: typeof pr.id === "string" ? pr.id : shortId(), points: coords(pr.points), edges: typeof pr.edges === "number" ? pr.edges : undefined };
      })
    : undefined;
  return {
    id: r.id,
    name: typeof r.name === "string" ? r.name : undefined,
    coord: r.coord,
    ...(anchor ? { anchor } : {}),
    ...(footprint ? { footprint } : {}),
    ...(platforms ? { platforms } : {}),
    ...(typeof r.dwellSeconds === "number" ? { dwellSeconds: r.dwellSeconds } : {}),
  };
}

/** The way type a migrated v2 corridor gets, from the mode of a service riding it. */
function wayTypeForLegacyCorridor(corridorId: string, rawServices: unknown[]): string {
  for (const s of rawServices) {
    const r = s as Record<string, unknown>;
    if (typeof r.mode === "string" && Array.isArray(r.corridorIds) && r.corridorIds.includes(corridorId)) {
      const typeId = LEGACY_MODE_WAY_TYPE[r.mode];
      if (typeId) return typeId;
    }
  }
  return "lightRail";
}

// v2 road classes become the "road" way type's facility classes 1:1.
const ROAD_CLASS_IDS = new Set(["arterial", "collector", "local", "transitway"]);

function migrateFromV2(o: Record<string, unknown>): TransitSystem {
  const rawStations = Array.isArray(o.stations) ? o.stations : [];
  const rawCorridors = Array.isArray(o.corridors) ? o.corridors : [];
  const rawServices = Array.isArray(o.services) ? o.services : [];
  const rawLines = Array.isArray(o.lines) ? o.lines : []; // legacy v1
  const rawRoads = Array.isArray(o.roads) ? o.roads : [];

  const ways: Way[] = [];
  const services: Service[] = [];

  if (rawCorridors.length > 0 || rawServices.length > 0) {
    for (const c of rawCorridors) {
      const r = c as Record<string, unknown>;
      if (typeof r.id !== "string") throw new Error("Bad corridor");
      const typeId = wayTypeForLegacyCorridor(r.id, rawServices);
      ways.push({
        id: r.id,
        typeId,
        points: coords(r.points),
        geometry: geometryOf(r.geometry),
        grade: gradeOf(r.grade),
        profile: defaultProfileFor(typeId),
      });
    }
    for (const s of rawServices) {
      const r = s as Record<string, unknown>;
      if (typeof r.id !== "string") throw new Error("Bad service");
      services.push({
        id: r.id,
        name: typeof r.name === "string" ? r.name : "Service",
        modeId: typeof r.mode === "string" ? r.mode : "bus",
        color: typeof r.color === "string" ? r.color : "#2ea44f",
        patterns: parsePatterns(undefined, r.corridorIds),
      });
    }
  } else {
    // Legacy v1: migrate each line to a rail way + a service.
    const legacyStationCoord = new Map<string, LngLat>();
    for (const s of rawStations) {
      const r = s as Record<string, unknown>;
      if (typeof r.id === "string" && isLngLat(r.coord)) legacyStationCoord.set(r.id, r.coord);
    }
    for (const l of rawLines) {
      const r = l as Record<string, unknown>;
      if (typeof r.id !== "string") continue;
      let points = coords(r.points);
      if (points.length === 0 && Array.isArray(r.shape)) points = coords(r.shape);
      if (points.length === 0 && Array.isArray(r.stationIds)) {
        points = strings(r.stationIds)
          .map((id) => legacyStationCoord.get(id))
          .filter((c): c is LngLat => !!c);
      }
      const typeId = (typeof r.mode === "string" && LEGACY_MODE_WAY_TYPE[r.mode]) || "lightRail";
      ways.push({ id: r.id, typeId, points, geometry: geometryOf(r.geometry), grade: gradeOf(r.grade), profile: defaultProfileFor(typeId) });
      services.push({
        id: shortId(),
        name: typeof r.name === "string" ? r.name : "Service",
        modeId: typeof r.mode === "string" ? r.mode : "bus",
        color: typeof r.color === "string" ? r.color : "#2ea44f",
        patterns: [{ id: shortId(), wayIds: [r.id] }],
      });
    }
  }

  // v2 roads become "road" ways carrying no service (bare infrastructure).
  for (const rd of rawRoads) {
    const r = rd as Record<string, unknown>;
    if (typeof r.id !== "string" || !Array.isArray(r.coords)) throw new Error("Bad road");
    const classId = typeof r.class === "string" && ROAD_CLASS_IDS.has(r.class) ? r.class : "arterial";
    ways.push({
      id: r.id,
      typeId: "road",
      points: coords(r.coords),
      geometry: "straight",
      grade: "atGrade",
      profile: defaultProfileFor("road"),
      classId,
    });
  }

  // parseStation already resolves v2's corridorId / v1's lineId onto wayId.
  const stations: Station[] = rawStations.map((s) => parseStation(s));

  return finish(o, { ways, services, stations, facilities: [], groups: [], nodes: deriveNodesFromWays(ways), namedWays: [] });
}

function finish(
  o: Record<string, unknown>,
  parts: Pick<TransitSystem, "ways" | "services" | "stations" | "facilities" | "groups" | "nodes" | "namedWays">,
): TransitSystem {
  const vp = o.viewport as Record<string, unknown> | undefined;
  const viewport =
    vp && isLngLat(vp.center) && typeof vp.zoom === "number"
      ? { center: vp.center, zoom: vp.zoom }
      : { ...DEFAULT_VIEWPORT };

  const palette = Array.isArray(o.palette) && o.palette.every((c) => typeof c === "string")
    ? (o.palette as string[])
    : [...LINE_COLORS];

  const now = Date.now();
  return {
    version: 7,
    id: typeof o.id === "string" ? o.id : shortId(),
    name: typeof o.name === "string" ? o.name : "Untitled system",
    description: typeof o.description === "string" ? o.description : undefined,
    viewport,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : now,
    ...parts,
    palette,
  };
}

/** Deep clone a system under a fresh id — used by "Fork". */
export function forkSystem(system: TransitSystem, now = Date.now()): TransitSystem {
  return {
    ...structuredClone(system),
    id: shortId(),
    name: `${system.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
}
