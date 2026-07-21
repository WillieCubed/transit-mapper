import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import type { EditorStore } from "../editor/store";
import { nearestOnPath, pathLengthMeters, patternPath, pointAtT } from "@transitmapper/core/model/geo";
import type { LngLat, Pattern, Service, TransitSystem } from "@transitmapper/core/model/system";
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
function effectiveHeadwayMinutes(service: Service): number | undefined {
  if (service.schedule && service.schedule.length > 0) return Math.min(...service.schedule.map((p) => p.frequencyMinutes));
  return service.frequencyMinutes;
}

export interface DwellStop {
  /** Arc-length distance from the pattern path's start, in meters. */
  distMeters: number;
  dwellMs: number;
}

/** Every station actually anchored to one of this pattern's ways (the same
 *  "is this a stop on this branch" test the Route tab's stop-sequence list
 *  uses), positioned by arc-length along the pattern's full resolved path
 *  (via nearestOnPath) rather than by way-index — the more useful measure
 *  here, since the animation walks the path by distance, not by way. */
export function dwellStopsForPattern(system: TransitSystem, pattern: Pattern, path: LngLat[], totalMeters: number): DwellStop[] {
  const onPattern = system.stations.filter((st) => st.anchor && pattern.wayIds.includes(st.anchor.wayId));
  const stops: DwellStop[] = [];
  for (const st of onPattern) {
    const near = nearestOnPath(path, st.coord);
    if (!near) continue;
    stops.push({ distMeters: near.t * totalMeters, dwellMs: (st.dwellSeconds ?? DEFAULT_DWELL_SECONDS) * 1000 });
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
        const path = patternPath(system.ways, pattern);
        if (path.length < 2) continue;
        const meters = pathLengthMeters(path);
        if (meters === 0) continue;
        const stops = dwellStopsForPattern(system, pattern, path, meters);
        const timetable = buildTimetable(meters, stops);
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
