import { iconName } from "../icons";

// Reshape/physical handles are always this one color+glyph (a solid square —
// the standard vector-editor "this is a control point" shape) regardless of
// what they're attached to, so they read as one consistent tool affordance
// and never as a real object like a station or facility.
export const HANDLE_INK = "#191a17";
export const HANDLE_ICON = iconName("square", HANDLE_INK);

export const SRC_WAYS = "tm-ways";
export const SRC_SERVICES = "tm-services";
export const SRC_STATIONS = "tm-stations";
export const SRC_HANDLES = "tm-handles";
export const SRC_PREVIEW = "tm-preview";
export const SRC_FOOTPRINTS = "tm-footprints";
export const SRC_PLATFORMS = "tm-platforms";
export const SRC_FACILITIES = "tm-facilities";
export const SRC_PHYSICAL_HANDLES = "tm-physical-handles";
export const SRC_VEHICLES = "tm-vehicles";
export const SRC_MARQUEE = "tm-marquee";
export const SRC_ENDPOINT_HINT = "tm-endpoint-hint";
export const SRC_LANES = "tm-lanes";
export const SRC_LANE_MARKINGS = "tm-lane-markings";
export const SRC_LANE_ARROWS = "tm-lane-arrows";
export const SRC_JUNCTIONS = "tm-junctions";
export const SRC_CONNECTORS = "tm-connectors";
export const SRC_WAY_LABELS = "tm-way-labels";
export const SRC_LANDMARKS = "tm-landmarks";

export const LYR_WAYS_SOLID = "tm-ways-solid";
export const LYR_WAYS_DASHED = "tm-ways-dashed";
export const LYR_WAY_SELECTED = "tm-way-selected";
export const LYR_SERVICES_ELEVATED = "tm-services-elevated";
export const LYR_SERVICE_SELECTED = "tm-service-selected";
export const LYR_SERVICES_SOLID = "tm-services-solid";
export const LYR_SERVICES_UNDERGROUND = "tm-services-underground";
export const LYR_STATIONS = "tm-stations";
export const LYR_STATION_SELECTED = "tm-station-selected";
export const LYR_VEHICLES = "tm-vehicles";
export const LYR_STATION_LABELS = "tm-station-labels";
export const LYR_FACILITY_LABELS = "tm-facility-labels";
export const LYR_HANDLES = "tm-handles";
export const LYR_WAY_ENDPOINTS = "tm-way-endpoints";
export const LYR_PREVIEW = "tm-preview";
export const LYR_FOOTPRINTS_FILL = "tm-footprints-fill";
export const LYR_FOOTPRINTS_STROKE = "tm-footprints-stroke";
export const LYR_PLATFORMS_FILL = "tm-platforms-fill";
export const LYR_PLATFORMS_STROKE = "tm-platforms-stroke";
export const LYR_FACILITIES = "tm-facilities";
export const LYR_FACILITY_SELECTED = "tm-facility-selected";
export const LYR_PHYSICAL_HANDLES = "tm-physical-handles";
export const LYR_ENDPOINT_HINT = "tm-endpoint-hint";
export const LYR_MARQUEE_FILL = "tm-marquee-fill";
export const LYR_MARQUEE_STROKE = "tm-marquee-stroke";
export const LYR_LANE_SURFACES = "tm-lane-surfaces";
export const LYR_LANE_LINES = "tm-lane-lines";
export const LYR_CENTER_LINES = "tm-center-lines";
export const LYR_EDGE_LINES = "tm-edge-lines";
export const LYR_LANE_TRACKS = "tm-lane-tracks";
export const LYR_LANE_ARROWS = "tm-lane-arrows";
export const LYR_JUNCTIONS = "tm-junctions";
export const LYR_JUNCTION_SELECTED = "tm-junction-selected";
export const LYR_CONNECTORS = "tm-connectors";
export const LYR_WAY_LABELS = "tm-way-labels";
export const LYR_LANDMARKS = "tm-landmarks";
export const LYR_LANDMARK_LABELS = "tm-landmark-labels";

// Lane-level street rendering only exists at zooms where a lane is at least
// a few pixels wide; below this the Infrastructure view keeps its cheap
// offset-fan rendering, and the whole-valley view never derives lane
// geometry at all (the LOD gate that keeps big imports fast).
export const LANE_DETAIL_MIN_ZOOM = 15;

// meters-per-pixel at zoom 14 on a 512px-tile web-mercator map; lane widths
// are stored in meters, so each feature carries its z14 pixel width and the
// layer scales it exponentially (base 2 — exact for mercator) with zoom.
const MPP_Z14_EQUATOR = 40075016.686 / (512 * 2 ** 14);
export function widthPxAtZ14(widthM: number, lat: number): number {
  return widthM / (MPP_Z14_EQUATOR * Math.cos((lat * Math.PI) / 180));
}
export const LANE_WIDTH_EXPR = ["interpolate", ["exponential", 2], ["zoom"], 14, ["get", "w14"], 22, ["*", 256, ["get", "w14"]]];
