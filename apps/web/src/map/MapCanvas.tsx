import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEditorStore } from "../editor/EditorProvider";
import { useUi } from "../ui/UiProvider";
import { useView } from "../ui/ViewProvider";
import { BASEMAP_STYLE } from "./basemap";
import { attachInteractions } from "./interactions";
import { computeDiagramSystem } from "@transitmapper/core/model/diagramLayout";
import { serviceWayIds, systemBounds } from "@transitmapper/core/model/geo";
import { routePath } from "@transitmapper/core/model/routeGraph";
import { selectionFocus } from "./selectionFocus";
import {
  buildFeatures,
  LANE_DETAIL_MIN_ZOOM,
  LAYER_SPECS,
  LYR_LANDMARKS,
  LYR_LANDMARK_LABELS,
  registerMapIcons,
  SRC_ENDPOINT_HINT,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_CONNECTORS,
  SRC_JUNCTIONS,
  SRC_LANDMARKS,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_LANES,
  SRC_MARQUEE,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_PREVIEW,
  SRC_SERVICES,
  SRC_VEHICLES,
  SRC_WAYS,
  SRC_WAY_LABELS,
  SRC_STATIONS,
  type ViewOptions,
} from "./layers";
import { landmarksFeatureCollection } from "./landmarks";
import { getMap, setMap } from "./mapRef";
import { attachVehicleAnimation } from "../sim/vehicles";
import type { Map as MLMap } from "maplibre-gl";

const OWN_LAYER_IDS = new Set(LAYER_SPECS.map((l) => l.id));

/** Diagram mode is a schematic with no real geography, so the street basemap
 *  underneath would be actively misleading — hide every style layer that
 *  isn't one of ours (leaving its background/land color as a plain backdrop)
 *  rather than tearing down and reloading the whole map style. */
function setBasemapVisible(map: MLMap, visible: boolean): void {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (OWN_LAYER_IDS.has(layer.id)) continue;
    map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
  }
}

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const store = useEditorStore();
  const { openShortcuts, toggleUi } = useUi();
  const { viewMode, setViewMode, visibleModes, visibleWayTypes, showLandmarks } = useView();

  // The map-setup effect below runs once (mount-only); it reads the latest
  // view options from this ref rather than closing over React state, so a
  // separate effect can push view-only changes (Network⇄Infrastructure, a
  // filter toggle) without tearing down and recreating the whole map.
  const viewRef = useRef<ViewOptions>({ viewMode, visibleModes, visibleWayTypes });
  const pushDataRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const prevMode = viewRef.current.viewMode;
    viewRef.current = { viewMode, visibleModes, visibleWayTypes };
    pushDataRef.current?.();
    const map = getMap();
    // NOT map.isStyleLoaded() — that reports false while tiles for the
    // current viewport are still streaming in, which is unrelated to
    // whether the style's layers exist yet (they do, from the first "load").
    // Gating on it here made this a coin flip: it silently skipped the
    // basemap toggle whenever a transition happened to land mid-tile-load,
    // with no retry since nothing re-fires this effect on its own.
    if (!map || !map.getStyle()) return;
    if (viewMode === "diagram" || prevMode === "diagram") setBasemapVisible(map, viewMode !== "diagram");
    // Landmarks are real-world reference points; Diagram's schematic
    // coordinates aren't real geography, so they'd land somewhere meaningless.
    const landmarksVisible = showLandmarks && viewMode !== "diagram";
    if (map.getLayer(LYR_LANDMARKS)) {
      map.setLayoutProperty(LYR_LANDMARKS, "visibility", landmarksVisible ? "visible" : "none");
      map.setLayoutProperty(LYR_LANDMARK_LABELS, "visibility", landmarksVisible ? "visible" : "none");
    }
    // Entering Diagram reframes the camera to the schematic layout's own
    // extent — its coordinates are a distorted projection of the real ones,
    // so whatever framing suited Network/Infrastructure may no longer show
    // the whole thing (or may be framing empty space).
    if (viewMode === "diagram" && prevMode !== "diagram") {
      const bounds = systemBounds(computeDiagramSystem(store.getState().system));
      if (bounds) map.fitBounds(bounds, { padding: 60, duration: 500 });
    }
    // A bare setLayoutProperty/setData pair doesn't reliably self-schedule a
    // repaint outside MapLibre's normal interaction-driven render loop (seen
    // live: toggling the basemap off left the canvas blank — visually stuck
    // on the last painted frame — until the user panned or zoomed). One
    // explicit nudge here guarantees the new layer/source state actually
    // reaches the screen the moment a view mode changes, not just on the
    // next incidental interaction.
    map.triggerRepaint();
  }, [viewMode, visibleModes, visibleWayTypes, showLandmarks, store]);

  useEffect(() => {
    if (!containerRef.current) return;
    const initial = store.getState().system;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: initial.viewport.center,
      zoom: initial.viewport.zoom,
      preserveDrawingBuffer: true, // needed for PNG export
      dragPan: false, // SimCity-style: the map pans on right-drag / space-drag only
      dragRotate: false, // right-drag pans, never rotates
      doubleClickZoom: false, // double-click finishes a line instead
      keyboard: false, // we own the keymap (see keymap.ts)
      boxZoom: false, // Shift+drag is our marquee-select gesture, not MapLibre's native box-zoom
      attributionControl: false, // replaced below with a compact (collapsed-to-an-"i") one
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    setMap(map);

    let detachInteractions: (() => void) | null = null;
    let detachVehicles: (() => void) | null = null;
    let lastSystemId = initial.id;
    const emptyFC = { type: "FeatureCollection" as const, features: [] };

    const handleWayIds = (): string[] => {
      // Diagram mode is view-only — a reshape handle there would promise a
      // drag that attachInteractions refuses to honor (see isDiagramMode).
      if (viewRef.current.viewMode === "diagram") return [];
      const s = store.getState();
      if (s.activeWayId) return [s.activeWayId];
      if (s.selection?.kind === "way") return [s.selection.id];
      if (s.selection?.kind === "service") {
        const svc = s.system.services.find((sv) => sv.id === s.selection!.id);
        return svc ? serviceWayIds(svc) : [];
      }
      return [];
    };

    // The station whose footprint/platform vertices are editable right now —
    // simply whichever station is selected (footprints/platforms are a
    // station's own physical detail, not a separate selection target).
    const physicalHandleStationId = (): string | null => {
      const s = store.getState();
      return s.selection?.kind === "station" ? s.selection.id : null;
    };

    // Same, for a group's (facility-complex's) own footprint — whichever
    // group is selected.
    const physicalHandleGroupId = (): string | null => {
      const s = store.getState();
      return s.selection?.kind === "group" ? s.selection.id : null;
    };

    // Lane-detail LOD: real per-lane street geometry only derives/renders at
    // high zoom in the Infrastructure view, scoped to the current viewport
    // (with margin). Anything else keeps the cheap fan rendering.
    const laneDetailNow = () => viewRef.current.viewMode === "infrastructure" && map.getZoom() >= LANE_DETAIL_MIN_ZOOM;

    const ALL_SOURCES = [
      SRC_WAYS, SRC_SERVICES, SRC_STATIONS, SRC_HANDLES, SRC_PREVIEW,
      SRC_ENDPOINT_HINT, SRC_MARQUEE, SRC_FOOTPRINTS, SRC_PLATFORMS,
      SRC_FACILITIES, SRC_PHYSICAL_HANDLES, SRC_VEHICLES, SRC_LANES,
      SRC_LANE_MARKINGS, SRC_LANE_ARROWS, SRC_JUNCTIONS, SRC_CONNECTORS,
      SRC_WAY_LABELS,
    ];

    // Idempotent overlay setup. Sources/layers are normally added once on
    // "load", but an HMR pass or style hiccup landing mid-setup can leave
    // SOME layers silently missing until a hard reload (seen live: addLayer
    // "source not found" errors, then footprint layers gone — "station
    // boundaries only visible while drawing", because only the drag preview
    // still rendered). This heals that: anything missing is re-added, with
    // beforeId anchoring so a healed layer returns to its correct place in
    // the paint order instead of landing on top.
    const ensureOverlay = (): boolean => {
      if (!map.getStyle()) return false;
      for (const src of ALL_SOURCES) {
        if (!map.getSource(src)) map.addSource(src, { type: "geojson", data: emptyFC });
      }
      // Static context, not system-derived — set once here rather than on
      // every pushData() like the sources above.
      if (!map.getSource(SRC_LANDMARKS)) map.addSource(SRC_LANDMARKS, { type: "geojson", data: landmarksFeatureCollection() });
      for (let i = 0; i < LAYER_SPECS.length; i++) {
        const spec = LAYER_SPECS[i];
        if (map.getLayer(spec.id)) continue;
        const anchor = LAYER_SPECS.slice(i + 1).find((later) => map.getLayer(later.id));
        map.addLayer(spec, anchor?.id);
      }
      return true;
    };

    const pushData = () => {
      // Self-heal before pushing — a missing source would otherwise silently
      // swallow this update (every setData below is optional-chained).
      if (!map.getSource(SRC_WAYS) || !map.getLayer(LAYER_SPECS[0].id)) {
        if (!ensureOverlay()) return;
      }
      const { system, selection } = store.getState();
      const renderSystem = viewRef.current.viewMode === "diagram" ? computeDiagramSystem(system) : system;
      const laneDetail = laneDetailNow();
      const b = map.getBounds();
      const view: ViewOptions = {
        ...viewRef.current,
        laneDetail,
        bounds: laneDetail ? [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]] : undefined,
      };
      const fc = buildFeatures(renderSystem, selection, handleWayIds(), view, physicalHandleStationId(), physicalHandleGroupId());
      (map.getSource(SRC_LANES) as GeoJSONSource | undefined)?.setData(fc.lanes);
      (map.getSource(SRC_LANE_MARKINGS) as GeoJSONSource | undefined)?.setData(fc.laneMarkings);
      (map.getSource(SRC_LANE_ARROWS) as GeoJSONSource | undefined)?.setData(fc.laneArrows);
      (map.getSource(SRC_JUNCTIONS) as GeoJSONSource | undefined)?.setData(fc.junctions);
      (map.getSource(SRC_CONNECTORS) as GeoJSONSource | undefined)?.setData(fc.connectors);
      (map.getSource(SRC_WAY_LABELS) as GeoJSONSource | undefined)?.setData(fc.wayLabels);
      (map.getSource(SRC_WAYS) as GeoJSONSource | undefined)?.setData(fc.ways);
      (map.getSource(SRC_SERVICES) as GeoJSONSource | undefined)?.setData(fc.services);
      (map.getSource(SRC_STATIONS) as GeoJSONSource | undefined)?.setData(fc.stations);
      (map.getSource(SRC_HANDLES) as GeoJSONSource | undefined)?.setData(fc.handles);
      (map.getSource(SRC_FOOTPRINTS) as GeoJSONSource | undefined)?.setData(fc.footprints);
      (map.getSource(SRC_PLATFORMS) as GeoJSONSource | undefined)?.setData(fc.platforms);
      (map.getSource(SRC_FACILITIES) as GeoJSONSource | undefined)?.setData(fc.facilities);
      (map.getSource(SRC_PHYSICAL_HANDLES) as GeoJSONSource | undefined)?.setData(fc.physicalHandles);
    };
    pushDataRef.current = pushData;

    // Coalesce rebuilds to at most one per animation frame. A bulk import
    // (streamRtcGtfsBatches) merges many batches in quick succession — each
    // is its own store commit, and pushData's buildFeatures()+13x setData()
    // is real main-thread work on a large system, so calling it once per
    // commit froze the tab between batches instead of yielding smoothly.
    // Reading store.getState() fresh inside pushData means a coalesced call
    // still reflects the LATEST merged state, not a stale snapshot.
    let pushDataRaf: number | null = null;
    const schedulePushData = () => {
      if (pushDataRaf !== null) return;
      pushDataRaf = requestAnimationFrame(() => {
        pushDataRaf = null;
        pushData();
      });
    };

    map.on("load", () => {
      // MapLibre's compact attribution starts expanded once (its own default
      // "first impression" behavior, applied asynchronously as style/source
      // data loads — too late to undo right after addControl) and only
      // collapses to the bare "i" after the map is interacted with. Collapse
      // it immediately instead so it never shows the full text unprompted.
      map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      registerMapIcons(map);
      ensureOverlay();
      pushData();
      detachInteractions = attachInteractions(map, store, {
        openShortcuts,
        toggleUi,
        isDiagramMode: () => viewRef.current.viewMode === "diagram",
        isNetworkMode: () => viewRef.current.viewMode === "network",
        // Footprints only render in the Infrastructure view — switch there
        // and zoom in, or a newly-drawn complex would be invisible right
        // where the user just drew it (the original bug report this fixes).
        focusFootprint: (footprint) => {
          setViewMode("infrastructure");
          let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
          for (const [lng, lat] of footprint) {
            if (lng < west) west = lng;
            if (lng > east) east = lng;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
          }
          map.fitBounds([[west, south], [east, north]], { padding: 120, maxZoom: 19, duration: 600 });
        },
      });
      detachVehicles = attachVehicleAnimation(map, store, {
        isVisible: (service) => viewRef.current.viewMode === "network" && viewRef.current.visibleModes.has(service.modeId),
      });
      map.resize();
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    const unsub = store.subscribe((s, prev) => {
      if (s.system !== prev.system || s.selection !== prev.selection || s.activeWayId !== prev.activeWayId) {
        if (map.getSource(SRC_SERVICES)) schedulePushData();
      }
      // Route drafting (Network view snap-to-streets drawing): show the
      // committed legs as the standard dashed draw preview.
      if (s.routeDraft !== prev.routeDraft) {
        const path = s.routeDraft ? routePath(s.system, s.routeDraft.spans) : [];
        (map.getSource(SRC_PREVIEW) as GeoJSONSource | undefined)?.setData(
          path.length >= 2
            ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: path } }] }
            : emptyFC,
        );
      }
      if (s.system.id !== lastSystemId) {
        lastSystemId = s.system.id;
        map.jumpTo({ center: s.system.viewport.center, zoom: s.system.viewport.zoom });
      }
      // Chrome-driven selection (Objects list, keyboard nav, Inspector jump
      // links, Issues) asks for this via selectAndFocus bumping the token —
      // a direct map click already shows the user where the thing is and
      // never touches this. See editor/store.ts's cameraFocusToken comment.
      if (s.cameraFocusToken !== prev.cameraFocusToken) {
        const focus = selectionFocus(s.system, s.selection);
        if (focus) {
          if (focus.needsInfrastructureView) setViewMode("infrastructure");
          map.fitBounds(focus.bounds, { padding: 100, maxZoom: 18, duration: 500 });
        }
      }
    });

    // Crossing the lane-detail zoom threshold swaps the whole rendering mode;
    // panning while AT lane detail changes which ways are in view. Either one
    // needs a data refresh — a plain pan below the threshold doesn't.
    let wasLaneDetail = false;
    const onZoom = () => {
      const now = laneDetailNow();
      if (now !== wasLaneDetail) {
        wasLaneDetail = now;
        if (map.getSource(SRC_LANES)) pushData();
      }
    };
    map.on("zoom", onZoom);

    const onMoveEnd = () => {
      const c = map.getCenter();
      store.getState().setViewport({ center: [c.lng, c.lat], zoom: map.getZoom() });
      if (laneDetailNow() && map.getSource(SRC_LANES)) pushData();
    };
    map.on("moveend", onMoveEnd);

    return () => {
      ro.disconnect();
      unsub();
      if (pushDataRaf !== null) cancelAnimationFrame(pushDataRaf);
      map.off("zoom", onZoom);
      map.off("moveend", onMoveEnd);
      detachInteractions?.();
      detachVehicles?.();
      pushDataRef.current = null;
      setMap(null);
      map.remove();
    };
  }, [store, openShortcuts, toggleUi]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
