import type { Map as MLMap, MapMouseEvent, MapGeoJSONFeature, GeoJSONSource } from "maplibre-gl";
import type { EditorStore, MultiSelectItem } from "../editor/store";
import { attachKeyboard } from "../editor/keymap";
import { nearestOpenEndpoint, resolveWayPath, snap, squareFootprint } from "../model/geo";
import { facilityType, mode } from "../model/catalog";
import { anchorOnWay } from "../model/routeGraph";
import type { LngLat } from "../model/system";
import {
  LYR_FACILITIES,
  LYR_HANDLES,
  LYR_JUNCTIONS,
  LYR_LANE_SURFACES,
  LYR_PHYSICAL_HANDLES,
  LYR_SERVICES_UNDERGROUND,
  LYR_SERVICES_SOLID,
  LYR_WAY_ENDPOINTS,
  LYR_WAYS_DASHED,
  LYR_WAYS_SOLID,
  LYR_STATIONS,
  SRC_ENDPOINT_HINT,
  SRC_MARQUEE,
  SRC_PREVIEW,
} from "./layers";

/** A screen-space pixel coordinate (as opposed to LngLat's map-space one). */
interface ScreenPoint {
  x: number;
  y: number;
}

const HIT_PX = 9; // pixel tolerance for hit-testing features under the cursor
const SNAP_PX = 18; // stations/way endpoints within this screen distance snap
const DRAG_PX = 4; // movement beyond this counts as a drag, not a click
const FREEHAND_SAMPLE_PX = 16; // spacing between points sampled while freehand-drawing
const STRAIGHT_TOLERANCE_RAD = (10 * Math.PI) / 180; // ~10°, how close to "straight ahead" counts

// A newly click-placed AREA facility (parking, depot, bus bay…) starts as a
// ~30m square to drag into shape — same affordance as station footprints.
const AREA_FACILITY_HALF_M = 15;

const SERVICE_LAYERS = [LYR_SERVICES_SOLID, LYR_SERVICES_UNDERGROUND];
// Lane surfaces stand in for the fan at lane-detail zooms — they carry the
// same `id` property, so way hit-testing works in both rendering modes.
const WAY_LAYERS = [LYR_WAYS_SOLID, LYR_WAYS_DASHED, LYR_LANE_SURFACES];

// Coalesces a fast-firing callback to at most once per animation frame,
// keeping only the latest call's arguments. Every drag handler below writes
// to the store on "mousemove", which fires far faster than the map can
// actually repaint (each write triggers a full feature rebuild) — without
// this, dragging a point re-rebuilds the entire system once per raw mouse
// event instead of once per painted frame.
function rafThrottle<A extends unknown[]>(fn: (...args: A) => void) {
  let frame: number | null = null;
  let pending: A | null = null;
  const flushNow = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    if (pending) {
      const args = pending;
      pending = null;
      fn(...args);
    }
  };
  return {
    call(...args: A) {
      pending = args;
      if (frame === null) frame = requestAnimationFrame(flushNow);
    },
    // Applies the latest pending call immediately and cancels the scheduled
    // frame — call on mouseup so the drag doesn't end a frame short of the
    // actual release position.
    flush: flushNow,
    // Drops any pending call without invoking it — call on cancel, where the
    // gesture's own revert should win over one more throttled write.
    cancel() {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      pending = null;
    },
  };
}

export interface AttachInteractionsOptions {
  openShortcuts: () => void;
  toggleUi: () => void;
  /** True while the Diagram view is active — a schematic, read-only
   *  projection (see model/diagramLayout.ts). Gated exactly like `readOnly`
   *  below: pan/zoom still work, nothing else does, since every coordinate
   *  on screen is a distorted stand-in for the real one and must never be
   *  fed back into a store mutation. */
  isDiagramMode: () => boolean;
  /** Called with a newly-drawn facility complex's boundary — switches to the
   *  Infrastructure view (where footprints render) and fits the camera to it,
   *  so the result of drawing is immediately visible instead of requiring a
   *  manual view switch + zoom to find it. */
  focusFootprint: (footprint: LngLat[]) => void;
  /** True while the Network view is active — the Way tool there ROUTES along
   *  existing compatible infrastructure when a press lands on it (snap-to-
   *  streets line drawing) instead of laying new geometry. */
  isNetworkMode: () => boolean;
}

/**
 * True when a mousedown's native `detail` marks it as the SECOND press of a
 * double-click (browsers count consecutive same-spot-and-timing clicks in
 * `detail`, resetting to 1 once they're too slow or far apart to count as
 * one gesture). The Way tool's "double-click to finish" gesture is built
 * entirely on ordinary presses: a double-click is just two normal mousedown/
 * mouseup pairs at ~the same spot, followed by a `dblclick` event. Without
 * this check, the Way tool's onMouseDown (see the "way" case below) placed a
 * point for EACH of those two presses — confirmed live: click, click,
 * double-click-to-finish produced a 3-point way whose last two points were
 * bit-identical, not the clean 2-point line it should have been. Skipping
 * the second press here (rather than deduping the point afterward) means
 * only the first one places a point; the dblclick handler right after it
 * still fires and calls finishWay() exactly as before.
 */
export function isDoubleClickFinish(detail: number): boolean {
  return detail >= 2;
}

/**
 * Wire the unified SimCity-style pointer/keyboard interactions to the store.
 * One drawing/editing path serves every way type (rail, road, bike, aerial,
 * water) — the same startDraw/handle-drag/erase family, snap-first — so
 * drawing a road behaves exactly like drawing a rail line.
 */
export function attachInteractions(map: MLMap, store: EditorStore, opts: AttachInteractionsOptions): () => void {
  const canvas = map.getCanvas();
  let spaceHeld = false;
  let suppressClick = false;
  // Sticky for the duration of one draw session (persists across the repeated
  // startDraw calls a click-click-click session makes): true when this
  // session is extending a resumed way from its FIRST point (so new nodes
  // prepend) rather than its last (the default, append).
  let activeExtendAtStart = false;

  // A facility complex's boundary being drawn click-by-click (as opposed to
  // the single-drag rectangle path, which never needs to persist state
  // between events). Null when no click-points draft is in progress.
  let facilityBoundaryDraft: LngLat[] | null = null;

  // Same, for a STATION's land being drawn click-by-click — in the
  // Infrastructure view a station IS its land (everything there is 2D), so
  // the Station tool only ever produces a border, never a bare point.
  let stationLandDraft: LngLat[] | null = null;

  // Every pointer gesture (draw, handle-drag, extend-drag, station-drag,
  // freehand, erase) registers how to abort itself here while it's in
  // progress. Escape (see the capture-phase listener below) calls whichever
  // one is live — this is what makes Escape actually stop the operation the
  // user is mid-way through, not just a committed store-level state.
  let cancelActiveGesture: (() => void) | null = null;

  const lngLatOf = (e: MapMouseEvent): LngLat => [e.lngLat.lng, e.lngLat.lat];

  const featureAt = (e: MapMouseEvent, layers: string[]): MapGeoJSONFeature | undefined => {
    const b: [[number, number], [number, number]] = [
      [e.point.x - HIT_PX, e.point.y - HIT_PX],
      [e.point.x + HIT_PX, e.point.y + HIT_PX],
    ];
    const existing = layers.filter((l) => map.getLayer(l));
    return existing.length ? map.queryRenderedFeatures(b, { layers: existing })[0] : undefined;
  };

  const metersPerPixel = () =>
    (156543.03392 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom();

  // ---- pan (right-drag or space+left-drag) --------------------------------
  // Not part of the cancel system: it never mutates the system, so there's
  // nothing for Escape to undo — releasing the mouse already ends it.
  const startPan = (e: MapMouseEvent, rightButton: boolean) => {
    let last = e.point;
    let moved = false;
    canvas.style.cursor = "grabbing";
    const onMove = (ev: MapMouseEvent) => {
      if (Math.hypot(ev.point.x - last.x, ev.point.y - last.y) > 1) moved = true;
      map.panBy([last.x - ev.point.x, last.y - ev.point.y], { duration: 0 });
      last = ev.point;
    };
    const onUp = (ev: MapMouseEvent) => {
      map.off("mousemove", onMove);
      canvas.style.cursor = cursorFor();
      if (rightButton && !moved) {
        const st = store.getState();
        // Way tool, right-click ON an open endpoint: branch a NEW one-way
        // segment off it — the couplet gesture. Inherits the street's
        // cross-section and name; travel runs the direction you now draw.
        if (st.tool === "way" && !st.readOnly && !opts.isDiagramMode() && !st.activeWayId && !st.routeDraft) {
          const hit = nearestOpenEndpoint(st.system.ways, lngLatOf(ev), SNAP_PX * metersPerPixel());
          if (hit) {
            st.beginOneWayBranch(hit.wayId, hit.end);
            return;
          }
        }
        // Otherwise a plain right-click cancels/commits the current draw.
        if (st.activeWayId) st.finishWay();
        else st.select(null);
      }
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
  };

  // ---- dragging an existing thing -----------------------------------------
  const startHandleDrag = (feature: MapGeoJSONFeature, shift: boolean) => {
    suppressClick = true;
    const wayId = feature.properties.wayId as string;
    const index = feature.properties.index as number;
    const original = wayPointAt(wayId, index);
    let moved = false;
    const throttled = rafThrottle((c: LngLat) => store.getState().moveWayPoint(wayId, index, c));
    const onMove = (ev: MapMouseEvent) => {
      moved = true;
      let c = lngLatOf(ev);
      if (shift) c = constrainToNeighbor(wayId, index, c);
      throttled.call(c);
    };
    const onUp = () => {
      throttled.flush();
      endGesture();
      map.off("mousemove", onMove);
      if (!moved) store.getState().select({ kind: "way", id: wayId });
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
    beginGesture(() => {
      throttled.cancel();
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      if (original) store.getState().moveWayPoint(wayId, index, original); // revert the live edit
    });
  };

  // Ctrl/Cmd-dragging a way's OPEN END (LYR_WAY_ENDPOINTS, not a regular
  // handle) extends it with a new point in the direction you drag — the
  // literal "grab the end and pull" gesture. A PLAIN drag on the same end
  // just reshapes it in place instead (see startHandleDrag, called for
  // endpoints too now) — extending got demoted to a modifier because it was
  // the only way to nudge an end without also growing the way, which is the
  // less common of the two intents. A plain click (no drag) just selects the
  // way, same as a regular handle.
  const startExtendDrag = (feature: MapGeoJSONFeature) => {
    suppressClick = true;
    const wayId = feature.properties.wayId as string;
    const atStart = (feature.properties.index as number) === 0;
    let dragged = false;
    const onMove = (ev: MapMouseEvent) => {
      dragged = true;
      const from = wayEndpoint(wayId, atStart);
      if (from) setPreview([from, lngLatOf(ev)]);
    };
    const onUp = (ev: MapMouseEvent) => {
      endGesture();
      map.off("mousemove", onMove);
      setPreview(null);
      if (dragged) {
        placeEnd(wayId, atStart, resolveEnd(wayId, atStart, lngLatOf(ev), ev.originalEvent.shiftKey));
        // Pulling an end across another same-grade way forms a real junction
        // there, same as finishing a draw does.
        store.getState().formCrossingJunctions(wayId);
      } else {
        store.getState().select({ kind: "way", id: wayId });
      }
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
    beginGesture(() => {
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      setPreview(null); // nothing committed yet — cancel just drops the drag
    });
  };

  const startStationDrag = (id: string) => {
    suppressClick = true;
    const st0 = store.getState().system.stations.find((s) => s.id === id);
    const originalCoord = st0?.coord;
    const originalAnchor = st0?.anchor;
    let moved = false;
    const throttled = rafThrottle((c: LngLat) => placeOrSnapStation(id, c));
    const onMove = (ev: MapMouseEvent) => {
      moved = true;
      throttled.call(lngLatOf(ev));
    };
    const onUp = () => {
      throttled.flush();
      endGesture();
      map.off("mousemove", onMove);
      if (!moved) store.getState().select({ kind: "station", id });
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
    beginGesture(() => {
      throttled.cancel();
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      if (originalCoord) store.getState().moveStation(id, originalCoord, originalAnchor); // revert
    });
  };

  const startFacilityDrag = (id: string) => {
    suppressClick = true;
    const original = store.getState().system.facilities.find((f) => f.id === id)?.geometry;
    let moved = false;
    const throttled = rafThrottle((c: LngLat) => store.getState().moveFacility(id, c));
    const onMove = (ev: MapMouseEvent) => {
      moved = true;
      throttled.call(lngLatOf(ev));
    };
    const onUp = () => {
      throttled.flush();
      endGesture();
      map.off("mousemove", onMove);
      if (!moved) store.getState().select({ kind: "facility", id });
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
    beginGesture(() => {
      throttled.cancel();
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      if (original && !Array.isArray(original[0])) store.getState().moveFacility(id, original as LngLat); // revert
    });
  };

  // The 4 open corners of an axis-aligned (true north/east) rectangle between
  // two opposite corners — the fast-path for a facility complex's boundary.
  // Stored OPEN (no repeated closing point), matching squareFootprint's own
  // convention — layers.ts's closeRing() closes it only at render time.
  function rectCorners(a: LngLat, b: LngLat): LngLat[] {
    return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
  }
  // Same points with the first repeated at the end — for the live preview
  // line only, so the rubber-band reads as a closed loop while drawing.
  function closedForPreview(points: LngLat[]): LngLat[] {
    return points.length > 0 ? [...points, points[0]] : points;
  }

  const cancelFacilityBoundaryDraft = () => {
    facilityBoundaryDraft = null;
    setPreview(null);
  };

  const finishFacilityBoundaryDraft = () => {
    const draft = facilityBoundaryDraft;
    facilityBoundaryDraft = null;
    setPreview(null);
    if (!draft || draft.length < 3) return; // need at least a triangle for a real region
    store.getState().createFacilityComplex(draft);
    opts.focusFootprint(draft);
  };

  // Facility tool, pressing on empty space (not an existing facility marker,
  // not armed for "place inside"): a drag draws an axis-aligned rectangle and
  // creates the complex immediately on release; a plain click instead seeds a
  // click-points boundary (any shape, any angle — closed via double-click/
  // Enter, see onDblClick/keymap) so a region can be drawn to any orientation,
  // not just north-up. Either way, a real boundary is now REQUIRED to create
  // a complex — there's no more silent default-sized invisible square.
  const startFacilityBoundary = (e: MapMouseEvent) => {
    const startCoord = lngLatOf(e);

    if (facilityBoundaryDraft) {
      // Continuing an already-seeded click-points polygon.
      facilityBoundaryDraft.push(startCoord);
      setPreview(closedForPreview(facilityBoundaryDraft));
      suppressClick = true;
      return;
    }

    const startPt = e.point;
    let dragged = false;
    const onMove = (ev: MapMouseEvent) => {
      if (Math.hypot(ev.point.x - startPt.x, ev.point.y - startPt.y) >= DRAG_PX) dragged = true;
      if (dragged) setPreview(closedForPreview(rectCorners(startCoord, lngLatOf(ev))));
    };
    const onUp = (ev: MapMouseEvent) => {
      map.off("mousemove", onMove);
      if (dragged) {
        const corners = rectCorners(startCoord, lngLatOf(ev));
        setPreview(null);
        store.getState().createFacilityComplex(corners);
        opts.focusFootprint(corners);
      } else {
        facilityBoundaryDraft = [startCoord];
        setPreview([startCoord, startCoord]);
      }
      suppressClick = true;
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
  };

  const cancelStationLandDraft = () => {
    stationLandDraft = null;
    setPreview(null);
  };

  const finishStationLandDraft = () => {
    const draft = stationLandDraft;
    stationLandDraft = null;
    setPreview(null);
    if (!draft || draft.length < 3) return; // a border needs at least a triangle
    store.getState().addDrawnStation(draft);
    opts.focusFootprint(draft);
  };

  // Station tool in the INFRASTRUCTURE view: everything there is 2D, so the
  // only thing this gesture produces is LAND — drag a rectangle, or click
  // corner points (any shape) and double-click to close. Release of a drag
  // creates the station immediately: centered, anchored to the way it
  // straddles, border attached, selected. There is deliberately no
  // click-a-point station here; quick stops belong to the Network view.
  const startStationLandDraw = (e: MapMouseEvent, allowClickPoints: boolean) => {
    const startCoord = lngLatOf(e);

    if (stationLandDraft) {
      stationLandDraft.push(startCoord);
      setPreview(closedForPreview(stationLandDraft));
      suppressClick = true;
      return;
    }

    const startPt = e.point;
    let dragged = false;
    const onMove = (ev: MapMouseEvent) => {
      if (Math.hypot(ev.point.x - startPt.x, ev.point.y - startPt.y) >= DRAG_PX) dragged = true;
      if (dragged) setPreview(closedForPreview(rectCorners(startCoord, lngLatOf(ev))));
    };
    const onUp = (ev: MapMouseEvent) => {
      map.off("mousemove", onMove);
      if (dragged) {
        setPreview(null);
        const corners = rectCorners(startCoord, lngLatOf(ev));
        store.getState().addDrawnStation(corners);
        opts.focusFootprint(corners);
        suppressClick = true;
      } else if (allowClickPoints) {
        // Seed a click-points border, same grammar as site boundaries.
        stationLandDraft = [startCoord];
        setPreview([startCoord, startCoord]);
        suppressClick = true;
      }
      // No drag + no click-points (Network view): leave the click alone so
      // onClick places the schematic stop.
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
  };

  // Facility tool, AREA kind selected (building, platform, bus bay, …):
  // DRAG draws the structure's real shape as a rectangle — structures are
  // drawn things, never just points. A plain click still drops a default
  // square (see onClick) to reshape.
  const startStructureDraw = (e: MapMouseEvent) => {
    const startCoord = lngLatOf(e);
    const startPt = e.point;
    let dragged = false;
    const onMove = (ev: MapMouseEvent) => {
      if (Math.hypot(ev.point.x - startPt.x, ev.point.y - startPt.y) >= DRAG_PX) dragged = true;
      if (dragged) setPreview(closedForPreview(rectCorners(startCoord, lngLatOf(ev))));
    };
    const onUp = (ev: MapMouseEvent) => {
      map.off("mousemove", onMove);
      if (dragged) {
        setPreview(null);
        const st = store.getState();
        const corners = rectCorners(startCoord, lngLatOf(ev));
        st.addFacility(st.draftFacilityTypeId, corners);
        opts.focusFootprint(corners);
        suppressClick = true;
      }
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
  };

  // Dragging any handle/station/facility that's part of a 2+ multi-select
  // group moves the WHOLE group together by the cumulative pointer delta —
  // "nudge this whole line" without redrawing it point by point. Applied as
  // incremental per-frame deltas (not absolute positions, unlike a single
  // handle drag) since there's no single "the point" to snap to the cursor.
  const startGroupDrag = (e: MapMouseEvent) => {
    suppressClick = true;
    let last = lngLatOf(e);
    let totalDx = 0;
    let totalDy = 0;
    let pendingDx = 0;
    let pendingDy = 0;
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (pendingDx === 0 && pendingDy === 0) return;
      store.getState().nudgeMultiSelection(pendingDx, pendingDy);
      pendingDx = 0;
      pendingDy = 0;
    };
    const onMove = (ev: MapMouseEvent) => {
      const c = lngLatOf(ev);
      const dx = c[0] - last[0];
      const dy = c[1] - last[1];
      pendingDx += dx;
      pendingDy += dy;
      totalDx += dx;
      totalDy += dy;
      last = c;
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    const onUp = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      flush();
      endGesture();
      map.off("mousemove", onMove);
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
    beginGesture(() => {
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      if (frame !== null) cancelAnimationFrame(frame);
      flush(); // apply whatever hadn't been flushed yet, so `total` matches the store
      if (totalDx !== 0 || totalDy !== 0) store.getState().nudgeMultiSelection(-totalDx, -totalDy); // revert
    });
  };

  // True once 2+ items are multi-selected AND this one is among them — the
  // gate that routes a drag to startGroupDrag instead of the normal
  // single-item gesture. A lone Shift-clicked item still drags normally.
  const isGroupMember = (kind: MultiSelectItem["kind"], id: string): boolean => {
    const items = store.getState().multiSelection;
    return items.length > 1 && items.some((i) => i.kind === kind && i.id === id);
  };

  // Drag a station footprint/platform or a group (facility-complex) footprint
  // vertex to reshape it — the same plain reshape gesture as a way's interior
  // handle, just targeting that owner's own physical geometry instead.
  const startPhysicalHandleDrag = (feature: MapGeoJSONFeature) => {
    suppressClick = true;
    const kind = feature.properties.kind as "footprint" | "platform" | "groupFootprint";
    const index = feature.properties.index as number;

    if (kind === "groupFootprint") {
      const groupId = feature.properties.groupId as string;
      const group = store.getState().system.groups.find((g) => g.id === groupId);
      const original = group?.footprint?.[index];
      const apply = (coord: LngLat) => store.getState().moveGroupFootprintPoint(groupId, index, coord);
      let moved = false;
      const throttled = rafThrottle(apply);
      const onMove = (ev: MapMouseEvent) => {
        moved = true;
        throttled.call(lngLatOf(ev));
      };
      const onUp = () => {
        throttled.flush();
        endGesture();
        map.off("mousemove", onMove);
        if (!moved) store.getState().select({ kind: "group", id: groupId });
      };
      map.on("mousemove", onMove);
      map.once("mouseup", onUp);
      beginGesture(() => {
        throttled.cancel();
        map.off("mousemove", onMove);
        map.off("mouseup", onUp);
        if (original) apply(original);
      });
      return;
    }

    const stationId = feature.properties.stationId as string;
    const platformId = feature.properties.platformId as string | undefined;
    const station = store.getState().system.stations.find((s) => s.id === stationId);
    const original =
      kind === "footprint" ? station?.footprint?.[index] : station?.platforms?.find((p) => p.id === platformId)?.points[index];
    const apply = (coord: LngLat) => {
      if (kind === "footprint") store.getState().moveFootprintPoint(stationId, index, coord);
      else store.getState().movePlatformPoint(stationId, platformId!, index, coord);
    };
    let moved = false;
    const throttled = rafThrottle(apply);
    const onMove = (ev: MapMouseEvent) => {
      moved = true;
      throttled.call(lngLatOf(ev));
    };
    const onUp = () => {
      throttled.flush();
      endGesture();
      map.off("mousemove", onMove);
      if (!moved) store.getState().select({ kind: "station", id: stationId });
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
    beginGesture(() => {
      throttled.cancel();
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      if (original) apply(original);
    });
  };

  const setPreview = (coords: LngLat[] | null) => {
    (map.getSource(SRC_PREVIEW) as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: coords ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [],
    });
  };

  // See onHoverMove: the "clicking here resumes/extends this way" ring,
  // shown at an open endpoint the Way tool is currently hovering near.
  const setEndpointHint = (coord: LngLat | null) => {
    (map.getSource(SRC_ENDPOINT_HINT) as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: coord ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coord } }] : [],
    });
  };

  const setMarquee = (from: ScreenPoint, to: ScreenPoint) => {
    const corners: LngLat[] = [
      [from.x, from.y],
      [to.x, from.y],
      [to.x, to.y],
      [from.x, to.y],
    ].map((p) => {
      const ll = map.unproject(p as [number, number]);
      return [ll.lng, ll.lat];
    });
    (map.getSource(SRC_MARQUEE) as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...corners, corners[0]]] } }],
    });
  };
  const clearMarquee = () => {
    (map.getSource(SRC_MARQUEE) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
  };

  // Shift-drag on truly empty space (nothing else under the cursor) rubber-
  // bands a selection box — everything in it joins multiSelection at once,
  // instead of Shift-clicking one thing at a time. Additive (addMultiSelect,
  // not toggle) to match the rest of this app's Shift = "add" convention.
  // Screen corners are unprojected individually (not just min/max'd in
  // screen space) so this stays correct even if the map ever gains rotation
  // — it doesn't today, but this way nothing here silently assumes it never
  // will.
  const startMarqueeSelect = (e: MapMouseEvent) => {
    suppressClick = true;
    const startPt = e.point;
    let dragged = false;
    const onMove = (ev: MapMouseEvent) => {
      dragged = true;
      setMarquee(startPt, ev.point);
    };
    const onUp = (ev: MapMouseEvent) => {
      map.off("mousemove", onMove);
      clearMarquee();
      if (!dragged) return; // a Shift-click on empty space stays a no-op
      const endPt = ev.point;
      const corners = [startPt, { x: endPt.x, y: startPt.y }, endPt, { x: startPt.x, y: endPt.y }].map((p) => map.unproject([p.x, p.y]));
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const c of corners) {
        if (c.lng < minLng) minLng = c.lng;
        if (c.lng > maxLng) maxLng = c.lng;
        if (c.lat < minLat) minLat = c.lat;
        if (c.lat > maxLat) maxLat = c.lat;
      }
      const inBox = (c: LngLat) => c[0] >= minLng && c[0] <= maxLng && c[1] >= minLat && c[1] <= maxLat;
      // A way is "in the box" if the box touches its rendered path anywhere —
      // not just at a sampled point. Checking only resolveWayPath's own
      // points misses a long straight way whose two endpoints both sit
      // outside the box while the segment between them cuts straight through
      // it, which is exactly the common case for a short marquee over a long
      // line.
      const pathInBox = (path: LngLat[]): boolean => {
        for (let i = 0; i < path.length; i++) {
          if (inBox(path[i])) return true;
          if (i > 0 && segmentIntersectsBox(path[i - 1], path[i], minLng, minLat, maxLng, maxLat)) return true;
        }
        return false;
      };
      const st = store.getState();
      const items: MultiSelectItem[] = [];
      for (const w of st.system.ways) if (pathInBox(resolveWayPath(w))) items.push({ kind: "way", id: w.id });
      for (const s of st.system.stations) if (inBox(s.coord)) items.push({ kind: "station", id: s.id });
      for (const f of st.system.facilities) {
        const coord = Array.isArray(f.geometry[0]) ? (f.geometry as LngLat[])[0] : (f.geometry as LngLat);
        if (inBox(coord)) items.push({ kind: "facility", id: f.id });
      }
      if (items.length > 0) st.addMultiSelection(items);
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
  };

  const wayPointAt = (wayId: string, index: number): LngLat | null => {
    const w = store.getState().system.ways.find((x) => x.id === wayId);
    return w?.points[index] ?? null;
  };

  // The end of the way a new node is added relative to: its last point
  // normally, or its first point when extending a resumed way backwards.
  const wayEndpoint = (wayId: string, atStart: boolean): LngLat | null => {
    const w = store.getState().system.ways.find((x) => x.id === wayId);
    if (!w || w.points.length === 0) return null;
    return atStart ? w.points[0] : w.points[w.points.length - 1];
  };

  // The point just behind the endpoint — the way's current heading, used to
  // let an extension continue straight along it. Null until there are ≥2
  // points (no heading exists yet for a single-point way).
  const wayHeadingAnchor = (wayId: string, atStart: boolean): LngLat | null => {
    const w = store.getState().system.ways.find((x) => x.id === wayId);
    if (!w || w.points.length < 2) return null;
    return atStart ? w.points[1] : w.points[w.points.length - 2];
  };

  // Freehand: sample the drag path into a way (freeform geometry only).
  // Coarse sampling keeps it smooth without dumping hundreds of points.
  const startFreehand = (e: MapMouseEvent) => {
    const startPt = e.point;
    const startCoord = lngLatOf(e);
    let started = false;
    let wayId = "";
    let lastPt = startPt;
    const onMove = (ev: MapMouseEvent) => {
      if (!started) {
        if (Math.hypot(ev.point.x - startPt.x, ev.point.y - startPt.y) < DRAG_PX) return;
        started = true;
        suppressClick = true;
        const st = store.getState();
        wayId = st.beginWay(st.draftWayTypeId, "freeform");
        st.addWayPoint(wayId, startCoord);
        lastPt = startPt;
      }
      if (Math.hypot(ev.point.x - lastPt.x, ev.point.y - lastPt.y) < FREEHAND_SAMPLE_PX) return;
      lastPt = ev.point;
      store.getState().addWayPoint(wayId, lngLatOf(ev));
    };
    const onUp = (ev: MapMouseEvent) => {
      map.off("mousemove", onMove);
      if (started) {
        // Still inside the checkpoint (endGesture is below) so the final
        // point + finishWay coalesce with the sampled points from onMove
        // into the one undo step this whole freehand stroke should be.
        store.getState().addWayPoint(wayId, lngLatOf(ev));
        store.getState().finishWay();
      }
      endGesture();
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
    beginGesture(() => {
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      if (started) store.getState().deleteWay(wayId); // discard whatever was sampled so far
    });
  };

  // Draw like laying track: each click OR drag places ONE node. The first
  // press on empty seeds the start; every release after adds the next node,
  // and the geometry mode (straight/curved) shapes the segments between them.
  // Pressing near an existing, already-finished way's open endpoint RESUMES
  // that same way (same entity, same service) instead of starting an
  // unrelated new one — turnkey, SimCity-style continuation. Pressing near
  // any other point on another way still just snaps onto it, forming a
  // junction between two distinct ways (the correct behavior when they're
  // genuinely different infrastructure).
  const startDraw = (e: MapMouseEvent) => {
    const st = store.getState();

    // Network view, pressing ON existing compatible infrastructure: draw by
    // ROUTING along it (snap-to-streets) instead of laying new geometry.
    // Clicks in empty space fall through to the normal new-way draw below;
    // while a route draft is live, empty-space clicks are ignored (finish
    // with Enter/double-click, back out with Escape).
    if (opts.isNetworkMode() && !st.activeWayId) {
      const allowed = new Set(mode(st.draftModeId).wayTypeIds);
      const candidates = st.system.ways.filter((w) => allowed.has(w.typeId));
      const hit = snap(candidates, lngLatOf(e), SNAP_PX * metersPerPixel());
      if (st.routeDraft) {
        suppressClick = true;
        if (hit) {
          const way = candidates.find((w) => w.id === hit.wayId);
          const anchor = way ? anchorOnWay(way, hit.coord) : null;
          if (anchor) st.extendRouteDraft(anchor);
        }
        return;
      }
      if (hit) {
        const way = candidates.find((w) => w.id === hit.wayId);
        const anchor = way ? anchorOnWay(way, hit.coord) : null;
        if (anchor) {
          suppressClick = true;
          st.startRouteDraft(anchor);
          return;
        }
      }
    }

    if (st.draftGeometry === "freeform") {
      startFreehand(e);
      return;
    }
    const startPt = e.point;
    const startCoord = lngLatOf(e);
    let wayId = st.activeWayId ?? "";
    const seededStart = !wayId; // no active way yet — this press only seeds/grabs
    let extendAtStart = activeExtendAtStart;

    if (!wayId) {
      const resume = nearestOpenEndpoint(st.system.ways, startCoord, SNAP_PX * metersPerPixel(), st.draftWayTypeId);
      if (resume) {
        wayId = resume.wayId;
        extendAtStart = resume.end === "start";
        st.resumeWay(wayId);
        const ridingService = st.system.services.find((sv) => sv.patterns.some((p) => p.wayIds.includes(wayId)));
        st.select(ridingService ? { kind: "service", id: ridingService.id } : { kind: "way", id: wayId });
      } else {
        wayId = st.beginWay(st.draftWayTypeId, st.draftGeometry);
        extendAtStart = false;
        const seed = snap(st.system.ways, startCoord, SNAP_PX * metersPerPixel(), new Set([wayId]), st.draftWayTypeId);
        st.addWayPoint(wayId, seed ? seed.coord : startCoord);
        if (seed) st.joinWayPointToWay(wayId, 0, seed.wayId, seed.coord);
      }
      activeExtendAtStart = extendAtStart;
    }
    const committedWayId = wayId;
    let dragged = false;

    const onMove = (ev: MapMouseEvent) => {
      if (Math.hypot(ev.point.x - startPt.x, ev.point.y - startPt.y) >= DRAG_PX) dragged = true;
      const last = wayEndpoint(committedWayId, extendAtStart);
      if (last) setPreview([last, lngLatOf(ev)]);
    };
    const onUp = (ev: MapMouseEvent) => {
      endGesture();
      map.off("mousemove", onMove);
      // Seed-only click just grabbed the start (fresh or resumed); every
      // other release adds a node.
      if (dragged || !seededStart) {
        const end = resolveEnd(committedWayId, extendAtStart, lngLatOf(ev), ev.originalEvent.shiftKey);
        placeEnd(committedWayId, extendAtStart, end);
      }
      suppressClick = true; // node placement is handled here, not in onClick
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
    beginGesture(() => {
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      setPreview(null);
      // A brand-new way's seed point was already committed before this
      // closure exists — canceling just drops the pending node this press
      // would have added; the way stays active (as if only the seed had
      // happened), and a follow-up Escape backs it out via the store-level
      // finishWay() / activeWayId handling, same as any other stub draw.
    });
  };

  interface ResolvedEnd {
    coord: LngLat;
    /** Set when `coord` landed on another way's path — placeEnd forms a real
     *  junction (a shared control point, not just a coincidental-looking
     *  curve) once the point is placed. */
    snapWayId?: string;
  }

  // Where a new node lands: another way's path wins first (forms a
  // junction); failing that, the way's own current heading if the drag is
  // roughly aligned with it (so extending continues straight instead of
  // introducing an accidental kink); a Shift-held drag instead constrains to
  // 45° from the endpoint; otherwise the raw cursor position.
  const resolveEnd = (wayId: string, atStart: boolean, raw: LngLat, shiftKey: boolean): ResolvedEnd => {
    const endpoint = wayEndpoint(wayId, atStart);
    if (shiftKey && endpoint) return { coord: angleSnap(endpoint, raw) };
    const otherWay = snap(store.getState().system.ways, raw, SNAP_PX * metersPerPixel(), new Set([wayId]), store.getState().draftWayTypeId);
    if (otherWay) return { coord: otherWay.coord, snapWayId: otherWay.wayId };
    const heading = wayHeadingAnchor(wayId, atStart);
    if (endpoint && heading) {
      const straight = continueStraight(endpoint, heading, raw);
      if (straight) return { coord: straight };
    }
    return { coord: raw };
  };

  // A new node appends at the way's end normally, or prepends at its start
  // when extending a resumed way backwards. When the resolved coordinate
  // snapped onto another way, also forms a real junction between them.
  const placeEnd = (wayId: string, atStart: boolean, end: ResolvedEnd): void => {
    const way = store.getState().system.ways.find((w) => w.id === wayId);
    const index = atStart ? 0 : (way?.points.length ?? 0);
    if (atStart) store.getState().insertWayPoint(wayId, 0, end.coord);
    else store.getState().addWayPoint(wayId, end.coord);
    if (end.snapWayId) store.getState().joinWayPointToWay(wayId, index, end.snapWayId, end.coord);
  };

  // Rubber-band preview from the last node to the cursor while drawing; when
  // not yet drawing, a ring over any open endpoint within snap range warns
  // that pressing there resumes/extends THAT way instead of starting a new
  // one (see startDraw's own nearestOpenEndpoint call, which this mirrors).
  const onHoverMove = (ev: MapMouseEvent) => {
    const st = store.getState();
    if (st.tool === "way" && st.activeWayId) {
      const last = wayEndpoint(st.activeWayId, activeExtendAtStart);
      if (last) setPreview([last, lngLatOf(ev)]);
      setEndpointHint(null);
      return;
    }
    setPreview(null);
    if (st.tool === "way" && !st.readOnly) {
      const resume = nearestOpenEndpoint(st.system.ways, lngLatOf(ev), SNAP_PX * metersPerPixel(), st.draftWayTypeId);
      setEndpointHint(resume ? resume.coord : null);
    } else {
      setEndpointHint(null);
    }
  };

  const placeOrSnapStation = (id: string, coord: LngLat) => {
    const ways = store.getState().system.ways;
    const s = snap(ways, coord, SNAP_PX * metersPerPixel());
    if (s) store.getState().moveStation(id, s.coord, { wayId: s.wayId, t: s.t });
    else store.getState().moveStation(id, coord, undefined);
  };

  // Alt-drag erases control points: delete the one under the cursor, then any
  // point dragged over. Handles re-render after each delete, so re-querying
  // gives current indices. Lets you carve a section out of a line. Escape
  // stops erasing further points but doesn't un-erase what's already gone —
  // that's what Ctrl+Z is for (the whole erase-so-far is one undo step, same
  // as any other gesture; see beginGesture/endGesture).
  const startErase = (firstHandle: MapGeoJSONFeature) => {
    suppressClick = true;
    store.getState().deleteWayPoint(firstHandle.properties.wayId as string, firstHandle.properties.index as number);
    const onMove = (ev: MapMouseEvent) => {
      const f = featureAt(ev, [LYR_HANDLES, LYR_WAY_ENDPOINTS]);
      if (f) store.getState().deleteWayPoint(f.properties.wayId as string, f.properties.index as number);
    };
    const onUp = () => {
      endGesture();
      map.off("mousemove", onMove);
    };
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
    beginGesture(() => {
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
    });
  };

  function beginGesture(cancel: () => void) {
    cancelActiveGesture = cancel;
    store.getState().beginHistoryCheckpoint();
  }
  function endGesture() {
    cancelActiveGesture = null;
    store.getState().commitHistoryCheckpoint();
  }

  // ---- mousedown: dispatch by button, modifier, tool, target --------------
  const onMouseDown = (e: MapMouseEvent) => {
    const st = store.getState();
    const oe = e.originalEvent;
    if (oe.button === 2 || (oe.button === 0 && spaceHeld)) {
      startPan(e, oe.button === 2);
      return;
    }
    if (oe.button !== 0) return;

    const endpoint = featureAt(e, [LYR_WAY_ENDPOINTS]);
    const handle = endpoint ?? featureAt(e, [LYR_HANDLES]);
    const physicalHandle = featureAt(e, [LYR_PHYSICAL_HANDLES]);
    const station = featureAt(e, [LYR_STATIONS]);
    const facility = featureAt(e, [LYR_FACILITIES]);

    if (st.readOnly || opts.isDiagramMode()) {
      // Nothing is editable, but empty-space left-drag still pans — matching
      // the grab cursor and right-drag/space-drag, which already bypass this.
      if (!endpoint && !handle && !physicalHandle && !station && !facility) startPan(e, false);
      return;
    }

    // Picking mode (Inspector's "Add existing" flow) takes over the press
    // entirely — no drag/reshape/pan starts while armed, so a slightly
    // sloppy click can't accidentally move the very thing being targeted.
    // onClick (below) resolves the actual pick once the button is released.
    if (st.pickingMemberForGroupId) return;

    if (oe.altKey) {
      if (physicalHandle) {
        const kind = physicalHandle.properties.kind as "footprint" | "platform" | "groupFootprint";
        if (kind === "groupFootprint") {
          st.deleteGroupFootprint(physicalHandle.properties.groupId as string);
        } else {
          const stationId = physicalHandle.properties.stationId as string;
          if (kind === "footprint") st.deleteStationFootprint(stationId);
          else st.deletePlatform(stationId, physicalHandle.properties.platformId as string);
        }
        suppressClick = true;
      } else if (handle) {
        startErase(handle); // Alt-click removes a point; Alt-drag erases a section
      } else if (station) {
        st.deleteStation(station.properties.id as string);
        suppressClick = true;
      } else if (facility) {
        st.deleteFacility(facility.properties.id as string);
        suppressClick = true;
      }
      return;
    }

    // Ctrl/Cmd-drag a way's open END extends it (adds a new point) — the
    // plain drag there now just reshapes the end in place, like any other
    // handle (see the "select" tool's own endpoint case below), so extending
    // needs its own deliberate gesture instead of being the unmodified
    // default. This target was otherwise a no-op under Ctrl/Cmd (nothing to
    // split off an endpoint), which is exactly why it was free to repurpose.
    if ((oe.ctrlKey || oe.metaKey) && endpoint && st.tool === "select") {
      startExtendDrag(endpoint);
      return;
    }

    // Ctrl/Cmd-click an interior handle splits the way there — each half
    // keeps the original's type/grade/class/capacity and can then be edited
    // independently (see store.ts's splitWayAt doc comment). A no-op on an
    // endpoint (nothing to split off) or any other target.
    if (oe.ctrlKey || oe.metaKey) {
      if (handle && !endpoint) {
        st.splitWayAt(handle.properties.wayId as string, handle.properties.index as number);
        suppressClick = true;
      }
      return;
    }

    switch (st.tool) {
      case "select":
        // Shift-click toggles multi-select membership instead of starting any
        // drag — a discrete add/remove, resolved entirely here since every
        // draggable target below sets suppressClick and would otherwise
        // swallow the click before onClick ever saw it.
        if (oe.shiftKey) {
          if (handle) st.toggleMultiSelect({ kind: "way", id: handle.properties.wayId as string });
          else if (facility) st.toggleMultiSelect({ kind: "facility", id: facility.properties.id as string });
          else if (station) st.toggleMultiSelect({ kind: "station", id: station.properties.id as string });
          else {
            // A served way's visible line is drawn as its SERVICE feature, not
            // its (often-hidden) bare WAY_LAYERS one — try both, same as a
            // plain click's own hit-testing does.
            const wayHit = featureAt(e, WAY_LAYERS);
            const serviceHit = wayHit ? undefined : featureAt(e, SERVICE_LAYERS);
            const wayId = wayHit ? (wayHit.properties.id as string) : (serviceHit?.properties.wayId as string | undefined);
            if (wayId) st.toggleMultiSelect({ kind: "way", id: wayId });
            // Truly empty space under the cursor — rubber-band select
            // instead of toggling a single (nonexistent) target.
            else startMarqueeSelect(e);
          }
          suppressClick = true;
          break;
        }
        if (physicalHandle) startPhysicalHandleDrag(physicalHandle);
        // `handle` is `endpoint ?? …` — this also covers an endpoint whose
        // way is part of a multi-selection, so nudging one end drags the
        // whole group, same as any other member handle.
        else if (handle && isGroupMember("way", handle.properties.wayId as string)) startGroupDrag(e);
        // Plain drag on a way's open END reshapes it in place (moves that
        // one point, same gesture as an interior handle) — hold Ctrl/Cmd
        // instead to extend the way with a new point (handled above, before
        // the tool switch, since it needs to run even though this case does
        // too little to reach otherwise).
        else if (endpoint) startHandleDrag(endpoint, oe.shiftKey);
        else if (handle) startHandleDrag(handle, oe.shiftKey);
        else if (facility && isGroupMember("facility", facility.properties.id as string)) startGroupDrag(e);
        else if (facility) startFacilityDrag(facility.properties.id as string);
        else if (station && isGroupMember("station", station.properties.id as string)) startGroupDrag(e);
        else if (station) startStationDrag(station.properties.id as string);
        else {
          // Grabbing a multi-selected way's LINE anywhere (not just a control-
          // point handle) still moves the whole group — the natural "grab and
          // drag this line" gesture, not one gated on hitting an exact vertex.
          const lineHit = featureAt(e, [...WAY_LAYERS, ...SERVICE_LAYERS]);
          const lineWayId = lineHit && ((lineHit.properties.wayId as string | undefined) ?? (lineHit.properties.id as string | undefined));
          if (lineWayId && isGroupMember("way", lineWayId)) startGroupDrag(e);
          // Empty space: left-drag pans too (not just right-drag/space+drag) —
          // the canvas shows a grab cursor there by default (see cursorFor),
          // so left-click must actually honor it or the cursor is a lie. A
          // plain click (no movement) still falls through to onClick's normal
          // select/deselect handling below, since startPan doesn't suppress it.
          else startPan(e, false);
        }
        break;
      case "way":
        // In the Way tool a press always places the next node (even starting
        // on a handle) — reshaping handles is a Select-tool action — EXCEPT
        // the second press of a double-click, which exists only to trigger
        // the dblclick->finishWay that follows it. See isDoubleClickFinish.
        if (!isDoubleClickFinish(oe.detail)) startDraw(e);
        break;
      case "station":
        if (station) startStationDrag(station.properties.id as string);
        // Infrastructure = 2D: the tool draws LAND (drag rect or click
        // points). Network keeps its schematic click-a-stop via onClick;
        // drag still draws land there too.
        else startStationLandDraw(e, !opts.isNetworkMode());
        break;
      case "facility":
        if (facility) startFacilityDrag(facility.properties.id as string);
        else if (!st.placingFacilityForGroupId) {
          // Complex mode drafts the site boundary; AREA kinds drag-draw the
          // structure's real shape; point kinds click-place via onClick.
          if (st.draftFacilityComplexMode) startFacilityBoundary(e);
          else if (facilityType(st.draftFacilityTypeId).geometryKind === "area") startStructureDraw(e);
        }
        break;
    }
  };

  // ---- click: discrete add / select (fires only when not dragged) ---------
  const onClick = (e: MapMouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const st = store.getState();
    if (st.readOnly || opts.isDiagramMode() || spaceHeld) return;
    const coord = lngLatOf(e);

    // Picking mode: the next station/facility clicked joins the armed group;
    // clicking empty space does nothing (only Escape/the Inspector cancels),
    // so a mis-click can't silently drop the user out of the flow.
    if (st.pickingMemberForGroupId) {
      const hit = featureAt(e, [LYR_STATIONS, LYR_FACILITIES]);
      if (hit) {
        const memberId = hit.properties.id as string;
        st.addGroupMember(st.pickingMemberForGroupId, memberId);
        st.cancelPickingMember();
      }
      return;
    }

    switch (st.tool) {
      case "station": {
        // Point stops are a NETWORK-view (schematic) concept. In the
        // Infrastructure view everything is 2D — the mousedown gesture owns
        // station creation there (land only), so a bare click does nothing.
        if (!opts.isNetworkMode()) break;
        const s = snap(st.system.ways, coord, SNAP_PX * metersPerPixel());
        if (s) st.addStation(s.coord, { wayId: s.wayId, t: s.t });
        else st.addStation(coord);
        break;
      }
      case "facility": {
        // Armed "place inside" (from a complex's Inspector) wins; complex
        // mode's boundary drafting lives in onMouseDown; otherwise a click
        // simply PLACES the selected facility type right there — point kinds
        // as a marker, area kinds as a default square to reshape.
        if (st.placingFacilityForGroupId) {
          st.placeFacilityInGroup(st.placingFacilityForGroupId, st.draftFacilityTypeId, coord);
        } else if (!st.draftFacilityComplexMode) {
          const kind = facilityType(st.draftFacilityTypeId);
          st.addFacility(st.draftFacilityTypeId, kind.geometryKind === "area" ? squareFootprint(coord, AREA_FACILITY_HALF_M) : coord);
        }
        break;
      }
      case "select": {
        // Stations/handles/lines outrank the junction footprint under them.
        const hit =
          featureAt(e, [LYR_STATIONS, LYR_FACILITIES, LYR_HANDLES, ...SERVICE_LAYERS, ...WAY_LAYERS]) ??
          featureAt(e, [LYR_JUNCTIONS]);
        if (!hit) {
          st.select(null);
        } else if (hit.layer.id === LYR_JUNCTIONS) {
          st.select({ kind: "node", id: hit.properties.nodeId as string });
        } else if (hit.layer.id === LYR_STATIONS) {
          st.select({ kind: "station", id: hit.properties.id as string });
        } else if (hit.layer.id === LYR_FACILITIES) {
          st.select({ kind: "facility", id: hit.properties.id as string });
        } else if (hit.layer.id === LYR_HANDLES) {
          st.select({ kind: "way", id: hit.properties.wayId as string });
        } else if (WAY_LAYERS.includes(hit.layer.id)) {
          st.select({ kind: "way", id: hit.properties.id as string });
        } else {
          // A service line. Click to select the service; click it again to add a
          // control point to the way it runs on.
          const serviceId = hit.properties.serviceId as string;
          const wayId = hit.properties.wayId as string;
          if (st.selection?.kind === "service" && st.selection.id === serviceId) {
            const way = st.system.ways.find((w) => w.id === wayId);
            if (way) st.insertWayPoint(wayId, insertIndexOnPolygon(way.points, e.point), coord);
          } else {
            st.select({ kind: "service", id: serviceId });
          }
        }
        break;
      }
    }
  };

  const onDblClick = (e: MapMouseEvent) => {
    const st = store.getState();
    if (st.routeDraft) {
      e.preventDefault();
      st.commitRouteDraft();
      return;
    }
    if (st.activeWayId) {
      e.preventDefault();
      st.finishWay();
    } else if (facilityBoundaryDraft) {
      e.preventDefault();
      finishFacilityBoundaryDraft();
    } else if (stationLandDraft) {
      e.preventDefault();
      finishStationLandDraft();
    }
  };

  const onContextMenu = (ev: Event) => ev.preventDefault();

  // Escape must stop whatever pointer gesture is actually in flight — a
  // committed store state like activeWayId can't see a live drag, only the
  // gesture that started it can. Capture phase guarantees this fires before
  // the keymap's own (bubble-phase) Escape handler, so a canceled gesture
  // consumes the keypress instead of also "backing out" a level.
  const onEscapeCapture = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (cancelActiveGesture) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const cancel = cancelActiveGesture;
      cancelActiveGesture = null;
      cancel(); // reverts the live edit — its own set() calls stay coalesced
                // since the checkpoint is still open until the next line
      store.getState().commitHistoryCheckpoint(); // no-op if the revert left system unchanged
      return;
    }
    if (facilityBoundaryDraft) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelFacilityBoundaryDraft();
    }
    if (stationLandDraft) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelStationLandDraft();
    }
  };
  window.addEventListener("keydown", onEscapeCapture, true);

  // All discrete keyboard commands live in the declarative keymap. Here we only
  // supply it the context and let it drive the space-hold pan modifier.
  const detachKeyboard = attachKeyboard({
    map,
    editor: store,
    openShortcuts: opts.openShortcuts,
    toggleUi: opts.toggleUi,
    setPanKeyHeld: (held) => {
      spaceHeld = held;
      canvas.style.cursor = held ? "grab" : cursorFor();
    },
  });

  function cursorFor(): string {
    if (spaceHeld) return "grab";
    // Diagram mode ignores the active tool entirely (nothing is drawable
    // there) — always the plain pan affordance, never a crosshair promising
    // a draw that won't happen.
    if (opts.isDiagramMode()) return "grab";
    const tool = store.getState().tool;
    if (tool === "way" || tool === "station" || tool === "facility") return "crosshair";
    // Select tool, empty space: left-drag pans here too (see onMouseDown), so
    // the grab cursor MapLibre already shows by default is actually honest —
    // explicit rather than relying on an inline-style reset falling through
    // to MapLibre's own CSS, which is what caused the mismatch in the first
    // place (this "" would inherit the container's cursor:grab regardless).
    if (tool === "select") return "grab";
    return "default";
  }

  // Cursor must always match what a press would actually do right now — never
  // show an affordance the current tool/readOnly state can't back up.
  const draggable = () => store.getState().tool === "select" && !store.getState().readOnly && !opts.isDiagramMode();
  // Stations/handles/facilities: click-drag to select/reshape/reposition —
  // "grab" (not "pointer", which reads as "click this link/button") matches
  // the same drag-affordance convention as the map's own pan cursor. Which
  // of these you're over is disambiguated by SHAPE, not cursor: a station is
  // always a circle, a facility is always its own catalog pictogram, and a
  // reshape handle is always a plain solid square (see map/layers.ts) — none
  // of them can ever be mistaken for one another.
  // Only the Select tool's own drag affordance depends on draggable() (grab
  // to reshape/move) — every drawing tool (way/station/facility) still acts
  // on a click regardless of what's under the cursor, so its own crosshair
  // from cursorFor() stays accurate there and must NOT be overridden to
  // "default". The one real gap this closes: read-only + Select tool used
  // to keep showing "grab" over a station even though a press there did
  // nothing (dragging disabled, and it's not empty space either, so the pan
  // fallback doesn't kick in) — that's the only case that becomes "default".
  // A way's open end shares this cursor too — a plain drag there reshapes
  // it in place now, same verb as any other handle. Extending is the
  // Ctrl/Cmd-modified action (see startExtendDrag) and, like this app's
  // other modifier gestures (Alt-erase, Ctrl-split), doesn't get its own
  // hover cursor — only documented in the Inspector's hint text.
  const onEnterHandle = () => {
    if (draggable()) canvas.style.cursor = "grab";
    else if (store.getState().tool === "select") canvas.style.cursor = "default";
  };
  const onLeaveFeature = () => {
    canvas.style.cursor = cursorFor();
  };

  map.on("mousedown", onMouseDown);
  map.on("mousemove", onHoverMove);
  map.on("click", onClick);
  map.on("dblclick", onDblClick);
  map.on("mouseenter", LYR_STATIONS, onEnterHandle);
  map.on("mouseleave", LYR_STATIONS, onLeaveFeature);
  map.on("mouseenter", LYR_HANDLES, onEnterHandle);
  map.on("mouseleave", LYR_HANDLES, onLeaveFeature);
  map.on("mouseenter", LYR_WAY_ENDPOINTS, onEnterHandle);
  map.on("mouseleave", LYR_WAY_ENDPOINTS, onLeaveFeature);
  map.on("mouseenter", LYR_FACILITIES, onEnterHandle);
  map.on("mouseleave", LYR_FACILITIES, onLeaveFeature);
  map.on("mouseenter", LYR_PHYSICAL_HANDLES, onEnterHandle);
  map.on("mouseleave", LYR_PHYSICAL_HANDLES, onLeaveFeature);
  canvas.addEventListener("contextmenu", onContextMenu);

  let lastTool = store.getState().tool;
  let lastActive = store.getState().activeWayId;
  const unsubTool = store.subscribe((s) => {
    if (s.tool !== lastTool) {
      lastTool = s.tool;
      canvas.style.cursor = cursorFor();
      if (s.tool !== "way") {
        setPreview(null);
        setEndpointHint(null);
      }
      if (s.tool !== "facility") facilityBoundaryDraft = null;
    }
    if (s.activeWayId !== lastActive) {
      lastActive = s.activeWayId;
      if (!s.activeWayId) {
        setPreview(null); // clear rubber-band when a draw ends
        activeExtendAtStart = false;
      }
    }
  });
  canvas.style.cursor = cursorFor();

  return () => {
    map.off("mousedown", onMouseDown);
    map.off("mousemove", onHoverMove);
    map.off("click", onClick);
    map.off("dblclick", onDblClick);
    map.off("mouseenter", LYR_STATIONS, onEnterHandle);
    map.off("mouseleave", LYR_STATIONS, onLeaveFeature);
    map.off("mouseenter", LYR_HANDLES, onEnterHandle);
    map.off("mouseleave", LYR_HANDLES, onLeaveFeature);
    map.off("mouseenter", LYR_WAY_ENDPOINTS, onEnterHandle);
    map.off("mouseleave", LYR_WAY_ENDPOINTS, onLeaveFeature);
    map.off("mouseenter", LYR_FACILITIES, onEnterHandle);
    map.off("mouseleave", LYR_FACILITIES, onLeaveFeature);
    map.off("mouseenter", LYR_PHYSICAL_HANDLES, onEnterHandle);
    map.off("mouseleave", LYR_PHYSICAL_HANDLES, onLeaveFeature);
    canvas.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onEscapeCapture, true);
    detachKeyboard();
    unsubTool();
  };

  // Constrain a dragged control point so its segment to a neighbor snaps to 45°.
  function constrainToNeighbor(wayId: string, index: number, coord: LngLat): LngLat {
    const way = store.getState().system.ways.find((w) => w.id === wayId);
    if (!way) return coord;
    const anchor = way.points[index - 1] ?? way.points[index + 1];
    return anchor ? angleSnap(anchor, coord) : coord;
  }

  // Index at which to insert a new control point given a screen click, so the
  // new vertex lands on the segment of the control polygon nearest the cursor.
  function insertIndexOnPolygon(points: LngLat[], pt: ScreenPoint): number {
    if (points.length < 2) return points.length;
    const px = points.map((p) => map.project(p as [number, number]));
    let best = points.length;
    let bestD = Infinity;
    for (let i = 0; i < px.length - 1; i++) {
      const d = distToSegment(pt, px[i], px[i + 1]);
      if (d < bestD) {
        bestD = d;
        best = i + 1;
      }
    }
    return best;
  }
}

// True if segment a→b crosses (or touches) the given axis-aligned box —
// used by startMarqueeSelect so a way is caught by the marquee even when it
// merely passes through the box without either endpoint or any resampled
// point landing inside it (a long straight way through a small box).
function segmentIntersectsBox(a: LngLat, b: LngLat, minX: number, minY: number, maxX: number, maxY: number): boolean {
  if (Math.max(a[0], b[0]) < minX || Math.min(a[0], b[0]) > maxX) return false;
  if (Math.max(a[1], b[1]) < minY || Math.min(a[1], b[1]) > maxY) return false;
  const edges: [LngLat, LngLat][] = [
    [[minX, minY], [maxX, minY]],
    [[maxX, minY], [maxX, maxY]],
    [[maxX, maxY], [minX, maxY]],
    [[minX, maxY], [minX, minY]],
  ];
  return edges.some(([p3, p4]) => segmentsIntersect(a, b, p3, p4));
}

function segmentsIntersect(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): boolean {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-15) return false; // parallel or collinear
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function distToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Snap the vector from→to to the nearest 45° increment (rough, city-scale). */
function angleSnap(from: LngLat, to: LngLat): LngLat {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  const len = Math.hypot(dx, dy);
  return [from[0] + Math.cos(ang) * len, from[1] + Math.sin(ang) * len];
}

/**
 * Project `raw` onto the ray starting at `endpoint` heading away from
 * `behind` (the way's existing direction of travel) — but only when `raw`
 * already lands close to that heading (within STRAIGHT_TOLERANCE_RAD).
 * Outside that tolerance, returns null so the caller falls back to the raw
 * cursor position: this is a snap, not a hard constraint, so a deliberate
 * turn is never fought.
 */
function continueStraight(endpoint: LngLat, behind: LngLat, raw: LngLat): LngLat | null {
  const dx = endpoint[0] - behind[0];
  const dy = endpoint[1] - behind[1];
  const dirLen = Math.hypot(dx, dy);
  if (dirLen < 1e-12) return null;
  const nx = dx / dirLen;
  const ny = dy / dirLen;
  const rx = raw[0] - endpoint[0];
  const ry = raw[1] - endpoint[1];
  const rawLen = Math.hypot(rx, ry);
  if (rawLen < 1e-9) return null;
  const cos = Math.max(-1, Math.min(1, (rx * nx + ry * ny) / rawLen));
  if (Math.acos(cos) > STRAIGHT_TOLERANCE_RAD) return null;
  const projected = rx * nx + ry * ny;
  if (projected <= 0) return null; // only continue forward, never fold back over itself
  return [endpoint[0] + nx * projected, endpoint[1] + ny * projected];
}
