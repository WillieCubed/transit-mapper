import type { FeatureCollection, Point } from "geojson";
import type { LngLat } from "@transitmapper/core/model/system";

/**
 * Hand-placed reference points for known Las Vegas anchors — the cheap
 * stand-in for a real population/employment context layer (see the plan
 * doc's agency lens, item 5). Deliberately NOT part of TransitSystem: these
 * aren't user-authored data, just fixed context for "why does the alignment
 * go here," so a saved/shared system never carries them and they never
 * appear in undo history.
 */
export interface Landmark {
  name: string;
  coord: LngLat;
}

export const LANDMARKS: Landmark[] = [
  { name: "The Strip", coord: [-115.1728, 36.1147] },
  { name: "Downtown", coord: [-115.1398, 36.1699] },
  { name: "UNLV", coord: [-115.1425, 36.1077] },
  { name: "Harry Reid Airport", coord: [-115.1537, 36.084] },
  { name: "Summerlin", coord: [-115.3255, 36.1699] },
  { name: "Henderson", coord: [-115.0281, 36.0395] },
];

export function landmarksFeatureCollection(): FeatureCollection<Point, { name: string }> {
  return {
    type: "FeatureCollection",
    features: LANDMARKS.map((l) => ({
      type: "Feature",
      properties: { name: l.name },
      geometry: { type: "Point", coordinates: l.coord },
    })),
  };
}
