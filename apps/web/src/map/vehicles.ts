import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import type { EditorStore } from "../editor/store";
import { nearestOnPath, pathLengthMeters, patternPath, pointAtT } from "@transitmapper/core/model/geo";
import type { LngLat, Pattern, SchedulePeriod, Service, Station, TransitSystem, Way } from "@transitmapper/core/model/system";
import { SRC_VEHICLES } from "./layers";

export const VEHICLE_SPEED_MPS = 11; // ~40 km/h — a plausible light-rail/tram running speed
const MIN_PERIOD_MS = 6000; // a floor so even a very short line doesn't blur past instantly
// A very short headway on a long line could otherwise imply dozens of
// vehicles — capped so "every 5 min" reads as "frequent", not as a swarm.
const MAX_VEHICLES_PER_PATTERN = 6;
// Doors open, board/alight, doors close — a plausible light-rail/bus dwell
// when a station doesn't specify its own (Station.dwellSeconds).
const DEFAULT_DWELL_SECONDS = 20;

export interface VehicleGate {
  /** Whether this service's vehicles should currently render — Network view
   *  only, and hidden along with everything else when its mode is filtered
   *  out (see ui/ViewProvider). */
  isVisible: (service: Service) => boolean;
}

/** The headway vehicle count/spacing is computed against — a detailed
 *  schedule (see system.ts's SchedulePeriod) supersedes the plain
 *  frequencyMinutes field when present; its BUSIEST (lowest-headway) period
 *  wins, since this is ambient decoration ("what does this line look like
 *  at its busiest"), not a simulation with a notion of current time of day.
 *  Undefined (nothing set at all) keeps today's original one-vehicle
 *  behavior — see the `?? 1` count below. */
// Same WeakMap-on-array-reference pattern as stationsByWayCache/
// patternGeometryCache below — this runs every animation frame per visible
// service, and `service.schedule` only gets a new reference when the
// schedule itself actually changes.
const headwayCache = new WeakMap<SchedulePeriod[], number>();

function effectiveHeadwayMinutes(service: Service): number | undefined {
  if (service.schedule && service.schedule.length > 0) {
    let headway = headwayCache.get(service.schedule);
    if (headway === undefined) {
      headway = Math.min(...service.schedule.map((p) => p.frequencyMinutes));
      headwayCache.set(service.schedule, headway);
    }
    return headway;
  }
  return service.frequencyMinutes;
}

export interface DwellStop {
  /** Arc-length distance from the pattern path's start, in meters. */
  distMeters: number;
  dwellMs: number;
}

// Stations grouped by their anchor way id, cached by the stations array's
// own reference — safe because the store replaces `system.stations`
// immutably on every mutation (same convention as geo.ts's wayPathCache),
// so a stale index is simply never looked up again. Without this,
// dwellStopsForPattern did a full linear scan of every station in the
// system for every pattern on every animation frame — fine for a few dozen
// hand-drawn stations, but for a real GTFS import (thousands of stations,
// hundreds of patterns) that's hundreds of thousands of comparisons
// *per frame*, continuously, for as long as the tab stays open — confirmed
// live against RTC Southern Nevada's real feed as a sustained freeze, not
// just a one-time slow render.
const stationsByWayCache = new WeakMap<Station[], Map<string, Station[]>>();

function stationsByWay(stations: Station[]): Map<string, Station[]> {
  let index = stationsByWayCache.get(stations);
  if (index) return index;
  index = new Map();
  for (const st of stations) {
    if (!st.anchor) continue;
    const arr = index.get(st.anchor.wayId);
    if (arr) arr.push(st);
    else index.set(st.anchor.wayId, [st]);
  }
  stationsByWayCache.set(stations, index);
  return index;
}

/** Every station actually anchored to one of this pattern's ways (the same
 *  "is this a stop on this branch" test the Route tab's stop-sequence list
 *  uses), positioned by arc-length along the pattern's full resolved path
 *  (via nearestOnPath) rather than by way-index — the more useful measure
 *  here, since the animation walks the path by distance, not by way. */
export function dwellStopsForPattern(system: TransitSystem, pattern: Pattern, path: LngLat[], totalMeters: number): DwellStop[] {
  const byWay = stationsByWay(system.stations);
  const stops: DwellStop[] = [];
  for (const wayId of pattern.wayIds) {
    for (const st of byWay.get(wayId) ?? []) {
      const near = nearestOnPath(path, st.coord);
      if (!near) continue;
      stops.push({ distMeters: near.t * totalMeters, dwellMs: (st.dwellSeconds ?? DEFAULT_DWELL_SECONDS) * 1000 });
    }
  }
  return stops.sort((a, b) => a.distMeters - b.distMeters);
}

export interface Timetable {
  /** Total wall-clock ms to cover the path start→end, stops included. */
  oneWayMs: number;
  stops: DwellStop[];
}

export function buildTimetable(totalMeters: number, stops: DwellStop[]): Timetable {
  const travelMs = (totalMeters / VEHICLE_SPEED_MPS) * 1000;
  const dwellMs = stops.reduce((sum, s) => sum + s.dwellMs, 0);
  return { oneWayMs: travelMs + dwellMs, stops };
}

interface PatternGeometry {
  path: LngLat[];
  meters: number;
  timetable: Timetable;
}

// Keyed by the Pattern object's own reference, but a Pattern only holds
// {id, wayIds, name} — reshaping a way (drag) or moving/editing a station
// replaces system.ways/stations, NOT the Pattern object those ways/stations
// belong to, so keying on Pattern reference alone never invalidates for
// either edit: the cache entry also records which `ways`/`stations` array
// references it was computed against, and a hit is only trusted if BOTH
// still match the current system — otherwise it's recomputed (and the entry
// updated) same as a miss. Without the caching at all, the animation tick
// (every frame) redid the full path-stitching + arc-length + stop-lookup
// work for every pattern; fine at a few dozen hand-drawn patterns, but a
// real GTFS import (hundreds of patterns, each with a long, detailed
// street-following path) turned that into a sustained ~150ms/frame cost — a
// permanently janky tab, not just a slow first render. Confirmed live
// against RTC Southern Nevada's real feed. The ways/stations check means an
// active drag (any drag, not just one touching this pattern's own ways —
// `system.ways`/`stations` get a fresh top-level array reference on every
// store mutation regardless of which way was touched) invalidates every
// pattern's cache for that frame, same cost as no caching at all — but only
// for the duration of the drag gesture; once it ends the cache re-warms and
// stays warm until the next edit. Correct-but-momentarily-uncached during an
// edit beats fast-but-visibly-wrong (a vehicle stuck on a pre-edit alignment)
// for however long the pattern stays on screen afterward.
interface CachedPatternGeometry extends PatternGeometry {
  forWays: Way[];
  forStations: Station[];
}
const patternGeometryCache = new WeakMap<Pattern, CachedPatternGeometry>();

function resolvePatternGeometry(system: TransitSystem, pattern: Pattern): PatternGeometry | null {
  const cached = patternGeometryCache.get(pattern);
  if (cached && cached.forWays === system.ways && cached.forStations === system.stations) return cached;
  const path = patternPath(system.ways, pattern);
  if (path.length < 2) return null;
  const meters = pathLengthMeters(path);
  if (meters === 0) return null;
  const stops = dwellStopsForPattern(system, pattern, path, meters);
  const timetable = buildTimetable(meters, stops);
  const geometry: CachedPatternGeometry = { path, meters, timetable, forWays: system.ways, forStations: system.stations };
  patternGeometryCache.set(pattern, geometry);
  return geometry;
}

/** Where a vehicle sits (meters from the path's start) after `elapsedMs` of
 *  ONE-DIRECTION travel from t=0, walking leg by leg through each stop's
 *  travel segment then its dwell pause. Elapsed time past the last stop
 *  covers the final leg into the path's end. */
export function metersAtElapsed(totalMeters: number, timetable: Timetable, elapsedMs: number): number {
  let clock = 0;
  let lastDist = 0;
  for (const stop of timetable.stops) {
    const legMs = ((stop.distMeters - lastDist) / VEHICLE_SPEED_MPS) * 1000;
    if (elapsedMs < clock + legMs) return lastDist + ((elapsedMs - clock) / 1000) * VEHICLE_SPEED_MPS;
    clock += legMs;
    if (elapsedMs < clock + stop.dwellMs) return stop.distMeters; // dwelling — holds position
    clock += stop.dwellMs;
    lastDist = stop.distMeters;
  }
  return Math.min(totalMeters, lastDist + ((elapsedMs - clock) / 1000) * VEHICLE_SPEED_MPS);
}

/**
 * Ambient delight, not simulation: one or more dots per PATTERN (a branch
 * has its own, same as its own trunk-sharing sibling) running back and
 * forth along its route at a plausible constant speed, pausing to dwell at
 * each station along the way (Station.dwellSeconds, or DEFAULT_DWELL_SECONDS
 * when unset) — the moment this stops being a bare speed/distance triangle
 * wave and starts reading as a train that actually stops for people. How
 * MANY dots is headway-driven — a 5-minute line visibly runs more vehicles
 * than a 30-minute one, so the number typed into the Inspector actually
 * shows up on the map instead of being inert. Bypasses the store entirely —
 * like interactions.ts's rubber-band preview, this is a pure rAF → GeoJSON
 * source push, so it never touches undo history or triggers a feature
 * rebuild.
 */
export function attachVehicleAnimation(map: MLMap, store: EditorStore, gate: VehicleGate): () => void {
  let frame: number;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    const source = map.getSource(SRC_VEHICLES) as GeoJSONSource | undefined;
    if (!source) return;
    const { system } = store.getState();
    const now = performance.now();
    const features = [];
    for (const service of system.services) {
      if (!gate.isVisible(service)) continue;
      const headwayMinutes = effectiveHeadwayMinutes(service);
      for (const pattern of service.patterns) {
        const geometry = resolvePatternGeometry(system, pattern);
        if (!geometry) continue;
        const { path, meters, timetable } = geometry;
        // periodMs is the animation's own out-and-back cycle — floored so
        // even a short, stopless line doesn't blur past instantly.
        const periodMs = Math.max(MIN_PERIOD_MS, 2 * timetable.oneWayMs);
        const roundTripMinutes = (2 * timetable.oneWayMs) / 60000;
        const count = headwayMinutes ? Math.min(MAX_VEHICLES_PER_PATTERN, Math.max(1, Math.floor(roundTripMinutes / headwayMinutes))) : 1;
        for (let i = 0; i < count; i++) {
          const phase = (now / periodMs + i / count) % 1;
          const elapsedMs = phase * periodMs;
          // First half of the cycle: outbound (start→end). Second half:
          // the same timetable mirrored, since dwell points are the same
          // physical stations regardless of direction of travel.
          const outbound = elapsedMs <= timetable.oneWayMs;
          const legElapsed = outbound ? elapsedMs : elapsedMs - timetable.oneWayMs;
          const distFromStart = outbound
            ? metersAtElapsed(meters, timetable, legElapsed)
            : meters - metersAtElapsed(meters, timetable, legElapsed);
          const t = meters === 0 ? 0 : distFromStart / meters;
          features.push({
            type: "Feature" as const,
            properties: { color: service.color },
            geometry: { type: "Point" as const, coordinates: pointAtT(path, t) },
          });
        }
      }
    }
    source.setData({ type: "FeatureCollection", features });
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
