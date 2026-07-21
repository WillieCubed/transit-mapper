// Import a real GTFS feed as a comparison baseline — "what does RTC actually
// run today, next to what I'm proposing." Same two-layer split as OSM import
// (model/import.ts): pure, network-free transforms (parseGtfsCsv,
// classifyGtfsRouteType, buildGtfsIndex, piecesForRoutes, gtfsFilesToSystemPieces)
// that fixture data can exercise directly, plus streamRtcGtfsBatches, the one
// function that touches the network.
import { unzipSync, strFromU8 } from "fflate";
import { shortId } from "./ids";
import { defaultProfileFor } from "./profile";
import { nearestOnPath, resolveWayPath } from "./geo";
import type { LngLat, Pattern, Service, Station, Way } from "./system";

export interface GtfsImportResult {
  ways: Way[];
  services: Service[];
  stations: Station[];
}

// GTFS routes.txt's route_type enum → this app's catalog
// (https://gtfs.org/schedule/reference/#routestxt). A route type this app
// has no dedicated equivalent for (trolleybus, funicular) falls back to the
// closest physical match rather than being dropped.
const ROUTE_TYPE_KIND: Record<number, { modeId: string; wayTypeId: string }> = {
  0: { modeId: "tram", wayTypeId: "lightRail" }, // Tram, streetcar, light rail
  1: { modeId: "subway", wayTypeId: "heavyRail" }, // Subway, metro
  2: { modeId: "commuterRail", wayTypeId: "heavyRail" }, // Rail
  3: { modeId: "bus", wayTypeId: "road" }, // Bus
  4: { modeId: "ferry", wayTypeId: "water" }, // Ferry
  5: { modeId: "tram", wayTypeId: "lightRail" }, // Cable tram
  6: { modeId: "gondola", wayTypeId: "aerial" }, // Aerial lift
  7: { modeId: "monorail", wayTypeId: "monorail" }, // Funicular — no dedicated catalog kind
  11: { modeId: "bus", wayTypeId: "road" }, // Trolleybus — no dedicated catalog kind
  12: { modeId: "monorail", wayTypeId: "monorail" }, // Monorail
};
const DEFAULT_ROUTE_KIND = { modeId: "bus", wayTypeId: "road" };

export function classifyGtfsRouteType(routeType: number): { modeId: string; wayTypeId: string } {
  return ROUTE_TYPE_KIND[routeType] ?? DEFAULT_ROUTE_KIND;
}

/** Minimal GTFS text-file CSV parser (comma-separated, optional
 *  double-quote wrapping, "" for an escaped quote) — GTFS fields never need
 *  more than that, so a hand-rolled parser is enough; no dependency for it. */
export function parseGtfsCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.length > 1 || r[0] !== "")
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, i) => {
        obj[h] = (r[i] ?? "").trim();
      });
      return obj;
    });
}

export interface GtfsFiles {
  routes: string;
  trips: string;
  stops: string;
  stopTimes: string;
  shapes?: string;
}

interface GtfsIndex {
  routeById: Map<string, Record<string, string>>;
  stopById: Map<string, Record<string, string>>;
  shapePaths: Map<string, LngLat[]>;
  shapeToRoute: Map<string, string>;
  shapeToTrip: Map<string, string>;
  stopTimesByTrip: Map<string, { seq: number; stopId: string }[]>;
  /** routeId -> its shapeIds, in the order first seen — the unit a batch is drawn from. */
  routeShapeIds: Map<string, string[]>;
}

/** Parse every GTFS file and build the lookup structures the transform
 *  needs — cheap relative to the transform itself, so this stays one
 *  synchronous pass rather than something that needs batching of its own. */
function buildGtfsIndex(files: GtfsFiles): GtfsIndex {
  const routes = parseGtfsCsv(files.routes);
  const trips = parseGtfsCsv(files.trips);
  const stops = parseGtfsCsv(files.stops);
  const stopTimes = parseGtfsCsv(files.stopTimes);
  const shapePoints = files.shapes ? parseGtfsCsv(files.shapes) : [];

  const shapeGroups = new Map<string, { seq: number; coord: LngLat }[]>();
  for (const r of shapePoints) {
    const shapeId = r.shape_id;
    if (!shapeId) continue;
    const lat = Number(r.shape_pt_lat);
    const lon = Number(r.shape_pt_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!shapeGroups.has(shapeId)) shapeGroups.set(shapeId, []);
    shapeGroups.get(shapeId)!.push({ seq: Number(r.shape_pt_sequence) || 0, coord: [lon, lat] });
  }
  const shapePaths = new Map<string, LngLat[]>();
  for (const [shapeId, pts] of shapeGroups) {
    pts.sort((a, b) => a.seq - b.seq);
    shapePaths.set(shapeId, pts.map((p) => p.coord));
  }

  const stopById = new Map(stops.map((s) => [s.stop_id, s]));
  const routeById = new Map(routes.map((r) => [r.route_id, r]));

  // First trip wins for each shape — a shape belongs to one route/one
  // representative stop sequence in every feed this needs to handle.
  const shapeToRoute = new Map<string, string>();
  const shapeToTrip = new Map<string, string>();
  for (const t of trips) {
    if (!t.shape_id || !t.route_id || shapeToRoute.has(t.shape_id)) continue;
    shapeToRoute.set(t.shape_id, t.route_id);
    shapeToTrip.set(t.shape_id, t.trip_id);
  }

  const stopTimesByTrip = new Map<string, { seq: number; stopId: string }[]>();
  for (const st of stopTimes) {
    if (!st.trip_id || !st.stop_id) continue;
    if (!stopTimesByTrip.has(st.trip_id)) stopTimesByTrip.set(st.trip_id, []);
    stopTimesByTrip.get(st.trip_id)!.push({ seq: Number(st.stop_sequence) || 0, stopId: st.stop_id });
  }

  const routeShapeIds = new Map<string, string[]>();
  for (const [shapeId, routeId] of shapeToRoute) {
    if (!shapePaths.has(shapeId) || (shapePaths.get(shapeId)?.length ?? 0) < 2) continue;
    if (!routeShapeIds.has(routeId)) routeShapeIds.set(routeId, []);
    routeShapeIds.get(routeId)!.push(shapeId);
  }

  return { routeById, stopById, shapePaths, shapeToRoute, shapeToTrip, stopTimesByTrip, routeShapeIds };
}

/** Ways/Services for just the given routes, plus any Stations newly reached
 *  by them — `stationByStopId` is the whole import's shared dedup map (a
 *  stop shared by a route in an earlier batch and one in this batch must
 *  still resolve to the same Station), so it's passed in and mutated rather
 *  than started fresh each call. */
function piecesForRoutes(index: GtfsIndex, routeIds: string[], stationByStopId: Map<string, Station>): GtfsImportResult {
  const ways: Way[] = [];
  const wayIdByShape = new Map<string, string>();
  const services: Service[] = [];

  for (const routeId of routeIds) {
    const route = index.routeById.get(routeId);
    const shapeIds = index.routeShapeIds.get(routeId) ?? [];
    if (!route || shapeIds.length === 0) continue;
    const kind = classifyGtfsRouteType(Number(route.route_type));

    const patterns: Pattern[] = [];
    for (const shapeId of shapeIds) {
      const points = index.shapePaths.get(shapeId);
      if (!points || points.length < 2) continue;
      const wayId = shortId();
      wayIdByShape.set(shapeId, wayId);
      ways.push({
        id: wayId,
        typeId: kind.wayTypeId,
        points,
        geometry: "straight",
        grade: "atGrade",
        profile: defaultProfileFor(kind.wayTypeId),
        source: `gtfs:${shapeId}`,
      });
      patterns.push({ id: shortId(), wayIds: [wayId] });
    }
    if (patterns.length === 0) continue;

    services.push({
      id: shortId(),
      name: route.route_short_name || route.route_long_name || `Route ${routeId}`,
      modeId: kind.modeId,
      color: route.route_color ? `#${route.route_color}` : "#e4572e",
      patterns,
    });
  }

  const newStations: Station[] = [];
  for (const [shapeId, wayId] of wayIdByShape) {
    const tripId = index.shapeToTrip.get(shapeId);
    const stopSeq = tripId && index.stopTimesByTrip.get(tripId);
    if (!stopSeq) continue;
    const way = ways.find((w) => w.id === wayId)!;
    const path = resolveWayPath(way);
    for (const { stopId } of [...stopSeq].sort((a, b) => a.seq - b.seq)) {
      if (stationByStopId.has(stopId)) continue;
      const stop = index.stopById.get(stopId);
      if (!stop) continue;
      const lat = Number(stop.stop_lat);
      const lon = Number(stop.stop_lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const coord: LngLat = [lon, lat];
      const nearest = nearestOnPath(path, coord);
      const station: Station = {
        id: shortId(),
        name: stop.stop_name || undefined,
        coord: nearest ? nearest.coord : coord,
        anchor: nearest ? { wayId, t: nearest.t } : undefined,
      };
      stationByStopId.set(stopId, station);
      newStations.push(station);
    }
  }

  return { ways, services, stations: newStations };
}

/**
 * Pure transform: parsed GTFS text files → catalog-typed Ways/Services/
 * Stations, all at once. One Way per distinct shape (not per trip, to avoid
 * duplicating geometry across every scheduled run of the same route), one
 * Service per route with one Pattern per shape that route uses (a branch/
 * express variant becomes a second Pattern automatically), and one Station
 * per stop actually served, anchored onto whichever shape's Way it sits
 * nearest — a stop shared by several routes still becomes exactly one
 * Station, matching how a hand-drawn interchange works. See
 * streamRtcGtfsBatches for the batched/live version of this same transform.
 */
export function gtfsFilesToSystemPieces(files: GtfsFiles): GtfsImportResult {
  const index = buildGtfsIndex(files);
  return piecesForRoutes(index, [...index.routeShapeIds.keys()], new Map());
}

/** Same transform as gtfsFilesToSystemPieces, split into route batches in
 *  the same order streamRtcGtfsBatches yields them — network-free (no fetch
 *  to mock), so fixture tests can check the batched path produces the exact
 *  same total ways/services/stations as the unbatched one. */
export function gtfsFilesToBatchedPieces(files: GtfsFiles, batchSize = 2): GtfsImportResult[] {
  const index = buildGtfsIndex(files);
  const routeIds = [...index.routeShapeIds.keys()];
  const stationByStopId = new Map<string, Station>();
  const batches: GtfsImportResult[] = [];
  for (let i = 0; i < routeIds.length; i += batchSize) {
    batches.push(piecesForRoutes(index, routeIds.slice(i, i + batchSize), stationByStopId));
  }
  return batches;
}

export interface GtfsImportBatch {
  pieces: GtfsImportResult;
  routesDone: number;
  routesTotal: number;
}

/**
 * RTC Southern Nevada's real, actively-maintained GTFS feed — fetched
 * through the Worker's /api/gtfs/rtc proxy since the feed's own host
 * doesn't send CORS headers for cross-origin browser fetches — parsed, then
 * handed back a few routes at a time instead of all at once. A route's
 * worth of ways/stations is small (built in well under a frame), and
 * yielding between batches lets the caller merge each one into the map
 * immediately and hand control back to the browser before starting the
 * next — the system visibly builds up route by route instead of the tab
 * going unresponsive for the whole import and then snapping to "done" (the
 * ~40 MB of GTFS text this feed unpacks to made that the norm, not an edge
 * case). The only function here that touches the network.
 */
export async function* streamRtcGtfsBatches(batchSize = 2): AsyncGenerator<GtfsImportBatch> {
  const res = await fetch("/api/gtfs/rtc");
  if (!res.ok) throw new Error(`GTFS import failed (${res.status}).`);
  const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const read = (name: string) => (zip[name] ? strFromU8(zip[name]) : "");
  const index = buildGtfsIndex({
    routes: read("routes.txt"),
    trips: read("trips.txt"),
    stops: read("stops.txt"),
    stopTimes: read("stop_times.txt"),
    shapes: read("shapes.txt"),
  });

  const routeIds = [...index.routeShapeIds.keys()];
  const stationByStopId = new Map<string, Station>();
  for (let i = 0; i < routeIds.length; i += batchSize) {
    const batch = routeIds.slice(i, i + batchSize);
    const pieces = piecesForRoutes(index, batch, stationByStopId);
    yield { pieces, routesDone: Math.min(i + batchSize, routeIds.length), routesTotal: routeIds.length };
    // Hand control back to the browser between batches — setTimeout, not
    // requestAnimationFrame: rAF callbacks are paused indefinitely by most
    // browsers once the tab isn't visible/focused, which would silently
    // stall an in-progress import the moment someone switched tabs (a real,
    // reproduced failure mode, not a hypothetical one — confirmed live: an
    // rAF-based yield here hung mid-import once the tab lost focus).
    // setTimeout keeps firing (throttled, never paused) regardless.
    await new Promise((r) => setTimeout(r, 0));
  }
}
