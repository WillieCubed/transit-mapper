import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import { BASEMAP_STYLE } from "../map/basemap";
import { buildFeatures, LAYER_SPECS, registerMapIcons, SRC_FACILITIES, SRC_FOOTPRINTS, SRC_HANDLES, SRC_PHYSICAL_HANDLES, SRC_PLATFORMS, SRC_PREVIEW, SRC_SERVICES, SRC_STATIONS, SRC_VEHICLES, SRC_WAYS, type ViewOptions } from "../map/layers";
import { systemBounds } from "../model/geo";
import type { TransitSystem } from "../model/system";

/**
 * A second, read-only MapLibre instance for the export dialog — deliberately
 * separate from the app's main map (map/MapCanvas.tsx) so panning/zooming it
 * to frame an export never touches the live editing view. Plain interactions
 * (drag/scroll/double-click zoom) instead of the app's SimCity-style
 * right-drag-to-pan scheme, since there's nothing to draw here.
 */
interface ExportPreviewMapProps {
  system: TransitSystem;
  view: ViewOptions;
  onReady: (map: MLMap) => void;
}

export function ExportPreviewMap({ system, view, onReady }: ExportPreviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: system.viewport.center,
      zoom: system.viewport.zoom,
      preserveDrawingBuffer: true, // needed to read the canvas back out for PNG export
      attributionControl: false,
    });
    mapRef.current = map;
    const emptyFC = { type: "FeatureCollection" as const, features: [] };

    map.on("load", () => {
      registerMapIcons(map);
      map.addSource(SRC_WAYS, { type: "geojson", data: emptyFC });
      map.addSource(SRC_SERVICES, { type: "geojson", data: emptyFC });
      map.addSource(SRC_STATIONS, { type: "geojson", data: emptyFC });
      map.addSource(SRC_HANDLES, { type: "geojson", data: emptyFC });
      map.addSource(SRC_PREVIEW, { type: "geojson", data: emptyFC });
      map.addSource(SRC_FOOTPRINTS, { type: "geojson", data: emptyFC });
      map.addSource(SRC_PLATFORMS, { type: "geojson", data: emptyFC });
      map.addSource(SRC_FACILITIES, { type: "geojson", data: emptyFC });
      map.addSource(SRC_PHYSICAL_HANDLES, { type: "geojson", data: emptyFC });
      // Never populated here — a static export has no ambient vehicles — but
      // LAYER_SPECS' vehicles layer still needs a source to attach to or
      // addLayer throws (the bug this comment is here to stop someone from
      // reintroducing when adding the next new layer/source pair).
      map.addSource(SRC_VEHICLES, { type: "geojson", data: emptyFC });
      for (const spec of LAYER_SPECS) map.addLayer(spec);

      // Resize BEFORE fitting bounds — the dialog's layout (and this map's
      // container) may not have settled to its final size yet at "load"
      // time, and fitBounds computes its zoom from whatever size the
      // container reports right now. Fitting first would frame against a
      // stale (often smaller) size and leave the real system off-screen.
      map.resize();
      const bounds = systemBounds(system);
      if (bounds) map.fitBounds(bounds, { padding: 40, animate: false });

      pushDataRef.current();
      onReadyRef.current(map);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      mapRef.current = null;
      map.remove();
    };
    // Mounts once; the preview map's own life (bounds fit, sources) starts
    // from whatever `system`/`view` are at mount time — see the separate
    // effect below for keeping its data in sync as those props change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushData = () => {
    const map = mapRef.current;
    if (!map || !map.getSource(SRC_WAYS)) return;
    const fc = buildFeatures(system, null, [], view);
    (map.getSource(SRC_WAYS) as GeoJSONSource).setData(fc.ways);
    (map.getSource(SRC_SERVICES) as GeoJSONSource).setData(fc.services);
    (map.getSource(SRC_STATIONS) as GeoJSONSource).setData(fc.stations);
    (map.getSource(SRC_FOOTPRINTS) as GeoJSONSource).setData(fc.footprints);
    (map.getSource(SRC_PLATFORMS) as GeoJSONSource).setData(fc.platforms);
    (map.getSource(SRC_FACILITIES) as GeoJSONSource).setData(fc.facilities);
  };
  const pushDataRef = useRef(pushData);
  pushDataRef.current = pushData;

  useEffect(() => {
    pushDataRef.current();
  }, [system, view]);

  return <div ref={containerRef} className="export-preview-map" />;
}

/** Re-fit the given map to the whole system's extent — the export dialog's
 *  "Reset framing" action, for when a user has panned away from it. */
export function resetFraming(map: MLMap, system: TransitSystem): void {
  const bounds = systemBounds(system);
  if (bounds) map.fitBounds(bounds, { padding: 40, animate: true });
}
