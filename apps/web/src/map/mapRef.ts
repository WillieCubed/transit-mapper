import type { Map as MLMap } from "maplibre-gl";

// Single live map instance, shared with non-map UI (e.g. PNG export) without
// threading a ref through the component tree.
let current: MLMap | null = null;

export function setMap(map: MLMap | null): void {
  current = map;
}

export function getMap(): MLMap | null {
  return current;
}
