// P4 — import real infrastructure. The generalized model already accommodates
// this: a Way is a Way whether hand-drawn or pulled from OpenStreetMap, so
// importing is just another Way *producer* — a `source` marker is the only
// difference. Two layers, deliberately split for testability:
//  - pure, network-free transforms (classifyOsmWay, osmElementsToWays,
//    buildOverpassQuery) that fixture-based tests can exercise directly;
//  - importOsmWays, the one function that actually calls the network.
import { shortId } from "./ids";
import { defaultProfileFor } from "./profile";
import type { LngLat, Way } from "./system";

export interface ImportBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

// Which OSM tagging categories are importable — data-driven, so adding one is
// a catalog entry here, not new branching logic elsewhere.
export type ImportCategory = "road" | "heavyRail" | "lightRail" | "bike";

export const IMPORT_CATEGORY_ORDER: ImportCategory[] = ["road", "heavyRail", "lightRail", "bike"];

export const IMPORT_CATEGORY_LABELS: Record<ImportCategory, string> = {
  road: "Streets",
  heavyRail: "Heavy rail",
  lightRail: "Light rail / tram",
  bike: "Bike infrastructure",
};

// The Overpass QL clause selecting each category's OSM ways. `(bbox)` is
// substituted with the actual bounding box in buildOverpassQuery.
const CATEGORY_QUERY: Record<ImportCategory, string> = {
  road: `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"](bbox);`,
  heavyRail: `way["railway"~"^(rail|subway)$"](bbox);`,
  lightRail: `way["railway"~"^(light_rail|tram)$"](bbox);`,
  bike: `way["highway"="cycleway"](bbox);`,
};

/** Build an Overpass QL query for the given categories within a bounding box. */
export function buildOverpassQuery(bbox: ImportBBox, categories: ImportCategory[]): string {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const clauses = categories.map((c) => CATEGORY_QUERY[c].replace(/\(bbox\)/g, `(${bboxStr})`)).join("\n  ");
  return `[out:json][timeout:25];\n(\n  ${clauses}\n);\nout geom;`;
}

// v3's own road classes stand in for OSM's `highway` hierarchy — a rough but
// reasonable default; the user can always change a way's class after import.
const ROAD_CLASS_BY_HIGHWAY: Record<string, string> = {
  motorway: "transitway",
  trunk: "arterial",
  primary: "arterial",
  secondary: "arterial",
  tertiary: "collector",
  residential: "local",
  unclassified: "local",
  living_street: "local",
};

export interface OsmWayElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/**
 * Map an OSM way's tags to a catalog way type + class, or null if it isn't
 * one of the importable categories. The one place OSM's tagging vocabulary
 * meets our catalog — pure and network-free, so fixture data can test it
 * directly without hitting Overpass.
 */
export function classifyOsmWay(tags: Record<string, string> | undefined): { typeId: string; classId?: string } | null {
  if (!tags) return null;
  const railway = tags.railway;
  if (railway === "rail" || railway === "subway") return { typeId: "heavyRail" };
  if (railway === "light_rail" || railway === "tram") return { typeId: "lightRail" };
  const highway = tags.highway;
  if (highway === "cycleway") return { typeId: "bike", classId: "path" };
  if (highway && ROAD_CLASS_BY_HIGHWAY[highway]) return { typeId: "road", classId: ROAD_CLASS_BY_HIGHWAY[highway] };
  return null;
}

/** Turn parsed Overpass `elements` into Ways, each tagged with its OSM source
 *  (`osm:<wayId>`) so an imported way is always distinguishable from a
 *  hand-drawn one. Elements that aren't a recognized category are skipped. */
export function osmElementsToWays(elements: OsmWayElement[]): Way[] {
  const ways: Way[] = [];
  for (const el of elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const kind = classifyOsmWay(el.tags);
    if (!kind) continue;
    const points: LngLat[] = el.geometry.map((g) => [g.lon, g.lat]);
    ways.push({
      id: shortId(),
      typeId: kind.typeId,
      points,
      geometry: "straight",
      grade: "atGrade",
      profile: defaultProfileFor(kind.typeId),
      classId: kind.classId,
      source: `osm:${el.id}`,
    });
  }
  return ways;
}

/** Fetch OSM ways for the given categories within a bounding box from the
 *  public Overpass API and convert them to catalog-typed Ways. The only
 *  function here that touches the network. */
export async function importOsmWays(bbox: ImportBBox, categories: ImportCategory[]): Promise<Way[]> {
  if (categories.length === 0) return [];
  const query = buildOverpassQuery(bbox, categories);
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: query,
  });
  if (!res.ok) throw new Error(`OSM import failed (${res.status}).`);
  const data = (await res.json()) as { elements?: OsmWayElement[] };
  return osmElementsToWays(data.elements ?? []);
}
