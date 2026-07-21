// What the camera should frame when a chrome-driven selection happens (the
// Objects list, keyboard nav, Inspector "jump to member" links, Issues) —
// see editor/store.ts's cameraFocusToken and MapCanvas.tsx's effect that
// consumes it. Lives under map/ (not model/geo.ts) because it depends on
// Selection, an editor-state concept the domain model itself knows nothing
// about.
import type { Selection } from "../editor/store";
import { resolveWayPath, serviceWayIds } from "../model/geo";
import type { LngLat, TransitSystem } from "../model/system";

export interface SelectionFocus {
  /** Bounding box to frame the camera on. */
  bounds: [LngLat, LngLat];
  /** True when the Network view renders nothing for this selection at all
   *  (its line/marker/footprint only ever exists in Infrastructure — see
   *  map/layers.ts's buildFeatures) — MapCanvas switches view before
   *  framing it, so the thing you just selected is actually visible. */
  needsInfrastructureView: boolean;
}

function bboxOf(coords: LngLat[]): [LngLat, LngLat] | null {
  if (coords.length === 0) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

function memberCoords(system: TransitSystem, memberIds: string[]): LngLat[] {
  const coords: LngLat[] = [];
  for (const id of memberIds) {
    const st = system.stations.find((s) => s.id === id);
    if (st) coords.push(st.coord);
    const f = system.facilities.find((f) => f.id === id);
    if (f) coords.push(...(Array.isArray(f.geometry[0]) ? (f.geometry as LngLat[]) : [f.geometry as LngLat]));
    const w = system.ways.find((w) => w.id === id);
    if (w) coords.push(...resolveWayPath(w));
  }
  return coords;
}

export function selectionFocus(system: TransitSystem, selection: Selection): SelectionFocus | null {
  if (!selection) return null;

  switch (selection.kind) {
    case "station": {
      const st = system.stations.find((s) => s.id === selection.id);
      if (!st) return null;
      const bounds = bboxOf([st.coord, ...(st.footprint ?? [])]);
      return bounds ? { bounds, needsInfrastructureView: false } : null;
    }
    case "facility": {
      const f = system.facilities.find((f) => f.id === selection.id);
      if (!f) return null;
      const coords = Array.isArray(f.geometry[0]) ? (f.geometry as LngLat[]) : [f.geometry as LngLat];
      const bounds = bboxOf(coords);
      // Facilities only ever render in the Infrastructure view.
      return bounds ? { bounds, needsInfrastructureView: true } : null;
    }
    case "way": {
      const w = system.ways.find((w) => w.id === selection.id);
      if (!w) return null;
      const bounds = bboxOf(resolveWayPath(w));
      if (!bounds) return null;
      // A way's OWN line only ever renders in Infrastructure — but a
      // SERVED way's riding service(s) get the same selection highlight too
      // (see buildFeatures), so Network already shows something there.
      const served = system.services.some((sv) => serviceWayIds(sv).includes(w.id));
      return { bounds, needsInfrastructureView: !served };
    }
    case "service": {
      const svc = system.services.find((sv) => sv.id === selection.id);
      if (!svc) return null;
      const wayIds = serviceWayIds(svc);
      const coords = system.ways.filter((w) => wayIds.includes(w.id)).flatMap((w) => resolveWayPath(w));
      const bounds = bboxOf(coords);
      return bounds ? { bounds, needsInfrastructureView: false } : null;
    }
    case "group": {
      const g = system.groups.find((g) => g.id === selection.id);
      if (!g) return null;
      if (g.footprint) {
        const bounds = bboxOf(g.footprint);
        return bounds ? { bounds, needsInfrastructureView: true } : null;
      }
      // A plain (footprint-less) group has no shape of its own — frame
      // whatever it bundles instead; no view is forced since members can be
      // any kind, and most render fine in Network too.
      const bounds = bboxOf(memberCoords(system, g.memberIds));
      return bounds ? { bounds, needsInfrastructureView: false } : null;
    }
    case "node": {
      const n = system.nodes.find((n) => n.id === selection.id);
      if (!n) return null;
      // A tight box around the junction; footprints only render in
      // Infrastructure at lane-detail zooms.
      const pad = 0.0012;
      return {
        bounds: [[n.coord[0] - pad, n.coord[1] - pad], [n.coord[0] + pad, n.coord[1] + pad]],
        needsInfrastructureView: true,
      };
    }
    default:
      return null;
  }
}
