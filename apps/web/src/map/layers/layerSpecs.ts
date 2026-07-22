import type { LayerSpecification } from "maplibre-gl";
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
} from "../../style/catalogStyle";
import {
  LANE_WIDTH_EXPR,
  LYR_CENTER_LINES,
  LYR_CONNECTORS,
  LYR_EDGE_LINES,
  LYR_ENDPOINT_HINT,
  LYR_FACILITIES,
  LYR_FACILITY_LABELS,
  LYR_FACILITY_SELECTED,
  LYR_FOOTPRINTS_FILL,
  LYR_FOOTPRINTS_STROKE,
  LYR_HANDLES,
  LYR_JUNCTIONS,
  LYR_JUNCTION_SELECTED,
  LYR_LANDMARKS,
  LYR_LANDMARK_LABELS,
  LYR_LANE_ARROWS,
  LYR_LANE_LINES,
  LYR_LANE_SURFACES,
  LYR_LANE_TRACKS,
  LYR_MARQUEE_FILL,
  LYR_MARQUEE_STROKE,
  LYR_PHYSICAL_HANDLES,
  LYR_PLATFORMS_FILL,
  LYR_PLATFORMS_STROKE,
  LYR_PREVIEW,
  LYR_SERVICES_ELEVATED,
  LYR_SERVICES_SOLID,
  LYR_SERVICES_UNDERGROUND,
  LYR_SERVICE_SELECTED,
  LYR_STATIONS,
  LYR_STATION_LABELS,
  LYR_STATION_SELECTED,
  LYR_VEHICLES,
  LYR_WAYS_DASHED,
  LYR_WAYS_SOLID,
  LYR_WAY_ENDPOINTS,
  LYR_WAY_LABELS,
  LYR_WAY_SELECTED,
  SRC_CONNECTORS,
  SRC_ENDPOINT_HINT,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_JUNCTIONS,
  SRC_LANDMARKS,
  SRC_LANES,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_MARQUEE,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_PREVIEW,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_VEHICLES,
  SRC_WAYS,
  SRC_WAY_LABELS,
} from "./constants";

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
    // One dot per service, driven by sim/vehicles.ts's own rAF loop directly
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
